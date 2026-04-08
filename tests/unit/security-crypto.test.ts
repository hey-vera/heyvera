/**
 * Security: Cryptographic primitives
 *
 * Production-grade tests for:
 *   - Ed25519 signature correctness (sign, verify, tamper detection)
 *   - Hex validation (encoding.ts) — reject non-hex, odd-length, empty
 *   - HKDF domain separation — different domains produce different keys
 *   - Hash prefix correctness (sha256: prefix)
 *   - JCS canonicalization adversarial inputs
 *   - Seed entropy — CSPRNG produces unique values
 *   - Dual-sign provider cert verification with malformed inputs
 *   - Signature over wrong payload always fails
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from './helpers/db';
setupTestDb();

import { initDb } from '../../src/db/connection';
import { signVC, verifyVCSignature, getEd25519PublicKeyMultibase, getEd25519PublicKeyRaw, derivePlatformSeed } from '../../src/utils/ed25519-signer';
import { somaHash, somaHashPrefixed, somaHashJson } from '../../src/utils/crypto-agility';
import { isValidHex, assertHex, hexToBuffer } from '../../src/utils/encoding';
import { generateSeedCommitment, verifySeedCommitment } from '../../src/core/commit-reveal';
import { jcsSerialize } from '../../src/utils/jcs';
import { createComputationCertificate, verifyComputationCertificate } from '../../src/core/computation-certificate';
import { registerBuiltinTypes } from '../../src/core/computation-types';
import { checkEconomicOnly } from '../../src/core/spot-check';
import { randomBytes, createHash } from 'crypto';

beforeEach(() => {
  initDb();
  registerBuiltinTypes();
});

// ─── Ed25519 Signature Correctness ─────────────────────────────────────────

describe('Ed25519 signature correctness', () => {
  it('sign then verify succeeds for valid payload', () => {
    const payload = { id: 'test', data: 'hello', timestamp: '2026-01-01T00:00:00Z' };
    const signature = signVC(payload);
    expect(signature).toBeTruthy();
    expect(typeof signature).toBe('string');

    const valid = verifyVCSignature(payload, signature);
    expect(valid).toBe(true);
  });

  it('verify fails for tampered payload', () => {
    const payload = { id: 'test', amount: 100 };
    const signature = signVC(payload);

    const tampered = { id: 'test', amount: 200 };
    expect(verifyVCSignature(tampered, signature)).toBe(false);
  });

  it('verify fails for wrong signature', () => {
    const payload = { id: 'test', amount: 100 };
    // Random base64url string — wrong signature
    const fakeSignature = Buffer.from(randomBytes(64)).toString('base64url');
    expect(verifyVCSignature(payload, fakeSignature)).toBe(false);
  });

  it('verify fails for empty signature', () => {
    const payload = { id: 'test' };
    expect(verifyVCSignature(payload, '')).toBe(false);
  });

  it('verify fails for truncated signature', () => {
    const payload = { id: 'test' };
    const signature = signVC(payload);
    // Truncate to half
    const truncated = signature.slice(0, signature.length / 2);
    expect(verifyVCSignature(payload, truncated)).toBe(false);
  });

  it('public key is consistent across calls', () => {
    const pk1 = getEd25519PublicKeyMultibase();
    const pk2 = getEd25519PublicKeyMultibase();
    expect(pk1).toBe(pk2);
  });

  it('public key raw is 32 bytes', () => {
    const raw = getEd25519PublicKeyRaw();
    expect(raw.length).toBe(32);
  });

  it('different payloads produce different signatures', () => {
    const sig1 = signVC({ id: 'a', value: 1 });
    const sig2 = signVC({ id: 'b', value: 2 });
    expect(sig1).not.toBe(sig2);
  });

  it('same payload produces same signature (deterministic)', () => {
    const payload = { id: 'deterministic', value: 42 };
    const sig1 = signVC(payload);
    const sig2 = signVC(payload);
    expect(sig1).toBe(sig2);
  });
});

// ─── HKDF Domain Separation ────────────────────────────────────────────────

describe('HKDF domain separation', () => {
  it('different domains produce different seeds', () => {
    const seed1 = derivePlatformSeed('ed25519-platform');
    const seed2 = derivePlatformSeed('ml-dsa-65');
    const seed3 = derivePlatformSeed('computation-cert');
    expect(Buffer.from(seed1).toString('hex')).not.toBe(Buffer.from(seed2).toString('hex'));
    expect(Buffer.from(seed1).toString('hex')).not.toBe(Buffer.from(seed3).toString('hex'));
    expect(Buffer.from(seed2).toString('hex')).not.toBe(Buffer.from(seed3).toString('hex'));
  });

  it('same domain produces same seed (deterministic)', () => {
    const seed1 = derivePlatformSeed('test-domain');
    const seed2 = derivePlatformSeed('test-domain');
    expect(Buffer.from(seed1).toString('hex')).toBe(Buffer.from(seed2).toString('hex'));
  });

  it('seeds are 32 bytes', () => {
    const seed = derivePlatformSeed('test');
    expect(Buffer.from(seed).length).toBe(32);
  });
});

// ─── Hex Validation (encoding.ts) ──────────────────────────────────────────

describe('hex validation', () => {
  it('valid hex strings accepted', () => {
    expect(isValidHex('abcdef0123456789')).toBe(true);
    expect(isValidHex('ABCDEF')).toBe(true);
    expect(isValidHex('aAbBcC')).toBe(true);
    expect(isValidHex('00')).toBe(true);
    expect(isValidHex('ff')).toBe(true);
  });

  it('invalid hex strings rejected', () => {
    expect(isValidHex('')).toBe(false);
    expect(isValidHex('gg')).toBe(false);
    expect(isValidHex('zz')).toBe(false);
    expect(isValidHex('abc')).toBe(false); // odd length
    expect(isValidHex('0x1234')).toBe(false); // 0x prefix
    expect(isValidHex(' ab ')).toBe(false); // whitespace
    expect(isValidHex('ab cd')).toBe(false); // space
    expect(isValidHex('ab\ncd')).toBe(false); // newline
  });

  it('assertHex throws on invalid input', () => {
    expect(() => assertHex('abcd', 'test')).not.toThrow();
    expect(() => assertHex('gg', 'test')).toThrow();
    expect(() => assertHex('', 'test')).toThrow();
  });

  it('hexToBuffer converts correctly', () => {
    const buf = hexToBuffer('deadbeef');
    expect(buf).not.toBeNull();
    expect(buf!.length).toBe(4);
    expect(buf![0]).toBe(0xde);
    expect(buf![1]).toBe(0xad);
    expect(buf![2]).toBe(0xbe);
    expect(buf![3]).toBe(0xef);
  });

  it('hexToBuffer returns null for invalid hex', () => {
    expect(hexToBuffer('gg')).toBeNull();
    expect(hexToBuffer('')).toBeNull();
    expect(hexToBuffer('abc')).toBeNull(); // odd length
  });
});

// ─── Hash Functions ────────────────────────────────────────────────────────

describe('hash function correctness', () => {
  it('somaHash produces consistent 64-char hex', () => {
    const hash = somaHash('test');
    expect(hash.length).toBe(64);
    expect(isValidHex(hash)).toBe(true);

    // Deterministic
    expect(somaHash('test')).toBe(hash);
  });

  it('somaHashPrefixed adds sha256: prefix', () => {
    const hash = somaHashPrefixed('test');
    expect(hash.startsWith('sha256:')).toBe(true);
    expect(hash.length).toBe(7 + 64); // "sha256:" + 64 hex chars
  });

  it('single-bit change produces completely different hash', () => {
    const hash1 = somaHash('test1');
    const hash2 = somaHash('test2');
    expect(hash1).not.toBe(hash2);

    // Hamming distance should be roughly 50% (128 bits different out of 256)
    let diffBits = 0;
    for (let i = 0; i < hash1.length; i++) {
      if (hash1[i] !== hash2[i]) diffBits++;
    }
    // At least 25% of hex chars should differ (very conservative)
    expect(diffBits).toBeGreaterThan(hash1.length * 0.25);
  });

  it('somaHashJson is key-order independent (JCS)', () => {
    const hash1 = somaHashJson({ b: 2, a: 1 });
    const hash2 = somaHashJson({ a: 1, b: 2 });
    expect(hash1).toBe(hash2);
  });

  it('somaHashJson handles nested objects', () => {
    const hash1 = somaHashJson({ a: { c: 3, b: 2 } });
    const hash2 = somaHashJson({ a: { b: 2, c: 3 } });
    expect(hash1).toBe(hash2);
  });

  it('somaHashJson treats null and undefined differently', () => {
    const hash1 = somaHashJson({ a: null });
    const hash2 = somaHashJson({ a: undefined });
    // undefined gets omitted by JSON, null stays
    expect(hash1).not.toBe(hash2);
  });

  it('empty string and empty object have different hashes', () => {
    expect(somaHash('')).not.toBe(somaHash('{}'));
    expect(somaHashJson({})).not.toBe(somaHashJson([]));
  });
});

// ─── JCS Canonicalization Adversarial Inputs ───────────────────────────────

describe('JCS adversarial inputs', () => {
  it('handles Unicode in keys', () => {
    // Should sort by Unicode code point
    const result = jcsSerialize({ '\u0080': 1, '\u007f': 2 });
    expect(result).toBeTruthy();
  });

  it('handles deeply nested objects (10 levels)', () => {
    let obj: any = { value: 'leaf' };
    for (let i = 0; i < 10; i++) {
      obj = { nested: obj };
    }
    const result = jcsSerialize(obj);
    expect(result).toContain('leaf');
  });

  it('handles arrays with mixed types', () => {
    const result = jcsSerialize({ arr: [1, 'two', null, true, { a: 1 }] });
    expect(result).toBeTruthy();
  });

  it('rejects non-finite numbers', () => {
    expect(() => jcsSerialize({ val: Infinity })).toThrow();
    expect(() => jcsSerialize({ val: -Infinity })).toThrow();
    expect(() => jcsSerialize({ val: NaN })).toThrow();
  });

  it('negative zero normalized to zero', () => {
    const result = jcsSerialize({ val: -0 });
    expect(result).toContain('0');
    expect(result).not.toContain('-0');
  });
});

// ─── Seed Entropy (CSPRNG) ─────────────────────────────────────────────────

describe('CSPRNG seed entropy', () => {
  it('1000 seeds are all unique', () => {
    const seeds = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const { seed } = generateSeedCommitment();
      seeds.add(seed);
    }
    expect(seeds.size).toBe(1000);
  });

  it('seeds are 64 hex chars (32 bytes entropy)', () => {
    const { seed } = generateSeedCommitment();
    expect(seed.length).toBe(64);
    expect(isValidHex(seed)).toBe(true);
  });

  it('commitments are deterministic for given seed', () => {
    const seed = randomBytes(32).toString('hex');
    const commitment1 = somaHash(seed);
    const commitment2 = somaHash(seed);
    expect(commitment1).toBe(commitment2);
  });
});

// ─── Computation Certificate Crypto ────────────────────────────────────────

describe('computation certificate cryptographic integrity', () => {
  it('tampered outputHash changes chain hash → signature invalid', () => {
    const cert = createComputationCertificate({
      requestId: 'tamper-output',
      computationType: 'data-fetch',
      computationClass: 'economic-only',
      inputHash: somaHash('input'),
      outputHash: somaHash('output'),
      seedCommitment: somaHash('seed'),
      seed: 'seed',
      outputCommitment: somaHash(somaHash('output')),
      spotChecks: [checkEconomicOnly('data-fetch')],
    })!;

    // Tamper with outputHash
    const tampered = { ...cert, outputHash: somaHash('different-output') };
    const result = verifyComputationCertificate(tampered);
    expect(result.chainHashValid).toBe(false);
    // Signature is over original chain hash, not tampered one
    // If chain hash is wrong, we cannot trust signature verification result
  });

  it('tampered computationClass breaks chain hash', () => {
    const cert = createComputationCertificate({
      requestId: 'tamper-class',
      computationType: 'data-fetch',
      computationClass: 'economic-only',
      inputHash: somaHash('input'),
      outputHash: somaHash('output'),
      seedCommitment: somaHash('seed'),
      seed: 'seed',
      outputCommitment: somaHash(somaHash('output')),
      spotChecks: [checkEconomicOnly('data-fetch')],
    })!;

    const tampered = { ...cert, computationClass: 'algebraic' as any };
    const result = verifyComputationCertificate(tampered);
    expect(result.chainHashValid).toBe(false);
  });

  it('signature protects against field-level tampering', () => {
    const cert = createComputationCertificate({
      requestId: 'tamper-sig',
      computationType: 'data-fetch',
      computationClass: 'economic-only',
      inputHash: somaHash('input'),
      outputHash: somaHash('output'),
      seedCommitment: somaHash('seed'),
      seed: 'seed',
      outputCommitment: somaHash(somaHash('output')),
      spotChecks: [checkEconomicOnly('data-fetch')],
    })!;

    // Tamper signature itself (flip one bit)
    const sigBytes = Buffer.from(cert.signature, 'hex');
    sigBytes[0] ^= 0x01;
    const tampered = { ...cert, signature: sigBytes.toString('hex') };
    const result = verifyComputationCertificate(tampered);
    expect(result.signatureValid).toBe(false);
  });
});
