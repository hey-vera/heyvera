/**
 * Security: Input validation & injection defense
 *
 * Production-grade tests for:
 *   - SQL injection patterns against parameterized queries
 *   - Malformed hex in provider certificates (dual-sign)
 *   - Provider cert with wrong key/sig lengths
 *   - Oversized inputs to hash functions
 *   - JCS serialization with adversarial payloads
 *   - Computation cert creation with boundary inputs
 *   - Spot-check with adversarial data (Freivalds, sort, filter, dedup)
 *   - Commit-reveal with forged seeds
 *   - Dual-sign chain hash tampering
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from './helpers/db';
setupTestDb();

import { initDb, getDb } from '../../src/db/connection';
import { registerBuiltinTypes } from '../../src/core/computation-types';
import { somaHash, somaHashJson } from '../../src/utils/crypto-agility';
import { isValidHex, assertHex, hexToBuffer } from '../../src/utils/encoding';
import { jcsSerialize } from '../../src/utils/jcs';
import {
  verifyProviderCert,
  createDualSign,
  verifyDualSign,
  extractProviderCert,
} from '../../src/core/dual-sign';
import {
  createComputationCertificate,
  verifyComputationCertificate,
} from '../../src/core/computation-certificate';
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
import { generateSeedCommitment, verifySeedCommitment, deriveCheckIndices } from '../../src/core/commit-reveal';
import { randomBytes } from 'crypto';

beforeEach(() => {
  initDb();
  registerBuiltinTypes();
});

// ─── SQL Injection Patterns ───────────────────────────────────────────────

describe('SQL injection defense', () => {
  it('parameterized queries reject injection in API key lookup', () => {
    // Attempt SQL injection via key value
    const malicious = "cn-test' OR '1'='1";
    const row = getDb().prepare('SELECT * FROM api_keys WHERE key = ?').get(malicious);
    expect(row).toBeUndefined();
  });

  it('injection in INSERT values does not execute', () => {
    const malicious = "test'); DROP TABLE api_keys; --";
    // This should insert the literal string, not execute the DROP
    getDb().prepare(
      'INSERT INTO audit_log (id, entity_type, entity_id, action, actor_id, data_json) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(`sqli-test-${Date.now()}`, 'test', malicious, 'test', null, '{}');

    // Table still exists
    const tables = getDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='api_keys'").get() as any;
    expect(tables).toBeDefined();
    expect(tables.name).toBe('api_keys');
  });

  it('UNION injection in WHERE clause is parameterized', () => {
    const malicious = "' UNION SELECT key, email, credits FROM api_keys --";
    const rows = getDb().prepare('SELECT id FROM audit_log WHERE entity_id = ?').all(malicious);
    expect(rows.length).toBe(0);
  });

  it('null byte injection in string parameters', () => {
    const withNull = 'test\x00injected';
    getDb().prepare(
      'INSERT INTO audit_log (id, entity_type, entity_id, action, data_json) VALUES (?, ?, ?, ?, ?)',
    ).run(`null-test-${Date.now()}`, 'test', withNull, 'null-byte-test', '{}');

    const row = getDb().prepare('SELECT entity_id FROM audit_log WHERE action = ?').get('null-byte-test') as any;
    expect(row.entity_id).toBe(withNull); // stored literally
  });
});

// ─── Malformed Hex in Provider Certificates ───────────────────────────────

describe('provider cert hex validation', () => {
  it('non-hex dataHash rejected', () => {
    expect(verifyProviderCert({
      protocol: 'soma/1.0',
      dataHash: 'not-valid-hex!!!',
      signature: 'a'.repeat(128),
      heartbeatIndex: 0,
      publicKey: 'a'.repeat(64),
    })).toBe(false);
  });

  it('odd-length signature rejected', () => {
    expect(verifyProviderCert({
      protocol: 'soma/1.0',
      dataHash: 'a'.repeat(64),
      signature: 'a'.repeat(127), // odd length
      heartbeatIndex: 0,
      publicKey: 'a'.repeat(64),
    })).toBe(false);
  });

  it('empty publicKey rejected', () => {
    expect(verifyProviderCert({
      protocol: 'soma/1.0',
      dataHash: 'a'.repeat(64),
      signature: 'a'.repeat(128),
      heartbeatIndex: 0,
      publicKey: '',
    })).toBe(false);
  });

  it('wrong publicKey length (not 32 bytes) rejected', () => {
    expect(verifyProviderCert({
      protocol: 'soma/1.0',
      dataHash: 'a'.repeat(64),
      signature: 'a'.repeat(128),
      heartbeatIndex: 0,
      publicKey: 'ab'.repeat(16), // 16 bytes, not 32
    })).toBe(false);
  });

  it('wrong signature length (not 64 bytes) rejected', () => {
    expect(verifyProviderCert({
      protocol: 'soma/1.0',
      dataHash: 'a'.repeat(64),
      signature: 'ab'.repeat(32), // 32 bytes, not 64
      heartbeatIndex: 0,
      publicKey: 'ab'.repeat(32),
    })).toBe(false);
  });

  it('valid hex but wrong signature fails verification', () => {
    const fakeKey = randomBytes(32).toString('hex');
    const fakeSig = randomBytes(64).toString('hex');
    const fakeHash = randomBytes(32).toString('hex');

    expect(verifyProviderCert({
      protocol: 'soma/1.0',
      dataHash: fakeHash,
      signature: fakeSig,
      heartbeatIndex: 0,
      publicKey: fakeKey,
    })).toBe(false);
  });
});

// ─── extractProviderCert ──────────────────────────────────────────────────

describe('extractProviderCert', () => {
  it('returns null when required headers missing', () => {
    expect(extractProviderCert({})).toBeNull();
    expect(extractProviderCert({ 'x-soma-data-hash': 'abc' })).toBeNull();
    expect(extractProviderCert({
      'x-soma-data-hash': 'abc',
      'x-soma-signature': 'def',
    })).toBeNull();
  });

  it('extracts all fields from lowercase headers', () => {
    const cert = extractProviderCert({
      'x-soma-data-hash': 'aabb',
      'x-soma-signature': 'ccdd',
      'x-soma-public-key': 'eeff',
      'x-soma-heartbeat-index': '42',
      'x-soma-protocol': 'soma/2.0',
    });
    expect(cert).not.toBeNull();
    expect(cert!.dataHash).toBe('aabb');
    expect(cert!.signature).toBe('ccdd');
    expect(cert!.publicKey).toBe('eeff');
    expect(cert!.heartbeatIndex).toBe(42);
    expect(cert!.protocol).toBe('soma/2.0');
  });

  it('defaults protocol to soma/1.0', () => {
    const cert = extractProviderCert({
      'x-soma-data-hash': 'aa',
      'x-soma-signature': 'bb',
      'x-soma-public-key': 'cc',
    });
    expect(cert!.protocol).toBe('soma/1.0');
  });
});

// ─── Dual-Sign Chain Hash Tampering ───────────────────────────────────────

describe('dual-sign tampering detection', () => {
  it('createDualSign returns null for unverifiable provider cert', () => {
    const fakeCert = {
      protocol: 'soma/1.0',
      dataHash: randomBytes(32).toString('hex'),
      signature: randomBytes(64).toString('hex'),
      heartbeatIndex: 0,
      publicKey: randomBytes(32).toString('hex'),
    };

    const result = createDualSign(fakeCert, 'test data');
    expect(result).toBeNull();
  });
});

// ─── Oversized Inputs ─────────────────────────────────────────────────────

describe('oversized inputs', () => {
  it('somaHash handles 1MB string', () => {
    const big = 'x'.repeat(1_000_000);
    const hash = somaHash(big);
    expect(hash.length).toBe(64);
    expect(isValidHex(hash)).toBe(true);
  });

  it('somaHashJson handles deeply nested object (100 levels)', () => {
    let obj: any = { value: 'deep' };
    for (let i = 0; i < 100; i++) obj = { n: obj };
    const hash = somaHashJson(obj);
    expect(hash.length).toBe(64);
  });

  it('somaHashJson handles large array (10k elements)', () => {
    const arr = Array.from({ length: 10_000 }, (_, i) => i);
    const hash = somaHashJson(arr);
    expect(hash.length).toBe(64);
  });

  it('JCS handles object with 1000 keys', () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) obj[`key_${i}`] = i;
    const result = jcsSerialize(obj);
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(1000);
  });
});

// ─── Spot-Check: Sort Verification ────────────────────────────────────────

describe('spot-check sort', () => {
  const seed = randomBytes(32).toString('hex');

  it('correctly sorted array passes', () => {
    const input = [5, 3, 1, 4, 2];
    const output = [1, 2, 3, 4, 5];
    const result = checkSort(input, output, seed);
    expect(result.passed).toBe(true);
  });

  it('unsorted output detected', () => {
    const input = [5, 3, 1, 4, 2];
    const output = [1, 3, 2, 4, 5]; // 3,2 out of order
    const result = checkSort(input, output, seed);
    expect(result.passed).toBe(false);
  });

  it('missing element detected via multiset hash', () => {
    const input = [5, 3, 1, 4, 2];
    const output = [1, 2, 3, 4]; // missing 5
    const result = checkSort(input, output, seed);
    expect(result.passed).toBe(false);
  });

  it('added element detected via multiset hash', () => {
    const input = [5, 3, 1, 4, 2];
    const output = [1, 2, 3, 4, 5, 6]; // extra 6
    const result = checkSort(input, output, seed);
    expect(result.passed).toBe(false);
  });

  it('duplicate elements handled correctly', () => {
    const input = [3, 1, 2, 1, 3];
    const output = [1, 1, 2, 3, 3];
    const result = checkSort(input, output, seed);
    expect(result.passed).toBe(true);
  });

  it('empty arrays pass', () => {
    const result = checkSort([], [], seed);
    expect(result.passed).toBe(true);
  });

  it('single element passes', () => {
    const result = checkSort([42], [42], seed);
    expect(result.passed).toBe(true);
  });
});

// ─── Spot-Check: Filter Verification ──────────────────────────────────────

describe('spot-check filter', () => {
  const seed = randomBytes(32).toString('hex');
  const isEven = (x: unknown) => typeof x === 'number' && x % 2 === 0;

  it('correct filter passes', () => {
    const result = checkFilter([1, 2, 3, 4, 5, 6], [2, 4, 6], isEven, seed);
    expect(result.passed).toBe(true);
  });

  it('non-qualifying element in output detected', () => {
    const result = checkFilter([1, 2, 3, 4], [2, 3, 4], isEven, seed);
    expect(result.passed).toBe(false);
  });

  it('omitted qualifying element detected', () => {
    const result = checkFilter([1, 2, 3, 4], [2], isEven, seed);
    expect(result.passed).toBe(false);
  });
});

// ─── Spot-Check: Dedup Verification ───────────────────────────────────────

describe('spot-check dedup', () => {
  const seed = randomBytes(32).toString('hex');

  it('correct dedup passes', () => {
    const result = checkDedup([1, 2, 2, 3, 3, 3], [1, 2, 3], seed);
    expect(result.passed).toBe(true);
  });

  it('remaining duplicates detected', () => {
    const result = checkDedup([1, 2, 2, 3], [1, 2, 2, 3], seed);
    expect(result.passed).toBe(false);
  });

  it('fabricated element detected', () => {
    const result = checkDedup([1, 2, 3], [1, 2, 3, 99], seed);
    expect(result.passed).toBe(false);
  });

  it('missing unique element detected', () => {
    const result = checkDedup([1, 2, 3], [1, 2], seed);
    expect(result.passed).toBe(false);
  });
});

// ─── Spot-Check: Aggregation Checks ───────────────────────────────────────

describe('spot-check aggregation', () => {
  it('correct sum passes', () => {
    expect(checkSum([1, 2, 3, 4, 5], 15).passed).toBe(true);
  });

  it('wrong sum detected', () => {
    expect(checkSum([1, 2, 3, 4, 5], 16).passed).toBe(false);
  });

  it('correct count passes', () => {
    expect(checkCount([1, 2, 3], 3).passed).toBe(true);
  });

  it('wrong count detected', () => {
    expect(checkCount([1, 2, 3], 4).passed).toBe(false);
  });

  it('correct min/max passes', () => {
    expect(checkMinMax([3, 1, 4, 1, 5], 1, 5).passed).toBe(true);
  });

  it('wrong min detected', () => {
    expect(checkMinMax([3, 1, 4], 2, 4).passed).toBe(false);
  });

  it('wrong max detected', () => {
    expect(checkMinMax([3, 1, 4], 1, 3).passed).toBe(false);
  });

  it('empty array fails min/max', () => {
    expect(checkMinMax([], 0, 0).passed).toBe(false);
  });
});

// ─── Spot-Check: Freivalds ────────────────────────────────────────────────

describe('spot-check Freivalds', () => {
  const seed = randomBytes(32).toString('hex');

  it('correct matrix multiplication passes', () => {
    const A = [[1, 2], [3, 4]];
    const B = [[5, 6], [7, 8]];
    const C = [[19, 22], [43, 50]]; // correct A*B
    const result = checkFreivalds(A, B, C, seed, 10);
    expect(result.passed).toBe(true);
  });

  it('wrong matrix multiplication detected', () => {
    const A = [[1, 2], [3, 4]];
    const B = [[5, 6], [7, 8]];
    const C = [[19, 22], [43, 51]]; // C[1][1] wrong
    const result = checkFreivalds(A, B, C, seed, 20);
    expect(result.passed).toBe(false);
  });

  it('dimension mismatch detected', () => {
    const A = [[1, 2], [3, 4]];
    const B = [[5, 6], [7, 8]];
    const C = [[19, 22]]; // wrong row count
    const result = checkFreivalds(A, B, C, seed);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('Dimension');
  });

  it('identity matrix multiplication', () => {
    const I = [[1, 0], [0, 1]];
    const A = [[3, 7], [2, 5]];
    const result = checkFreivalds(I, A, A, seed, 10);
    expect(result.passed).toBe(true);
  });
});

// ─── Spot-Check: Approximate ──────────────────────────────────────────────

describe('spot-check approximate', () => {
  it('within tolerance passes', () => {
    expect(checkApproximate(3.14159, 3.14, 0.01).passed).toBe(true);
  });

  it('outside tolerance fails', () => {
    expect(checkApproximate(3.14159, 3.0, 0.01).passed).toBe(false);
  });

  it('exact match passes', () => {
    expect(checkApproximate(42, 42, 0.001).passed).toBe(true);
  });
});

// ─── MSet-XOR-Hash ────────────────────────────────────────────────────────

describe('mset-xor-hash', () => {
  const key = randomBytes(32).toString('hex');

  it('order independent', () => {
    const h1 = msetXorHash([1, 2, 3], key);
    const h2 = msetXorHash([3, 1, 2], key);
    expect(h1).toBe(h2);
  });

  it('different elements produce different hashes', () => {
    const h1 = msetXorHash([1, 2, 3], key);
    const h2 = msetXorHash([1, 2, 4], key);
    expect(h1).not.toBe(h2);
  });

  it('different keys produce different hashes', () => {
    const key2 = randomBytes(32).toString('hex');
    const h1 = msetXorHash([1, 2, 3], key);
    const h2 = msetXorHash([1, 2, 3], key2);
    expect(h1).not.toBe(h2);
  });

  it('empty array produces zero hash', () => {
    const h = msetXorHash([], key);
    expect(h).toBe('0'.repeat(64));
  });
});

// ─── Commit-Reveal Forgery ────────────────────────────────────────────────

describe('commit-reveal forgery', () => {
  it('forged seed never matches real commitment', () => {
    const { commitment } = generateSeedCommitment();
    for (let i = 0; i < 100; i++) {
      const forgery = randomBytes(32).toString('hex');
      expect(verifySeedCommitment(forgery, commitment)).toBe(false);
    }
  });

  it('similar seeds produce different commitments', () => {
    const base = randomBytes(32);
    const seed1 = base.toString('hex');
    const tweaked = Buffer.from(base);
    tweaked[0] ^= 0x01; // flip one bit
    const seed2 = tweaked.toString('hex');

    expect(somaHash(seed1)).not.toBe(somaHash(seed2));
  });

  it('deriveCheckIndices is deterministic', () => {
    const seed = randomBytes(32).toString('hex');
    const i1 = deriveCheckIndices(seed, 'test', 10, 100);
    const i2 = deriveCheckIndices(seed, 'test', 10, 100);
    expect(i1).toEqual(i2);
  });

  it('deriveCheckIndices domain separation', () => {
    const seed = randomBytes(32).toString('hex');
    const i1 = deriveCheckIndices(seed, 'domain-a', 10, 100);
    const i2 = deriveCheckIndices(seed, 'domain-b', 10, 100);
    expect(i1).not.toEqual(i2);
  });

  it('deriveCheckIndices all indices in range', () => {
    const seed = randomBytes(32).toString('hex');
    const indices = deriveCheckIndices(seed, 'bounds', 1000, 50);
    for (const idx of indices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(50);
    }
  });
});

// ─── Computation Cert Boundary Inputs ─────────────────────────────────────

describe('computation cert boundary inputs', () => {
  it('empty requestId still creates cert', () => {
    const cert = createComputationCertificate({
      requestId: '',
      computationType: 'data-fetch',
      computationClass: 'economic-only',
      inputHash: somaHash('input'),
      outputHash: somaHash('output'),
      seedCommitment: somaHash('seed'),
      seed: 'seed',
      outputCommitment: somaHash(somaHash('output')),
      spotChecks: [checkEconomicOnly('data-fetch')],
    });
    expect(cert).not.toBeNull();
  });

  it('very long requestId handled', () => {
    const cert = createComputationCertificate({
      requestId: 'x'.repeat(10_000),
      computationType: 'data-fetch',
      computationClass: 'economic-only',
      inputHash: somaHash('input'),
      outputHash: somaHash('output'),
      seedCommitment: somaHash('seed'),
      seed: 'seed',
      outputCommitment: somaHash(somaHash('output')),
      spotChecks: [checkEconomicOnly('data-fetch')],
    });
    expect(cert).not.toBeNull();
    const result = verifyComputationCertificate(cert!);
    expect(result.signatureValid).toBe(true);
    expect(result.chainHashValid).toBe(true);
  });

  it('unicode in requestId handled', () => {
    const cert = createComputationCertificate({
      requestId: '测试-テスト-тест-🎯',
      computationType: 'data-fetch',
      computationClass: 'economic-only',
      inputHash: somaHash('input'),
      outputHash: somaHash('output'),
      seedCommitment: somaHash('seed'),
      seed: 'seed',
      outputCommitment: somaHash(somaHash('output')),
      spotChecks: [checkEconomicOnly('data-fetch')],
    });
    expect(cert).not.toBeNull();
    const result = verifyComputationCertificate(cert!);
    expect(result.signatureValid).toBe(true);
  });
});
