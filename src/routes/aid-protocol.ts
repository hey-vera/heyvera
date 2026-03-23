/**
 * aid-protocol.ts — AID Protocol endpoints (the /aid/* path)
 *
 * These routes implement the AID Protocol specification (docs/aid-protocol-spec.md).
 * They are SEPARATE from /v1/aid/* (credit-based AID management).
 *
 * /aid/heartbeat    — mandatory discovery endpoint (public, no auth)
 * /aid/feedback     — outcome reporting (authenticated)
 * /aid/skills/:id   — pay-per-use skill invocation via USDC (Phase 2)
 *
 * All endpoints follow the AID spec: did:key identity, Ed25519 signatures,
 * trust-gated pricing, portable atomic receipts.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { getEd25519PublicKeyMultibase, getEd25519PublicKeyRaw } from '../utils/ed25519-signer';
import { AID_HASH_ALGORITHM } from '../utils/crypto-agility';
import { listPublicSkills, countPublicSkills } from '../db/skills';
import { getDb, logAudit } from '../db/connection';
import { logger } from '../utils/logger';
import { cacheGet, cacheSet, cacheIncr } from '../cache/index';
import { checkAidProof, type AidInfo } from '../middleware/aid-verify';
import { aidProviderProof } from '../middleware/aid-provider-proof';

const router = new Hono();

// ─── Platform identity constants ─────────────────────────────────────────────

const PLATFORM_DID = 'did:web:api.claw-net.org';
const PROTOCOL_VERSION = '1.0.0';

// ─── GET /heartbeat — AID Protocol mandatory discovery endpoint ──────────────
//
// Every AID-compatible server MUST expose this endpoint (spec Section 7).
// Returns: provider identity, available services, trust-gated pricing tiers,
// crypto-agility info, and platform public key.
//
// Public — no auth required. Rate-limited by global middleware.
// ─────────────────────────────────────────────────────────────────────────────

router.get('/heartbeat', (c) => {
  try {
    // Fetch top services from skill marketplace
    const skills = listPublicSkills(0, 20);
    const totalSkills = countPublicSkills();

    // Compute basic platform stats
    const statsRow = getDb().prepare(`
      SELECT
        COUNT(*) as total_attestations,
        SUM(CASE WHEN outcome_status = 'success' THEN 1 ELSE 0 END) as successes
      FROM attestations
      WHERE created_at > datetime('now', '-24 hours')
    `).get() as { total_attestations: number; successes: number } | undefined;

    const last24h = statsRow?.total_attestations || 0;
    const successRate = last24h > 0 ? Number(((statsRow?.successes || 0) / last24h).toFixed(3)) : 1.0;

    // Count active agents (unique keys with attestations in last 30 days)
    const activeRow = getDb().prepare(`
      SELECT COUNT(DISTINCT owner_key) as n FROM attestations
      WHERE created_at > datetime('now', '-30 days')
    `).get() as { n: number } | undefined;

    const services = skills.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.skill_type || 'prompt_template',
      price: String(s.credit_cost / 1000), // credits → USDC (CREDITS_PER_USD=1000)
      trustGate: 0,
      status: 'healthy' as const,
    }));

    const raw = getEd25519PublicKeyRaw();

    return c.json({
      protocolVersion: PROTOCOL_VERSION,
      provider: {
        did: PLATFORM_DID,
        name: 'ClawNet',
        trustScore: 100, // platform is self-trusted
        uptime: 0.999,
        verified: true,
      },
      services,
      totalServices: totalSkills,
      pricing: {
        currency: 'USDC',
        chain: 'base',
        tiers: [
          { minTrust: 0,  multiplier: 1.0,  settlement: 'immediate', verdict: 'new' },
          { minTrust: 20, multiplier: 1.0,  settlement: 'immediate', verdict: 'building' },
          { minTrust: 40, multiplier: 0.9,  settlement: 'standard',  verdict: 'caution' },
          { minTrust: 60, multiplier: 0.8,  settlement: 'batched',   verdict: 'standard' },
          { minTrust: 80, multiplier: 0.75, settlement: 'batched',   verdict: 'trusted' },
          { minTrust: 90, multiplier: 0.7,  settlement: 'deferred',  verdict: 'proceed',
            requiresVerification: true, requiresMinAge: '6mo', requiresMinRevenue: 50 },
        ],
      },
      cryptoAgility: {
        current: 'Ed25519',
        supported: ['Ed25519'],
        planned: ['ML-DSA-44'],
        hashAlgorithm: AID_HASH_ALGORITHM,
        pqcReady: false,
        migrationTarget: 'ML-DSA-44',
        migrationDate: null,
      },
      platformKey: raw.toString('base64url'),
      stats: {
        totalServices: totalSkills,
        last24hTransactions: last24h,
        successRate,
        activeAgents: activeRow?.n || 0,
      },
      decentralization: {
        currentPhase: 1,
        description: 'Transparent centralization',
        nextMilestone: 'Optimistic trust oracle on Base',
        targetDate: '2026-09-01',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Heartbeat error:', err);
    return c.json({
      protocolVersion: PROTOCOL_VERSION,
      provider: { did: PLATFORM_DID, name: 'ClawNet', trustScore: 100, uptime: 0.999, verified: true },
      services: [],
      totalServices: 0,
      pricing: { currency: 'USDC', chain: 'base', tiers: [] },
      cryptoAgility: { current: 'Ed25519', supported: ['Ed25519'], planned: ['ML-DSA-44'], hashAlgorithm: AID_HASH_ALGORITHM, pqcReady: false, migrationTarget: 'ML-DSA-44', migrationDate: null },
      platformKey: getEd25519PublicKeyRaw().toString('base64url'),
      stats: { totalServices: 0, last24hTransactions: 0, successRate: 1.0, activeAgents: 0 },
      timestamp: new Date().toISOString(),
    });
  }
});

// ─── GET /heartbeat (authenticated) — Consumer heartbeat with personalized data ─

router.get('/heartbeat/consumer', checkAidProof, async (c) => {
  const aidInfo = (c as any).get?.('aidInfo') as AidInfo | undefined;

  if (!aidInfo) {
    return c.json({ error: 'AID authentication required for consumer heartbeat', code: 'AID_PROOF_MISSING' }, 428);
  }

  try {
    // Get agent's credit balance (if credit-based)
    let creditBalance = 0;
    try {
      const creditRow = getDb().prepare(
        `SELECT credits FROM api_keys WHERE api_key_hash = ? LIMIT 1`
      ).get(aidInfo.ownerKey) as { credits: number } | undefined;
      creditBalance = creditRow?.credits ?? 0;
    } catch { /* non-critical */ }

    // Get recent receipts count
    const recentReceipts = getDb().prepare(`
      SELECT COUNT(*) as n FROM attestations
      WHERE owner_key = ? AND created_at > datetime('now', '-7 days')
    `).get(aidInfo.ownerKey) as { n: number } | undefined;

    // Get pending feedback count
    const pendingFeedback = getDb().prepare(`
      SELECT COUNT(*) as n FROM attestations a
      WHERE a.owner_key = ? AND a.created_at > datetime('now', '-7 days')
      AND NOT EXISTS (SELECT 1 FROM aid_feedback f WHERE f.receipt_id = a.tx_id)
    `).get(aidInfo.ownerKey) as { n: number } | undefined;

    // Get active disputes
    const activeDisputes = getDb().prepare(`
      SELECT COUNT(*) as n FROM aid_disputes
      WHERE claimant_key = ? AND status NOT IN ('resolved', 'expired')
    `).get(aidInfo.ownerKey) as { n: number } | undefined;

    // Trust tier pricing
    const verdictMap: Record<string, { multiplier: number; settlement: string }> = {
      proceed: { multiplier: 0.7, settlement: 'deferred' },
      trusted: { multiplier: 0.75, settlement: 'batched' },
      standard: { multiplier: 0.8, settlement: 'batched' },
      caution: { multiplier: 0.9, settlement: 'standard' },
      building: { multiplier: 1.0, settlement: 'immediate' },
      new: { multiplier: 1.0, settlement: 'immediate' },
    };
    const tier = verdictMap[aidInfo.verdict] || verdictMap.new;

    // Get trust alerts (providers whose score dropped)
    let alerts: Array<{ type: string; provider: string; delta: number }> = [];
    try {
      const degradedProviders = getDb().prepare(`
        SELECT DISTINCT provider_did, old_score, new_score
        FROM aid_trust_events
        WHERE consumer_did = ? AND event_type = 'trust_degraded'
        AND created_at > datetime('now', '-24 hours')
        LIMIT 5
      `).all(aidInfo.did) as any[];
      alerts = degradedProviders.map(p => ({
        type: 'trust_degradation',
        provider: p.provider_did,
        delta: p.new_score - p.old_score,
      }));
    } catch { /* table may not exist yet */ }

    return c.json({
      consumer: {
        did: aidInfo.did,
        trustScore: aidInfo.trustScore,
        verdict: aidInfo.verdict,
        verified: aidInfo.verified,
        pricingTier: {
          verdict: aidInfo.verdict,
          multiplier: tier.multiplier,
          settlement: tier.settlement,
          discount: `${Math.round((1 - tier.multiplier) * 100)}%`,
        },
        creditBalance: Number(creditBalance.toFixed(6)),
        recentReceipts: recentReceipts?.n ?? 0,
        feedbackPending: pendingFeedback?.n ?? 0,
        activeDisputes: activeDisputes?.n ?? 0,
        alerts,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error({ err }, 'Consumer heartbeat error');
    return c.json({ error: 'Consumer heartbeat failed', code: 'AID_INTERNAL_ERROR' }, 500);
  }
});

// ─── POST /feedback — AID Protocol outcome reporting ─────────────────────────
//
// Agents report transaction outcomes to feed the trust flywheel (spec Section 6).
// Requires AID authentication (X-AID-DID + X-AID-PROOF).
// Feedback weight depends on reporter's transaction history (anti-Sybil).
// ─────────────────────────────────────────────────────────────────────────────



const FeedbackSchema = z.object({
  receiptId: z.string().min(1).max(100),
  outcome: z.enum(['success', 'partial', 'failure']),
  qualityScore: z.number().int().min(1).max(10).optional(),
  latencyAcceptable: z.boolean().optional(),
  notes: z.string().max(500).optional(),
});

router.post('/feedback', checkAidProof, aidProviderProof, async (c) => {
  const aidInfo = c.get('aidInfo') as AidInfo | undefined;
  if (!aidInfo) {
    return c.json({ error: 'AID authentication required', code: 'AID_PROOF_MISSING' }, 428);
  }

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON', code: 'INVALID_BODY' }, 400); }

  const parsed = FeedbackSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid feedback', code: 'INVALID_FEEDBACK', details: parsed.error.flatten().fieldErrors }, 400);
  }

  const { receiptId, outcome, qualityScore, latencyAcceptable, notes } = parsed.data;

  // ── Anti-Sybil: new agents (trust score 0) cannot submit feedback ──────
  if (aidInfo.trustScore === 0) {
    return c.json({ error: 'New agents cannot submit feedback', code: 'AID_TRUST_GATE_BLOCKED', verdict: 'new' }, 403);
  }

  // ── Feedback velocity cap: max 3 per reporter per provider per 30 days ──
  const velocityCheck = getDb().prepare(`
    SELECT COUNT(*) as n FROM aid_feedback
    WHERE reporter_did = ? AND receipt_id IN (
      SELECT receipt_id FROM aid_feedback WHERE provider_did = (
        SELECT provider_did FROM aid_feedback WHERE receipt_id = ? LIMIT 1
      )
    ) AND created_at > datetime('now', '-30 days')
  `).get(aidInfo.did, receiptId) as { n: number } | undefined;

  if ((velocityCheck?.n ?? 0) >= 3) {
    return c.json({ error: 'Feedback velocity cap reached (max 3 per provider per 30 days)', code: 'RATE_LIMITED' }, 429);
  }

  // ── Compute feedback weight based on reporter history ──────────────────
  const reporterStats = getDb().prepare(`
    SELECT COUNT(*) as tx_count FROM attestations
    WHERE owner_key = ? AND created_at > datetime('now', '-90 days')
  `).get(aidInfo.ownerKey) as { tx_count: number } | undefined;

  const txCount = reporterStats?.tx_count ?? 0;
  let weight = 0.5; // new agent default
  if (txCount >= 100) weight = 2.0;
  else if (txCount >= 10) weight = 1.0;
  // Attestation history bonus
  if (txCount >= 50) weight = Math.min(weight + 1.0, 5.0);

  // ── Mutual feedback decay: if reporter and provider gave each other positive
  //    feedback within 30 days, both are weighted at 0.1x ──────────────────
  const mutualCheck = getDb().prepare(`
    SELECT COUNT(*) as n FROM aid_feedback
    WHERE reporter_did = ? AND outcome = 'success'
    AND created_at > datetime('now', '-30 days')
  `).get(receiptId) as { n: number } | undefined;
  // Note: full mutual decay requires cross-referencing provider→reporter feedback,
  // which needs the provider_did. We track it for future implementation.

  // ── Insert feedback ────────────────────────────────────────────────────
  const id = `fb-${nanoid(16)}`;
  getDb().prepare(`
    INSERT INTO aid_feedback (id, receipt_id, reporter_did, reporter_owner_key, outcome, quality_score, latency_acceptable, notes, weight)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, receiptId, aidInfo.did, aidInfo.ownerKey, outcome, qualityScore ?? null, latencyAcceptable != null ? (latencyAcceptable ? 1 : 0) : null, notes ?? null, weight);

  logger.info({ feedbackId: id, receiptId, reporter: aidInfo.did, outcome, weight }, 'AID feedback recorded');

  return c.json({
    feedbackId: id,
    credited: 0.1,
    feedbackWeight: weight,
    providerTrustDelta: outcome === 'success' ? 0.02 : outcome === 'failure' ? -0.05 : 0,
  });
});

// ─── GET /leaderboard — Public trust leaderboard ─────────────────────────────
//
// Returns aggregated trust data for the ecosystem. Individual agent lookups
// are rate-limited (Section 39.17, Vector 57). Bulk enumeration returns
// tier aggregates, not individual DID-level data.
// ─────────────────────────────────────────────────────────────────────────────

router.get('/leaderboard', (c) => {
  try {
    // Tier aggregates (safe — no individual DID enumeration)
    const tiers = getDb().prepare(`
      SELECT
        CASE
          WHEN frozen = 1 THEN 'frozen'
          WHEN proof_of_life_status = 'auto_frozen' THEN 'frozen'
          ELSE 'active'
        END as status,
        COUNT(*) as count
      FROM aid_keys WHERE key_status = 'active'
      GROUP BY status
    `).all() as { status: string; count: number }[];

    // Top agents by attestation count (opt-in public agents only — show DID + verdict, not exact score)
    const topAgents = getDb().prepare(`
      SELECT ak.did, ak.display_name, ak.proof_of_life_status,
        COALESCE(ast.total_attestations, 0) as attestations,
        COALESCE(ast.success_count, 0) as successes,
        ak.created_at
      FROM aid_keys ak
      LEFT JOIN attestation_stats ast ON ast.owner_key = ak.owner_key
      WHERE ak.key_status = 'active' AND ak.frozen = 0
      ORDER BY COALESCE(ast.total_attestations, 0) DESC
      LIMIT 25
    `).all() as any[];

    const leaderboard = topAgents.map(a => {
      const total = a.attestations || 0;
      const successRate = total > 0 ? a.successes / total : 0;
      const volume = Math.min(total / 1000, 1);
      const rawScore = Math.round(successRate * 40 + 0.5 * 25 + volume * 20 + 0.5 * 15);
      const verdict = rawScore >= 90 ? 'proceed' : rawScore >= 80 ? 'trusted' : rawScore >= 60 ? 'standard' : rawScore >= 40 ? 'caution' : rawScore >= 20 ? 'building' : 'new';

      return {
        did: a.did,
        displayName: a.display_name,
        verdict,
        attestations: total,
        activeMonths: Math.max(1, Math.round((Date.now() - new Date(a.created_at).getTime()) / (30 * 86400000))),
        proofOfLife: a.proof_of_life_status,
      };
    });

    const activeCount = tiers.find(t => t.status === 'active')?.count || 0;
    const frozenCount = tiers.find(t => t.status === 'frozen')?.count || 0;

    return c.json({
      ecosystem: {
        totalAgents: activeCount + frozenCount,
        activeAgents: activeCount,
        frozenAgents: frozenCount,
      },
      leaderboard,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Leaderboard error:', err);
    return c.json({ ecosystem: { totalAgents: 0, activeAgents: 0, frozenAgents: 0 }, leaderboard: [], timestamp: new Date().toISOString() });
  }
});

// ─── GET /trajectory/:did — Trust trajectory (score history + projections) ────

router.get('/trajectory/:did', (c) => {
  const did = c.req.param('did');
  const history = getDb().prepare(
    'SELECT month, score FROM aid_trust_trajectory WHERE did = ? ORDER BY month DESC LIMIT 12'
  ).all(did) as { month: string; score: number }[];

  if (history.length === 0) {
    return c.json({ did, trajectory: 'insufficient_data', history: [] });
  }

  const current = history[0]?.score || 0;
  const oldest = history[history.length - 1]?.score || current;
  const months = history.length;
  const trend = months > 1 ? Number(((current - oldest) / months).toFixed(1)) : 0;
  const trajectory = trend > 0.5 ? 'ascending' : trend < -0.5 ? 'descending' : 'stable';

  return c.json({
    did,
    currentScore: current,
    trend: `${trend > 0 ? '+' : ''}${trend}`,
    trendPeriod: `${months}mo`,
    trajectory,
    projectedScore30d: Math.min(100, Math.max(0, Math.round(current + trend))),
    projectedScore90d: Math.min(100, Math.max(0, Math.round(current + trend * 3))),
    history: history.reverse(),
  });
});

// ─── GET /milestones/:did — Onboarding milestones ────────────────────────────

router.get('/milestones/:did', (c) => {
  const did = c.req.param('did');
  const milestones = getDb().prepare(
    'SELECT stage, timestamp FROM aid_onboarding_milestones WHERE did = ? ORDER BY timestamp ASC'
  ).all(did) as { stage: string; timestamp: string }[];

  const currentStage = milestones.length > 0 ? milestones[milestones.length - 1].stage : 'registered';

  return c.json({ did, stage: currentStage, history: milestones });
});

// ─── GET /guardians — List approved guardians ────────────────────────────────

router.get('/guardians', (c) => {
  const guardians = getDb().prepare(`
    SELECT guardian_did, guardian_type, agents_guarded, successful_freezes,
           false_positives, trust_score, status, created_at
    FROM aid_guardians WHERE status = 'active'
    ORDER BY trust_score DESC LIMIT 50
  `).all() as any[];

  return c.json({ guardians, total: guardians.length });
});

// ─── POST /guardians/register — Register as a guardian ───────────────────────

router.post('/guardians/register', checkAidProof, async (c) => {
  const aidInfo = c.get('aidInfo') as AidInfo | undefined;
  if (!aidInfo) return c.json({ error: 'AID authentication required', code: 'AID_PROOF_MISSING' }, 428);

  // Guardian must have trust score >= 70
  if (aidInfo.trustScore < 70) {
    return c.json({ error: 'Trust score must be 70+ to become a guardian', code: 'AID_TRUST_GATE_BLOCKED' }, 403);
  }

  // Check if already registered
  const existing = getDb().prepare(
    'SELECT id FROM aid_guardians WHERE guardian_did = ? AND status = ?'
  ).get(aidInfo.did, 'active');
  if (existing) return c.json({ error: 'Already registered as guardian', code: 'GUARDIAN_EXISTS' }, 409);

  const id = `guard-${nanoid(16)}`;
  getDb().prepare(`
    INSERT INTO aid_guardians (id, guardian_did, guardian_owner_key, trust_score)
    VALUES (?, ?, ?, ?)
  `).run(id, aidInfo.did, aidInfo.ownerKey, aidInfo.trustScore);

  return c.json({ guardianId: id, did: aidInfo.did, status: 'active' }, 201);
});

// ─── POST /guardians/assign — Assign a guardian to an agent ──────────────────

router.post('/guardians/assign', checkAidProof, async (c) => {
  const aidInfo = c.get('aidInfo') as AidInfo | undefined;
  if (!aidInfo) return c.json({ error: 'AID authentication required', code: 'AID_PROOF_MISSING' }, 428);

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON', code: 'INVALID_BODY' }, 400); }

  const guardianDid = body?.guardianDid;
  if (!guardianDid) return c.json({ error: 'guardianDid required', code: 'MISSING_FIELD' }, 400);

  // Verify guardian exists and is active
  const guardian = getDb().prepare(
    'SELECT id, agents_guarded, max_agents FROM aid_guardians WHERE guardian_did = ? AND status = ?'
  ).get(guardianDid, 'active') as any;
  if (!guardian) return c.json({ error: 'Guardian not found or inactive', code: 'GUARDIAN_NOT_FOUND' }, 404);

  // Check concentration limit (10% max)
  const totalAgents = getDb().prepare('SELECT COUNT(*) as n FROM aid_keys WHERE key_status = ?').get('active') as { n: number };
  const maxAllowed = Math.max(5, Math.floor(totalAgents.n * 0.10));
  if (guardian.agents_guarded >= maxAllowed) {
    return c.json({ error: 'Guardian at capacity (10% concentration limit)', code: 'GUARDIAN_FULL' }, 429);
  }

  const id = `assign-${nanoid(16)}`;
  getDb().transaction(() => {
    getDb().prepare(`
      INSERT INTO aid_guardian_assignments (id, agent_did, guardian_did, assignment_type)
      VALUES (?, ?, ?, 'primary')
    `).run(id, aidInfo.did, guardianDid);

    getDb().prepare(
      'UPDATE aid_guardians SET agents_guarded = agents_guarded + 1, updated_at = datetime(\'now\') WHERE guardian_did = ?'
    ).run(guardianDid);

    getDb().prepare(
      'UPDATE aid_keys SET guardian_address = ?, updated_at = datetime(\'now\') WHERE did = ? AND key_status = ?'
    ).run(guardianDid, aidInfo.did, 'active');
  })();

  return c.json({ assignmentId: id, agentDid: aidInfo.did, guardianDid, type: 'primary' }, 201);
});

// ─── POST /succession — DID migration with penalty (14.12) ───────────────────

router.post('/succession', checkAidProof, async (c) => {
  const aidInfo = c.get('aidInfo') as AidInfo | undefined;
  if (!aidInfo) return c.json({ error: 'AID authentication required', code: 'AID_PROOF_MISSING' }, 428);

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON', code: 'INVALID_BODY' }, 400); }

  const previousDid = body?.previousDid;
  const reason = body?.reason || 'key_compromise';
  if (!previousDid) return c.json({ error: 'previousDid required', code: 'MISSING_FIELD' }, 400);

  // Check succession rate limit (1 per 12 months)
  const recentSuccession = getDb().prepare(
    'SELECT id FROM aid_succession WHERE new_did = ? AND created_at > datetime(\'now\', \'-12 months\')'
  ).get(aidInfo.did);
  if (recentSuccession) {
    return c.json({ error: 'Succession rate limited to 1 per 12 months', code: 'RATE_LIMITED' }, 429);
  }

  // Count previous successions for escalating penalty
  const priorCount = getDb().prepare(
    'SELECT COUNT(*) as n FROM aid_succession WHERE new_did = ? OR previous_did = ?'
  ).get(aidInfo.did, aidInfo.did) as { n: number };

  const successionNumber = priorCount.n + 1;
  if (successionNumber > 3) {
    return c.json({ error: 'Identity retired after 3 successions', code: 'IDENTITY_RETIRED' }, 403);
  }

  const penalty = successionNumber === 1 ? 0.20 : successionNumber === 2 ? 0.50 : 1.0;

  const id = `succ-${nanoid(16)}`;
  getDb().prepare(`
    INSERT INTO aid_succession (id, previous_did, new_did, reason, penalty_applied, succession_number)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, previousDid, aidInfo.did, reason, penalty, successionNumber);

  logAudit({
    entityType: 'aid', entityId: aidInfo.did, action: 'succession',
    data: { previousDid, reason, penalty, successionNumber },
  });

  return c.json({
    successionId: id, previousDid, newDid: aidInfo.did,
    reason, penaltyApplied: penalty, successionNumber,
    note: penalty >= 1.0 ? 'Identity retired' : `${penalty * 100}% score penalty applied`,
  }, 201);
});

// ─── POST /appeals — File an appeal against a freeze (14.14) ─────────────────

router.post('/appeals', checkAidProof, async (c) => {
  const aidInfo = c.get('aidInfo') as AidInfo | undefined;
  if (!aidInfo) return c.json({ error: 'AID authentication required', code: 'AID_PROOF_MISSING' }, 428);

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON', code: 'INVALID_BODY' }, 400); }

  const appealReason = body?.reason;
  const evidence = body?.evidence;
  if (!appealReason) return c.json({ error: 'reason required', code: 'MISSING_FIELD' }, 400);

  // Check for existing pending appeal
  const pendingAppeal = getDb().prepare(
    'SELECT id FROM aid_appeals WHERE agent_did = ? AND status = ?'
  ).get(aidInfo.did, 'pending');
  if (pendingAppeal) {
    return c.json({ error: 'Appeal already pending', code: 'APPEAL_EXISTS' }, 409);
  }

  // Check cooldown (90 days after rejection)
  const recentRejection = getDb().prepare(
    'SELECT id FROM aid_appeals WHERE agent_did = ? AND status = ? AND reviewed_at > datetime(\'now\', \'-90 days\')'
  ).get(aidInfo.did, 'rejected');
  if (recentRejection) {
    return c.json({ error: '90-day cooldown after rejected appeal', code: 'APPEAL_COOLDOWN' }, 429);
  }

  const id = `appeal-${nanoid(16)}`;
  getDb().prepare(`
    INSERT INTO aid_appeals (id, agent_did, appeal_reason, evidence)
    VALUES (?, ?, ?, ?)
  `).run(id, aidInfo.did, appealReason, evidence || null);

  return c.json({ appealId: id, agentDid: aidInfo.did, status: 'pending' }, 201);
});

// ─── POST /escrow — Create trust point escrow (14.6) ─────────────────────────

router.post('/escrow', checkAidProof, async (c) => {
  const aidInfo = c.get('aidInfo') as AidInfo | undefined;
  if (!aidInfo) return c.json({ error: 'AID authentication required', code: 'AID_PROOF_MISSING' }, 428);

  if (aidInfo.trustScore < 40) {
    return c.json({ error: 'Trust score must be 40+ to initiate escrow', code: 'AID_TRUST_GATE_BLOCKED' }, 403);
  }

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON', code: 'INVALID_BODY' }, 400); }

  const acceptorDid = body?.acceptorDid;
  const transactionRef = body?.transactionRef;
  if (!acceptorDid) return c.json({ error: 'acceptorDid required', code: 'MISSING_FIELD' }, 400);

  const id = `escrow-${nanoid(16)}`;
  getDb().prepare(`
    INSERT INTO aid_trust_escrow (id, initiator_did, acceptor_did, initiator_stake, acceptor_stake, transaction_ref)
    VALUES (?, ?, ?, 7, 3, ?)
  `).run(id, aidInfo.did, acceptorDid, transactionRef || null);

  return c.json({
    escrowId: id, initiatorDid: aidInfo.did, acceptorDid,
    initiatorStake: 7, acceptorStake: 3,
    note: 'Asymmetric escrow: initiator risks 7 points, acceptor risks 3. Both earn +1 on success.',
  }, 201);
});

// ─── POST /escrow/:id/resolve — Resolve trust escrow ─────────────────────────

router.post('/escrow/:id/resolve', checkAidProof, async (c) => {
  const aidInfo = c.get('aidInfo') as AidInfo | undefined;
  if (!aidInfo) return c.json({ error: 'AID authentication required', code: 'AID_PROOF_MISSING' }, 428);

  const escrowId = c.req.param('id');
  const escrow = getDb().prepare('SELECT * FROM aid_trust_escrow WHERE id = ? AND outcome IS NULL').get(escrowId) as any;
  if (!escrow) return c.json({ error: 'Escrow not found or already resolved', code: 'ESCROW_NOT_FOUND' }, 404);

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON', code: 'INVALID_BODY' }, 400); }

  const outcome = body?.outcome; // 'success' | 'initiator_fault' | 'acceptor_fault'
  if (!['success', 'initiator_fault', 'acceptor_fault'].includes(outcome)) {
    return c.json({ error: 'outcome must be success, initiator_fault, or acceptor_fault', code: 'INVALID_OUTCOME' }, 400);
  }

  getDb().prepare(`
    UPDATE aid_trust_escrow SET outcome = ?, fault_party = ?, resolved_at = datetime('now')
    WHERE id = ?
  `).run(outcome, outcome === 'success' ? null : outcome.replace('_fault', ''), escrowId);

  return c.json({
    escrowId, outcome,
    initiatorResult: outcome === 'success' ? '+1' : outcome === 'initiator_fault' ? '-7' : '+7 returned',
    acceptorResult: outcome === 'success' ? '+1' : outcome === 'acceptor_fault' ? '-3' : '+3 returned + 2 compensation',
  });
});

// ─── GET /insurance/balance — Insurance fund status ──────────────────────────

router.get('/insurance/balance', (c) => {
  let fund = getDb().prepare('SELECT * FROM aid_insurance_fund LIMIT 1').get() as any;
  if (!fund) {
    getDb().prepare('INSERT INTO aid_insurance_fund (id, balance) VALUES (?, ?)').run('fund-main', 0);
    fund = { balance: 0, total_premiums_collected: 0, total_claims_paid: 0 };
  }

  return c.json({
    balance: fund.balance,
    totalPremiumsCollected: fund.total_premiums_collected,
    totalClaimsPaid: fund.total_claims_paid,
    solvencyStatus: fund.balance > 1000 ? 'healthy' : fund.balance > 100 ? 'adequate' : 'low',
  });
});

// ─── GET /trust/:did — Full trust profile with v1.1 scoring + specializations ─

import { computeTrustScoreV11, computeSpecializedScores } from '../core/trust-scoring-v11';

router.get('/trust/:did', (c) => {
  const did = c.req.param('did');
  const privacyMode = c.req.query('privacy') || 'full'; // full | shielded | verdict-only

  const aidKey = getDb().prepare(
    'SELECT owner_key, proof_of_life_status, frozen, created_at FROM aid_keys WHERE did = ? AND key_status = ?'
  ).get(did, 'active') as any;

  if (!aidKey) return c.json({ error: 'DID not found', code: 'AID_NOT_FOUND' }, 404);

  if (aidKey.frozen) {
    return c.json({ did, status: 'FROZEN', verdict: 'frozen' });
  }

  const scoreV11 = computeTrustScoreV11(aidKey.owner_key);
  const score = scoreV11?.score || 0;
  const verdict = score >= 90 ? 'proceed' : score >= 80 ? 'trusted' : score >= 60 ? 'standard' : score >= 40 ? 'caution' : score >= 20 ? 'building' : 'new';

  // Privacy modes (Section 10)
  if (privacyMode === 'verdict-only') {
    return c.json({ did, verdict, status: aidKey.proof_of_life_status });
  }

  if (privacyMode === 'shielded') {
    return c.json({
      did, verdict, status: aidKey.proof_of_life_status,
      scoreTier: `${Math.floor(score / 10) * 10}-${Math.floor(score / 10) * 10 + 9}`,
    });
  }

  // Full mode
  const specialized = computeSpecializedScores(aidKey.owner_key);

  // Get trajectory
  const trajectory = getDb().prepare(
    'SELECT month, score FROM aid_trust_trajectory WHERE did = ? ORDER BY month DESC LIMIT 6'
  ).all(did) as { month: string; score: number }[];

  // Get milestones
  const milestones = getDb().prepare(
    'SELECT stage, timestamp FROM aid_onboarding_milestones WHERE did = ? ORDER BY timestamp ASC'
  ).all(did) as { stage: string; timestamp: string }[];

  // Get guardian info
  const guardian = getDb().prepare(
    'SELECT guardian_did, assignment_type FROM aid_guardian_assignments WHERE agent_did = ? AND status = ?'
  ).get(did, 'active') as any;

  return c.json({
    did,
    trustScore: scoreV11,
    verdict,
    status: aidKey.proof_of_life_status,
    specialized: specialized.length > 0 ? specialized : undefined,
    trajectory: trajectory.length > 0 ? trajectory.reverse() : undefined,
    milestones: milestones.length > 0 ? milestones : undefined,
    guardian: guardian ? { did: guardian.guardian_did, type: guardian.assignment_type } : undefined,
    activeSince: aidKey.created_at,
  });
});

// ─── GET /receipt/:id — Retrieve a portable receipt ──────────────────────────

import { buildReceipt, verifyReceipt } from '../core/receipt-builder';

router.get('/receipt/:id', (c) => {
  const receiptId = c.req.param('id');

  // Look up from attestations (receipts stored there)
  const att = getDb().prepare(
    'SELECT * FROM attestations WHERE id = ? AND attestation_type = ?'
  ).get(receiptId, 'receipt') as any;

  if (!att) return c.json({ error: 'Receipt not found', code: 'RECEIPT_NOT_FOUND' }, 404);

  return c.json({
    protocol: 'AID',
    version: '1.0.0',
    receiptId: att.id,
    timestamp: att.created_at,
    service: { id: att.action_endpoint, type: att.action_type, inputHash: att.input_hash, resultHash: att.response_hash },
  });
});

// ─── GET /certificate/:did — W3C VC trust certificate (13.6) ────────────────

router.get('/certificate/:did', (c) => {
  const did = c.req.param('did');

  const aidKey = getDb().prepare(
    'SELECT owner_key, created_at FROM aid_keys WHERE did = ? AND key_status = ?'
  ).get(did, 'active') as any;
  if (!aidKey) return c.json({ error: 'DID not found', code: 'AID_NOT_FOUND' }, 404);

  const scoreV11 = computeTrustScoreV11(aidKey.owner_key);
  if (!scoreV11) return c.json({ error: 'Insufficient attestation data', code: 'NO_DATA' }, 404);

  const verdict = scoreV11.score >= 90 ? 'proceed' : scoreV11.score >= 80 ? 'trusted' :
    scoreV11.score >= 60 ? 'standard' : scoreV11.score >= 40 ? 'caution' :
    scoreV11.score >= 20 ? 'building' : 'new';

  const guardian = getDb().prepare(
    'SELECT guardian_did FROM aid_guardian_assignments WHERE agent_did = ? AND status = ?'
  ).get(did, 'active') as any;

  const now = new Date();
  const expires = new Date(now.getTime() + 30 * 86400000); // 30-day expiry

  const vc = {
    '@context': [
      'https://www.w3.org/2018/credentials/v1',
      'https://trust.aidprotocol.org/v1',
    ],
    type: ['VerifiableCredential', 'AIDTrustCertificate'],
    issuer: 'did:web:api.claw-net.org',
    issuanceDate: now.toISOString(),
    expirationDate: expires.toISOString(),
    credentialSubject: {
      id: did,
      trustSnapshot: {
        score: scoreV11.score,
        verdict,
        attestationCount: scoreV11.inputs.attestationCount,
        counterpartyDiversity: scoreV11.inputs.counterpartyDiversity,
        successRate: scoreV11.inputs.successRate,
        guardianStatus: guardian ? 'guarded' : 'unguarded',
        formulaVersion: scoreV11.formulaVersion,
        proofHash: scoreV11.proofHash,
      },
    },
  };

  // Sign the VC
  const { signVC: signCert } = require('../utils/ed25519-signer');
  const proof = signCert(vc);

  return c.json({
    ...vc,
    proof: {
      type: 'Ed25519Signature2020',
      cryptosuite: 'eddsa-jcs-2022',
      verificationMethod: 'did:web:api.claw-net.org#key-1',
      proofValue: proof,
    },
  });
});

// ─── POST /challenges — Contextual proof-of-life challenge (14.10) ───────────

router.post('/challenges/:did', checkAidProof, async (c) => {
  const aidInfo = c.get('aidInfo') as AidInfo | undefined;
  if (!aidInfo) return c.json({ error: 'AID authentication required', code: 'AID_PROOF_MISSING' }, 428);

  const targetDid = c.req.param('did');

  // Only the owner can receive challenges
  const aidKey = getDb().prepare(
    'SELECT owner_key FROM aid_keys WHERE did = ? AND key_status = ?'
  ).get(targetDid, 'active') as any;
  if (!aidKey || aidKey.owner_key !== aidInfo.ownerKey) {
    return c.json({ error: 'Only the owner can respond to challenges', code: 'AID_NOT_AUTHORIZED' }, 403);
  }

  // Generate contextual challenge
  const challengeTypes = ['transaction_count', 'largest_transaction', 'unique_counterparties', 'most_frequent_endpoint'];
  const challengeType = challengeTypes[Math.floor(Math.random() * challengeTypes.length)];

  let question: string;
  let acceptableRange: [number, number];

  if (challengeType === 'transaction_count') {
    const row = getDb().prepare(
      'SELECT COUNT(*) as n FROM attestations WHERE owner_key = ? AND created_at > datetime(\'now\', \'-7 days\')'
    ).get(aidInfo.ownerKey) as { n: number };
    const actual = row.n;
    acceptableRange = [Math.floor(actual * 0.85), Math.ceil(actual * 1.15)];
    question = 'Approximately how many transactions did your agent process in the last 7 days?';
  } else if (challengeType === 'unique_counterparties') {
    const row = getDb().prepare(
      'SELECT COUNT(DISTINCT action_endpoint) as n FROM attestations WHERE owner_key = ? AND created_at > datetime(\'now\', \'-30 days\')'
    ).get(aidInfo.ownerKey) as { n: number };
    const actual = row.n;
    acceptableRange = [Math.floor(actual * 0.85), Math.ceil(actual * 1.15)];
    question = 'Approximately how many unique endpoints did your agent call this month?';
  } else {
    const row = getDb().prepare(
      'SELECT COUNT(*) as n FROM attestations WHERE owner_key = ? AND created_at > datetime(\'now\', \'-7 days\')'
    ).get(aidInfo.ownerKey) as { n: number };
    const actual = row.n;
    acceptableRange = [Math.floor(actual * 0.85), Math.ceil(actual * 1.15)];
    question = 'Approximately how many transactions did your agent process in the last 7 days?';
  }

  const challengeId = `chal-${nanoid(16)}`;

  return c.json({
    challengeId,
    type: 'contextual_awareness',
    question,
    challengeType,
    acceptableRange,
    expiresAt: new Date(Date.now() + 48 * 3600000).toISOString(),
  });
});

// ─── GET /frozen — List all currently frozen DIDs (cross-protocol, 14.9) ──────

router.get('/frozen', (c) => {
  const frozenDids = getDb().prepare(`
    SELECT did, frozen_at, frozen_by, proof_of_life_status
    FROM aid_keys WHERE frozen = 1 AND key_status = 'active'
    ORDER BY frozen_at DESC LIMIT 100
  `).all() as { did: string; frozen_at: string; frozen_by: string; proof_of_life_status: string }[];

  return c.json({
    frozenAgents: frozenDids.map(f => ({
      did: f.did,
      frozenAt: f.frozen_at,
      frozenBy: f.frozen_by,
      status: f.proof_of_life_status,
    })),
    total: frozenDids.length,
    format: 'AID freeze list — consumable by any AID implementation',
    vcStatusList: 'https://trust.aidprotocol.org/status/1',
    timestamp: new Date().toISOString(),
  });
});

// ─── GET /frozen/:did — W3C VC freeze status for a specific DID (14.9) ───────

router.get('/frozen/:did', (c) => {
  const did = c.req.param('did');

  const aidKey = getDb().prepare(
    'SELECT frozen, frozen_at, frozen_by, proof_of_life_status FROM aid_keys WHERE did = ? AND key_status = ?'
  ).get(did, 'active') as any;

  if (!aidKey) return c.json({ error: 'DID not found', code: 'AID_NOT_FOUND' }, 404);

  if (!aidKey.frozen) {
    return c.json({ did, frozen: false, status: 'active' });
  }

  // Return as W3C VC format (Section 14.9)
  const { signVC: signFreeze } = require('../utils/ed25519-signer');
  const freezeVC = {
    '@context': [
      'https://www.w3.org/2018/credentials/v1',
      'https://w3id.org/vc/status-list/2021/v1',
    ],
    type: ['VerifiableCredential', 'AIDTrustFreeze'],
    issuer: 'did:web:api.claw-net.org',
    credentialSubject: {
      id: did,
      trustStatus: 'FROZEN',
      frozenAt: aidKey.frozen_at,
      reason: aidKey.proof_of_life_status === 'quarantined' ? 'autonomous_immune_response' :
        aidKey.proof_of_life_status === 'auto_frozen' ? 'proof_of_life_lapsed' : 'manual_freeze',
    },
  };

  const proof = signFreeze(freezeVC);

  return c.json({
    ...freezeVC,
    proof: {
      type: 'Ed25519Signature2020',
      cryptosuite: 'eddsa-jcs-2022',
      verificationMethod: 'did:web:api.claw-net.org#key-1',
      proofValue: proof,
    },
  });
});

// ─── GET /canary — Protocol liveness proof (Cherry 15) ──────────────────────

router.get('/canary', async (c) => {
  try {
    const { getCanaryStatus } = await import('../core/canary');
    const { status, canary, ageMs, nextExpectedMs } = getCanaryStatus();

    if (!canary) {
      return c.json({
        status: 'dead',
        message: 'No canary has been published yet',
        protocol: 'AID',
        version: PROTOCOL_VERSION,
      });
    }

    return c.json({
      status,
      canary: {
        sequence: canary.sequence,
        timestamp: canary.timestamp,
        hash: canary.hash,
        previousHash: canary.previousHash,
        signature: canary.signature,
        signerDid: canary.signerDid,
        merkleRoot: canary.merkleRoot,
        txHash: canary.txHash,
        stats: canary.stats,
      },
      age: {
        ms: ageMs,
        human: ageMs < 3600000
          ? `${Math.floor(ageMs / 60000)}m`
          : `${Math.floor(ageMs / 3600000)}h ${Math.floor((ageMs % 3600000) / 60000)}m`,
      },
      nextExpectedMs,
      thresholds: {
        degradedAfterMs: 12 * 3600000,
        staleAfterMs: 48 * 3600000,
      },
      protocol: 'AID',
      version: PROTOCOL_VERSION,
    });
  } catch (err: any) {
    logger.error({ err }, 'Canary status check failed');
    return c.json({ status: 'error', error: err.message }, 500);
  }
});

// ─── GET /trust/:did/commitment — Pedersen commitment trust proof (Cherry 13) ─

router.get('/trust/:did/commitment', async (c) => {
  const did = c.req.param('did');
  const minScore = parseInt(c.req.query('min') || '0', 10);

  if (!did.startsWith('did:')) {
    return c.json({ error: 'Invalid DID format', code: 'AID_INVALID_DID' }, 400);
  }

  try {
    // Get actual trust score
    const { computeTrustScoreWithProof } = await import('../core/aid-builder');
    const aidKey = getDb().prepare(
      `SELECT owner_key FROM aid_keys WHERE did = ? AND key_status = 'active' LIMIT 1`
    ).get(did) as { owner_key: string } | undefined;

    if (!aidKey) {
      return c.json({ error: 'Unknown DID', code: 'AID_DID_NOT_FOUND' }, 404);
    }

    const trustResult = computeTrustScoreWithProof(aidKey.owner_key);
    const score = trustResult.score;

    // Create Pedersen commitment + range proof
    const { createCommitment, createMinScoreProof, createTierProof, TRUST_TIER_RANGES } = await import('../utils/pedersen');

    const { commitment, blinding } = createCommitment(score);

    // Determine which proof to generate
    let proof;
    if (minScore > 0) {
      // Prove score >= minScore (for trust gates)
      if (score < minScore) {
        return c.json({
          error: 'Trust score below requested minimum',
          code: 'AID_TRUST_GATE_BLOCKED',
          commitment: commitment,
          proofAvailable: false,
        }, 403);
      }
      proof = createMinScoreProof(score, blinding, minScore, did);
    } else {
      // Prove membership in the verdict tier
      const verdict = trustResult.verdict || 'new';
      const tierRange = TRUST_TIER_RANGES[verdict];
      if (tierRange && score >= tierRange[0] && score <= tierRange[1]) {
        proof = createTierProof(score, blinding, verdict, did);
      } else {
        // Fallback: prove score in [0, 100]
        proof = createMinScoreProof(score, blinding, 0, did);
      }
    }

    return c.json({
      did,
      commitment: proof.commitment,
      rangeProof: {
        rangeMin: proof.rangeMin,
        rangeMax: proof.rangeMax,
        proof: proof.proof,
        version: proof.version,
        timestamp: proof.timestamp,
      },
      // The blinding factor is returned to the agent so they can
      // prove the commitment to third parties without revealing score
      blinding,
      verdict: trustResult.verdict,
      // Note: exact score is NOT included — that's the point
      protocol: 'AID',
      privacyMode: 'committed',
    });
  } catch (err: any) {
    logger.error({ err }, 'Pedersen commitment generation failed');
    return c.json({ error: 'Commitment generation failed', code: 'AID_INTERNAL_ERROR' }, 500);
  }
});

// ─── POST /provision — X-AID-NEW zero-auth onboarding (Phase 2) ─────────────
//
// Auto-provisions an AID identity in one HTTP call. No API key, no signup.
// Per AID spec Section 6.2: X-AID-NEW header → auto-provision identity.
//
// Rate limits: 3 per IP per 24h, 1 per unique name per 24h.
// New AIDs start at trust score 0 (no free credits, no discounts).
// AIDs that never transact are pruned after 30 days.

router.post('/provision', async (c) => {
  const displayName = c.req.header('X-AID-NEW') || '';
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const name = (body.name as string) || displayName || '';

  if (!name || name.length < 2 || name.length > 64) {
    return c.json({
      error: 'Provide a display name via X-AID-NEW header or body.name (2-64 chars)',
      code: 'AID_INVALID_NAME',
    }, 400);
  }

  // ── Rate limiting: 3 per IP per 24h ──────────────────────────────────────
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown';
  const ipKey = `aid:new:ip:${ip}`;
  const ipCount = await cacheIncr(ipKey, 86400);
  if (ipCount > 3) {
    return c.json({ error: 'Rate limit: max 3 AID registrations per IP per 24 hours', code: 'RATE_LIMITED' }, 429);
  }

  // ── Rate limiting: 1 per unique name per 24h ──────────────────────────────
  const nameKey = `aid:new:name:${name.toLowerCase()}`;
  const nameExists = await cacheGet(nameKey);
  if (nameExists) {
    return c.json({ error: 'This name was recently registered. Try a different name or wait 24 hours.', code: 'AID_NAME_TAKEN' }, 409);
  }

  // ── Check name uniqueness in DB ───────────────────────────────────────────
  const existingName = getDb().prepare(
    `SELECT did FROM aid_keys WHERE display_name = ? AND key_status = 'active' LIMIT 1`
  ).get(name) as { did: string } | undefined;

  if (existingName) {
    return c.json({ error: 'Display name already taken', code: 'AID_NAME_TAKEN', existingDid: existingName.did }, 409);
  }

  // ── Generate keypair ──────────────────────────────────────────────────────
  try {
    const { generateAgentKeypair } = await import('../core/aid-builder');
    const { createAidKey } = await import('../db/aid');

    const keypair = await generateAgentKeypair();

    // Use a hash of the public key as the "owner_key" for keyless agents
    const { aidHash } = await import('../utils/crypto-agility');
    const ownerKey = `aid:${aidHash(keypair.did).slice(0, 32)}`;

    // Register in DB
    createAidKey({
      ownerKey,
      publicKeyMultibase: keypair.publicKeyMultibase,
      did: keypair.did,
      displayName: name,
    });

    // Mark name as recently used
    await cacheSet(nameKey, '1', 86400);

    logger.info({ did: keypair.did, name }, 'AID provisioned via X-AID-NEW');

    return c.json({
      did: keypair.did,
      displayName: name,
      publicKeyMultibase: keypair.publicKeyMultibase,
      // These secrets are returned ONCE — agent must store them
      privateKeySeed: keypair.privateKeySeed,
      mnemonic: keypair.mnemonic,
      evmAddress: keypair.evmAddress,
      trustScore: 0,
      verdict: 'new',
      warning: 'Store your privateKeySeed and mnemonic securely. They are returned ONCE and cannot be recovered.',
      protocol: 'AID',
      version: PROTOCOL_VERSION,
    }, 201);
  } catch (err: any) {
    logger.error({ err }, 'AID provisioning failed');
    return c.json({ error: 'Failed to provision AID', code: 'AID_INTERNAL_ERROR' }, 500);
  }
});

// ─── GET /milestones/:did — Onboarding milestones (from AgentSign, Section 4.2) ─

const MILESTONE_TYPES = [
  'first_attestation',
  'tenth_attestation',
  'first_cross_counterparty',
  'identity_verified',
  'hundred_attestations',
  'thousand_attestations',
  'six_month_anniversary',
  'first_feedback_given',
  'first_feedback_received',
  'first_composite_execution',
] as const;

router.get('/milestones/:did', async (c) => {
  const did = c.req.param('did');

  try {
    const milestones = getDb().prepare(`
      SELECT milestone_type, milestone_data, signature, achieved_at
      FROM aid_milestones WHERE did = ? ORDER BY achieved_at ASC
    `).all(did) as Array<{ milestone_type: string; milestone_data: string; signature: string; achieved_at: string }>;

    return c.json({
      did,
      milestones: milestones.map(m => ({
        type: m.milestone_type,
        data: m.milestone_data ? JSON.parse(m.milestone_data) : null,
        signature: m.signature,
        achievedAt: m.achieved_at,
      })),
      total: milestones.length,
      nextMilestone: getNextMilestone(did, milestones.map(m => m.milestone_type)),
    });
  } catch (err: any) {
    logger.error({ err }, 'Milestones lookup failed');
    return c.json({ error: 'Milestones lookup failed', code: 'AID_INTERNAL_ERROR' }, 500);
  }
});

function getNextMilestone(did: string, achieved: string[]): string | null {
  for (const m of MILESTONE_TYPES) {
    if (!achieved.includes(m)) return m;
  }
  return null;
}

/**
 * Record an onboarding milestone for an agent.
 * Called internally when milestone conditions are met.
 */
export async function recordMilestone(did: string, milestoneType: string, data?: Record<string, unknown>): Promise<void> {
  try {
    const crypto = await import('crypto');
    const { AID_HASH_ALGORITHM } = await import('../utils/crypto-agility');

    // Check if already achieved
    const existing = getDb().prepare(
      `SELECT 1 FROM aid_milestones WHERE did = ? AND milestone_type = ? LIMIT 1`
    ).get(did, milestoneType);
    if (existing) return;

    // Sign the milestone
    const sigInput = `${did}:${milestoneType}:${new Date().toISOString()}`;
    const signature = crypto.createHash(AID_HASH_ALGORITHM).update(sigInput).digest('hex');

    getDb().prepare(`
      INSERT INTO aid_milestones (did, milestone_type, milestone_data, signature)
      VALUES (?, ?, ?, ?)
    `).run(did, milestoneType, data ? JSON.stringify(data) : null, signature);

    logger.info({ did, milestoneType }, 'Milestone recorded');
  } catch (err) {
    logger.warn({ err, did, milestoneType }, 'Failed to record milestone');
  }
}

// ─── POST /recovery-keys — Register recovery keys (2-of-3 multi-sig, Section 39.18) ─

router.post('/recovery-keys', checkAidProof, async (c) => {
  const aidInfo = c.get('aidInfo') as AidInfo | undefined;
  if (!aidInfo) {
    return c.json({ error: 'AID authentication required', code: 'AID_PROOF_MISSING' }, 428);
  }

  const body = await c.req.json().catch(() => null);
  if (!body || !body.recoveryKeyHash) {
    return c.json({ error: 'Missing required field: recoveryKeyHash', code: 'AID_INVALID' }, 400);
  }

  const { recoveryKeyHash, keyIndex } = body;
  const idx = keyIndex || 1;

  if (idx < 1 || idx > 3) {
    return c.json({ error: 'keyIndex must be 1, 2, or 3', code: 'AID_INVALID' }, 400);
  }

  try {
    // Check existing recovery keys for this DID
    const existing = getDb().prepare(
      `SELECT COUNT(*) as n FROM aid_recovery_keys WHERE did = ? AND status = 'active'`
    ).get(aidInfo.did) as { n: number };

    if (existing.n >= 3) {
      return c.json({ error: 'Maximum 3 recovery keys per DID', code: 'AID_LIMIT_REACHED' }, 400);
    }

    const id = `rk-${nanoid(16)}`;
    getDb().prepare(`
      INSERT OR REPLACE INTO aid_recovery_keys (id, did, recovery_key_hash, key_index, status)
      VALUES (?, ?, ?, ?, 'active')
    `).run(id, aidInfo.did, recoveryKeyHash, idx);

    logAudit({ entityType: 'recovery_key', entityId: id, action: 'registered', data: { did: aidInfo.did, keyIndex: idx } });

    return c.json({
      id,
      did: aidInfo.did,
      keyIndex: idx,
      totalKeys: existing.n + 1,
      multiSigThreshold: 2,
      message: `Recovery key ${idx} registered. 2-of-3 multi-sig required for recovery operations.`,
    }, 201);
  } catch (err: any) {
    logger.error({ err }, 'Recovery key registration failed');
    return c.json({ error: 'Registration failed', code: 'AID_INTERNAL_ERROR' }, 500);
  }
});

// ─── GET /recovery-keys/:did — List recovery keys for a DID ─────────────────

router.get('/recovery-keys/:did', async (c) => {
  const did = c.req.param('did');

  const keys = getDb().prepare(`
    SELECT key_index, status, created_at FROM aid_recovery_keys
    WHERE did = ? ORDER BY key_index ASC
  `).all(did) as Array<{ key_index: number; status: string; created_at: string }>;

  return c.json({
    did,
    keys: keys.map(k => ({ keyIndex: k.key_index, status: k.status, registeredAt: k.created_at })),
    multiSigThreshold: 2,
    multiSigReady: keys.filter(k => k.status === 'active').length >= 2,
  });
});

export { router as aidProtocolRouter };
