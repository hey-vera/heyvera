/**
 * ClawNetApiKeyBackend — ClawNet's first real consumer of the Soma
 * `CredentialRotationController`.
 *
 * Implements `soma-heart/credential-rotation`'s `CredentialBackend`
 * interface against the two SQLite tables introduced by migration v1:
 *
 *   api_key_rotation_credentials  — every minted credential (active or
 *                                   revoked). The controller's
 *                                   verify-before-revoke keeps stale
 *                                   rows around until the next rotation
 *                                   drops them, so one identity_id has
 *                                   N credential rows over time.
 *   api_key_rotation_identities   — per-identity pointer: current
 *                                   credential + pre-committed next
 *                                   keypair for KERI-style pre-rotation.
 *
 * **INERT in this PR.** Nothing in the request path imports or
 * instantiates this backend yet; the server does not create a
 * `CredentialRotationController`, does not register the backend on
 * boot, and `checkApiKey` in `src/middleware/auth.ts` is untouched.
 * The backend is a library, exercised only by its own unit tests.
 * Middleware wiring, admin mint endpoint, and shadow-check cutover
 * land in later PRs (#6 / #7 / #8 / #9).
 *
 * ─── AAD contract (permanent, storage-visible) ─────────────────────
 *
 * Secret bytes at rest go through `src/core/vault-crypto.ts` using
 * AES-256-GCM with a context-bound AAD. The AAD strings are part of
 * the persistent storage format: changing them without a data
 * migration makes every existing row fail AEAD auth on decrypt.
 *
 *   - credential rows (`secret_key`):            AAD = credentialId
 *   - identity rows  (`next_secret_key`):        AAD = `${identityId}:next`
 *                                                 (via `nextSecretAad()`)
 *
 * Pasting ciphertext from one row into another therefore fails auth.
 * **Do not rename `nextSecretAad` or change its format without a
 * matching data migration for every existing row.**
 *
 * ─── `algorithm_suite` column (load-bearing) ────────────────────────
 *
 * Every row written by this backend stores `algorithm_suite = 'ed25519'`.
 * The v1 schema column is `TEXT NOT NULL` but was not validated in
 * PR #30. Future hybrid-signing work (soma-heart already reserves the
 * `ed25519+ml-dsa-65` and `secp256k1+ml-dsa-65` suite identifiers for
 * post-quantum migration) will need one of:
 *
 *   (a) a different string in this column plus a read-side dispatcher
 *       that picks the right provider per-row, or
 *   (b) a second suite column for the hybrid half.
 *
 * Silently widening `this.algorithmSuite` without solving the read-side
 * dispatch will produce rows whose stored suite no longer matches the
 * bytes in `secret_key`. Treat this as a conscious architectural
 * decision, not a drive-by.
 *
 * ─── P0.2 revoke zero-fill (64 bytes, sentinel-style) ───────────────
 *
 * `revokeCredential` overwrites `secret_key` with 64 zero bytes (the
 * Ed25519 secret length) rather than 32. An earlier revision wrote 32
 * which left a decoded buffer of the wrong length for any later
 * grace-window verify path that re-read the column. See
 * `internal/active/rotation-battle-test-and-roadmap.md` §1 P0.2.
 *
 * The roadmap also suggested "prefer NULL; treat NULL as revoked".
 * That half is **incompatible with the v1 schema** from PR #30, which
 * declares `secret_key TEXT NOT NULL`, so literal NULL cannot be
 * stored. The `revoked INTEGER` column remains the authoritative
 * revoke flag, and the 64-byte sentinel is defense-in-depth against a
 * reader that forgets to check it. This is not an unfinished half of
 * P0.2 — it is simply moot under the current schema.
 *
 * ─── Protocol purity ────────────────────────────────────────────────
 *
 * Imports only from `soma-heart/credential-rotation` and
 * `soma-heart/crypto-provider` — the public subpath exports. No
 * ClawNet types leak into Soma, no reach-through into Soma internals.
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

import { getDb } from '../db/index';
import { decryptSecret, encryptSecret, nextSecretAad } from './vault-crypto';

/**
 * Thrown by `ClawNetApiKeyBackend.adoptPreVerifiedBearer` when a
 * rotation credential row already exists for the target bearer but is
 * not registered in `api_key_rotation_adoption`. Refusing here prevents
 * a stray rotation mint from being retroactively claimed as adopted.
 */
export class AdoptionBearerCollisionError extends Error {
  constructor(public readonly bearer: string) {
    super(
      `AdoptionBearerCollision: a rotation credential already exists for bearer ${bearer} with no adoption row`,
    );
    this.name = 'AdoptionBearerCollisionError';
  }
}

// ─── Bearer-token generator ─────────────────────────────────────────────────

/**
 * Mint a bearer token that matches ClawNet's existing `cn-[a-f0-9]{48}`
 * format so that when PR #7+ cut over, no customer-visible bearer
 * string changes. The `checkApiKey` regex in `src/middleware/auth.ts`
 * continues to apply: a rotation credential is a `cn-…` bearer whose
 * durable state lives in the rotation backend instead of the legacy
 * `api_keys` row.
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
    // pasted in from another row fails the AEAD check.
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
    // P0.2: overwrite `secret_key` with 64 zero bytes (Ed25519 secret
    // length). An earlier revision wrote 32 which left a decoded buffer
    // of the wrong length for any later grace-window verify path that
    // re-read the column. The `revoked` flag remains authoritative; the
    // zero-fill is defense-in-depth. Row is kept so the controller's
    // accepted-pool can still look up the public key to verify in-flight
    // signatures against it until the grace window expires.
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

  // ─── G7.2 adoption primitive ────────────────────────────────────────────

  /**
   * Storage-only adoption of a pre-verified legacy `cn-…` bearer.
   *
   * **This is a backend/storage primitive, not a rotation-controller
   * operation.** It writes a rotation credential row, an identity row,
   * and an adoption-mapping row in a single sync `db.transaction(...)`
   * with the invariant `credential_id == bearer`. It does **not** call
   * `CredentialRotationController.incept`, does not advance a rotation
   * event chain (`pending → anchored → effective`), and does not make
   * the rotation backend authoritative. Middleware is untouched.
   *
   * The caller proves pre-verification by passing a
   * `VerifiedLegacyBearer` (see `src/core/rotation-adoption.ts`). That
   * brand is erased at runtime, so this method also re-checks the
   * bearer format as defense-in-depth.
   *
   * Atomicity: the three INSERTs are wrapped in `db.transaction(fn)`,
   * which better-sqlite3 guarantees as all-or-nothing with automatic
   * rollback on any throw inside `fn`. All async-capable work (keypair
   * generation, manifest-commitment hashing) happens **before** the
   * transaction opens, so the writer lock window holds only prepared
   * statements.
   *
   * Idempotency: if an adoption row already exists for `bearer`, the
   * transaction reads it back and returns `{idempotent: true}` without
   * writing. A pre-existing rotation credential row with the same id
   * that is **not** yet adopted throws `AdoptionBearerCollision` — the
   * primitive refuses to retroactively claim a stray credential.
   *
   * No public setter exposes the bearer string anywhere else in the
   * backend — `adoptPreVerifiedBearer` is the only path that writes a
   * credential row whose `credential_id` is caller-chosen instead of
   * mint-generated.
   */
  adoptPreVerifiedBearer(args: {
    bearer: string;
    identityId: string;
    issuedAt: number;
    ttlMs: number;
  }): {
    credential: Credential;
    adoption: { bearer: string; identityId: string; adoptedAt: number };
    idempotent: boolean;
  } {
    // Defense-in-depth: the brand has been checked by the wrapper, but
    // runtime erasure means a compromised caller could downcast. Enforce
    // the format invariant at the storage boundary too.
    if (!/^cn-[a-f0-9]{48}$/.test(args.bearer)) {
      throw new Error(
        `ClawNetApiKeyBackend.adoptPreVerifiedBearer: bearer does not match cn-[a-f0-9]{48}: ${args.bearer}`,
      );
    }

    // Pre-compute crypto OUTSIDE the transaction so the writer lock
    // holds only prepared-statement time. Keypair generation is the
    // slowest step by a wide margin.
    const keyPair = this.provider.signing.generateKeyPair();
    const nextKeyPair = this.provider.signing.generateKeyPair();
    const nextManifestCommitment = computeManifestCommitment(
      {
        backendId: this.backendId,
        algorithmSuite: this.algorithmSuite,
        publicKey: nextKeyPair.publicKey,
      },
      this.provider,
    );
    const expiresAt = args.issuedAt + args.ttlMs;
    // Vault-wrap ciphertexts before the transaction so the lock window
    // does not include AEAD work.
    const wrappedSecret = encryptSecret(keyPair.secretKey, args.bearer);
    const wrappedNextSecret = encryptSecret(
      nextKeyPair.secretKey,
      nextSecretAad(args.identityId),
    );
    const publicKeyB64 = this.b64(keyPair.publicKey);
    const nextPublicKeyB64 = this.b64(nextKeyPair.publicKey);

    // Closure state so the transaction body can return a value through
    // better-sqlite3's db.transaction() wrapper.
    let resultIdempotent = false;
    let resultCredential: Credential;
    let resultAdoption: {
      bearer: string;
      identityId: string;
      adoptedAt: number;
    };

    const tx = this.db.transaction(() => {
      // Idempotent short-circuit: an existing adoption row for the
      // same bearer is a no-op re-adoption. Read the row back and
      // return the previously minted credential.
      const existingAdoption = this.db
        .prepare(
          'SELECT bearer, identity_id, adopted_at FROM api_key_rotation_adoption WHERE bearer = ?',
        )
        .get(args.bearer) as
        | { bearer: string; identity_id: string; adopted_at: number }
        | undefined;

      if (existingAdoption) {
        const existingCred = this.readCredential(args.bearer);
        if (!existingCred) {
          throw new Error(
            `ClawNetApiKeyBackend.adoptPreVerifiedBearer: adoption row exists for ${args.bearer} but credential row is missing`,
          );
        }
        resultCredential = {
          credentialId: existingCred.credential_id,
          identityId: existingCred.identity_id,
          backendId: this.backendId,
          algorithmSuite: this.algorithmSuite,
          class: existingCred.class as CredentialClass,
          publicKey: this.decodeB64(existingCred.public_key),
          issuedAt: existingCred.issued_at,
          expiresAt: existingCred.expires_at,
          nextManifestCommitment: existingCred.next_manifest_commitment,
        };
        resultAdoption = {
          bearer: existingAdoption.bearer,
          identityId: existingAdoption.identity_id,
          adoptedAt: existingAdoption.adopted_at,
        };
        resultIdempotent = true;
        return;
      }

      // Collision guard: a rotation credential row with this id must
      // not already exist outside the adoption table. Refusing here
      // prevents a stray mint (e.g. from a test bypass) from being
      // retroactively claimed as an adopted bearer.
      const straylingCred = this.db
        .prepare(
          'SELECT credential_id FROM api_key_rotation_credentials WHERE credential_id = ?',
        )
        .get(args.bearer) as { credential_id: string } | undefined;
      if (straylingCred) {
        throw new AdoptionBearerCollisionError(args.bearer);
      }

      this.db
        .prepare(
          `INSERT INTO api_key_rotation_credentials
             (credential_id, identity_id, algorithm_suite, class,
              public_key, secret_key, next_manifest_commitment,
              issued_at, expires_at, revoked)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        )
        .run(
          args.bearer,
          args.identityId,
          this.algorithmSuite,
          this.class,
          publicKeyB64,
          wrappedSecret,
          nextManifestCommitment,
          args.issuedAt,
          expiresAt,
        );

      this.db
        .prepare(
          `INSERT INTO api_key_rotation_identities
             (identity_id, current_credential_id, next_public_key, next_secret_key, ttl_ms)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          args.identityId,
          args.bearer,
          nextPublicKeyB64,
          wrappedNextSecret,
          args.ttlMs,
        );

      this.db
        .prepare(
          `INSERT INTO api_key_rotation_adoption (bearer, identity_id, adopted_at)
           VALUES (?, ?, ?)`,
        )
        .run(args.bearer, args.identityId, args.issuedAt);

      resultCredential = {
        credentialId: args.bearer,
        identityId: args.identityId,
        backendId: this.backendId,
        algorithmSuite: this.algorithmSuite,
        class: this.class,
        publicKey: keyPair.publicKey,
        issuedAt: args.issuedAt,
        expiresAt,
        nextManifestCommitment,
      };
      resultAdoption = {
        bearer: args.bearer,
        identityId: args.identityId,
        adoptedAt: args.issuedAt,
      };
    });

    try {
      tx();
    } catch (err) {
      // Zeroise the freshly generated secret material on any throw so
      // it cannot linger in heap memory beyond the failed call. The
      // wrappedSecret ciphertexts are already inert under an unknown
      // IV/tag so there is nothing to scrub there.
      keyPair.secretKey.fill(0);
      nextKeyPair.secretKey.fill(0);
      throw err;
    }

    return {
      credential: resultCredential!,
      adoption: resultAdoption!,
      idempotent: resultIdempotent,
    };
  }

  // ─── Read helpers (exposed for future middleware / tests) ──────────────

  /**
   * Look up a credential row by its bearer token (= credentialId). Will
   * be used by the middleware cutover in PR #7 to validate an incoming
   * `cn-…` header against the rotation table instead of the legacy
   * `api_keys` row. Returns `null` for unknown, revoked, or expired
   * credentials.
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
    const credentialId = mintBearerToken();
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
