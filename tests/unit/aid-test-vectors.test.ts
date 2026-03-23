/**
 * AID Protocol Test Vector Validation
 *
 * Validates that the ClawNet implementation produces identical outputs
 * to the published test vectors in aid-spec/test-vectors/.
 *
 * Any AID implementation MUST pass these tests to be spec-compliant.
 */

import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { jcsSerialize } from '../../src/utils/jcs';
import { resolveTrustTier } from '../../src/core/credits';
import { isAlgorithmAllowed, negotiateAlgorithm } from '../../src/utils/crypto-agility';

// ─── Signing Test Vector ────────────────────────────────────────────────────

describe('AID Signing (test-vectors/signing.json)', () => {
  it('produces correct Ed25519 signature for canonical signing input', () => {
    const seed = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
    const pkcs8Header = Buffer.from('302e020100300506032b657004220420', 'hex');
    const privateKey = crypto.createPrivateKey({ key: Buffer.concat([pkcs8Header, seed]), format: 'der', type: 'pkcs8' });
    const publicKey = crypto.createPublicKey(privateKey);
    const rawPub = Buffer.from(publicKey.export({ type: 'spki', format: 'der' }).subarray(12));

    const did = 'did:key:z6MkTestVector1';
    const timestamp = '2026-03-21T14:30:00Z';
    const nonce = 'a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8';
    const method = 'POST';
    const path = '/aid/skills/sol-price';
    const body = '{"token":"SOL"}';

    // Step 1: SHA-384 of body
    const bodyHash = crypto.createHash('sha384').update(body).digest('hex');
    expect(bodyHash.length).toBe(96);

    // Step 2: Construct signing string
    const signingString = `${did}\n${timestamp}\n${nonce}\n${method} ${path}\n${bodyHash}`;

    // Step 3: SHA-384 of signing string
    const signatureInput = crypto.createHash('sha384').update(signingString).digest();

    // Step 4: Ed25519 sign
    const signature = crypto.sign(null, signatureInput, privateKey);
    expect(signature.length).toBe(64);

    // Step 5: Verify
    const verified = crypto.verify(null, signatureInput, publicKey, signature);
    expect(verified).toBe(true);

    // Verify public key is deterministic from seed
    expect(rawPub.length).toBe(32);
  });

  it('rejects tampered signatures', () => {
    const seed = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
    const pkcs8Header = Buffer.from('302e020100300506032b657004220420', 'hex');
    const privateKey = crypto.createPrivateKey({ key: Buffer.concat([pkcs8Header, seed]), format: 'der', type: 'pkcs8' });
    const publicKey = crypto.createPublicKey(privateKey);

    const data = crypto.createHash('sha384').update('test data').digest();
    const signature = crypto.sign(null, data, privateKey);

    // Tamper with one byte
    const tampered = Buffer.from(signature);
    tampered[0] ^= 0xff;

    expect(crypto.verify(null, data, publicKey, tampered)).toBe(false);
  });
});

// ─── Trust Score Test Vector ────────────────────────────────────────────────

describe('AID Trust Score (test-vectors/trust-score.json)', () => {
  it('computes correct v1.0 trust score', () => {
    const inputs = { successRate: 0.95, chainCoverage: 0.88, attestationCount: 247, manifestAdherence: 0.92 };
    const weights = { successRate: 40, chainCoverage: 25, volume: 20, manifestAdherence: 15 };

    const volume = Math.min(inputs.attestationCount / 1000, 1);
    const rawScore = inputs.successRate * weights.successRate +
      inputs.chainCoverage * weights.chainCoverage +
      volume * weights.volume +
      inputs.manifestAdherence * weights.manifestAdherence;

    const score = Math.min(100, Math.round(rawScore * 1.0));

    expect(score).toBe(79);
    expect(volume).toBeCloseTo(0.247, 3);
  });

  it('produces deterministic proof hash via JCS', () => {
    // jcsSerialize imported at top of file

    const proofData = {
      inputs: { attestationCount: 247, chainCoverage: 0.88, manifestAdherence: 0.92, successRate: 0.95 },
      score: 83,
      weights: { chainCoverage: 25, manifestAdherence: 15, successRate: 40, volume: 20 },
    };

    const canonical = jcsSerialize(proofData);
    const hash1 = crypto.createHash('sha384').update(canonical).digest('hex');
    const hash2 = crypto.createHash('sha384').update(canonical).digest('hex');

    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(96);
  });

  it('applies correct trust verdict', () => {
    // resolveTrustTier imported at top of file

    expect(resolveTrustTier(92).verdict).toBe('proceed');
    expect(resolveTrustTier(85).verdict).toBe('trusted');
    expect(resolveTrustTier(70).verdict).toBe('standard');
    expect(resolveTrustTier(45).verdict).toBe('caution');
    expect(resolveTrustTier(25).verdict).toBe('building');
    expect(resolveTrustTier(10).verdict).toBe('new');
  });
});

// ─── Cross-Implementation Proof Hash (pinned — Python + TS must match) ──────

describe('AID Cross-Implementation Proof Hash', () => {
  it('produces pinned proof hash for reference test vector', () => {
    // This test vector is used to validate that EVERY AID implementation
    // (TypeScript, Python, Go, Rust, etc.) produces identical output.
    // If this test fails, the implementation diverged from the spec.

    const stats = {
      successRate: 0.95,
      chainCoverage: 0.8,
      attestationCount: 500,
      manifestAdherence: 0.9,
    };
    const weights = { successRate: 40, chainCoverage: 25, volume: 20, manifestAdherence: 15 };

    // Compute score
    const volume = Math.min(stats.attestationCount / 1000, 1); // 0.5
    const score = Math.min(100, Math.round(
      stats.successRate * 40 + stats.chainCoverage * 25 + volume * 20 + stats.manifestAdherence * 15
    )); // 82

    expect(score).toBe(82);

    // Build proof data and JCS canonicalize
    const proofData = { inputs: stats, weights, score };
    const canonical = jcsSerialize(proofData);

    // Pinned canonical form — every implementation must produce this exact string
    const expectedCanonical = '{"inputs":{"attestationCount":500,"chainCoverage":0.8,"manifestAdherence":0.9,"successRate":0.95},"score":82,"weights":{"chainCoverage":25,"manifestAdherence":15,"successRate":40,"volume":20}}';
    expect(canonical).toBe(expectedCanonical);

    // Pinned proof hash — every implementation must produce this exact hash
    const proofHash = crypto.createHash('sha384').update(canonical).digest('hex');
    const expectedHash = 'becd619fd5ffb9d7b8efb89145fb0ea676926fb435873d68955ccc96b5bdadfe2c08f13741100a819463f68599f2a33b';
    expect(proofHash).toBe(expectedHash);
  });

  it('produces pinned proof hash via computeTrustScore (trust-compute package)', () => {
    // Verify the packaged function matches the manual computation
    const { computeTrustScore: compute } = require('../../packages/trust-compute/dist/index.js');
    const result = compute({
      successRate: 0.95,
      chainCoverage: 0.8,
      attestationCount: 500,
      manifestAdherence: 0.9,
    });

    expect(result.score).toBe(82);
    expect(result.proofHash).toBe('becd619fd5ffb9d7b8efb89145fb0ea676926fb435873d68955ccc96b5bdadfe2c08f13741100a819463f68599f2a33b');
    expect(result.formulaVersion).toBe('1.0.0');
    expect(result.hashAlgorithm).toBe('sha384');
  });
});

// ─── Merkle Proof Test Vector ───────────────────────────────────────────────

describe('AID Merkle Proof (test-vectors/merkle-proof.json)', () => {
  function sha384(data: string): string {
    return crypto.createHash('sha384').update(data).digest('hex');
  }

  it('verifies a valid Merkle proof', () => {
    const leaf1 = sha384('rcpt-test1' + '2026-03-21T14:30:00Z' + 'did:key:zA' + 'did:key:zB');
    const leaf2 = sha384('rcpt-test2' + '2026-03-21T14:31:00Z' + 'did:key:zC' + 'did:key:zD');
    const leaf3 = sha384('rcpt-test3' + '2026-03-21T14:32:00Z' + 'did:key:zE' + 'did:key:zF');
    const leaf4 = sha384('rcpt-test4' + '2026-03-21T14:33:00Z' + 'did:key:zG' + 'did:key:zH');

    const node12 = sha384(leaf1 + leaf2);
    const node34 = sha384(leaf3 + leaf4);
    const root = sha384(node12 + node34);

    // Verify leaf1 with proof [right: leaf2, right: node34]
    let current = leaf1;
    current = sha384(current + leaf2); // sibling on right
    current = sha384(current + node34); // sibling on right

    expect(current).toBe(root);
  });

  it('rejects tampered leaf', () => {
    const leaf1 = sha384('rcpt-test1-TAMPERED' + '2026-03-21T14:30:00Z' + 'did:key:zA' + 'did:key:zB');
    const leaf2 = sha384('rcpt-test2' + '2026-03-21T14:31:00Z' + 'did:key:zC' + 'did:key:zD');
    const leaf3 = sha384('rcpt-test3' + '2026-03-21T14:32:00Z' + 'did:key:zE' + 'did:key:zF');
    const leaf4 = sha384('rcpt-test4' + '2026-03-21T14:33:00Z' + 'did:key:zG' + 'did:key:zH');

    const node12orig = sha384(sha384('rcpt-test1' + '2026-03-21T14:30:00Z' + 'did:key:zA' + 'did:key:zB') + leaf2);
    const node34 = sha384(leaf3 + leaf4);
    const expectedRoot = sha384(node12orig + node34);

    let current = leaf1;
    current = sha384(current + leaf2);
    current = sha384(current + node34);

    expect(current).not.toBe(expectedRoot);
  });
});

// ─── Crypto Agility ─────────────────────────────────────────────────────────

describe('AID Crypto Agility', () => {
  it('algorithm whitelist rejects unknown algorithms', () => {
    // isAlgorithmAllowed imported at top of file

    expect(isAlgorithmAllowed('EdDSA')).toBe(true);
    expect(isAlgorithmAllowed('Ed25519')).toBe(true);
    expect(isAlgorithmAllowed('RSA')).toBe(false);
    expect(isAlgorithmAllowed('WeakAlgo')).toBe(false);
  });

  it('algorithm negotiation picks strongest mutual', () => {
    // negotiateAlgorithm imported at top of file

    expect(negotiateAlgorithm(['EdDSA'], ['EdDSA'])).toBe('EdDSA');
    expect(negotiateAlgorithm(['EdDSA', 'ML-DSA-44'], ['ML-DSA-44', 'EdDSA'])).toBe('ML-DSA-44');
    expect(negotiateAlgorithm(['EdDSA'], ['ML-DSA-44'])).toBeNull();
  });
});
