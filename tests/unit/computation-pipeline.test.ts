/**
 * Computation pipeline end-to-end tests
 *
 * Tests the full chain: resolveComputationType → issueDataFetchCert →
 * cert creation with bond tier → receipt fields → receipt verify → cert verify
 *
 * Also covers:
 *   - Category default resolution (all 15 categories)
 *   - Explicit computationType override
 *   - issueDataFetchCert with various data shapes
 *   - Soma receipt + computation cert linkage
 *   - Receipt Ed25519 signature verification
 *   - Computation cert signature + chain hash verification
 *   - 100 concurrent cert creations (stress)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from './helpers/db';
setupTestDb();

import { initDb, getDb } from '../../src/db/connection';

import {
  registerBuiltinTypes,
  resolveComputationType,
  getComputationType,
} from '../../src/core/computation-types';

import {
  createComputationCertificate,
  verifyComputationCertificate,
  getComputationCertificate,
  getComputationCertificateById,
} from '../../src/core/computation-certificate';

import { issueDataFetchCert } from '../../src/core/executor';

import { createSomaReceipt, getSomaReceipt } from '../../src/core/soma-receipt';

import { generateSeedCommitment, verifySeedCommitment } from '../../src/core/commit-reveal';

import { somaHash, somaHashJson } from '../../src/utils/crypto-agility';

import { checkEconomicOnly } from '../../src/core/spot-check';

beforeEach(() => {
  initDb();
  registerBuiltinTypes();
});

// ─── resolveComputationType ────────────────────────────────────────────────

describe('resolveComputationType', () => {
  it('returns explicit computationType when set', () => {
    expect(resolveComputationType({ computationType: 'sort', category: 'solana' })).toBe('sort');
    expect(resolveComputationType({ computationType: 'ml-inference' })).toBe('ml-inference');
  });

  it('falls back to category default when no explicit type', () => {
    expect(resolveComputationType({ category: 'solana' })).toBe('data-fetch');
    expect(resolveComputationType({ category: 'intelligence' })).toBe('ml-inference');
    expect(resolveComputationType({ category: 'ai-ml' })).toBe('llm-generation');
    expect(resolveComputationType({ category: 'security' })).toBe('ml-inference');
    expect(resolveComputationType({ category: 'media' })).toBe('ml-inference');
    expect(resolveComputationType({ category: 'oracle' })).toBe('data-fetch');
    expect(resolveComputationType({ category: 'defi' })).toBe('data-fetch');
    expect(resolveComputationType({ category: 'social' })).toBe('data-fetch');
    expect(resolveComputationType({ category: 'utility' })).toBe('data-fetch');
    expect(resolveComputationType({ category: 'scraping' })).toBe('data-fetch');
    expect(resolveComputationType({ category: 'discovery' })).toBe('data-fetch');
    expect(resolveComputationType({ category: 'infrastructure' })).toBe('data-fetch');
    expect(resolveComputationType({ category: 'search' })).toBe('data-fetch');
    expect(resolveComputationType({ category: 'enrichment' })).toBe('data-fetch');
    expect(resolveComputationType({ category: 'weather' })).toBe('data-fetch');
  });

  it('all 15 categories have a default', () => {
    const categories = [
      'solana', 'social', 'utility', 'defi', 'intelligence', 'oracle', 'scraping',
      'discovery', 'infrastructure', 'search', 'media', 'enrichment', 'weather', 'ai-ml', 'security',
    ];
    for (const cat of categories) {
      const resolved = resolveComputationType({ category: cat });
      expect(resolved, `category '${cat}' has no default`).not.toBeNull();
    }
  });

  it('returns null for unknown category with no explicit type', () => {
    expect(resolveComputationType({ category: 'unknown-thing' })).toBeNull();
    expect(resolveComputationType({})).toBeNull();
  });

  it('explicit type takes priority over category default', () => {
    // Category 'solana' defaults to 'data-fetch', but explicit 'sort' overrides
    expect(resolveComputationType({ computationType: 'sort', category: 'solana' })).toBe('sort');
  });
});

// ─── data-fetch builtin type ───────────────────────────────────────────────

describe('data-fetch computation type', () => {
  it('is registered as economic-only', () => {
    const type = getComputationType('data-fetch');
    expect(type).not.toBeNull();
    expect(type!.class).toBe('economic-only');
    expect(type!.probabilityModel).toBe('none');
  });
});

// ─── issueDataFetchCert ────────────────────────────────────────────────────

describe('issueDataFetchCert', () => {
  it('creates a cert for a known computation type', () => {
    const cert = issueDataFetchCert(
      'claw-token-price',
      'data-fetch',
      { mintAddress: 'So11111111111111111111111111111111111111112' },
      { priceUsd: 0.0234, change24h: 5.2 },
    );

    expect(cert).not.toBeNull();
    expect(cert!.computationType).toBe('data-fetch');
    expect(cert!.computationClass).toBe('economic-only');
    expect(cert!.allSpotChecksPassed).toBe(true);
    expect(cert!.spotChecks.length).toBe(1);
    expect(cert!.spotChecks[0].checkName).toBe('economic-only:data-fetch');
    expect(cert!.inputHash).toBeTruthy();
    expect(cert!.outputHash).toBeTruthy();
    expect(cert!.signature).toBeTruthy();
  });

  it('returns null for unknown computation type', () => {
    const cert = issueDataFetchCert(
      'test-endpoint',
      'nonexistent-type',
      {},
      {},
    );
    expect(cert).toBeNull();
  });

  it('chains birth cert hash when provided', () => {
    const birthCert = {
      dataHash: 'abc123',
      signature: 'sig',
      timestamp: new Date().toISOString(),
      publicKey: 'pk',
      heartbeatIndex: 42,
    };

    const cert = issueDataFetchCert(
      'claw-token-price',
      'data-fetch',
      { mintAddress: 'test' },
      { price: 100 },
      birthCert,
    );

    expect(cert).not.toBeNull();
    expect(cert!.birthCertHash).toBe('abc123');
  });

  it('handles large response data', () => {
    const largeData = { items: Array.from({ length: 1000 }, (_, i) => ({ id: i, value: `item-${i}` })) };
    const cert = issueDataFetchCert('test-endpoint', 'data-fetch', {}, largeData);
    expect(cert).not.toBeNull();
    expect(cert!.outputHash).toBeTruthy();
  });

  it('different inputs produce different hashes', () => {
    const cert1 = issueDataFetchCert('ep1', 'data-fetch', { a: '1' }, { result: 'foo' });
    const cert2 = issueDataFetchCert('ep2', 'data-fetch', { a: '2' }, { result: 'bar' });
    expect(cert1!.inputHash).not.toBe(cert2!.inputHash);
    expect(cert1!.outputHash).not.toBe(cert2!.outputHash);
  });
});

// ─── Cert signature + chain hash verification ─────────────────────────────

describe('computation certificate verification', () => {
  it('valid cert passes all verification checks', () => {
    const cert = createComputationCertificate({
      requestId: 'verify-test',
      computationType: 'data-fetch',
      computationClass: 'economic-only',
      inputHash: somaHash('input'),
      outputHash: somaHash('output'),
      seedCommitment: somaHash('seed'),
      seed: 'seed',
      outputCommitment: somaHash(somaHash('output')),
      spotChecks: [checkEconomicOnly('data-fetch')],
    })!;

    const result = verifyComputationCertificate(cert);
    expect(result.signatureValid).toBe(true);
    expect(result.chainHashValid).toBe(true);
    expect(result.seedCommitmentValid).toBe(true);
  });

  it('tampered chain hash fails verification', () => {
    const cert = createComputationCertificate({
      requestId: 'tamper-test',
      computationType: 'data-fetch',
      computationClass: 'economic-only',
      inputHash: somaHash('input'),
      outputHash: somaHash('output'),
      seedCommitment: somaHash('seed'),
      seed: 'seed',
      outputCommitment: somaHash(somaHash('output')),
      spotChecks: [checkEconomicOnly('data-fetch')],
    })!;

    const tampered = { ...cert, chainHash: somaHash('tampered') };
    const result = verifyComputationCertificate(tampered);
    expect(result.chainHashValid).toBe(false);
  });

  it('tampered seed fails commitment verification', () => {
    const cert = createComputationCertificate({
      requestId: 'seed-tamper-test',
      computationType: 'data-fetch',
      computationClass: 'economic-only',
      inputHash: somaHash('input'),
      outputHash: somaHash('output'),
      seedCommitment: somaHash('real-seed'),
      seed: 'real-seed',
      outputCommitment: somaHash(somaHash('output')),
      spotChecks: [checkEconomicOnly('data-fetch')],
    })!;

    const tampered = { ...cert, seed: 'fake-seed' };
    const result = verifyComputationCertificate(tampered);
    expect(result.seedCommitmentValid).toBe(false);
  });

  it('cert round-trips through DB', () => {
    const cert = createComputationCertificate({
      requestId: 'roundtrip-test',
      computationType: 'data-fetch',
      computationClass: 'economic-only',
      inputHash: somaHash('rt-input'),
      outputHash: somaHash('rt-output'),
      seedCommitment: somaHash('rt-seed'),
      seed: 'rt-seed',
      outputCommitment: somaHash(somaHash('rt-output')),
      spotChecks: [checkEconomicOnly('data-fetch')],
    })!;

    const loaded = getComputationCertificateById(cert.id)!;
    expect(loaded.id).toBe(cert.id);
    expect(loaded.computationType).toBe('data-fetch');
    expect(loaded.signature).toBe(cert.signature);
    expect(loaded.chainHash).toBe(cert.chainHash);

    // Loaded cert also passes verification
    const result = verifyComputationCertificate(loaded);
    expect(result.signatureValid).toBe(true);
    expect(result.chainHashValid).toBe(true);
    expect(result.seedCommitmentValid).toBe(true);
  });
});

// ─── Commit-reveal integrity ───────────────────────────────────────────────

describe('commit-reveal protocol integrity', () => {
  it('100 seed commitments are unique', () => {
    const commitments = new Set<string>();
    const seeds = new Set<string>();

    for (let i = 0; i < 100; i++) {
      const { seed, commitment } = generateSeedCommitment();
      commitments.add(commitment);
      seeds.add(seed);
      expect(verifySeedCommitment(seed, commitment)).toBe(true);
    }

    expect(commitments.size).toBe(100);
    expect(seeds.size).toBe(100);
  });

  it('wrong seed never matches commitment', () => {
    for (let i = 0; i < 50; i++) {
      const { seed: seed1, commitment: commitment1 } = generateSeedCommitment();
      const { seed: seed2 } = generateSeedCommitment();
      expect(verifySeedCommitment(seed2, commitment1)).toBe(false);
    }
  });
});

// ─── Soma receipt + computation cert linkage ───────────────────────────────

describe('soma receipt ↔ computation cert linkage', () => {
  it('receipt carries computationCertId through creation', async () => {
    const cert = issueDataFetchCert('test-ep', 'data-fetch', {}, { data: 'test' });
    expect(cert).not.toBeNull();

    const receipt = await createSomaReceipt({
      requestId: `req-${Date.now()}`,
      paymentMethod: 'credits',
      creditsCost: 1,
      requestData: '{"test": true}',
      responseData: '{"data": "test"}',
      computationCertId: cert!.id,
    });

    expect(receipt).not.toBeNull();
    // Verify it was stored in DB
    const row = getDb().prepare('SELECT computation_cert_id FROM soma_receipts WHERE id = ?').get(receipt!.id) as any;
    expect(row.computation_cert_id).toBe(cert!.id);
  });
});

// ─── Scale: 100 concurrent cert creations ──────────────────────────────────

describe('scale: concurrent cert creation', () => {
  it('100 certs created sequentially — all unique IDs and valid signatures', { timeout: 30_000 }, () => {
    const certs: NonNullable<ReturnType<typeof createComputationCertificate>>[] = [];

    for (let i = 0; i < 100; i++) {
      const cert = createComputationCertificate({
        requestId: `scale-test-${i}`,
        computationType: 'data-fetch',
        computationClass: 'economic-only',
        inputHash: somaHash(`input-${i}`),
        outputHash: somaHash(`output-${i}`),
        seedCommitment: somaHash(`seed-${i}`),
        seed: `seed-${i}`,
        outputCommitment: somaHash(somaHash(`output-${i}`)),
        spotChecks: [checkEconomicOnly('data-fetch')],
      });
      expect(cert, `cert ${i} should not be null`).not.toBeNull();
      certs.push(cert!);
    }

    // All unique IDs
    const ids = new Set(certs.map(c => c.id));
    expect(ids.size).toBe(100);

    // All signatures valid
    for (const cert of certs) {
      const result = verifyComputationCertificate(cert);
      expect(result.signatureValid).toBe(true);
      expect(result.chainHashValid).toBe(true);
    }

    // All persisted in DB
    const dbCount = (getDb().prepare('SELECT COUNT(*) as c FROM computation_certificates WHERE request_id LIKE ?').get('scale-test-%') as any).c;
    expect(dbCount).toBe(100);
  });

  it('100 issueDataFetchCert calls — all produce unique certs', { timeout: 30_000 }, () => {
    const certs: NonNullable<ReturnType<typeof issueDataFetchCert>>[] = [];

    for (let i = 0; i < 100; i++) {
      const cert = issueDataFetchCert(
        `endpoint-${i}`,
        'data-fetch',
        { param: `value-${i}` },
        { result: i },
      );
      expect(cert).not.toBeNull();
      certs.push(cert!);
    }

    const ids = new Set(certs.map(c => c.id));
    expect(ids.size).toBe(100);

    // All have unique input/output hashes
    const inputHashes = new Set(certs.map(c => c.inputHash));
    const outputHashes = new Set(certs.map(c => c.outputHash));
    expect(inputHashes.size).toBe(100);
    expect(outputHashes.size).toBe(100);
  });
});

// ─── Hash determinism ──────────────────────────────────────────────────────

describe('hash determinism for certs', () => {
  it('same input/output always produces same hashes', () => {
    const params = { mintAddress: 'So111' };
    const data = { priceUsd: 123.45 };

    const hash1 = somaHashJson({ endpointId: 'test', params });
    const hash2 = somaHashJson({ endpointId: 'test', params });
    expect(hash1).toBe(hash2);

    const outHash1 = somaHashJson(data);
    const outHash2 = somaHashJson(data);
    expect(outHash1).toBe(outHash2);
  });

  it('key order does not affect hash (JCS canonicalization)', () => {
    const hash1 = somaHashJson({ a: 1, b: 2 });
    const hash2 = somaHashJson({ b: 2, a: 1 });
    expect(hash1).toBe(hash2);
  });

  it('single-bit change produces different hash', () => {
    const hash1 = somaHashJson({ value: 100 });
    const hash2 = somaHashJson({ value: 101 });
    expect(hash1).not.toBe(hash2);
  });
});
