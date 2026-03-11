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
import { getSkill, listPublicSkills, incrementSkillUses } from '../db/index';
import { renderTemplate } from '../utils/template';
import { parseIntent } from '../core/intent-parser';
import { executePlan } from '../core/executor';
import { formatResponse } from '../core/formatter';
import { logger } from '../utils/logger';
import { env } from '../config/index';

export const x402SkillsRouter = new Hono();

// ─── Build middleware (only when recipient address is configured) ──────────────

function buildX402Middleware() {
  if (!env.X402_RECIPIENT_ADDRESS) return null;

  const facilitator = new HTTPFacilitatorClient(env.X402_FACILITATOR_URL);
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
      },
    });
  } catch (err) {
    logger.error({ requestId, skillId: id, err }, 'x402 skill execution error');
    return c.json({ requestId, error: 'Skill execution failed', details: String(err) }, 500);
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
      tags: s.tags_json ? JSON.parse(s.tags_json as string) : [],
    })),
    totalSkills: skills.length,
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
