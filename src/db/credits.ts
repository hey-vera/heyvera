import { logger } from '../utils/logger';
import { getDb, logAudit } from './connection';

// ─── Credit Operations ────────────────────────────────────────────────────────

export function deductCredit(key: string, amount: number = 1): boolean {
  if (amount <= 0) throw new Error(`deductCredit: amount must be positive, got ${amount}`);
  const result = getDb()
    .prepare(
      `UPDATE api_keys
       SET credits = credits - @amount,
           credits_used = credits_used + @amount,
           last_used_at = datetime('now')
       WHERE key = @key AND credits >= @amount AND active = 1`
    )
    .run({ key, amount });
  if (result.changes > 0) {
    logAudit({ entityType: 'api_key', entityId: key, action: 'CREDIT_DEDUCT', data: { amount } });
  }
  return result.changes > 0;
}

export function topUpCredits(key: string, credits: number, stripeSessionId?: string, amountPaid?: number): { ok: boolean } {
  if (credits <= 0) throw new Error(`topUpCredits: credits must be positive, got ${credits}`);
  let result;
  if (stripeSessionId) {
    const dollarValue = amountPaid != null ? amountPaid : credits / 1000;
    result = getDb()
      .prepare(
        `UPDATE api_keys
         SET credits = credits + ?,
             stripe_session_id = ?,
             amount_paid = amount_paid + ?
         WHERE key = ? AND active = 1`
      )
      .run(credits, stripeSessionId, dollarValue, key);
  } else {
    result = getDb()
      .prepare('UPDATE api_keys SET credits = credits + ? WHERE key = ? AND active = 1')
      .run(credits, key);
  }
  if (result.changes > 0) {
    logAudit({ entityType: 'api_key', entityId: key, action: 'CREDIT_TOPUP', data: { credits, stripeSessionId, amountPaid } });
  }
  return { ok: result.changes > 0 };
}

// ─── Stripe Session Dedup ─────────────────────────────────────────────────────

export function isStripeSessionClaimed(sessionId: string): boolean {
  const row = getDb().prepare('SELECT 1 FROM stripe_processed_sessions WHERE session_id = ?').get(sessionId);
  return row != null;
}

export function claimStripeSession(sessionId: string): boolean {
  const result = getDb()
    .prepare('INSERT OR IGNORE INTO stripe_processed_sessions (session_id) VALUES (?)')
    .run(sessionId);
  return result.changes > 0;
}

// ─── Solana Signature Dedup ───────────────────────────────────────────────────

export function tryClaimSolanaSignature(signature: string): boolean {
  const result = getDb()
    .prepare('INSERT OR IGNORE INTO solana_processed_sigs (signature) VALUES (?)')
    .run(signature);
  return result.changes > 0;
}

export function releaseClaimSolanaSignature(signature: string): void {
  getDb().prepare('DELETE FROM solana_processed_sigs WHERE signature = ?').run(signature);
}

/** @deprecated Use tryClaimSolanaSignature instead */
export function isSignatureProcessed(signature: string): boolean {
  const row = getDb().prepare('SELECT 1 FROM solana_processed_sigs WHERE signature = ?').get(signature);
  return row != null;
}

/** @deprecated Use tryClaimSolanaSignature instead */
export function markSignatureProcessed(signature: string): void {
  try {
    getDb()
      .prepare('INSERT OR IGNORE INTO solana_processed_sigs (signature) VALUES (?)')
      .run(signature);
  } catch (err) {
    logger.error({ err }, 'Failed to mark signature processed');
  }
}

// ─── Stripe Event Dedup ───────────────────────────────────────────────────────

export function isStripeEventProcessed(eventId: string): boolean {
  const row = getDb().prepare('SELECT 1 FROM stripe_processed_events WHERE event_id = ?').get(eventId);
  return row != null;
}

export function markStripeEventProcessed(eventId: string): void {
  try {
    getDb()
      .prepare('INSERT OR IGNORE INTO stripe_processed_events (event_id) VALUES (?)')
      .run(eventId);
  } catch (err) {
    logger.error({ err }, 'Failed to mark Stripe event processed');
  }
}

// ─── Stripe Charge Refund Dedup ───────────────────────────────────────────────

export function getStripeChargeRefundedCents(chargeId: string): number {
  const row = getDb()
    .prepare('SELECT amount_refunded_cents FROM stripe_refunded_charges WHERE charge_id = ?')
    .get(chargeId) as { amount_refunded_cents: number } | undefined;
  return row?.amount_refunded_cents ?? 0;
}

export function upsertStripeChargeRefundedCents(chargeId: string, totalCents: number): void {
  getDb()
    .prepare(`INSERT INTO stripe_refunded_charges (charge_id, amount_refunded_cents)
              VALUES (?, ?)
              ON CONFLICT(charge_id) DO UPDATE SET
                amount_refunded_cents = excluded.amount_refunded_cents,
                processed_at = datetime('now')`)
    .run(chargeId, totalCents);
}
