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
import { logger } from '../utils/logger';

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
