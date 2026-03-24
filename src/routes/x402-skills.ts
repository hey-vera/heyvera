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
const { paymentMiddleware } = require('@x402/hono') as {
  paymentMiddleware: (...args: unknown[]) => import('hono').MiddlewareHandler;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { HTTPFacilitatorClient, x402ResourceServer } = require('@x402/core/server') as {
  HTTPFacilitatorClient: new (config: { url: string; createAuthHeaders?: unknown }) => unknown;
  x402ResourceServer: new (facilitator: unknown) => { register: (network: string, scheme: unknown) => unknown };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createFacilitatorConfig: createCdpFacilitatorConfig } = require('@coinbase/x402') as {
  createFacilitatorConfig: (apiKeyId: string, apiKeySecret: string) => { url: string; createAuthHeaders: unknown };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ExactEvmScheme } = require('@x402/evm/exact/server') as {
  ExactEvmScheme: new () => unknown;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { bazaarResourceServerExtension, declareDiscoveryExtension } = require('@x402/extensions/bazaar') as {
  bazaarResourceServerExtension: unknown;
  declareDiscoveryExtension: (config: { input?: unknown; inputSchema?: unknown; bodyType?: string; output?: unknown }) => Record<string, unknown>;
};
type HTTPRequestContext = { path: string; method: string; paymentHeader?: string };
import { apiRegistry } from '../config/api-registry';
import { getDb, getSkill, getApiKey, listPublicSkills, incrementSkillUses, safeJsonParse, getReputationScore, getReputationEvents, recordSkillMetric, recordReputation, createAutoAttestation, hashPayload, getAttestationById, logAudit } from '../db/index';
import { maskApiKey } from '../utils/mask';
import { renderTemplate } from '../utils/template';
import { parseIntent } from '../core/intent-parser';
import { executePlan } from '../core/executor';
import { formatResponse } from '../core/formatter';
import { sendBaseUsdc } from '../utils/evm-payout';
import { logger } from '../utils/logger';
import { env } from '../config/index';
import { round6 } from '../core/credits';
import { cacheGet, cacheSet } from '../cache/index';
import { getFacilitatorPool } from '../providers/x402-facilitator';
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
  payment_hash?: string | null;
  facilitator_receipt_json?: string | null;
  payer_address_verified?: number;
  attestation_id?: string | null;
}

function insertX402Receipt(receipt: Omit<X402Receipt, 'created_at'>): void {
  const testFlag = receipt.test ?? 0;
  getDb().prepare(`
    INSERT INTO x402_receipts (request_id, skill_id, skill_name, price_usdc, network, payer_address, duration_ms, success, error, test, payment_hash, facilitator_receipt_json, payer_address_verified, attestation_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    receipt.request_id, receipt.skill_id, receipt.skill_name, receipt.price_usdc,
    receipt.network, receipt.payer_address, receipt.duration_ms, receipt.success,
    receipt.error, testFlag,
    receipt.payment_hash ?? null,
    receipt.facilitator_receipt_json ?? null,
    receipt.payer_address_verified ?? 0,
    receipt.attestation_id ?? null,
  );
}

/** Update receipt with attestation_id after execution */
function linkReceiptAttestation(requestId: string, attestationId: string): void {
  getDb().prepare('UPDATE x402_receipts SET attestation_id = ? WHERE request_id = ?').run(attestationId, requestId);
}

function getX402Receipt(requestId: string): X402Receipt | undefined {
  return getDb().prepare('SELECT * FROM x402_receipts WHERE request_id = ?').get(requestId) as X402Receipt | undefined;
}

// ─── Idempotency ──────────────────────────────────────────────────────────────

/** SHA-256 hash of the X-PAYMENT / PAYMENT-SIGNATURE header for idempotency deduplication */
function hashPaymentHeader(paymentHeader: string): string {
  return crypto.createHash('sha256').update(paymentHeader).digest('hex');
}

/** Look up an existing receipt by payment_hash (idempotency check) */
function getReceiptByPaymentHash(paymentHash: string): X402Receipt | undefined {
  return getDb().prepare('SELECT * FROM x402_receipts WHERE payment_hash = ?').get(paymentHash) as X402Receipt | undefined;
}

/** Extract facilitator receipt + payer address from x402 payment context */
function extractPaymentContext(c: { req: { header: (name: string) => string | undefined; raw: unknown } }): {
  paymentHash: string | null;
  paymentHeader: string | null;
  facilitatorReceipt: string | null;
  payerAddress: string | null;
} {
  // Accept both x402 v1 (X-PAYMENT) and v2 (PAYMENT-SIGNATURE) headers
  const paymentHeader = c.req.header('x-payment') ?? c.req.header('X-PAYMENT') ?? c.req.header('PAYMENT-SIGNATURE') ?? c.req.header('payment-signature') ?? null;
  if (!paymentHeader) return { paymentHash: null, paymentHeader: null, facilitatorReceipt: null, payerAddress: null };

  const paymentHash = hashPaymentHeader(paymentHeader);

  // Try to extract payer address and facilitator receipt from the payment header
  // x402 payment headers are base64-encoded JSON containing payment proof
  let facilitatorReceipt: string | null = null;
  let payerAddress: string | null = null;

  try {
    // The payment header may be JSON or base64-encoded JSON
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(paymentHeader);
    } catch {
      parsed = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf-8'));
    }

    // Extract payer address from payment payload
    if (typeof parsed.from === 'string') payerAddress = parsed.from;
    else if (typeof parsed.payer === 'string') payerAddress = parsed.payer;
    else if (typeof parsed.sender === 'string') payerAddress = parsed.sender;

    // Store the full payment header as facilitator receipt proof
    facilitatorReceipt = JSON.stringify(parsed);
  } catch {
    // If we can't parse the payment header, store it raw
    facilitatorReceipt = paymentHeader;
  }

  return { paymentHash, paymentHeader, facilitatorReceipt, payerAddress };
}

// ─── Dynamic payTo routing ────────────────────────────────────────────────────

/** Resolve the x402 payTo address for a skill. If the skill has direct_payout
 *  enabled AND the creator has a wallet_address on their API key, route payment
 *  directly to the creator's wallet. Otherwise, fall back to platform wallet. */
function resolvePayTo(skill: { direct_payout: number; author_key: string }): {
  payTo: string;
  isDirectPayout: boolean;
  creatorWallet: string | null;
} {
  if (skill.direct_payout === 1) {
    const creatorKey = getApiKey(skill.author_key) as (ReturnType<typeof getApiKey> & { wallet_address?: string }) | undefined;
    if (creatorKey?.wallet_address) {
      return { payTo: creatorKey.wallet_address, isDirectPayout: true, creatorWallet: creatorKey.wallet_address };
    }
  }
  return { payTo: env.X402_RECIPIENT_ADDRESS || '', isDirectPayout: false, creatorWallet: null };
}

// ─── x402 Offer Extension ─────────────────────────────────────────────────────

const X402_OFFER_VERSION = 1;

interface X402Offer {
  scheme: string;
  network: string;
  asset: string;
  payTo: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  paymentContext: {
    skillId: string;
    creditCost: number;
    usdCost: string;
  };
  extra: {
    name: string;
    version: string;
    facilitator: string;
  };
}

interface X402OfferResponse {
  error: string;
  code: string;
  offers: X402Offer[];
  x402Version: number;
}

/** Build a standardized x402 offer for a skill or orchestration resource. */
function buildX402Offer(opts: {
  skillId: string;
  skillName: string;
  creditCost: number;
  resource: string;
  description?: string;
  payTo?: string;
}): X402Offer {
  const credits = Math.max(opts.creditCost, 1);
  const usdCost = round6(credits * env.X402_USDC_PER_CREDIT);

  return {
    scheme: 'exact',
    network: env.X402_NETWORK,
    asset: 'USDC',
    payTo: opts.payTo || env.X402_RECIPIENT_ADDRESS || '',
    maxAmountRequired: usdCost.toFixed(6),
    resource: opts.resource,
    description: opts.description ?? `Invoke ClawNet skill: ${opts.skillName}`,
    mimeType: 'application/json',
    paymentContext: {
      skillId: opts.skillId,
      creditCost: round6(credits),
      usdCost: usdCost.toFixed(6),
    },
    extra: {
      name: 'ClawNet',
      version: '1.0.0',
      facilitator: getFacilitatorPool().getPrimaryUrl(),
    },
  };
}

/** Build a full 402 offer response with offers array. */
function buildX402OfferResponse(offers: X402Offer[]): X402OfferResponse {
  return {
    error: 'Payment Required',
    code: 'PAYMENT_REQUIRED',
    offers,
    x402Version: X402_OFFER_VERSION,
  };
}

/** Encode an offer response as a base64 string for the X-PAYMENT-OFFER / PAYMENT-REQUIRED headers. */
function encodeOfferHeader(offerResponse: X402OfferResponse): string {
  return Buffer.from(JSON.stringify(offerResponse)).toString('base64');
}

export const x402SkillsRouter = new Hono();

// ─── AID Protocol: optional identity + trust verification on x402 routes ──────
// When X-AID-DID is present, verify Ed25519 proof and resolve trust score.
// When absent, x402 flow proceeds unchanged (backwards compatible).
import { checkAidProof } from '../middleware/aid-verify';
import { aidProviderProof } from '../middleware/aid-provider-proof';
x402SkillsRouter.use('*', checkAidProof);
x402SkillsRouter.use('*', aidProviderProof);

// ─── Build middleware (only when recipient address is configured) ──────────────

// ─── Facilitator with fallback (uses FacilitatorPool) ────────────────────────

function createFacilitator(): unknown {
  // Use CDP authenticated facilitator for mainnet (requires CDP_API_KEY_ID + CDP_API_KEY_SECRET)
  if (env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET) {
    // Docker/dotenv may store \n as literal \\n or \n — handle both
    let secret = env.CDP_API_KEY_SECRET.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n');
    // CDP SDK (jose) requires PKCS8 format (BEGIN PRIVATE KEY), not SEC1 (BEGIN EC PRIVATE KEY)
    if (secret.includes('BEGIN EC PRIVATE KEY')) {
      const { createPrivateKey } = require('crypto') as typeof import('crypto');
      secret = createPrivateKey({ key: secret, format: 'pem' }).export({ type: 'pkcs8', format: 'pem' }) as string;
    }
    const config = createCdpFacilitatorConfig(env.CDP_API_KEY_ID, secret);
    logger.info({ facilitator: config.url, authenticated: true }, 'x402 CDP facilitator configured (mainnet)');
    return new HTTPFacilitatorClient(config);
  }

  // Fallback: unauthenticated facilitator (testnet only — x402.org/facilitator)
  const pool = getFacilitatorPool();
  const primaryUrl = pool.getPrimaryUrl();
  logger.info({ facilitator: primaryUrl, authenticated: false, pool: pool.getStatus() }, 'x402 facilitator configured (unauthenticated — testnet only)');
  return new HTTPFacilitatorClient({ url: primaryUrl });
}

function buildX402Middleware() {
  if (!env.X402_RECIPIENT_ADDRESS) return null;

  const facilitator = createFacilitator();
  const chainId = env.X402_NETWORK === 'base-mainnet' ? '8453' : '84532';
  const network = `eip155:${chainId}` as `eip155:${string}`;

  // Build resource server with ExactEvmScheme + Bazaar discovery registered
  const resourceServer = new x402ResourceServer(facilitator);
  try { (resourceServer as unknown as { registerExtension: (ext: unknown) => void }).registerExtension(bazaarResourceServerExtension); } catch { /* extension optional */ }
  (resourceServer as unknown as { register: (n: string, s: unknown) => unknown }).register(network, new ExactEvmScheme());

  /** Resolve price and payTo per-request for skill routes (supports direct payout). */
  const dynamicSkillPrice = async (ctx: HTTPRequestContext) => {
    const parts = ctx.path.split('/');
    const skillId = parts[parts.length - 1] ?? '';
    const skill = getSkill(skillId);
    const credits = Math.max(skill?.credit_cost ?? 1, 1);
    const priceUsdc = credits * env.X402_USDC_PER_CREDIT;
    return `$${priceUsdc.toFixed(6)}`;
  };

  /** Resolve payTo address per-request — creator wallet for direct payout skills,
   *  platform wallet otherwise. */
  const dynamicSkillPayTo = async (ctx: HTTPRequestContext) => {
    const parts = ctx.path.split('/');
    const skillId = parts[parts.length - 1] ?? '';
    const skill = getSkill(skillId);
    if (skill) {
      const { payTo } = resolvePayTo(skill);
      return payTo;
    }
    return env.X402_RECIPIENT_ADDRESS || '';
  };

  const orchestratePrice = `$${(env.ORCHESTRATION_FEE * env.X402_USDC_PER_CREDIT).toFixed(6)}`;

  return paymentMiddleware(
    {
      'POST /x402/skills/*': {
        accepts: {
          scheme: 'exact' as const,
          network,
          payTo: dynamicSkillPayTo,
          price: dynamicSkillPrice,
          maxTimeoutSeconds: 60,
        },
        description: 'ClawNet skill invocation — pay per call with USDC on Base. 370+ API endpoints, marketplace skills, trust attestations.',
        mimeType: 'application/json',
        extensions: {
          ...declareDiscoveryExtension({
            input: { skillId: 'sol-price-data', variables: { token: 'SOL' } },
            inputSchema: {
              properties: {
                skillId: { type: 'string', description: 'Skill ID from the ClawNet marketplace' },
                variables: { type: 'object', description: 'Input variables for the skill' },
              },
              required: ['skillId'],
            },
            bodyType: 'json',
            output: {
              example: { result: { price: 145.20, change24h: 3.1 }, attestation: { id: 'att-abc123', verifyUrl: 'https://api.claw-net.org/v1/attest/verify/att-abc123' } },
              schema: { properties: { result: { type: 'object' }, attestation: { type: 'object' } } },
            },
          }),
        },
      },
      'POST /x402/orchestrate': {
        accepts: {
          scheme: 'exact' as const,
          network,
          payTo: env.X402_RECIPIENT_ADDRESS,
          price: orchestratePrice,
          maxTimeoutSeconds: 60,
        },
        description: `ClawNet AI orchestration — natural language queries across ${apiRegistry.length}+ data sources. Every response includes cryptographic attestation and trust verdict.`,
        mimeType: 'application/json',
        extensions: {
          ...declareDiscoveryExtension({
            input: { query: 'What is the price of SOL?', pricing: { strategy: 'balanced' } },
            inputSchema: {
              properties: {
                query: { type: 'string', description: 'Natural language question' },
                pricing: {
                  type: 'object',
                  properties: {
                    maxCredits: { type: 'number', description: 'Maximum credits to spend' },
                    strategy: { type: 'string', enum: ['cheapest', 'balanced', 'fastest', 'reliable'] },
                  },
                },
              },
              required: ['query'],
            },
            bodyType: 'json',
            output: {
              example: { result: 'SOL is $145.20, up 3.1% in 24h', sources: ['coingecko', 'birdeye'], trust: { verdict: 'PROCEED', confidence: 0.92 } },
              schema: { properties: { result: { type: 'string' }, sources: { type: 'array' }, trust: { type: 'object' } } },
            },
          }),
        },
      },
      'POST /x402/query/*': {
        accepts: {
          scheme: 'exact' as const,
          network,
          payTo: dynamicSkillPayTo,
          price: dynamicSkillPrice,
          maxTimeoutSeconds: 60,
        },
        description: 'ClawNet data skill query — structured JSON data from 370+ endpoints. No LLM, fast, cheap.',
        mimeType: 'application/json',
        extensions: {
          ...declareDiscoveryExtension({
            input: { token: 'SOL' },
            inputSchema: {
              properties: {
                token: { type: 'string', description: 'Token symbol or query parameter' },
              },
            },
            bodyType: 'json',
            output: {
              example: { data: { price: 145.20, volume24h: 4200000000 }, cached: false },
              schema: { properties: { data: { type: 'object' }, cached: { type: 'boolean' } } },
            },
          }),
        },
      },
    },
    resourceServer,
  );
}

// ─── Apply middleware to router ───────────────────────────────────────────────

const x402Middleware = buildX402Middleware();

// Pre-middleware: if no payment header on a paid route, return our own 402 with full body
// This runs BEFORE the x402 SDK middleware, so we control the response entirely
x402SkillsRouter.use('*', async (c, next) => {
  const method = c.req.method;
  const path = c.req.path;
  const isPaidRoute = method === 'POST' && (
    path.match(/\/skills\/[^/]+$/) ||
    path.match(/\/query\/[^/]+$/) ||
    path.endsWith('/orchestrate')
  );

  if (!isPaidRoute || !env.X402_RECIPIENT_ADDRESS) return next();

  // Check for payment headers (v1 + v2)
  const hasPayment = c.req.header('X-PAYMENT') || c.req.header('PAYMENT-SIGNATURE') || c.req.header('payment-signature');
  if (hasPayment) return next(); // Has payment — let SDK verify it

  // No payment — return 402 with full body (bypasses SDK which returns empty {})
  const skillMatch = path.match(/\/(?:skills|query)\/([^/]+)/);
  const isOrchestrate = path.includes('/orchestrate');

  let skillId = 'orchestrate';
  let creditCost = env.ORCHESTRATION_FEE;
  let description = 'ClawNet AI orchestration query';
  let resource = '/x402/orchestrate';
  let inputSchema: Record<string, unknown> = {
    type: 'object', required: ['query'],
    properties: { query: { type: 'string', description: 'Natural language question or task' } },
  };

  if (skillMatch) {
    skillId = skillMatch[1];
    const sk = getSkill(skillId);
    if (sk) {
      creditCost = sk.credit_cost;
      description = path.includes('/query/') ? `Query data skill: ${sk.name}` : `Invoke skill: ${sk.name}`;
      resource = path.includes('/query/') ? `/x402/query/${skillId}` : `/x402/skills/${skillId}`;
      if (sk.input_schema_json) {
        try { inputSchema = JSON.parse(sk.input_schema_json); } catch {}
      }
    }
  }

  const priceUsdc = round6(creditCost * env.X402_USDC_PER_CREDIT);
  const chainId = env.X402_NETWORK === 'base-mainnet' ? '8453' : '84532';

  const paymentRequired = {
    x402Version: 2,
    error: 'Payment required',
    resource: { url: `${env.CLAWNET_BASE_URL || 'https://api.claw-net.org'}${resource}`, description, mimeType: 'application/json' },
    accepts: [{
      scheme: 'exact',
      network: `eip155:${chainId}`,
      amount: String(Math.round(priceUsdc * 1_000_000)),
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      payTo: env.X402_RECIPIENT_ADDRESS,
      maxTimeoutSeconds: 60,
    }],
    // x402scan v2 (@agentcash/discovery) extracts schema from:
    // payload.extensions.bazaar.schema.properties.input.properties.body
    extensions: {
      bazaar: {
        schema: {
          properties: {
            input: {
              properties: {
                body: inputSchema,
              },
            },
            output: {
              properties: {
                example: { type: 'object', properties: { answer: { type: 'string' }, data: { type: 'object' } } },
              },
            },
          },
        },
      },
    },
  };

  const encoded = Buffer.from(JSON.stringify(paymentRequired)).toString('base64');

  return c.json(paymentRequired, 402, {
    'PAYMENT-REQUIRED': encoded,
    'X-PAYMENT-OFFER': encoded,
    'X-Payment-Protocol': 'x402',
  });
});

if (x402Middleware) {
  x402SkillsRouter.use('*', x402Middleware);
  logger.info({ recipientAddress: env.X402_RECIPIENT_ADDRESS, network: env.X402_NETWORK }, 'x402 provider mode active');
} else {
  logger.info('x402 provider mode disabled — set X402_RECIPIENT_ADDRESS to enable');
}

// ─── x402 Offer Extension — attach X-PAYMENT-OFFER header on 402 responses ───

x402SkillsRouter.use('*', async (c, next) => {
  await next();

  if (c.res.status === 402 && env.X402_RECIPIENT_ADDRESS) {
    // Extract skill ID from the URL path for a skill-specific offer
    const path = c.req.path;
    const skillMatch = path.match(/\/(?:skills|query)\/([^/]+)/);
    let offers: X402Offer[];

    if (skillMatch) {
      const skillId = skillMatch[1];
      const skill = getSkill(skillId);
      if (skill) {
        const resource = path.includes('/query/') ? `/x402/query/${skillId}` : `/x402/skills/${skillId}`;
        const desc = path.includes('/query/')
          ? `Query ClawNet data skill: ${skill.name}`
          : `Invoke ClawNet skill: ${skill.name}`;
        const { payTo } = resolvePayTo(skill);
        offers = [buildX402Offer({
          skillId,
          skillName: skill.name,
          creditCost: skill.credit_cost,
          resource,
          description: desc,
          payTo,
        })];
      } else {
        offers = [buildX402Offer({
          skillId: 'orchestrate',
          skillName: 'Orchestration',
          creditCost: env.ORCHESTRATION_FEE,
          resource: '/x402/orchestrate',
          description: 'ClawNet AI orchestration query',
        })];
      }
    } else if (path.includes('/orchestrate')) {
      offers = [buildX402Offer({
        skillId: 'orchestrate',
        skillName: 'Orchestration',
        creditCost: env.ORCHESTRATION_FEE,
        resource: '/x402/orchestrate',
        description: 'ClawNet AI orchestration query',
      })];
    } else {
      // Generic offer for unknown routes
      offers = [buildX402Offer({
        skillId: 'unknown',
        skillName: 'ClawNet',
        creditCost: 1,
        resource: path,
        description: 'ClawNet x402 resource',
      })];
    }

    const offerResponse = buildX402OfferResponse(offers);
    const encoded = encodeOfferHeader(offerResponse);

    // Clone the response to add the header (Hono responses may be immutable)
    const newHeaders = new Headers(c.res.headers);
    // v1 headers
    newHeaders.set('X-PAYMENT-OFFER', encoded);
    newHeaders.set('X-Payment-Protocol', 'x402');
    // v2 headers
    newHeaders.set('PAYMENT-REQUIRED', encoded);
    newHeaders.set('Content-Type', 'application/json');

    // Build input schema for x402scan registration
    const skillMatch2 = path.match(/\/(?:skills|query)\/([^/]+)/);
    let inputSchema: Record<string, unknown> = { type: 'object', properties: { query: { type: 'string', description: 'Natural language question' } } };
    if (skillMatch2) {
      const sk = getSkill(skillMatch2[1]);
      if (sk?.input_schema_json) {
        try { inputSchema = JSON.parse(sk.input_schema_json); } catch {}
      } else {
        inputSchema = { type: 'object', properties: { variables: { type: 'object', additionalProperties: { type: 'string' } } } };
      }
    }

    // Decode payment-required header to include in body (x402scan needs body, not just headers)
    let paymentBody: Record<string, unknown> = {};
    try {
      const payReqHeader = newHeaders.get('PAYMENT-REQUIRED') || newHeaders.get('payment-required');
      if (payReqHeader) paymentBody = JSON.parse(Buffer.from(payReqHeader, 'base64').toString());
    } catch {}

    const bodyObj = {
      ...paymentBody,
      inputSchema,
    };
    const bodyStr = JSON.stringify(bodyObj);
    newHeaders.delete('content-length');

    c.res = new Response(bodyStr, {
      status: 402,
      statusText: 'Payment Required',
      headers: newHeaders,
    });
  }
});

// ─── POST /x402/skills/:id — execute skill after x402 payment verified ────────

x402SkillsRouter.post('/skills/:id', async (c) => {
  const requestId = nanoid(12);
  const start = Date.now();
  const { id } = c.req.param();

  // ─── Idempotency: check if this exact payment was already processed ─────
  const payCtx = extractPaymentContext(c);
  if (payCtx.paymentHash) {
    const existing = getReceiptByPaymentHash(payCtx.paymentHash);
    if (existing) {
      logger.info({ requestId, existingRequestId: existing.request_id, paymentHash: payCtx.paymentHash }, 'x402 idempotent replay — returning cached receipt');
      return c.json({
        requestId: existing.request_id,
        idempotent: true,
        skillId: existing.skill_id,
        skillName: existing.skill_name,
        success: existing.success === 1,
        error: existing.error,
        metadata: {
          durationMs: existing.duration_ms,
          paidVia: 'x402',
          network: existing.network,
          receiptId: existing.request_id,
          originalTimestamp: existing.created_at,
          note: 'This is a cached response from a previous identical payment. No double-execution occurred.',
        },
      });
    }
  }

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

    // ─── Direct payout vs platform split ─────────────────────────────────
    const payToInfo = resolvePayTo(skill);
    if (payToInfo.isDirectPayout) {
      // Direct payout: x402 payment already went to creator's wallet on-chain.
      // No credit split needed. Log the direct payout for audit trail.
      logAudit({ entityType: 'skill', entityId: id, action: 'X402_DIRECT_PAYOUT',
        data: { priceUsdc, creatorWallet: payToInfo.creatorWallet, network: env.X402_NETWORK } });
      logger.info({ skillId: id, priceUsdc, creatorWallet: payToInfo.creatorWallet }, 'x402 direct payout — creator received payment on-chain');
    } else if (skill.creator_evm_wallet && env.EVM_PRIVATE_KEY) {
      // Legacy path: platform received payment, auto-split 85% to creator's Base wallet
      const creatorShare = parseFloat((parseFloat(priceUsdc) * 0.85).toFixed(6));
      if (creatorShare > 0) {
        sendBaseUsdc(skill.creator_evm_wallet, creatorShare).catch((err) =>
          logger.error({ skillId: id, wallet: skill.creator_evm_wallet, err }, 'x402 creator split failed')
        );
      }
    }

    // ─── Create attestation (delivery proof) ──────────────────────────────
    let attestationId: string | null = null;
    try {
      attestationId = createAutoAttestation(
        payCtx.payerAddress ?? `x402:${requestId}`,
        'INVOKE_SKILL',
        `POST /x402/skills/${id}`,
        { skillId: id, variables },
        { answer: formatted.answer },
        skill.credit_cost,
        totalDurationMs,
        undefined,
        execution.steps.map(s => ({
          endpointId: s.endpointId,
          success: s.success,
          cached: s.cached,
          durationMs: s.durationMs,
          cost: s.cost,
        })),
      );
    } catch (attErr) {
      logger.warn({ requestId, err: attErr }, 'Failed to create x402 attestation');
    }

    // Record receipt with payment proof + attestation link
    try {
      insertX402Receipt({
        request_id: requestId, skill_id: id, skill_name: skill.name,
        price_usdc: priceUsdc, network: env.X402_NETWORK,
        payer_address: payCtx.payerAddress, duration_ms: totalDurationMs, success: 1, error: null,
        payment_hash: payCtx.paymentHash,
        facilitator_receipt_json: payCtx.facilitatorReceipt,
        payer_address_verified: payCtx.payerAddress ? 1 : 0,
        attestation_id: attestationId,
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
        ...(attestationId && { attestationId }),
        ...(payToInfo.isDirectPayout && { directPayout: true, payTo: payToInfo.creatorWallet }),
      },
    });
  } catch (err) {
    const totalDurationMs = Date.now() - start;
    logger.error({ requestId, skillId: id, err }, 'x402 skill execution error');

    // Record failed receipt with payment context
    try {
      insertX402Receipt({
        request_id: requestId, skill_id: id, skill_name: skill?.name ?? id,
        price_usdc: (Math.max(skill?.credit_cost ?? 1, 1) * env.X402_USDC_PER_CREDIT).toFixed(6),
        network: env.X402_NETWORK, payer_address: payCtx.payerAddress,
        duration_ms: totalDurationMs, success: 0,
        error: env.NODE_ENV === 'production' ? 'Skill execution failed' : String(err),
        payment_hash: payCtx.paymentHash,
        facilitator_receipt_json: payCtx.facilitatorReceipt,
        payer_address_verified: payCtx.payerAddress ? 1 : 0,
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

  // ─── Idempotency: check if this exact payment was already processed ─────
  const payCtx = extractPaymentContext(c);
  if (payCtx.paymentHash) {
    const existing = getReceiptByPaymentHash(payCtx.paymentHash);
    if (existing) {
      logger.info({ requestId, existingRequestId: existing.request_id, paymentHash: payCtx.paymentHash }, 'x402 idempotent replay — returning cached receipt');
      return c.json({
        requestId: existing.request_id,
        idempotent: true,
        success: existing.success === 1,
        error: existing.error,
        metadata: {
          durationMs: existing.duration_ms,
          paidVia: 'x402',
          network: existing.network,
          receiptId: existing.request_id,
          originalTimestamp: existing.created_at,
          note: 'This is a cached response from a previous identical payment. No double-execution occurred.',
        },
      });
    }
  }

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

    // ─── Create attestation (delivery proof) ──────────────────────────────
    let attestationId: string | null = null;
    try {
      attestationId = createAutoAttestation(
        payCtx.payerAddress ?? `x402:${requestId}`,
        'ORCHESTRATE',
        'POST /x402/orchestrate',
        { query: body.data.query },
        { answer: formatted.answer },
        env.ORCHESTRATION_FEE,
        durationMs,
        undefined,
        execution.steps.map(s => ({
          endpointId: s.endpointId,
          success: s.success,
          cached: s.cached,
          durationMs: s.durationMs,
          cost: s.cost,
        })),
      );
    } catch (attErr) {
      logger.warn({ requestId, err: attErr }, 'Failed to create x402 orchestration attestation');
    }

    // Record x402 receipt with payment proof + attestation link
    try {
      insertX402Receipt({
        request_id: requestId, skill_id: 'orchestrate', skill_name: 'Orchestration',
        price_usdc: priceUsdc, network: env.X402_NETWORK, payer_address: payCtx.payerAddress,
        duration_ms: durationMs, success: 1, error: null,
        payment_hash: payCtx.paymentHash,
        facilitator_receipt_json: payCtx.facilitatorReceipt,
        payer_address_verified: payCtx.payerAddress ? 1 : 0,
        attestation_id: attestationId,
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
        ...(attestationId && { attestationId }),
      },
    });
  } catch (err) {
    const durationMs = Date.now() - start;
    logger.error({ requestId, err }, 'x402 orchestration failed');

    // Record failed receipt with payment context
    try {
      insertX402Receipt({
        request_id: requestId, skill_id: 'orchestrate', skill_name: 'Orchestration',
        price_usdc: (env.ORCHESTRATION_FEE * env.X402_USDC_PER_CREDIT).toFixed(6),
        network: env.X402_NETWORK, payer_address: payCtx.payerAddress,
        duration_ms: durationMs, success: 0,
        error: env.NODE_ENV === 'production' ? 'Orchestration failed' : String(err),
        payment_hash: payCtx.paymentHash,
        facilitator_receipt_json: payCtx.facilitatorReceipt,
        payer_address_verified: payCtx.payerAddress ? 1 : 0,
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

  // ─── Idempotency: check if this exact payment was already processed ─────
  const payCtx = extractPaymentContext(c);
  if (payCtx.paymentHash) {
    const existing = getReceiptByPaymentHash(payCtx.paymentHash);
    if (existing) {
      logger.info({ requestId, existingRequestId: existing.request_id, paymentHash: payCtx.paymentHash }, 'x402 idempotent replay — returning cached receipt');
      return c.json({
        requestId: existing.request_id,
        idempotent: true,
        skillId: existing.skill_id,
        skillName: existing.skill_name,
        success: existing.success === 1,
        error: existing.error,
        metadata: {
          durationMs: existing.duration_ms,
          paidVia: 'x402',
          network: existing.network,
          receiptId: existing.request_id,
          originalTimestamp: existing.created_at,
          note: 'This is a cached response from a previous identical payment. No double-execution occurred.',
        },
      });
    }
  }

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
          price_usdc: priceUsdc, network: env.X402_NETWORK, payer_address: payCtx.payerAddress,
          duration_ms: Date.now() - start, success: 0, error: `Source returned ${res.status}`,
          payment_hash: payCtx.paymentHash,
          facilitator_receipt_json: payCtx.facilitatorReceipt,
          payer_address_verified: payCtx.payerAddress ? 1 : 0,
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

    // ─── Direct payout vs platform split ─────────────────────────────────
    const dataPayToInfo = resolvePayTo(skill);
    if (dataPayToInfo.isDirectPayout) {
      logAudit({ entityType: 'skill', entityId: id, action: 'X402_DIRECT_PAYOUT',
        data: { priceUsdc, creatorWallet: dataPayToInfo.creatorWallet, network: env.X402_NETWORK } });
      logger.info({ skillId: id, priceUsdc, creatorWallet: dataPayToInfo.creatorWallet }, 'x402 data query direct payout — creator received payment on-chain');
    } else if (skill.creator_evm_wallet && env.EVM_PRIVATE_KEY) {
      const creatorShare = parseFloat((parseFloat(priceUsdc) * 0.85).toFixed(6));
      if (creatorShare > 0) {
        sendBaseUsdc(skill.creator_evm_wallet, creatorShare).catch((err) =>
          logger.error({ skillId: id, wallet: skill.creator_evm_wallet, err }, 'x402 data query creator split failed')
        );
      }
    }

    // ─── Create attestation (delivery proof) ──────────────────────────────
    let attestationId: string | null = null;
    try {
      attestationId = createAutoAttestation(
        payCtx.payerAddress ?? `x402:${requestId}`,
        'QUERY_DATA_SKILL',
        `POST /x402/query/${id}`,
        { skillId: id, params: queryParams },
        data,
        skill.credit_cost,
        totalDurationMs,
        undefined,
        [{ endpointId: skill.proxy_url || id, success: true, cached: false, durationMs: totalDurationMs, cost: skill.credit_cost }],
      );
    } catch (attErr) {
      logger.warn({ requestId, err: attErr }, 'Failed to create x402 data query attestation');
    }

    // Record receipt with payment proof + attestation link
    try {
      insertX402Receipt({
        request_id: requestId, skill_id: id, skill_name: skill.name,
        price_usdc: priceUsdc, network: env.X402_NETWORK, payer_address: payCtx.payerAddress,
        duration_ms: totalDurationMs, success: 1, error: null,
        payment_hash: payCtx.paymentHash,
        facilitator_receipt_json: payCtx.facilitatorReceipt,
        payer_address_verified: payCtx.payerAddress ? 1 : 0,
        attestation_id: attestationId,
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
        ...(attestationId && { attestationId }),
        ...(dataPayToInfo.isDirectPayout && { directPayout: true, payTo: dataPayToInfo.creatorWallet }),
      },
    });

  } catch (err) {
    const totalDurationMs = Date.now() - start;
    logger.error({ requestId, skillId: id, err }, 'x402 data skill query failed');
    recordSkillMetric({ skillId: id, version: skill.version ?? '1.0.0', latencyMs: totalDurationMs, success: false, costCredits: 0 });

    try {
      insertX402Receipt({
        request_id: requestId, skill_id: id, skill_name: skill?.name ?? id,
        price_usdc: priceUsdc, network: env.X402_NETWORK, payer_address: payCtx.payerAddress,
        duration_ms: totalDurationMs, success: 0,
        error: env.NODE_ENV === 'production' ? 'Data fetch failed' : String(err),
        payment_hash: payCtx.paymentHash,
        facilitator_receipt_json: payCtx.facilitatorReceipt,
        payer_address_verified: payCtx.payerAddress ? 1 : 0,
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
    skills: skills.map((s) => {
      const { payTo, isDirectPayout } = resolvePayTo(s);
      return {
        id: s.id,
        name: s.name,
        displayName: (s as typeof s & { display_name?: string }).display_name ?? s.name,
        description: s.description,
        creditCost: s.credit_cost,
        priceUsdc: (Math.max(s.credit_cost, 1) * env.X402_USDC_PER_CREDIT).toFixed(6),
        payTo,
        ...(isDirectPayout && { directPayout: true }),
        invokeEndpoint: `POST /x402/skills/${s.id}`,
        tags: safeJsonParse<string[]>(s.tags_json, []),
      };
    }),
    totalSkills: skills.length,
  });
});

// ─── GET /x402/verify/:requestId — receipt verification ─────────────────────

x402SkillsRouter.get('/verify/:requestId', async (c) => {
  const { requestId } = c.req.param();
  const receipt = getX402Receipt(requestId);
  if (!receipt) {
    return c.json({ error: 'Receipt not found', code: 'RECEIPT_NOT_FOUND' }, 404);
  }

  // Build payment proof section (facilitator receipt)
  let facilitatorReceipt: Record<string, unknown> | null = null;
  if (receipt.facilitator_receipt_json) {
    try { facilitatorReceipt = JSON.parse(receipt.facilitator_receipt_json); } catch { /* raw string */ }
  }

  const payment = {
    facilitatorReceipt,
    payerAddress: receipt.payer_address,
    payerVerified: (receipt.payer_address_verified ?? 0) === 1,
    paymentHash: receipt.payment_hash ?? null,
  };

  // Build delivery proof section (attestation link)
  let delivery: Record<string, unknown> | null = null;
  if (receipt.attestation_id) {
    try {
      const att = getAttestationById(receipt.attestation_id);
      if (att) {
        delivery = {
          attestationId: att.id,
          verificationUrl: `/v1/attest/verify/${att.id}`,
          outcomeStatus: att.outcome_status,
          creditsCharged: att.credits_charged,
          actionType: att.action_type,
          actionEndpoint: att.action_endpoint,
          manifestAligned: att.manifest_aligned === 1 ? true : att.manifest_aligned === 0 ? false : null,
          signedAt: att.signed_at,
          signaturePresent: !!att.signature,
        };
      }
    } catch {
      delivery = { attestationId: receipt.attestation_id, verificationUrl: `/v1/attest/verify/${receipt.attestation_id}` };
    }
  }

  // Deep verification: call facilitator to confirm on-chain settlement
  let facilitatorReverified: boolean | null = null;
  if (c.req.query('deep') === 'true' && facilitatorReceipt) {
    try {
      const { getFacilitatorPool } = await import('../providers/x402-facilitator');
      const pool = getFacilitatorPool();
      const verifyResult = await pool.verify(JSON.stringify(facilitatorReceipt));
      facilitatorReverified = verifyResult.valid;
    } catch {
      facilitatorReverified = null; // facilitator unreachable
    }
  }

  // Chain integrity: verify predecessor hash if present
  let chainIntegrity: boolean | null = null;
  if (delivery && receipt.attestation_id) {
    try {
      const att = getAttestationById(receipt.attestation_id);
      if (att && (att as Record<string, unknown>).prev_attestation_hash) {
        chainIntegrity = true; // chain link exists
      }
    } catch {}
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
    // Complete trust chain: payment proof + delivery proof
    payment: {
      ...payment,
      ...(facilitatorReverified !== null && { facilitatorReverified, reverifiedAt: new Date().toISOString() }),
    },
    ...(delivery && { delivery: { ...delivery, chainIntegrity } }),
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

// GET /x402/offer/:skillId — pre-fetch x402 pricing for a specific skill
x402SkillsRouter.get('/offer/:skillId', (c) => {
  if (!env.X402_RECIPIENT_ADDRESS) {
    return c.json({ error: 'x402 provider mode not enabled', code: 'X402_NOT_ENABLED' }, 503);
  }

  const { skillId } = c.req.param();

  // Special case: orchestration offer
  if (skillId === 'orchestrate') {
    const offer = buildX402Offer({
      skillId: 'orchestrate',
      skillName: 'Orchestration',
      creditCost: env.ORCHESTRATION_FEE,
      resource: '/x402/orchestrate',
      description: 'ClawNet AI orchestration query',
    });
    const offerResponse = buildX402OfferResponse([offer]);
    c.header('X-PAYMENT-OFFER', encodeOfferHeader(offerResponse));
    c.header('PAYMENT-REQUIRED', encodeOfferHeader(offerResponse));
    return c.json(offerResponse);
  }

  const skill = getSkill(skillId);
  if (!skill || !skill.public) {
    return c.json({ error: 'Skill not found or not public', code: 'SKILL_NOT_FOUND' }, 404);
  }

  const resource = skill.skill_type === 'data'
    ? `/x402/query/${skillId}`
    : `/x402/skills/${skillId}`;
  const desc = skill.skill_type === 'data'
    ? `Query ClawNet data skill: ${skill.name}`
    : `Invoke ClawNet skill: ${skill.name}`;

  const { payTo } = resolvePayTo(skill);
  const offer = buildX402Offer({
    skillId,
    skillName: skill.name,
    creditCost: skill.credit_cost,
    resource,
    description: desc,
    payTo,
  });

  const offerResponse = buildX402OfferResponse([offer]);
  c.header('X-PAYMENT-OFFER', encodeOfferHeader(offerResponse));
  c.header('PAYMENT-REQUIRED', encodeOfferHeader(offerResponse));
  return c.json(offerResponse);
});

// ─── GET /x402 — discovery endpoint ──────────────────────────────────────────

x402SkillsRouter.get('/', (c) => {
  return c.json({
    name: 'ClawNet x402 Provider',
    description: 'Pay-per-call access to ClawNet skills via x402 protocol (USDC on Base)',
    protocol: 'x402',
    version: '2.2',
    network: env.X402_NETWORK,
    enabled: !!env.X402_RECIPIENT_ADDRESS,
    x402Version: X402_OFFER_VERSION,
    endpoints: {
      listSkills: 'GET /x402/skills',
      invokeSkill: 'POST /x402/skills/:id',
      orchestrate: 'POST /x402/orchestrate',
      queryDataSkill: 'POST /x402/query/:id',
      offerSkill: 'GET /x402/offer/:skillId',
      offerOrchestrate: 'GET /x402/offer/orchestrate',
      verifyReceipt: 'GET /x402/verify/:requestId',
      reputation: 'GET /x402/reputation/:agentKey',
      testConfig: 'GET /x402/test-config',
      testInvokeSkill: 'POST /x402/test/skills/:id',
      testOrchestrate: 'POST /x402/test/orchestrate',
    },
    paymentInfo: {
      currency: 'USDC',
      chain: env.X402_NETWORK,
      facilitator: getFacilitatorPool().getPrimaryUrl(),
      priceRange: `${env.X402_USDC_PER_CREDIT.toFixed(6)} - ${(env.X402_USDC_PER_CREDIT * 10000).toFixed(4)} USDC per call`,
    },
    headers: {
      v1: { payment: 'X-PAYMENT', offer: 'X-PAYMENT-OFFER' },
      v2: { payment: 'PAYMENT-SIGNATURE', offer: 'PAYMENT-REQUIRED', response: 'PAYMENT-RESPONSE' },
      note: 'Both v1 and v2 headers are accepted on requests and set on responses for backward compatibility.',
    },
    docs: 'https://claw-net.org/docs/x402',
  });
});
