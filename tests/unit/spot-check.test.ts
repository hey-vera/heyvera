/**
 * Spot-check tests — Heartbeat Fraud Proofs Phase A
 *
 * Verifies:
 *   - Commit-reveal protocol (seed commitment, verification, reveal)
 *   - Deterministic index derivation from committed seed
 *   - Sort verification catches: wrong order, missing elements, added elements
 *   - Filter verification catches: wrong elements, omitted elements
 *   - Dedup verification catches: duplicates, missing uniques, phantom elements
 *   - Aggregation checks: sum, count, min/max
 *   - Freivalds algorithm: correct matrix multiply passes, wrong result caught
 *   - Approximate check: within/outside tolerance
 *   - Economic-only passthrough
 *   - Multiset hash: order-independent, collision-resistant
 *   - Computation type taxonomy: registration, validation, detection probability
 *   - Computation certificate: create, verify, round-trip
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from './helpers/db';
setupTestDb();

import { initDb } from '../../src/db/connection';

import {
  generateSeedCommitment,
  verifySeedCommitment,
  revealSeed,
  deriveCheckIndices,
  deriveFreivaldsRandom,
} from '../../src/core/commit-reveal';

import {
  checkSort,
  checkFilter,
  checkDedup,
  checkSum,
  checkCount,
  checkMinMax,
  checkFreivalds,
  checkApproximate,
  checkEconomicOnly,
  msetXorHash,
} from '../../src/core/spot-check';

import {
  registerComputationType,
  getComputationType,
  detectionProbability,
  registerBuiltinTypes,
} from '../../src/core/computation-types';

import {
  createComputationCertificate,
  verifyComputationCertificate,
  getComputationCertificate,
} from '../../src/core/computation-certificate';

import { somaHash } from '../../src/utils/crypto-agility';

beforeEach(() => {
  initDb();
});

// ── Commit-Reveal Protocol ────────────────────────────────────────────────

describe('commit-reveal protocol', () => {
  it('generates a valid seed commitment', () => {
    const sc = generateSeedCommitment();
    expect(sc.seed).toHaveLength(64); // 32 bytes hex
    expect(sc.commitment).toHaveLength(64); // SHA-256 hex
    expect(sc.createdAt).toBeTruthy();
  });

  it('commitment verifies against the seed', () => {
    const sc = generateSeedCommitment();
    expect(verifySeedCommitment(sc.seed, sc.commitment)).toBe(true);
  });

  it('wrong seed fails commitment verification', () => {
    const sc = generateSeedCommitment();
    const sc2 = generateSeedCommitment();
    expect(verifySeedCommitment(sc2.seed, sc.commitment)).toBe(false);
  });

  it('reveal captures output commitment and verifies', () => {
    const sc = generateSeedCommitment();
    const outputHash = somaHash('test output');
    const revealed = revealSeed(sc, outputHash);

    expect(revealed.seed).toBe(sc.seed);
    expect(revealed.commitment).toBe(sc.commitment);
    expect(revealed.outputCommitment).toBe(outputHash);
    expect(revealed.verified).toBe(true);
  });

  it('deriveCheckIndices is deterministic', () => {
    const seed = generateSeedCommitment().seed;
    const a = deriveCheckIndices(seed, 'test', 5, 100);
    const b = deriveCheckIndices(seed, 'test', 5, 100);
    expect(a).toEqual(b);
  });

  it('different domains produce different indices', () => {
    const seed = generateSeedCommitment().seed;
    const a = deriveCheckIndices(seed, 'domain-a', 5, 1000);
    const b = deriveCheckIndices(seed, 'domain-b', 5, 1000);
    expect(a).not.toEqual(b);
  });

  it('deriveFreivaldsRandom returns values in [1, prime-1]', () => {
    const seed = generateSeedCommitment().seed;
    const prime = 2147483647;
    for (let i = 0; i < 100; i++) {
      const val = deriveFreivaldsRandom(seed, 0, i, prime);
      expect(val).toBeGreaterThanOrEqual(1);
      expect(val).toBeLessThan(prime);
    }
  });
});

// ── Multiset Hash ─────────────────────────────────────────────────────────

describe('msetXorHash', () => {
  it('is order-independent', () => {
    const key = generateSeedCommitment().seed;
    const a = msetXorHash([1, 2, 3], key);
    const b = msetXorHash([3, 1, 2], key);
    expect(a).toBe(b);
  });

  it('different multisets produce different hashes', () => {
    const key = generateSeedCommitment().seed;
    const a = msetXorHash([1, 2, 3], key);
    const b = msetXorHash([1, 2, 4], key);
    expect(a).not.toBe(b);
  });

  it('detects duplicate elements (multiset not set)', () => {
    const key = generateSeedCommitment().seed;
    const a = msetXorHash([1, 2, 3], key);
    const b = msetXorHash([1, 2, 3, 3], key);
    // XOR: 3 XOR 3 = 0, so [1,2,3,3] has different hash than [1,2,3]
    // Actually for XOR, duplicate pairs cancel. Let's verify:
    // msetXorHash([1,2,3]) XOR msetXorHash([1,2,3,3,3]) would be tricky
    // But [1,2,3] vs [1,2,3,3] — the extra 3 XORs once more, changing the hash
    expect(a).not.toBe(b);
  });
});

// ── Sort Check ────────────────────────────────────────────────────────────

describe('checkSort', () => {
  const seed = 'a'.repeat(64);

  it('passes for correctly sorted output', () => {
    const input = [3, 1, 4, 1, 5, 9];
    const output = [1, 1, 3, 4, 5, 9];
    const result = checkSort(input, output, seed);
    expect(result.passed).toBe(true);
    expect(result.detectionProbability).toBe(1.0);
  });

  it('fails for wrong order', () => {
    const input = [3, 1, 4];
    const output = [3, 1, 4]; // not sorted
    const result = checkSort(input, output, seed);
    expect(result.passed).toBe(false);
    expect(result.checkName).toBe('sort-order');
  });

  it('fails when elements are added', () => {
    const input = [3, 1];
    const output = [1, 3, 5]; // extra element
    const result = checkSort(input, output, seed);
    expect(result.passed).toBe(false);
    expect(result.checkName).toBe('sort-multiset');
  });

  it('fails when elements are removed', () => {
    const input = [3, 1, 2];
    const output = [1, 3]; // missing 2
    const result = checkSort(input, output, seed);
    expect(result.passed).toBe(false);
  });

  it('handles empty arrays', () => {
    const result = checkSort([], [], seed);
    expect(result.passed).toBe(true);
  });
});

// ── Filter Check ──────────────────────────────────────────────────────────

describe('checkFilter', () => {
  const seed = 'b'.repeat(64);
  const isEven = (x: unknown) => typeof x === 'number' && x % 2 === 0;

  it('passes for correct filter', () => {
    const input = [1, 2, 3, 4, 5, 6];
    const output = [2, 4, 6];
    const result = checkFilter(input, output, isEven, seed);
    expect(result.passed).toBe(true);
  });

  it('fails when output includes non-matching elements', () => {
    const input = [1, 2, 3, 4];
    const output = [2, 3, 4]; // 3 is odd
    const result = checkFilter(input, output, isEven, seed);
    expect(result.passed).toBe(false);
    expect(result.checkName).toBe('filter-predicate');
  });

  it('fails when matching elements are omitted', () => {
    const input = [1, 2, 3, 4];
    const output = [2]; // missing 4
    const result = checkFilter(input, output, isEven, seed);
    expect(result.passed).toBe(false);
    expect(result.checkName).toBe('filter-completeness');
  });
});

// ── Dedup Check ───────────────────────────────────────────────────────────

describe('checkDedup', () => {
  const seed = 'c'.repeat(64);

  it('passes for correct dedup', () => {
    const input = [1, 2, 2, 3, 3, 3];
    const output = [1, 2, 3];
    const result = checkDedup(input, output, seed);
    expect(result.passed).toBe(true);
  });

  it('fails when output has duplicates', () => {
    const input = [1, 2, 2];
    const output = [1, 2, 2];
    const result = checkDedup(input, output, seed);
    expect(result.passed).toBe(false);
    expect(result.checkName).toBe('dedup-uniqueness');
  });

  it('fails when output has phantom elements', () => {
    const input = [1, 2];
    const output = [1, 2, 3]; // 3 not in input
    const result = checkDedup(input, output, seed);
    expect(result.passed).toBe(false);
    expect(result.checkName).toBe('dedup-subset');
  });

  it('fails when unique elements are missing', () => {
    const input = [1, 2, 3];
    const output = [1, 2]; // missing 3
    const result = checkDedup(input, output, seed);
    expect(result.passed).toBe(false);
    expect(result.checkName).toBe('dedup-completeness');
  });
});

// ── Aggregation Checks ────────────────────────────────────────────────────

describe('aggregation checks', () => {
  it('checkSum passes for correct sum', () => {
    expect(checkSum([1, 2, 3, 4, 5], 15).passed).toBe(true);
  });

  it('checkSum fails for wrong sum', () => {
    const result = checkSum([1, 2, 3], 7);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('Expected 6');
  });

  it('checkCount passes for correct count', () => {
    expect(checkCount([1, 2, 3], 3).passed).toBe(true);
  });

  it('checkCount fails for wrong count', () => {
    expect(checkCount([1, 2, 3], 4).passed).toBe(false);
  });

  it('checkMinMax passes for correct min/max', () => {
    expect(checkMinMax([3, 1, 4, 1, 5], 1, 5).passed).toBe(true);
  });

  it('checkMinMax fails for wrong min', () => {
    expect(checkMinMax([3, 1, 4], 2, 4).passed).toBe(false);
  });

  it('checkMinMax fails for wrong max', () => {
    expect(checkMinMax([3, 1, 4], 1, 3).passed).toBe(false);
  });
});

// ── Freivalds Algorithm ───────────────────────────────────────────────────

describe('checkFreivalds', () => {
  const seed = 'd'.repeat(64);

  it('passes for correct matrix multiplication', () => {
    // A = [[1, 2], [3, 4]], B = [[5, 6], [7, 8]]
    // C = A × B = [[19, 22], [43, 50]]
    const A = [[1, 2], [3, 4]];
    const B = [[5, 6], [7, 8]];
    const C = [[19, 22], [43, 50]];

    const result = checkFreivalds(A, B, C, seed, 20);
    expect(result.passed).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.999);
  });

  it('fails for wrong matrix multiplication', () => {
    const A = [[1, 2], [3, 4]];
    const B = [[5, 6], [7, 8]];
    const C = [[19, 22], [43, 51]]; // Wrong: should be 50

    const result = checkFreivalds(A, B, C, seed, 20);
    expect(result.passed).toBe(false);
  });

  it('fails for dimension mismatch', () => {
    const A = [[1, 2], [3, 4]];
    const B = [[5, 6], [7, 8]];
    const C = [[19, 22]]; // Wrong dimensions

    const result = checkFreivalds(A, B, C, seed);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('Dimension mismatch');
  });

  it('handles 1×1 matrices', () => {
    const result = checkFreivalds([[3]], [[7]], [[21]], seed);
    expect(result.passed).toBe(true);
  });

  it('handles 3×3 identity multiplication', () => {
    const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const A = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
    const result = checkFreivalds(I, A, A, seed);
    expect(result.passed).toBe(true);
  });
});

// ── Approximate Check ─────────────────────────────────────────────────────

describe('checkApproximate', () => {
  it('passes within tolerance', () => {
    expect(checkApproximate(3.14159, 3.14159265, 0.001).passed).toBe(true);
  });

  it('fails outside tolerance', () => {
    const result = checkApproximate(3.14, 3.15, 0.001);
    expect(result.passed).toBe(false);
  });
});

// ── Economic-Only ─────────────────────────────────────────────────────────

describe('checkEconomicOnly', () => {
  it('always passes with 0 confidence', () => {
    const result = checkEconomicOnly('ml-inference');
    expect(result.passed).toBe(true);
    expect(result.confidence).toBe(0);
    expect(result.detectionProbability).toBe(0);
  });
});

// ── Computation Type Taxonomy ─────────────────────────────────────────────

describe('computation type taxonomy', () => {
  it('registers and retrieves built-in types', () => {
    registerBuiltinTypes();
    const sort = getComputationType('sort');
    expect(sort).not.toBeNull();
    expect(sort!.class).toBe('structural');
    expect(sort!.probabilityModel).toBe('full-scan');
  });

  it('calculates correct detection probability for algebraic class', () => {
    registerBuiltinTypes();
    const mm = getComputationType('matrix-multiply');
    expect(mm).not.toBeNull();
    const p = detectionProbability(mm!);
    // 20 trials → 1 - 2^(-20) ≈ 0.999999
    expect(p).toBeGreaterThan(0.999);
  });

  it('structural and aggregation classes have detection probability 1.0', () => {
    registerBuiltinTypes();
    expect(detectionProbability(getComputationType('sort')!)).toBe(1.0);
    expect(detectionProbability(getComputationType('sum')!)).toBe(1.0);
  });

  it('economic-only has detection probability 0.0', () => {
    registerBuiltinTypes();
    expect(detectionProbability(getComputationType('ml-inference')!)).toBe(0.0);
  });

  it('rejects mismatched class/probabilityModel', () => {
    expect(() => registerComputationType({
      id: 'bad',
      name: 'Bad',
      class: 'algebraic',
      probabilityModel: 'full-scan', // wrong for algebraic
    })).toThrow('requires probabilityModel');
  });

  it('requires epsilon for approximate class', () => {
    expect(() => registerComputationType({
      id: 'bad-approx',
      name: 'Bad Approx',
      class: 'approximate',
      probabilityModel: 'tolerance',
    })).toThrow('epsilon');
  });
});

// ── Computation Certificate ───────────────────────────────────────────────

describe('computation certificate', () => {
  it('creates and verifies a valid certificate', () => {
    const sc = generateSeedCommitment();
    const inputHash = somaHash('input data');
    const outputHash = somaHash('sorted output');
    const outputCommitment = somaHash(outputHash);

    const cert = createComputationCertificate({
      requestId: 'req-test-123',
      computationType: 'sort',
      computationClass: 'structural',
      inputHash,
      outputHash,
      seedCommitment: sc.commitment,
      seed: sc.seed,
      outputCommitment,
      spotChecks: [{
        checkName: 'sort',
        passed: true,
        confidence: 1.0,
        probabilityModel: 'full-scan',
        detectionProbability: 1.0,
      }],
      birthCertHash: somaHash('birth-cert'),
    });

    expect(cert).not.toBeNull();
    expect(cert!.allSpotChecksPassed).toBe(true);
    expect(cert!.chainHash).toHaveLength(64);

    // Verify
    const v = verifyComputationCertificate(cert!);
    expect(v.signatureValid).toBe(true);
    expect(v.chainHashValid).toBe(true);
    expect(v.seedCommitmentValid).toBe(true);
  });

  it('refuses to certify failed spot-checks', () => {
    const sc = generateSeedCommitment();
    const cert = createComputationCertificate({
      requestId: 'req-fail',
      computationType: 'sort',
      computationClass: 'structural',
      inputHash: somaHash('in'),
      outputHash: somaHash('out'),
      seedCommitment: sc.commitment,
      seed: sc.seed,
      outputCommitment: somaHash(somaHash('out')),
      spotChecks: [{
        checkName: 'sort-order',
        passed: false,
        confidence: 1.0,
        probabilityModel: 'full-scan',
        detectionProbability: 1.0,
        detail: 'Output not sorted',
      }],
    });

    expect(cert).toBeNull();
  });

  it('persists to DB and can be retrieved', () => {
    const sc = generateSeedCommitment();
    const requestId = 'req-persist-' + Date.now();

    const cert = createComputationCertificate({
      requestId,
      computationType: 'sum',
      computationClass: 'aggregation',
      inputHash: somaHash('[1,2,3]'),
      outputHash: somaHash('6'),
      seedCommitment: sc.commitment,
      seed: sc.seed,
      outputCommitment: somaHash(somaHash('6')),
      spotChecks: [{
        checkName: 'sum',
        passed: true,
        confidence: 1.0,
        probabilityModel: 'exact',
        detectionProbability: 1.0,
      }],
    });

    expect(cert).not.toBeNull();

    // Retrieve from DB
    const retrieved = getComputationCertificate(requestId);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(cert!.id);
    expect(retrieved!.computationType).toBe('sum');
    expect(retrieved!.allSpotChecksPassed).toBe(true);
    expect(retrieved!.spotChecks).toHaveLength(1);
    expect(retrieved!.chainHash).toBe(cert!.chainHash);
  });

  it('detects tampered chain hash', () => {
    const sc = generateSeedCommitment();
    const cert = createComputationCertificate({
      requestId: 'req-tamper',
      computationType: 'count',
      computationClass: 'aggregation',
      inputHash: somaHash('data'),
      outputHash: somaHash('3'),
      seedCommitment: sc.commitment,
      seed: sc.seed,
      outputCommitment: somaHash(somaHash('3')),
      spotChecks: [{
        checkName: 'count',
        passed: true,
        confidence: 1.0,
        probabilityModel: 'exact',
        detectionProbability: 1.0,
      }],
    });

    expect(cert).not.toBeNull();

    // Tamper with the chain hash
    const tampered = { ...cert!, chainHash: 'ff' + cert!.chainHash.slice(2) };
    const v = verifyComputationCertificate(tampered);
    expect(v.chainHashValid).toBe(false);
    expect(v.signatureValid).toBe(false); // signature is over original chain hash
  });
});
