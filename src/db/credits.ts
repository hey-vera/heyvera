import { createHash } from 'crypto';
import { logger } from '../utils/logger';
import { getDb, logAudit } from './connection';

// ─── Credit Operations ────────────────────────────────────────────────────────

export function deductCredit(key: string, amount: number = 1): boolean {
  if (amount < 0) throw new Error(`deductCredit: amount must be non-negative, got ${amount}`);
  if (amount === 0) return true; // no-op (e.g. all steps cached)
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
    // Fire-and-forget Soma receipt (async, never blocks deduction)
    issueBillingReceipt(key, amount, 'credit_deduct').catch(() => {});
  }
  return result.changes > 0;
}

export function topUpCredits(key: string, credits: number, stripeSessionId?: string, amountPaid?: number): { ok: boolean } {
  if (credits < 0) throw new Error(`topUpCredits: credits must be non-negative, got ${credits}`);
  if (credits === 0) return { ok: true }; // no-op
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

// ─── Soma Billing Receipts ──────────────────────────────────────────────────

/**
 * Issue a cryptographically signed billing receipt via Soma Heart.
 * Each receipt contains: key (masked), amount, action, timestamp, data hash, signature.
 * The client can verify the signature offline using claw-net.org's public DID.
 */
async function issueBillingReceipt(key: string, amount: number, action: string, metadata?: Record<string, any>): Promise<void> {
  try {
    // Ensure billing_receipts table exists
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS billing_receipts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_key_masked TEXT NOT NULL,
        amount REAL NOT NULL,
        action TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        data_hash TEXT NOT NULL,
        signature TEXT,
        signer_did TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_billing_receipts_key ON billing_receipts(api_key_masked);
    `);

    const masked = key.slice(0, 6) + '...' + key.slice(-4);
    const timestamp = new Date().toISOString();
    const payload = JSON.stringify({ key: masked, amount, action, timestamp, metadata: metadata || {} });
    const dataHash = createHash('sha256').update(payload).digest('hex');

    // Try to sign with Soma Heart
    let signature: string | null = null;
    let signerDid: string | null = null;
    try {
      const { getHeartSafe } = await import('../core/soma');
      const heart = getHeartSafe();
      if (heart) {
        const cert = await heart.certifyData(payload);
        if (cert) {
          signature = cert.signature || cert.proof || null;
          signerDid = cert.did || cert.signer || null;
        }
      }
    } catch { /* Soma not available — store unsigned receipt */ }

    getDb().prepare(
      `INSERT INTO billing_receipts (api_key_masked, amount, action, metadata, data_hash, signature, signer_did, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(masked, amount, action, JSON.stringify(metadata || {}), dataHash, signature, signerDid, timestamp);
  } catch (err) {
    // Never crash the deduction path
    logger.debug({ err }, 'Billing receipt failed');
  }
}

/**
 * Get billing receipts for an API key.
 * Each receipt is independently verifiable via the data_hash + signature.
 */
export function getBillingReceipts(key: string, limit: number = 100): Array<{
  id: number;
  amount: number;
  action: string;
  metadata: Record<string, any>;
  dataHash: string;
  signature: string | null;
  signerDid: string | null;
  createdAt: string;
}> {
  try {
    const masked = key.slice(0, 6) + '...' + key.slice(-4);
    const rows = getDb().prepare(
      `SELECT id, amount, action, metadata, data_hash, signature, signer_did, created_at
       FROM billing_receipts WHERE api_key_masked = ? ORDER BY created_at DESC LIMIT ?`
    ).all(masked, limit) as any[];
    return rows.map(r => ({
      id: r.id,
      amount: r.amount,
      action: r.action,
      metadata: JSON.parse(r.metadata || '{}'),
      dataHash: r.data_hash,
      signature: r.signature,
      signerDid: r.signer_did,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

