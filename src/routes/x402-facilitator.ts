/**
 * x402-facilitator.ts — Fee-free x402 facilitator endpoint
 *
 * Hosts a public x402 facilitator at /x402/facilitator/* that any x402 client
 * can use instead of Coinbase's facilitator ($0.001/tx). Zero fees.
 *
 * This is part of the AID Protocol distribution strategy: by offering a free
 * facilitator, we attract x402 traffic that can then be offered trust-gated
 * pricing via AID headers.
 *
 * Endpoints:
 *   POST /x402/facilitator/verify  — verify a payment proof (free)
 *   POST /x402/facilitator/settle  — settle a payment on-chain (free)
 *   GET  /x402/facilitator/health  — facilitator health check
 *   GET  /x402/facilitator/info    — facilitator metadata
 *
 * Compatible with the x402 facilitator protocol spec.
 * Requires: SOLANA_PRIVATE_KEY or EVM_PRIVATE_KEY for on-chain settlement.
 */

import { Hono } from 'hono';
import { env } from '../config/index';
import { logger } from '../utils/logger';

const router = new Hono();

// ─── Info ────────────────────────────────────────────────────────────────────

router.get('/info', (c) => {
  return c.json({
    name: 'ClawNet x402 Facilitator',
    version: '1.0.0',
    protocol: 'x402',
    fee: '0',
    feeDescription: 'Zero fees — powered by AID Protocol',
    chains: ['base'],
    currencies: ['USDC'],
    baseUsdcContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    aidProtocol: {
      enabled: true,
      description: 'Requests with X-AID-DID headers get trust-gated pricing on ClawNet skills',
      spec: 'https://github.com/aidprotocol/aid-spec',
    },
    contact: 'https://claw-net.org',
  });
});

// ─── Health ──────────────────────────────────────────────────────────────────

router.get('/health', (c) => {
  const hasSettlementKey = !!(env.SOLANA_PRIVATE_KEY || process.env.EVM_PRIVATE_KEY);
  return c.json({
    status: hasSettlementKey ? 'healthy' : 'degraded',
    chain: 'base',
    canVerify: true,
    canSettle: hasSettlementKey,
    timestamp: new Date().toISOString(),
  });
});

// ─── Verify ──────────────────────────────────────────────────────────────────

router.post('/verify', async (c) => {
  try {
    const body = await c.req.json();

    // Validate required fields per x402 payment proof format
    if (!body || !body.payload) {
      return c.json({ valid: false, error: 'Missing payment payload' }, 400);
    }

    const { payload, signature } = body;

    // Verify the EIP-3009 or EIP-712 signature
    // For now, we use the facilitator pool's verification logic
    const { getFacilitatorPool } = await import('../providers/x402-facilitator');
    const pool = getFacilitatorPool();

    try {
      const result = await pool.verify(body);
      return c.json({
        valid: result.valid,
        txHash: result.txHash || null,
        error: result.error || null,
        facilitator: 'clawnet',
        fee: '0',
      });
    } catch (verifyErr: any) {
      // If upstream facilitators fail, attempt basic signature verification
      logger.warn({ err: verifyErr }, 'Facilitator pool verify failed, returning unverified');
      return c.json({
        valid: false,
        error: 'Verification temporarily unavailable',
        facilitator: 'clawnet',
      }, 503);
    }
  } catch (err: any) {
    logger.error({ err }, 'x402 facilitator verify error');
    return c.json({ valid: false, error: 'Invalid request body' }, 400);
  }
});

// ─── Settle ──────────────────────────────────────────────────────────────────

router.post('/settle', async (c) => {
  try {
    const body = await c.req.json();

    if (!body || !body.payload) {
      return c.json({ settled: false, error: 'Missing payment payload' }, 400);
    }

    const { getFacilitatorPool } = await import('../providers/x402-facilitator');
    const pool = getFacilitatorPool();

    try {
      const result = await pool.settle(body);
      return c.json({
        settled: result.settled,
        txHash: result.txHash || null,
        error: result.error || null,
        facilitator: 'clawnet',
        fee: '0',
      });
    } catch (settleErr: any) {
      logger.error({ err: settleErr }, 'x402 facilitator settle failed');
      return c.json({
        settled: false,
        error: 'Settlement failed: ' + (settleErr.message || 'unknown error'),
        facilitator: 'clawnet',
      }, 500);
    }
  } catch (err: any) {
    logger.error({ err }, 'x402 facilitator settle error');
    return c.json({ settled: false, error: 'Invalid request body' }, 400);
  }
});

export { router as x402FacilitatorRouter };
