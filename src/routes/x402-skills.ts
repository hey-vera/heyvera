/**
 * x402 Provider Mode — serve ClawNet skills as x402-payable endpoints.
 *
 * Any wallet-equipped AI agent can invoke public ClawNet skills by paying USDC
 * directly over HTTP (x402 protocol), without needing a ClawNet account.
 *
 * Route: POST /x402/skills/:id
 * Payment: USDC on Base (eip155:8453), verified via CDP facilitator.
 * Price:  skill.credit_cost × X402_USDC_PER_CREDIT (default: 1 credit = $0.0005)
 *
 * This only activates if X402_RECIPIENT_ADDRESS is set in env.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { nanoid } from 'nanoid';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { paymentMiddlewareFromConfig } = require('@x402/hono') as {
  paymentMiddlewareFromConfig: (...args: unknown[]) => import('hono').MiddlewareHandler;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { HTTPFacilitatorClient } = require('@x402/core/server') as {
  HTTPFacilitatorClient: new (url: string) => unknown;
};
type HTTPRequestContext = { path: string; method: string; paymentHeader?: string };
import { getDb, getSkill, listPublicSkills, incrementSkillUses, safeJsonParse, getReputationScore, getReputationEvents, recordSkillMetric, recordReputation } from '../db/index';
import { maskApiKey } from '../utils/mask';
import { renderTemplate } from '../utils/template';
import { parseIntent } from '../core/intent-parser';
import { executePlan } from '../core/executor';
import { formatResponse } from '../core/formatter';
import { sendBaseUsdc } from '../utils/evm-payout';
import { logger } from '../utils/logger';
import { env } from '../config/index';
import { cacheGet, cacheSet } from '../cache/index';
import crypto from 'crypto';

// ─── x402 Receipt helpers ────────────────────────────────────────────────────

interface X402Receipt {
  request_id: string;
  skill_id: string;
  skill_name: string;
  price_usdc: string;
  network: string;
  payer_address: string | null;
  created_at: string;
  duration_ms: number;
  success: number;
  error: string | null;
  test?: number;
}

// NOTE: Requires migration to add `test` column to x402_receipts table:
//   ALTER TABLE x402_receipts ADD COLUMN test INTEGER NOT NULL DEFAULT 0
function insertX402Receipt(receipt: Omit<X402Receipt, 'created_at'>): void {
  const testFlag = receipt.test ?? 0;
  getDb().prepare(`
    INSERT INTO x402_receipts (request_id, skill_id, skill_name, price_usdc, network, payer_address, duration_ms, success, error, test)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(receipt.request_id, receipt.skill_id, receipt.skill_name, receipt.price_usdc, receipt.network, receipt.payer_address, receipt.duration_ms, receipt.success, receipt.error, testFlag);
}

function getX402Receipt(requestId: string): X402Receipt | undefined {
  return getDb().prepare('SELECT * FROM x402_receipts WHERE request_id = ?').get(requestId) as X402Receipt | undefined;
}

export const x402SkillsRouter = new Hono();

// ─── Build middleware (only when recipient address is configured) ──────────────

// ─── Facilitator with fallback ───────────────────────────────────────────────

const FACILITATOR_FALLBACKS = [
  env.X402_FACILITATOR_URL,
  'https://x402.org/facilitator',
  'https://facilitator.x402.org',
  'https://facilitator.payai.network',
].filter((url, i, arr) => arr.indexOf(url) === i); // deduplicate

function createFacilitator(): unknown {
  // Primary facilitator — if it fails at runtime, the x402 middleware handles the error.
  // We log which one we're using so operators know.
  const primary = FACILITATOR_FALLBACKS[0];
  logger.info({ facilitator: primary, fallbacks: FACILITATOR_FALLBACKS.length - 1 }, 'x402 facilitator configured');
  return new HTTPFacilitatorClient({ url: primary });
}

function buildX402Middleware() {
  if (!env.X402_RECIPIENT_ADDRESS) return null;

  const facilitator = createFacilitator();
  const chainId = env.X402_NETWORK === 'base-mainnet' ? '8453' : '84532';

  const dynamicSkillPrice = async (ctx: HTTPRequestContext) => {
    // Extract skill ID from path: /x402/skills/:id or /x402/query/:id
    const parts = ctx.path.split('/');
    const skillId = parts[parts.length - 1] ?? '';
    const skill = getSkill(skillId);
    const credits = Math.max(skill?.credit_cost ?? 1, 1);
    const priceUsdc = credits * env.X402_USDC_PER_CREDIT;
    // Return as string USDC amount (e.g. "0.001")
    return priceUsdc.toFixed(6);
  };

  const orchestratePrice = (env.ORCHESTRATION_FEE * env.X402_USDC_PER_CREDIT).toFixed(6);

  const paymentConfig = {
    accepts: {
      scheme: 'exact' as const,
      network: `eip155:${chainId}` as `eip155:${string}`,
      payTo: env.X402_RECIPIENT_ADDRESS,
      maxTimeoutSeconds: 60,
    },
  };

  return paymentMiddlewareFromConfig(
    {
      'POST /skills/*': {
        accepts: {
          ...paymentConfig.accepts,
          price: dynamicSkillPrice,
        },
        description: 'ClawNet skill invocation — pay per call with USDC on Base',
        mimeType: 'application/json',
        unpaidResponseBody: () => ({
          contentType: 'application/json',
          body: {
            error: 'Payment required',
            code: 'X402_PAYMENT_REQUIRED',
            hint: 'Include X-PAYMENT header with USDC on Base, or use POST /v1/skills/:id/invoke with a ClawNet API key.',
            docs: 'https://claw-net.org/docs/x402',
          },
        }),
      },
      'POST /orchestrate': {
        accepts: {
          ...paymentConfig.accepts,
          price: orchestratePrice,
        },
        description: 'ClawNet orchestration — pay per query with USDC on Base',
        mimeType: 'application/json',
        unpaidResponseBody: () => ({
          contentType: 'application/json',
          body: {
            error: 'Payment required',
            code: 'X402_PAYMENT_REQUIRED',
            hint: 'Include X-PAYMENT header with USDC on Base. Price: ' + orchestratePrice + ' USDC.',
            docs: 'https://claw-net.org/docs/x402',
          },
        }),
      },
      'POST /query/*': {
        accepts: {
          ...paymentConfig.accepts,
          price: dynamicSkillPrice,
        },
        description: 'ClawNet data skill query — pay per call with USDC on Base',
        mimeType: 'application/json',
        unpaidResponseBody: () => ({
          contentType: 'application/json',
          body: {
            error: 'Payment required',
            code: 'X402_PAYMENT_REQUIRED',
            hint: 'Include X-PAYMENT header with USDC on Base, or use GET /v1/skills/:id/query with a ClawNet API key.',
            docs: 'https://claw-net.org/docs/x402',
          },
        }),
      },
    },
    facilitator,
    undefined, // no scheme registrations needed (facilitator handles verification)
    undefined, // no paywall UI needed
    undefined, // no custom paywall
    false,     // don't sync facilitator on start (lazy init)
  );
}

// ─── Apply middleware to router ───────────────────────────────────────────────

const x402Middleware = buildX402Middleware();

if (x402Middleware) {
  // Only apply x402 payment middleware to POST routes — GET routes (catalog, verify, info) stay public
  x402SkillsRouter.post('/skills/*', x402Middleware);
  x402SkillsRouter.post('/orchestrate', x402Middleware);
  x402SkillsRouter.post('/query/*', x402Middleware);
  logger.info({ recipientAddress: env.X402_RECIPIENT_ADDRESS, network: env.X402_NETWORK }, 'x402 provider mode active');
} else {
  logger.info('x402 provider mode disabled — set X402_RECIPIENT_ADDRESS to enable');
}

// ─── POST /x402/skills/:id — execute skill after x402 payment verified ────────

x402SkillsRouter.post('/skills/:id', async (c) => {
  const requestId = nanoid(12);
  const start = Date.now();
  const { id } = c.req.param();

  const skill = getSkill(id);
  if (!skill || !skill.public) {
    return c.json({ requestId, error: 'Skill not found or not public', code: 'SKILL_NOT_FOUND' }, 404);
  }

  let rawBody: unknown;
  try { rawBody = await c.req.json(); } catch { rawBody = {}; }

  const InvokeBody = z.object({ variables: z.record(z.string().max(500)).optional() });
  const bodyParsed = InvokeBody.safeParse(rawBody);
  if (!bodyParsed.success) {
    return c.json({ requestId, error: 'Invalid variables', code: 'INVALID_VARIABLES', details: bodyParsed.error.flatten().fieldErrors }, 400);
  }
  const variables = bodyParsed.data.variables ?? {};

  // Render the prompt template
  let query: string;
  try {
    query = renderTemplate(skill.prompt_template, variables);
  } catch (err) {
    return c.json({ requestId, error: (err instanceof Error ? err.message : String(err)), code: 'MISSING_VARIABLES' }, 400);
  }

  logger.info({ requestId, skillId: id, name: skill.name, via: 'x402' }, 'Skill invocation via x402');

  try {
    const intent = await parseIntent(query);
    if (intent.steps.length > 10) intent.steps = intent.steps.slice(0, 10);

    const execution = await executePlan(intent);
    const formatted = await formatResponse(query, intent, execution);

    const totalDurationMs = Date.now() - start;

    incrementSkillUses(id);

    // Record metric for health monitoring and trust signals
    recordSkillMetric({
      skillId: id,
      version: skill.version ?? '1.0.0',
      latencyMs: totalDurationMs,
      success: true,
      costCredits: skill.credit_cost,
    });

    const priceUsdc = (Math.max(skill.credit_cost, 1) * env.X402_USDC_PER_CREDIT).toFixed(6);

    // Option C lite: auto-split 85% of x402 revenue to creator's Base wallet (fire-and-forget)
    if (skill.creator_evm_wallet && env.EVM_PRIVATE_KEY) {
      const creatorShare = parseFloat((parseFloat(priceUsdc) * 0.85).toFixed(6));
      if (creatorShare > 0) {
        sendBaseUsdc(skill.creator_evm_wallet, creatorShare).catch((err) =>
          logger.error({ skillId: id, wallet: skill.creator_evm_wallet, err }, 'x402 creator split failed')
        );
      }
    }

    // Record receipt for verification
    try {
      insertX402Receipt({
        request_id: requestId, skill_id: id, skill_name: skill.name,
        price_usdc: priceUsdc, network: env.X402_NETWORK,
        payer_address: null, duration_ms: totalDurationMs, success: 1, error: null,
      });
    } catch (receiptErr) {
      logger.warn({ requestId, err: receiptErr }, 'Failed to insert x402 receipt');
    }

    return c.json({
      requestId,
      skillId: id,
      skillName: skill.name,
      answer: formatted.answer,
      opportunityScore: formatted.opportunityScore,
      riskScore: formatted.riskScore,
      suggestedActions: formatted.suggestedActions ?? [],
      metadata: {
        durationMs: totalDurationMs,
        stepsExecuted: execution.steps.length,
        paidVia: 'x402',
        network: env.X402_NETWORK,
        receiptId: requestId,
      },
    });
  } catch (err) {
    const totalDurationMs = Date.now() - start;
    logger.error({ requestId, skillId: id, err }, 'x402 skill execution error');

    // Record failed receipt
    try {
      insertX402Receipt({
        request_id: requestId, skill_id: id, skill_name: skill?.name ?? id,
        price_usdc: (Math.max(skill?.credit_cost ?? 1, 1) * env.X402_USDC_PER_CREDIT).toFixed(6),
        network: env.X402_NETWORK, payer_address: null,
        duration_ms: totalDurationMs, success: 0,
        error: env.NODE_ENV === 'production' ? 'Skill execution failed' : String(err),
      });
    } catch { /* receipt insert failure is non-critical */ }

    return c.json({
      requestId,
      error: env.NODE_ENV === 'production' ? 'Skill execution failed' : String(err),
      code: 'EXECUTION_FAILED',
    }, 500);
  }
});

// ─── POST /x402/orchestrate — x402-payable orchestration ───────────────────────

x402SkillsRouter.post('/orchestrate', async (c) => {
  const requestId = nanoid(12);
  const start = Date.now();

  let rawBody: unknown;
  try { rawBody = await c.req.json(); } catch { rawBody = {}; }

  const body = z.object({
    query: z.string().min(1).max(10000),
    pricing: z.object({
      maxCredits: z.number().optional(),
      strategy: z.enum(['cheapest', 'balanced', 'fastest', 'reliable']).optional(),
    }).optional(),
  }).safeParse(rawBody);

  if (!body.success) {
    return c.json({ requestId, error: 'Invalid body', code: 'INVALID_BODY' }, 400);
  }

  logger.info({ requestId, query: body.data.query.slice(0, 100), via: 'x402' }, 'Orchestration via x402');

  try {
    // Execute orchestration (same as api.ts but without credit deduction — x402 handles payment)
    const intent = await parseIntent(body.data.query);
    if (intent.steps.length > 10) intent.steps = intent.steps.slice(0, 10);
    const execution = await executePlan(intent);
    const formatted = await formatResponse(body.data.query, intent, execution);

    const durationMs = Date.now() - start;
    const priceUsdc = (env.ORCHESTRATION_FEE * env.X402_USDC_PER_CREDIT).toFixed(6);

    // Record x402 receipt
    try {
      insertX402Receipt({
        request_id: requestId, skill_id: 'orchestrate', skill_name: 'Orchestration',
        price_usdc: priceUsdc, network: env.X402_NETWORK, payer_address: null,
        duration_ms: durationMs, success: 1, error: null,
      });
    } catch (receiptErr) {
      logger.warn({ requestId, err: receiptErr }, 'Failed to insert x402 orchestration receipt');
    }

    return c.json({
      requestId,
      answer: formatted.answer,
      ...(formatted.opportunityScore !== undefined && { opportunityScore: formatted.opportunityScore }),
      ...(formatted.riskScore !== undefined && { riskScore: formatted.riskScore }),
      suggestedActions: formatted.suggestedActions ?? [],
      steps: execution.steps.map(s => ({
        endpoint: s.endpointId,
        cached: s.cached,
        success: s.success,
        durationMs: s.durationMs,
      })),
      metadata: {
        durationMs,
        stepsExecuted: execution.steps.length,
        paidVia: 'x402',
        network: env.X402_NETWORK,
        priceUsdc,
        receiptId: requestId,
      },
    });
  } catch (err) {
    const durationMs = Date.now() - start;
    logger.error({ requestId, err }, 'x402 orchestration failed');

    // Record failed receipt
    try {
      insertX402Receipt({
        request_id: requestId, skill_id: 'orchestrate', skill_name: 'Orchestration',
        price_usdc: (env.ORCHESTRATION_FEE * env.X402_USDC_PER_CREDIT).toFixed(6),
        network: env.X402_NETWORK, payer_address: null,
        duration_ms: durationMs, success: 0,
        error: env.NODE_ENV === 'production' ? 'Orchestration failed' : String(err),
      });
    } catch { /* receipt insert failure is non-critical */ }

    return c.json({
      requestId,
      error: env.NODE_ENV === 'production' ? 'Orchestration failed' : String(err),
      code: 'EXECUTION_FAILED',
    }, 500);
  }
});

// ─── POST /x402/query/:id — x402-payable data skill query ─────────────────────

function getDataSkillTtl(updateFrequency: string): number {
  switch (updateFrequency) {
    case 'realtime': return 60;
    case 'hourly':   return 3_600;
    case 'daily':    return 86_400;
    case 'weekly':   return 604_800;
    case 'static':   return 2_592_000;
    default: break;
  }
  const match = updateFrequency.match(/^(\d+)(s|m|h|d)$/);
  if (match) {
    const n = parseInt(match[1], 10);
    const unit = match[2];
    const multiplier = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3_600 : 86_400;
    return Math.max(10, Math.min(n * multiplier, 2_592_000));
  }
  return 3_600;
}

function isProxyUrlSafe(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    if (env.NODE_ENV === 'production' && url.protocol !== 'https:') return false;
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return false;
    if (/^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^192\.168\./.test(host)) return false;
    if (/^169\.254\./.test(host)) return false;
    if (host.startsWith('fc') || host.startsWith('fd')) return false;
    if (host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb')) return false;
    if (host.startsWith('::ffff:')) return false;
    return true;
  } catch {
    return false;
  }
}

x402SkillsRouter.post('/query/:id', async (c) => {
  const requestId = nanoid(12);
  const start = Date.now();
  const { id } = c.req.param();

  const skill = getSkill(id);
  if (!skill || skill.skill_type !== 'data') {
    return c.json({ requestId, error: 'Data skill not found', code: 'NOT_FOUND' }, 404);
  }
  if (!skill.public) {
    return c.json({ requestId, error: 'Skill not found or not public', code: 'SKILL_NOT_FOUND' }, 404);
  }
  if (skill.security_status === 'FLAGGED') {
    return c.json({ requestId, error: 'This skill has been flagged for review', code: 'SKILL_FLAGGED' }, 403);
  }
  if (!skill.proxy_url) {
    return c.json({ requestId, error: 'Data skill has no source URL configured', code: 'NO_SOURCE' }, 503);
  }

  let rawBody: unknown;
  try { rawBody = await c.req.json(); } catch { rawBody = {}; }

  const body = z.object({
    params: z.record(z.string().max(500)).optional(),
  }).safeParse(rawBody);

  if (!body.success) {
    return c.json({ requestId, error: 'Invalid body', code: 'INVALID_BODY' }, 400);
  }
  const queryParams = body.data.params ?? {};

  // Cap query params to prevent upstream URL abuse
  if (Object.keys(queryParams).length > 20) {
    return c.json({ requestId, error: 'Too many query parameters (max 20)', code: 'VALIDATION_ERROR' }, 400);
  }

  const priceUsdc = (Math.max(skill.credit_cost, 1) * env.X402_USDC_PER_CREDIT).toFixed(6);

  // Build cache key: skill id + sorted query params
  const cacheKey = 'x402data:' + crypto.createHash('sha256')
    .update(JSON.stringify({ id, p: Object.fromEntries(Object.entries(queryParams).sort()) }))
    .digest('hex').slice(0, 16);

  const ttl = getDataSkillTtl(skill.update_frequency ?? 'static');
  const cached = await cacheGet<Record<string, unknown>>(cacheKey);

  if (cached) {
    incrementSkillUses(id);
    logger.info({ requestId, skillId: id, via: 'x402' }, 'x402 data skill cache hit');
    return c.json({
      requestId, skillId: id,
      data: cached,
      _meta: { cacheHit: true, updateFrequency: skill.update_frequency ?? 'static', paidVia: 'x402', priceUsdc },
    });
  }

  // SSRF guard
  if (!isProxyUrlSafe(skill.proxy_url)) {
    return c.json({ requestId, error: 'Data source URL is blocked', code: 'SSRF_BLOCKED' }, 403);
  }

  logger.info({ requestId, skillId: id, name: skill.name, via: 'x402' }, 'Data skill query via x402');

  try {
    const url = new URL(skill.proxy_url);
    for (const [k, v] of Object.entries(queryParams)) url.searchParams.set(k, v);

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      logger.warn({ requestId, skillId: id, status: res.status }, 'x402 data skill source error');
      recordSkillMetric({ skillId: id, version: skill.version ?? '1.0.0', latencyMs: Date.now() - start, success: false, costCredits: 0 });

      try {
        insertX402Receipt({
          request_id: requestId, skill_id: id, skill_name: skill.name,
          price_usdc: priceUsdc, network: env.X402_NETWORK, payer_address: null,
          duration_ms: Date.now() - start, success: 0, error: `Source returned ${res.status}`,
        });
      } catch { /* non-critical */ }

      return c.json({
        requestId, error: 'Data source error', status: res.status, code: 'SOURCE_ERROR',
        hint: 'The upstream data source rejected this request. Try using a contract/mint address instead of a token name.',
      }, 502);
    }

    const data = await res.json().catch(async () => ({ raw: await res.text() }));

    // Cache result with TTL appropriate to data freshness
    await cacheSet(cacheKey, data, ttl);

    const totalDurationMs = Date.now() - start;
    incrementSkillUses(id);
    recordSkillMetric({ skillId: id, version: skill.version ?? '1.0.0', latencyMs: totalDurationMs, success: true, costCredits: skill.credit_cost });

    // Reputation boost for skill author
    if (skill.author_key) {
      recordReputation({ agentId: skill.author_key, skillId: id, eventType: 'SKILL_INVOKED', scoreDelta: 0.1 });
    }

    // Auto-split 85% of x402 revenue to creator's Base wallet (fire-and-forget)
    if (skill.creator_evm_wallet && env.EVM_PRIVATE_KEY) {
      const creatorShare = parseFloat((parseFloat(priceUsdc) * 0.85).toFixed(6));
      if (creatorShare > 0) {
        sendBaseUsdc(skill.creator_evm_wallet, creatorShare).catch((err) =>
          logger.error({ skillId: id, wallet: skill.creator_evm_wallet, err }, 'x402 data query creator split failed')
        );
      }
    }

    // Record receipt
    try {
      insertX402Receipt({
        request_id: requestId, skill_id: id, skill_name: skill.name,
        price_usdc: priceUsdc, network: env.X402_NETWORK, payer_address: null,
        duration_ms: totalDurationMs, success: 1, error: null,
      });
    } catch (receiptErr) {
      logger.warn({ requestId, err: receiptErr }, 'Failed to insert x402 data query receipt');
    }

    return c.json({
      requestId, skillId: id, skillName: skill.name,
      data,
      _meta: {
        cacheHit: false,
        updateFrequency: skill.update_frequency ?? 'static',
        ttlSeconds: ttl,
        sourceLatencyMs: totalDurationMs,
        paidVia: 'x402',
        network: env.X402_NETWORK,
        priceUsdc,
        receiptId: requestId,
      },
    });

  } catch (err) {
    const totalDurationMs = Date.now() - start;
    logger.error({ requestId, skillId: id, err }, 'x402 data skill query failed');
    recordSkillMetric({ skillId: id, version: skill.version ?? '1.0.0', latencyMs: totalDurationMs, success: false, costCredits: 0 });

    try {
      insertX402Receipt({
        request_id: requestId, skill_id: id, skill_name: skill?.name ?? id,
        price_usdc: priceUsdc, network: env.X402_NETWORK, payer_address: null,
        duration_ms: totalDurationMs, success: 0,
        error: env.NODE_ENV === 'production' ? 'Data fetch failed' : String(err),
      });
    } catch { /* non-critical */ }

    return c.json({
      requestId, error: 'Data fetch failed', code: 'FETCH_ERROR',
      hint: 'The data source could not be reached. Try again in a moment.',
    }, 502);
  }
});

// ─── GET /x402/skills — list all public skills with x402 pricing ───────────────

x402SkillsRouter.get('/skills', (c) => {
  if (!env.X402_RECIPIENT_ADDRESS) {
    return c.json({ error: 'x402 provider mode not enabled', code: 'X402_NOT_ENABLED', hint: 'Set X402_RECIPIENT_ADDRESS env var' }, 503);
  }

  const skills = listPublicSkills(0, 100);
  const chainId = env.X402_NETWORK === 'base-mainnet' ? '8453' : '84532';

  return c.json({
    network: env.X402_NETWORK,
    chainId,
    recipientAddress: env.X402_RECIPIENT_ADDRESS,
    facilitator: env.X402_FACILITATOR_URL,
    usdcPerCredit: env.X402_USDC_PER_CREDIT,
    skills: skills.map((s) => ({
      id: s.id,
      name: s.name,
      displayName: (s as typeof s & { display_name?: string }).display_name ?? s.name,
      description: s.description,
      creditCost: s.credit_cost,
      priceUsdc: (Math.max(s.credit_cost, 1) * env.X402_USDC_PER_CREDIT).toFixed(6),
      invokeEndpoint: `POST /x402/skills/${s.id}`,
      tags: safeJsonParse<string[]>(s.tags_json, []),
    })),
    totalSkills: skills.length,
  });
});

// ─── GET /x402/verify/:requestId — receipt verification ─────────────────────

x402SkillsRouter.get('/verify/:requestId', (c) => {
  const { requestId } = c.req.param();
  const receipt = getX402Receipt(requestId);
  if (!receipt) {
    return c.json({ error: 'Receipt not found', code: 'RECEIPT_NOT_FOUND' }, 404);
  }
  return c.json({
    requestId: receipt.request_id,
    verified: true,
    skillId: receipt.skill_id,
    skillName: receipt.skill_name,
    priceUsdc: receipt.price_usdc,
    network: receipt.network,
    success: receipt.success === 1,
    error: receipt.error,
    durationMs: receipt.duration_ms,
    timestamp: receipt.created_at,
  });
});

// ─── GET /x402/reputation/:agentKey — public reputation lookup ──────────────

x402SkillsRouter.get('/reputation/:agentKey', (c) => {
  const { agentKey } = c.req.param();
  const score = getReputationScore(agentKey);
  const events = getReputationEvents(agentKey, 20);

  let trustLevel: string;
  if (events.length >= 200) trustLevel = 'trusted';
  else if (events.length >= 50) trustLevel = 'established';
  else if (events.length >= 10) trustLevel = 'emerging';
  else trustLevel = 'new';

  return c.json({
    agentKey: maskApiKey(agentKey),
    score,
    trustLevel,
    totalEvents: getDb().prepare('SELECT COUNT(*) AS cnt FROM reputation_events WHERE agent_id = ?').get(agentKey) as { cnt: number } | undefined,
    recentEvents: events.map(e => ({
      ...e,
      agent_id: undefined, // strip raw key from public response
    })),
  });
});

// ─── x402 Echo Mode — test/sandbox routes (no real payment) ──────────────────
// Inspired by PayAI's "Echo Merchant" concept. Test payments are processed but
// no USDC changes hands. Receipts are marked with test=1 and excluded from
// revenue calculations.

const testRateLimit = new Map<string, number[]>();

function checkTestRateLimit(ip: string, maxPerHour: number): boolean {
  const now = Date.now();
  const hourAgo = now - 3_600_000;
  const calls = (testRateLimit.get(ip) ?? []).filter(t => t > hourAgo);
  if (calls.length >= maxPerHour) return false;
  calls.push(now);
  testRateLimit.set(ip, calls);
  return true;
}

// ─── GET /x402/test-config — test mode configuration info ────────────────────

x402SkillsRouter.get('/test-config', (c) => {
  return c.json({
    testMode: true,
    description: 'x402 Echo Mode — test payments are processed but refunded. Use for development and integration testing.',
    network: env.X402_NETWORK,
    testEndpoints: {
      invokeSkill: 'POST /x402/test/skills/:id',
      orchestrate: 'POST /x402/test/orchestrate',
    },
    note: 'Test receipts are marked with test=true and excluded from revenue calculations.',
  });
});

// ─── POST /x402/test/skills/:id — sandbox skill invocation (no payment) ──────

x402SkillsRouter.post('/test/skills/:id', async (c) => {
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown';
  if (!checkTestRateLimit(ip, 10)) {
    return c.json({ error: 'Test rate limit exceeded (10/hour)', code: 'TEST_RATE_LIMITED' }, 429);
  }

  const requestId = `test-${nanoid(12)}`;
  const start = Date.now();
  const { id } = c.req.param();

  const skill = getSkill(id);
  if (!skill || !skill.public) {
    return c.json({ requestId, error: 'Skill not found or not public', code: 'SKILL_NOT_FOUND' }, 404);
  }

  let rawBody: unknown;
  try { rawBody = await c.req.json(); } catch { rawBody = {}; }

  const InvokeBody = z.object({ variables: z.record(z.string().max(500)).optional() });
  const bodyParsed = InvokeBody.safeParse(rawBody);
  if (!bodyParsed.success) {
    return c.json({ requestId, error: 'Invalid variables', code: 'INVALID_VARIABLES', details: bodyParsed.error.flatten().fieldErrors }, 400);
  }
  const variables = bodyParsed.data.variables ?? {};

  let query: string;
  try {
    query = renderTemplate(skill.prompt_template, variables);
  } catch (err) {
    return c.json({ requestId, error: (err instanceof Error ? err.message : String(err)), code: 'MISSING_VARIABLES' }, 400);
  }

  logger.info({ requestId, skillId: id, name: skill.name, via: 'x402-test' }, 'Test skill invocation via x402 echo mode');

  try {
    const intent = await parseIntent(query);
    if (intent.steps.length > 10) intent.steps = intent.steps.slice(0, 10);

    const execution = await executePlan(intent);
    const formatted = await formatResponse(query, intent, execution);

    const totalDurationMs = Date.now() - start;
    const priceUsdc = (Math.max(skill.credit_cost, 1) * env.X402_USDC_PER_CREDIT).toFixed(6);

    // Record test receipt (no creator split, no real payment)
    try {
      insertX402Receipt({
        request_id: requestId, skill_id: id, skill_name: skill.name,
        price_usdc: priceUsdc, network: env.X402_NETWORK,
        payer_address: null, duration_ms: totalDurationMs, success: 1, error: null,
        test: 1,
      });
    } catch (receiptErr) {
      logger.warn({ requestId, err: receiptErr }, 'Failed to insert x402 test receipt');
    }

    return c.json({
      requestId,
      skillId: id,
      skillName: skill.name,
      answer: formatted.answer,
      opportunityScore: formatted.opportunityScore,
      riskScore: formatted.riskScore,
      suggestedActions: formatted.suggestedActions ?? [],
      metadata: {
        testMode: true,
        durationMs: totalDurationMs,
        stepsExecuted: execution.steps.length,
        paidVia: 'x402-test',
        network: env.X402_NETWORK,
        receiptId: requestId,
        priceUsdc,
        note: 'No real payment was charged. This is a test/sandbox invocation.',
      },
    });
  } catch (err) {
    const totalDurationMs = Date.now() - start;
    logger.error({ requestId, skillId: id, err }, 'x402 test skill execution error');

    try {
      insertX402Receipt({
        request_id: requestId, skill_id: id, skill_name: skill?.name ?? id,
        price_usdc: (Math.max(skill?.credit_cost ?? 1, 1) * env.X402_USDC_PER_CREDIT).toFixed(6),
        network: env.X402_NETWORK, payer_address: null,
        duration_ms: totalDurationMs, success: 0,
        error: env.NODE_ENV === 'production' ? 'Skill execution failed' : String(err),
        test: 1,
      });
    } catch { /* receipt insert failure is non-critical */ }

    return c.json({
      requestId,
      error: env.NODE_ENV === 'production' ? 'Skill execution failed' : String(err),
      code: 'EXECUTION_FAILED',
      metadata: { testMode: true },
    }, 500);
  }
});

// ─── POST /x402/test/orchestrate — sandbox orchestration (no payment) ────────

x402SkillsRouter.post('/test/orchestrate', async (c) => {
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown';
  if (!checkTestRateLimit(ip, 5)) {
    return c.json({ error: 'Test rate limit exceeded (5/hour)', code: 'TEST_RATE_LIMITED' }, 429);
  }

  const requestId = `test-${nanoid(12)}`;
  const start = Date.now();

  let rawBody: unknown;
  try { rawBody = await c.req.json(); } catch { rawBody = {}; }

  const body = z.object({
    query: z.string().min(1).max(10000),
    pricing: z.object({
      maxCredits: z.number().optional(),
      strategy: z.enum(['cheapest', 'balanced', 'fastest', 'reliable']).optional(),
    }).optional(),
  }).safeParse(rawBody);

  if (!body.success) {
    return c.json({ requestId, error: 'Invalid body', code: 'INVALID_BODY' }, 400);
  }

  logger.info({ requestId, query: body.data.query.slice(0, 100), via: 'x402-test' }, 'Test orchestration via x402 echo mode');

  try {
    const intent = await parseIntent(body.data.query);
    if (intent.steps.length > 10) intent.steps = intent.steps.slice(0, 10);
    const execution = await executePlan(intent);
    const formatted = await formatResponse(body.data.query, intent, execution);

    const durationMs = Date.now() - start;
    const priceUsdc = (env.ORCHESTRATION_FEE * env.X402_USDC_PER_CREDIT).toFixed(6);

    // Record test receipt (no real payment)
    try {
      insertX402Receipt({
        request_id: requestId, skill_id: 'orchestrate', skill_name: 'Orchestration',
        price_usdc: priceUsdc, network: env.X402_NETWORK, payer_address: null,
        duration_ms: durationMs, success: 1, error: null,
        test: 1,
      });
    } catch (receiptErr) {
      logger.warn({ requestId, err: receiptErr }, 'Failed to insert x402 test orchestration receipt');
    }

    return c.json({
      requestId,
      answer: formatted.answer,
      ...(formatted.opportunityScore !== undefined && { opportunityScore: formatted.opportunityScore }),
      ...(formatted.riskScore !== undefined && { riskScore: formatted.riskScore }),
      suggestedActions: formatted.suggestedActions ?? [],
      steps: execution.steps.map(s => ({
        endpoint: s.endpointId,
        cached: s.cached,
        success: s.success,
        durationMs: s.durationMs,
      })),
      metadata: {
        testMode: true,
        durationMs,
        stepsExecuted: execution.steps.length,
        paidVia: 'x402-test',
        network: env.X402_NETWORK,
        priceUsdc,
        receiptId: requestId,
        note: 'No real payment was charged. This is a test/sandbox orchestration.',
      },
    });
  } catch (err) {
    const durationMs = Date.now() - start;
    logger.error({ requestId, err }, 'x402 test orchestration failed');

    try {
      insertX402Receipt({
        request_id: requestId, skill_id: 'orchestrate', skill_name: 'Orchestration',
        price_usdc: (env.ORCHESTRATION_FEE * env.X402_USDC_PER_CREDIT).toFixed(6),
        network: env.X402_NETWORK, payer_address: null,
        duration_ms: durationMs, success: 0,
        error: env.NODE_ENV === 'production' ? 'Orchestration failed' : String(err),
        test: 1,
      });
    } catch { /* receipt insert failure is non-critical */ }

    return c.json({
      requestId,
      error: env.NODE_ENV === 'production' ? 'Orchestration failed' : String(err),
      code: 'EXECUTION_FAILED',
      metadata: { testMode: true },
    }, 500);
  }
});

// ─── GET /x402 — discovery endpoint ──────────────────────────────────────────

x402SkillsRouter.get('/', (c) => {
  return c.json({
    name: 'ClawNet x402 Provider',
    description: 'Pay-per-call access to ClawNet skills via x402 protocol (USDC on Base)',
    protocol: 'x402',
    version: '2.0',
    network: env.X402_NETWORK,
    enabled: !!env.X402_RECIPIENT_ADDRESS,
    endpoints: {
      listSkills: 'GET /x402/skills',
      invokeSkill: 'POST /x402/skills/:id',
      orchestrate: 'POST /x402/orchestrate',
      queryDataSkill: 'POST /x402/query/:id',
      verifyReceipt: 'GET /x402/verify/:requestId',
      reputation: 'GET /x402/reputation/:agentKey',
      testConfig: 'GET /x402/test-config',
      testInvokeSkill: 'POST /x402/test/skills/:id',
      testOrchestrate: 'POST /x402/test/orchestrate',
    },
    paymentInfo: {
      currency: 'USDC',
      chain: env.X402_NETWORK,
      facilitator: env.X402_FACILITATOR_URL,
      priceRange: `${env.X402_USDC_PER_CREDIT.toFixed(6)} - ${(env.X402_USDC_PER_CREDIT * 10000).toFixed(4)} USDC per call`,
    },
    docs: 'https://claw-net.org/docs/x402',
  });
});
