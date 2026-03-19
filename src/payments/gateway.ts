/**
 * Payment Gateway — universal keyless payment abstraction.
 *
 * Any payment protocol (x402, MPP, Lightning/LSAT) implements the
 * KeylessPaymentVerifier interface. The gateway tries each registered
 * verifier until one succeeds.
 *
 * Current: x402 (Base USDC)
 * Future-ready: MPP (Tempo), LSAT (Lightning), any HTTP 402 protocol
 *
 * Usage:
 *   import { initPaymentGateway, verifyPayment, generate402Response } from './payments/index';
 *   initPaymentGateway();  // call once at startup
 *
 *   // In a route handler:
 *   const result = await verifyPayment(headers, 0.005);
 *   if (!result.verified) {
 *     const { challenges, headers } = generate402Response(0.005);
 *     return c.json({ error: 'Payment required', challenges }, { status: 402, headers });
 *   }
 */

import { logger } from '../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PaymentProof {
  /** Protocol that produced this proof */
  protocol: string;           // 'x402' | 'mpp' | 'lsat'
  /** Payer identity — wallet address, Lightning node ID, etc. */
  payer: string;
  /** USD value paid */
  amount: number;
  /** Currency used for payment */
  currency: string;           // 'USDC' | 'BTC' | 'USD'
  /** Chain or network the payment was made on */
  chain?: string;             // 'base' | 'tempo' | 'lightning'
  /** On-chain transaction hash if applicable */
  txHash?: string;
  /** Session identifier for session-based protocols (MPP) */
  sessionId?: string;
  /** Protocol-specific proof data (opaque to the gateway) */
  proof: unknown;
  /** ISO timestamp when the proof was verified */
  verified_at: string;
}

export interface PaymentChallenge {
  /** Protocol this challenge is for */
  protocol: string;
  /** Amount required in USD */
  amount: number;
  /** Currency to pay in */
  currency: string;
  /** Recipient address/identifier */
  recipient: string;
  /** Network/chain for payment */
  network: string;
  /** Protocol-specific details (invoice for LSAT, facilitator URL for x402, etc.) */
  details: Record<string, unknown>;
}

export interface KeylessPaymentVerifier {
  /** Protocol identifier (e.g. 'x402', 'mpp', 'lsat') */
  readonly protocol: string;

  /** Human-readable name for logging and discovery responses */
  readonly name: string;

  /** Is this verifier configured and ready? (checks env vars) */
  isEnabled(): boolean;

  /** Check if an incoming request has payment proof for this protocol.
   *  Returns null if the headers don't contain proof for this protocol. */
  parseProof(headers: Record<string, string>): PaymentProof | null;

  /** Verify the payment proof is valid and sufficient for the required amount. */
  verify(proof: PaymentProof, requiredAmountUsd: number): Promise<{ valid: boolean; error?: string }>;

  /** Generate a 402 payment challenge telling the client how to pay. */
  generateChallenge(amountUsd: number, metadata?: Record<string, unknown>): PaymentChallenge;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const verifiers: KeylessPaymentVerifier[] = [];

/**
 * Register a payment verifier. Only verifiers that pass isEnabled() at
 * registration time are logged as active, but disabled verifiers are still
 * stored so they can be re-checked if env changes at runtime.
 */
export function registerPaymentVerifier(verifier: KeylessPaymentVerifier): void {
  // Prevent duplicate registrations
  if (verifiers.some(v => v.protocol === verifier.protocol)) {
    logger.warn({ protocol: verifier.protocol }, 'Payment verifier already registered — skipping');
    return;
  }

  verifiers.push(verifier);

  if (verifier.isEnabled()) {
    logger.info({ protocol: verifier.protocol, name: verifier.name }, 'Payment verifier registered and enabled');
  } else {
    logger.debug({ protocol: verifier.protocol, name: verifier.name }, 'Payment verifier registered (disabled — missing env vars)');
  }
}

/** Return all currently enabled verifiers. */
export function getEnabledVerifiers(): KeylessPaymentVerifier[] {
  return verifiers.filter(v => v.isEnabled());
}

/** Return all registered verifiers (enabled or not) for discovery endpoints. */
export function getAllVerifiers(): KeylessPaymentVerifier[] {
  return [...verifiers];
}

// ─── Verification ─────────────────────────────────────────────────────────────

/**
 * Try to extract and verify payment from request headers.
 *
 * Iterates through registered verifiers in order. The first verifier whose
 * parseProof() returns non-null gets to verify. If verification fails, we
 * return that specific error (not try the next verifier) since the client
 * clearly intended to use that protocol.
 *
 * If NO verifier recognizes the headers, returns a generic "no proof found" error.
 */
export async function verifyPayment(
  headers: Record<string, string>,
  requiredAmountUsd: number,
): Promise<{ verified: boolean; proof?: PaymentProof; protocol?: string; error?: string }> {
  for (const verifier of verifiers) {
    if (!verifier.isEnabled()) continue;

    const proof = verifier.parseProof(headers);
    if (!proof) continue;  // this verifier doesn't recognize the headers

    const result = await verifier.verify(proof, requiredAmountUsd);
    if (result.valid) {
      return { verified: true, proof, protocol: verifier.protocol };
    }
    // The client tried this protocol but verification failed — return the error
    return { verified: false, protocol: verifier.protocol, error: result.error };
  }

  return { verified: false, error: 'No valid payment proof found in request headers' };
}

// ─── 402 Response Generation ──────────────────────────────────────────────────

/**
 * Generate 402 Payment Required challenges for ALL enabled protocols.
 *
 * Returns both the challenge objects (for the JSON body) and suggested
 * response headers that each protocol needs. Clients can pick whichever
 * protocol they support.
 */
export function generate402Response(amountUsd: number, metadata?: Record<string, unknown>): {
  challenges: PaymentChallenge[];
  headers: Record<string, string>;
} {
  const enabledVerifiers = verifiers.filter(v => v.isEnabled());

  const challenges = enabledVerifiers.map(v => v.generateChallenge(amountUsd, metadata));

  const headers: Record<string, string> = {};

  // List supported protocols in a header for agent discovery
  const protocols = enabledVerifiers.map(v => v.protocol);
  if (protocols.length > 0) {
    headers['X-Payment-Protocols'] = protocols.join(', ');
  }

  // Protocol-specific headers
  for (const challenge of challenges) {
    if (challenge.protocol === 'x402') {
      headers['X-Payment-Protocol'] = 'x402';
    }
    // Future: LSAT sets WWW-Authenticate: LSAT macaroon="...", invoice="..."
    // Future: MPP sets X-MPP-Session header
  }

  return { challenges, headers };
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/** Reset the verifier registry (for testing). */
export function _resetVerifiers(): void {
  verifiers.length = 0;
}
