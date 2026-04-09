/**
 * Agent Identity routes — KYA (Know Your Agent) compatible identity system
 *
 * POST   /v1/identity           — Register agent identity (auth)
 * GET    /v1/identity           — Get own identity (auth)
 * PATCH  /v1/identity           — Update identity (auth)
 * POST   /v1/identity/jwt       — Issue/refresh JWT (auth)
 * GET    /v1/identity/browse    — Browse public agent identities (public)
 * GET    /v1/identity/:id       — Public identity lookup (public)
 * GET    /v1/identity/:id/verify — Verify identity JWT (public)
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';
import { hashApiKey } from '../db/attestations';
import {
  createAgentIdentity,
  getAgentIdentity,
  getAgentIdentityById,
  updateAgentIdentity,
  refreshIdentityJwt,
  getPublicIdentity,
  listPublicIdentities,
  verifyIdentityJwt,
} from '../db/identities';
import { getDb, logAudit } from '../db/connection';
import { somaHash } from '../utils/crypto-agility';
import { getIdentityTier, getCompositeIdentity, type IdentityTier } from '../core/trust-oracle';
import { createAgentBookVerifier } from '@worldcoin/agentkit-core';
import { logger } from '../utils/logger';

// ─── AgentBook Verifier (singleton) ────────────────────────────────────────
// On-chain lookup against World Chain AgentBook contract.
// Confirms a wallet has been registered by an iris-verified human via Orb.
let _agentBook: ReturnType<typeof createAgentBookVerifier> | null = null;
function getAgentBook() {
  if (!_agentBook) _agentBook = createAgentBookVerifier();
  return _agentBook;
}

// ─── Zod Schemas ────────────────────────────────────────────────────────────

const CreateIdentitySchema = z.object({
  display_name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  agent_type: z.enum(['autonomous', 'semi-autonomous', 'supervised', 'tool']).default('autonomous'),
  capabilities: z.array(z.string().max(50)).max(20).optional(),
  public_profile: z.boolean().default(true),
  metadata: z.record(z.unknown()).optional(),
});

const UpdateIdentitySchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  agent_type: z.enum(['autonomous', 'semi-autonomous', 'supervised', 'tool']).optional(),
  capabilities: z.array(z.string().max(50)).max(20).optional(),
  public_profile: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatIdentityResponse(identity: ReturnType<typeof getAgentIdentity>) {
  if (!identity) return null;
  return {
    id: identity.id,
    display_name: identity.display_name,
    description: identity.description,
    agent_type: identity.agent_type,
    capabilities: JSON.parse(identity.capabilities_json || '[]'),
    owner_verified: identity.owner_verified === 1,
    verification_method: identity.verification_method,
    public_profile: identity.public_profile === 1,
    jwt_issued_at: identity.jwt_issued_at,
    jwt_expires_at: identity.jwt_expires_at,
    metadata: identity.metadata_json ? JSON.parse(identity.metadata_json) : null,
    created_at: identity.created_at,
    updated_at: identity.updated_at,
    profile_url: `https://api.claw-net.org/v1/identity/${identity.id}`,
  };
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const identityRouter = new Hono();

// POST /v1/identity — Register agent identity
identityRouter.post('/', checkApiKey, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CreateIdentitySchema.safeParse(body);

  if (!parsed.success) {
    return c.json({
      error: parsed.error.errors[0]?.message || 'Invalid request body',
      code: 'INVALID_IDENTITY',
      details: parsed.error.flatten().fieldErrors,
    }, 400);
  }

  const keyInfo = c.get('apiKeyInfo') as { key: string };
  const apiKey = keyInfo.key;

  try {
    const identity = createAgentIdentity({
      apiKey,
      displayName: parsed.data.display_name,
      description: parsed.data.description,
      agentType: parsed.data.agent_type,
      capabilities: parsed.data.capabilities,
      publicProfile: parsed.data.public_profile,
      metadata: parsed.data.metadata,
    });

    return c.json({
      ...formatIdentityResponse(identity),
      identity_jwt: identity.identity_jwt,
    }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('already exists')) {
      return c.json({ error: 'Agent identity already exists for this API key', code: 'IDENTITY_EXISTS' }, 409);
    }
    logger.error({ err }, 'Identity creation failed');
    return c.json({ error: 'Identity creation failed', code: 'IDENTITY_CREATION_FAILED' }, 500);
  }
});

// GET /v1/identity — Get own identity
identityRouter.get('/', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo') as { key: string };
  const apiKeyHash = hashApiKey(keyInfo.key);

  const identity = getAgentIdentity(apiKeyHash);
  if (!identity) {
    return c.json({ error: 'No identity registered for this API key', code: 'IDENTITY_NOT_FOUND' }, 404);
  }

  return c.json({
    ...formatIdentityResponse(identity),
    identity_jwt: identity.identity_jwt,
  });
});

// PATCH /v1/identity — Update identity
identityRouter.patch('/', checkApiKey, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = UpdateIdentitySchema.safeParse(body);

  if (!parsed.success) {
    return c.json({
      error: parsed.error.errors[0]?.message || 'Invalid request body',
      code: 'INVALID_UPDATE',
      details: parsed.error.flatten().fieldErrors,
    }, 400);
  }

  const keyInfo = c.get('apiKeyInfo') as { key: string };
  const apiKey = keyInfo.key;
  const apiKeyHash = hashApiKey(apiKey);

  const identity = getAgentIdentity(apiKeyHash);
  if (!identity) {
    return c.json({ error: 'No identity registered for this API key', code: 'IDENTITY_NOT_FOUND' }, 404);
  }

  const updated = updateAgentIdentity(identity.id, {
    displayName: parsed.data.display_name,
    description: parsed.data.description,
    agentType: parsed.data.agent_type,
    capabilities: parsed.data.capabilities,
    publicProfile: parsed.data.public_profile,
    metadata: parsed.data.metadata,
  }, apiKey);

  return c.json(formatIdentityResponse(updated));
});

// POST /v1/identity/jwt — Issue/refresh JWT
identityRouter.post('/jwt', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo') as { key: string };
  const apiKey = keyInfo.key;
  const apiKeyHash = hashApiKey(apiKey);

  const identity = getAgentIdentity(apiKeyHash);
  if (!identity) {
    return c.json({ error: 'No identity registered for this API key', code: 'IDENTITY_NOT_FOUND' }, 404);
  }

  const refreshed = refreshIdentityJwt(identity.id, apiKey);
  if (!refreshed) {
    return c.json({ error: 'Failed to refresh JWT', code: 'JWT_REFRESH_FAILED' }, 500);
  }

  return c.json({
    identity_jwt: refreshed.identity_jwt,
    jwt_issued_at: refreshed.jwt_issued_at,
    jwt_expires_at: refreshed.jwt_expires_at,
  });
});

// GET /v1/identity/browse — Browse public agent identities (NO auth)
identityRouter.get('/browse', async (c) => {
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const result = listPublicIdentities(limit, offset);

  return c.json({
    agents: result.identities,
    total: result.total,
    limit: Math.min(Math.max(1, limit), 50),
    offset: Math.max(0, offset),
  });
});

// GET /v1/identity/:id/verify — Verify identity JWT (NO auth)
identityRouter.get('/:id/verify', async (c) => {
  const id = c.req.param('id');

  const identity = getAgentIdentityById(id);
  if (!identity) {
    return c.json({ error: 'Identity not found', code: 'IDENTITY_NOT_FOUND' }, 404);
  }

  if (!identity.identity_jwt) {
    return c.json({ error: 'No JWT issued for this identity', code: 'NO_JWT' }, 404);
  }

  const result = verifyIdentityJwt(identity.identity_jwt);

  return c.json({
    identity_id: id,
    valid: result.valid,
    reason: result.reason,
    agent_type: identity.agent_type,
    display_name: identity.display_name,
    owner_verified: identity.owner_verified === 1,
    jwt_issued_at: identity.jwt_issued_at,
    jwt_expires_at: identity.jwt_expires_at,
    verified_at: new Date().toISOString(),
  });
});

// GET /v1/identity/:id — Public identity lookup (NO auth)
identityRouter.get('/:id', async (c) => {
  const id = c.req.param('id');

  const identity = getPublicIdentity(id);
  if (!identity) {
    return c.json({ error: 'Identity not found or not public', code: 'IDENTITY_NOT_FOUND' }, 404);
  }

  return c.json({
    id: identity.id,
    display_name: identity.display_name,
    description: identity.description,
    agent_type: identity.agent_type,
    capabilities: JSON.parse(identity.capabilities_json || '[]'),
    owner_verified: identity.owner_verified === 1,
    verification_method: identity.verification_method,
    metadata: identity.metadata_json ? JSON.parse(identity.metadata_json) : null,
    created_at: identity.created_at,
    profile_url: `https://api.claw-net.org/v1/identity/${identity.id}`,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Identity Verification — Operator verification tiers (biometric/KYC/passport)
// Three-axis trust: behavioral * proof * identity
// ═══════════════════════════════════════════════════════════════════════════

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Map identity tier to signal type for the new multi-provider table. */
const TIER_TO_SIGNAL: Record<string, string> = {
  'biometric': 'biometric',
  'kyc-attested': 'kyc',
  'passport': 'passport',
};

function upsertIdentityVerification(
  agentDid: string,
  tier: IdentityTier,
  provider: string,
  walletAddress: string | null,
  verificationData: string,
  expiresAt: string | null,
): void {
  const verificationHash = somaHash(verificationData);

  // Write to legacy table (backward compat)
  getDb().prepare(`
    INSERT INTO agent_identity_verification
      (agent_did, identity_tier, provider, verification_hash, wallet_address, verified_at, expires_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), ?, datetime('now'))
    ON CONFLICT(agent_did) DO UPDATE SET
      identity_tier = excluded.identity_tier,
      provider = excluded.provider,
      verification_hash = excluded.verification_hash,
      wallet_address = excluded.wallet_address,
      verified_at = datetime('now'),
      expires_at = excluded.expires_at,
      updated_at = datetime('now')
  `).run(agentDid, tier, provider, verificationHash, walletAddress, expiresAt);

  // Write to new multi-provider signals table (composite identity)
  const signalType = TIER_TO_SIGNAL[tier];
  if (signalType) {
    getDb().prepare(`
      INSERT INTO agent_identity_signals
        (agent_did, signal_type, provider, signal_score, verification_hash, verified_at, expires_at, wallet_address, updated_at)
      VALUES (?, ?, ?, 1.0, ?, datetime('now'), ?, ?, datetime('now'))
      ON CONFLICT(agent_did, signal_type) DO UPDATE SET
        provider = excluded.provider,
        signal_score = excluded.signal_score,
        verification_hash = excluded.verification_hash,
        verified_at = datetime('now'),
        expires_at = excluded.expires_at,
        wallet_address = excluded.wallet_address,
        updated_at = datetime('now')
    `).run(agentDid, signalType, provider, verificationHash, expiresAt, walletAddress);
  }

  logAudit({
    entityType: 'identity_verification',
    entityId: agentDid,
    action: 'identity_verified',
    data: { tier, provider },
  });
}

// ─── GET /v1/identity/verify/:did — Get identity tier for an agent ─────────

identityRouter.get('/verify/:did', async (c) => {
  const did = c.req.param('did');
  const composite = getCompositeIdentity(did);

  // Also fetch per-signal details from signals table
  const signals = getDb().prepare(
    'SELECT signal_type, provider, signal_score, verified_at, expires_at, wallet_address FROM agent_identity_signals WHERE agent_did = ?'
  ).all(did) as Array<{
    signal_type: string; provider: string; signal_score: number;
    verified_at: string | null; expires_at: string | null; wallet_address: string | null;
  }>;

  return c.json({
    agentDid: did,
    identityTier: composite.legacyTier,
    identityScore: composite.compositeScore,
    effectiveMultiplier: composite.effectiveMultiplier,
    signals: composite.signals,
    signalCount: composite.signalCount,
    verifications: signals.map(s => ({
      signalType: s.signal_type,
      provider: s.provider,
      score: s.signal_score,
      verifiedAt: s.verified_at,
      expiresAt: s.expires_at,
      walletAddress: s.wallet_address,
    })),
  });
});

// ─── POST /v1/identity/verify/passport — Human Passport verification ───────
// Calls passport.xyz API to get Humanity Score. Score >= 20 = verified human.
// Free tier — no biometrics, ML-based on-chain behavior analysis.

const PassportVerifySchema = z.object({
  agent_did: z.string().min(1),
  wallet_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM address'),
});

identityRouter.post('/verify/passport', checkApiKey, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = PassportVerifySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.errors[0]?.message, code: 'INVALID_REQUEST' }, 400);
  }

  const { agent_did, wallet_address } = parsed.data;

  try {
    // Call Human Passport API
    const resp = await fetch(`https://api.passport.xyz/v2/stamps/${wallet_address}/score`, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (!resp.ok) {
      logger.warn({ status: resp.status, wallet: wallet_address }, 'Human Passport API error');
      return c.json({ error: 'Human Passport API unavailable', code: 'PASSPORT_API_ERROR' }, 502);
    }

    const data = await resp.json() as { score?: number; status?: string };
    const score = data.score ?? 0;
    const PASSPORT_THRESHOLD = 20;

    if (score < PASSPORT_THRESHOLD) {
      return c.json({
        error: 'Humanity score below threshold',
        code: 'PASSPORT_SCORE_LOW',
        score,
        threshold: PASSPORT_THRESHOLD,
        hint: 'Build on-chain activity to raise your Humanity Score',
      }, 403);
    }

    // Verification passes — expires in 90 days (scores can change)
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    upsertIdentityVerification(agent_did, 'passport', 'human-passport', wallet_address, JSON.stringify(data), expiresAt);

    logger.info({ agentDid: agent_did, score }, 'Human Passport verification passed');

    return c.json({
      ok: true,
      agentDid: agent_did,
      identityTier: 'passport' as IdentityTier,
      humanityScore: score,
      expiresAt,
    });
  } catch (err) {
    logger.error({ err, wallet: wallet_address }, 'Human Passport verification failed');
    return c.json({ error: 'Verification failed', code: 'PASSPORT_FAILED' }, 500);
  }
});

// ─── POST /v1/identity/verify/coinbase — Coinbase EAS attestation check ────
// Queries EAS on Base mainnet to check if wallet has Coinbase Verified Account.
// Uses the Coinbase Indexer contract to look up attestations.

const COINBASE_ATTESTER = '0x357458739F90461b99789350868CD7CF330Dd7EE';
const COINBASE_SCHEMA_UID = '0xf8b05c79f090979bf4a80270aba232dff11a10d9ca55c4f88de95317970f0de9';
const COINBASE_INDEXER = '0x2c7eE1E5f416dfF40054c27A62f7B357C4E8619C';

const CoinbaseVerifySchema = z.object({
  agent_did: z.string().min(1),
  wallet_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM address'),
});

identityRouter.post('/verify/coinbase', checkApiKey, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CoinbaseVerifySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.errors[0]?.message, code: 'INVALID_REQUEST' }, 400);
  }

  const { agent_did, wallet_address } = parsed.data;

  try {
    // Query Coinbase Indexer contract on Base via eth_call
    // getAttestationUid(address schemaId, address recipient) → bytes32
    // Function selector: keccak256("getAttestationUid(bytes32,address)")
    // We encode: schemaUID (bytes32) + recipient address (address padded to 32 bytes)
    const baseRpc = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
    const recipientPadded = wallet_address.toLowerCase().replace('0x', '').padStart(64, '0');
    const schemaUidClean = COINBASE_SCHEMA_UID.replace('0x', '');
    // getAttestationUid(bytes32,address) selector: 0x1a02dd87 (pre-computed)
    const calldata = `0x1a02dd87${schemaUidClean}${recipientPadded}`;

    const resp = await fetch(baseRpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{ to: COINBASE_INDEXER, data: calldata }, 'latest'],
        id: 1,
      }),
    });

    const rpcResult = await resp.json() as { result?: string; error?: { message: string } };

    if (rpcResult.error) {
      logger.warn({ error: rpcResult.error }, 'Base RPC error for Coinbase attestation');
      return c.json({ error: 'Base RPC error', code: 'RPC_ERROR' }, 502);
    }

    // Result is bytes32 UID — 0x0000...0000 means no attestation
    const uid = rpcResult.result ?? '0x0000000000000000000000000000000000000000000000000000000000000000';
    const hasAttestation = uid !== '0x0000000000000000000000000000000000000000000000000000000000000000'
      && uid !== '0x' && uid.length > 2;

    if (!hasAttestation) {
      return c.json({
        error: 'No Coinbase verification attestation found for this wallet',
        code: 'COINBASE_NOT_VERIFIED',
        wallet: wallet_address,
        hint: 'Verify your identity at coinbase.com — attestations are issued on Base',
      }, 403);
    }

    // Attestation found — expires in 180 days (attestation is persistent but we re-check periodically)
    const expiresAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
    upsertIdentityVerification(agent_did, 'kyc-attested', 'coinbase', wallet_address, uid, expiresAt);

    logger.info({ agentDid: agent_did, attestationUid: uid }, 'Coinbase KYC attestation verified');

    return c.json({
      ok: true,
      agentDid: agent_did,
      identityTier: 'kyc-attested' as IdentityTier,
      attestationUid: uid,
      attester: COINBASE_ATTESTER,
      expiresAt,
    });
  } catch (err) {
    logger.error({ err, wallet: wallet_address }, 'Coinbase verification failed');
    return c.json({ error: 'Verification failed', code: 'COINBASE_FAILED' }, 500);
  }
});

// ─── POST /v1/identity/verify/world — World AgentKit biometric verification ──
// Verifies wallet is registered in AgentBook on Worldchain (on-chain lookup).
// Registration requires physical Orb iris scan → World App → AgentBook contract.
// Flow: human scans iris → registers agent wallet via `npx @worldcoin/agentkit-cli register` → we verify here.

const WorldVerifySchema = z.object({
  agent_did: z.string().min(1),
  wallet_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM address'),
});

identityRouter.post('/verify/world', checkApiKey, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = WorldVerifySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.errors[0]?.message, code: 'INVALID_REQUEST' }, 400);
  }

  const { agent_did, wallet_address } = parsed.data;

  try {
    // On-chain lookup: check AgentBook contract on Worldchain
    // Returns humanId (nullifier hash) if wallet is registered by an iris-verified human, null otherwise
    const agentBook = getAgentBook();
    const humanId = await agentBook.lookupHuman(wallet_address, 'eip155:480');

    if (!humanId) {
      return c.json({
        error: 'Wallet not registered in AgentBook — no iris verification found',
        code: 'WORLD_NOT_REGISTERED',
        wallet: wallet_address,
        hint: 'Register via: npx @worldcoin/agentkit-cli register <wallet>',
      }, 403);
    }

    // Wallet is registered by an iris-verified human — store biometric tier (365-day expiry)
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    upsertIdentityVerification(
      agent_did, 'biometric', 'world',
      wallet_address, humanId, expiresAt,
    );

    logger.info({ agentDid: agent_did, humanId, wallet: wallet_address }, 'World biometric verification confirmed (AgentBook on-chain)');

    return c.json({
      ok: true,
      agentDid: agent_did,
      identityTier: 'biometric' as IdentityTier,
      humanId,
      expiresAt,
    });
  } catch (err) {
    logger.error({ err, agentDid: agent_did }, 'World verification failed');
    return c.json({ error: 'Verification failed', code: 'WORLD_FAILED' }, 500);
  }
});
