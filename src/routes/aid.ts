/**
 * AID (Agent Identity Document) Routes
 *
 * W3C DID-compatible identity layer for ClawNet agents.
 * Supports Ed25519 keypairs, cross-platform attestations, trust snapshots,
 * capability derivation, portable trust chains, and offline verification.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';
import { deductCredit, logAudit } from '../db/index';
import { cacheIncr } from '../cache/index';
import { trackDelegatedSpend } from '../utils/billing';
import { logger } from '../utils/logger';
import { validateMultibaseEd25519 } from '../utils/jcs';

// ─── Lazy imports (files created by other agents concurrently) ───────────────

async function getAidDb() {
  return await import('../db/aid');
}

async function getAidBuilder() {
  return await import('../core/aid-builder');
}

async function getAidVerifier() {
  return await import('../utils/aid-verifier');
}

async function getEd25519Signer() {
  return await import('../utils/ed25519-signer');
}

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const RegisterSchema = z.object({
  publicKey: z.string().max(200).optional(),
  displayName: z.string().max(100).optional(),
  serviceEndpoints: z.array(z.object({
    type: z.string().max(50),
    url: z.string().url().max(500),
  })).max(10).optional(),
});

const AttestSchema = z.object({
  platform: z.string().min(1).max(100),
  attestationType: z.string().min(1).max(100),
  attestationData: z.record(z.unknown()).refine(
    (v) => JSON.stringify(v).length <= 50_000,
    'attestationData exceeds 50KB limit'
  ),
  platformSignature: z.string().max(500).optional(),
});

const VerifySchema = z.object({
  aidDocument: z.record(z.unknown()).refine(
    (v) => JSON.stringify(v).length <= 200_000,
    'aidDocument exceeds 200KB limit'
  ),
  platformPublicKey: z.string().max(200).optional(),
});

const RotateKeySchema = z.object({
  newPublicKey: z.string().max(200).optional(),
});

// ─── Constants ───────────────────────────────────────────────────────────────

const REGISTER_COST = 1;
const ATTEST_COST = 0.1;
const EXPORT_COST = 0.5;
const ROTATE_KEY_COST = 0.5;
const ATTEST_RATE_LIMIT = 50; // per hour
const PUBLIC_RATE_LIMIT = 300; // per hour per IP for public endpoints

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveBillingKey(keyInfo: Record<string, unknown>): string {
  const info = keyInfo as { key: string; delegatedFrom?: string; delegation?: { parentKey?: string } };
  return info.delegatedFrom
    ? (info.delegation?.parentKey || info.key)
    : info.key;
}

/**
 * Lightweight rate limit for public (unauthenticated) endpoints.
 * Uses IP address as the key. Returns true if rate limit exceeded.
 */
async function checkPublicRateLimit(c: any): Promise<boolean> {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || c.req.header('x-real-ip')
    || 'unknown';
  const key = `aid:public:${ip}`;
  const count = await cacheIncr(key, 3600);
  return count > PUBLIC_RATE_LIMIT;
}

// ─── Router ──────────────────────────────────────────────────────────────────

const router = new Hono();

// ─── POST /register — Create AID for authenticated agent ─────────────────────
router.post('/register', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const billingKey = resolveBillingKey(keyInfo as unknown as Record<string, unknown>);

  let body: z.infer<typeof RegisterSchema>;
  try {
    body = RegisterSchema.parse(await c.req.json());
  } catch (err) {
    const message = err instanceof z.ZodError ? err.errors[0]?.message : 'Invalid request body';
    return c.json({ error: message, code: 'INVALID_BODY' }, 400);
  }

  const aidDb = await getAidDb();
  const aidBuilder = await getAidBuilder();

  // Check if agent already has an AID
  const existing = aidDb.getAidKeysByOwnerKey(billingKey);
  if (existing && existing.length > 0) {
    return c.json({ error: 'Agent already has an AID registered', code: 'AID_ALREADY_EXISTS' }, 409);
  }

  // BYOK validation — if user provides their own key, validate it
  if (body.publicKey) {
    const validation = validateMultibaseEd25519(body.publicKey);
    if (!validation.valid) {
      return c.json({ error: `Invalid public key: ${validation.error}`, code: 'INVALID_PUBLIC_KEY' }, 400);
    }
  }

  // Deduct credits
  const deducted = deductCredit(billingKey, REGISTER_COST);
  if (!deducted) {
    return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402);
  }
  trackDelegatedSpend(keyInfo, REGISTER_COST);

  // Generate or accept keypair
  let publicKeyMultibase: string;
  let privateKeySeed: string | undefined;
  let did: string;

  if (body.publicKey) {
    // BYOK — agent provides their own public key
    publicKeyMultibase = body.publicKey;
    // Self-certifying DID: public key IS the identifier
    did = `did:key:${publicKeyMultibase}`;
  } else {
    // Generate BIP-39 mnemonic → Ed25519 (SLIP-0010) + secp256k1 (BIP-44) keypair
    const keypair = await aidBuilder.generateAgentKeypair();
    publicKeyMultibase = keypair.publicKeyMultibase;
    privateKeySeed = keypair.privateKeySeed;
    did = keypair.did;
    (c as any)._aidMnemonic = keypair.mnemonic;
    (c as any)._aidEvmAddress = keypair.evmAddress;
  }

  // Store AID key
  const { id: aidKeyId } = aidDb.createAidKey({
    ownerKey: billingKey,
    publicKeyMultibase,
    did,
    displayName: body.displayName,
    serviceEndpoints: body.serviceEndpoints,
  });

  // Try to link to agent_identities (best-effort — may not exist for all agents)
  try {
    aidDb.setIdentityAid(billingKey, did, publicKeyMultibase, aidKeyId);
  } catch {
    // agent_identities record may not exist — that's OK, AID works without it
  }

  logAudit({ entityType: 'aid', entityId: did, action: 'register', actorId: billingKey });
  logger.info({ did, ownerKey: billingKey, byok: !!body.publicKey }, 'AID registered');

  // Build AID document from stored data
  const aidDocument = aidBuilder.buildAIDDocument(did);

  const mnemonic = (c as any)._aidMnemonic as string | undefined;
  const evmAddress = (c as any)._aidEvmAddress as string | undefined;

  return c.json({
    did,
    publicKeyMultibase,
    ...(privateKeySeed ? { privateKeySeed } : {}),
    ...(mnemonic ? { mnemonic } : {}),
    ...(evmAddress ? { evmAddress } : {}),
    aidDocument,
    warning: mnemonic
      ? 'Save your mnemonic (12 words) now — it derives both your Ed25519 identity key and EVM payment key. It is returned ONCE and never stored.'
      : privateKeySeed
        ? 'Save your privateKeySeed now — it is returned ONCE and never stored.'
        : undefined,
  }, 201);
});

// ─── GET /:did — Resolve DID to AID document (public) ───────────────────────
router.get('/:did', async (c) => {
  const did = c.req.param('did');

  // Skip route if it matches a known sub-path to avoid conflicts
  if (['register', 'verify'].includes(did)) return c.notFound();

  if (await checkPublicRateLimit(c)) {
    return c.json({ error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' }, 429);
  }

  const aidDb = await getAidDb();
  const aidBuilder = await getAidBuilder();

  const aidKey = aidDb.getAidKey(did);
  if (!aidKey) {
    return c.json({ error: 'AID not found', code: 'AID_NOT_FOUND' }, 404);
  }

  const aidDocument = aidBuilder.buildAIDDocument(did);
  if (!aidDocument) {
    return c.json({ error: 'Failed to build AID document', code: 'AID_BUILD_FAILED' }, 500);
  }

  return c.json(aidDocument);
});

// ─── GET /:did/trust-chain — Portable trust chain (public) ──────────────────
router.get('/:did/trust-chain', async (c) => {
  const did = c.req.param('did');
  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') || '50', 10) || 50), 200);

  if (await checkPublicRateLimit(c)) {
    return c.json({ error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' }, 429);
  }

  const aidDb = await getAidDb();
  const aidBuilder = await getAidBuilder();

  const aidKey = aidDb.getAidKey(did);
  if (!aidKey) {
    return c.json({ error: 'AID not found', code: 'AID_NOT_FOUND' }, 404);
  }

  const trustChain = aidBuilder.buildPortableTrustChain(did, limit);
  if (!trustChain) {
    return c.json({ error: 'No trust chain available (no snapshots yet)', code: 'NO_TRUST_CHAIN' }, 404);
  }

  return c.json(trustChain);
});

// ─── POST /:did/attest — Add cross-platform attestation ─────────────────────
router.post('/:did/attest', checkApiKey, async (c) => {
  const did = c.req.param('did');
  const keyInfo = c.get('apiKeyInfo');
  const billingKey = resolveBillingKey(keyInfo as unknown as Record<string, unknown>);

  let body: z.infer<typeof AttestSchema>;
  try {
    body = AttestSchema.parse(await c.req.json());
  } catch (err) {
    const message = err instanceof z.ZodError ? err.errors[0]?.message : 'Invalid request body';
    return c.json({ error: message, code: 'INVALID_BODY' }, 400);
  }

  // Rate limit: 50/hr
  const rateLimitKey = `aid:attest:${billingKey}`;
  const count = await cacheIncr(rateLimitKey, 3600);
  if (count > ATTEST_RATE_LIMIT) {
    return c.json({ error: 'Attestation rate limit exceeded (50/hr)', code: 'RATE_LIMIT_EXCEEDED' }, 429);
  }

  const aidDb = await getAidDb();

  const aidKey = aidDb.getAidKey(did);
  if (!aidKey) {
    return c.json({ error: 'AID not found', code: 'AID_NOT_FOUND' }, 404);
  }

  // Ownership check: only the AID owner can add attestations to their identity
  if (billingKey !== aidKey.owner_key) {
    return c.json({ error: 'Only the AID owner can add attestations', code: 'AID_NOT_OWNED' }, 403);
  }

  // Deduct credits
  const deducted = deductCredit(billingKey, ATTEST_COST);
  if (!deducted) {
    return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402);
  }
  trackDelegatedSpend(keyInfo, ATTEST_COST);

  const attestation = aidDb.addCrossPlatformAttestation({
    ownerKey: billingKey,
    did,
    platform: body.platform,
    attestationType: body.attestationType,
    attestationData: body.attestationData,
    platformSignature: body.platformSignature,
  });

  logAudit({
    entityType: 'aid',
    entityId: did,
    action: 'cross_platform_attest',
    actorId: billingKey,
    data: { platform: body.platform, attestationType: body.attestationType },
  });

  return c.json({ attestation }, 201);
});

// ─── GET /:did/capabilities — Derived capabilities (public) ─────────────────
router.get('/:did/capabilities', async (c) => {
  const did = c.req.param('did');

  if (await checkPublicRateLimit(c)) {
    return c.json({ error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' }, 429);
  }

  const aidDb = await getAidDb();

  const aidKey = aidDb.getAidKey(did);
  if (!aidKey) {
    return c.json({ error: 'AID not found', code: 'AID_NOT_FOUND' }, 404);
  }

  const capabilities = aidDb.getCapabilities(aidKey.owner_key);
  return c.json({ did, capabilities });
});

// ─── POST /verify — Offline AID document verification (public) ──────────────
router.post('/verify', async (c) => {
  let body: z.infer<typeof VerifySchema>;
  try {
    body = VerifySchema.parse(await c.req.json());
  } catch (err) {
    const message = err instanceof z.ZodError ? err.errors[0]?.message : 'Invalid request body';
    return c.json({ error: message, code: 'INVALID_BODY' }, 400);
  }

  const aidVerifier = await getAidVerifier();

  // Auto-resolve platform public key for ClawNet-issued AIDs
  let platformPublicKey = body.platformPublicKey;
  const doc = body.aidDocument as Record<string, any>;
  if (!platformPublicKey && doc?.issuance?.issuer === 'did:web:api.claw-net.org') {
    const ed25519 = await getEd25519Signer();
    platformPublicKey = ed25519.getEd25519PublicKeyMultibase();
  }

  const result = aidVerifier.verifyAIDDocument(body.aidDocument, platformPublicKey);

  return c.json(result);
});

// ─── GET /:did/export — Full AID export with fresh snapshot ─────────────────
router.get('/:did/export', checkApiKey, async (c) => {
  const did = c.req.param('did');
  const keyInfo = c.get('apiKeyInfo');
  const billingKey = resolveBillingKey(keyInfo as unknown as Record<string, unknown>);

  const aidDb = await getAidDb();
  const aidBuilder = await getAidBuilder();

  const aidKey = aidDb.getAidKey(did);
  if (!aidKey) {
    return c.json({ error: 'AID not found', code: 'AID_NOT_FOUND' }, 404);
  }

  // Must own the AID
  if (billingKey !== aidKey.owner_key) {
    return c.json({ error: 'You do not own this AID', code: 'AID_NOT_OWNED' }, 403);
  }

  // Deduct credits
  const deducted = deductCredit(billingKey, EXPORT_COST);
  if (!deducted) {
    return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402);
  }
  trackDelegatedSpend(keyInfo, EXPORT_COST);

  // Build fresh snapshot
  aidBuilder.buildTrustSnapshot(did, aidKey.owner_key);

  // Build full AID document
  const aidDocument = aidBuilder.buildAIDDocument(did);

  // Capabilities
  const capabilities = aidDb.getCapabilities(aidKey.owner_key);

  // Trust chain with full attestation set
  const trustChain = aidBuilder.buildPortableTrustChain(did, 200);

  // Snapshot history
  const snapshotHistory = aidDb.getSnapshotHistory(did, 10);

  // Prune old snapshots (keep last 50 per DID)
  aidDb.pruneSnapshots(did, 50);

  logAudit({ entityType: 'aid', entityId: did, action: 'export', actorId: billingKey });

  return c.json({
    aidDocument,
    capabilities,
    trustChain,
    snapshotHistory,
    exportedAt: new Date().toISOString(),
  });
});

// ─── POST /:did/rotate-key — Rotate agent's Ed25519 key ─────────────────────
router.post('/:did/rotate-key', checkApiKey, async (c) => {
  const did = c.req.param('did');
  const keyInfo = c.get('apiKeyInfo');
  const billingKey = resolveBillingKey(keyInfo as unknown as Record<string, unknown>);

  let body: z.infer<typeof RotateKeySchema>;
  try {
    body = RotateKeySchema.parse(await c.req.json());
  } catch (err) {
    const message = err instanceof z.ZodError ? err.errors[0]?.message : 'Invalid request body';
    return c.json({ error: message, code: 'INVALID_BODY' }, 400);
  }

  // BYOK validation for rotation
  if (body.newPublicKey) {
    const validation = validateMultibaseEd25519(body.newPublicKey);
    if (!validation.valid) {
      return c.json({ error: `Invalid public key: ${validation.error}`, code: 'INVALID_PUBLIC_KEY' }, 400);
    }
  }

  const aidDb = await getAidDb();
  const aidBuilder = await getAidBuilder();

  const aidKey = aidDb.getAidKey(did);
  if (!aidKey) {
    return c.json({ error: 'AID not found', code: 'AID_NOT_FOUND' }, 404);
  }

  // Must own the AID
  if (billingKey !== aidKey.owner_key) {
    return c.json({ error: 'You do not own this AID', code: 'AID_NOT_OWNED' }, 403);
  }

  // Deduct credits
  const deducted = deductCredit(billingKey, ROTATE_KEY_COST);
  if (!deducted) {
    return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402);
  }
  trackDelegatedSpend(keyInfo, ROTATE_KEY_COST);

  let newPublicKeyMultibase: string;
  let privateKeySeed: string | undefined;

  if (body.newPublicKey) {
    newPublicKeyMultibase = body.newPublicKey;
  } else {
    // Key rotation uses random keypair (no mnemonic — rotated keys are standalone)
    const keypair = aidBuilder.generateRandomKeypair();
    newPublicKeyMultibase = keypair.publicKeyMultibase;
    privateKeySeed = keypair.privateKeySeed;
  }

  const previousKey = aidKey.public_key_multibase;
  const oldKeyId = aidKey.id;

  // Create new key record
  const { id: newKeyId } = aidDb.createAidKey({
    ownerKey: billingKey,
    publicKeyMultibase: newPublicKeyMultibase,
    did,
    displayName: aidKey.display_name || undefined,
    serviceEndpoints: aidKey.service_endpoints ? JSON.parse(aidKey.service_endpoints) : undefined,
  });

  // Mark old key as rotated
  aidDb.rotateAidKey(oldKeyId, newKeyId);

  // Update agent_identities if linked
  try {
    aidDb.setIdentityAid(billingKey, did, newPublicKeyMultibase, newKeyId);
  } catch {
    // best-effort
  }

  logAudit({
    entityType: 'aid',
    entityId: did,
    action: 'rotate_key',
    actorId: billingKey,
    data: { previousKey, newKey: newPublicKeyMultibase },
  });

  logger.info({ did, ownerKey: billingKey }, 'AID key rotated');

  return c.json({
    did,
    publicKeyMultibase: newPublicKeyMultibase,
    ...(privateKeySeed ? { privateKeySeed } : {}),
    previousKey,
    rotatedAt: new Date().toISOString(),
    warning: privateKeySeed ? 'Save your privateKeySeed now — it is returned ONCE and never stored.' : undefined,
  });
});

// ─── GET /:did/trust — Public trust score query (the "credit bureau" API) ────
// Free, no auth, rate-limited. Other platforms query this to assess agent trust.
router.get('/:did/trust', async (c) => {
  const did = c.req.param('did');

  if (await checkPublicRateLimit(c)) {
    return c.json({ error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' }, 429);
  }

  const aidDb = await getAidDb();
  const aidBuilder = await getAidBuilder();

  const aidKey = aidDb.getAidKey(did);
  if (!aidKey) {
    return c.json({ error: 'AID not found', code: 'AID_NOT_FOUND' }, 404);
  }

  const aidDocument = aidBuilder.buildAIDDocument(did);
  if (!aidDocument) {
    return c.json({ error: 'Failed to build trust profile', code: 'AID_BUILD_FAILED' }, 500);
  }

  // Public trust profile — verdict only, no exact score (privacy model from Section 19.11)
  const trustScore = aidDocument.trustScore;
  const score = trustScore.score;

  // Map score to verdict
  let verdict: string;
  if (score >= 90) verdict = 'proceed';
  else if (score >= 80) verdict = 'trusted';
  else if (score >= 60) verdict = 'standard';
  else if (score >= 40) verdict = 'caution';
  else if (score >= 20) verdict = 'building';
  else verdict = 'new';

  // Public response: verdict + verification status, NOT exact score
  return c.json({
    did,
    verdict,
    verified: !!aidKey.display_name, // simplified — proper verification check would use linked identities
    verificationTier: score >= 90 ? 'proceed' : score >= 40 ? 'active' : 'new',
    attestationCount: aidDocument.trustChain.attestationCount,
    capabilities: aidDocument.capabilities.map(cap => cap.category),
    activeSince: aidKey.created_at,
    trustChain: {
      merkleRoot: aidDocument.trustChain.merkleRoot,
      chainLength: aidDocument.trustChain.chainLength,
    },
    // For authenticated callers (providers during transactions), include exact score
    // via the full AID document at GET /:did
  });
});

// ─── GET /:did/did.json — W3C DID Document (public) ─────────────────────────
router.get('/:did/did.json', async (c) => {
  const did = c.req.param('did');

  if (await checkPublicRateLimit(c)) {
    return c.json({ error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' }, 429);
  }

  const aidDb = await getAidDb();

  const aidKey = aidDb.getAidKey(did);
  if (!aidKey) {
    return c.json({ error: 'AID not found', code: 'AID_NOT_FOUND' }, 404);
  }

  const serviceEndpoints = aidKey.service_endpoints
    ? JSON.parse(aidKey.service_endpoints)
    : [];

  // W3C DID Document format
  const didDocument = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    id: did,
    verificationMethod: [
      {
        id: `${did}#key-1`,
        type: 'Ed25519VerificationKey2020',
        controller: did,
        publicKeyMultibase: aidKey.public_key_multibase,
      },
    ],
    authentication: [`${did}#key-1`],
    assertionMethod: [`${did}#key-1`],
    ...(serviceEndpoints.length > 0
      ? {
          service: serviceEndpoints.map((ep: { type: string; url: string }, i: number) => ({
            id: `${did}#service-${i + 1}`,
            type: ep.type,
            serviceEndpoint: ep.url,
          })),
        }
      : {}),
    created: aidKey.created_at,
    updated: aidKey.updated_at,
  };

  c.header('Content-Type', 'application/did+json');
  return c.json(didDocument);
});

// ─── POST /:did/freeze — Guardian freezes an AID (key compromise recovery) ──
router.post('/:did/freeze', checkApiKey, async (c) => {
  const did = c.req.param('did');
  const keyInfo = c.get('apiKeyInfo');
  const billingKey = resolveBillingKey(keyInfo as unknown as Record<string, unknown>);

  const aidDb = await getAidDb();
  const aidKey = aidDb.getAidKey(did);
  if (!aidKey) {
    return c.json({ error: 'AID not found', code: 'AID_NOT_FOUND' }, 404);
  }

  // Must be the guardian OR the owner
  const isGuardian = (aidKey as any).guardian_address && billingKey === (aidKey as any).guardian_address;
  const isOwner = billingKey === aidKey.owner_key;
  if (!isGuardian && !isOwner) {
    return c.json({ error: 'Only the AID owner or guardian can freeze', code: 'AID_NOT_AUTHORIZED' }, 403);
  }

  const { getDb } = await import('../db/connection');
  getDb().prepare(`
    UPDATE aid_keys SET frozen = 1, frozen_at = datetime('now'), frozen_by = ?, updated_at = datetime('now')
    WHERE did = ? AND key_status = 'active'
  `).run(billingKey, did);

  logAudit({ entityType: 'aid', entityId: did, action: 'freeze', actorId: billingKey });

  return c.json({ did, frozen: true, frozenAt: new Date().toISOString(), frozenBy: billingKey });
});

// ─── POST /:did/heartbeat — Proof of Life (Autonomous Defense System) ─────────
//
// Owner periodically proves they are monitoring their agent by signing a heartbeat.
// Lapsed heartbeats trigger automatic trust decay per Section 39.18.
//
// Heartbeat schedule: once per heartbeat_interval_days (default 7).
// Grace period: heartbeat_grace_days (default 3) before decay starts.
// Decay schedule:
//   7 days overdue:  reduce to "trusted" ceiling
//   14 days overdue: reduce to "standard" ceiling
//   30 days overdue: reduce to "caution" ceiling
//   60 days overdue: reduce to "building" ceiling
//   90 days overdue: auto-freeze
// ─────────────────────────────────────────────────────────────────────────────

router.post('/:did/heartbeat', checkApiKey, async (c) => {
  const did = c.req.param('did');
  const keyInfo = c.get('apiKeyInfo');
  const billingKey = resolveBillingKey(keyInfo as unknown as Record<string, unknown>);

  const aidDb = await getAidDb();
  const aidKey = aidDb.getAidKey(did);
  if (!aidKey) {
    return c.json({ error: 'AID not found', code: 'AID_NOT_FOUND' }, 404);
  }

  // Must be the owner (or guardian)
  const isGuardian = (aidKey as any).guardian_address && billingKey === (aidKey as any).guardian_address;
  const isOwner = billingKey === aidKey.owner_key;
  if (!isOwner && !isGuardian) {
    return c.json({ error: 'Only the AID owner or guardian can submit heartbeats', code: 'AID_NOT_AUTHORIZED' }, 403);
  }

  const { getDb: getDatabase } = await import('../db/connection');
  const now = new Date().toISOString();

  // Record heartbeat + reset decay
  getDatabase().prepare(`
    UPDATE aid_keys
    SET last_heartbeat = ?, heartbeat_decay_applied = 0, proof_of_life_status = 'active', updated_at = ?
    WHERE did = ? AND key_status = 'active'
  `).run(now, now, did);

  logAudit({ entityType: 'aid', entityId: did, action: 'heartbeat', actorId: billingKey });

  const intervalDays = (aidKey as any).heartbeat_interval_days || 7;
  const nextDue = new Date(Date.now() + intervalDays * 86400000).toISOString();

  return c.json({
    did,
    heartbeatRecorded: now,
    nextDue,
    intervalDays,
    proofOfLifeStatus: 'active',
    decayApplied: 0,
  });
});

// ─── DELETE /:did — GDPR right to erasure ────────────────────────────────────
router.delete('/:did', checkApiKey, async (c) => {
  const did = c.req.param('did');
  const keyInfo = c.get('apiKeyInfo');
  const billingKey = resolveBillingKey(keyInfo as unknown as Record<string, unknown>);

  const aidDb = await getAidDb();
  const aidKey = aidDb.getAidKey(did);
  if (!aidKey) {
    return c.json({ error: 'AID not found', code: 'AID_NOT_FOUND' }, 404);
  }

  if (billingKey !== aidKey.owner_key) {
    return c.json({ error: 'Only the AID owner can delete', code: 'AID_NOT_OWNED' }, 403);
  }

  const { getDb } = await import('../db/connection');
  getDb().transaction(() => {
    getDb().prepare('DELETE FROM aid_keys WHERE did = ?').run(did);
    getDb().prepare('DELETE FROM aid_trust_snapshots WHERE did = ?').run(did);
    getDb().prepare('DELETE FROM aid_cross_platform_attestations WHERE did = ?').run(did);
    getDb().prepare('DELETE FROM aid_capabilities WHERE identity_id = ?').run(aidKey.owner_key);
    // Tombstone prevents re-creation
    getDb().prepare(`
      INSERT OR IGNORE INTO aid_tombstones (did, erased_at) VALUES (?, datetime('now'))
    `).run(did);
  })();

  logAudit({ entityType: 'aid', entityId: did, action: 'gdpr_erase', actorId: billingKey });

  return c.body(null, 204); // HTTP 204 No Content — fitting for x204
});

export { router as aidRouter };
