/**
 * ClawNetApiKeyBackend — ClawNet's first real consumer of the Soma
 * `CredentialRotationController`.
 *
 * Implements the Soma `CredentialBackend` interface against two new
 * SQLite tables:
 *
 *   api_key_rotation_credentials  — every minted Tier 1 credential
 *                                   (active + revoked), keyed by
 *                                   credentialId which doubles as the
 *                                   `cn-…` bearer token.
 *   api_key_rotation_identities   — the live per-identity pointer:
 *                                   current credential + pre-committed
 *                                   next keypair for KERI pre-rotation.
 *
 * Design notes:
 *
 *   • The backend only knows about *rotation* state. The existing
 *     `api_keys` table is untouched by this file. Binding a Soma
 *     identityId to a legacy `api_keys.key` row is a higher-level
 *     concern handled during the middleware cutover (see backlog
 *     credential-rotation-architecture.md §9).
 *
 *   • Secret keys are written as base64 *plaintext* in this first pass.
 *     The VPS disk is already a trust boundary; encryption at rest is
 *     a follow-up (ties into the broader secret-vault work, P0.2).
 *     Callers MUST treat any backup of this DB as credential material.
 *
 *   • Pre-rotation (§14 L1) is one step ahead at all times: every
 *     mint also generates the *next* keypair and commits to its
 *     manifest. Rotation promotes the pre-committed pair to current
 *     and generates a fresh next-next pair.
 *
 *   • Rotation is transactional via stage/commit/abort. `stageNext…`
 *     materialises a new credential row (so the controller can collect
 *     its first proof-of-possession) but leaves the identity pointer
 *     untouched; `commit` advances the pointer; `abort` deletes the
 *     staged row and zeroises the next-next secret bytes.
 *
 *   • This file imports from `soma-heart/credential-rotation` only —
 *     no ClawNet types leak into Soma, and no Soma internals bypass
 *     the public subpath export. Protocol purity rule preserved.
 */

import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';

import {
  computeManifestCommitment,
  StagedRotationConflict,
  type AlgorithmSuite,
  type Credential,
  type CredentialBackend,
  type CredentialClass,
  type CredentialManifest,
} from 'soma-heart/credential-rotation';
import { getCryptoProvider } from 'soma-heart/crypto-provider';

import { getDb } from '../db/connection';
import { decryptSecret, encryptSecret, nextSecretAad } from './vault-crypto';

// ─── Bearer-token generator ─────────────────────────────────────────────────

/**
 * Mint a bearer token that matches ClawNet's existing `cn-[a-f0-9]{48}`
 * format. The `checkApiKey` regex in `src/middleware/auth.ts` still
 * applies: a rotation credential is a `cn-…` bearer, just one whose
 * durable state lives under the rotation controller instead of the
 * legacy `api_keys` row.
 */
function mintBearerToken(): string {
  return `cn-${crypto.randomBytes(24).toString('hex')}`;
}

// ─── Row types ──────────────────────────────────────────────────────────────

interface CredentialRow {
  credential_id: string;
  identity_id: string;
  algorithm_suite: string;
  class: string;
  public_key: string;
  secret_key: string;
  next_manifest_commitment: string;
  issued_at: number;
  expires_at: number;
  revoked: number;
}

interface IdentityRow {
  identity_id: string;
  current_credential_id: string;
  next_public_key: string;
  next_secret_key: string;
  ttl_ms: number;
}

// ─── Staged rotation (in-memory only) ──────────────────────────────────────

interface StagedRotation {
  stagedCredentialId: string;
  /** Pre-commit next-next secret — replaces identity.next_secret_key on commit. */
  nextNextSecretKey: Uint8Array;
  /** Pre-commit next-next public  — replaces identity.next_public_key on commit. */
  nextNextPublicKey: Uint8Array;
}

// ─── Backend ────────────────────────────────────────────────────────────────

export interface ClawNetApiKeyBackendOptions {
  /**
   * Override the backend id. Default `clawnet-api-key`. A heart that
   * runs multiple ClawNet-style identity backends (e.g. service keys
   * and customer keys as separate policy envelopes) can pick distinct
   * ids per envelope.
   */
  backendId?: string;
  /**
   * Credential class. Defaults to `'A'` (Soma-native mint path, 10min TTL)
   * per §14 D7.
   */
  class?: CredentialClass;
  /**
   * Injected DB handle. Defaults to the process-global `getDb()`. Tests
   * supply an isolated DB so they don't race against the live orchestrator.
   */
  db?: Database;
}

export class ClawNetApiKeyBackend implements CredentialBackend {
  readonly backendId: string;
  readonly algorithmSuite: AlgorithmSuite = 'ed25519';
  readonly class: CredentialClass;

  private readonly provider = getCryptoProvider();
  private readonly db: Database;
  private readonly staged = new Map<string, StagedRotation>();
  /**
   * One-shot override used by the shadow-adoption path: when set, the very
   * next `mintEntry` call uses this bearer as the credentialId instead of
   * minting a fresh one via `mintBearerToken()`. Consumed (cleared) on use.
   * See credential-rotation-architecture.md §9a Phase 1.
   */
  private pendingAdoptBearer: string | null = null;

  constructor(opts: ClawNetApiKeyBackendOptions = {}) {
    this.backendId = opts.backendId ?? 'clawnet-api-key';
    this.class = opts.class ?? 'A';
    this.db = opts.db ?? getDb();
  }

  // ─── Minting ────────────────────────────────────────────────────────────

  async issueCredential(args: {
    identityId: string;
    issuedAt: number;
    ttlMs: number;
  }): Promise<Credential> {
    const existing = this.readIdentity(args.identityId);
    if (existing) {
      throw new Error(
        `ClawNetApiKeyBackend: identity ${args.identityId} already inceptioned`,
      );
    }

    const keyPair = this.provider.signing.generateKeyPair();
    const nextKeyPair = this.provider.signing.generateKeyPair();

    const credential = this.mintEntry({
      identityId: args.identityId,
      secretKey: keyPair.secretKey,
      publicKey: keyPair.publicKey,
      nextPublicKey: nextKeyPair.publicKey,
      issuedAt: args.issuedAt,
      ttlMs: args.ttlMs,
    });

    this.db
      .prepare(
        `INSERT INTO api_key_rotation_identities
           (identity_id, current_credential_id, next_public_key, next_secret_key, ttl_ms)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        args.identityId,
        credential.credentialId,
        this.b64(nextKeyPair.publicKey),
        encryptSecret(nextKeyPair.secretKey, nextSecretAad(args.identityId)),
        args.ttlMs,
      );

    return credential;
  }

  async stageNextCredential(args: {
    identityId: string;
    oldCredentialId: string;
    issuedAt: number;
  }): Promise<Credential> {
    if (this.staged.has(args.identityId)) {
      throw new StagedRotationConflict(args.identityId);
    }
    const ident = this.requireIdentity(args.identityId);
    if (ident.current_credential_id !== args.oldCredentialId) {
      throw new Error(
        `ClawNetApiKeyBackend: oldCredentialId ${args.oldCredentialId} does not match current ${ident.current_credential_id}`,
      );
    }

    // Promote the pre-committed next keypair to the new current, and
    // generate the fresh next-next pair that the new credential will
    // commit to. Neither durable row moves yet — only the credential
    // row is inserted so the controller can collect the new key's PoP.
    // `next_secret_key` is vault-wrapped (AEAD-bound to `${id}:next`),
    // so decryption doubles as a row-integrity check.
    const promotedSecretKey = decryptSecret(
      ident.next_secret_key,
      nextSecretAad(args.identityId),
    );
    const promotedPublicKey = this.decodeB64(ident.next_public_key);
    const nextNextKeyPair = this.provider.signing.generateKeyPair();

    const credential = this.mintEntry({
      identityId: args.identityId,
      secretKey: promotedSecretKey,
      publicKey: promotedPublicKey,
      nextPublicKey: nextNextKeyPair.publicKey,
      issuedAt: args.issuedAt,
      ttlMs: ident.ttl_ms,
    });

    this.staged.set(args.identityId, {
      stagedCredentialId: credential.credentialId,
      nextNextSecretKey: nextNextKeyPair.secretKey,
      nextNextPublicKey: nextNextKeyPair.publicKey,
    });
    return credential;
  }

  async commitStagedRotation(identityId: string): Promise<void> {
    const stage = this.staged.get(identityId);
    if (!stage) {
      throw new Error(
        `ClawNetApiKeyBackend: no staged rotation for ${identityId}`,
      );
    }
    this.db
      .prepare(
        `UPDATE api_key_rotation_identities
           SET current_credential_id = ?, next_public_key = ?, next_secret_key = ?
         WHERE identity_id = ?`,
      )
      .run(
        stage.stagedCredentialId,
        this.b64(stage.nextNextPublicKey),
        encryptSecret(stage.nextNextSecretKey, nextSecretAad(identityId)),
        identityId,
      );
    this.staged.delete(identityId);
  }

  async abortStagedRotation(identityId: string): Promise<void> {
    const stage = this.staged.get(identityId);
    if (!stage) return;
    // Delete the staged credential row. Its secret key in the DB is the
    // same bytes as the identity row's `next_secret_key` (the committed
    // pre-rotation target), so we must NOT zero those bytes here — a
    // retry has to be able to re-stage against the same commitment.
    this.db
      .prepare('DELETE FROM api_key_rotation_credentials WHERE credential_id = ?')
      .run(stage.stagedCredentialId);
    // The next-next keypair was freshly generated for this stage and is
    // not referenced by anything durable. Safe to zeroise.
    stage.nextNextSecretKey.fill(0);
    this.staged.delete(identityId);
  }

  // ─── Signing / verify ───────────────────────────────────────────────────

  async signWithCredential(
    credentialId: string,
    message: Uint8Array,
  ): Promise<Uint8Array> {
    const row = this.requireLiveCredential(credentialId);
    // Vault-unwrap the secret with AAD bound to credentialId — ciphertext
    // pasted in from another row fails the AEAD check. Zeroing the local
    // buffer after use is cosmetic in Node (V8 copies during GC) — real
    // protection is the at-rest KEK. See rotation-battle-test-and-roadmap.md §1.
    const secretKey = decryptSecret(row.secret_key, credentialId);
    return this.provider.signing.sign(message, secretKey);
  }

  async verifyWithCredential(
    credentialId: string,
    message: Uint8Array,
    signature: Uint8Array,
  ): Promise<boolean> {
    const row = this.readCredential(credentialId);
    if (!row || row.revoked) return false;
    return this.provider.signing.verify(
      message,
      signature,
      this.decodeB64(row.public_key),
    );
  }

  async verifyWithManifest(
    manifest: CredentialManifest,
    message: Uint8Array,
    signature: Uint8Array,
  ): Promise<boolean> {
    return this.provider.signing.verify(message, signature, manifest.publicKey);
  }

  // ─── Revocation / cleanup ───────────────────────────────────────────────

  async revokeCredential(credentialId: string): Promise<void> {
    // Mark revoked and overwrite the stored secret key with 64 zero bytes
    // (matches Ed25519 secret length — an earlier revision wrote 32 bytes,
    // which left a decoded buffer of the wrong length for any later verify
    // path that accidentally re-read the column). The row is kept so the
    // controller's accepted-pool can still look up the public key to verify
    // in-flight signatures against it until the grace window expires.
    const zeroBytes = this.b64(new Uint8Array(64));
    this.db
      .prepare(
        'UPDATE api_key_rotation_credentials SET revoked = 1, secret_key = ? WHERE credential_id = ?',
      )
      .run(zeroBytes, credentialId);
  }

  async discardIdentity(identityId: string): Promise<void> {
    // Abort any in-flight stage first so the in-memory map and the DB
    // agree, then wipe both tables for this identity. Idempotent.
    if (this.staged.has(identityId)) {
      await this.abortStagedRotation(identityId);
    }
    const zeroBytes = this.b64(new Uint8Array(64));
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE api_key_rotation_credentials
             SET secret_key = ?, revoked = 1
           WHERE identity_id = ?`,
        )
        .run(zeroBytes, identityId);
      this.db
        .prepare('DELETE FROM api_key_rotation_credentials WHERE identity_id = ?')
        .run(identityId);
      this.db
        .prepare('DELETE FROM api_key_rotation_identities WHERE identity_id = ?')
        .run(identityId);
    });
    tx();
  }

  // ─── Read helpers (exposed for middleware / tests) ──────────────────────

  /**
   * Look up a credential row by its bearer token (= credentialId). Used
   * by the middleware cutover to validate an incoming `cn-…` header
   * against the rotation table rather than the legacy `api_keys` row.
   * Returns `null` for unknown, revoked, or expired credentials.
   */
  lookupByBearer(
    bearer: string,
    now: number,
  ): { identityId: string; expiresAt: number } | null {
    const row = this.readCredential(bearer);
    if (!row || row.revoked) return null;
    if (row.expires_at <= now) return null;
    return { identityId: row.identity_id, expiresAt: row.expires_at };
  }

  /**
   * Return the current live credentialId for an identity, or null if
   * the identity does not exist. Does not touch the `staged` map.
   */
  getCurrentCredentialId(identityId: string): string | null {
    const ident = this.readIdentity(identityId);
    return ident?.current_credential_id ?? null;
  }

  /**
   * Arm the backend so the NEXT `issueCredential` call (normally triggered
   * by `controller.incept`) uses `bearer` as the credentialId instead of
   * minting a fresh `cn-...` token. Used by the shadow-adoption path in
   * `src/core/rotation-adoption.ts` to graft an existing api_keys.key onto
   * a brand-new Soma identity without changing the customer-visible string.
   *
   * Single-use. Caller must validate the bearer format before calling —
   * the backend stores it verbatim.
   */
  adoptExistingBearer(bearer: string): void {
    if (!/^cn-[a-f0-9]{48}$/.test(bearer)) {
      throw new Error(
        `ClawNetApiKeyBackend.adoptExistingBearer: malformed bearer ${bearer.slice(0, 8)}…`,
      );
    }
    if (this.pendingAdoptBearer !== null) {
      throw new Error(
        'ClawNetApiKeyBackend.adoptExistingBearer: another adoption is already armed',
      );
    }
    this.pendingAdoptBearer = bearer;
  }

  /**
   * Clear a previously-armed adoption slot without consuming it. Idempotent.
   * Called from the adoption wrapper's rollback path when the enclosing
   * transaction aborts before `issueCredential` gets a chance to consume
   * the slot. Safe no-op if no slot was armed or it was already consumed.
   */
  clearPendingAdoptBearer(): void {
    this.pendingAdoptBearer = null;
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private mintEntry(args: {
    identityId: string;
    secretKey: Uint8Array;
    publicKey: Uint8Array;
    nextPublicKey: Uint8Array;
    issuedAt: number;
    ttlMs: number;
  }): Credential {
    const nextManifestCommitment = computeManifestCommitment(
      {
        backendId: this.backendId,
        algorithmSuite: this.algorithmSuite,
        publicKey: args.nextPublicKey,
      },
      this.provider,
    );
    // Shadow-adoption path: if an existing bearer was stashed via
    // `adoptExistingBearer`, use it as the credentialId so the rotation row
    // keys off the customer's existing `cn-...` string. One-shot, cleared
    // on use so subsequent rotations mint fresh tokens normally.
    let credentialId: string;
    if (this.pendingAdoptBearer !== null) {
      credentialId = this.pendingAdoptBearer;
      this.pendingAdoptBearer = null;
    } else {
      credentialId = mintBearerToken();
    }
    const expiresAt = args.issuedAt + args.ttlMs;

    this.db
      .prepare(
        `INSERT INTO api_key_rotation_credentials
           (credential_id, identity_id, algorithm_suite, class,
            public_key, secret_key, next_manifest_commitment,
            issued_at, expires_at, revoked)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(
        credentialId,
        args.identityId,
        this.algorithmSuite,
        this.class,
        this.b64(args.publicKey),
        // Vault-wrap the secret, AAD-bound to credentialId so ciphertext
        // cannot be lifted into a different row without failing verify.
        encryptSecret(args.secretKey, credentialId),
        nextManifestCommitment,
        args.issuedAt,
        expiresAt,
      );

    return {
      credentialId,
      identityId: args.identityId,
      backendId: this.backendId,
      algorithmSuite: this.algorithmSuite,
      class: this.class,
      publicKey: args.publicKey,
      issuedAt: args.issuedAt,
      expiresAt,
      nextManifestCommitment,
    };
  }

  private readIdentity(identityId: string): IdentityRow | undefined {
    return this.db
      .prepare(
        'SELECT identity_id, current_credential_id, next_public_key, next_secret_key, ttl_ms FROM api_key_rotation_identities WHERE identity_id = ?',
      )
      .get(identityId) as IdentityRow | undefined;
  }

  private requireIdentity(identityId: string): IdentityRow {
    const row = this.readIdentity(identityId);
    if (!row) {
      throw new Error(`ClawNetApiKeyBackend: unknown identity ${identityId}`);
    }
    return row;
  }

  private readCredential(credentialId: string): CredentialRow | undefined {
    return this.db
      .prepare(
        'SELECT credential_id, identity_id, algorithm_suite, class, public_key, secret_key, next_manifest_commitment, issued_at, expires_at, revoked FROM api_key_rotation_credentials WHERE credential_id = ?',
      )
      .get(credentialId) as CredentialRow | undefined;
  }

  private requireLiveCredential(credentialId: string): CredentialRow {
    const row = this.readCredential(credentialId);
    if (!row) {
      throw new Error(`ClawNetApiKeyBackend: unknown credential ${credentialId}`);
    }
    if (row.revoked) {
      throw new Error(`ClawNetApiKeyBackend: credential revoked ${credentialId}`);
    }
    return row;
  }

  private b64(bytes: Uint8Array): string {
    return this.provider.encoding.encodeBase64(bytes);
  }

  private decodeB64(s: string): Uint8Array {
    return this.provider.encoding.decodeBase64(s);
  }
}
