import { Hono } from 'hono';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';
import { deductCredit, topUpCredits, logAudit } from '../db/index';
import { round6 } from '../core/credits';
import { trackDelegatedSpend } from '../utils/billing';
import { cacheGet, cacheSet, cacheIncr } from '../cache/index';
import { logger } from '../utils/logger';
import {
  writeManifestMemory,
  queryManifestMemory,
  getRecentDuplicate,
  computeRequestHash,
  recordManifestOutcome,
  getManifestById,
  getMemoryContext,
  getVerdictOutcomeStats,
} from '../db/manifest';

// ─── Zod Schemas ────────────────────────────────────────────────────────────

const ManifestRequestSchema = z.object({
  check: z.string().min(1).max(2000).optional(),
  verify: z.object({
    claims: z.array(z.object({
      type: z.string().optional(),
      subject: z.string().optional(),
      value: z.unknown(),
      source: z.string().optional(),
      tolerance: z.number().min(0).max(1).optional(),
      unit: z.string().optional(),
    })).optional(),
    raw: z.string().max(5000).optional(),
  }).optional(),
  assess: z.object({
    decision: z.string().max(2000).optional(),
    reasoning: z.string().max(5000).optional(),
  }).optional(),
  preflight: z.object({
    action: z.string().max(100),
    params: z.record(z.unknown()).optional(),
  }).optional(),
  session_id: z.string().max(100).optional(),
  tier: z.enum(['quick', 'standard', 'deep']).default('standard'),
}).refine(data => data.check || data.verify || data.assess || data.preflight, {
  message: 'At least one of check, verify, assess, or preflight is required',
});

const OutcomeSchema = z.object({
  manifest_id: z.string().min(1),
  outcome: z.enum(['positive', 'negative', 'neutral']),
  data: z.record(z.unknown()).optional(),
  value: z.number().optional(),
});

// ─── Constants ──────────────────────────────────────────────────────────────

const TIER_COSTS: Record<string, number> = {
  quick: 0.5,
  standard: 2.0,
  deep: 5.0,
};

const DEDUP_TTL_MINUTES = 5;

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractSubject(body: z.infer<typeof ManifestRequestSchema>): string | undefined {
  if (body.verify?.claims?.length) return body.verify.claims[0].subject;
  if (body.preflight) return body.preflight.action;
  return undefined;
}

function extractActionType(body: z.infer<typeof ManifestRequestSchema>): string | undefined {
  if (body.preflight) return body.preflight.action;
  if (body.assess) return 'assess';
  if (body.verify) return 'verify';
  return body.check ? 'check' : undefined;
}

function looksLikeCryptoAddress(subject: string | undefined): boolean {
  if (!subject) return false;
  // Solana: base58, 32-44 chars; Ethereum: 0x + 40 hex
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(subject) || /^0x[a-fA-F0-9]{40}$/.test(subject);
}

function resolveBillingKey(keyInfo: Record<string, unknown>): string {
  const info = keyInfo as { key: string; delegatedFrom?: boolean; delegation?: { parentKey?: string } };
  return info.delegatedFrom
    ? (info.delegation?.parentKey || info.key)
    : info.key;
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const manifestRouter = new Hono();

// POST /v1/manifest — Main endpoint
manifestRouter.post('/', checkApiKey, async (c) => {
  const startTime = Date.now();

  // 1. Validate input
  const body = await c.req.json().catch(() => ({}));
  const parsed = ManifestRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({
      error: parsed.error.errors[0]?.message || 'Invalid request body',
      code: 'MANIFEST_VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    }, 400);
  }

  const req = parsed.data;
  const tier = req.tier;
  const tierCost = round6(TIER_COSTS[tier]);
  const keyInfo = c.get('apiKeyInfo') as Record<string, unknown>;
  const apiKey = (keyInfo as { key: string }).key;
  const billingKey = resolveBillingKey(keyInfo);

  // 1b. Rate limit — max 30 requests per key per minute
  const rlCount = await cacheIncr(`rl:manifest:${apiKey}`, 60);
  if (rlCount > 30) {
    return c.json({
      error: 'Rate limit exceeded — max 30 manifest requests per minute',
      code: 'RATE_LIMITED',
    }, 429);
  }

  // 2. Compute request hash — check for dedup (5 min window)
  const requestHash = computeRequestHash(apiKey, body);
  const duplicate = getRecentDuplicate(requestHash, DEDUP_TTL_MINUTES);

  if (duplicate) {
    return c.json({
      id: duplicate.id,
      verdict: duplicate.overall_verdict,
      confidence: duplicate.confidence,
      summary: duplicate.summary,
      verify: duplicate.verify_overall ? {
        overall: duplicate.verify_overall,
        claims_checked: duplicate.verify_claims_checked,
        claims_verified: duplicate.verify_claims_verified,
        claims_disputed: duplicate.verify_claims_disputed,
      } : undefined,
      assess: duplicate.assess_status ? { status: duplicate.assess_status } : undefined,
      preflight: duplicate.preflight_status ? {
        status: duplicate.preflight_status,
        risk_score: duplicate.preflight_risk_score,
      } : undefined,
      memory: {
        manifest_id: duplicate.id,
        from_memory: true,
        prior_checks: 0,
      },
      tier,
      domain: duplicate.domain,
      credits_charged: 0,
      cached: true,
      processing_time_ms: Date.now() - startTime,
      steps_run: [],
    });
  }

  // 3. Deduct credits
  const deducted = deductCredit(billingKey, tierCost);
  if (!deducted) {
    return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402);
  }
  trackDelegatedSpend(keyInfo, tierCost);

  // 4. Run manifest engine
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let engineResult: any;
  try {
    const { runManifest } = await import('../core/manifest-engine');
    engineResult = await runManifest(req as Parameters<typeof runManifest>[0], apiKey, tier);
  } catch (err) {
    logger.error({ err, tier }, 'Manifest engine failed');
    topUpCredits(billingKey, tierCost);
    return c.json({
      error: 'Manifest processing failed',
      code: 'MANIFEST_ENGINE_ERROR',
      credits_refunded: tierCost,
    }, 500);
  }

  // 5. Extract subject + action type for memory storage
  const subject = extractSubject(req) || engineResult.subject;
  const actionType = extractActionType(req) || engineResult.action_type;
  const domain = engineResult.domain || 'general';

  // 6. Write to manifest_memory
  let manifestId: string;
  try {
    manifestId = writeManifestMemory({
      apiKey,
      sessionId: req.session_id,
      requestHash,
      domain,
      subject,
      actionType,
      overallVerdict: engineResult.verdict,
      verifyOverall: engineResult.verify?.overall,
      verifyClaimsChecked: engineResult.verify?.claims_checked || 0,
      verifyClaimsVerified: engineResult.verify?.claims_verified || 0,
      verifyClaimsDisputed: engineResult.verify?.claims_disputed || 0,
      assessStatus: engineResult.assess?.status,
      assessPremisesValid: engineResult.assess?.premises_valid,
      preflightStatus: engineResult.preflight?.status,
      preflightRiskScore: engineResult.preflight?.risk_score,
      confidence: engineResult.confidence,
      summary: engineResult.summary,
      detailJson: engineResult,
    });
  } catch (err) {
    logger.warn({ err }, 'Manifest memory write failed — non-blocking');
    manifestId = `mfst_${Date.now()}`;
  }

  // 7. Write to intel tables if subject looks like a crypto address
  if (looksLikeCryptoAddress(subject)) {
    try {
      const { upsertIntelEntity, upsertIntelScore, appendIntelEvent } = await import('../db/intel');
      const entityId = upsertIntelEntity(subject!, 'wallet', 'solana');
      upsertIntelScore(
        entityId, subject!, 'solana', 'manifest',
        engineResult.confidence * 100, engineResult.confidence,
        engineResult.verdict === 'BLOCK' ? 'critical' : engineResult.verdict === 'HOLD' ? 'high' : 'low',
        `Manifest: ${engineResult.verdict} (${engineResult.confidence})`, engineResult
      );
      appendIntelEvent(
        entityId, subject!, 'solana', 'manifest', 'MANIFEST_CHECK',
        engineResult.verdict === 'BLOCK' ? 'warning' : 'info',
        { verdict: engineResult.verdict, confidence: engineResult.confidence, tier }
      );
    } catch (err) {
      logger.warn({ err }, 'Intel shared table write failed — non-blocking');
    }
  }

  // 8. Audit log
  logAudit({
    entityType: 'manifest',
    entityId: manifestId,
    action: 'CHECK',
    actorId: apiKey,
    data: { tier, verdict: engineResult.verdict, confidence: engineResult.confidence, domain },
  });

  // 9. Build memory context
  const memoryContext = getMemoryContext(apiKey, subject);

  // 10. Build response based on tier
  const stepsRun: string[] = [];
  if (engineResult.verify) stepsRun.push('verify');
  if (engineResult.assess) stepsRun.push('assess');
  if (engineResult.preflight) stepsRun.push('preflight');

  const response: Record<string, unknown> = {
    id: manifestId,
    verdict: engineResult.verdict,
    confidence: engineResult.confidence,
    tier,
    domain,
    credits_charged: tierCost,
    cached: false,
    processing_time_ms: Date.now() - startTime,
    steps_run: stepsRun,
  };

  if (tier === 'quick') {
    // Quick: only verify + preflight, 1-sentence summary
    response.summary = engineResult.summary;
    if (engineResult.verify) response.verify = engineResult.verify;
    if (engineResult.preflight) response.preflight = engineResult.preflight;
    response.memory = {
      manifest_id: manifestId,
      prior_checks: memoryContext.total_manifests,
      from_memory: false,
    };
  } else {
    // Standard + Deep: all steps + memory context
    response.summary = engineResult.summary;
    if (engineResult.verify) response.verify = engineResult.verify;
    if (engineResult.assess) response.assess = engineResult.assess;
    if (engineResult.preflight) response.preflight = engineResult.preflight;
    response.memory = {
      manifest_id: manifestId,
      prior_checks: memoryContext.total_manifests,
      last_check: memoryContext.last_check,
      subject_history: memoryContext.subject_history,
      from_memory: false,
    };
  }

  // Deep tier: add outcome stats if available
  if (tier === 'deep') {
    const outcomeStats = getVerdictOutcomeStats(engineResult.verdict);
    if (outcomeStats) {
      response.outcome_stats = outcomeStats;
    }
    response.llm_summary = engineResult.llm_summary || engineResult.summary;
  }

  return c.json(response);
});

// GET /v1/manifest/memory — Query past manifests
manifestRouter.get('/memory', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo') as Record<string, unknown>;
  const apiKey = resolveBillingKey(keyInfo);

  const subject = c.req.query('subject');
  const actionType = c.req.query('action_type');
  const verdict = c.req.query('verdict');
  const domain = c.req.query('domain');
  const since = c.req.query('since');
  const limitParam = parseInt(c.req.query('limit') || '20', 10);
  const limit = Math.min(Math.max(1, limitParam), 50);

  const memories = queryManifestMemory(apiKey, {
    subject: subject || undefined,
    actionType: actionType || undefined,
    verdict: verdict || undefined,
    domain: domain || undefined,
    limit,
    since: since || undefined,
  });

  const mapped = memories.map((m) => ({
    id: m.id,
    session_id: m.session_id,
    created_at: m.created_at,
    domain: m.domain,
    subject: m.subject,
    action_type: m.action_type,
    overall_verdict: m.overall_verdict,
    confidence: m.confidence,
    summary: m.summary,
    verify_overall: m.verify_overall,
    verify_claims_checked: m.verify_claims_checked,
    verify_claims_verified: m.verify_claims_verified,
    verify_claims_disputed: m.verify_claims_disputed,
    assess_status: m.assess_status,
    preflight_status: m.preflight_status,
    preflight_risk_score: m.preflight_risk_score,
    outcome: m.outcome,
    outcome_value: m.outcome_value,
    outcome_at: m.outcome_at,
  }));

  return c.json({
    memories: mapped,
    count: mapped.length,
    limit,
  });
});

// POST /v1/manifest/outcome — Report what happened
manifestRouter.post('/outcome', checkApiKey, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = OutcomeSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({
      error: 'Invalid request body',
      code: 'MANIFEST_VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    }, 400);
  }

  const { manifest_id, outcome, data, value } = parsed.data;
  const keyInfo = c.get('apiKeyInfo') as { key: string };
  const apiKey = keyInfo.key;

  // Check manifest exists and belongs to this key
  const manifest = getManifestById(manifest_id);
  if (!manifest || manifest.api_key !== apiKey) {
    return c.json({
      error: 'Manifest not found or does not belong to this key',
      code: 'MANIFEST_NOT_FOUND',
    }, 404);
  }

  // Check if outcome already recorded
  if (manifest.outcome) {
    return c.json({
      error: 'Outcome already recorded for this manifest',
      code: 'MANIFEST_OUTCOME_EXISTS',
    }, 409);
  }

  const updated = recordManifestOutcome(manifest_id, apiKey, outcome, data, value);
  if (!updated) {
    return c.json({ error: 'Failed to record outcome', code: 'MANIFEST_OUTCOME_FAILED' }, 500);
  }

  logAudit({
    entityType: 'manifest',
    entityId: manifest_id,
    action: 'OUTCOME',
    actorId: apiKey,
    data: { outcome, value },
  });

  return c.json({
    ok: true,
    manifest_id,
    outcome,
  });
});
