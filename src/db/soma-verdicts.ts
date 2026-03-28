/**
 * Soma verdict storage — physics-based agent verification records.
 *
 * Verdicts come from external observers running soma-sense. Each verdict records
 * whether an agent's behavior matches its genome commitment (claimed model).
 *
 * Three tables:
 *   soma_verdicts        — individual verdict records (GREEN/AMBER/RED/UNCANNY)
 *   soma_verdict_stats   — per-agent aggregate statistics
 *   soma_verdict_anchors — Merkle roots anchored on-chain (Base via ERC-8004)
 */

import { getDb, logAudit } from './connection';
import { nanoid } from 'nanoid';

export interface SomaVerdict {
  id: string;
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
  hmacVerified: boolean;
  heartbeatChainValid: boolean;
  birthCertificatesValid: boolean;
  seedVerified: boolean;
  observerSignature: string;
  subjectSignature?: string;
  createdAt: string;
}

export interface SomaVerdictStats {
  subjectDid: string;
  totalVerdicts: number;
  greenCount: number;
  amberCount: number;
  redCount: number;
  uncannnyCount: number;
  uniqueObservers: number;
  avgConfidence: number;
  lastVerdict?: string;
  lastVerdictAt?: string;
}

export interface SomaVerdictAnchor {
  id: string;
  merkleRoot: string;
  verdictCount: number;
  solanaTxHash?: string;
  erc8004AgentId?: number;
  anchoredAt: string;
  status: 'pending' | 'anchored' | 'failed';
}

/** Record a new Soma verdict from an external observer. */
export function recordSomaVerdict(v: Omit<SomaVerdict, 'id' | 'createdAt'>): string {
  const id = `sv-${nanoid()}`;

  getDb().prepare(`
    INSERT INTO soma_verdicts (
      id, subject_did, observer_did, verdict, confidence, genome_hash,
      claimed_model, detected_model, session_id,
      temporal_score, topology_score, vocabulary_score,
      atlas_match, atlas_distance, drift_velocity,
      profile_maturity, observation_count,
      hmac_verified, heartbeat_chain_valid, birth_certificates_valid, seed_verified,
      observer_signature, subject_signature
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, v.subjectDid, v.observerDid, v.verdict, v.confidence, v.genomeHash,
    v.claimedModel ?? null, v.detectedModel ?? null, v.sessionId ?? null,
    v.temporalScore ?? null, v.topologyScore ?? null, v.vocabularyScore ?? null,
    v.atlasMatch ?? null, v.atlasDistance ?? null, v.driftVelocity ?? null,
    v.profileMaturity ?? null, v.observationCount ?? null,
    v.hmacVerified ? 1 : 0, v.heartbeatChainValid ? 1 : 0,
    v.birthCertificatesValid ? 1 : 0, v.seedVerified ? 1 : 0,
    v.observerSignature, v.subjectSignature ?? null,
  );

  // Update aggregate stats
  updateVerdictStats(v.subjectDid, v.verdict, v.confidence, v.observerDid);

  logAudit({
    entityType: 'soma_verdict', entityId: id, action: 'verdict_recorded',
    data: { subject: v.subjectDid, observer: v.observerDid, verdict: v.verdict, confidence: v.confidence },
  });

  return id;
}

/** Update per-agent aggregate statistics after a new verdict. */
function updateVerdictStats(subjectDid: string, verdict: string, confidence: number, observerDid: string): void {
  const verdictCol = verdict === 'GREEN' ? 'green_count'
    : verdict === 'AMBER' ? 'amber_count'
    : verdict === 'RED' ? 'red_count'
    : 'uncanny_count';

  // Upsert stats row
  getDb().prepare(`
    INSERT INTO soma_verdict_stats (subject_did, total_verdicts, ${verdictCol}, avg_confidence, last_verdict, last_verdict_at, unique_observers)
    VALUES (?, 1, 1, ?, ?, datetime('now'),
      (SELECT COUNT(DISTINCT observer_did) FROM soma_verdicts WHERE subject_did = ?))
    ON CONFLICT(subject_did) DO UPDATE SET
      total_verdicts = total_verdicts + 1,
      ${verdictCol} = ${verdictCol} + 1,
      avg_confidence = (avg_confidence * total_verdicts + ?) / (total_verdicts + 1),
      last_verdict = ?,
      last_verdict_at = datetime('now'),
      unique_observers = (SELECT COUNT(DISTINCT observer_did) FROM soma_verdicts WHERE subject_did = ?),
      updated_at = datetime('now')
  `).run(subjectDid, confidence, verdict, subjectDid, confidence, verdict, subjectDid);
}

/** Get verdict stats for a subject agent (the "credit bureau" query). */
export function getSomaVerdictStats(subjectDid: string): SomaVerdictStats | null {
  const row = getDb().prepare(`SELECT * FROM soma_verdict_stats WHERE subject_did = ?`).get(subjectDid) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    subjectDid: row.subject_did as string,
    totalVerdicts: row.total_verdicts as number,
    greenCount: row.green_count as number,
    amberCount: row.amber_count as number,
    redCount: row.red_count as number,
    uncannnyCount: row.uncanny_count as number,
    uniqueObservers: row.unique_observers as number,
    avgConfidence: row.avg_confidence as number,
    lastVerdict: row.last_verdict as string | undefined,
    lastVerdictAt: row.last_verdict_at as string | undefined,
  };
}

/** Get recent verdicts for a subject (for trust chain export). */
export function getRecentSomaVerdicts(subjectDid: string, limit = 50): SomaVerdict[] {
  const rows = getDb().prepare(`
    SELECT * FROM soma_verdicts WHERE subject_did = ? ORDER BY created_at DESC LIMIT ?
  `).all(subjectDid, limit) as Record<string, unknown>[];

  return rows.map(r => ({
    id: r.id as string,
    subjectDid: r.subject_did as string,
    observerDid: r.observer_did as string,
    verdict: r.verdict as SomaVerdict['verdict'],
    confidence: r.confidence as number,
    genomeHash: r.genome_hash as string,
    claimedModel: r.claimed_model as string | undefined,
    detectedModel: r.detected_model as string | undefined,
    sessionId: r.session_id as string | undefined,
    temporalScore: r.temporal_score as number | undefined,
    topologyScore: r.topology_score as number | undefined,
    vocabularyScore: r.vocabulary_score as number | undefined,
    atlasMatch: r.atlas_match as string | undefined,
    atlasDistance: r.atlas_distance as number | undefined,
    driftVelocity: r.drift_velocity as number | undefined,
    profileMaturity: r.profile_maturity as SomaVerdict['profileMaturity'],
    observationCount: r.observation_count as number | undefined,
    hmacVerified: !!(r.hmac_verified as number),
    heartbeatChainValid: !!(r.heartbeat_chain_valid as number),
    birthCertificatesValid: !!(r.birth_certificates_valid as number),
    seedVerified: !!(r.seed_verified as number),
    observerSignature: r.observer_signature as string,
    subjectSignature: r.subject_signature as string | undefined,
    createdAt: r.created_at as string,
  }));
}

/** Get unanchored verdicts for Merkle tree building. */
export function getUnanchoredVerdicts(limit = 1000): { id: string; verdict: string; subjectDid: string; observerDid: string; confidence: number; createdAt: string }[] {
  const rows = getDb().prepare(`
    SELECT id, verdict, subject_did, observer_did, confidence, created_at
    FROM soma_verdicts
    WHERE anchor_id IS NULL
    ORDER BY created_at ASC
    LIMIT ?
  `).all(limit) as { id: string; verdict: string; subject_did: string; observer_did: string; confidence: number; created_at: string }[];
  return rows.map(r => ({ id: r.id, verdict: r.verdict, subjectDid: r.subject_did, observerDid: r.observer_did, confidence: r.confidence, createdAt: r.created_at }));
}

/** Mark verdicts as anchored after Merkle root is on-chain. */
export function markVerdictsAnchored(verdictIds: string[], anchorId: string): void {
  const stmt = getDb().prepare(`UPDATE soma_verdicts SET anchor_id = ?, anchored_at = datetime('now') WHERE id = ?`);
  getDb().transaction(() => {
    for (const id of verdictIds) {
      stmt.run(anchorId, id);
    }
  })();
}

/** Create a new anchor record (pending on-chain confirmation). */
export function createVerdictAnchor(merkleRoot: string, verdictCount: number, treeJson: string): string {
  const id = `sa-${nanoid()}`;
  getDb().prepare(`
    INSERT INTO soma_verdict_anchors (id, merkle_root, verdict_count, tree_json) VALUES (?, ?, ?, ?)
  `).run(id, merkleRoot, verdictCount, treeJson);
  return id;
}

/** Update anchor with on-chain transaction hash. */
export function confirmVerdictAnchor(anchorId: string, solanaTxHash: string): void {
  getDb().prepare(`
    UPDATE soma_verdict_anchors SET solana_tx_hash = ?, status = 'anchored' WHERE id = ?
  `).run(solanaTxHash, anchorId);
}

/** Get anchor by ID (for verification). */
export function getVerdictAnchor(anchorId: string): SomaVerdictAnchor | null {
  const row = getDb().prepare(`SELECT * FROM soma_verdict_anchors WHERE id = ?`).get(anchorId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    merkleRoot: row.merkle_root as string,
    verdictCount: row.verdict_count as number,
    solanaTxHash: row.solana_tx_hash as string | undefined,
    erc8004AgentId: row.erc8004_agent_id as number | undefined,
    anchoredAt: row.anchored_at as string,
    status: row.status as SomaVerdictAnchor['status'],
  };
}
