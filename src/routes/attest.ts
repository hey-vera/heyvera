import { Hono } from 'hono';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';
import { deductCredit, logAudit, safeJsonParse } from '../db/index';
import { cacheIncr } from '../cache/index';
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
import { getDb } from '../db/connection';
import { buildMerkleTree, getMerkleProof, verifyMerkleProof, validateTreeStructure } from '../core/merkle-anchor';
import { attestationToVC, getAttestationContext } from '../utils/vc-envelope';
import { verifyVCSignature, getEd25519PublicKeyMultibase } from '../utils/ed25519-signer';

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

  // 1b. Rate limit: max 100 explicit attestations per key per hour
  const rlCount = await cacheIncr(`rl:attest:${apiKey}`, 3600);
  if (rlCount > 100) {
    return c.json({
      error: 'Attestation rate limit exceeded (max 100/hour)',
      code: 'RATE_LIMITED',
      limit: 100,
    }, 429);
  }

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
  const wantsVC = c.req.query('format') === 'vc' ||
    (c.req.header('accept') || '').includes('application/vc+ld+json');

  const attestationResponse = {
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
  };

  // Accept: application/vc+ld+json → return only the VC with proper content type
  if ((c.req.header('accept') || '').includes('application/vc+ld+json') && !c.req.query('format')) {
    const vc = attestationToVC(att, BASE_URL);
    return c.json(vc, 200, { 'Content-Type': 'application/vc+ld+json' });
  }

  // ?format=vc → return both the attestation and VC envelope
  if (wantsVC) {
    const vc = attestationToVC(att, BASE_URL);
    return c.json({
      attestation: attestationResponse,
      verifiableCredential: vc,
    });
  }

  return c.json(attestationResponse);
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

// ─── VC Signature Verification ───────────────────────────────────────────────

// GET /v1/attest/verify-vc/:id — Verify Ed25519 signature on a VC (NO auth, FREE)
attestRouter.get('/verify-vc/:id', async (c) => {
  const id = c.req.param('id');
  const att = getAttestationById(id);

  if (!att) {
    return c.json({ error: 'Attestation not found', code: 'ATTESTATION_NOT_FOUND' }, 404);
  }

  // Rebuild the VC with proof
  const vc = attestationToVC(att, BASE_URL);

  if (!vc.proof || !vc.proof.proofValue) {
    return c.json({
      verified: false,
      reason: 'VC has no proof field',
      attestation_id: id,
    });
  }

  // Extract the proof, then rebuild VC without proof for verification
  const proof = vc.proof;
  const proofValue = proof.proofValue as string;

  // Build VC without proof (same as what was signed)
  const vcWithoutProof: Record<string, unknown> = { ...vc };
  delete vcWithoutProof.proof;

  const verified = verifyVCSignature(vcWithoutProof, proofValue);

  return c.json({
    verified,
    attestation_id: id,
    issuer: vc.issuer,
    cryptosuite: proof.cryptosuite,
    verificationMethod: proof.verificationMethod,
    proofPurpose: proof.proofPurpose,
    created: proof.created,
    publicKeyMultibase: getEd25519PublicKeyMultibase(),
    did: 'did:web:api.claw-net.org',
    didDocument: `${BASE_URL}/.well-known/did.json`,
  });
});

// ─── Merkle Anchor Endpoints ─────────────────────────────────────────────────
// These MUST be registered before the /:id catch-all route below.

interface AnchorRow {
  id: string;
  merkle_root: string;
  attestation_count: number;
  solana_tx_hash: string | null;
  tree_json: string | null;
  anchored_at: string;
  status: string;
}

// GET /v1/attest/anchor/:anchorId — Anchor details + proof for any attestation in the anchor
attestRouter.get('/anchor/:anchorId', async (c) => {
  const anchorId = c.req.param('anchorId');
  const attestationId = c.req.query('attestation_id');

  const anchor = getDb().prepare(
    'SELECT * FROM attestation_anchors WHERE id = ?'
  ).get(anchorId) as AnchorRow | undefined;

  if (!anchor) {
    return c.json({ error: 'Anchor not found', code: 'ANCHOR_NOT_FOUND' }, 404);
  }

  const result: Record<string, unknown> = {
    anchor_id: anchor.id,
    merkle_root: anchor.merkle_root,
    attestation_count: anchor.attestation_count,
    solana_tx_hash: anchor.solana_tx_hash,
    status: anchor.status,
    anchored_at: anchor.anchored_at,
    solana_explorer: anchor.solana_tx_hash
      ? `https://solscan.io/tx/${anchor.solana_tx_hash}`
      : null,
  };

  // If a specific attestation_id is requested, compute its Merkle proof
  if (attestationId && anchor.tree_json) {
    const att = getAttestationById(attestationId);
    if (!att) {
      return c.json({ error: 'Attestation not found', code: 'ATTESTATION_NOT_FOUND' }, 404);
    }
    if (att.anchor_id !== anchorId) {
      return c.json({ error: 'Attestation is not part of this anchor', code: 'ATTESTATION_ANCHOR_MISMATCH' }, 400);
    }

    const tree = safeJsonParse(anchor.tree_json, null) as string[][] | null;
    if (tree) {
      const treeCheck = validateTreeStructure(tree);
      if (!treeCheck.valid) {
        return c.json({ error: 'Stored Merkle tree is malformed', code: 'INVALID_TREE_STRUCTURE' }, 500);
      }
      const proof = getMerkleProof(att.input_hash, tree);
      if (proof === null) {
        return c.json({ error: 'Attestation hash not found in Merkle tree', code: 'HASH_NOT_IN_TREE' }, 404);
      }
      const verified = verifyMerkleProof(att.input_hash, proof, anchor.merkle_root);
      result.proof = {
        attestation_id: att.id,
        input_hash: att.input_hash,
        proof_path: proof,
        verified,
      };
    }
  }

  return c.json(result);
});

// GET /v1/attest/verify-onchain/:attestationId — On-chain Merkle proof for independent verification
attestRouter.get('/verify-onchain/:attestationId', async (c) => {
  const attestationId = c.req.param('attestationId');

  const att = getAttestationById(attestationId);
  if (!att) {
    return c.json({ error: 'Attestation not found', code: 'ATTESTATION_NOT_FOUND' }, 404);
  }

  if (!att.anchor_id || !att.anchored_at) {
    return c.json({
      attestation_id: att.id,
      anchored: false,
      message: 'This attestation has not been anchored on-chain yet. Anchoring occurs periodically.',
    });
  }

  const anchor = getDb().prepare(
    'SELECT * FROM attestation_anchors WHERE id = ?'
  ).get(att.anchor_id) as AnchorRow | undefined;

  if (!anchor) {
    return c.json({ error: 'Anchor record missing', code: 'ANCHOR_NOT_FOUND' }, 500);
  }

  let proof: { sibling: string; promoted: boolean }[] = [];
  let verified = false;

  if (anchor.tree_json) {
    const tree = safeJsonParse(anchor.tree_json, null) as string[][] | null;
    if (tree) {
      const treeCheck = validateTreeStructure(tree);
      if (!treeCheck.valid) {
        return c.json({ error: 'Stored Merkle tree is malformed', code: 'INVALID_TREE_STRUCTURE' }, 500);
      }
      const result = getMerkleProof(att.input_hash, tree);
      if (result !== null) {
        proof = result;
        verified = verifyMerkleProof(att.input_hash, proof, anchor.merkle_root);
      }
    }
  }

  return c.json({
    attestation_id: att.id,
    anchored: true,
    anchor_id: anchor.id,
    merkle_root: anchor.merkle_root,
    solana_tx_hash: anchor.solana_tx_hash,
    solana_explorer: anchor.solana_tx_hash
      ? `https://solscan.io/tx/${anchor.solana_tx_hash}`
      : null,
    anchored_at: att.anchored_at,
    status: anchor.status,
    proof: {
      input_hash: att.input_hash,
      proof_path: proof,
      verified,
    },
    verification_instructions: {
      step_1: 'Look up the Solana transaction and extract the memo field JSON',
      step_2: 'Confirm the merkle_root in the memo matches the one returned here',
      step_3: 'Use the proof_path to verify: hash the input_hash with each sibling in order. For each step, if promoted=false hash with the sibling (smaller value first); if promoted=true skip hashing. The final result should equal the merkle_root',
      step_4: 'If all steps pass, the attestation is cryptographically proven to have existed at anchor time',
    },
  });
});

// GET /v1/attest/:id — Get attestation details (free, requires auth, must own it)
// MUST be last — catch-all param route
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

// ─── POST /v1/attest/verify-batch — bulk verification (up to 50) ────────────

attestRouter.post('/verify-batch', async (c) => {
  const body = await c.req.json() as { ids?: string[] };
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json({ error: 'ids array required', code: 'INVALID_INPUT' }, 400);
  }
  if (ids.length > 50) {
    return c.json({ error: 'Maximum 50 attestation IDs per batch', code: 'BATCH_TOO_LARGE' }, 400);
  }

  const results: Record<string, unknown> = {};
  for (const id of ids) {
    try {
      const verification = verifyAttestation(id);
      results[id] = verification;
    } catch {
      results[id] = { valid: false, error: 'Attestation not found' };
    }
  }

  return c.json({ results, total: ids.length, verified: Object.values(results).filter((r: unknown) => (r as { valid?: boolean }).valid).length });
});

// ─── GET /v1/attest/status/:id — credential status (for W3C VC verifiers) ───

attestRouter.get('/status/:id', (c) => {
  const { id } = c.req.param();
  const att = getAttestationById(id);
  return c.json({
    id,
    active: !!att,
    ...(att && { type: att.attestation_type, createdAt: att.created_at }),
  });
});

// ─── GET /v1/attest/chain/:apiKeyHash — verify chain integrity ──────────────

attestRouter.get('/chain/:apiKeyHash', (c) => {
  const { apiKeyHash } = c.req.param();
  const limit = Math.min(parseInt(c.req.query('limit') || '100'), 500);

  const attestations = getDb().prepare(
    `SELECT id, sequence_number, input_hash, signature, prev_attestation_hash, created_at
     FROM attestations WHERE api_key_hash = ? ORDER BY sequence_number ASC LIMIT ?`
  ).all(apiKeyHash, limit) as Array<{
    id: string; sequence_number: number; input_hash: string;
    signature: string | null; prev_attestation_hash: string | null; created_at: string;
  }>;

  if (attestations.length === 0) {
    return c.json({ error: 'No attestations found for this agent', code: 'NO_ATTESTATIONS' }, 404);
  }

  // Verify chain: each attestation's prev_attestation_hash should match
  // SHA256(prev.id + prev.input_hash + prev.signature) of its predecessor
  let chainValid = true;
  let brokenAt: number | null = null;
  const crypto = require('crypto');

  for (let i = 1; i < attestations.length; i++) {
    const curr = attestations[i];
    const prev = attestations[i - 1];

    if (!curr.prev_attestation_hash) {
      // Pre-chaining attestation — skip (graceful fallback)
      continue;
    }

    const expectedHash = crypto.createHash('sha256')
      .update(`${prev.id}.${prev.input_hash}.${prev.signature ?? 'unsigned'}`)
      .digest('hex');

    if (curr.prev_attestation_hash !== expectedHash) {
      chainValid = false;
      brokenAt = curr.sequence_number;
      break;
    }
  }

  return c.json({
    apiKeyHash,
    chainValid,
    totalAttestations: attestations.length,
    ...(brokenAt !== null && { brokenAtSequence: brokenAt }),
    firstSequence: attestations[0].sequence_number,
    lastSequence: attestations[attestations.length - 1].sequence_number,
    oldestTimestamp: attestations[0].created_at,
    newestTimestamp: attestations[attestations.length - 1].created_at,
  });
});

// ─── GET /v1/attest/trust/:apiKeyHash — public agent trust profile ──────────
// Anyone can look up an agent's attestation track record. Creates network
// effects — the more agents use attestation, the more valuable trust data becomes.

attestRouter.get('/trust/:apiKeyHash', (c) => {
  const { apiKeyHash } = c.req.param();

  // Aggregate attestation stats
  const stats = getDb().prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN outcome_status = 'success' THEN 1 ELSE 0 END) as successes,
      SUM(CASE WHEN outcome_status = 'failure' THEN 1 ELSE 0 END) as failures,
      SUM(CASE WHEN manifest_aligned = 1 THEN 1 ELSE 0 END) as manifest_aligned,
      SUM(CASE WHEN manifest_aligned = 0 THEN 1 ELSE 0 END) as manifest_unaligned,
      SUM(CASE WHEN prev_attestation_hash IS NOT NULL THEN 1 ELSE 0 END) as chained,
      MIN(created_at) as first_attestation,
      MAX(created_at) as last_attestation,
      AVG(duration_ms) as avg_duration_ms,
      SUM(credits_charged) as total_credits_spent
    FROM attestations WHERE api_key_hash = ?
  `).get(apiKeyHash) as {
    total: number; successes: number; failures: number;
    manifest_aligned: number; manifest_unaligned: number; chained: number;
    first_attestation: string | null; last_attestation: string | null;
    avg_duration_ms: number | null; total_credits_spent: number;
  } | undefined;

  if (!stats || stats.total === 0) {
    return c.json({ error: 'No attestations found for this agent', code: 'NO_ATTESTATIONS' }, 404);
  }

  // Verdict distribution (last 30 days)
  const verdicts = getDb().prepare(`
    SELECT action_type, COUNT(*) as count
    FROM attestations
    WHERE api_key_hash = ? AND created_at > datetime('now', '-30 days')
    GROUP BY action_type ORDER BY count DESC LIMIT 10
  `).all(apiKeyHash) as Array<{ action_type: string; count: number }>;

  // Chain integrity check
  const chainCheck = getDb().prepare(`
    SELECT COUNT(*) as broken FROM attestations
    WHERE api_key_hash = ? AND prev_attestation_hash IS NOT NULL
    AND prev_attestation_hash != (
      SELECT CASE WHEN LAG(id) OVER (ORDER BY sequence_number) IS NOT NULL
        THEN 'valid' ELSE 'genesis' END
    )
  `).get(apiKeyHash) as { broken: number } | undefined;

  const successRate = stats.total > 0 ? round6(stats.successes / stats.total) : 0;
  const chainCoverage = stats.total > 0 ? round6(stats.chained / stats.total) : 0;

  // Trust score: weighted combination of success rate + chain coverage + volume
  const volumeScore = Math.min(1, stats.total / 1000); // max out at 1000 attestations
  const trustScore = round6(
    (successRate * 0.5) + (chainCoverage * 0.3) + (volumeScore * 0.2)
  );

  return c.json({
    apiKeyHash,
    trustScore,
    trustGrade: trustScore >= 0.9 ? 'A' : trustScore >= 0.75 ? 'B' : trustScore >= 0.6 ? 'C' : trustScore >= 0.4 ? 'D' : 'F',
    stats: {
      total: stats.total,
      successes: stats.successes,
      failures: stats.failures,
      successRate,
      manifestAligned: stats.manifest_aligned,
      manifestUnaligned: stats.manifest_unaligned,
      chainedAttestations: stats.chained,
      chainCoverage,
      totalCreditsSpent: round6(stats.total_credits_spent),
      avgDurationMs: Math.round(stats.avg_duration_ms || 0),
    },
    history: {
      firstAttestation: stats.first_attestation,
      lastAttestation: stats.last_attestation,
      ageDays: stats.first_attestation
        ? Math.floor((Date.now() - new Date(stats.first_attestation).getTime()) / 86400000)
        : 0,
    },
    activity: verdicts,
  });
});

// ─── POST /v1/attest/external — Attestation-as-a-Service ────────────────────
// Let external platforms (Dexter, PayAI, Cascade) use ClawNet's attestation
// system. Any x402-compatible platform can create signed, hash-chained
// attestations through ClawNet — making us the trust layer for the ecosystem.

attestRouter.post('/external', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo') as { key: string; isEnvKey?: boolean };
  const body = await c.req.json().catch(() => ({}));

  const schema = z.object({
    platform: z.string().min(1).max(100),
    actionType: z.string().min(1).max(100),
    actionEndpoint: z.string().max(500).optional(),
    inputHash: z.string().min(1).max(128),
    responseHash: z.string().max(128).optional(),
    outcomeStatus: z.enum(['success', 'failure', 'partial', 'unknown']).default('success'),
    creditsCharged: z.number().min(0).default(0),
    durationMs: z.number().min(0).optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.errors[0]?.message, code: 'INVALID_INPUT' }, 400);
  }

  const { platform, actionType, actionEndpoint, inputHash, responseHash, outcomeStatus, creditsCharged, durationMs } = parsed.data;

  // Rate limit: 100 external attestations per key per hour
  const rlKey = `rl:attest-ext:${keyInfo.key}`;
  const rlCount = await cacheIncr(rlKey, 3600);
  if (rlCount > 100) {
    return c.json({ error: 'Rate limit exceeded — max 100 external attestations per hour', code: 'RATE_LIMITED' }, 429);
  }

  // Deduct 0.1 credits per external attestation
  const cost = 0.1;
  if (!keyInfo.isEnvKey) {
    const deducted = deductCredit(keyInfo.key, cost);
    if (!deducted) {
      return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', creditsRequired: cost }, 402);
    }
    trackDelegatedSpend({ key: keyInfo.key } as Record<string, unknown>, cost);
  }

  try {
    const { createAttestation, hashApiKey } = await import('../db/attestations');
    const id = createAttestation({
      apiKeyHash: hashApiKey(keyInfo.key),
      attestationType: 'external',
      actionType: `${platform}/${actionType}`,
      actionEndpoint: actionEndpoint || `external/${platform}`,
      inputHash,
      responseHash: responseHash || undefined,
      outcomeStatus,
      creditsCharged,
      durationMs,
      actionDescription: `External attestation from ${platform}`,
    });

    logAudit({
      entityType: 'attestation', entityId: id,
      action: 'EXTERNAL_ATTEST', actorId: keyInfo.key,
      data: { platform, actionType },
    });

    return c.json({
      id,
      platform,
      verifyUrl: `/v1/attest/verify/${id}`,
      creditsCharged: cost,
    }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (msg.includes('Duplicate')) {
      return c.json({ error: 'Duplicate attestation — same input within 60s', code: 'DUPLICATE_ATTESTATION' }, 409);
    }
    return c.json({ error: 'Attestation creation failed', code: 'ATTESTATION_ERROR' }, 500);
  }
});

// ─── GET /v1/attest/compare — comparative trust (multi-agent) ────────────────
// Agents can compare trust profiles before choosing who to transact with.

attestRouter.get('/compare', (c) => {
  const agentsParam = c.req.query('agents');
  if (!agentsParam) {
    return c.json({ error: 'agents query param required (comma-separated apiKeyHashes)', code: 'INVALID_INPUT' }, 400);
  }

  const agents = agentsParam.split(',').map(a => a.trim()).filter(Boolean).slice(0, 10);
  if (agents.length < 2) {
    return c.json({ error: 'At least 2 agent hashes required for comparison', code: 'INVALID_INPUT' }, 400);
  }

  const profiles: Array<Record<string, unknown>> = [];
  for (const hash of agents) {
    const stats = getDb().prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN outcome_status = 'success' THEN 1 ELSE 0 END) as successes,
        SUM(CASE WHEN prev_attestation_hash IS NOT NULL THEN 1 ELSE 0 END) as chained,
        SUM(CASE WHEN manifest_aligned = 1 THEN 1 ELSE 0 END) as manifest_aligned,
        MIN(created_at) as first_attestation,
        MAX(created_at) as last_attestation,
        SUM(credits_charged) as total_credits
      FROM attestations WHERE api_key_hash = ?
    `).get(hash) as { total: number; successes: number; chained: number; manifest_aligned: number; first_attestation: string | null; last_attestation: string | null; total_credits: number } | undefined;

    const total = stats?.total || 0;
    const successRate = total > 0 ? round6((stats?.successes || 0) / total) : 0;
    const chainCoverage = total > 0 ? round6((stats?.chained || 0) / total) : 0;
    const volumeScore = Math.min(1, total / 1000);
    const trustScore = round6((successRate * 0.5) + (chainCoverage * 0.3) + (volumeScore * 0.2));

    profiles.push({
      apiKeyHash: hash,
      trustScore,
      trustGrade: trustScore >= 0.9 ? 'A' : trustScore >= 0.75 ? 'B' : trustScore >= 0.6 ? 'C' : trustScore >= 0.4 ? 'D' : 'F',
      totalAttestations: total,
      successRate,
      chainCoverage,
      manifestAligned: stats?.manifest_aligned || 0,
      totalCreditsSpent: round6(stats?.total_credits || 0),
      ageDays: stats?.first_attestation ? Math.floor((Date.now() - new Date(stats.first_attestation).getTime()) / 86400000) : 0,
    });
  }

  // Sort by trust score descending
  profiles.sort((a, b) => (b.trustScore as number) - (a.trustScore as number));

  return c.json({
    comparison: profiles,
    bestAgent: profiles[0]?.apiKeyHash,
    worstAgent: profiles[profiles.length - 1]?.apiKeyHash,
    spreadPct: profiles.length >= 2
      ? round6(((profiles[0].trustScore as number) - (profiles[profiles.length - 1].trustScore as number)) * 100)
      : 0,
  });
});

// ─── GET /v1/attest/badges/:skillId — trust badges for marketplace ──────────
// Returns trust badge data for a skill based on its attestation history.
// Marketplace can display these as visual trust indicators.

attestRouter.get('/badges/:skillId', (c) => {
  const { skillId } = c.req.param();

  const stats = getDb().prepare(`
    SELECT
      COUNT(*) as total_invocations,
      SUM(CASE WHEN outcome_status = 'success' THEN 1 ELSE 0 END) as successes,
      SUM(CASE WHEN prev_attestation_hash IS NOT NULL THEN 1 ELSE 0 END) as chained,
      AVG(duration_ms) as avg_duration,
      SUM(credits_charged) as total_credits
    FROM attestations
    WHERE action_endpoint LIKE ? AND created_at > datetime('now', '-90 days')
  `).get(`%${skillId}%`) as { total_invocations: number; successes: number; chained: number; avg_duration: number | null; total_credits: number } | undefined;

  const total = stats?.total_invocations || 0;
  const successRate = total > 0 ? round6((stats?.successes || 0) / total) : 0;

  // Determine badges
  const badges: Array<{ badge: string; label: string; color: string }> = [];

  if (total >= 100 && successRate >= 0.99) {
    badges.push({ badge: 'verified_reliable', label: 'Verified Reliable', color: '#10b981' });
  } else if (total >= 50 && successRate >= 0.95) {
    badges.push({ badge: 'trusted', label: 'Trusted', color: '#3b82f6' });
  } else if (total >= 10 && successRate >= 0.9) {
    badges.push({ badge: 'established', label: 'Established', color: '#8b5cf6' });
  }

  if ((stats?.chained || 0) >= 50) {
    badges.push({ badge: 'chain_verified', label: 'Chain Verified', color: '#f59e0b' });
  }

  if (total >= 500) {
    badges.push({ badge: 'high_volume', label: 'High Volume', color: '#06b6d4' });
  }

  if ((stats?.avg_duration || 0) < 500 && total >= 20) {
    badges.push({ badge: 'fast_responder', label: 'Fast Responder', color: '#ec4899' });
  }

  return c.json({
    skillId,
    badges,
    stats: {
      totalInvocations: total,
      successRate,
      chainedAttestations: stats?.chained || 0,
      avgDurationMs: Math.round(stats?.avg_duration || 0),
    },
  });
});
