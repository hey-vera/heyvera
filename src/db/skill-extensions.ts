import { getDb } from './connection';
import { logger } from '../utils/logger';
import { round6 } from '../core/credits';

// ─── Verification Tiers ──────────────────────────────────────────────────────
// Tiers: 0=unverified, 1=basic (auto), 2=verified (manual), 3=official (admin)

export function getVerificationTier(skillId: string): number {
  const row = getDb().prepare('SELECT verification_tier FROM skills WHERE id = ?').get(skillId) as { verification_tier: number } | undefined;
  return row?.verification_tier ?? 0;
}

export function setVerificationTier(skillId: string, tier: number): boolean {
  // tier must be 0-3
  if (tier < 0 || tier > 3) return false;
  const result = getDb().prepare('UPDATE skills SET verification_tier = ? WHERE id = ?').run(tier, skillId);
  return result.changes > 0;
}

export function autoVerifySkill(skillId: string): boolean {
  // Auto-promote to tier 1 if:
  // - Has > 100 uses
  // - success_rate >= 0.95
  // - avg_rating >= 4.0
  // - rating_count >= 5
  // - health_status = 'HEALTHY'
  // - security_status != 'FLAGGED'
  const skill = getDb().prepare(`
    SELECT uses, success_rate, avg_rating, rating_count, health_status, security_status, verification_tier
    FROM skills WHERE id = ?
  `).get(skillId) as { uses: number; success_rate: number; avg_rating: number; rating_count: number; health_status: string; security_status: string; verification_tier: number } | undefined;

  if (!skill) return false;
  if (skill.verification_tier >= 1) return true; // already verified

  if (skill.uses >= 100 && skill.success_rate >= 0.95 && skill.avg_rating >= 4.0 &&
      skill.rating_count >= 5 && skill.health_status === 'HEALTHY' && skill.security_status !== 'FLAGGED') {
    return setVerificationTier(skillId, 1);
  }
  return false;
}

export function listSkillsByVerificationTier(tier: number, limit = 50, offset = 0): Array<{ id: string; name: string; verification_tier: number }> {
  return getDb().prepare(`
    SELECT id, name, verification_tier FROM skills
    WHERE verification_tier = ? AND public = 1 AND active = 1 AND status = 'published'
    ORDER BY uses DESC LIMIT ? OFFSET ?
  `).all(tier, limit, offset) as Array<{ id: string; name: string; verification_tier: number }>;
}

// ─── Payment-Proof-Backed Reviews ──────────────────────────────────────────────

export interface PaymentProofReview {
  id: number;
  skill_id: string;
  reviewer_key: string;
  rating: number;
  comment: string | null;
  payment_proof_type: 'x402_receipt' | 'credit_transaction' | 'none';
  payment_proof_id: string | null;
  payment_amount: number;
  verified_purchase: number;
  created_at: string;
}

export function rateSkillWithProof(params: {
  skillId: string;
  reviewerKey: string;
  rating: number;
  comment?: string;
  paymentProofType?: 'x402_receipt' | 'credit_transaction';
  paymentProofId?: string;
}): boolean {
  // Validate rating 1-5
  if (params.rating < 1 || params.rating > 5) return false;

  let verifiedPurchase = 0;
  let paymentAmount = 0;

  if (params.paymentProofType === 'x402_receipt' && params.paymentProofId) {
    // Verify x402 receipt exists
    const receipt = getDb().prepare('SELECT price_usdc, success FROM x402_receipts WHERE request_id = ? AND skill_id = ?')
      .get(params.paymentProofId, params.skillId) as { price_usdc: string; success: number } | undefined;
    if (receipt && receipt.success === 1) {
      verifiedPurchase = 1;
      paymentAmount = parseFloat(receipt.price_usdc);
    }
  } else if (params.paymentProofType === 'credit_transaction' && params.paymentProofId) {
    // Verify credit transaction exists
    const tx = getDb().prepare('SELECT amount, type FROM transactions WHERE id = ? AND type = \'skill_purchase\'')
      .get(params.paymentProofId) as { amount: number; type: string } | undefined;
    if (tx) {
      verifiedPurchase = 1;
      paymentAmount = tx.amount;
    }
  }

  // Insert into skill_ratings table (uses existing table, adds new columns)
  getDb().prepare(`
    INSERT INTO skill_ratings (skill_id, buyer_key, rating, comment, payment_proof_type, payment_proof_id, payment_amount, verified_purchase)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(params.skillId, params.reviewerKey, params.rating, params.comment ?? null,
    params.paymentProofType ?? 'none', params.paymentProofId ?? null, paymentAmount, verifiedPurchase);

  // Update denormalized trust signals on skills table
  updateSkillRatingStats(params.skillId);
  return true;
}

export function updateSkillRatingStats(skillId: string): void {
  // Recalculate avg_rating and rating_count from skill_ratings
  const stats = getDb().prepare(`
    SELECT AVG(rating) as avg, COUNT(*) as cnt FROM skill_ratings WHERE skill_id = ?
  `).get(skillId) as { avg: number | null; cnt: number };

  getDb().prepare('UPDATE skills SET avg_rating = ?, rating_count = ? WHERE id = ?')
    .run(round6(stats.avg ?? 0), stats.cnt, skillId);
}

export function getVerifiedReviews(skillId: string, limit = 20): PaymentProofReview[] {
  return getDb().prepare(`
    SELECT * FROM skill_ratings WHERE skill_id = ? AND verified_purchase = 1
    ORDER BY created_at DESC LIMIT ?
  `).all(skillId, limit) as PaymentProofReview[];
}

export function getReviewStats(skillId: string): {
  totalReviews: number;
  verifiedReviews: number;
  avgRating: number;
  avgVerifiedRating: number;
  verifiedPurchaseRate: number;
} {
  const total = getDb().prepare(`
    SELECT COUNT(*) as cnt, AVG(rating) as avg FROM skill_ratings WHERE skill_id = ?
  `).get(skillId) as { cnt: number; avg: number | null };

  const verified = getDb().prepare(`
    SELECT COUNT(*) as cnt, AVG(rating) as avg FROM skill_ratings WHERE skill_id = ? AND verified_purchase = 1
  `).get(skillId) as { cnt: number; avg: number | null };

  return {
    totalReviews: total.cnt,
    verifiedReviews: verified.cnt,
    avgRating: round6(total.avg ?? 0),
    avgVerifiedRating: round6(verified.avg ?? 0),
    verifiedPurchaseRate: total.cnt > 0 ? round6(verified.cnt / total.cnt) : 0,
  };
}

// ─── Composite Skill Metrics ──────────────────────────────────────────────────

export interface CompositeMetrics {
  skill_id: string;
  tool_calls_compressed: number;
  estimated_token_savings: number;
  avg_execution_time_ms: number;
  total_executions: number;
  success_rate: number;
  last_execution_at: string | null;
}

export function getCompositeMetrics(skillId: string): CompositeMetrics | undefined {
  return getDb().prepare('SELECT * FROM composite_metrics WHERE skill_id = ?')
    .get(skillId) as CompositeMetrics | undefined;
}

export function upsertCompositeMetrics(params: {
  skillId: string;
  toolCallsCompressed: number;
  estimatedTokenSavings: number;
  executionTimeMs: number;
  success: boolean;
}): void {
  const existing = getCompositeMetrics(params.skillId);

  if (existing) {
    const newTotal = existing.total_executions + 1;
    const newSuccessRate = round6(
      (existing.success_rate * existing.total_executions + (params.success ? 1 : 0)) / newTotal
    );
    const newAvgTime = round6(
      (existing.avg_execution_time_ms * existing.total_executions + params.executionTimeMs) / newTotal
    );

    getDb().prepare(`
      UPDATE composite_metrics SET
        tool_calls_compressed = ?,
        estimated_token_savings = ?,
        avg_execution_time_ms = ?,
        total_executions = ?,
        success_rate = ?,
        last_execution_at = datetime('now')
      WHERE skill_id = ?
    `).run(params.toolCallsCompressed, params.estimatedTokenSavings, newAvgTime, newTotal, newSuccessRate, params.skillId);
  } else {
    getDb().prepare(`
      INSERT INTO composite_metrics (skill_id, tool_calls_compressed, estimated_token_savings, avg_execution_time_ms, total_executions, success_rate, last_execution_at)
      VALUES (?, ?, ?, ?, 1, ?, datetime('now'))
    `).run(params.skillId, params.toolCallsCompressed, params.estimatedTokenSavings, params.executionTimeMs, params.success ? 1.0 : 0.0);
  }
}

export function estimateTokenSavings(toolCallCount: number): number {
  // Rough estimate: each tool call ≈ 15k tokens (prompt + context + response)
  // A composite skill compresses N calls into 1, saving (N-1) * 15k tokens
  return Math.max(0, (toolCallCount - 1) * 15000);
}

export function getTopComposites(limit = 20): Array<CompositeMetrics & { name: string; description: string }> {
  return getDb().prepare(`
    SELECT cm.*, s.name, s.description
    FROM composite_metrics cm
    JOIN skills s ON s.id = cm.skill_id
    WHERE s.public = 1 AND s.active = 1
    ORDER BY cm.estimated_token_savings DESC
    LIMIT ?
  `).all(limit) as Array<CompositeMetrics & { name: string; description: string }>;
}
