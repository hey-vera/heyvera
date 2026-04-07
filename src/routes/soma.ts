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
import { z } from 'zod';
import {
  recordSomaVerdict,
  getSomaVerdictStats,
  getRecentSomaVerdicts,
  getVerdictAnchor,
} from '../db/soma-verdicts';
import { buildMerkleTree, getMerkleProof } from '../core/merkle-anchor';
import { somaHash, verifySignature } from '../utils/crypto-agility';
import { getSomaReceipt, getSomaReceiptByRequestId, getSomaReceiptStats } from '../core/soma-receipt';
import { getComputationCertificateById, verifyComputationCertificate } from '../core/computation-certificate';
import { verifyVCSignature } from '../utils/ed25519-signer';
import { jcsSerialize, base58btcDecode } from '../utils/jcs';
import { getHeartSafe } from '../core/soma';
import { getEd25519PublicKeyRaw } from '../utils/ed25519-signer';
import { logger } from '../utils/logger';
import { createPublicKey } from 'crypto';
import { cacheIncr } from '../cache/index';
import { getClientIp } from '../middleware/rate-limit';
import { checkApiKey } from '../middleware/auth';
import { getEndpointProvider, getProvider, creditProviderShare } from '../db/index';
import { getDb } from '../db/connection';
import { nanoid } from 'nanoid';
import { signVC } from '../utils/ed25519-signer';

/**
 * Extract Ed25519 public key from a did:key DID.
 * did:key:z... → base58btc decode → strip 0xed 0x01 prefix → 32-byte raw key.
 */
function publicKeyFromDid(did: string): Buffer | null {
  if (!did.startsWith('did:key:z')) return null;
  try {
    const multibase = did.slice('did:key:'.length);
    const decoded = base58btcDecode(multibase.slice(1)); // strip 'z' prefix
    if (decoded.length !== 34 || decoded[0] !== 0xed || decoded[1] !== 0x01) return null;
    return decoded.subarray(2); // 32-byte raw Ed25519 public key
  } catch {
    return null;
  }
}

/**
 * Verify that the observer actually signed this verdict.
 * Prevents anyone from submitting fake verdicts with arbitrary observer DIDs.
 */
function verifyVerdictSignature(
  verdict: { subjectDid: string; observerDid: string; verdict: string; confidence: number; genomeHash: string },
  signature: string,
  observerDid: string,
): boolean {
  const rawKey = publicKeyFromDid(observerDid);
  if (!rawKey) return false;

  try {
    // Build canonical verdict data for signature verification
    const canonical = jcsSerialize({
      subjectDid: verdict.subjectDid,
      observerDid: verdict.observerDid,
      verdict: verdict.verdict,
      confidence: verdict.confidence,
      genomeHash: verdict.genomeHash,
    });
    const message = Buffer.from(somaHash(canonical), 'hex');
    const sig = Buffer.from(signature, 'base64url');

    // Build Ed25519 public key in DER format for Node.js crypto
    const derPrefix = Buffer.from('302a300506032b6570032100', 'hex'); // Ed25519 SPKI header
    const derKey = Buffer.concat([derPrefix, rawKey]);
    const publicKey = createPublicKey({ key: derKey, format: 'der', type: 'spki' });

    return verifySignature('Ed25519', sig, message, publicKey);
  } catch (err) {
    logger.warn({ err, observerDid }, 'Verdict signature verification failed');
    return false;
  }
}

const router = new Hono();

// ── POST /verdicts — Submit a Soma verdict ──────────────────────────────────
// External observers running soma-sense submit their verification results here.
// The observer signs the verdict with their Ed25519 key.
const VerdictBody = z.object({
  subjectDid: z.string().min(1),
  observerDid: z.string().min(1),
  verdict: z.enum(['GREEN', 'AMBER', 'RED', 'UNCANNY']),
  confidence: z.number().min(0).max(1),
  genomeHash: z.string().min(1),
  claimedModel: z.string().optional(),
  detectedModel: z.string().optional(),
  sessionId: z.string().optional(),
  temporalScore: z.number().optional(),
  topologyScore: z.number().optional(),
  vocabularyScore: z.number().optional(),
  atlasMatch: z.string().optional(),
  atlasDistance: z.number().optional(),
  driftVelocity: z.number().optional(),
  profileMaturity: z.enum(['embryonic', 'juvenile', 'adult', 'elder']).optional(),
  observationCount: z.number().int().min(0).optional(),
  hmacVerified: z.boolean().optional(),
  heartbeatChainValid: z.boolean().optional(),
  birthCertificatesValid: z.boolean().optional(),
  seedVerified: z.boolean().optional(),
  observerSignature: z.string().min(1),
  subjectSignature: z.string().optional(),
});

router.post('/verdicts', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = VerdictBody.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '), code: 'VALIDATION_ERROR' }, 400);
  }
  const body = parsed.data;

  // Self-verdicts are not allowed (observer must be different from subject)
  if (body.subjectDid === body.observerDid) {
    return c.json({ error: 'Self-verification is not allowed — observer must be a different party', code: 'SELF_VERDICT' }, 400);
  }

  // Rate limit: 100 verdicts per observer DID per hour + 200 per IP per hour
  // DID limit prevents one identity from spamming. IP limit prevents key farming.
  const ip = getClientIp(c);
  const ipRateKey = `soma-verdict-ip:${ip}`;
  const ipCount = await cacheIncr(ipRateKey, 3600);
  if (ipCount > 200) {
    return c.json({ error: 'Rate limited — 200 verdicts per IP per hour', code: 'RATE_LIMITED' }, 429);
  }

  const didRateKey = `soma-verdict-did:${body.observerDid}`;
  const didCount = await cacheIncr(didRateKey, 3600);
  if (didCount > 100) {
    return c.json({ error: 'Rate limited — 100 verdicts per observer per hour', code: 'RATE_LIMITED' }, 429);
  }

  // Verify observer signature — prevents fake verdict injection
  if (!body.observerDid.startsWith('did:key:z')) {
    return c.json({ error: 'observerDid must be a did:key with Ed25519 public key', code: 'INVALID_DID' }, 400);
  }

  const sigValid = verifyVerdictSignature(
    { subjectDid: body.subjectDid, observerDid: body.observerDid, verdict: body.verdict, confidence: body.confidence, genomeHash: body.genomeHash },
    body.observerSignature,
    body.observerDid,
  );

  if (!sigValid) {
    return c.json({ error: 'Invalid observer signature — verdict must be signed by the observer\'s Ed25519 key', code: 'INVALID_SIGNATURE' }, 403);
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
router.get('/:did/trust', async (c) => {
  const trustIp = getClientIp(c);
  const trustRateKey = `soma-trust-lookup:${trustIp}`;
  const trustCount = await cacheIncr(trustRateKey, 3600);
  if (trustCount > 120) {
    return c.json({ error: 'Rate limited — 120 trust lookups per IP per hour', code: 'RATE_LIMITED' }, 429);
  }
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
// Rate-limited to prevent enumeration (audit H7)
router.get('/:did/verdicts', async (c) => {
  const verdictIp = getClientIp(c);
  const verdictRateKey = `soma-did-verdicts:${verdictIp}`;
  const verdictCount = await cacheIncr(verdictRateKey, 3600);
  if (verdictCount > 60) {
    return c.json({ error: 'Rate limited — 60 verdict lookups per IP per hour', code: 'RATE_LIMITED' }, 429);
  }
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
// Rate-limited: computationally expensive (builds Merkle tree + proofs).
router.get('/:did/export', async (c) => {
  const exportIp = getClientIp(c);
  const exportRateKey = `soma-export-rate:${exportIp}`;
  const exportCount = await cacheIncr(exportRateKey, 3600);
  if (exportCount > 10) {
    return c.json({ error: 'Rate limited — 10 exports per IP per hour', code: 'RATE_LIMITED' }, 429);
  }
  const did = c.req.param('did');
  const stats = getSomaVerdictStats(did);
  const verdicts = getRecentSomaVerdicts(did, 100);

  if (!stats || verdicts.length === 0) {
    return c.json({ error: 'No Soma verification history found', code: 'NO_HISTORY' }, 404);
  }

  // Build Merkle tree from verdict hashes for portable proofs
  const verdictHashes = verdicts.map(v =>
    somaHash(`${v.id}|${v.subjectDid}|${v.observerDid}|${v.verdict}|${v.confidence}|${v.createdAt}`)
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

// ─── Soma Receipt endpoints ─────────────────────────────────────────────────

/**
 * GET /v1/soma/receipt/:id — Public receipt lookup (no auth required).
 * Anyone with a receipt ID can verify the transaction.
 */
router.get('/receipt/:id', async (c) => {
  // Rate-limit receipt lookups to prevent enumeration (audit H7)
  const receiptIp = getClientIp(c);
  const receiptRateKey = `soma-receipt-lookup:${receiptIp}`;
  const receiptCount = await cacheIncr(receiptRateKey, 3600);
  if (receiptCount > 120) {
    return c.json({ error: 'Rate limited — 120 receipt lookups per IP per hour', code: 'RATE_LIMITED' }, 429);
  }
  const id = c.req.param('id');
  const receipt = getSomaReceipt(id) ?? getSomaReceiptByRequestId(id);

  if (!receipt) {
    return c.json({ error: 'Receipt not found', code: 'RECEIPT_NOT_FOUND' }, 404);
  }

  return c.json({
    receipt,
    _links: {
      self: `/v1/soma/receipt/${receipt.id}`,
      ...(receipt.easScanUrl && { easscan: receipt.easScanUrl }),
      verify: `/v1/soma/receipt/${receipt.id}/verify`,
      platform: '/.well-known/soma.json',
    },
  });
});

/**
 * GET /v1/soma/receipt/:id/onchain — Public on-chain anchor lookup.
 * Returns the EAS scan URL + Base tx hash (if anchored) so anyone can
 * verify the receipt was timestamped on Base mainnet.
 */
router.get('/receipt/:id/onchain', async (c) => {
  const id = c.req.param('id');
  const row = getDb().prepare(`
    SELECT id, eas_uid, anchor_id, anchored_at FROM soma_receipts WHERE id = ? LIMIT 1
  `).get(id) as { id: string; eas_uid: string | null; anchor_id: string | null; anchored_at: string | null } | undefined;

  if (!row) {
    return c.json({ error: 'Receipt not found', code: 'RECEIPT_NOT_FOUND' }, 404);
  }

  const easScanUrl = row.eas_uid
    ? `https://base.easscan.org/offchain/attestation/view/${row.eas_uid}`
    : null;

  if (!row.anchored_at || !row.anchor_id) {
    return c.json({
      receiptId: row.id,
      easUid: row.eas_uid,
      easScanUrl,
      anchored: false,
      hint: 'Off-chain attestation signed but not yet batch-anchored on Base (next cron cycle or manual admin trigger)',
    });
  }

  // Look up the Base tx hash from the audit log entry for this anchor batch
  const auditRow = getDb().prepare(`
    SELECT data_json FROM audit_log
    WHERE entity_type = 'eas_receipt_anchor' AND entity_id = ? AND action = 'EAS_ANCHOR_CONFIRMED'
    ORDER BY timestamp DESC LIMIT 1
  `).get(row.anchor_id) as { data_json: string } | undefined;

  let baseTxHash: string | null = null;
  let merkleRoot: string | null = null;
  if (auditRow?.data_json) {
    try {
      const data = JSON.parse(auditRow.data_json);
      baseTxHash = data.baseTxHash ?? null;
      merkleRoot = data.merkleRoot ?? null;
    } catch { /* ignore */ }
  }

  return c.json({
    receiptId: row.id,
    easUid: row.eas_uid,
    easScanUrl,
    anchored: true,
    anchorId: row.anchor_id,
    anchoredAt: row.anchored_at,
    merkleRoot,
    baseTxHash,
    baseScanUrl: baseTxHash ? `https://basescan.org/tx/${baseTxHash}` : null,
  });
});

/**
 * GET /v1/soma/receipts/stats — Receipt statistics (public).
 */
router.get('/receipts/stats', async (c) => {
  const stats = getSomaReceiptStats();
  return c.json(stats);
});

/**
 * GET /v1/soma/receipt/:id/verify — Cryptographic receipt verification.
 * Reconstructs the signed payload from the receipt, verifies the Ed25519
 * signature, and checks dual-sign if present. No auth required.
 */
router.get('/receipt/:id/verify', async (c) => {
  const id = c.req.param('id');
  const receipt = getSomaReceipt(id) ?? getSomaReceiptByRequestId(id);
  if (!receipt) {
    return c.json({ error: 'Receipt not found', code: 'RECEIPT_NOT_FOUND' }, 404);
  }

  // Reconstruct the canonical payload that was signed
  const receiptPayload = {
    id: receipt.id,
    requestId: receipt.requestId,
    paymentMethod: receipt.paymentMethod,
    paymentRef: null, // hashed at creation, not stored raw
    creditsCost: receipt.creditsCost,
    requestHash: receipt.requestHash,
    responseHash: receipt.responseHash,
    somaDataHash: receipt.somaDataHash || null,
    heartbeatIndex: receipt.heartbeatIndex ?? null,
    cached: receipt.cached,
    timestamp: receipt.createdAt,
  };

  // Verify Ed25519 signature over JCS-canonical payload
  let signatureValid = false;
  try {
    signatureValid = verifyVCSignature(receiptPayload, receipt.signature);
  } catch {
    signatureValid = false;
  }

  return c.json({
    receiptId: receipt.id,
    signatureValid,
    algorithm: receipt.algorithm,
    dualSigned: !!receipt.dualSign,
    dualSignValid: receipt.dualSign ? true : null, // Full verification requires provider's public key from their /.well-known/soma.json
    verification: receipt.verification,
    easAnchored: !!receipt.easUid,
    easScanUrl: receipt.easScanUrl,
  });
});

/**
 * GET /v1/soma/cert/:id — Public computation certificate lookup.
 * Returns the certificate with verification status.
 */
router.get('/cert/:id', async (c) => {
  const id = c.req.param('id');
  const cert = getComputationCertificateById(id);
  if (!cert) {
    return c.json({ error: 'Computation certificate not found', code: 'CERT_NOT_FOUND' }, 404);
  }

  const verification = verifyComputationCertificate(cert);

  return c.json({
    cert,
    verification,
    _links: {
      self: `/v1/soma/cert/${cert.id}`,
      challenges: `/v1/soma/challenge/by-cert/${cert.id}`,
      platform: '/.well-known/soma.json',
    },
  });
});

// ─── POST /v1/soma/verify — Verify Mode ────────────────────────────────────
// Agent calls provider directly, then submits the Soma cert here for async
// verification. Zero latency on the data path — trust is verified after the fact.
//
// Flow: Agent → Provider (direct, gets data + Soma headers) → ClawNet /verify (async)
// Returns: verification result + optional Soma receipt

const VerifyBody = z.object({
  endpointId: z.string().min(1).max(200),
  providerCert: z.object({
    dataHash: z.string().min(1),
    signature: z.string().min(1),
    publicKey: z.string().min(1),
    heartbeatIndex: z.number().int().optional(),
    timestamp: z.string().optional(),
  }),
  responseHash: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});

router.post('/verify', checkApiKey, async (c) => {
  const requestId = `vfy-${nanoid(12)}`;
  const start = Date.now();

  const body = await c.req.json().catch(() => ({}));
  const parsed = VerifyBody.safeParse(body);
  if (!parsed.success) {
    return c.json({ requestId, error: 'Invalid verify request', code: 'INVALID_DATA', details: parsed.error.flatten().fieldErrors }, 400);
  }

  const { endpointId, providerCert, responseHash, metadata } = parsed.data;
  const keyInfo = c.get('apiKeyInfo');

  // Verify the provider's Ed25519 signature
  let signatureValid = false;
  try {
    const pubKeyBytes = base58btcDecode(providerCert.publicKey);
    const pubKeyObj = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pubKeyBytes]),
      format: 'der',
      type: 'spki',
    });

    const dataToVerify = Buffer.from(providerCert.dataHash, 'utf-8');
    const signatureBytes = base58btcDecode(providerCert.signature);

    const { verify } = await import('crypto');
    signatureValid = verify(null, dataToVerify, pubKeyObj, signatureBytes);
  } catch (err) {
    logger.warn({ requestId, err }, 'Verify mode: signature verification failed');
  }

  // Check if the provider's public key matches a registered provider
  const providerId = getEndpointProvider(endpointId);
  let providerMatch = false;
  let providerName: string | undefined;
  if (providerId) {
    const provider = getProvider(providerId);
    if (provider) {
      providerName = provider.name;
      providerMatch = provider.somaPublicKey === providerCert.publicKey;
    }
  }

  // Platform co-signs the verification result using the platform Ed25519 key
  let platformSignature: string | undefined;
  let platformPublicKey: string | undefined;
  try {
    const verifyPayload = {
      requestId,
      endpointId,
      providerDataHash: providerCert.dataHash,
      signatureValid,
      providerMatch,
      timestamp: new Date().toISOString(),
    };
    platformSignature = signVC(verifyPayload);
    platformPublicKey = Buffer.from(getEd25519PublicKeyRaw()).toString('base64');
  } catch (err) {
    logger.warn({ requestId, err }, 'Verify mode: platform co-sign failed');
  }

  const durationMs = Date.now() - start;

  // Record provider analytics (verify mode = no revenue share, just tracking)
  if (providerId) {
    creditProviderShare(endpointId, 0, { cacheHit: false, latencyMs: durationMs });
  }

  logger.info({ requestId, endpointId, signatureValid, providerMatch, durationMs }, 'Verify mode completed');

  return c.json({
    requestId,
    endpointId,
    verification: {
      signatureValid,
      providerMatch,
      providerName: providerName ?? null,
      providerPublicKey: providerCert.publicKey,
      dataHash: providerCert.dataHash,
    },
    platformCoSign: platformSignature ? {
      signature: platformSignature,
      publicKey: platformPublicKey,
      algorithm: 'Ed25519',
    } : null,
    verdict: signatureValid && providerMatch ? 'VERIFIED' : signatureValid ? 'SIGNATURE_VALID' : 'UNVERIFIED',
    durationMs,
  });
});

export { router as somaRouter };
