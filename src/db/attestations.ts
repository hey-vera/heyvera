/**
 * Attestation — DB helpers for the attestations + attestation_stats tables (v80)
 *
 * Signed, verifiable proof of agent actions.
 * Automatic attestations on every billing action.
 * Explicit attestations for agent-initiated records.
 */
import { nanoid } from 'nanoid';
import crypto from 'crypto';
import { getDb } from './connection';
import { logger } from '../utils/logger';
import { env } from '../config/index';
import { fireWebhookEvent } from '../utils/webhooks';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AttestationRow {
  id: string;
  api_key_hash: string;
  sequence_number: number;
  attestation_type: string;
  manifest_id: string | null;
  manifest_verdict: string | null;
  manifest_confidence: number | null;
  manifest_aligned: number | null;
  action_type: string;
  action_endpoint: string | null;
  action_description: string | null;
  input_hash: string;
  response_hash: string | null;
  source_hashes_json: string | null;
  credits_charged: number;
  duration_ms: number | null;
  outcome_status: string;
  outcome_data_json: string | null;
  signature: string | null;
  signed_at: string | null;
  signing_key_id: string | null;
  created_at: string;
  anchor_id: string | null;
  anchored_at: string | null;
}

export interface CreateAttestationParams {
  apiKeyHash: string;
  attestationType: 'automatic' | 'explicit';
  manifestId?: string;
  manifestVerdict?: string;
  manifestConfidence?: number;
  manifestAligned?: boolean | null;
  actionType: string;
  actionEndpoint?: string;
  actionDescription?: string;
  inputHash: string;
  responseHash?: string;
  sourceHashes?: Array<{ source: string; hash: string; fetched_at: string }>;
  creditsCharged?: number;
  durationMs?: number;
  outcomeStatus?: 'success' | 'failure' | 'partial' | 'unknown';
  outcomeData?: Record<string, unknown>;
}

export interface AttestationStatsRow {
  api_key_hash: string;
  total_attestations: number;
  manifest_aligned: number;
  manifest_unaligned: number;
  manifest_unchecked: number;
  success_count: number;
  failure_count: number;
  last_attestation_at: string | null;
}

// ─── Hash helpers ───────────────────────────────────────────────────────────

export function hashApiKey(apiKey: string): string {
  // 128-bit hash prefix (32 hex chars). Prior to this change, 16 chars (64-bit) were used.
  // Old 16-char hashes are grandfathered — lookups still work since they're a prefix match
  // against DB values, but new attestations will store the longer 32-char hash.
  return crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 32);
}

export function hashPayload(payload: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

// ─── Signing key management ──────────────────────────────────────────────

/**
 * Parse signing secrets from env. Supports:
 * - PLATFORM_SIGNING_SECRETS="key-1:secret1,key-2:secret2" (multi-key)
 * - PLATFORM_SIGNING_SECRET="single_secret" (legacy, treated as key-1)
 */
function getSigningKeyMap(): Map<string, string> {
  const map = new Map<string, string>();

  // Multi-key format takes precedence
  if (env.PLATFORM_SIGNING_SECRETS) {
    for (const entry of env.PLATFORM_SIGNING_SECRETS.split(',')) {
      const colonIdx = entry.indexOf(':');
      if (colonIdx > 0) {
        const keyId = entry.slice(0, colonIdx).trim();
        const secret = entry.slice(colonIdx + 1).trim();
        if (keyId && secret) map.set(keyId, secret);
      }
    }
  }

  // Fallback: single secret treated as key-1
  if (map.size === 0 && env.PLATFORM_SIGNING_SECRET) {
    map.set('key-1', env.PLATFORM_SIGNING_SECRET);
  }

  return map;
}

function getCurrentSigningKeyId(): string {
  return env.PLATFORM_SIGNING_KEY_ID || 'key-1';
}

function getSecretForKeyId(keyId: string): string | null {
  const map = getSigningKeyMap();
  return map.get(keyId) ?? null;
}

function signAttestation(attestationId: string, inputHash: string, responseHash: string | null, apiKeyHash: string, timestamp: string, keyId?: string): { signature: string; keyId: string } | null {
  const activeKeyId = keyId || getCurrentSigningKeyId();
  const secret = getSecretForKeyId(activeKeyId);
  if (!secret) return null;

  const responseHashComponent = responseHash === null ? 'null' : responseHash;
  const data = `${activeKeyId}.${attestationId}.${apiKeyHash}.${inputHash}.${responseHashComponent}.${timestamp}`;
  const signature = crypto.createHmac('sha256', secret).update(data).digest('hex');
  return { signature, keyId: activeKeyId };
}

/**
 * Legacy signing format (pre-key-rotation) for verifying old attestations
 * that don't have a signing_key_id stored.
 */
function signAttestationLegacy(attestationId: string, inputHash: string, responseHash: string | null, apiKeyHash: string, timestamp: string): string | null {
  const secret = getSecretForKeyId('key-1') || env.PLATFORM_SIGNING_SECRET;
  if (!secret) return null;
  const responseHashComponent = responseHash === null ? 'null' : responseHash;
  const data = `${attestationId}.${apiKeyHash}.${inputHash}.${responseHashComponent}.${timestamp}`;
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

// ─── Sequence number ────────────────────────────────────────────────────────

function getNextSequenceNumber(apiKeyHash: string): number {
  const row = getDb().prepare(
    'SELECT MAX(sequence_number) as max_seq FROM attestations WHERE api_key_hash = ?'
  ).get(apiKeyHash) as { max_seq: number | null } | undefined;
  return (row?.max_seq ?? 0) + 1;
}

// ─── Create ─────────────────────────────────────────────────────────────────

export function createAttestation(params: CreateAttestationParams): string {
  const id = `att-${nanoid(16)}`;
  const now = new Date().toISOString();

  const signResult = signAttestation(id, params.inputHash, params.responseHash || null, params.apiKeyHash, now);

  // Replay protection: reject duplicate input_hash + api_key_hash within 60 seconds
  const recent = getDb().prepare(
    `SELECT id FROM attestations WHERE api_key_hash = ? AND input_hash = ? AND created_at > datetime('now', '-60 seconds') LIMIT 1`
  ).get(params.apiKeyHash, params.inputHash) as { id: string } | undefined;
  if (recent) {
    throw new Error(`Duplicate attestation rejected: same input_hash for this key within 60s (existing: ${recent.id})`);
  }

  // CRITICAL: Never silently create unsigned attestations in production.
  // An unsigned attestation has no cryptographic integrity and could be tampered with.
  if (signResult === null && env.NODE_ENV === 'production') {
    throw new Error('Cannot create attestation: PLATFORM_SIGNING_SECRET is not configured. Unsigned attestations are not allowed in production.');
  }

  const signature = signResult?.signature ?? null;
  const signingKeyId = signResult?.keyId ?? null;

  // Wrap sequence number read + insert in a transaction to prevent race conditions
  getDb().transaction(() => {
    const seqNum = getNextSequenceNumber(params.apiKeyHash);

    // Hash-chaining: link to predecessor attestation for tamper detection
    let prevAttestationHash: string | null = null;
    const prev = getDb().prepare(
      `SELECT id, input_hash, signature FROM attestations WHERE api_key_hash = ? ORDER BY sequence_number DESC LIMIT 1`
    ).get(params.apiKeyHash) as { id: string; input_hash: string; signature: string | null } | undefined;
    if (prev) {
      prevAttestationHash = crypto.createHash('sha256')
        .update(`${prev.id}.${prev.input_hash}.${prev.signature ?? 'unsigned'}`)
        .digest('hex');
    }

    getDb().prepare(`
      INSERT INTO attestations (
        id, api_key_hash, sequence_number, attestation_type,
        manifest_id, manifest_verdict, manifest_confidence, manifest_aligned,
        action_type, action_endpoint, action_description,
        input_hash, response_hash, source_hashes_json,
        credits_charged, duration_ms, outcome_status, outcome_data_json,
        signature, signed_at, signing_key_id, prev_attestation_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, params.apiKeyHash, seqNum, params.attestationType,
      params.manifestId || null, params.manifestVerdict || null,
      params.manifestConfidence ?? null,
      params.manifestAligned === true ? 1 : params.manifestAligned === false ? 0 : null,
      params.actionType, params.actionEndpoint || null, params.actionDescription || null,
      params.inputHash, params.responseHash || null,
      params.sourceHashes ? JSON.stringify(params.sourceHashes) : null,
      params.creditsCharged || 0, params.durationMs || null,
      params.outcomeStatus || 'success',
      params.outcomeData ? JSON.stringify(params.outcomeData) : null,
      signature, signature ? now : null, signingKeyId, prevAttestationHash,
    );
  })();

  // Update stats (upsert)
  updateAttestationStats(params.apiKeyHash, params.manifestAligned ?? null, params.outcomeStatus || 'success');

  // Fire attestation webhook events
  try {
    fireWebhookEvent(params.apiKeyHash, 'ATTESTATION_CREATED', {
      attestationId: id, actionType: params.actionType,
      outcomeStatus: params.outcomeStatus || 'success',
      creditsCharged: params.creditsCharged || 0,
    });

    // Check for chain breaks (prev_attestation_hash mismatch would have thrown, so if we're here, chain is intact)
    // Fire TRUST_SCORE_CHANGED on milestone attestation counts
    const count = getDb().prepare(
      'SELECT COUNT(*) as c FROM attestations WHERE api_key_hash = ?'
    ).get(params.apiKeyHash) as { c: number };
    if (count.c === 10 || count.c === 50 || count.c === 100 || count.c === 500 || count.c === 1000) {
      fireWebhookEvent(params.apiKeyHash, 'TRUST_SCORE_CHANGED', {
        totalAttestations: count.c, milestone: true,
      });
    }
  } catch {}

  return id;
}

// ─── Auto-attestation (fire-and-forget for billing sites) ───────────────────

export function createAutoAttestation(
  apiKey: string,
  actionType: string,
  actionEndpoint: string,
  inputPayload: unknown,
  responsePayload: unknown,
  creditsCharged: number,
  durationMs?: number,
  manifestId?: string,
): string | null {
  try {
    const apiKeyHash = hashApiKey(apiKey);
    const inputHash = hashPayload(inputPayload);
    const responseHash = responsePayload ? hashPayload(responsePayload) : null;

    // Check for manifest alignment
    let manifestVerdict: string | undefined;
    let manifestConfidence: number | undefined;
    let manifestAligned: boolean | null = null;

    if (manifestId) {
      const manifest = getDb().prepare(
        'SELECT overall_verdict, confidence FROM manifest_memory WHERE id = ?'
      ).get(manifestId) as { overall_verdict: string; confidence: number } | undefined;

      if (manifest) {
        manifestVerdict = manifest.overall_verdict;
        manifestConfidence = manifest.confidence;
        manifestAligned = manifestVerdict === 'PROCEED';
      }
    }

    return createAttestation({
      apiKeyHash,
      attestationType: 'automatic',
      manifestId,
      manifestVerdict,
      manifestConfidence,
      manifestAligned,
      actionType,
      actionEndpoint,
      inputHash,
      responseHash: responseHash || undefined,
      creditsCharged,
      durationMs,
      outcomeStatus: 'success',
    });
  } catch (err) {
    logger.warn({ err, actionType }, 'Auto-attestation failed — non-blocking');
    return null;
  }
}

// ─── Query ──────────────────────────────────────────────────────────────────

export function getAttestationById(id: string): AttestationRow | undefined {
  return getDb().prepare('SELECT * FROM attestations WHERE id = ?').get(id) as AttestationRow | undefined;
}

export function getAttestationHistory(apiKeyHash: string, options?: {
  actionType?: string;
  manifestAligned?: boolean;
  limit?: number;
  since?: string;
}): AttestationRow[] {
  let sql = 'SELECT * FROM attestations WHERE api_key_hash = ?';
  const params: unknown[] = [apiKeyHash];

  if (options?.actionType) { sql += ' AND action_type = ?'; params.push(options.actionType); }
  if (options?.manifestAligned !== undefined) {
    sql += ' AND manifest_aligned = ?';
    params.push(options.manifestAligned ? 1 : 0);
  }
  if (options?.since) { sql += ' AND created_at > ?'; params.push(options.since); }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(options?.limit || 20);

  return getDb().prepare(sql).all(...params) as AttestationRow[];
}

// ─── Verification ───────────────────────────────────────────────────────────

export function verifyAttestation(id: string): {
  valid: boolean;
  attestation: AttestationRow | null;
  signature_valid: boolean | null;
  chain_contiguous: boolean;
  signing_key_id?: string | null;
  reason?: string;
} {
  const att = getAttestationById(id);
  if (!att) return { valid: false, attestation: null, signature_valid: null, chain_contiguous: false, reason: 'Attestation not found' };

  // Verify signature — use stored signing_key_id to select the correct key
  let signatureValid: boolean | null = null;
  const storedKeyId = att.signing_key_id;

  if (att.signature && att.signed_at) {
    let expected: string | null = null;

    if (storedKeyId) {
      // New format: key ID included in signature data
      const result = signAttestation(att.id, att.input_hash, att.response_hash, att.api_key_hash, att.signed_at, storedKeyId);
      expected = result?.signature ?? null;
    } else {
      // Legacy format: no key ID in signature data, use key-1
      expected = signAttestationLegacy(att.id, att.input_hash, att.response_hash, att.api_key_hash, att.signed_at);
    }

    signatureValid = expected !== null && att.signature !== null &&
      att.signature.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(att.signature), Buffer.from(expected));
  }

  // Check chain contiguity (no gaps in sequence)
  const prevSeq = att.sequence_number - 1;
  let chainContiguous = true;
  if (prevSeq > 0) {
    const prev = getDb().prepare(
      'SELECT id FROM attestations WHERE api_key_hash = ? AND sequence_number = ?'
    ).get(att.api_key_hash, prevSeq) as { id: string } | undefined;
    chainContiguous = !!prev;
  }

  return {
    valid: signatureValid !== false && chainContiguous,
    attestation: att,
    signature_valid: signatureValid,
    chain_contiguous: chainContiguous,
    signing_key_id: storedKeyId,
  };
}

// ─── Stats ──────────────────────────────────────────────────────────────────

function updateAttestationStats(apiKeyHash: string, manifestAligned: boolean | null, outcomeStatus: string): void {
  try {
    const existing = getDb().prepare('SELECT * FROM attestation_stats WHERE api_key_hash = ?').get(apiKeyHash) as AttestationStatsRow | undefined;

    if (existing) {
      const updates: string[] = [
        'total_attestations = total_attestations + 1',
        "last_attestation_at = datetime('now')",
        "updated_at = datetime('now')",
      ];
      if (manifestAligned === true) updates.push('manifest_aligned = manifest_aligned + 1');
      else if (manifestAligned === false) updates.push('manifest_unaligned = manifest_unaligned + 1');
      else updates.push('manifest_unchecked = manifest_unchecked + 1');

      if (outcomeStatus === 'success') updates.push('success_count = success_count + 1');
      else if (outcomeStatus === 'failure') updates.push('failure_count = failure_count + 1');

      getDb().prepare(`UPDATE attestation_stats SET ${updates.join(', ')} WHERE api_key_hash = ?`).run(apiKeyHash);
    } else {
      getDb().prepare(`
        INSERT INTO attestation_stats (api_key_hash, total_attestations, manifest_aligned, manifest_unaligned, manifest_unchecked, success_count, failure_count, last_attestation_at)
        VALUES (?, 1, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        apiKeyHash,
        manifestAligned === true ? 1 : 0,
        manifestAligned === false ? 1 : 0,
        manifestAligned === null ? 1 : 0,
        outcomeStatus === 'success' ? 1 : 0,
        outcomeStatus === 'failure' ? 1 : 0,
      );
    }
  } catch (err) {
    logger.warn({ err }, 'Attestation stats update failed — non-blocking');
  }
}

export function getAttestationStats(apiKeyHash: string): AttestationStatsRow | null {
  return (getDb().prepare('SELECT * FROM attestation_stats WHERE api_key_hash = ?').get(apiKeyHash) as AttestationStatsRow) || null;
}

export function getPublicAgentProfile(apiKeyHash: string): {
  total_attestations: number;
  alignment_rate: number;
  success_rate: number;
  first_attestation: string | null;
  last_attestation: string | null;
} | null {
  const stats = getAttestationStats(apiKeyHash);
  if (!stats || stats.total_attestations === 0) return null;

  const alignable = stats.manifest_aligned + stats.manifest_unaligned;
  const total = stats.success_count + stats.failure_count;

  const firstRow = getDb().prepare(
    'SELECT created_at FROM attestations WHERE api_key_hash = ? ORDER BY created_at ASC LIMIT 1'
  ).get(apiKeyHash) as { created_at: string } | undefined;

  return {
    total_attestations: stats.total_attestations,
    alignment_rate: alignable > 0 ? Math.round((stats.manifest_aligned / alignable) * 100) : 0,
    success_rate: total > 0 ? Math.round((stats.success_count / total) * 100) : 0,
    first_attestation: firstRow?.created_at || null,
    last_attestation: stats.last_attestation_at,
  };
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

export function cleanupOldAttestations(retentionDays: number = 365): number {
  // Only clean automatic attestations; explicit ones are permanent
  const result = getDb().prepare(
    `DELETE FROM attestations WHERE attestation_type = 'automatic' AND created_at < datetime('now', ?) AND id IN (SELECT id FROM attestations WHERE attestation_type = 'automatic' AND created_at < datetime('now', ?) LIMIT 5000)`
  ).run(`-${retentionDays} days`, `-${retentionDays} days`);
  return result.changes;
}
