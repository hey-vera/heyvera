/**
 * Agent Self-Onboarding — single-call onboarding for AI agents.
 *
 * POST /v1/onboard        — Generate API key (no auth, 0 credits — purchase required)
 * GET  /v1/onboard/manifest — MCP-compatible tool manifest (no auth)
 */

import { Hono } from 'hono';
import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { getDb, logAudit } from '../db/index';
import { apiRegistry } from '../config/api-registry';
import { cacheIncr } from '../cache/index';
import { getClientIp } from '../middleware/rate-limit';
import { logger } from '../utils/logger';

export const onboardRouter = new Hono();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateApiKey(): string {
  return 'cn-' + crypto.randomBytes(24).toString('hex');
}

interface TopSkillRow {
  id: string;
  name: string;
  credit_cost: number;
  avg_rating: number | null;
}

// ─── POST /v1/onboard — Agent self-onboarding ────────────────────────────────

onboardRouter.post('/', async (c) => {
  // Rate limit: 5 per IP per hour
  const ip = getClientIp(c);
  const rateLimitKey = `onboard:ip:${ip}`;
  const count = await cacheIncr(rateLimitKey, 3600);
  if (count > 5) {
    return c.json({ error: 'Rate limit exceeded — max 5 onboard requests per IP per hour', code: 'RATE_LIMIT_EXCEEDED' }, 429);
  }

  let body: { name?: string; email?: string; budget?: { dailyLimit?: number } } = {};
  try {
    body = await c.req.json();
  } catch {
    // Body is optional — empty body is fine
  }

  const apiKey = generateApiKey();
  const email = body.email ?? '';
  const name = body.name ?? '';

  try {
    getDb().prepare(
      `INSERT INTO api_keys (key, email, credits, credits_used, created_at, stripe_session_id, amount_paid)
       VALUES (?, ?, 0, 0, datetime('now'), ?, 0)`
    ).run(apiKey, email, `onboard:${nanoid(12)}`);

    logAudit({
      entityType: 'api_key',
      entityId: apiKey,
      action: 'AGENT_ONBOARD',
      data: { credits: 0, name, email: email || undefined, ip },
    });

    logger.info({ name, hasEmail: !!email, ip }, 'Agent self-onboarded');
  } catch (err) {
    logger.error({ err }, 'Agent onboarding failed');
    return c.json({ error: 'Onboarding failed — please try again', code: 'ONBOARD_FAILED' }, 500);
  }

  // Fetch top 5 public skills by rating + usage
  let topSkills: Array<{ id: string; name: string; creditCost: number; avgRating: number | null }> = [];
  try {
    const rows = getDb().prepare(
      `SELECT s.id, s.name, s.credit_cost, s.avg_rating
       FROM skills s
       WHERE s.public = 1 AND s.security_status != 'DELISTED'
       ORDER BY s.avg_rating DESC,
         (SELECT COUNT(*) FROM transactions WHERE skill_id = s.id) DESC
       LIMIT 5`
    ).all() as TopSkillRow[];

    topSkills = rows.map(r => ({
      id: r.id,
      name: r.name,
      creditCost: r.credit_cost,
      avgRating: r.avg_rating,
    }));
  } catch {
    // Non-fatal — return empty array
  }

  return c.json({
    apiKey,
    credits: 0,
    gettingStarted: {
      buyCredits: 'POST /v1/stripe/checkout or send USDC to the receiving wallet',
      orchestrate: 'POST /v1/orchestrate with { query: "your question" }',
      skills: 'GET /v1/skills to browse available skills',
      invoke: 'POST /v1/skills/:id/invoke to run a specific skill',
      discover: 'POST /v1/discover to search for skills semantically',
      budget: 'POST /v1/economy/keys/budget-account to set spending limits',
      docs: 'https://claw-net.org/docs',
    },
    topSkills,
    limits: {
      rateLimit: '30 req/min (upgrade to 300/min at $100+ lifetime spend)',
      topUp: 'POST /v1/stripe/checkout or send USDC to the receiving wallet',
    },
  }, 201);
});

// ─── GET /v1/onboard/manifest — MCP tool manifest ────────────────────────────

interface ManifestSkillRow {
  id: string;
  name: string;
  description: string;
  input_schema: string | null;
  skill_type: string;
}

onboardRouter.get('/manifest', (c) => {
  // Build tools array from skills table + hardcoded orchestrate tool
  const tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> = [];

  // Hardcoded orchestrate tool — always first
  tools.push({
    name: 'orchestrate',
    description: `Ask any question about crypto, DeFi, tokens — AI plans and executes across ${apiRegistry.length} endpoints`,
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  });

  // Dynamic tools from skills table
  try {
    const rows = getDb().prepare(
      `SELECT id, name, description, input_schema, skill_type
       FROM skills
       WHERE public = 1 AND security_status != 'DELISTED'
       ORDER BY avg_rating DESC
       LIMIT 200`
    ).all() as ManifestSkillRow[];

    for (const row of rows) {
      let inputSchema: Record<string, unknown> = {
        type: 'object',
        properties: { input: { type: 'string' } },
        required: ['input'],
      };

      if (row.input_schema) {
        try {
          inputSchema = JSON.parse(row.input_schema);
        } catch {
          // Fallback to default schema
        }
      }

      tools.push({
        name: `skill:${row.name}`,
        description: row.description,
        inputSchema,
      });
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load skills for manifest');
  }

  const skillCount = tools.length - 1; // subtract orchestrate tool

  return c.json({
    name: 'clawnet',
    version: '1.0.0',
    description: `AI agent orchestration — ${apiRegistry.length} endpoints, ${skillCount} skills`,
    tools,
    authentication: {
      type: 'api-key',
      header: 'X-API-Key',
      getKey: 'POST /v1/onboard',
    },
    pricing: {
      model: 'per-request',
      currency: 'credits',
      rate: '1000 credits = $1',
    },
  });
});
