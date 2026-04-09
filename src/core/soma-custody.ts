/**
 * soma-custody.ts — Soma Data Custody Protocol
 *
 * Cryptographic proof that agents handle custodied data honestly:
 *   - Accept: agent commits to custody with DEK fingerprint in pulse tree
 *   - Access: every data access logged as tamper-evident leaf
 *   - Release: DEK destroyed, destruction proof on-chain, data irrecoverable
 *
 * Agents encrypt user data with per-subject DEKs (envelope encryption).
 * ClawNet never sees the DEK or plaintext — only fingerprints and proofs.
 * The custody chain lives in the agent's pulse tree, anchored on-chain
 * via EAS + Groth16 like all other Soma leaves.
 *
 * This is a Soma protocol primitive — any agent can use it.
 */

import { nanoid } from 'nanoid';
import { getDb, logAudit } from '../db/connection';
import { somaHash, somaHashJson } from '../utils/crypto-agility';
import { appendCustody } from './soma-heartbeat';
import { logger } from '../utils/logger';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CustodyAcceptResult {
  custodyId: string;
  agentDid: string;
  subjectId: string;
  dekFingerprint: string;
  heartbeatIndex: number;
  pulseRoot: string;
}

export interface CustodyAccessResult {
  eventId: string;
  agentDid: string;
  subjectId: string;
  heartbeatIndex: number;
}

export interface CustodyReleaseResult {
  agentDid: string;
  subjectId: string;
  destructionProof: string;
  heartbeatIndex: number;
  pulseRoot: string;
  totalAccesses: number;
  custodyDurationHours: number;
}

export interface CustodyChainEntry {
  id: string;
  eventType: 'accept' | 'access' | 'release';
  dekFingerprint: string | null;
  destructionProof: string | null;
  fieldsAccessed: string[] | null;
  accessReason: string | null;
  pulseLeafIndex: number;
  createdAt: string;
}

export interface CustodyStatus {
  agentDid: string;
  subjectId: string;
  status: 'active' | 'released' | 'none';
  dekFingerprint: string | null;
  acceptedAt: string | null;
  releasedAt: string | null;
  totalAccesses: number;
  lastAccessAt: string | null;
  destructionProof: string | null;
  chain: CustodyChainEntry[];
}

// ─── Accept Custody ─────────────────────────────────────────────────────────

/**
 * Agent commits to custodying a subject's data.
 * The DEK fingerprint (hash of the encryption key) is recorded — NOT the key itself.
 * This proves: "I accepted custody of this data, encrypted with this key."
 *
 * @param agentDid - The custodying agent's DID
 * @param subjectId - Identifier for the data subject (user/tenant)
 * @param dekFingerprint - H(DEK) — proves which key encrypts the data
 * @param fieldsManifest - What fields are being custodied (for audit)
 */
export function acceptCustody(
  agentDid: string,
  subjectId: string,
  dekFingerprint: string,
  fieldsManifest?: string[],
): CustodyAcceptResult {
  const custodyId = `cst-${nanoid(16)}`;

  // Check for existing active custody
  const existing = getDb().prepare(
    "SELECT id FROM custody_events WHERE agent_did = ? AND subject_id = ? AND event_type = 'accept' AND NOT EXISTS (SELECT 1 FROM custody_events c2 WHERE c2.agent_did = custody_events.agent_did AND c2.subject_id = custody_events.subject_id AND c2.event_type = 'release' AND c2.created_at > custody_events.created_at)"
  ).get(agentDid, subjectId) as { id: string } | undefined;

  if (existing) {
    throw new Error('Active custody already exists for this subject — release first');
  }

  // Append CUSTODY leaf to agent's pulse tree
  const result = appendCustody(agentDid, {
    event: 'accept',
    subjectId: somaHash(subjectId), // hash subject ID in the tree (privacy)
    dekFingerprint,
  });

  // Record in custody_events table
  getDb().prepare(`
    INSERT INTO custody_events (id, agent_did, subject_id, event_type, dek_fingerprint,
      fields_manifest_json, pulse_leaf_index, created_at)
    VALUES (?, ?, ?, 'accept', ?, ?, ?, datetime('now'))
  `).run(
    custodyId,
    agentDid,
    subjectId,
    dekFingerprint,
    fieldsManifest ? JSON.stringify(fieldsManifest) : null,
    result.heartbeatIndex,
  );

  logAudit({
    entityType: 'custody',
    entityId: custodyId,
    action: 'custody_accepted',
    actorId: agentDid,
    data: { subjectId: somaHash(subjectId), dekFingerprint },
  });

  logger.info({ agentDid, subjectId: somaHash(subjectId), custodyId }, 'Data custody accepted');

  return {
    custodyId,
    agentDid,
    subjectId,
    dekFingerprint,
    heartbeatIndex: result.heartbeatIndex,
    pulseRoot: result.root,
  };
}

// ─── Log Access ─────────────────────────────────────────────────────────────

/**
 * Log a data access event. Every time an agent reads custodied data,
 * it records a CUSTODY leaf. This creates a tamper-evident audit trail.
 *
 * @param agentDid - The custodying agent's DID
 * @param subjectId - Whose data was accessed
 * @param reason - Why the data was accessed (e.g., 'scheduled-post', 'content-gen')
 * @param fieldsAccessed - Which fields were read (for granular audit)
 */
export function logCustodyAccess(
  agentDid: string,
  subjectId: string,
  reason: string,
  fieldsAccessed?: string[],
): CustodyAccessResult {
  const eventId = `csa-${nanoid(16)}`;

  // Append CUSTODY leaf
  const result = appendCustody(agentDid, {
    event: 'access',
    subjectId: somaHash(subjectId),
    fieldsAccessed,
    reason,
  });

  // Record in custody_events table
  getDb().prepare(`
    INSERT INTO custody_events (id, agent_did, subject_id, event_type,
      fields_accessed_json, access_reason, pulse_leaf_index, created_at)
    VALUES (?, ?, ?, 'access', ?, ?, ?, datetime('now'))
  `).run(
    eventId,
    agentDid,
    subjectId,
    fieldsAccessed ? JSON.stringify(fieldsAccessed) : null,
    reason,
    result.heartbeatIndex,
  );

  return {
    eventId,
    agentDid,
    subjectId,
    heartbeatIndex: result.heartbeatIndex,
  };
}

// ─── Release Custody (Crypto-Shred) ────────────────────────────────────────

/**
 * Release custody of a subject's data via crypto-shredding.
 * The agent destroys the DEK and submits a destruction proof.
 * After this, the encrypted data is irrecoverable — even from backups.
 *
 * The destruction proof is: H(dekFingerprint || 'destroyed' || timestamp || agentDid)
 * This proves the agent committed to destruction at a specific time.
 *
 * @param agentDid - The custodying agent's DID
 * @param subjectId - Whose data is being released
 * @param destructionProof - Cryptographic proof the DEK was destroyed
 */
export function releaseCustody(
  agentDid: string,
  subjectId: string,
  destructionProof: string,
): CustodyReleaseResult {
  // Verify active custody exists
  const acceptEvent = getDb().prepare(`
    SELECT id, dek_fingerprint, created_at FROM custody_events
    WHERE agent_did = ? AND subject_id = ? AND event_type = 'accept'
    ORDER BY created_at DESC LIMIT 1
  `).get(agentDid, subjectId) as { id: string; dek_fingerprint: string; created_at: string } | undefined;

  if (!acceptEvent) {
    throw new Error('No custody record found for this subject');
  }

  // Check not already released
  const alreadyReleased = getDb().prepare(`
    SELECT 1 FROM custody_events
    WHERE agent_did = ? AND subject_id = ? AND event_type = 'release'
      AND created_at > ?
  `).get(agentDid, subjectId, acceptEvent.created_at);

  if (alreadyReleased) {
    throw new Error('Custody already released for this subject');
  }

  // Count total accesses during custody period
  const accessCount = getDb().prepare(`
    SELECT COUNT(*) as count FROM custody_events
    WHERE agent_did = ? AND subject_id = ? AND event_type = 'access'
      AND created_at >= ?
  `).get(agentDid, subjectId, acceptEvent.created_at) as { count: number };

  // Append CUSTODY release leaf
  const result = appendCustody(agentDid, {
    event: 'release',
    subjectId: somaHash(subjectId),
    dekFingerprint: acceptEvent.dek_fingerprint,
    destructionProof,
  });

  // Record release event
  const releaseId = `csr-${nanoid(16)}`;
  getDb().prepare(`
    INSERT INTO custody_events (id, agent_did, subject_id, event_type,
      dek_fingerprint, destruction_proof, pulse_leaf_index, created_at)
    VALUES (?, ?, ?, 'release', ?, ?, ?, datetime('now'))
  `).run(
    releaseId,
    agentDid,
    subjectId,
    acceptEvent.dek_fingerprint,
    destructionProof,
    result.heartbeatIndex,
  );

  // Calculate custody duration
  const acceptTime = new Date(acceptEvent.created_at).getTime();
  const now = Date.now();
  const durationHours = Math.round((now - acceptTime) / (1000 * 60 * 60));

  logAudit({
    entityType: 'custody',
    entityId: releaseId,
    action: 'custody_released',
    actorId: agentDid,
    data: {
      subjectId: somaHash(subjectId),
      destructionProof,
      totalAccesses: accessCount.count,
      durationHours,
    },
  });

  logger.info(
    { agentDid, subjectId: somaHash(subjectId), totalAccesses: accessCount.count, durationHours },
    'Data custody released — DEK destroyed (crypto-shred)',
  );

  return {
    agentDid,
    subjectId,
    destructionProof,
    heartbeatIndex: result.heartbeatIndex,
    pulseRoot: result.root,
    totalAccesses: accessCount.count,
    custodyDurationHours: durationHours,
  };
}

// ─── Query Custody Chain ────────────────────────────────────────────────────

/**
 * Get the full custody status and event chain for an agent-subject pair.
 * This is the verifiable audit trail: accept → access → access → ... → release.
 */
export function getCustodyStatus(agentDid: string, subjectId: string): CustodyStatus {
  const events = getDb().prepare(`
    SELECT id, event_type, dek_fingerprint, destruction_proof,
      fields_accessed_json, access_reason, pulse_leaf_index, created_at
    FROM custody_events
    WHERE agent_did = ? AND subject_id = ?
    ORDER BY created_at ASC
  `).all(agentDid, subjectId) as Array<{
    id: string;
    event_type: string;
    dek_fingerprint: string | null;
    destruction_proof: string | null;
    fields_accessed_json: string | null;
    access_reason: string | null;
    pulse_leaf_index: number;
    created_at: string;
  }>;

  if (events.length === 0) {
    return {
      agentDid,
      subjectId,
      status: 'none',
      dekFingerprint: null,
      acceptedAt: null,
      releasedAt: null,
      totalAccesses: 0,
      lastAccessAt: null,
      destructionProof: null,
      chain: [],
    };
  }

  const chain: CustodyChainEntry[] = events.map(e => ({
    id: e.id,
    eventType: e.event_type as 'accept' | 'access' | 'release',
    dekFingerprint: e.dek_fingerprint,
    destructionProof: e.destruction_proof,
    fieldsAccessed: e.fields_accessed_json ? JSON.parse(e.fields_accessed_json) : null,
    accessReason: e.access_reason,
    pulseLeafIndex: e.pulse_leaf_index,
    createdAt: e.created_at,
  }));

  const acceptEvent = events.find(e => e.event_type === 'accept');
  const releaseEvent = events.findLast(e => e.event_type === 'release');
  const lastAccess = events.findLast(e => e.event_type === 'access');
  const accessCount = events.filter(e => e.event_type === 'access').length;

  return {
    agentDid,
    subjectId,
    status: releaseEvent ? 'released' : 'active',
    dekFingerprint: acceptEvent?.dek_fingerprint ?? null,
    acceptedAt: acceptEvent?.created_at ?? null,
    releasedAt: releaseEvent?.created_at ?? null,
    totalAccesses: accessCount,
    lastAccessAt: lastAccess?.created_at ?? null,
    destructionProof: releaseEvent?.destruction_proof ?? null,
    chain,
  };
}

/**
 * Get custody summary for an agent (all subjects).
 * Used for trust scoring — agents with clean custody records get boosts.
 */
export function getCustodySummary(agentDid: string): {
  activeCount: number;
  releasedCount: number;
  totalAccesses: number;
  avgAccessesPerCustody: number;
} {
  const stats = getDb().prepare(`
    SELECT
      COUNT(DISTINCT CASE WHEN event_type = 'accept' THEN subject_id END) as total_subjects,
      COUNT(DISTINCT CASE WHEN event_type = 'release' THEN subject_id END) as released_subjects,
      COUNT(CASE WHEN event_type = 'access' THEN 1 END) as total_accesses
    FROM custody_events
    WHERE agent_did = ?
  `).get(agentDid) as { total_subjects: number; released_subjects: number; total_accesses: number };

  const activeCount = stats.total_subjects - stats.released_subjects;
  const avgAccesses = stats.total_subjects > 0
    ? Math.round(stats.total_accesses / stats.total_subjects)
    : 0;

  return {
    activeCount,
    releasedCount: stats.released_subjects,
    totalAccesses: stats.total_accesses,
    avgAccessesPerCustody: avgAccesses,
  };
}
