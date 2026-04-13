/**
 * Unit tests — vault-crypto AES-256-GCM wrap for secrets at rest.
 *
 * Covers the four contract properties the module promises:
 *
 *   1. Round-trip: encrypt → decrypt yields the original plaintext.
 *   2. AAD binding: ciphertext decrypted under the wrong AAD fails.
 *   3. Legacy read-through: un-prefixed base64 still decodes, so
 *      adopting the wrapper needs no data migration.
 *   4. Malformed v1 blob (too short to contain iv + tag) is rejected.
 *
 * Tests run under NODE_ENV=test (vitest default), which makes
 * `loadKek()` synthesize a deterministic ephemeral KEK so the encrypt
 * path is exercised without requiring a real CREDENTIAL_VAULT_KEK in
 * CI.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  _resetVaultKekForTests,
  decryptSecret,
  encryptSecret,
  nextSecretAad,
} from '../../src/core/vault-crypto';

beforeEach(() => {
  _resetVaultKekForTests();
});

function randBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

describe('vault-crypto', () => {
  it('round-trips a secret with matching AAD', () => {
    const plaintext = randBytes(64);
    const blob = encryptSecret(plaintext, 'row-1');

    expect(blob.startsWith('v1:')).toBe(true);
    const decrypted = decryptSecret(blob, 'row-1');
    expect(Buffer.from(decrypted).equals(Buffer.from(plaintext))).toBe(true);
  });

  it('rejects decryption under a mismatched AAD', () => {
    const plaintext = randBytes(64);
    const blob = encryptSecret(plaintext, 'row-alpha');

    expect(() => decryptSecret(blob, 'row-beta')).toThrow();
  });

  it('reads legacy plain base64 rows without a v1: prefix', () => {
    // Simulates a row written before the vault wrapper shipped.
    const plaintext = randBytes(64);
    const legacyRow = Buffer.from(plaintext).toString('base64');

    const decoded = decryptSecret(legacyRow, 'row-legacy');
    expect(Buffer.from(decoded).equals(Buffer.from(plaintext))).toBe(true);
  });

  it('rejects a malformed v1 blob (too short for iv + tag)', () => {
    // v1: prefix but the inner payload is less than 12 (iv) + 16 (tag)
    // bytes — can't possibly contain a valid ciphertext.
    const tinyPayload = Buffer.from(new Uint8Array(4)).toString('base64');
    const malformed = `v1:${tinyPayload}`;

    expect(() => decryptSecret(malformed, 'row-1')).toThrow(/malformed v1/);
  });

  it('binds distinct AADs via the nextSecretAad helper', () => {
    // A ciphertext written against nextSecretAad('id-1') must not be
    // liftable into a slot bound to the bare 'id-1' context.
    const plaintext = randBytes(64);
    const blob = encryptSecret(plaintext, nextSecretAad('id-1'));

    expect(() => decryptSecret(blob, 'id-1')).toThrow();
    const decoded = decryptSecret(blob, nextSecretAad('id-1'));
    expect(Buffer.from(decoded).equals(Buffer.from(plaintext))).toBe(true);
  });
});
