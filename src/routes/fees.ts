/**
 * Fee Schedule Routes — Public, auditable fee transparency
 *
 * GET  /v1/fees/formula  — Published fee formula (versioned, auditable)
 * GET  /v1/fees/estimate — Estimate fee breakdown for a hypothetical transaction
 */

import { Hono } from 'hono';
import { z } from 'zod';
import {
  getPublicFeeSchedule,
  computeInfrastructureFee,
  computeZeroFee,
  computeProductFee,
  type FeeType,
} from '../core/fee-spine';

export const feesRouter = new Hono();

// ─── Public Fee Formula ─────────────────────────────────────────────────────

feesRouter.get('/formula', (c) => {
  return c.json({
    ok: true,
    fees: getPublicFeeSchedule(),
  });
});

// ─── Fee Estimate ───────────────────────────────────────────────────────────

const estimateSchema = z.object({
  type: z.enum([
    'endpoint_call', 'cache_hit', 'soma_check_hit', 'skill_invoke',
    'transfer', 'trust_query', 'proof_generation', 'orchestration',
    'custody_event', 'deposit', 'payout',
  ]),
  amount: z.number().min(0).max(1_000_000),
  trustScore: z.number().min(0).max(100).default(0),
});

feesRouter.get('/estimate', async (c) => {
  const type = c.req.query('type') as FeeType;
  const amount = parseFloat(c.req.query('amount') ?? '0');
  const trustScore = parseFloat(c.req.query('trustScore') ?? '0');

  const parsed = estimateSchema.safeParse({ type, amount, trustScore });
  if (!parsed.success) {
    return c.json({ error: 'Invalid parameters', code: 'INVALID_FEE_ESTIMATE', details: parsed.error.issues }, 400);
  }

  const { type: feeType, amount: feeAmount, trustScore: score } = parsed.data;

  // Zero-fee types
  const zeroFeeTypes: FeeType[] = ['transfer', 'orchestration', 'custody_event', 'deposit'];
  if (zeroFeeTypes.includes(feeType)) {
    return c.json({ ok: true, breakdown: computeZeroFee(feeType, feeAmount, score) });
  }

  // Product types (100% to platform)
  const productTypes: FeeType[] = ['trust_query', 'proof_generation'];
  if (productTypes.includes(feeType)) {
    return c.json({ ok: true, breakdown: computeProductFee(feeType, feeAmount, score) });
  }

  // Infrastructure rate (endpoint, cache, skill)
  return c.json({ ok: true, breakdown: computeInfrastructureFee(feeType, feeAmount, score) });
});
