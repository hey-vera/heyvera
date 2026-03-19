/**
 * Payment Gateway — barrel export + auto-registration.
 *
 * Import { initPaymentGateway } and call it once at startup (in src/index.ts).
 * All registered verifiers are automatically available via verifyPayment()
 * and generate402Response().
 *
 * Adding a new protocol:
 *   1. Create src/payments/my-verifier.ts implementing KeylessPaymentVerifier
 *   2. Import + register it in initPaymentGateway() below
 *   3. That's it — the gateway will try it on every request automatically
 */

// Re-export all types and gateway functions
export type { PaymentProof, PaymentChallenge, KeylessPaymentVerifier } from './gateway.js';
export {
  registerPaymentVerifier,
  getEnabledVerifiers,
  getAllVerifiers,
  verifyPayment,
  generate402Response,
  _resetVerifiers,
} from './gateway.js';

// Re-export verifier classes for direct use / testing
export { X402Verifier } from './x402-verifier.js';
export { MppVerifier } from './mpp-verifier.js';
export { LsatVerifier } from './lsat-verifier.js';

import { registerPaymentVerifier } from './gateway.js';
import { X402Verifier } from './x402-verifier.js';
import { MppVerifier } from './mpp-verifier.js';
import { LsatVerifier } from './lsat-verifier.js';

/**
 * Initialize the payment gateway by registering all known verifiers.
 * Only verifiers with the required env vars will be active.
 * Call once at startup — idempotent (duplicate registrations are ignored).
 */
export function initPaymentGateway(): void {
  registerPaymentVerifier(new X402Verifier());
  registerPaymentVerifier(new MppVerifier());
  registerPaymentVerifier(new LsatVerifier());
}
