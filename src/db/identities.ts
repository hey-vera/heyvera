/**
 * Agent Identity — DB helpers for the agent_identities table (v87)
 *
 * KYA (Know Your Agent) compatible identity system.
 * Issues verifiable HMAC-SHA256 JWTs alongside API keys.
 */
import { nanoid } from 'nanoid';
import crypto from 'crypto';
import { getDb, logAudit } from './connection';
import { hashApiKey } from './attestations';
import { env } from '../config/index';
import { logger } from '../utils/logger';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AgentIdentity {
  id: string;
  api_key_hash: string;
  display_name: string;
  description: string | null;
  agent_type: string;
  capabilities_json: string | null;
  owner_verified: number;
  verification_method: string | null;
  identity_jwt: string | null;
  jwt_issued_at: string | null;
  jwt_expires_at: string | null;
  public_profile: number;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateIdentityParams {
  apiKey: string;
  displayName: string;
  description?: string;
  agentType?: string;
  capabilities?: string[];
  publicProfile?: boolean;
  metadata?: Record<string, unknown>;
}

export interface UpdateIdentityParams {
  displayName?: string;
  description?: string;
  agentType?: string;
  capabilities?: string[];
  publicProfile?: boolean;
  metadata?: Record<string, unknown>;
}

// ─── JWT helpers ────────────────────────────────────────────────────────────

const JWT_LIFETIME_SECONDS = 86400 * 90; // 90 days
const BASE_URL = 'https://api.claw-net.org';

export function issueIdentityJwt(identity: AgentIdentity): string | null {
  const secret = env.PLATFORM_SIGNING_SECRET;
  if (!secret) {
    logger.warn('[identity] PLATFORM_SIGNING_SECRET not set, cannot sign JWT');
    return null;
  }
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    sub: identity.id,
    iss: 'clawnet',
    iat: now,
    exp: now + JWT_LIFETIME_SECONDS,
    agent_type: identity.agent_type,
    display_name: identity.display_name,
    capabilities: JSON.parse(identity.capabilities_json || '[]'),
    owner_verified: identity.owner_verified === 1,
    profile_url: `${BASE_URL}/v1/identity/${identity.id}`,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

export function verifyIdentityJwt(jwt: string): {
  valid: boolean;
  payload: Record<string, unknown> | null;
  reason?: string;
} {
  const parts = jwt.split('.');
  if (parts.length !== 3) return { valid: false, payload: null, reason: 'Malformed JWT' };

  const [header, payload, signature] = parts;
  const secret = env.PLATFORM_SIGNING_SECRET;
  if (!secret) {
    logger.warn('[identity] PLATFORM_SIGNING_SECRET not set, cannot verify JWT');
    return { valid: false, payload: null, reason: 'Signing secret not configured' };
  }
  const expected = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');

  if (!signature || !expected || signature.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return { valid: false, payload: null, reason: 'Invalid signature' };
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp && decoded.exp < now) return { valid: false, payload: decoded, reason: 'Token expired' };
    return { valid: true, payload: decoded };
  } catch {
    return { valid: false, payload: null, reason: 'Invalid payload encoding' };
  }
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export function createAgentIdentity(params: CreateIdentityParams): AgentIdentity {
  const id = `aid-${nanoid(16)}`;
  const apiKeyHash = hashApiKey(params.apiKey);

  // Check for existing identity
  const existing = getDb().prepare('SELECT id FROM agent_identities WHERE api_key_hash = ?').get(apiKeyHash) as { id: string } | undefined;
  if (existing) {
    throw new Error('Agent identity already exists for this API key');
  }

  const capabilitiesJson = params.capabilities ? JSON.stringify(params.capabilities) : null;
  const metadataJson = params.metadata ? JSON.stringify(params.metadata) : null;
  const agentType = params.agentType || 'autonomous';
  const publicProfile = params.publicProfile !== false ? 1 : 0;

  getDb().prepare(`
    INSERT INTO agent_identities (
      id, api_key_hash, display_name, description, agent_type,
      capabilities_json, public_profile, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, apiKeyHash, params.displayName, params.description || null, agentType, capabilitiesJson, publicProfile, metadataJson);

  // Issue JWT immediately (if signing secret is configured)
  const identity = getDb().prepare('SELECT * FROM agent_identities WHERE id = ?').get(id) as AgentIdentity;
  const jwt = issueIdentityJwt(identity);
  if (jwt) {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + JWT_LIFETIME_SECONDS * 1000).toISOString();
    getDb().prepare(`
      UPDATE agent_identities SET identity_jwt = ?, jwt_issued_at = ?, jwt_expires_at = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(jwt, now, expiresAt, id);
  }

  logAudit({ entityType: 'agent_identity', entityId: id, action: 'CREATE', actorId: params.apiKey, data: { agent_type: agentType, display_name: params.displayName } });

  return getDb().prepare('SELECT * FROM agent_identities WHERE id = ?').get(id) as AgentIdentity;
}

export function getAgentIdentity(apiKeyHash: string): AgentIdentity | undefined {
  return getDb().prepare('SELECT * FROM agent_identities WHERE api_key_hash = ?').get(apiKeyHash) as AgentIdentity | undefined;
}

export function getAgentIdentityById(id: string): AgentIdentity | undefined {
  return getDb().prepare('SELECT * FROM agent_identities WHERE id = ?').get(id) as AgentIdentity | undefined;
}

export function updateAgentIdentity(id: string, updates: UpdateIdentityParams, actorKey?: string): AgentIdentity | undefined {
  const existing = getAgentIdentityById(id);
  if (!existing) return undefined;

  const sets: string[] = ["updated_at = datetime('now')"];
  const params: unknown[] = [];

  if (updates.displayName !== undefined) { sets.push('display_name = ?'); params.push(updates.displayName); }
  if (updates.description !== undefined) { sets.push('description = ?'); params.push(updates.description); }
  if (updates.agentType !== undefined) { sets.push('agent_type = ?'); params.push(updates.agentType); }
  if (updates.capabilities !== undefined) { sets.push('capabilities_json = ?'); params.push(JSON.stringify(updates.capabilities)); }
  if (updates.publicProfile !== undefined) { sets.push('public_profile = ?'); params.push(updates.publicProfile ? 1 : 0); }
  if (updates.metadata !== undefined) { sets.push('metadata_json = ?'); params.push(JSON.stringify(updates.metadata)); }

  if (sets.length === 1) return existing; // only updated_at, nothing changed

  params.push(id);
  getDb().prepare(`UPDATE agent_identities SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  logAudit({ entityType: 'agent_identity', entityId: id, action: 'UPDATE', actorId: actorKey, data: { ...updates } as Record<string, unknown> });

  return getAgentIdentityById(id);
}

export function refreshIdentityJwt(id: string, actorKey?: string): AgentIdentity | undefined {
  const identity = getAgentIdentityById(id);
  if (!identity) return undefined;

  const jwt = issueIdentityJwt(identity);
  if (!jwt) {
    logger.warn('[identity] Cannot refresh JWT — PLATFORM_SIGNING_SECRET not set');
    return undefined;
  }
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + JWT_LIFETIME_SECONDS * 1000).toISOString();

  getDb().prepare(`
    UPDATE agent_identities SET identity_jwt = ?, jwt_issued_at = ?, jwt_expires_at = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(jwt, now, expiresAt, id);

  logAudit({ entityType: 'agent_identity', entityId: id, action: 'REFRESH_JWT', actorId: actorKey });

  return getDb().prepare('SELECT * FROM agent_identities WHERE id = ?').get(id) as AgentIdentity;
}

export function getPublicIdentity(id: string): Omit<AgentIdentity, 'identity_jwt' | 'api_key_hash'> & { api_key_hash?: never; identity_jwt?: never } | undefined {
  const identity = getAgentIdentityById(id);
  if (!identity || !identity.public_profile) return undefined;

  const { identity_jwt: _jwt, api_key_hash: _hash, ...publicFields } = identity;
  return publicFields as typeof publicFields & { api_key_hash?: never; identity_jwt?: never };
}

export function listPublicIdentities(limit: number = 20, offset: number = 0): {
  identities: Array<{
    id: string;
    display_name: string;
    description: string | null;
    agent_type: string;
    capabilities: string[];
    owner_verified: boolean;
    created_at: string;
  }>;
  total: number;
} {
  const safeLimit = Math.min(Math.max(1, limit), 50);
  const safeOffset = Math.max(0, offset);

  const rows = getDb().prepare(`
    SELECT id, display_name, description, agent_type, capabilities_json, owner_verified, created_at
    FROM agent_identities WHERE public_profile = 1
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(safeLimit, safeOffset) as Array<{
    id: string;
    display_name: string;
    description: string | null;
    agent_type: string;
    capabilities_json: string | null;
    owner_verified: number;
    created_at: string;
  }>;

  const countRow = getDb().prepare('SELECT COUNT(*) as cnt FROM agent_identities WHERE public_profile = 1').get() as { cnt: number };

  return {
    identities: rows.map(r => ({
      id: r.id,
      display_name: r.display_name,
      description: r.description,
      agent_type: r.agent_type,
      capabilities: JSON.parse(r.capabilities_json || '[]'),
      owner_verified: r.owner_verified === 1,
      created_at: r.created_at,
    })),
    total: countRow.cnt,
  };
}
