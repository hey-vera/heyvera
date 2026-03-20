/**
 * x402 Payment Verifier — Base USDC via CDP facilitator.
 *
 * Wraps the existing x402 verification pattern from src/routes/x402-skills.ts
 * into the KeylessPaymentVerifier interface. The actual payment verification
 * is handled by the @x402/hono paymentMiddleware + facilitator on the existing
 * /x402/* routes — this verifier provides a COMPLEMENTARY path for future
 * endpoints that want to accept x402 payments through the gateway abstraction.
 *
 * The x402 protocol flow:
 *   1. Client GETs a resource → server returns 402 with payment details
 *   2. Client pays USDC on Base chain → gets a payment proof
 *   3. Client retries the request with X-PAYMENT header containing the proof
 *   4. Server verifies proof via the CDP facilitator and serves the resource
 *
 * Headers used by x402:
 *   - X-PAYMENT: base64-encoded payment proof (v1 header, set by x402 client SDK)
 *   - PAYMENT-SIGNATURE: base64-encoded payment proof (v2 header, same payload as X-PAYMENT)
 *   - PAYMENT-REQUIRED: 402 response header with offer details (v2)
 *   - PAYMENT-RESPONSE: success confirmation header (v2)
 */

import type { KeylessPaymentVerifier, PaymentProof, PaymentChallenge } from './gateway.js';
import { env } from '../config/index.js';
import { round6 } from '../core/credits.js';
import { logger } from '../utils/logger.js';
import { getFacilitatorPool } from '../providers/x402-facilitator.js';

export class X402Verifier implements KeylessPaymentVerifier {
  readonly protocol = 'x402';
  readonly name = 'x402 (Base USDC)';

  isEnabled(): boolean {
    return !!env.X402_RECIPIENT_ADDRESS;
  }

  /**
   * Parse x402 payment proof from request headers.
   *
   * The x402 SDK sets the X-PAYMENT header with a JSON payload containing:
   *   - payload: the payment details (amount, recipient, network, etc.)
   *   - signature: cryptographic signature from the payer's wallet
   *
   * Returns null if no x402 payment headers are present.
   */
  parseProof(headers: Record<string, string>): PaymentProof | null {
    // x402 v1 uses X-PAYMENT header, v2 uses PAYMENT-SIGNATURE (case-insensitive check)
    const paymentHeader =
      headers['x-payment'] ??
      headers['X-PAYMENT'] ??
      headers['X-Payment'] ??
      headers['payment-signature'] ??
      headers['PAYMENT-SIGNATURE'] ??
      headers['Payment-Signature'];

    if (!paymentHeader) return null;

    try {
      // The x402 payment header is a JSON string (sometimes base64-encoded)
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(paymentHeader) as Record<string, unknown>;
      } catch {
        // Try base64 decode
        const decoded = Buffer.from(paymentHeader, 'base64').toString('utf-8');
        parsed = JSON.parse(decoded) as Record<string, unknown>;
      }

      // Extract payer address from the payment payload
      const payload = (parsed.payload ?? parsed) as Record<string, unknown>;
      const payer = (payload.from ?? payload.payer ?? payload.sender ?? 'unknown') as string;
      const amountRaw = payload.amount ?? payload.value ?? '0';
      const amount = typeof amountRaw === 'string' ? parseFloat(amountRaw) : (amountRaw as number);

      return {
        protocol: 'x402',
        payer,
        amount: Number.isFinite(amount) ? amount : 0,
        currency: 'USDC',
        chain: 'base',
        txHash: (payload.txHash ?? payload.transactionHash) as string | undefined,
        proof: parsed,
        verified_at: new Date().toISOString(),
      };
    } catch (err) {
      logger.debug({ err }, 'Failed to parse x402 payment header');
      return null;
    }
  }

  /**
   * Verify x402 payment proof via the CDP facilitator.
   *
   * NOTE: The existing /x402/* routes use @x402/hono's paymentMiddleware which
   * handles verification internally. This verify() method provides an
   * independent verification path for the gateway abstraction, calling the
   * facilitator's /verify endpoint directly.
   *
   * For full production use, this should call the facilitator's REST API to
   * confirm the payment was actually settled on-chain. Currently it performs
   * structural validation — the @x402/hono middleware remains the primary
   * verification path for /x402/* routes.
   */
  async verify(proof: PaymentProof, requiredAmountUsd: number): Promise<{ valid: boolean; error?: string }> {
    if (proof.protocol !== 'x402') {
      return { valid: false, error: 'Proof is not x402 protocol' };
    }

    // Structural validation
    if (!proof.proof) {
      return { valid: false, error: 'Missing x402 payment proof data' };
    }

    // Amount check — allow 1% tolerance for rounding/gas
    const tolerance = round6(requiredAmountUsd * 0.01);
    if (proof.amount < requiredAmountUsd - tolerance) {
      return {
        valid: false,
        error: `Insufficient payment: got $${proof.amount.toFixed(6)}, required $${requiredAmountUsd.toFixed(6)}`,
      };
    }

    // Verify via facilitator pool — handles primary/fallback with health tracking
    const verifyPayload = {
      payment: proof.proof,
      recipient: env.X402_RECIPIENT_ADDRESS,
      network: `eip155:${env.X402_NETWORK === 'base-mainnet' ? '8453' : '84532'}`,
    };

    const pool = getFacilitatorPool();
    const result = await pool.verify(verifyPayload);

    if (result.valid) {
      if (result.facilitator) {
        logger.debug({ facilitator: result.facilitator }, '[x402] Payment verified via facilitator pool');
      }
      return { valid: true };
    }

    return { valid: false, error: result.error ?? 'Facilitator could not verify payment' };
  }

  /**
   * Generate a 402 payment challenge for x402 protocol.
   *
   * Clients receiving this challenge should:
   *   1. Send USDC to the recipient address on Base chain
   *   2. Obtain a payment proof from the x402 facilitator
   *   3. Retry the request with X-PAYMENT (v1) or PAYMENT-SIGNATURE (v2) header
   */
  generateChallenge(amountUsd: number, metadata?: Record<string, unknown>): PaymentChallenge {
    const chainId = env.X402_NETWORK === 'base-mainnet' ? '8453' : '84532';

    return {
      protocol: 'x402',
      amount: round6(amountUsd),
      currency: 'USDC',
      recipient: env.X402_RECIPIENT_ADDRESS || '',
      network: `eip155:${chainId}`,
      details: {
        scheme: 'exact',
        chainId,
        chainName: env.X402_NETWORK,
        facilitator: getFacilitatorPool().getPrimaryUrl(),
        maxTimeoutSeconds: 60,
        header: 'X-PAYMENT',
        headerV2: 'PAYMENT-SIGNATURE',
        ...metadata,
      },
    };
  }
}
