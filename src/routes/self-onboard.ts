/**
 * Zero-friction agent self-onboarding — an agent can register and get an
 * API key with a single POST request, no human signup needed.
 *
 * POST /v1/self-onboard/register   — Generate API key + optional free credits
 * GET  /v1/self-onboard/quickstart — Onboarding info without registering
 */

import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { getDb, logAudit } from '../db/index';
import { env } from '../config/index';
import { cacheIncr } from '../cache/index';
import { getClientIp } from '../middleware/rate-limit';
import { logger } from '../utils/logger';

const router = new Hono();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateApiKey(): string {
  return 'cn-' + crypto.randomBytes(24).toString('hex');
}

// ─── POST /register — agent self-registration ────────────────────────────────

const RegisterBody = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  email: z.string().email().optional(),
  agentType: z.enum(['autonomous', 'assisted', 'tool']).optional().default('autonomous'),
  capabilities: z.array(z.string().max(50)).max(20).optional(),
  webhookUrl: z.string().url().max(500).optional(),
});

router.post('/register', async (c) => {
  // Rate limit: 5 per IP per hour (uses Redis/L1 cache, not in-memory)
  const ip = getClientIp(c);
  const rateLimitKey = `self-onboard:ip:${ip}`;
  const count = await cacheIncr(rateLimitKey, 3600);
  if (count > 5) {
    return c.json({ error: 'Rate limit exceeded. Max 5 registrations per hour.', code: 'RATE_LIMITED' }, 429);
  }

  let rawBody: unknown;
  try { rawBody = await c.req.json(); } catch { rawBody = {}; }

  const parsed = RegisterBody.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({
      error: 'Invalid registration data',
      code: 'INVALID_DATA',
      details: parsed.error.flatten().fieldErrors,
    }, 400);
  }

  const { name, description, email, agentType, capabilities, webhookUrl } = parsed.data;

  const apiKey = generateApiKey();
  const freeCredits = env.FREE_TRIAL_CREDITS;

  try {
    getDb().prepare(
      `INSERT INTO api_keys (key, email, credits, credits_used, created_at, stripe_session_id, amount_paid)
       VALUES (?, ?, ?, 0, datetime('now'), ?, 0)`
    ).run(apiKey, email ?? '', freeCredits, `self-onboard:${nanoid(12)}`);

    logAudit({
      entityType: 'api_key',
      entityId: apiKey,
      action: 'SELF_REGISTER',
      data: {
        name,
        agentType,
        ip,
        description: description ?? undefined,
        capabilities: capabilities?.join(',') ?? undefined,
        webhookUrl: webhookUrl ?? undefined,
      },
    });

    logger.info({ name, agentType, ip, freeCredits }, 'Agent self-registered');

    return c.json({
      success: true,
      apiKey,
      name,
      credits: freeCredits,
      agentType,
      message: freeCredits > 0
        ? `Welcome to ClawNet! You have ${freeCredits} free credits to get started.`
        : 'Welcome to ClawNet! Top up credits via /v1/solana/deposit or Stripe checkout.',
      quickStart: {
        orchestrate: {
          endpoint: 'POST /v1/orchestrate',
          headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
          body: { query: 'What is the current price of SOL?' },
        },
        browseSkills: {
          endpoint: 'GET /v1/marketplace/skills',
          headers: {},
          note: 'No auth needed to browse.',
        },
        x402: {
          endpoint: 'POST /x402/skills/:id',
          note: 'Pay with USDC on Base — no API key needed.',
        },
        mcp: {
          endpoint: 'POST /mcp',
          note: 'Connect via MCP — no API key needed for browsing.',
        },
      },
      docs: {
        llmsTxt: '/llms.txt',
        openapi: '/v1/openapi.json',
        agentCard: '/.well-known/agent-card.json',
      },
    }, 201);
  } catch (err) {
    logger.error({ err, name, ip }, 'Self-registration failed');
    return c.json({ error: 'Registration failed', code: 'REGISTRATION_FAILED' }, 500);
  }
});

// ─── GET /quickstart — onboarding info without registering ───────────────────

router.get('/quickstart', (c) => {
  return c.json({
    name: 'ClawNet',
    description: 'Universal AI agent orchestration layer — 344+ API endpoints, skill marketplace, x402 payments',
    getStarted: [
      { step: 1, action: 'Register', method: 'POST /v1/self-onboard/register', body: { name: 'MyAgent' }, note: 'Returns API key instantly' },
      { step: 2, action: 'Browse Skills', method: 'GET /v1/marketplace/skills', note: 'No auth needed' },
      { step: 3, action: 'Invoke a Skill', method: 'POST /v1/skills/:id/invoke', note: 'Requires API key' },
      { step: 4, action: 'Or use x402', method: 'POST /x402/skills/:id', note: 'No key needed — pay with USDC' },
    ],
    noAuthRequired: [
      'GET /v1/marketplace/skills',
      'GET /v1/endpoints',
      'GET /x402/skills',
      'GET /llms.txt',
      'GET /.well-known/agent-card.json',
      'POST /mcp (tools/list)',
    ],
    pricing: {
      creditRate: '1 credit = $0.001 USD',
      freeTrialCredits: env.FREE_TRIAL_CREDITS,
      x402: `${env.X402_USDC_PER_CREDIT} USDC per credit`,
    },
  });
});

export { router as selfOnboardRouter };
