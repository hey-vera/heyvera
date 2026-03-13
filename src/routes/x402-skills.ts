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
import { getDb, getSkill, listPublicSkills, incrementSkillUses, safeJsonParse, getReputationScore, getReputationEvents } from '../db/index';
import { maskApiKey } from '../utils/mask';
import { renderTemplate } from '../utils/template';
import { parseIntent } from '../core/intent-parser';
import { executePlan } from '../core/executor';
import { formatResponse } from '../core/formatter';
import { sendBaseUsdc } from '../utils/evm-payout';
import { logger } from '../utils/logger';
import { env } from '../config/index';

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
}

function insertX402Receipt(receipt: Omit<X402Receipt, 'created_at'>): void {
  getDb().prepare(`
    INSERT INTO x402_receipts (request_id, skill_id, skill_name, price_usdc, network, payer_address, duration_ms, success, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(receipt.request_id, receipt.skill_id, receipt.skill_name, receipt.price_usdc, receipt.network, receipt.payer_address, receipt.duration_ms, receipt.success, receipt.error);
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
].filter((url, i, arr) => arr.indexOf(url) === i); // deduplicate

function createFacilitator(): unknown {
  // Primary facilitator — if it fails at runtime, the x402 middleware handles the error.
  // We log which one we're using so operators know.
  const primary = FACILITATOR_FALLBACKS[0];
  logger.info({ facilitator: primary, fallbacks: FACILITATOR_FALLBACKS.length - 1 }, 'x402 facilitator configured');
  return new HTTPFacilitatorClient(primary);
}

function buildX402Middleware() {
  if (!env.X402_RECIPIENT_ADDRESS) return null;

  const facilitator = createFacilitator();
  const chainId = env.X402_NETWORK === 'base-mainnet' ? '8453' : '84532';

  const dynamicPrice = async (ctx: HTTPRequestContext) => {
    // Extract skill ID from path: /x402/skills/:id
    const parts = ctx.path.split('/');
    const skillId = parts[parts.length - 1] ?? '';
    const skill = getSkill(skillId);
    const credits = Math.max(skill?.credit_cost ?? 1, 1);
    const priceUsdc = credits * env.X402_USDC_PER_CREDIT;
    // Return as string USDC amount (e.g. "0.001")
    return priceUsdc.toFixed(6);
  };

  return paymentMiddlewareFromConfig(
    {
      'POST /x402/skills/*': {
        accepts: {
          scheme: 'exact',
          network: `eip155:${chainId}` as `eip155:${string}`,
          payTo: env.X402_RECIPIENT_ADDRESS,
          price: dynamicPrice,
          maxTimeoutSeconds: 60,
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
  x402SkillsRouter.use('/skills/*', x402Middleware);
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
    return c.json({ requestId, error: 'Skill not found or not public' }, 404);
  }

  let rawBody: unknown;
  try { rawBody = await c.req.json(); } catch { rawBody = {}; }

  const InvokeBody = z.object({ variables: z.record(z.string().max(500)).optional() });
  const bodyParsed = InvokeBody.safeParse(rawBody);
  if (!bodyParsed.success) {
    return c.json({ requestId, error: 'Invalid variables', details: bodyParsed.error.flatten().fieldErrors }, 400);
  }
  const variables = bodyParsed.data.variables ?? {};

  // Render the prompt template
  let query: string;
  try {
    query = renderTemplate(skill.prompt_template, variables);
  } catch (err) {
    return c.json({ requestId, error: (err as Error).message, code: 'MISSING_VARIABLES' }, 400);
  }

  logger.info({ requestId, skillId: id, name: skill.name, via: 'x402' }, 'Skill invocation via x402');

  try {
    const intent = await parseIntent(query);
    if (intent.steps.length > 10) intent.steps = intent.steps.slice(0, 10);

    const execution = await executePlan(intent);
    const formatted = await formatResponse(query, intent, execution);

    const totalDurationMs = Date.now() - start;

    incrementSkillUses(id);

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

// ─── GET /x402/skills — list all public skills with x402 pricing ───────────────

x402SkillsRouter.get('/skills', (c) => {
  if (!env.X402_RECIPIENT_ADDRESS) {
    return c.json({ error: 'x402 provider mode not enabled', hint: 'Set X402_RECIPIENT_ADDRESS env var' }, 503);
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
      verifyReceipt: 'GET /x402/verify/:requestId',
      reputation: 'GET /x402/reputation/:agentKey',
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
