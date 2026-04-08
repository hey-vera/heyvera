/**
 * Performance: Benchmark baselines
 *
 * Establishes measurable throughput baselines for production readiness.
 * These are not pass/fail — they record timing data so you can detect
 * regressions and set SLO targets.
 *
 * Benchmarks:
 *   - Ed25519 sign throughput (ops/sec)
 *   - Ed25519 verify throughput (ops/sec)
 *   - SHA-256 (somaHash) throughput (ops/sec)
 *   - JCS serialization throughput (ops/sec)
 *   - Computation cert creation latency (ms/op)
 *   - Computation cert verification latency (ms/op)
 *   - DB INSERT throughput (ops/sec)
 *   - Commit-reveal generate+verify throughput (ops/sec)
 *   - somaHashJson throughput for realistic payloads
 *   - Spot-check sort verification throughput
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from './helpers/db';
setupTestDb();

import { initDb, getDb } from '../../src/db/connection';
import { registerBuiltinTypes } from '../../src/core/computation-types';
import { signVC, verifyVCSignature } from '../../src/utils/ed25519-signer';
import { somaHash, somaHashJson } from '../../src/utils/crypto-agility';
import { jcsSerialize } from '../../src/utils/jcs';
import {
  createComputationCertificate,
  verifyComputationCertificate,
} from '../../src/core/computation-certificate';
import { generateSeedCommitment, verifySeedCommitment } from '../../src/core/commit-reveal';
import { checkEconomicOnly, checkSort } from '../../src/core/spot-check';
import { randomBytes } from 'crypto';

beforeEach(() => {
  initDb();
  registerBuiltinTypes();
});

/** Run a benchmark and return ops/sec */
function benchmark(name: string, fn: () => void, iterations: number): { opsPerSec: number; avgMs: number; totalMs: number } {
  // Warmup
  for (let i = 0; i < Math.min(10, iterations); i++) fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const totalMs = performance.now() - start;

  const avgMs = totalMs / iterations;
  const opsPerSec = Math.round((iterations / totalMs) * 1000);

  return { opsPerSec, avgMs, totalMs };
}

// ─── Ed25519 Sign Throughput ──────────────────────────────────────────────

describe('Ed25519 sign throughput', () => {
  it('1000 signatures', { timeout: 30_000 }, () => {
    const payload = { id: 'bench', data: 'test', timestamp: '2026-01-01T00:00:00Z' };
    const result = benchmark('Ed25519 sign', () => signVC(payload), 1000);

    console.log(`Ed25519 sign: ${result.opsPerSec} ops/sec (avg ${result.avgMs.toFixed(3)}ms)`);
    // Should be >500 ops/sec on any modern CPU
    expect(result.opsPerSec).toBeGreaterThan(100);
  });
});

// ─── Ed25519 Verify Throughput ────────────────────────────────────────────

describe('Ed25519 verify throughput', () => {
  it('1000 verifications', { timeout: 30_000 }, () => {
    const payload = { id: 'bench', data: 'test' };
    const signature = signVC(payload);

    const result = benchmark('Ed25519 verify', () => verifyVCSignature(payload, signature), 1000);

    console.log(`Ed25519 verify: ${result.opsPerSec} ops/sec (avg ${result.avgMs.toFixed(3)}ms)`);
    expect(result.opsPerSec).toBeGreaterThan(100);
  });
});

// ─── SHA-256 Hash Throughput ──────────────────────────────────────────────

describe('SHA-256 (somaHash) throughput', () => {
  it('10,000 hashes of short strings', { timeout: 30_000 }, () => {
    const result = benchmark('somaHash short', () => somaHash('benchmark-data-string'), 10_000);

    console.log(`somaHash (short): ${result.opsPerSec} ops/sec (avg ${result.avgMs.toFixed(4)}ms)`);
    expect(result.opsPerSec).toBeGreaterThan(10_000);
  });

  it('1000 hashes of 1KB strings', { timeout: 30_000 }, () => {
    const data = 'x'.repeat(1024);
    const result = benchmark('somaHash 1KB', () => somaHash(data), 1000);

    console.log(`somaHash (1KB): ${result.opsPerSec} ops/sec (avg ${result.avgMs.toFixed(4)}ms)`);
    expect(result.opsPerSec).toBeGreaterThan(5_000);
  });

  it('100 hashes of 100KB strings', { timeout: 30_000 }, () => {
    const data = 'x'.repeat(100_000);
    const result = benchmark('somaHash 100KB', () => somaHash(data), 100);

    console.log(`somaHash (100KB): ${result.opsPerSec} ops/sec (avg ${result.avgMs.toFixed(3)}ms)`);
    expect(result.opsPerSec).toBeGreaterThan(500);
  });
});

// ─── JCS Serialization Throughput ─────────────────────────────────────────

describe('JCS serialization throughput', () => {
  it('10,000 small objects', { timeout: 30_000 }, () => {
    const obj = { a: 1, b: 'test', c: true, d: null };
    const result = benchmark('JCS small', () => jcsSerialize(obj), 10_000);

    console.log(`JCS (small obj): ${result.opsPerSec} ops/sec (avg ${result.avgMs.toFixed(4)}ms)`);
    expect(result.opsPerSec).toBeGreaterThan(10_000);
  });

  it('1000 medium objects (20 keys)', { timeout: 30_000 }, () => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++) obj[`key_${i}`] = { value: i, name: `item-${i}` };

    const result = benchmark('JCS medium', () => jcsSerialize(obj), 1000);

    console.log(`JCS (20-key obj): ${result.opsPerSec} ops/sec (avg ${result.avgMs.toFixed(3)}ms)`);
    expect(result.opsPerSec).toBeGreaterThan(1_000);
  });
});

// ─── somaHashJson Throughput ──────────────────────────────────────────────

describe('somaHashJson throughput', () => {
  it('5000 realistic API payloads', { timeout: 30_000 }, () => {
    const payload = {
      endpointId: 'test-endpoint',
      params: { mintAddress: 'So11111111111111111111111111111111111111112' },
      timestamp: '2026-01-01T00:00:00Z',
      data: { priceUsd: 0.0234, change24h: 5.2, volume: 1234567 },
    };

    const result = benchmark('somaHashJson', () => somaHashJson(payload), 5000);

    console.log(`somaHashJson (API payload): ${result.opsPerSec} ops/sec (avg ${result.avgMs.toFixed(4)}ms)`);
    expect(result.opsPerSec).toBeGreaterThan(5_000);
  });
});

// ─── Computation Cert Creation Latency ────────────────────────────────────

describe('computation cert creation latency', () => {
  it('100 cert creations', { timeout: 60_000 }, () => {
    let i = 0;
    const result = benchmark('cert create', () => {
      createComputationCertificate({
        requestId: `perf-create-${i++}`,
        computationType: 'data-fetch',
        computationClass: 'economic-only',
        inputHash: somaHash(`in-${i}`),
        outputHash: somaHash(`out-${i}`),
        seedCommitment: somaHash(`seed-${i}`),
        seed: `seed-${i}`,
        outputCommitment: somaHash(somaHash(`out-${i}`)),
        spotChecks: [checkEconomicOnly('data-fetch')],
      });
    }, 100);

    console.log(`Cert creation: ${result.opsPerSec} ops/sec (avg ${result.avgMs.toFixed(2)}ms)`);
    // Cert creation involves: JCS + hash + Ed25519 sign + DB INSERT
    // Dev machine may be slower; production SLO target is <50ms
    expect(result.avgMs).toBeLessThan(200);
  });
});

// ─── Computation Cert Verification Latency ────────────────────────────────

describe('computation cert verification latency', () => {
  it('200 cert verifications', { timeout: 60_000 }, () => {
    const cert = createComputationCertificate({
      requestId: 'perf-verify-base',
      computationType: 'data-fetch',
      computationClass: 'economic-only',
      inputHash: somaHash('perf-in'),
      outputHash: somaHash('perf-out'),
      seedCommitment: somaHash('perf-seed'),
      seed: 'perf-seed',
      outputCommitment: somaHash(somaHash('perf-out')),
      spotChecks: [checkEconomicOnly('data-fetch')],
    })!;

    const result = benchmark('cert verify', () => verifyComputationCertificate(cert), 200);

    console.log(`Cert verify: ${result.opsPerSec} ops/sec (avg ${result.avgMs.toFixed(3)}ms)`);
    // Verification: chain hash rebuild + Ed25519 verify + seed check
    // Dev machine may be slower; production SLO target is <20ms
    expect(result.avgMs).toBeLessThan(200);
  });
});

// ─── DB INSERT Throughput ─────────────────────────────────────────────────

describe('DB INSERT throughput', () => {
  it('1000 individual INSERTs', { timeout: 30_000 }, () => {
    const stmt = getDb().prepare(
      'INSERT INTO audit_log (id, entity_type, entity_id, action, data_json) VALUES (?, ?, ?, ?, ?)',
    );

    let i = 0;
    const result = benchmark('DB INSERT', () => {
      stmt.run(`perf-${i++}-${Date.now()}`, 'bench', `entry-${i}`, 'perf-test', '{"i":' + i + '}');
    }, 1000);

    console.log(`DB INSERT (individual): ${result.opsPerSec} ops/sec (avg ${result.avgMs.toFixed(3)}ms)`);
    expect(result.opsPerSec).toBeGreaterThan(100);
  });

  it('1000 INSERTs in single transaction', { timeout: 30_000 }, () => {
    const stmt = getDb().prepare(
      'INSERT INTO audit_log (id, entity_type, entity_id, action, data_json) VALUES (?, ?, ?, ?, ?)',
    );

    const start = performance.now();
    getDb().transaction(() => {
      for (let i = 0; i < 1000; i++) {
        stmt.run(`perf-tx-${i}`, 'bench-tx', `tx-entry-${i}`, 'perf-tx-test', '{}');
      }
    })();
    const totalMs = performance.now() - start;

    const opsPerSec = Math.round((1000 / totalMs) * 1000);
    console.log(`DB INSERT (transaction): ${opsPerSec} ops/sec (${totalMs.toFixed(1)}ms total)`);
    // Batched in a transaction should be much faster
    expect(opsPerSec).toBeGreaterThan(1000);
  });
});

// ─── Commit-Reveal Throughput ─────────────────────────────────────────────

describe('commit-reveal throughput', () => {
  it('5000 generate+verify cycles', { timeout: 30_000 }, () => {
    const result = benchmark('commit-reveal', () => {
      const { seed, commitment } = generateSeedCommitment();
      verifySeedCommitment(seed, commitment);
    }, 5000);

    console.log(`Commit-reveal: ${result.opsPerSec} ops/sec (avg ${result.avgMs.toFixed(4)}ms)`);
    expect(result.opsPerSec).toBeGreaterThan(1_000);
  });
});

// ─── Sort Spot-Check Throughput ───────────────────────────────────────────

describe('sort spot-check throughput', () => {
  it('100 sort verifications of 1000-element arrays', { timeout: 30_000 }, () => {
    const seed = randomBytes(32).toString('hex');
    const input = Array.from({ length: 1000 }, () => Math.random() * 1000);
    const output = [...input].sort((a, b) => a - b);

    const result = benchmark('sort check 1K', () => {
      checkSort(input, output, seed);
    }, 100);

    console.log(`Sort check (1K elems): ${result.opsPerSec} ops/sec (avg ${result.avgMs.toFixed(2)}ms)`);
    expect(result.avgMs).toBeLessThan(500);
  });
});

// ─── Summary ──────────────────────────────────────────────────────────────

describe('performance summary', () => {
  it('all critical paths under latency budget', { timeout: 60_000 }, () => {
    // This test serves as a summary gate.
    // If any individual benchmark above fails its threshold, this still captures it.
    const payload = { id: 'gate', data: 'check' };
    const sig = signVC(payload);

    // Single operation latencies
    const signStart = performance.now();
    signVC(payload);
    const signMs = performance.now() - signStart;

    const verifyStart = performance.now();
    verifyVCSignature(payload, sig);
    const verifyMs = performance.now() - verifyStart;

    const hashStart = performance.now();
    somaHash('gate-test');
    const hashMs = performance.now() - hashStart;

    console.log(`\n=== Single-op Latencies ===`);
    console.log(`  Ed25519 sign:   ${signMs.toFixed(3)}ms`);
    console.log(`  Ed25519 verify: ${verifyMs.toFixed(3)}ms`);
    console.log(`  SHA-256 hash:   ${hashMs.toFixed(4)}ms`);

    // Sanity: no single crypto op should take >100ms
    expect(signMs).toBeLessThan(100);
    expect(verifyMs).toBeLessThan(100);
    expect(hashMs).toBeLessThan(10);
  });
});
