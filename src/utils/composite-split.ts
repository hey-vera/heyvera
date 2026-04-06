import { getDb } from '../db/index';
import { round6 } from '../core/credits';
import { logger } from './logger';

export interface SplitRecipient {
  skillId: string;
  creatorKey: string;
  creditCost: number;
  share: number; // calculated share in credits
}

/**
 * Calculate revenue split for a composite skill execution.
 * Each sub-skill creator gets proportional share based on their credit_cost.
 * Platform keeps 10% of total (treasury split).
 */
export function calculateCompositeSplit(params: {
  compositeSkillId: string;
  totalCreditsCharged: number;
  subSkillIds: string[];
}): { recipients: SplitRecipient[]; treasuryShare: number; assemblyFee: number } {
  const { totalCreditsCharged, subSkillIds } = params;

  if (subSkillIds.length === 0) {
    return { recipients: [], treasuryShare: round6(totalCreditsCharged * 0.10), assemblyFee: round6(totalCreditsCharged * 0.90) };
  }

  // Look up each sub-skill's credit_cost and author
  const recipients: SplitRecipient[] = [];
  let totalSubCost = 0;

  for (const skillId of subSkillIds) {
    const skill = getDb().prepare('SELECT id, credit_cost, author_key FROM skills WHERE id = ?').get(skillId) as { id: string; credit_cost: number; author_key: string } | undefined;
    if (skill) {
      recipients.push({
        skillId: skill.id,
        creatorKey: skill.author_key,
        creditCost: skill.credit_cost,
        share: 0, // calculated below
      });
      totalSubCost += skill.credit_cost;
    }
  }

  // 10% to treasury
  const treasuryShare = round6(totalCreditsCharged * 0.10);
  const creatorPool = round6(totalCreditsCharged * 0.90);

  if (totalSubCost === 0 || recipients.length === 0) {
    return { recipients: [], treasuryShare, assemblyFee: creatorPool };
  }

  // Proportional split based on credit_cost
  let distributed = 0;
  for (let i = 0; i < recipients.length; i++) {
    if (i === recipients.length - 1) {
      // Last recipient gets remainder to avoid rounding errors
      recipients[i].share = round6(creatorPool - distributed);
    } else {
      recipients[i].share = round6(creatorPool * (recipients[i].creditCost / totalSubCost));
      distributed += recipients[i].share;
    }
  }

  return { recipients, treasuryShare, assemblyFee: 0 };
}

/**
 * Execute the composite revenue split — credit each sub-skill creator.
 * Fire-and-forget: logs errors but never throws.
 */
export function executeCompositeSplit(params: {
  compositeSkillId: string;
  totalCreditsCharged: number;
  subSkillIds: string[];
  payerKey: string;
}): void {
  try {
    const { recipients, treasuryShare } = calculateCompositeSplit(params);

    if (recipients.length === 0) return;

    getDb().transaction(() => {
      for (const recipient of recipients) {
        if (recipient.share <= 0) continue;

        // Credit the sub-skill creator
        getDb().prepare('UPDATE api_keys SET credits = credits + ? WHERE key = ?')
          .run(recipient.share, recipient.creatorKey);

        // Record the split transaction
        getDb().prepare(`
          INSERT INTO transactions (id, from_agent, to_agent, amount, type, note, created_at)
          VALUES (?, ?, ?, ?, 'composite_split', ?, datetime('now'))
        `).run(
          `csplit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          params.payerKey,
          recipient.creatorKey,
          recipient.share,
          `Composite split: ${params.compositeSkillId} → ${recipient.skillId}`
        );
      }

      // Credit treasury
      if (treasuryShare > 0) {
        getDb().prepare('UPDATE api_keys SET credits = credits + ? WHERE key = ?')
          .run(treasuryShare, 'clawhub-treasury');
      }
    })();

    logger.info({
      compositeSkillId: params.compositeSkillId,
      recipients: recipients.length,
      totalSplit: params.totalCreditsCharged,
      treasuryShare,
    }, 'Composite revenue split executed');
  } catch (err) {
    logger.error({ err, compositeSkillId: params.compositeSkillId }, 'Composite split failed — non-critical');
  }
}

/**
 * Get split history for a composite skill.
 */
export function getCompositeSplitHistory(compositeSkillId: string, limit = 20): Array<{ to_agent: string; amount: number; created_at: string }> {
  return getDb().prepare(`
    SELECT to_agent, amount, created_at FROM transactions
    WHERE type = 'composite_split' AND note LIKE ?
    ORDER BY created_at DESC LIMIT ?
  `).all(`Composite split: ${compositeSkillId}%`, limit) as Array<{ to_agent: string; amount: number; created_at: string }>;
}
