/**
 * Soma Verification Routes
 *
 * Public API for Soma verdict infrastructure:
 *   POST /v1/soma/verdicts          — Submit a verdict (observer submits, signed)
 *   GET  /v1/soma/:did/trust        — Public trust query ("credit bureau" endpoint)
 *   GET  /v1/soma/:did/verdicts     — Recent verdicts for an agent
 *   GET  /v1/soma/:did/export       — Portable trust chain with Merkle proofs
 *   GET  /v1/soma/anchors/:id       — Anchor details (on-chain tx hash, tree)
 */

import { Hono } from 'hono';
import {
  recordSomaVerdict,
  getSomaVerdictStats,
  getRecentSomaVerdicts,
  getVerdictAnchor,
} from '../db/soma-verdicts';
import { buildMerkleTree, getMerkleProof } from '../core/merkle-anchor';
import { aidHash } from '../utils/crypto-agility';
import { getHeartSafe } from '../core/soma';
import { getEd25519PublicKeyRaw } from '../utils/ed25519-signer';
import { logger } from '../utils/logger';

const router = new Hono();

// ── POST /verdicts — Submit a Soma verdict ──────────────────────────────────
// External observers running soma-sense submit their verification results here.
// The observer signs the verdict with their Ed25519 key.
router.post('/verdicts', async (c) => {
  const body = await c.req.json<{
    subjectDid: string;
    observerDid: string;
    verdict: 'GREEN' | 'AMBER' | 'RED' | 'UNCANNY';
    confidence: number;
    genomeHash: string;
    claimedModel?: string;
    detectedModel?: string;
    sessionId?: string;
    temporalScore?: number;
    topologyScore?: number;
    vocabularyScore?: number;
    atlasMatch?: string;
    atlasDistance?: number;
    driftVelocity?: number;
    profileMaturity?: 'embryonic' | 'juvenile' | 'adult' | 'elder';
    observationCount?: number;
    hmacVerified?: boolean;
    heartbeatChainValid?: boolean;
    birthCertificatesValid?: boolean;
    seedVerified?: boolean;
    observerSignature: string;
    subjectSignature?: string;
  }>();

  // Validate required fields
  if (!body.subjectDid || !body.observerDid || !body.verdict || body.confidence == null || !body.genomeHash || !body.observerSignature) {
    return c.json({ error: 'Missing required fields: subjectDid, observerDid, verdict, confidence, genomeHash, observerSignature', code: 'MISSING_FIELDS' }, 400);
  }

  if (!['GREEN', 'AMBER', 'RED', 'UNCANNY'].includes(body.verdict)) {
    return c.json({ error: 'verdict must be GREEN, AMBER, RED, or UNCANNY', code: 'INVALID_VERDICT' }, 400);
  }

  if (body.confidence < 0 || body.confidence > 1) {
    return c.json({ error: 'confidence must be between 0 and 1', code: 'INVALID_CONFIDENCE' }, 400);
  }

  // Self-verdicts are not allowed (observer must be different from subject)
  if (body.subjectDid === body.observerDid) {
    return c.json({ error: 'Self-verification is not allowed — observer must be a different party', code: 'SELF_VERDICT' }, 400);
  }

  try {
    const id = recordSomaVerdict({
      subjectDid: body.subjectDid,
      observerDid: body.observerDid,
      verdict: body.verdict,
      confidence: body.confidence,
      genomeHash: body.genomeHash,
      claimedModel: body.claimedModel,
      detectedModel: body.detectedModel,
      sessionId: body.sessionId,
      temporalScore: body.temporalScore,
      topologyScore: body.topologyScore,
      vocabularyScore: body.vocabularyScore,
      atlasMatch: body.atlasMatch,
      atlasDistance: body.atlasDistance,
      driftVelocity: body.driftVelocity,
      profileMaturity: body.profileMaturity,
      observationCount: body.observationCount,
      hmacVerified: body.hmacVerified ?? false,
      heartbeatChainValid: body.heartbeatChainValid ?? false,
      birthCertificatesValid: body.birthCertificatesValid ?? false,
      seedVerified: body.seedVerified ?? false,
      observerSignature: body.observerSignature,
      subjectSignature: body.subjectSignature,
    });

    return c.json({ ok: true, verdictId: id });
  } catch (err) {
    logger.error({ err }, 'Failed to record Soma verdict');
    return c.json({ error: 'Failed to record verdict', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ── GET /:did/trust — Public trust query (the "credit bureau" endpoint) ─────
// Free, no auth, rate-limited. Returns verdict summary, not raw data.
// This is the Soma replacement for AID's /v1/aid/:did/trust endpoint.
router.get('/:did/trust', (c) => {
  const did = c.req.param('did');
  const stats = getSomaVerdictStats(did);

  if (!stats) {
    return c.json({
      did,
      status: 'unknown',
      message: 'No Soma verification history found for this agent',
      totalVerdicts: 0,
    });
  }

  // Compute trust verdict from stats
  const greenRate = stats.totalVerdicts > 0 ? stats.greenCount / stats.totalVerdicts : 0;
  const trustStatus = greenRate >= 0.9 && stats.totalVerdicts >= 10 ? 'verified'
    : greenRate >= 0.7 && stats.totalVerdicts >= 5 ? 'likely-genuine'
    : greenRate >= 0.5 ? 'mixed'
    : stats.redCount > 0 ? 'suspicious'
    : 'insufficient-data';

  return c.json({
    did,
    status: trustStatus,
    verification: {
      totalVerdicts: stats.totalVerdicts,
      greenRate: Math.round(greenRate * 100),
      uniqueObservers: stats.uniqueObservers,
      avgConfidence: Math.round(stats.avgConfidence * 100) / 100,
      lastVerdict: stats.lastVerdict,
      lastVerdictAt: stats.lastVerdictAt,
    },
    breakdown: {
      green: stats.greenCount,
      amber: stats.amberCount,
      red: stats.redCount,
      uncanny: stats.uncannnyCount,
    },
    protocol: 'soma',
    provenanceType: 'behavioral-verification',
    note: 'Verdicts are from independent soma-sense observers. GREEN = behavior matches genome commitment.',
  });
});

// ── GET /:did/verdicts — Recent verdicts for an agent ───────────────────────
router.get('/:did/verdicts', (c) => {
  const did = c.req.param('did');
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
  const verdicts = getRecentSomaVerdicts(did, limit);

  return c.json({
    did,
    count: verdicts.length,
    verdicts: verdicts.map(v => ({
      id: v.id,
      observerDid: v.observerDid,
      verdict: v.verdict,
      confidence: v.confidence,
      claimedModel: v.claimedModel,
      detectedModel: v.detectedModel,
      hmacVerified: v.hmacVerified,
      heartbeatChainValid: v.heartbeatChainValid,
      seedVerified: v.seedVerified,
      profileMaturity: v.profileMaturity,
      createdAt: v.createdAt,
    })),
  });
});

// ── GET /:did/export — Portable trust chain with Merkle proofs ──────────────
// Callers can export an agent's verification history for offline verification.
router.get('/:did/export', (c) => {
  const did = c.req.param('did');
  const stats = getSomaVerdictStats(did);
  const verdicts = getRecentSomaVerdicts(did, 100);

  if (!stats || verdicts.length === 0) {
    return c.json({ error: 'No Soma verification history found', code: 'NO_HISTORY' }, 404);
  }

  // Build Merkle tree from verdict hashes for portable proofs
  const verdictHashes = verdicts.map(v =>
    aidHash(`${v.id}|${v.subjectDid}|${v.observerDid}|${v.verdict}|${v.confidence}|${v.createdAt}`)
  );
  const { root, tree } = buildMerkleTree(verdictHashes);

  // Generate per-verdict Merkle proofs
  const verdictsWithProofs = verdicts.map((v, i) => ({
    id: v.id,
    observerDid: v.observerDid,
    verdict: v.verdict,
    confidence: v.confidence,
    genomeHash: v.genomeHash,
    claimedModel: v.claimedModel,
    hmacVerified: v.hmacVerified,
    heartbeatChainValid: v.heartbeatChainValid,
    seedVerified: v.seedVerified,
    createdAt: v.createdAt,
    observerSignature: v.observerSignature,
    merkleProof: getMerkleProof(verdictHashes[i], tree),
  }));

  const heart = getHeartSafe();

  return c.json({
    did,
    protocol: 'soma',
    exportedAt: new Date().toISOString(),
    merkleRoot: root,
    stats: {
      totalVerdicts: stats.totalVerdicts,
      greenCount: stats.greenCount,
      amberCount: stats.amberCount,
      redCount: stats.redCount,
      uncannnyCount: stats.uncannnyCount,
      uniqueObservers: stats.uniqueObservers,
      avgConfidence: stats.avgConfidence,
    },
    verdicts: verdictsWithProofs,
    platformIdentity: {
      did: 'did:web:api.claw-net.org',
      somaDid: heart?.did ?? null,
      publicKey: getEd25519PublicKeyRaw().toString('hex'),
    },
  });
});

// ── GET /anchors/:id — Anchor details ───────────────────────────────────────
router.get('/anchors/:id', (c) => {
  const id = c.req.param('id');
  const anchor = getVerdictAnchor(id);

  if (!anchor) {
    return c.json({ error: 'Anchor not found', code: 'NOT_FOUND' }, 404);
  }

  return c.json({
    ...anchor,
    protocol: 'soma-verdict-anchor',
    chain: 'solana',
    ...(anchor.solanaTxHash && {
      explorer: `https://explorer.solana.com/tx/${anchor.solanaTxHash}`,
    }),
  });
});

export { router as somaRouter };
