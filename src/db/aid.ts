/**
 * AID (Agent Identity Document) — DB helpers for aid_keys, aid_trust_snapshots,
 * aid_cross_platform_attestations, aid_capabilities, and agent_identities AID extensions.
 *
 * Migrations: v102–v107 in connection.ts
 */
import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { getDb, logAudit, safeJsonParse } from './connection';
import { aidHash } from '../utils/crypto-agility';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AidKey {
  id: string;
  identity_id: string;
  owner_key: string;
  public_key_multibase: string;
  did: string;
  key_status: string;
  display_name: string | null;
  service_endpoints: string | null;
  created_at: string;
  updated_at: string | null;
  rotated_at: string | null;
  rotated_to: string | null;
  revocation_reason: string | null;
}

export interface AidTrustSnapshot {
  id: string;
  identity_id: string;
  did: string;
  merkle_root: string;
  attestation_count: number;
  chain_length: number;
  stats_json: string;
  anchor_tx_hash: string | null;
  agent_signature: string;
  platform_signature: string;
  created_at: string;
}

export interface AidCrossPlatformAttestation {
  id: string;
  identity_id: string;
  did: string;
  platform: string;
  attestation_type: string;
  attestation_data_json: string;
  attestation_hash: string;
  platform_signature: string | null;
  verified: number;
  created_at: string;
}

export interface AidCapability {
  id: string;
  identity_id: string;
  category: string;
  actions_json: string;
  invoke_count: number;
  last_invoked_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── AID Keys ───────────────────────────────────────────────────────────────

export function createAidKey(data: {
  ownerKey: string;
  publicKeyMultibase: string;
  did: string;
  displayName?: string;
  serviceEndpoints?: Array<{ type: string; url: string }>;
}): { id: string } {
  const id = `aidkey-${nanoid(16)}`;
  getDb().prepare(`
    INSERT INTO aid_keys (id, identity_id, owner_key, public_key_multibase, did, display_name, service_endpoints)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, data.ownerKey, data.ownerKey, data.publicKeyMultibase, data.did,
    data.displayName ?? null,
    data.serviceEndpoints ? JSON.stringify(data.serviceEndpoints) : null,
  );

  logAudit({ entityType: 'aid_key', entityId: id, action: 'CREATE', data: { owner_key: data.ownerKey, did: data.did } });
  return { id };
}

export function getAidKey(did: string): AidKey | null {
  return (getDb().prepare(
    'SELECT * FROM aid_keys WHERE did = ? AND key_status = ? ORDER BY created_at DESC LIMIT 1'
  ).get(did, 'active') as AidKey | undefined) ?? null;
}

export function getAidKeysByOwnerKey(ownerKey: string): AidKey[] {
  return getDb().prepare(
    'SELECT * FROM aid_keys WHERE owner_key = ? AND key_status = ? ORDER BY created_at DESC'
  ).all(ownerKey, 'active') as AidKey[];
}

export function getAidKeysByIdentity(identityId: string): AidKey[] {
  return getDb().prepare(
    'SELECT * FROM aid_keys WHERE identity_id = ? ORDER BY created_at DESC'
  ).all(identityId) as AidKey[];
}

export function rotateAidKey(oldKeyId: string, newKeyId: string): void {
  const now = new Date().toISOString();
  getDb().transaction(() => {
    getDb().prepare(`
      UPDATE aid_keys SET key_status = 'rotated', rotated_at = ?, rotated_to = ?, updated_at = datetime('now') WHERE id = ?
    `).run(now, newKeyId, oldKeyId);
  })();

  logAudit({ entityType: 'aid_key', entityId: oldKeyId, action: 'ROTATE', data: { new_key_id: newKeyId } });
}

export function revokeAidKey(keyId: string, reason: string): void {
  getDb().prepare(`
    UPDATE aid_keys SET key_status = 'revoked', revocation_reason = ?, updated_at = datetime('now') WHERE id = ?
  `).run(reason, keyId);

  logAudit({ entityType: 'aid_key', entityId: keyId, action: 'REVOKE', data: { reason } });
}

// ─── Trust Snapshots ────────────────────────────────────────────────────────

export function createTrustSnapshot(data: {
  identityId: string;
  did: string;
  merkleRoot: string;
  attestationCount: number;
  chainLength: number;
  statsJson: string;
  anchorTxHash?: string;
  agentSignature: string;
  platformSignature: string;
}): { id: string } {
  const id = `snap-${nanoid(16)}`;
  getDb().prepare(`
    INSERT INTO aid_trust_snapshots (
      id, identity_id, did, merkle_root, attestation_count, chain_length,
      stats_json, anchor_tx_hash, agent_signature, platform_signature
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, data.identityId, data.did, data.merkleRoot,
    data.attestationCount, data.chainLength, data.statsJson,
    data.anchorTxHash ?? null, data.agentSignature, data.platformSignature,
  );

  logAudit({ entityType: 'aid_trust_snapshot', entityId: id, action: 'CREATE', data: { did: data.did, attestation_count: data.attestationCount } });
  return { id };
}

export function getLatestSnapshot(did: string): AidTrustSnapshot | null {
  return (getDb().prepare(
    'SELECT * FROM aid_trust_snapshots WHERE did = ? ORDER BY created_at DESC LIMIT 1',
  ).get(did) as AidTrustSnapshot | undefined) ?? null;
}

export function getSnapshotHistory(did: string, limit: number = 20): AidTrustSnapshot[] {
  const safeLimit = Math.min(Math.max(1, limit), 100);
  return getDb().prepare(
    'SELECT * FROM aid_trust_snapshots WHERE did = ? ORDER BY created_at DESC LIMIT ?',
  ).all(did, safeLimit) as AidTrustSnapshot[];
}

/**
 * Delete old snapshots, keeping only the most recent `keep` per DID.
 * Returns number of rows deleted.
 */
export function pruneSnapshots(did: string, keep: number = 50): number {
  const result = getDb().prepare(`
    DELETE FROM aid_trust_snapshots
    WHERE did = ? AND id NOT IN (
      SELECT id FROM aid_trust_snapshots WHERE did = ? ORDER BY created_at DESC LIMIT ?
    )
  `).run(did, did, keep);
  return result.changes;
}

// ─── Cross-Platform Attestations ────────────────────────────────────────────

export function addCrossPlatformAttestation(data: {
  ownerKey: string;
  did: string;
  platform: string;
  attestationType: string;
  attestationData: Record<string, unknown>;
  platformSignature?: string;
}): { id: string; attestationHash: string } {
  const id = `xplat-${nanoid(16)}`;
  const attestationDataJson = JSON.stringify(data.attestationData);
  const attestationHash = aidHash(attestationDataJson);

  getDb().prepare(`
    INSERT INTO aid_cross_platform_attestations (
      id, identity_id, did, platform, attestation_type,
      attestation_data_json, attestation_hash, platform_signature
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, data.ownerKey, data.did, data.platform, data.attestationType,
    attestationDataJson, attestationHash, data.platformSignature ?? null,
  );

  logAudit({ entityType: 'aid_cross_platform_attestation', entityId: id, action: 'CREATE', data: { did: data.did, platform: data.platform } });
  return { id, attestationHash };
}

export function getCrossPlatformAttestations(did: string, limit: number = 50): AidCrossPlatformAttestation[] {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  return getDb().prepare(
    'SELECT * FROM aid_cross_platform_attestations WHERE did = ? ORDER BY created_at DESC LIMIT ?',
  ).all(did, safeLimit) as AidCrossPlatformAttestation[];
}

export function countNewAttestationsSince(did: string, since: string): number {
  return (getDb().prepare(
    'SELECT COUNT(*) as cnt FROM aid_cross_platform_attestations WHERE did = ? AND created_at > ?'
  ).get(did, since) as any)?.cnt ?? 0;
}

// ─── Capabilities ───────────────────────────────────────────────────────────

export function upsertCapability(identityId: string, category: string, action: string): void {
  const existing = getDb().prepare(
    'SELECT id, actions_json FROM aid_capabilities WHERE identity_id = ? AND category = ?',
  ).get(identityId, category) as { id: string; actions_json: string } | undefined;

  if (existing) {
    const actions: string[] = safeJsonParse(existing.actions_json, []);
    if (!actions.includes(action)) {
      actions.push(action);
    }
    getDb().prepare(`
      UPDATE aid_capabilities
      SET actions_json = ?, invoke_count = invoke_count + 1,
          last_invoked_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify(actions), existing.id);
  } else {
    const id = `aidcap-${nanoid(16)}`;
    getDb().prepare(`
      INSERT INTO aid_capabilities (id, identity_id, category, actions_json, invoke_count, last_invoked_at)
      VALUES (?, ?, ?, ?, 1, datetime('now'))
    `).run(id, identityId, category, JSON.stringify([action]));
  }
}

/**
 * Replace all capabilities for an identity. Used by the cron to refresh
 * derived capabilities from attestation history without double-counting.
 */
export function replaceCapabilities(
  identityId: string,
  capabilities: Array<{ category: string; actions: string[]; invokeCount: number }>,
): void {
  getDb().transaction(() => {
    getDb().prepare('DELETE FROM aid_capabilities WHERE identity_id = ?').run(identityId);
    for (const cap of capabilities) {
      const id = `aidcap-${nanoid(16)}`;
      getDb().prepare(`
        INSERT INTO aid_capabilities (id, identity_id, category, actions_json, invoke_count)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, identityId, cap.category, JSON.stringify(cap.actions), cap.invokeCount);
    }
  })();
}

export function getCapabilities(identityId: string): AidCapability[] {
  return getDb().prepare(
    'SELECT * FROM aid_capabilities WHERE identity_id = ? ORDER BY invoke_count DESC',
  ).all(identityId) as AidCapability[];
}

// ─── Identity AID Extensions ────────────────────────────────────────────────

export function setIdentityAid(
  identityId: string,
  did: string,
  publicKeyMultibase: string,
  activeKeyId: string,
): void {
  getDb().prepare(`
    UPDATE agent_identities
    SET did = ?, public_key_multibase = ?, active_key_id = ?,
        aid_version = '1.0.0', updated_at = datetime('now')
    WHERE id = ?
  `).run(did, publicKeyMultibase, activeKeyId, identityId);

  logAudit({ entityType: 'agent_identity', entityId: identityId, action: 'SET_AID', data: { did, active_key_id: activeKeyId } });
}

export function getIdentityByDid(did: string): Record<string, unknown> | null {
  return (getDb().prepare('SELECT * FROM agent_identities WHERE did = ?').get(did) as Record<string, unknown> | undefined) ?? null;
}
