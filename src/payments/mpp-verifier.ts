/**
 * MPP (Machine Payments Protocol) — Stripe + Tempo L1
 *
 * NOT YET IMPLEMENTED. This stub exists to show the pluggable pattern
 * and will be completed when MPP gains real adoption among AI agents.
 *
 * MPP overview:
 *   - Session-based spending caps (agents pre-authorize a spending limit)
 *   - Fiat fallback via Stripe (pay USD if no crypto wallet)
 *   - Batch settlement on Tempo L1 (reduces per-call gas costs)
 *   - Requires Tempo L1 wallet for the recipient
 *
 * Expected flow:
 *   1. Agent creates an MPP session with a spending cap (POST to MPP facilitator)
 *   2. Each request includes X-MPP-Session + X-MPP-Authorization headers
 *   3. Server verifies session is valid and has remaining budget
 *   4. Settlement happens in batches on Tempo L1 (or instantly via Stripe)
 *
 * To implement:
 *   - Set MPP_API_KEY and MPP_MERCHANT_ID env vars
 *   - Implement parseProof() to extract session + authorization from headers
 *   - Implement verify() to check session validity with MPP facilitator
 *   - Implement generateChallenge() to return session creation instructions
 */

import type { KeylessPaymentVerifier, PaymentProof, PaymentChallenge } from './gateway.js';

export class MppVerifier implements KeylessPaymentVerifier {
  readonly protocol = 'mpp';
  readonly name = 'MPP (Tempo + Stripe)';

  isEnabled(): boolean {
    // Enable when MPP_ENABLED=true + required env vars are set
    // return !!process.env.MPP_ENABLED && !!process.env.MPP_API_KEY && !!process.env.MPP_MERCHANT_ID;
    return false;
  }

  parseProof(headers: Record<string, string>): PaymentProof | null {
    // MPP proof would be in X-MPP-Session + X-MPP-Authorization headers
    // Session ID identifies the pre-authorized spending session
    // Authorization contains a signed spending proof for this specific request
    const _session = headers['x-mpp-session'] ?? headers['X-MPP-Session'];
    const _auth = headers['x-mpp-authorization'] ?? headers['X-MPP-Authorization'];

    // Not implemented — return null so the gateway skips to the next verifier
    return null;
  }

  async verify(_proof: PaymentProof, _requiredAmountUsd: number): Promise<{ valid: boolean; error?: string }> {
    // When implemented:
    //   1. Validate session ID with MPP facilitator
    //   2. Check remaining session budget >= requiredAmountUsd
    //   3. Verify authorization signature
    //   4. Deduct from session budget
    return { valid: false, error: 'MPP verification not yet implemented' };
  }

  generateChallenge(amountUsd: number, _metadata?: Record<string, unknown>): PaymentChallenge {
    return {
      protocol: 'mpp',
      amount: amountUsd,
      currency: 'USD',
      recipient: process.env.MPP_MERCHANT_ID ?? '',
      network: 'tempo',
      details: {
        status: 'not_implemented',
        hint: 'MPP support is planned. Use x402 (Base USDC) for keyless payments.',
        sessionEndpoint: 'https://api.mpp.dev/sessions',  // placeholder
        supportedCurrencies: ['USD', 'USDC'],
        settlementChain: 'tempo-l1',
      },
    };
  }
}
