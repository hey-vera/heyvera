/**
 * soma.ts — Soma Heart singleton for cryptographic data provenance
 *
 * Bridges claw-net's AID identity with soma-heart. Derives the soma keypair
 * from the same PLATFORM_SIGNING_SECRET seed used by ed25519-signer.ts,
 * so both systems share identical Ed25519 key material.
 *
 * The heart wraps outbound x402 fetches via heart.fetchData(), producing
 * birth certificates and heartbeat chains for every upstream API call.
 */

import { createHash } from 'crypto';
import { logger } from '../utils/logger';

// tweetnacl is a transitive dep of soma-heart, hoisted to node_modules
import nacl from 'tweetnacl';

// Dynamic import types (resolved at runtime to avoid CJS/ESM mismatch in Docker)
type HeartRuntime = Awaited<ReturnType<typeof import('soma-heart')>>['HeartRuntime'] extends new (...args: any[]) => infer R ? R : any;

// ── Singleton ────────────────────────────────────────────────────────────

let _heart: any | null = null;

/**
 * Initialize the Soma Heart using the same Ed25519 seed as AID.
 *
 * Key bridging: SHA-256(PLATFORM_SIGNING_SECRET) → 32-byte seed
 * → nacl.sign.keyPair.fromSeed() → same public key as ed25519-signer.ts.
 *
 * The soma DID will differ from the AID DID (base64 vs base58btc encoding)
 * but the underlying Ed25519 key material is identical.
 */
export async function initHeart(): Promise<void> {
  if (_heart) return;

  try {
    const somaHeart = await import('soma-heart');
    const somaCore = await import('soma-heart/core');

    const secret = process.env.PLATFORM_SIGNING_SECRET || 'clawnet-dev';
    const seed = createHash('sha256').update(secret).digest().subarray(0, 32);
    const signingKeyPair = nacl.sign.keyPair.fromSeed(new Uint8Array(seed));

    const genome = somaCore.createGenome({
      modelProvider: 'orchestrator',
      modelId: 'clawnet-orchestrator',
      modelVersion: '1.0.0',
      systemPrompt: 'ClawNet sovereign AI agent orchestration layer',
      toolManifest: 'x402-proxy',
      runtimeId: 'clawnet',
      cloudProvider: 'vps',
      region: 'nyc1',
      deploymentTier: 'tier1',
    });

    const commitment = somaCore.commitGenome(genome, signingKeyPair);

    _heart = somaHeart.createSomaHeart({
      genome: commitment,
      signingKeyPair,
      modelApiKey: 'not-used-orchestrator',
      modelBaseUrl: '',
      modelId: 'none',
      dataSources: [{ name: 'x402-upstream', url: 'https://clawapis.com' }],
    });

    logger.info({ somaDid: commitment.did }, 'Soma Heart initialized');
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Soma Heart init failed — running without provenance');
  }
}

/** Get the heart or throw if not initialized. */
export function getHeart(): any {
  if (!_heart) throw new Error('Soma Heart not initialized');
  return _heart;
}

/** Get the heart or null (for optional wrapping). */
export function getHeartSafe(): any | null {
  return _heart;
}

/** Destroy the heart and wipe credentials from memory. */
export function destroyHeart(): void {
  if (_heart) {
    _heart.destroy();
    _heart = null;
    logger.info('Soma Heart destroyed');
  }
}
