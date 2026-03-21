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
