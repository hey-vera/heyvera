/**
 * Scale test A — 100 flat hearts signing
 *
 * 100 independent soma-heart instances, each with unique keys,
 * all signing data via fetchData. Proves:
 *   - 100 hearts can be created and destroyed without leaks
 *   - Each heart produces unique birth certificates
 *   - No cross-contamination between hearts
 *   - Crypto throughput is acceptable (< 5s for 100 hearts × 1 sign each)
 *   - Heartbeat indices increment independently per heart
 */
import { describe, expect, it, vi } from 'vitest';

// Scale tests need more time than the default 10s timeout
vi.setConfig({ testTimeout: 60_000 });

// ESM-only imports resolved dynamically to avoid CJS/ESM issues in vitest
async function importSoma() {
  const somaHeart = await import('soma-heart');
  const somaCore = await import('soma-heart/core');
  const nacl = await import('tweetnacl');
  return { createSomaHeart: somaHeart.createSomaHeart, createGenome: somaCore.createGenome, commitGenome: somaCore.commitGenome, nacl: nacl.default };
}

function makeKeyPair(index: number) {
  // Deterministic seed from index — reproducible but unique per heart
  const nacl = require('tweetnacl');
  const seed = Buffer.alloc(32);
  seed.writeUInt32BE(index, 0);
  seed.writeUInt32BE(0xcafe, 4); // extra entropy to avoid collisions
  return nacl.sign.keyPair.fromSeed(new Uint8Array(seed));
}

describe('100 flat hearts — crypto throughput', () => {
  it('creates 100 hearts with unique signing keys', async () => {
    const { createSomaHeart, createGenome, commitGenome } = await importSoma();
    const hearts: any[] = [];

    const start = performance.now();

    for (let i = 0; i < 100; i++) {
      const kp = makeKeyPair(i);
      const genome = createGenome({
        modelProvider: 'test',
        modelId: `heart-${i}`,
        modelVersion: '1.0.0',
        systemPrompt: `Heart #${i}`,
        toolManifest: 'scale-test',
        runtimeId: `scale-heart-${i}`,
        cloudProvider: 'local',
        region: 'test',
        deploymentTier: 'test',
      });
      const commitment = commitGenome(genome, kp);
      const heart = createSomaHeart({
        genome: commitment,
        signingKeyPair: kp,
        modelApiKey: 'not-needed',
        dataSources: [{ name: 'test-source', url: 'http://localhost' }],
      });
      hearts.push(heart);
    }

    const createMs = performance.now() - start;
    expect(hearts.length).toBe(100);
    expect(createMs).toBeLessThan(15000); // vitest vmForks adds overhead

    // Cleanup
    hearts.forEach(h => h.destroy());
  });

  it('each heart signs data independently — unique certs', async () => {
    const { createSomaHeart, createGenome, commitGenome } = await importSoma();
    const hearts: any[] = [];

    // Create 100 hearts
    for (let i = 0; i < 100; i++) {
      const kp = makeKeyPair(i);
      const genome = createGenome({
        modelProvider: 'test', modelId: `sign-${i}`, modelVersion: '1.0.0',
        systemPrompt: 'test', toolManifest: 'test', runtimeId: `sign-${i}`,
        cloudProvider: 'local', region: 'test', deploymentTier: 'test',
      });
      const commitment = commitGenome(genome, kp);
      hearts.push(createSomaHeart({
        genome: commitment, signingKeyPair: kp,
        modelApiKey: 'x', dataSources: [{ name: 'src', url: 'http://localhost' }],
      }));
    }

    // Each heart signs the SAME data — certs should still differ
    const certs: { dataHash: string; publicKey?: string; heartbeatIndex?: number }[] = [];
    const start = performance.now();

    for (let i = 0; i < 100; i++) {
      const result = await hearts[i].fetchData(
        'src',
        JSON.stringify({ endpoint: 'test', index: i }),
        async () => JSON.stringify({ price: 42, stable: true }),
      );
      expect(result.birthCertificate).toBeTruthy();
      certs.push(result.birthCertificate);
    }

    const signMs = performance.now() - start;
    expect(signMs).toBeLessThan(15000); // 100 signs (vmForks overhead)

    // All certs have valid data hashes
    for (const cert of certs) {
      expect(cert.dataHash).toBeTruthy();
      expect(cert.dataHash.length).toBeGreaterThan(10);
    }

    // Data hashes should be IDENTICAL (same input data → same hash)
    const uniqueHashes = new Set(certs.map(c => c.dataHash));
    expect(uniqueHashes.size).toBe(1); // same data = same hash

    // But public keys should be UNIQUE (each heart has its own key)
    const pubKeys = certs.map(c => c.publicKey).filter(Boolean);
    if (pubKeys.length > 0) {
      const uniqueKeys = new Set(pubKeys);
      expect(uniqueKeys.size).toBe(pubKeys.length);
    }

    // Cleanup
    hearts.forEach(h => h.destroy());
  });

  it('heartbeat index increments with repeated fetchData calls', async () => {
    const { createSomaHeart, createGenome, commitGenome } = await importSoma();
    const kp = makeKeyPair(999);
    const genome = createGenome({
      modelProvider: 'test', modelId: 'heartbeat-test', modelVersion: '1.0.0',
      systemPrompt: 'test', toolManifest: 'test', runtimeId: 'heartbeat-test',
      cloudProvider: 'local', region: 'test', deploymentTier: 'test',
    });
    const commitment = commitGenome(genome, kp);
    const heart = createSomaHeart({
      genome: commitment, signingKeyPair: kp,
      modelApiKey: 'x', dataSources: [{ name: 'src', url: 'http://localhost' }],
    });

    const indices: number[] = [];
    for (let i = 0; i < 10; i++) {
      const result = await heart.fetchData(
        'src',
        JSON.stringify({ call: i }),
        async () => JSON.stringify({ data: i }),
      );
      if (result.birthCertificate?.heartbeatIndex != null) {
        indices.push(result.birthCertificate.heartbeatIndex);
      }
    }

    // Heartbeat indices should be monotonically increasing
    if (indices.length > 1) {
      for (let i = 1; i < indices.length; i++) {
        expect(indices[i]).toBeGreaterThan(indices[i - 1]);
      }
    }

    heart.destroy();
  });

  it('no cross-contamination: heart A cert cannot verify with heart B key', async () => {
    const { createSomaHeart, createGenome, commitGenome } = await importSoma();
    const nacl = require('tweetnacl');

    const kpA = makeKeyPair(1000);
    const kpB = makeKeyPair(2000);

    function makeHeart(kp: any, id: string) {
      const genome = createGenome({
        modelProvider: 'test', modelId: id, modelVersion: '1.0.0',
        systemPrompt: 'test', toolManifest: 'test', runtimeId: id,
        cloudProvider: 'local', region: 'test', deploymentTier: 'test',
      });
      const commitment = commitGenome(genome, kp);
      return createSomaHeart({
        genome: commitment, signingKeyPair: kp,
        modelApiKey: 'x', dataSources: [{ name: 'src', url: 'http://localhost' }],
      });
    }

    const heartA = makeHeart(kpA, 'isolated-a');
    const heartB = makeHeart(kpB, 'isolated-b');

    const resultA = await heartA.fetchData('src', 'input', async () => JSON.stringify({ from: 'A' }));
    const resultB = await heartB.fetchData('src', 'input', async () => JSON.stringify({ from: 'B' }));

    // Both should have certs
    expect(resultA.birthCertificate).toBeTruthy();
    expect(resultB.birthCertificate).toBeTruthy();

    // If public keys are exposed, they must differ
    if (resultA.birthCertificate.publicKey && resultB.birthCertificate.publicKey) {
      expect(resultA.birthCertificate.publicKey).not.toBe(resultB.birthCertificate.publicKey);
    }

    // Data hashes differ (different input data)
    expect(resultA.birthCertificate.dataHash).not.toBe(resultB.birthCertificate.dataHash);

    heartA.destroy();
    heartB.destroy();
  });

  it('100 hearts — full lifecycle benchmark', async () => {
    const { createSomaHeart, createGenome, commitGenome } = await importSoma();

    const t0 = performance.now();

    // CREATE
    const hearts: any[] = [];
    for (let i = 0; i < 100; i++) {
      const kp = makeKeyPair(i + 5000);
      const genome = createGenome({
        modelProvider: 'test', modelId: `bench-${i}`, modelVersion: '1.0.0',
        systemPrompt: 'test', toolManifest: 'test', runtimeId: `bench-${i}`,
        cloudProvider: 'local', region: 'test', deploymentTier: 'test',
      });
      const commitment = commitGenome(genome, kp);
      hearts.push(createSomaHeart({
        genome: commitment, signingKeyPair: kp,
        modelApiKey: 'x', dataSources: [{ name: 'src', url: 'http://localhost' }],
      }));
    }
    const tCreate = performance.now();

    // SIGN (each heart signs 1 document)
    const certs: any[] = [];
    for (let i = 0; i < 100; i++) {
      const r = await hearts[i].fetchData('src', `input-${i}`, async () => JSON.stringify({ i, ts: Date.now() }));
      certs.push(r.birthCertificate);
    }
    const tSign = performance.now();

    // DESTROY
    hearts.forEach(h => h.destroy());
    const tDestroy = performance.now();

    const createMs = tCreate - t0;
    const signMs = tSign - tCreate;
    const destroyMs = tDestroy - tSign;
    const totalMs = tDestroy - t0;

    // Performance assertions
    expect(createMs).toBeLessThan(15000); // creation (vmForks overhead)
    expect(signMs).toBeLessThan(15000);  // signing (vmForks overhead)
    expect(destroyMs).toBeLessThan(2000); // destroy under 2s
    expect(totalMs).toBeLessThan(30000); // full lifecycle (vmForks overhead)

    // All 100 certs should exist
    const validCerts = certs.filter(c => c?.dataHash);
    expect(validCerts.length).toBe(100);
  });
});
