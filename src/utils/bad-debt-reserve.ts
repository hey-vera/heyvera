/**
 * bad-debt-reserve.ts — Bad debt insurance for deferred settlements (Flaw 4)
 *
 * Maintains a protocol-level insurance fund via 0.1% surcharge on all
 * deferred settlement volume. Covers credit defaults when agents with
 * deferred settlement privileges disappear without paying.
 *
 * Fund mechanics:
 *   - 0.1% of every deferred settlement amount → insurance fund
 *   - Claims paid from fund when deferred settlement fails
 *   - Fund balance publicly queryable: GET /aid/insurance/balance
 *   - Max single-incident payout: 10% of fund balance
 *   - Max monthly payout: 25% of fund balance
 *
 * Parametric triggers (auto-payout, no claims process):
 *   AGENT_FROZEN + DEFERRED_UNSETTLED → 60% auto-reimburse
 *   IMMUNE_LEVEL_3 + SETTLEMENT_FAILURE → 50% auto-reimburse
 */

import { getDb, logAudit } from '../db/connection';
import { round6 } from '../core/credits';
import { logger } from '../utils/logger';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Surcharge rate on deferred settlements (0.1%) */
const SURCHARGE_RATE = 0.001;

/** Max payout per incident as fraction of fund balance */
const MAX_INCIDENT_PAYOUT_PCT = 0.10;

/** Max monthly payout as fraction of fund balance */
const MAX_MONTHLY_PAYOUT_PCT = 0.25;

// ─── Fund Operations ────────────────────────────────────────────────────────

/**
 * Apply the bad debt surcharge to a deferred settlement.
 * Called when a deferred/batched settlement is recorded.
 *
 * @param settlementCredits - The total credit amount being deferred
 * @returns The surcharge amount collected (in credits)
 */
export function collectSurcharge(settlementCredits: number): number {
  const surcharge = round6(settlementCredits * SURCHARGE_RATE);
  if (surcharge <= 0) return 0;

  try {
    getDb().prepare(`
      UPDATE aid_insurance_fund
      SET balance = balance + ?, total_collected = total_collected + ?,
          last_collection_at = datetime('now')
      WHERE id = 'primary'
    `).run(surcharge, surcharge);

    // Create the row if it doesn't exist
    getDb().prepare(`
      INSERT OR IGNORE INTO aid_insurance_fund (id, balance, total_collected, total_paid)
      VALUES ('primary', ?, ?, 0)
    `).run(surcharge, surcharge);

    return surcharge;
  } catch (err) {
    logger.warn({ err, surcharge }, 'Failed to collect bad debt surcharge');
    return 0;
  }
}

/**
 * Get the current insurance fund balance and stats.
 */
export function getFundBalance(): {
  balance: number;
  totalCollected: number;
  totalPaid: number;
  maxIncidentPayout: number;
  monthlyPayoutRemaining: number;
} {
  try {
    const row = getDb().prepare(
      `SELECT balance, total_collected, total_paid FROM aid_insurance_fund WHERE id = 'primary'`
    ).get() as { balance: number; total_collected: number; total_paid: number } | undefined;

    if (!row) {
      return { balance: 0, totalCollected: 0, totalPaid: 0, maxIncidentPayout: 0, monthlyPayoutRemaining: 0 };
    }

    // Calculate monthly payout remaining
    const monthlyPaid = getDb().prepare(`
      SELECT COALESCE(SUM(payout_amount), 0) as paid
      FROM aid_insurance_claims
      WHERE status = 'paid' AND resolved_at > datetime('now', '-30 days')
    `).get() as { paid: number } | undefined;

    const monthlyLimit = round6(row.balance * MAX_MONTHLY_PAYOUT_PCT);
    const monthlyRemaining = Math.max(0, round6(monthlyLimit - (monthlyPaid?.paid ?? 0)));

    return {
      balance: round6(row.balance),
      totalCollected: round6(row.total_collected),
      totalPaid: round6(row.total_paid),
      maxIncidentPayout: round6(row.balance * MAX_INCIDENT_PAYOUT_PCT),
      monthlyPayoutRemaining: monthlyRemaining,
    };
  } catch {
    return { balance: 0, totalCollected: 0, totalPaid: 0, maxIncidentPayout: 0, monthlyPayoutRemaining: 0 };
  }
}

/**
 * Process an insurance claim (auto-payout for parametric triggers).
 *
 * @param claimantKey - The API key hash of the affected counterparty
 * @param targetDid - The DID of the agent that defaulted
 * @param lossAmount - The total unsettled amount (in credits)
 * @param triggerType - What triggered the claim
 * @param payoutRate - Fraction of loss to reimburse (0.5 = 50%, 0.6 = 60%)
 * @returns The actual payout amount, or 0 if claim denied
 */
export function processInsuranceClaim(
  claimantKey: string,
  targetDid: string,
  lossAmount: number,
  triggerType: 'agent_frozen' | 'settlement_failure' | 'immune_level_3',
  payoutRate: number = 0.6,
): number {
  const fund = getFundBalance();

  // Calculate requested payout
  let requestedPayout = round6(lossAmount * payoutRate);

  // Cap at max incident payout
  if (requestedPayout > fund.maxIncidentPayout) {
    requestedPayout = fund.maxIncidentPayout;
  }

  // Cap at monthly remaining
  if (requestedPayout > fund.monthlyPayoutRemaining) {
    requestedPayout = fund.monthlyPayoutRemaining;
  }

  // Can't pay more than the fund has
  if (requestedPayout > fund.balance) {
    requestedPayout = fund.balance;
  }

  if (requestedPayout <= 0) {
    logger.warn({ targetDid, lossAmount, triggerType }, 'Insurance claim denied: insufficient fund balance');
    return 0;
  }

  try {
    getDb().transaction(() => {
      // Deduct from fund
      getDb().prepare(`
        UPDATE aid_insurance_fund
        SET balance = balance - ?, total_paid = total_paid + ?
        WHERE id = 'primary'
      `).run(requestedPayout, requestedPayout);

      // Credit the claimant
      getDb().prepare(`
        UPDATE api_keys SET credits = credits + ? WHERE api_key_hash = ?
      `).run(requestedPayout, claimantKey);

      // Record the claim
      const claimId = `claim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      getDb().prepare(`
        INSERT INTO aid_insurance_claims (id, claimant_did, target_did, trigger_type,
                                         total_loss, payout_amount, payout_rate, status, resolved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', datetime('now'))
      `).run(claimId, claimantKey, targetDid, triggerType, lossAmount, requestedPayout, payoutRate);
    })();

    logAudit({
      entityType: 'insurance',
      entityId: targetDid,
      action: 'claim_paid',
      actorId: claimantKey,
      data: { lossAmount, payout: requestedPayout, triggerType, payoutRate },
    });

    logger.info({ targetDid, payout: requestedPayout, triggerType }, 'Insurance claim paid');
    return requestedPayout;
  } catch (err) {
    logger.error({ err, targetDid }, 'Insurance claim processing failed');
    return 0;
  }
}
