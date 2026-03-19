/**
 * LSAT (Lightning Service Authentication Token) — Lightning Network
 *
 * NOT YET IMPLEMENTED. This stub exists to show the pluggable pattern
 * and will be completed when Lightning LSAT gains adoption among AI agents.
 *
 * LSAT overview:
 *   - Server returns 402 with a Lightning invoice + macaroon
 *   - Client pays the Lightning invoice (instant, low fees)
 *   - Client retries with the LSAT proof (macaroon + preimage)
 *   - Server verifies the preimage proves the invoice was paid
 *
 * Expected flow:
 *   1. Client requests a resource → server returns 402 with WWW-Authenticate: LSAT
 *   2. The 402 response includes a Lightning invoice and a macaroon
 *   3. Client pays the invoice via any Lightning wallet
 *   4. Client retries with Authorization: LSAT <macaroon>:<preimage>
 *   5. Server verifies preimage matches the invoice payment hash
 *
 * Advantages for AI agents:
 *   - Sub-second settlement (no block confirmations)
 *   - Micropayments down to 1 satoshi (~$0.0000005)
 *   - No account needed — pure pay-per-call
 *   - Works globally without banking/KYC requirements
 *
 * To implement:
 *   - Set LSAT_LND_HOST, LSAT_LND_MACAROON, LSAT_LND_TLS_CERT env vars
 *   - Or use an LSAT facilitator service (e.g. Aperture, L402)
 *   - Implement parseProof() to extract macaroon + preimage from Authorization header
 *   - Implement verify() to check preimage against invoice payment hash
 *   - Implement generateChallenge() to create Lightning invoice + macaroon
 */

import type { KeylessPaymentVerifier, PaymentProof, PaymentChallenge } from './gateway.js';

export class LsatVerifier implements KeylessPaymentVerifier {
  readonly protocol = 'lsat';
  readonly name = 'LSAT (Lightning Network)';

  isEnabled(): boolean {
    // Enable when LSAT_ENABLED=true + Lightning node or facilitator is configured
    // return !!process.env.LSAT_ENABLED && (!!process.env.LSAT_LND_HOST || !!process.env.LSAT_FACILITATOR_URL);
    return false;
  }

  parseProof(headers: Record<string, string>): PaymentProof | null {
    // LSAT proof is in the Authorization header: "LSAT <macaroon>:<preimage>"
    // Also check for the newer "L402" prefix (LSAT was renamed to L402)
    const authHeader = headers['authorization'] ?? headers['Authorization'];

    if (!authHeader) return null;
    if (!authHeader.startsWith('LSAT ') && !authHeader.startsWith('L402 ')) return null;

    // Not implemented — return null so the gateway skips to the next verifier
    // When implemented:
    //   const [macaroon, preimage] = authHeader.slice(5).split(':');
    //   return { protocol: 'lsat', payer: macaroon, amount: ..., ... };
    return null;
  }

  async verify(_proof: PaymentProof, _requiredAmountUsd: number): Promise<{ valid: boolean; error?: string }> {
    // When implemented:
    //   1. Decode the macaroon to extract the payment hash
    //   2. Verify the preimage: SHA256(preimage) === paymentHash
    //   3. Check the invoice amount >= requiredAmountUsd (converted from sats at current BTC/USD rate)
    //   4. Verify macaroon caveats (expiry, resource path, etc.)
    return { valid: false, error: 'LSAT/L402 verification not yet implemented' };
  }

  generateChallenge(amountUsd: number, _metadata?: Record<string, unknown>): PaymentChallenge {
    // When implemented, this would:
    //   1. Create a Lightning invoice for the USD amount (converted to sats)
    //   2. Mint a macaroon with caveats (expiry, resource path, etc.)
    //   3. Return both in the WWW-Authenticate header format
    return {
      protocol: 'lsat',
      amount: amountUsd,
      currency: 'BTC',
      recipient: process.env.LSAT_LND_HOST ?? '',
      network: 'lightning',
      details: {
        status: 'not_implemented',
        hint: 'LSAT/L402 support is planned. Use x402 (Base USDC) for keyless payments.',
        authHeaderFormat: 'Authorization: LSAT <macaroon>:<preimage>',
        invoicePrefix: 'lnbc',
      },
    };
  }
}
