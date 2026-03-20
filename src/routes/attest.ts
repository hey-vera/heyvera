import { Hono } from 'hono';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';
import { deductCredit, logAudit, safeJsonParse } from '../db/index';
import {
  createAttestation,
  getAttestationById,
  getAttestationHistory,
  verifyAttestation,
  getAttestationStats,
  getPublicAgentProfile,
  hashApiKey,
  hashPayload,
} from '../db/attestations';
import { getManifestById } from '../db/manifest';
import { round6 } from '../core/credits';
import { trackDelegatedSpend } from '../utils/billing';
import { logger } from '../utils/logger';

// ─── Zod Schemas ────────────────────────────────────────────────────────────

const ExplicitAttestSchema = z.object({
  action_type: z.string().min(1).max(100),
  action_endpoint: z.string().max(500).optional(),
  description: z.string().max(2000).optional(),
  manifest_id: z.string().max(100).optional(),
  input_data: z.any().optional().refine(
    (v) => !v || JSON.stringify(v).length <= 100_000,
    'input_data exceeds 100KB limit'
  ),
  response_data: z.any().optional().refine(
    (v) => !v || JSON.stringify(v).length <= 100_000,
    'response_data exceeds 100KB limit'
  ),
  source_hashes: z.array(z.object({
    source: z.string(),
    hash: z.string(),
    fetched_at: z.string(),
  })).optional(),
  outcome: z.enum(['success', 'failure', 'partial', 'unknown']).default('success'),
  outcome_data: z.record(z.unknown()).optional().refine(
    (v) => !v || JSON.stringify(v).length <= 50_000,
    'outcome_data exceeds 50KB limit'
  ),
});

// ─── Constants ──────────────────────────────────────────────────────────────

const EXPLICIT_ATTEST_COST = 0.25;
const BASE_URL = 'https://api.claw-net.org';

// ─── Helpers ────────────────────────────────────────────────────────────────

function resolveBillingKey(keyInfo: Record<string, unknown>): string {
  const info = keyInfo as { key: string; delegatedFrom?: boolean; delegation?: { parentKey?: string } };
  return info.delegatedFrom
    ? (info.delegation?.parentKey || info.key)
    : info.key;
}

function formatAttestationResponse(att: ReturnType<typeof getAttestationById>) {
  if (!att) return null;
  return {
    id: att.id,
    api_key_hash: att.api_key_hash,
    sequence_number: att.sequence_number,
    attestation_type: att.attestation_type,
    manifest: {
      manifest_id: att.manifest_id,
      manifest_verdict: att.manifest_verdict,
      manifest_confidence: att.manifest_confidence,
      manifest_aligned: att.manifest_aligned === 1 ? true : att.manifest_aligned === 0 ? false : null,
    },
    action: {
      action_type: att.action_type,
      endpoint: att.action_endpoint,
      description: att.action_description,
    },
    input_hash: att.input_hash,
    response_hash: att.response_hash,
    source_hashes: safeJsonParse(att.source_hashes_json, null),
    credits_charged: att.credits_charged,
    duration_ms: att.duration_ms,
    outcome: {
      status: att.outcome_status,
      data: safeJsonParse(att.outcome_data_json, null),
    },
    signature: att.signature,
    signed: !!att.signature,
    signed_at: att.signed_at,
    created_at: att.created_at,
    verification_url: `${BASE_URL}/v1/attest/verify/${att.id}`,
  };
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const attestRouter = new Hono();

// POST /v1/attest — Create explicit attestation (0.25cr)
attestRouter.post('/', checkApiKey, async (c) => {
  const startTime = Date.now();

  // 1. Validate input
  const body = await c.req.json().catch(() => ({}));
  const parsed = ExplicitAttestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({
      error: parsed.error.errors[0]?.message || 'Invalid request body',
      code: 'INVALID_ATTESTATION',
      details: parsed.error.flatten().fieldErrors,
    }, 400);
  }

  const req = parsed.data;
  const keyInfo = c.get('apiKeyInfo') as Record<string, unknown>;
  const apiKey = (keyInfo as { key: string }).key;
  const billingKey = resolveBillingKey(keyInfo);
  const apiKeyHash = hashApiKey(apiKey);

  // 2. If manifest_id provided, look it up and verify ownership
  let manifestVerdict: string | undefined;
  let manifestConfidence: number | undefined;
  let manifestAligned: boolean | null = null;

  if (req.manifest_id) {
    const manifest = getManifestById(req.manifest_id);
    if (!manifest) {
      return c.json({ error: 'Manifest not found', code: 'MANIFEST_NOT_FOUND' }, 404);
    }
    if (manifest.api_key !== apiKey) {
      return c.json({ error: 'Manifest belongs to a different API key', code: 'MANIFEST_KEY_MISMATCH' }, 403);
    }
    manifestVerdict = manifest.overall_verdict;
    manifestConfidence = manifest.confidence;
    // Only PROCEED counts as aligned; CAUTION/HOLD/BLOCK = not aligned
    manifestAligned = manifestVerdict === 'PROCEED';
  }

  // 3. Deduct credits
  const cost = round6(EXPLICIT_ATTEST_COST);
  const deducted = deductCredit(billingKey, cost);
  if (!deducted) {
    return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402);
  }
  trackDelegatedSpend(keyInfo, cost);

  // 4. Hash input and response data
  const inputHash = req.input_data ? hashPayload(req.input_data) : hashPayload({});
  const responseHash = req.response_data ? hashPayload(req.response_data) : undefined;

  // 5. Create attestation
  let attestationId: string;
  try {
    attestationId = createAttestation({
      apiKeyHash,
      attestationType: 'explicit',
      manifestId: req.manifest_id,
      manifestVerdict,
      manifestConfidence,
      manifestAligned,
      actionType: req.action_type,
      actionEndpoint: req.action_endpoint,
      actionDescription: req.description,
      inputHash,
      responseHash,
      sourceHashes: req.source_hashes,
      creditsCharged: cost,
      durationMs: Date.now() - startTime,
      outcomeStatus: req.outcome,
      outcomeData: req.outcome_data,
    });
  } catch (err) {
    logger.error({ err }, 'Attestation creation failed');
    return c.json({ error: 'Attestation creation failed', code: 'ATTESTATION_CREATION_FAILED' }, 500);
  }

  // 6. Audit log
  logAudit({
    entityType: 'attestation',
    entityId: attestationId,
    action: 'CREATE_EXPLICIT',
    actorId: apiKey,
    data: { action_type: req.action_type, manifest_id: req.manifest_id, outcome: req.outcome },
  });

  // 7. Retrieve the created attestation for sequence_number
  const created = getAttestationById(attestationId);

  return c.json({
    attestation_id: attestationId,
    source: 'agent',
    signed: !!created?.signature,
    sequence_number: created?.sequence_number ?? 1,
    verification_url: `${BASE_URL}/v1/attest/verify/${attestationId}`,
    credits_charged: cost,
  }, 201);
});

// GET /v1/attest/verify/:id — Public verification (NO auth, FREE)
attestRouter.get('/verify/:id', async (c) => {
  const id = c.req.param('id');

  const result = verifyAttestation(id);

  if (!result.attestation) {
    return c.json({ error: 'Attestation not found', code: 'ATTESTATION_NOT_FOUND' }, 404);
  }

  const att = result.attestation;
  return c.json({
    attestation_id: att.id,
    valid: result.valid,
    source: att.attestation_type === 'automatic' ? 'platform' : 'agent',
    created_at: att.created_at,
    verification: {
      signature_verified: result.signature_valid,
      chain_intact: result.chain_contiguous,
      manifest_linked: !!att.manifest_id,
      manifest_verdict: att.manifest_verdict,
      manifest_confidence: att.manifest_confidence,
    },
    summary: {
      action_type: att.action_type,
      endpoint: att.action_endpoint,
      outcome_status: att.outcome_status,
      credits_charged: att.credits_charged,
      duration_ms: att.duration_ms,
      manifest_aligned: att.manifest_aligned === 1 ? true : att.manifest_aligned === 0 ? false : null,
    },
    verified_at: new Date().toISOString(),
  });
});

// GET /v1/attest/history — Query attestation history (free, auth required)
attestRouter.get('/history', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo') as { key: string };
  const apiKey = keyInfo.key;
  const apiKeyHash = hashApiKey(apiKey);

  const actionType = c.req.query('action_type');
  const manifestAlignedParam = c.req.query('manifest_aligned');
  const since = c.req.query('since');
  const limitParam = parseInt(c.req.query('limit') || '20', 10);
  const limit = Math.min(Math.max(1, limitParam), 50);

  let manifestAligned: boolean | undefined;
  if (manifestAlignedParam === 'true') manifestAligned = true;
  else if (manifestAlignedParam === 'false') manifestAligned = false;

  const attestations = getAttestationHistory(apiKeyHash, {
    actionType: actionType || undefined,
    manifestAligned,
    limit,
    since: since || undefined,
  });

  return c.json({
    attestations: attestations.map(formatAttestationResponse),
    count: attestations.length,
    limit,
  });
});

// GET /v1/attest/stats — Attestation summary (free, auth required)
attestRouter.get('/stats', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo') as { key: string };
  const apiKey = keyInfo.key;
  const apiKeyHash = hashApiKey(apiKey);

  const stats = getAttestationStats(apiKeyHash);

  if (!stats) {
    return c.json({
      total_attestations: 0,
      manifest_aligned: 0,
      manifest_unaligned: 0,
      manifest_unchecked: 0,
      success_count: 0,
      failure_count: 0,
      alignment_rate: 0,
      success_rate: 0,
    });
  }

  const alignable = stats.manifest_aligned + stats.manifest_unaligned;
  const total = stats.success_count + stats.failure_count;

  return c.json({
    total_attestations: stats.total_attestations,
    manifest_aligned: stats.manifest_aligned,
    manifest_unaligned: stats.manifest_unaligned,
    manifest_unchecked: stats.manifest_unchecked,
    success_count: stats.success_count,
    failure_count: stats.failure_count,
    alignment_rate: alignable > 0 ? Math.round((stats.manifest_aligned / alignable) * 100) : 0,
    success_rate: total > 0 ? Math.round((stats.success_count / total) * 100) : 0,
  });
});

// GET /v1/attest/agent/:keyHash — Public agent attestation profile (NO auth, FREE)
attestRouter.get('/agent/:keyHash', async (c) => {
  const keyHash = c.req.param('keyHash');

  const profile = getPublicAgentProfile(keyHash);

  if (!profile) {
    return c.json({ error: 'No attestation history found for this agent', code: 'AGENT_PROFILE_NOT_FOUND' }, 404);
  }

  return c.json({
    api_key_hash: keyHash,
    total_attestations: profile.total_attestations,
    alignment_rate: profile.alignment_rate,
    success_rate: profile.success_rate,
    first_attestation: profile.first_attestation,
    last_attestation: profile.last_attestation,
  });
});

// GET /v1/attest/:id — Get attestation details (free, requires auth, must own it)
attestRouter.get('/:id', checkApiKey, async (c) => {
  const id = c.req.param('id');
  const keyInfo = c.get('apiKeyInfo') as { key: string };
  const apiKey = keyInfo.key;
  const apiKeyHash = hashApiKey(apiKey);

  const att = getAttestationById(id);

  if (!att) {
    return c.json({ error: 'Attestation not found', code: 'ATTESTATION_NOT_FOUND' }, 404);
  }

  if (att.api_key_hash !== apiKeyHash) {
    return c.json({ error: 'Attestation belongs to a different API key', code: 'ATTESTATION_KEY_MISMATCH' }, 403);
  }

  return c.json(formatAttestationResponse(att));
});
