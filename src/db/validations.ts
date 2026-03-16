import { nanoid } from 'nanoid';
import { getDb, logAudit } from './connection';
import { maskApiKey } from '../utils/mask';
import { logger } from '../utils/logger';
import { round6 } from '../core/credits';

// ─── Validator Roles — Validation Submissions ────────────────────────────────

const DAILY_VALIDATION_LIMIT = 100;
const VALIDATION_REWARD = round6(0.5);

export function submitValidation(params: {
  validatorKey: string;
  transactionId: string;
  skillId?: string;
  verdict: 'VALID' | 'INVALID' | 'INCONCLUSIVE';
  notes?: string;
}): { id: string; verdict: string; rewardCredits: number } {
  const { validatorKey, transactionId, skillId, verdict, notes } = params;
  const db = getDb();

  // Must be a validator
  const key = db.prepare('SELECT is_validator FROM api_keys WHERE key = ? AND active = 1').get(validatorKey) as
    | { is_validator: number }
    | undefined;
  if (!key || !key.is_validator) {
    throw new Error('Key is not an active validator');
  }

  // Prevent self-validation — validator cannot validate their own transactions
  const tx = db.prepare('SELECT from_agent, to_agent FROM transactions WHERE id = ?').get(transactionId) as
    | { from_agent: string; to_agent: string }
    | undefined;
  if (tx && (tx.from_agent === validatorKey || tx.to_agent === validatorKey)) {
    throw new Error('Cannot validate your own transaction');
  }

  // Daily limit
  const { count } = db
    .prepare(
      `SELECT COUNT(*) as count FROM validations
       WHERE validator_key = ? AND created_at >= datetime('now', '-1 day')`
    )
    .get(validatorKey) as { count: number };
  if (count >= DAILY_VALIDATION_LIMIT) {
    throw new Error('Daily validation limit reached');
  }

  const id = nanoid(16);

  db.transaction(() => {
    db.prepare(
      `INSERT INTO validations (id, validator_key, transaction_id, skill_id, verdict, notes, reward_credits)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, validatorKey, transactionId, skillId ?? null, verdict, notes ?? null, VALIDATION_REWARD);

    db.prepare('UPDATE api_keys SET credits = credits + ? WHERE key = ?').run(VALIDATION_REWARD, validatorKey);

    // Deduct reward from treasury so rewards aren't inflationary (minted from thin air)
    db.prepare('UPDATE api_keys SET credits = credits - ? WHERE key = ?').run(VALIDATION_REWARD, 'clawhub-treasury');
  })();

  logAudit({
    entityType: 'validation',
    entityId: id,
    action: 'VALIDATION_SUBMITTED',
    actorId: validatorKey,
    data: { transactionId, verdict, rewardCredits: VALIDATION_REWARD },
  });
  logger.info({ id, validatorKey: maskApiKey(validatorKey), verdict }, 'Validation submitted');

  return { id, verdict, rewardCredits: VALIDATION_REWARD };
}

export function getValidationsForTransaction(
  txId: string
): Array<{ id: string; validatorKey: string; verdict: string; notes: string | null; createdAt: string }> {
  const rows = getDb()
    .prepare(
      `SELECT id, validator_key, verdict, notes, created_at
       FROM validations WHERE transaction_id = ?
       ORDER BY created_at DESC`
    )
    .all(txId) as Array<{
    id: string;
    validator_key: string;
    verdict: string;
    notes: string | null;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    validatorKey: maskApiKey(r.validator_key),
    verdict: r.verdict,
    notes: r.notes,
    createdAt: r.created_at,
  }));
}

export function getValidationsForSkill(
  skillId: string
): { valid: number; invalid: number; inconclusive: number; total: number } {
  const rows = getDb()
    .prepare(
      `SELECT verdict, COUNT(*) as count FROM validations
       WHERE skill_id = ? GROUP BY verdict`
    )
    .all(skillId) as Array<{ verdict: string; count: number }>;

  const counts = { valid: 0, invalid: 0, inconclusive: 0, total: 0 };
  for (const row of rows) {
    if (row.verdict === 'VALID') counts.valid = row.count;
    else if (row.verdict === 'INVALID') counts.invalid = row.count;
    else if (row.verdict === 'INCONCLUSIVE') counts.inconclusive = row.count;
    counts.total += row.count;
  }
  return counts;
}

export function getValidatorStats(validatorKey: string): {
  totalValidations: number;
  validCount: number;
  invalidCount: number;
  inconclusiveCount: number;
  totalRewardsEarned: number;
} {
  const rows = getDb()
    .prepare(
      `SELECT verdict, COUNT(*) as count, SUM(reward_credits) as rewards
       FROM validations WHERE validator_key = ? GROUP BY verdict`
    )
    .all(validatorKey) as Array<{ verdict: string; count: number; rewards: number }>;

  const stats = {
    totalValidations: 0,
    validCount: 0,
    invalidCount: 0,
    inconclusiveCount: 0,
    totalRewardsEarned: 0,
  };
  for (const row of rows) {
    if (row.verdict === 'VALID') stats.validCount = row.count;
    else if (row.verdict === 'INVALID') stats.invalidCount = row.count;
    else if (row.verdict === 'INCONCLUSIVE') stats.inconclusiveCount = row.count;
    stats.totalValidations += row.count;
    stats.totalRewardsEarned += row.rewards;
  }
  return stats;
}

export function getValidatorLeaderboard(
  limit: number = 20
): Array<{ validatorKey: string; totalValidations: number; totalRewards: number }> {
  const rows = getDb()
    .prepare(
      `SELECT validator_key, COUNT(*) as total_validations, SUM(reward_credits) as total_rewards
       FROM validations
       GROUP BY validator_key
       ORDER BY total_validations DESC
       LIMIT ?`
    )
    .all(limit) as Array<{ validator_key: string; total_validations: number; total_rewards: number }>;

  return rows.map((r) => ({
    validatorKey: maskApiKey(r.validator_key),
    totalValidations: r.total_validations,
    totalRewards: r.total_rewards,
  }));
}
