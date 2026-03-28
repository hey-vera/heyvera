/**
 * soma.ts — Soma Heart singleton for cryptographic provenance + model verification
 *
 * Derives the soma keypair from the same PLATFORM_SIGNING_SECRET seed used by
 * ed25519-signer.ts, so both systems share identical Ed25519 key material.
 *
 * Two execution pathways:
 *   1. heart.fetchData() — wraps outbound x402 API calls with birth certificates
 *   2. heart.generate() — wraps ClawNet's own LLM calls with per-token HMACs +
 *      heartbeat chain entries. This makes ClawNet's model usage verifiable
 *      by callers running soma-sense. (Phase 2)
 */

import { createHash } from 'crypto';
import { env } from '../config/index';
import { logger } from '../utils/logger';

// tweetnacl is a transitive dep of soma-heart, hoisted to node_modules
import nacl from 'tweetnacl';

// ── Singleton ────────────────────────────────────────────────────────────

let _heart: any | null = null;

// ── Last generation provenance (similar to _lastBirthCert pattern) ───────
// Stores heartbeats + token HMACs from the most recent heart.generate() call.
// Retrieved by the provenance middleware to attach to HTTP responses.
interface GenerationProvenance {
  heartbeats: Array<{ sequence: number; eventType: string; hash: string; timestamp: number }>;
  tokenHmacs: Array<{ token: string; hmac?: string; sequence: number; timestamp: number }>;
  tokenCount: number;
  model: string;
  role: string;
}

let _lastGenerationProvenance: GenerationProvenance | null = null;

/** Get and clear the last generation provenance. Clearing prevents stale
 *  provenance from leaking to the next request in concurrent scenarios. */
export function getLastGenerationProvenance(): GenerationProvenance | null {
  const prov = _lastGenerationProvenance;
  _lastGenerationProvenance = null;
  return prov;
}

/**
 * Initialize the Soma Heart with real LLM config for both fetchData() and generate().
 *
 * Key bridging: SHA-256(PLATFORM_SIGNING_SECRET) → 32-byte seed
 * → nacl.sign.keyPair.fromSeed() → same public key as ed25519-signer.ts.
 */
export async function initHeart(): Promise<void> {
  if (_heart) return;

  try {
    const somaHeart = await import('soma-heart');
    const somaCore = await import('soma-heart/core');

    const secret = process.env.PLATFORM_SIGNING_SECRET || 'clawnet-dev';
    const seed = createHash('sha256').update(secret).digest().subarray(0, 32);
    const signingKeyPair = nacl.sign.keyPair.fromSeed(new Uint8Array(seed));

    // Determine which LLM provider to use for heart.generate()
    const useAnthropic = env.LLM_PROVIDER === 'anthropic' && env.ANTHROPIC_API_KEY;
    const modelApiKey = useAnthropic ? env.ANTHROPIC_API_KEY! : (env.OPENAI_API_KEY ?? 'not-configured');
    const modelBaseUrl = useAnthropic ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1';
    const modelId = useAnthropic ? env.ANTHROPIC_MODEL : env.OPENAI_MODEL;

    const genome = somaCore.createGenome({
      modelProvider: useAnthropic ? 'anthropic' : 'openai',
      modelId,
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
      modelApiKey,
      modelBaseUrl,
      modelId,
      dataSources: [{ name: 'x402-upstream', url: 'https://clawapis.com' }],
    });

    logger.info({ somaDid: commitment.did, modelId, provider: useAnthropic ? 'anthropic' : 'openai' }, 'Soma Heart initialized (fetchData + generate)');
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Soma Heart init failed — running without provenance');
  }
}

/**
 * Route an LLM call through heart.generate() — collects the async token stream
 * into a complete response string while capturing heartbeats and per-token HMACs.
 *
 * Returns null if heart is not available (caller should fall back to direct SDK).
 */
export async function heartLlmComplete(
  messages: Array<{ role: string; content: string }>,
  role: 'intent' | 'synthesis',
): Promise<{ content: string; tokenCount: number; heartbeats: GenerationProvenance['heartbeats'] } | null> {
  if (!_heart) return null;

  try {
    const heartbeats: GenerationProvenance['heartbeats'] = [];
    const tokenHmacs: GenerationProvenance['tokenHmacs'] = [];
    const tokens: string[] = [];

    const stream = _heart.generate({
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      maxTokens: 2048,
      temperature: 0,
    });

    for await (const item of stream) {
      if (item.type === 'heartbeat' && item.heartbeat) {
        heartbeats.push({
          sequence: item.heartbeat.sequence,
          eventType: item.heartbeat.eventType,
          hash: item.heartbeat.hash,
          timestamp: item.timestamp,
        });
      } else if (item.type === 'token' && item.token) {
        tokens.push(item.token);
        tokenHmacs.push({
          token: item.token,
          hmac: item.hmac,
          sequence: item.sequence ?? tokens.length - 1,
          timestamp: item.timestamp,
        });
      }
    }

    const content = tokens.join('');

    // Store provenance for the middleware to attach to response
    _lastGenerationProvenance = {
      heartbeats,
      tokenHmacs,
      tokenCount: tokens.length,
      model: _heart.modelId ?? 'unknown',
      role,
    };

    return { content, tokenCount: tokens.length, heartbeats };
  } catch (err: any) {
    logger.warn({ err: err.message, role }, 'heart.generate() failed — caller should fall back to direct SDK');
    return null;
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
