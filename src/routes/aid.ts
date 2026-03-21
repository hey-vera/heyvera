/**
 * AID (Agent Identity Document) Routes
 *
 * W3C DID-compatible identity layer for ClawNet agents.
 * Supports Ed25519 keypairs, cross-platform attestations, trust snapshots,
 * capability derivation, portable trust chains, and offline verification.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { checkApiKey } from '../middleware/auth';
import { deductCredit, logAudit } from '../db/index';
import { cacheIncr } from '../cache/index';
import { round6 } from '../core/credits';
import { trackDelegatedSpend } from '../utils/billing';
import { logger } from '../utils/logger';

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveBillingKey(keyInfo: Record<string, unknown>): string {
  const info = keyInfo as { key: string; delegatedFrom?: string; delegation?: { parentKey?: string } };
  return info.delegatedFrom
    ? (info.delegation?.parentKey || info.key)
    : info.key;
}

function isOwner(keyInfo: Record<string, unknown>, ownerKey: string): boolean {
  const billingKey = resolveBillingKey(keyInfo);
  return billingKey === ownerKey;
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
  const existing = aidDb.getAidKeysByIdentity(billingKey);
  if (existing && existing.length > 0) {
    return c.json({ error: 'Agent already has an AID registered', code: 'AID_ALREADY_EXISTS' }, 409);
  }

  // Deduct credits
  const deducted = deductCredit(billingKey, REGISTER_COST, 'aid_register');
  if (!deducted) {
    return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402);
  }
  if (keyInfo.delegatedFrom) {
    trackDelegatedSpend(keyInfo.delegatedFrom, REGISTER_COST);
  }

  // Generate or accept keypair
  let publicKeyMultibase: string;
  let privateKeySeed: string | undefined;

  if (body.publicKey) {
    // BYOK — agent provides their own public key
    publicKeyMultibase = body.publicKey;
  } else {
    // Generate Ed25519 keypair
    const keypair = await aidBuilder.generateAgentKeypair();
    publicKeyMultibase = keypair.publicKeyMultibase;
    privateKeySeed = keypair.privateKeySeed;
  }

  // Create DID
  const did = `did:clawnet:${nanoid(24)}`;

  // Store AID key
  aidDb.createAidKey({
    did,
    ownerKey: billingKey,
    publicKeyMultibase,
    displayName: body.displayName,
    serviceEndpoints: body.serviceEndpoints,
  });

  // Link to agent_identities
  aidDb.setIdentityAid(billingKey, did);

  // Build AID document
  const aidDocument = aidBuilder.buildAIDDocument({
    did,
    publicKeyMultibase,
    displayName: body.displayName,
    serviceEndpoints: body.serviceEndpoints,
  });

  logAudit({ entityType: 'aid', entityId: did, action: 'register', actorId: billingKey });

  logger.info({ did, ownerKey: billingKey, byok: !!body.publicKey }, 'AID registered');

  return c.json({
    did,
    publicKeyMultibase,
    ...(privateKeySeed ? { privateKeySeed } : {}),
    aidDocument,
  }, 201);
});

// ─── GET /:did — Resolve DID to AID document (public) ───────────────────────
router.get('/:did', async (c) => {
  const did = c.req.param('did');

  // Skip route if it matches a known sub-path to avoid conflicts
  if (['register', 'verify'].includes(did)) return c.notFound();

  const aidDb = await getAidDb();
  const aidBuilder = await getAidBuilder();

  const aidKey = aidDb.getAidKey(did);
  if (!aidKey) {
    return c.json({ error: 'AID not found', code: 'AID_NOT_FOUND' }, 404);
  }

  const aidDocument = aidBuilder.buildAIDDocument({
    did: aidKey.did,
    publicKeyMultibase: aidKey.public_key_multibase,
    displayName: aidKey.display_name,
    serviceEndpoints: aidKey.service_endpoints ? JSON.parse(aidKey.service_endpoints) : undefined,
    created: aidKey.created_at,
    updated: aidKey.updated_at,
  });

  return c.json(aidDocument);
});

// ─── GET /:did/trust-chain — Portable trust chain (public) ──────────────────
router.get('/:did/trust-chain', async (c) => {
  const did = c.req.param('did');
  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') || '50', 10) || 50), 200);

  const aidDb = await getAidDb();
  const aidBuilder = await getAidBuilder();

  const aidKey = aidDb.getAidKey(did);
  if (!aidKey) {
    return c.json({ error: 'AID not found', code: 'AID_NOT_FOUND' }, 404);
  }

  const attestations = aidDb.getCrossPlatformAttestations(did, limit);
  const latestSnapshot = aidDb.getLatestSnapshot(did);

  const trustChain = aidBuilder.buildPortableTrustChain({
    did,
    attestations,
    latestSnapshot,
    limit,
  });

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

  // Deduct credits
  const deducted = deductCredit(billingKey, ATTEST_COST, 'aid_attest');
  if (!deducted) {
    return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402);
  }
  if (keyInfo.delegatedFrom) {
    trackDelegatedSpend(keyInfo.delegatedFrom, ATTEST_COST);
  }

  const attestation = aidDb.addCrossPlatformAttestation({
    did,
    attestorKey: billingKey,
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

  const aidDb = await getAidDb();

  const aidKey = aidDb.getAidKey(did);
  if (!aidKey) {
    return c.json({ error: 'AID not found', code: 'AID_NOT_FOUND' }, 404);
  }

  const capabilities = aidDb.getCapabilities(did);
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

  const result = aidVerifier.verifyAIDDocument(body.aidDocument);

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
  if (!isOwner(keyInfo as unknown as Record<string, unknown>, aidKey.owner_key)) {
    return c.json({ error: 'You do not own this AID', code: 'AID_NOT_OWNED' }, 403);
  }

  // Deduct credits
  const deducted = deductCredit(billingKey, EXPORT_COST, 'aid_export');
  if (!deducted) {
    return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402);
  }
  if (keyInfo.delegatedFrom) {
    trackDelegatedSpend(keyInfo.delegatedFrom, EXPORT_COST);
  }

  // Build fresh snapshot
  const attestations = aidDb.getCrossPlatformAttestations(did, 200);
  const snapshot = aidBuilder.buildTrustSnapshot(did, attestations);
  aidDb.createTrustSnapshot(did, snapshot);

  // Build full AID document
  const aidDocument = aidBuilder.buildAIDDocument({
    did: aidKey.did,
    publicKeyMultibase: aidKey.public_key_multibase,
    displayName: aidKey.display_name,
    serviceEndpoints: aidKey.service_endpoints ? JSON.parse(aidKey.service_endpoints) : undefined,
    created: aidKey.created_at,
    updated: aidKey.updated_at,
  });

  // Capabilities
  const capabilities = aidDb.getCapabilities(did);

  // Trust chain
  const trustChain = aidBuilder.buildPortableTrustChain({
    did,
    attestations,
    latestSnapshot: snapshot,
    limit: 200,
  });

  // Snapshot history
  const snapshotHistory = aidDb.getSnapshotHistory(did, 10);

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

  const aidDb = await getAidDb();
  const aidBuilder = await getAidBuilder();

  const aidKey = aidDb.getAidKey(did);
  if (!aidKey) {
    return c.json({ error: 'AID not found', code: 'AID_NOT_FOUND' }, 404);
  }

  // Must own the AID
  if (!isOwner(keyInfo as unknown as Record<string, unknown>, aidKey.owner_key)) {
    return c.json({ error: 'You do not own this AID', code: 'AID_NOT_OWNED' }, 403);
  }

  // Deduct credits
  const deducted = deductCredit(billingKey, ROTATE_KEY_COST, 'aid_rotate_key');
  if (!deducted) {
    return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402);
  }
  if (keyInfo.delegatedFrom) {
    trackDelegatedSpend(keyInfo.delegatedFrom, ROTATE_KEY_COST);
  }

  let newPublicKeyMultibase: string;
  let privateKeySeed: string | undefined;

  if (body.newPublicKey) {
    newPublicKeyMultibase = body.newPublicKey;
  } else {
    const keypair = await aidBuilder.generateAgentKeypair();
    newPublicKeyMultibase = keypair.publicKeyMultibase;
    privateKeySeed = keypair.privateKeySeed;
  }

  // Store previous key for audit trail
  const previousKey = aidKey.public_key_multibase;

  // Update the key
  aidDb.createAidKey({
    did,
    ownerKey: billingKey,
    publicKeyMultibase: newPublicKeyMultibase,
    displayName: aidKey.display_name,
    serviceEndpoints: aidKey.service_endpoints ? JSON.parse(aidKey.service_endpoints) : undefined,
    rotatedFrom: previousKey,
  });

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
  });
});

// ─── GET /:did/did.json — W3C DID Document (public) ─────────────────────────
router.get('/:did/did.json', async (c) => {
  const did = c.req.param('did');

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

export { router as aidRouter };
