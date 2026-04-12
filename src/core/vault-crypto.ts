/**
 * Credential vault — AES-256-GCM wrap for rotation secret-at-rest.
 *
 * Wraps the durable `secret_key` / `next_secret_key` columns in the
 * rotation backend so a DB dump no longer equals a full credential
 * exfil. See `internal/active/rotation-battle-test-and-roadmap.md` §1
 * (P0.1) for the threat model and roll-out.
 *
 * Storage format (after wrap):
 *
 *   "v1:" || base64(iv || ciphertext || tag)
 *
 *   - iv:       12 bytes, random per encryption (GCM standard)
 *   - tag:      16 bytes AEAD auth tag
 *   - aad:      UTF-8 context string bound into the signature, typically
 *               the credential_id or `${identityId}:next` — pasting
 *               ciphertext from one row into another fails auth.
 *
 * Legacy plaintext base64 rows are still accepted on read, so this
 * ships without a data migration: existing rows keep working and are
 * transparently rewritten as `v1:` on their next update. That also
 * means an operator who cannot yet set `CREDENTIAL_VAULT_KEK` (e.g. a
 * local dev loop) keeps running; a warning logs once per process.
 *
 * In tests we synthesize a deterministic ephemeral KEK so the encrypt
 * path is exercised end-to-end without bleeding test secrets into
 * real env files.
 */

import crypto from 'node:crypto';

import { env } from '../config/index';
import { logger } from '../utils/logger';

const VERSION = 'v1';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

type KekState =
  | { kind: 'uninit' }
  | { kind: 'absent' }
  | { kind: 'present'; key: Buffer };

let kekState: KekState = { kind: 'uninit' };
let warnedAbsent = false;

function loadKek(): Buffer | null {
  if (kekState.kind === 'present') return kekState.key;
  if (kekState.kind === 'absent') return null;

  const raw = env.CREDENTIAL_VAULT_KEK;
  if (raw) {
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length !== KEY_LEN) {
      throw new Error(
        `CREDENTIAL_VAULT_KEK must decode to exactly ${KEY_LEN} bytes (got ${decoded.length}). Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
      );
    }
    kekState = { kind: 'present', key: decoded };
    return decoded;
  }

  if (env.NODE_ENV === 'test') {
    // Deterministic ephemeral KEK so tests exercise the crypto path
    // without leaking production secrets into test fixtures.
    const testKek = crypto
      .createHash('sha256')
      .update('clawnet-test-vault-kek')
      .digest();
    kekState = { kind: 'present', key: testKek };
    return testKek;
  }

  if (!warnedAbsent) {
    logger.warn(
      'CREDENTIAL_VAULT_KEK is not set — rotation secret keys fall back to plaintext base64. Set CREDENTIAL_VAULT_KEK (32 random bytes, base64) before any real rotation. See internal/active/rotation-battle-test-and-roadmap.md §1 P0.1.',
    );
    warnedAbsent = true;
  }
  kekState = { kind: 'absent' };
  return null;
}

/**
 * Test-only: reset the cached KEK so env changes between tests apply.
 * Never export this in production code paths.
 */
export function _resetVaultKekForTests(): void {
  kekState = { kind: 'uninit' };
  warnedAbsent = false;
}

/**
 * Encrypt a secret key. If no KEK is configured, returns a plain base64
 * string that `decryptSecret` will transparently handle as a legacy row.
 *
 * `aad` binds the ciphertext to a row context (credential_id, or
 * `${identityId}:next` for pre-committed next keys). Rebinding
 * ciphertext across contexts fails the AEAD auth tag on decrypt.
 */
export function encryptSecret(plaintext: Uint8Array, aad: string): string {
  const kek = loadKek();
  if (!kek) {
    return Buffer.from(plaintext).toString('base64');
  }
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob = Buffer.concat([iv, ct, tag]).toString('base64');
  return `${VERSION}:${blob}`;
}

/**
 * Decrypt a stored secret. Accepts both `v1:` wrapped blobs and legacy
 * plain base64 rows. Throws if the stored value claims to be `v1:` but
 * no KEK is configured, or the AEAD tag fails under the provided AAD.
 */
export function decryptSecret(stored: string, aad: string): Uint8Array {
  if (!stored.startsWith(`${VERSION}:`)) {
    // Legacy plaintext row — transparent upgrade on next rewrite.
    return new Uint8Array(Buffer.from(stored, 'base64'));
  }
  const kek = loadKek();
  if (!kek) {
    throw new Error(
      'vault-crypto: encountered v1 blob but CREDENTIAL_VAULT_KEK is not set',
    );
  }
  const blob = Buffer.from(stored.slice(VERSION.length + 1), 'base64');
  if (blob.length < IV_LEN + TAG_LEN) {
    throw new Error('vault-crypto: malformed v1 blob (too short)');
  }
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(blob.length - TAG_LEN);
  const ct = blob.subarray(IV_LEN, blob.length - TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', kek, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return new Uint8Array(pt);
}

/**
 * AAD helper: the context string bound into the ciphertext for a
 * `api_key_rotation_identities.next_secret_key` row.
 */
export function nextSecretAad(identityId: string): string {
  return `${identityId}:next`;
}
