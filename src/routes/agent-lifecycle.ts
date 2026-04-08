/**
 * Agent Lifecycle Routes — wallet derivation, burner management, shutdown
 *
 * POST /v1/agent/identity       — Create agent identity from Heart
 * POST /v1/agent/wallet/derive  — Derive a new wallet from Heart root
 * POST /v1/agent/burner/create  — Spin up a burner agent
 * POST /v1/agent/burner/revoke  — Revoke a burner agent
 * GET  /v1/agent/burners        — List caller's burner agents
 * GET  /v1/agent/burner/:id     — Get burner status + effective trust
 * POST /v1/agent/shutdown       — Issue death certificate (irreversible)
 * GET  /v1/agent/:did/lifecycle  — Public lifecycle view (identity, death cert)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';
import {
  createAgentIdentity,
  deriveSolanaWallet,
  deriveEvmWalletSeed,
  createWalletOwnershipProof,
  deriveFromRoot,
} from '../core/soma-wallet';
import {
  createBurnerAgent,
  verifyBurnerAgent,
  revokeBurnerAgent,
  getBurnerAgent,
  listBurnerAgents,
  listActiveBurners,
  getBurnerEffectiveTrust,
  countActiveBurners,
} from '../core/burner-agent';
import {
  issueDeathCertificate,
  getDeathCertificateByDid,
  verifyDeathCertificate,
  isAgentDead,
} from '../core/death-certificate';
import { derivePlatformSeed } from '../utils/ed25519-signer';
import { somaHash } from '../utils/crypto-agility';
import { logger } from '../utils/logger';
import { maskApiKey } from '../utils/mask';
import { deductCredit } from '../db/index';
import { trackDelegatedSpend } from '../utils/billing';
import { round6 } from '../core/credits';
import { appendBurner, appendWallet, appendDeath, getAgentPulseState, generatePulseProof, getRecentLeaves, resolveAgentDid } from '../core/soma-heartbeat';

const router = new Hono();

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Derive an agent-specific root seed from the platform secret + API key.
 * Each API key holder gets a unique, deterministic Heart root.
 */
function agentRootSeed(apiKey: string): Buffer {
  const platformSeed = derivePlatformSeed('agent-roots');
  // HKDF with the API key as info — each key gets a unique root
  const { hkdfSync } = require('crypto');
  return Buffer.from(hkdfSync('sha256', platformSeed, '', `agent:${somaHash(apiKey)}`, 32));
}

// ─── POST /v1/agent/identity ────────────────────────────────────────────────

const identitySchema = z.object({
  genomeHash: z.string().optional(),
});

router.post('/identity', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const body = identitySchema.safeParse(await c.req.json().catch(() => ({})));

  const rootSeed = agentRootSeed(keyInfo.key);
  const identity = createAgentIdentity(rootSeed, body.success ? body.data.genomeHash : undefined);

  logger.info({ did: identity.did, key: maskApiKey(keyInfo.key) }, 'Agent identity created/retrieved');

  return c.json({
    ...identity,
    // Derive default Solana wallet
    defaultWallet: deriveSolanaWallet(rootSeed, 0),
  });
});

// ─── POST /v1/agent/wallet/derive ───────────────────────────────────────────

const walletSchema = z.object({
  chain: z.enum(['solana', 'evm']),
  index: z.number().int().min(0).max(99),
  withProof: z.boolean().optional().default(false),
});

router.post('/wallet/derive', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const body = walletSchema.parse(await c.req.json());

  const rootSeed = agentRootSeed(keyInfo.key);

  const identity = createAgentIdentity(rootSeed);

  if (body.chain === 'solana') {
    const wallet = deriveSolanaWallet(rootSeed, body.index);
    const proof = body.withProof ? createWalletOwnershipProof(rootSeed, wallet) : undefined;

    try {
      appendWallet(identity.did, { chain: 'solana', index: body.index, address: wallet.publicKey });
    } catch (err) {
      logger.warn({ err }, 'Pulse Tree wallet append failed (non-fatal)');
    }

    return c.json({ wallet, proof });
  }

  // EVM: return the derivation path + a note that the caller needs ethers/viem
  const evmSeed = deriveEvmWalletSeed(rootSeed, body.index);

  try {
    appendWallet(identity.did, { chain: 'evm', index: body.index, address: evmSeed.derivationPath });
  } catch (err) {
    logger.warn({ err }, 'Pulse Tree wallet append failed (non-fatal)');
  }

  return c.json({
    wallet: {
      purpose: evmSeed.purpose,
      derivationPath: evmSeed.derivationPath,
      note: 'Use soma-wallet.deriveEvmWalletSeed() locally to get the private key',
    },
  });
});

// ─── POST /v1/agent/burner/create ───────────────────────────────────────────

const burnerCreateSchema = z.object({
  taskId: z.string().min(1).max(64),
  ttlSeconds: z.number().int().min(60).max(86400).optional(),
  bondAmount: z.number().min(1).max(1000).optional(),
  maxSpend: z.number().min(1).max(10000).optional(),
  allowedEndpoints: z.array(z.string()).optional(),
  allowedActions: z.array(z.enum(['query', 'skill', 'discover'])).optional(),
  inheritanceFactor: z.number().min(0).max(0.5).optional(),
});

router.post('/burner/create', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const body = burnerCreateSchema.parse(await c.req.json());

  const rootSeed = agentRootSeed(keyInfo.key);
  const identity = createAgentIdentity(rootSeed);

  // Check if this agent is dead
  if (isAgentDead(identity.did)) {
    return c.json({ error: 'Agent has a death certificate — cannot create burners', code: 'AGENT_DEAD' }, 403);
  }

  // Deduct bond from parent's credits
  const bondAmount = round6(body.bondAmount ?? 5);
  if (!keyInfo.isEnvKey) {
    const deducted = deductCredit(keyInfo.key, bondAmount);
    if (!deducted) {
      return c.json({ error: 'Insufficient credits for burner bond', code: 'INSUFFICIENT_CREDITS', bondRequired: bondAmount }, 402);
    }
    trackDelegatedSpend(keyInfo, bondAmount);
  }

  // TODO: look up parent's actual trust score from Soma verdicts
  const parentTrustScore = 50; // Default for now

  const burner = createBurnerAgent({
    parentDid: identity.did,
    parentPublicKey: identity.signingPublicKey,
    parentRootSeed: rootSeed,
    taskId: body.taskId,
    ttlSeconds: body.ttlSeconds,
    bondAmount,
    maxSpend: body.maxSpend,
    allowedEndpoints: body.allowedEndpoints,
    allowedActions: body.allowedActions,
    inheritanceFactor: body.inheritanceFactor,
    parentTrustScore,
  });

  if (!burner) {
    // Refund bond if creation failed
    if (!keyInfo.isEnvKey) {
      const { topUpCredits } = await import('../db/index');
      topUpCredits(keyInfo.key, bondAmount);
    }
    return c.json({ error: 'Burner creation failed — max active limit reached', code: 'BURNER_LIMIT' }, 429);
  }

  // Pulse Tree: record burner creation
  try {
    appendBurner(identity.did, { action: 'create', burnerId: burner.id, bondAmount });
  } catch (err) {
    logger.warn({ err }, 'Pulse Tree burner append failed (non-fatal)');
  }

  return c.json({
    burner: {
      id: burner.id,
      publicKey: burner.publicKey,
      derivationPath: burner.derivationPath,
      expiresAt: burner.expiresAt,
      bondAmount: burner.bondAmount,
      maxSpend: burner.maxSpend,
      effectiveTrust: burner.inheritedTrust,
      allowedActions: burner.allowedActions,
    },
    parent: { did: identity.did },
  });
});

// ─── POST /v1/agent/burner/revoke ───────────────────────────────────────────

router.post('/burner/revoke', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const { burnerId, reason } = await c.req.json();

  if (!burnerId) return c.json({ error: 'burnerId required', code: 'MISSING_PARAM' }, 400);

  const burner = getBurnerAgent(burnerId);
  if (!burner) return c.json({ error: 'Burner not found', code: 'NOT_FOUND' }, 404);

  // Verify caller owns this burner's parent
  const rootSeed = agentRootSeed(keyInfo.key);
  const identity = createAgentIdentity(rootSeed);
  if (burner.parentDid !== identity.did) {
    return c.json({ error: 'Not your burner', code: 'FORBIDDEN' }, 403);
  }

  const refund = revokeBurnerAgent(burnerId, reason ?? 'manual');

  // Refund bond
  if (refund > 0 && !keyInfo.isEnvKey) {
    const { topUpCredits } = await import('../db/index');
    topUpCredits(keyInfo.key, refund);
  }

  // Pulse Tree: record burner revocation
  try {
    appendBurner(identity.did, { action: 'revoke', burnerId, bondAmount: refund });
  } catch (err) {
    logger.warn({ err }, 'Pulse Tree burner revoke append failed (non-fatal)');
  }

  return c.json({ revoked: true, bondRefunded: refund });
});

// ─── GET /v1/agent/burners ──────────────────────────────────────────────────

router.get('/burners', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const rootSeed = agentRootSeed(keyInfo.key);
  const identity = createAgentIdentity(rootSeed);

  const activeOnly = c.req.query('active') === 'true';
  const burners = activeOnly
    ? listActiveBurners(identity.did)
    : listBurnerAgents(identity.did);

  return c.json({
    parentDid: identity.did,
    totalActive: countActiveBurners(identity.did),
    burners: burners.map(b => ({
      id: b.id,
      status: b.status,
      publicKey: b.publicKey,
      expiresAt: b.expiresAt,
      bondAmount: b.bondAmount,
      spent: b.spent,
      maxSpend: b.maxSpend,
      effectiveTrust: b.status === 'active' ? getBurnerEffectiveTrust(b.id) : 0,
      createdAt: b.createdAt,
    })),
  });
});

// ─── GET /v1/agent/burner/:id ───────────────────────────────────────────────

router.get('/burner/:id', async (c) => {
  const burnerId = c.req.param('id');
  const verification = verifyBurnerAgent(burnerId);
  const burner = getBurnerAgent(burnerId);

  if (!burner) return c.json({ error: 'Burner not found', code: 'NOT_FOUND' }, 404);

  return c.json({
    burner: {
      id: burner.id,
      parentDid: burner.parentDid,
      status: burner.status,
      expiresAt: burner.expiresAt,
      bondAmount: burner.bondAmount,
      spent: burner.spent,
      maxSpend: burner.maxSpend,
      allowedActions: burner.allowedActions,
      createdAt: burner.createdAt,
    },
    verification,
  });
});

// ─── POST /v1/agent/shutdown ────────────────────────────────────────────────

const shutdownSchema = z.object({
  successorDid: z.string().optional(),
  trustInheritancePct: z.number().min(0).max(0.5).optional(),
  walletSweptTo: z.string().optional(),
  reason: z.enum(['graceful', 'migration', 'successor']).optional(),
});

router.post('/shutdown', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const body = shutdownSchema.parse(await c.req.json().catch(() => ({})));

  const rootSeed = agentRootSeed(keyInfo.key);
  const identity = createAgentIdentity(rootSeed);

  // Check if already dead
  if (isAgentDead(identity.did)) {
    return c.json({ error: 'Agent already has a death certificate', code: 'ALREADY_DEAD' }, 409);
  }

  // TODO: look up actual stats from DB
  const cert = issueDeathCertificate({
    agentDid: identity.did,
    agentPublicKey: identity.signingPublicKey,
    agentRootSeed: rootSeed,
    finalTrustScore: 50, // TODO: real score from soma verdicts
    totalTransactionsProcessed: 0,
    totalCreditsProcessed: 0,
    activeDurationHours: 0,
    finalHeartbeatIndex: 0,
    walletSweptTo: body.walletSweptTo,
    successorDid: body.successorDid,
    trustInheritancePct: body.trustInheritancePct,
    reason: body.reason ?? 'graceful',
  });

  // Pulse Tree: seal with DEATH leaf (final event)
  try {
    appendDeath(identity.did, {
      reason: body.reason ?? 'graceful',
      successorDid: body.successorDid,
      finalBalance: cert.totalCredits,
    });
  } catch (err) {
    logger.warn({ err }, 'Pulse Tree death append failed (non-fatal)');
  }

  const verification = verifyDeathCertificate(cert);

  return c.json({
    deathCertificate: {
      id: cert.id,
      agentDid: cert.agentDid,
      finalTrustScore: cert.finalTrustScore,
      burnersRevoked: cert.burnersRevoked,
      successorDid: cert.successorDid,
      trustTransferAmount: cert.trustTransferAmount,
      contestationEndsAt: cert.contestationEndsAt,
      chainHash: cert.chainHash,
      reason: cert.reason,
      createdAt: cert.createdAt,
    },
    verification,
    warning: 'This action is IRREVERSIBLE. The agent Heart is now terminated.',
  });
});

// ─── GET /v1/agent/:did/lifecycle ───────────────────────────────────────────

router.get('/:did/lifecycle', async (c) => {
  const did = c.req.param('did');

  const deathCert = getDeathCertificateByDid(did);
  const isDead = !!deathCert;

  return c.json({
    did,
    alive: !isDead,
    ...(deathCert && {
      deathCertificate: {
        id: deathCert.id,
        finalTrustScore: deathCert.finalTrustScore,
        burnersRevoked: deathCert.burnersRevoked,
        successorDid: deathCert.successorDid,
        trustTransferAmount: deathCert.trustTransferAmount,
        trustTransferPending: deathCert.trustTransferPending,
        contestationEndsAt: deathCert.contestationEndsAt,
        reason: deathCert.reason,
        createdAt: deathCert.createdAt,
        verification: verifyDeathCertificate(deathCert),
      },
    }),
  });
});

// ─── GET /v1/agent/:did/heartbeat ──────────────────────────────────────────

router.get('/:did/heartbeat', async (c) => {
  const did = c.req.param('did');
  const state = getAgentPulseState(did);

  if (!state) return c.json({ error: 'No pulse state for this agent', code: 'NOT_FOUND' }, 404);

  return c.json({
    did,
    heartbeatIndex: state.heartbeatIndex,
    leafCount: state.leafCount,
    totalCredits: state.totalCredits,
    root: state.root,
    alive: state.heartbeatIndex > 0,
  });
});

// ─── GET /v1/agent/:did/pulse/proof/:leafIndex ────────────────────────────

router.get('/:did/pulse/proof/:leafIndex', async (c) => {
  const did = c.req.param('did');
  const leafIndex = parseInt(c.req.param('leafIndex'), 10);

  if (isNaN(leafIndex) || leafIndex < 0) {
    return c.json({ error: 'Invalid leaf index', code: 'INVALID_PARAM' }, 400);
  }

  try {
    const proof = generatePulseProof(did, leafIndex);
    return c.json({ proof });
  } catch (err: any) {
    return c.json({ error: err.message, code: 'PROOF_ERROR' }, 400);
  }
});

// ─── GET /v1/agent/:did/pulse/leaves ──────────────────────────────────────

router.get('/:did/pulse/leaves', async (c) => {
  const did = c.req.param('did');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);

  const leaves = getRecentLeaves(did, limit);
  return c.json({ did, leaves });
});

// ─── GET /v1/agent/me/pulse ───────────────────────────────────────────────

router.get('/me/pulse', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const agentDid = resolveAgentDid(keyInfo.key);
  const state = getAgentPulseState(agentDid);

  return c.json({
    did: agentDid,
    ...(state ?? { heartbeatIndex: 0, leafCount: 0, totalCredits: 0, root: '' }),
  });
});

export { router as agentLifecycleRouter };
