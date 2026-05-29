/**
 * Credential vault — AES-256-GCM wrap for secrets at rest.
 *
 * Pure-library module: nothing in the request path imports this yet.
 * It exists so that upcoming work (rotation-backed API keys, wallet
 * key storage, etc.) can wrap stored secrets in a single reviewed
 * primitive instead of reinventing AEAD framing per call site.
 *
 * Storage format:
 *
 *   "v1:" || base64(iv || ciphertext || tag)
 *
 *   - iv:       12 bytes, random per encryption (GCM standard)
 *   - tag:      16 bytes AEAD auth tag
 *   - aad:      UTF-8 context string bound into the ciphertext — the
 *               caller supplies e.g. the row id, so pasting ciphertext
 *               from one row into another fails auth on decrypt.
 *
 * Legacy plaintext base64 rows are still accepted on read, so this
 * module can be adopted without a data migration: any pre-existing
 * plain-b64 value keeps decoding, and the first call that rewrites
 * it will emit a v1-wrapped blob.
 *
 * Key source: the KEK is read from `env.CREDENTIAL_VAULT_KEK` as a
 * base64-encoded 32-byte buffer. If the KEK is not configured at all,
 * `encryptSecret` falls back to a plain-base64 passthrough and logs a
 * one-time warning — this keeps local-dev loops working without
 * forcing every operator to provision a KEK on day one. `decryptSecret`
 * will still refuse to unwrap a `v1:` blob when the KEK is absent.
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
      'CREDENTIAL_VAULT_KEK is not set — vault-crypto falls back to plaintext base64. Set CREDENTIAL_VAULT_KEK (32 random bytes, base64) before storing any sensitive secret.',
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
 * Encrypt a secret. If no KEK is configured, returns a plain base64
 * string that `decryptSecret` will transparently handle as a legacy row.
 *
 * `aad` binds the ciphertext to a row context (caller-supplied string
 * — typically a row id). Rebinding ciphertext across contexts fails
 * the AEAD auth tag on decrypt.
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
 * AAD helper: context string for a "next" secret slot bound to an
 * identity id. Used by callers that store both a current and a
 * pre-committed next secret for the same identity and want the two
 * ciphertexts to be non-interchangeable.
 */
export function nextSecretAad(identityId: string): string {
  return `${identityId}:next`;
}
