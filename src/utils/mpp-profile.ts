/**
 * mpp-profile.ts — AID-MPP Profile (Section 15.5)
 *
 * Maps AID trust headers alongside Stripe MPP session authorization.
 * Trust-gated session limits: higher trust = higher spending cap.
 *
 * MPP (Machine Payments Protocol) is session-based:
 *   1. Agent authorizes a spending limit upfront
 *   2. Server streams micropayments against the session
 *   3. Session closes when limit is reached or agent disconnects
 *
 * AID enhancement:
 *   - Trust score determines max session spending limit
 *   - Higher trust = higher cap = more services per session
 *   - Trust-verified sessions get priority processing
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MppSessionConfig {
  /** Maximum session spending limit in USD */
  maxSpendUsd: number;
  /** Session duration in seconds */
  maxDurationSeconds: number;
  /** Whether deferred settlement is allowed */
  deferredSettlement: boolean;
  /** Priority level (0-3, higher = faster processing) */
  priority: number;
}

export interface AidMppHeaders {
  /** Standard MPP headers */
  'X-MPP-Session-Id': string;
  'X-MPP-Spend-Limit': string;
  'X-MPP-Currency': string;
  /** AID trust headers */
  'X-AID-DID': string;
  'X-AID-TRUST-SCORE': string;
  'X-AID-TRUST-VERIFIED': string;
  /** AID-MPP profile headers */
  'X-AID-MPP-MAX-SESSION': string;
  'X-AID-MPP-PRIORITY': string;
}

// ─── Session Limits by Trust Tier ───────────────────────────────────────────

const SESSION_LIMITS: Record<string, MppSessionConfig> = {
  proceed: {
    maxSpendUsd: 100,
    maxDurationSeconds: 86400,  // 24 hours
    deferredSettlement: true,
    priority: 3,
  },
  trusted: {
    maxSpendUsd: 50,
    maxDurationSeconds: 43200,  // 12 hours
    deferredSettlement: true,
    priority: 2,
  },
  standard: {
    maxSpendUsd: 20,
    maxDurationSeconds: 14400,  // 4 hours
    deferredSettlement: false,
    priority: 1,
  },
  caution: {
    maxSpendUsd: 5,
    maxDurationSeconds: 3600,   // 1 hour
    deferredSettlement: false,
    priority: 0,
  },
  building: {
    maxSpendUsd: 2,
    maxDurationSeconds: 1800,   // 30 minutes
    deferredSettlement: false,
    priority: 0,
  },
  new: {
    maxSpendUsd: 1,
    maxDurationSeconds: 600,    // 10 minutes
    deferredSettlement: false,
    priority: 0,
  },
};

// ─── Functions ──────────────────────────────────────────────────────────────

/**
 * Get MPP session configuration based on agent trust score.
 */
export function getMppSessionConfig(trustScore: number, verdict: string): MppSessionConfig {
  return SESSION_LIMITS[verdict] || SESSION_LIMITS.new;
}

/**
 * Build AID-MPP headers for a session request.
 */
export function buildAidMppHeaders(
  sessionId: string,
  did: string,
  trustScore: number,
  verdict: string,
): AidMppHeaders {
  const config = getMppSessionConfig(trustScore, verdict);

  return {
    'X-MPP-Session-Id': sessionId,
    'X-MPP-Spend-Limit': config.maxSpendUsd.toFixed(6),
    'X-MPP-Currency': 'USDC',
    'X-AID-DID': did,
    'X-AID-TRUST-SCORE': String(trustScore),
    'X-AID-TRUST-VERIFIED': 'true',
    'X-AID-MPP-MAX-SESSION': config.maxSpendUsd.toFixed(6),
    'X-AID-MPP-PRIORITY': String(config.priority),
  };
}

/**
 * Validate an incoming MPP session request against AID trust limits.
 */
export function validateMppSession(
  requestedSpendUsd: number,
  trustScore: number,
  verdict: string,
): { allowed: boolean; maxAllowed: number; reason?: string } {
  const config = getMppSessionConfig(trustScore, verdict);

  if (requestedSpendUsd > config.maxSpendUsd) {
    return {
      allowed: false,
      maxAllowed: config.maxSpendUsd,
      reason: `Trust score ${trustScore} (${verdict}) allows max session of $${config.maxSpendUsd}. Requested: $${requestedSpendUsd}`,
    };
  }

  return { allowed: true, maxAllowed: config.maxSpendUsd };
}

/**
 * Get the AID-MPP compatibility manifest (for /.well-known/aid-mpp).
 */
export function getAidMppManifest(): Record<string, unknown> {
  return {
    protocol: 'AID-MPP',
    version: '1.0.0',
    description: 'AID trust headers alongside Stripe MPP session authorization',
    trustGatedSessions: true,
    sessionLimits: SESSION_LIMITS,
    settlement: {
      currency: 'USDC',
      chains: ['base'],
      deferredMinTrust: 80,
    },
    spec: 'https://github.com/aidprotocol/aid-spec/blob/main/spec/profiles/aid-mpp-profile.md',
  };
}
