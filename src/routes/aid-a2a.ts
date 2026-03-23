/**
 * aid-a2a.ts — A2A Agent Card extension for AID trust (Phase 2)
 *
 * Extends the A2A agent card with AID trust data so that A2A orchestrators
 * can make trust-aware routing decisions during agent discovery.
 *
 * Per AID spec Section 8.2 (aid-a2a-profile.md):
 *   Agent cards include an `aidTrust` extension with trust score, verdict,
 *   attestation count, and a signed trustProof from ClawNet's platform key.
 *
 * Endpoints:
 *   GET /aid/a2a/card         — full agent card with AID trust extension
 *   GET /aid/a2a/card/:did    — agent card for a specific DID
 *   GET /aid/a2a/discover     — search agents by trust + capability
 */

import { Hono } from 'hono';
import crypto from 'crypto';
import { getDb } from '../db/connection';
import { AID_HASH_ALGORITHM } from '../utils/crypto-agility';
import { logger } from '../utils/logger';

const router = new Hono();

const PLATFORM_DID = 'did:web:api.claw-net.org';

// ─── Platform signing key ────────────────────────────────────────────────────

let _privateKey: crypto.KeyObject | null = null;

function ensurePrivateKey(): crypto.KeyObject {
  if (_privateKey) return _privateKey;
  const secret = process.env.PLATFORM_SIGNING_SECRET || 'clawnet-dev';
  const seed = crypto.createHash('sha256').update(secret).digest().subarray(0, 32);
  const pkcs8Header = Buffer.from('302e020100300506032b657004220420', 'hex');
  const pkcs8Der = Buffer.concat([pkcs8Header, seed]);
  _privateKey = crypto.createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' });
  return _privateKey;
}

function signTrustProof(did: string, score: number, verdict: string, timestamp: string): string {
  const input = `${did}:${score}:${verdict}:${timestamp}`;
  const hash = crypto.createHash(AID_HASH_ALGORITHM).update(input).digest();
  return crypto.sign(null, hash, ensurePrivateKey()).toString('base64url');
}

function trustVerdict(score: number): { verdict: string; discount: number; settlement: string } {
  if (score >= 90) return { verdict: 'proceed', discount: 0.30, settlement: 'deferred' };
  if (score >= 80) return { verdict: 'trusted', discount: 0.25, settlement: 'batched' };
  if (score >= 60) return { verdict: 'standard', discount: 0.20, settlement: 'batched' };
  if (score >= 40) return { verdict: 'caution', discount: 0.10, settlement: 'standard' };
  if (score >= 20) return { verdict: 'building', discount: 0, settlement: 'immediate' };
  return { verdict: 'new', discount: 0, settlement: 'immediate' };
}

// ─── GET /a2a/card/:did — Agent card with AID trust extension ───────────────

router.get('/a2a/card/:did', async (c) => {
  const did = c.req.param('did');

  const aidKey = getDb().prepare(`
    SELECT did, display_name, service_endpoints, created_at
    FROM aid_keys WHERE did = ? AND key_status = 'active' LIMIT 1
  `).get(did) as any;

  if (!aidKey) {
    return c.json({ error: 'Agent not found', code: 'AID_DID_NOT_FOUND' }, 404);
  }

  // Compute trust score
  let score = 0;
  let attestationCount = 0;
  try {
    const stats = getDb().prepare(`
      SELECT success_count, total_attestations, manifest_aligned, manifest_unaligned
      FROM attestation_stats WHERE owner_key = (
        SELECT owner_key FROM aid_keys WHERE did = ? LIMIT 1
      ) LIMIT 1
    `).get(did) as any;

    if (stats && stats.total_attestations > 0) {
      const successRate = stats.success_count / stats.total_attestations;
      const volume = Math.min(stats.total_attestations / 1000, 1);
      const manifestTotal = stats.manifest_aligned + stats.manifest_unaligned;
      const manifestAdherence = manifestTotal > 0 ? stats.manifest_aligned / manifestTotal : 0.5;
      score = Math.min(100, Math.round(successRate * 40 + 0.5 * 25 + volume * 20 + manifestAdherence * 15));
      attestationCount = stats.total_attestations;
    }
  } catch { /* non-critical */ }

  const { verdict, discount, settlement } = trustVerdict(score);
  const timestamp = new Date().toISOString();
  const trustProof = signTrustProof(did, score, verdict, timestamp);

  // Get capabilities
  let capabilities: string[] = [];
  try {
    const caps = getDb().prepare(
      `SELECT DISTINCT category FROM aid_capabilities WHERE identity_id = (
        SELECT owner_key FROM aid_keys WHERE did = ? LIMIT 1
      )`
    ).all(did) as { category: string }[];
    capabilities = caps.map(c => c.category);
  } catch { /* non-critical */ }

  // Build A2A agent card with AID extension
  const card = {
    name: aidKey.display_name || 'AID Agent',
    description: `Trust-scored agent on AID Protocol (${verdict})`,
    url: `https://api.claw-net.org/v1/aid/${encodeURIComponent(did)}`,
    provider: {
      organization: 'AID Protocol',
      url: 'https://aidprotocol.org',
    },
    version: '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
    },
    skills: capabilities.map(cap => ({
      id: cap,
      name: cap,
      description: `${cap} services via AID Protocol`,
    })),
    securitySchemes: {
      aidTrust: {
        type: 'apiKey',
        in: 'header',
        name: 'X-AID-DID',
        description: 'AID Protocol identity + trust verification',
      },
    },

    // ─── AID Trust Extension (the differentiator) ────────────────────────
    extensions: {
      aidTrust: {
        did,
        trustScore: score,
        trustVerdict: verdict,
        verified: score >= 40,
        attestationCount,
        capabilities,
        discount,
        settlementMode: settlement,
        trustTimestamp: timestamp,
        // Platform-signed proof — verifiers check against /.well-known/aid-platform-key
        trustProof,
        signerDid: PLATFORM_DID,
        heartbeatUrl: 'https://api.claw-net.org/aid/heartbeat',
        canaryUrl: 'https://api.claw-net.org/aid/canary',
      },
    },
  };

  return c.json(card);
});

// ─── GET /a2a/card — Platform agent card ─────────────────────────────────────

router.get('/a2a/card', async (c) => {
  const timestamp = new Date().toISOString();

  let totalAgents = 0;
  let totalAttestations = 0;
  try {
    const agents = getDb().prepare(`SELECT COUNT(*) as c FROM aid_keys WHERE key_status = 'active'`).get() as any;
    totalAgents = agents?.c ?? 0;
    const attests = getDb().prepare(`SELECT COUNT(*) as c FROM attestations`).get() as any;
    totalAttestations = attests?.c ?? 0;
  } catch { /* non-critical */ }

  return c.json({
    name: 'ClawNet AID Platform',
    description: 'Sovereign AI agent orchestration with AID trust scoring',
    url: 'https://api.claw-net.org',
    provider: {
      organization: 'ClawNet / AID Protocol',
      url: 'https://claw-net.org',
    },
    version: '1.0.0',
    capabilities: {
      streaming: true,
      pushNotifications: false,
    },
    skills: [
      { id: 'trust-lookup', name: 'Trust Lookup', description: 'Look up any agent AID trust score' },
      { id: 'trust-verify', name: 'Trust Verify', description: 'Verify AID documents offline' },
      { id: 'provision', name: 'AID Provisioning', description: 'Create new AID identity (X-AID-NEW)' },
      { id: 'heartbeat', name: 'Heartbeat', description: 'Platform status + pricing tiers' },
    ],
    securitySchemes: {
      aidTrust: { type: 'apiKey', in: 'header', name: 'X-AID-DID' },
      apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    },
    extensions: {
      aidTrust: {
        did: PLATFORM_DID,
        trustScore: 100,
        trustVerdict: 'proceed',
        verified: true,
        attestationCount: totalAttestations,
        platform: true,
        totalAgents,
        heartbeatUrl: 'https://api.claw-net.org/aid/heartbeat',
        canaryUrl: 'https://api.claw-net.org/aid/canary',
        trustTimestamp: timestamp,
      },
    },
  });
});

// ─── GET /a2a/discover — Trust-weighted agent discovery ─────────────────────

router.get('/a2a/discover', async (c) => {
  const capability = c.req.query('capability') || '';
  const minScore = parseInt(c.req.query('minScore') || '0', 10);
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);

  try {
    let query = `
      SELECT ak.did, ak.display_name, ak.created_at,
             COALESCE(ast.success_count, 0) as success_count,
             COALESCE(ast.total_attestations, 0) as total_attestations
      FROM aid_keys ak
      LEFT JOIN attestation_stats ast ON ast.owner_key = ak.owner_key
      WHERE ak.key_status = 'active'
    `;
    const params: unknown[] = [];

    if (capability) {
      query += ` AND EXISTS (SELECT 1 FROM aid_capabilities ac WHERE ac.identity_id = ak.owner_key AND ac.category = ?)`;
      params.push(capability);
    }

    query += ` ORDER BY COALESCE(ast.total_attestations, 0) DESC LIMIT ?`;
    params.push(limit);

    const agents = getDb().prepare(query).all(...params) as any[];

    const results = agents
      .map(a => {
        const rate = a.total_attestations > 0 ? a.success_count / a.total_attestations : 0;
        const volume = Math.min(a.total_attestations / 1000, 1);
        const score = Math.min(100, Math.round(rate * 40 + 0.5 * 25 + volume * 20 + 0.5 * 15));
        return { ...a, score };
      })
      .filter(a => a.score >= minScore)
      .map(a => ({
        did: a.did,
        displayName: a.display_name,
        trustScore: a.score,
        verdict: trustVerdict(a.score).verdict,
        attestations: a.total_attestations,
        cardUrl: `https://api.claw-net.org/aid/a2a/card/${encodeURIComponent(a.did)}`,
      }));

    return c.json({
      agents: results,
      total: results.length,
      filters: { capability: capability || 'all', minScore },
    });
  } catch (err: any) {
    logger.error({ err }, 'A2A discovery failed');
    return c.json({ error: 'Discovery failed', code: 'AID_INTERNAL_ERROR' }, 500);
  }
});

export { router as aidA2aRouter };
