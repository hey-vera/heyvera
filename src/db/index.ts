/**
 * Database barrel — the single import point for db helpers.
 *
 * Per `AGENTS.md` §"Critical Gotchas": callers must import database
 * helpers from `src/db/index.ts`, never reach into `connection.ts`
 * directly. Keeping a single barrel lets future refactors (e.g.
 * splitting connection from query helpers, adding a per-domain
 * accessor layer) land without rewriting every call site.
 */
import { getDb, logAudit } from './connection';
import type { Delegation } from 'soma-heart';

export {
  _resetDbForTests,
  closeDb,
  getDb,
  initDb,
  logAudit,
  type InitDbOptions,
} from './connection';

export function getApiKeyByClerkId(clerkUserId: string): {
  key: string; email: string; credits: number; amount_paid: number;
} | undefined {
  return getDb()
    .prepare('SELECT key, email, credits, amount_paid FROM api_keys WHERE clerk_user_id = ? AND active = 1')
    .get(clerkUserId) as { key: string; email: string; credits: number; amount_paid: number } | undefined;
}

export function storeSomaDelegation(apiKeyId: string, clerkUserId: string, delegation: Delegation): void {
  getDb().prepare(`
    INSERT OR IGNORE INTO soma_delegations (id, api_key_id, clerk_user_id, subject_did, delegation_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(delegation.id, apiKeyId, clerkUserId, delegation.subjectDid, JSON.stringify(delegation));
}

export function hasSomaDelegation(apiKeyId: string): boolean {
  return getDb()
    .prepare('SELECT 1 FROM soma_delegations WHERE api_key_id = ? LIMIT 1')
    .get(apiKeyId) !== undefined;
}

export function createApiKeyForClerk(opts: {
  key: string;
  clerkUserId: string;
  email: string;
  credits: number;
  solanaSignature: string;
  amountPaid: number;
}): void {
  getDb().prepare(`
    INSERT INTO api_keys (key, email, credits, credits_used, created_at, stripe_session_id, clerk_user_id, amount_paid)
    VALUES (?, ?, ?, 0, datetime('now'), ?, ?, ?)
  `).run(opts.key, opts.email, opts.credits, opts.solanaSignature, opts.clerkUserId, opts.amountPaid);
  logAudit({ entityType: 'api_key', entityId: opts.key, action: 'CREDIT_GRANT', actorId: opts.clerkUserId, data: { credits: opts.credits, amountPaid: opts.amountPaid, via: 'oauth' } });
}

// ---------------------------------------------------------------------------
// WebAuthn credentials + pending ceremonies
// ---------------------------------------------------------------------------

export interface WebAuthnCredential {
  id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  aaguid: string | null;
  ecosystem: string;
  role: 'primary' | 'backup' | 'recovery';
  status: 'active' | 'revoked';
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface PendingCeremony {
  id: string;
  package_name: string;
  target_version: string;
  tarball_sha256: string;
  git_commit: string;
  release_log_sequence: number | null;
  release_log_entry_hash: string | null;
  status: 'awaiting_webauthn' | 'completed' | 'expired' | 'cancelled';
  expires_at: string;
  completed_at: string | null;
  authenticator_credential_id: string | null;
  authenticator_kind: string | null;
  certificate_json: string | null;
  created_at: string;
}

export function insertWebAuthnCredential(cred: {
  id: string; credential_id: string; public_key: string;
  counter: number; transports: string | null;
  aaguid: string | null; ecosystem: string; role: string;
}): void {
  getDb().prepare(`
    INSERT INTO webauthn_credentials (id, credential_id, public_key, counter, transports, aaguid, ecosystem, role)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(cred.id, cred.credential_id, cred.public_key, cred.counter, cred.transports, cred.aaguid, cred.ecosystem, cred.role);
  logAudit({ entityType: 'webauthn_credential', entityId: cred.id, action: 'REGISTERED', data: { ecosystem: cred.ecosystem, role: cred.role } });
}

export function getCredentialByCredentialId(credentialId: string): WebAuthnCredential | undefined {
  return getDb()
    .prepare('SELECT * FROM webauthn_credentials WHERE credential_id = ?')
    .get(credentialId) as WebAuthnCredential | undefined;
}

export function getActiveNonRecoveryCredentials(): WebAuthnCredential[] {
  return getDb()
    .prepare(`SELECT * FROM webauthn_credentials WHERE status = 'active' AND role != 'recovery' ORDER BY CASE role WHEN 'primary' THEN 0 ELSE 1 END`)
    .all() as WebAuthnCredential[];
}

export function getActiveCredentialsByRole(role: string): WebAuthnCredential[] {
  return getDb()
    .prepare(`SELECT * FROM webauthn_credentials WHERE status = 'active' AND role = ?`)
    .all(role) as WebAuthnCredential[];
}

export function getCredentialRoster(): WebAuthnCredential[] {
  return getDb()
    .prepare('SELECT * FROM webauthn_credentials ORDER BY created_at ASC')
    .all() as WebAuthnCredential[];
}

export function updateCredentialCounter(id: string, counter: number): void {
  getDb()
    .prepare('UPDATE webauthn_credentials SET counter = ? WHERE id = ?')
    .run(counter, id);
}

export function updateCredentialLastUsed(id: string): void {
  getDb()
    .prepare(`UPDATE webauthn_credentials SET last_used_at = datetime('now') WHERE id = ?`)
    .run(id);
}

export function revokeCredential(id: string): void {
  getDb()
    .prepare(`UPDATE webauthn_credentials SET status = 'revoked', revoked_at = datetime('now') WHERE id = ?`)
    .run(id);
  logAudit({ entityType: 'webauthn_credential', entityId: id, action: 'REVOKED' });
}

export function countActiveNonRecoveryCredentials(): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS cnt FROM webauthn_credentials WHERE status = 'active' AND role != 'recovery'`)
    .get() as { cnt: number };
  return row.cnt;
}

export function promoteToPrimary(targetId: string): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`UPDATE webauthn_credentials SET role = 'backup' WHERE role = 'primary' AND status = 'active'`).run();
    db.prepare(`UPDATE webauthn_credentials SET role = 'primary' WHERE id = ?`).run(targetId);
  })();
  logAudit({ entityType: 'webauthn_credential', entityId: targetId, action: 'PROMOTED' });
}

export function insertPendingCeremony(ceremony: {
  id: string; package_name: string; target_version: string;
  tarball_sha256: string; git_commit: string;
  release_log_sequence: number | null;
  release_log_entry_hash: string | null;
  status: string; expires_at: string;
}): void {
  getDb().prepare(`
    INSERT INTO pending_ceremonies (id, package_name, target_version, tarball_sha256, git_commit, release_log_sequence, release_log_entry_hash, status, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(ceremony.id, ceremony.package_name, ceremony.target_version, ceremony.tarball_sha256, ceremony.git_commit, ceremony.release_log_sequence, ceremony.release_log_entry_hash, ceremony.status, ceremony.expires_at);
}

export function getPendingCeremony(id: string): PendingCeremony | undefined {
  return getDb()
    .prepare('SELECT * FROM pending_ceremonies WHERE id = ?')
    .get(id) as PendingCeremony | undefined;
}

export function getAwaitingCeremonies(): PendingCeremony[] {
  return getDb()
    .prepare(`SELECT * FROM pending_ceremonies WHERE status = 'awaiting_webauthn' AND expires_at > datetime('now')`)
    .all() as PendingCeremony[];
}

export function completeCeremony(id: string, data: {
  credentialId: string; kind: string; certificateJson: string;
}): void {
  getDb().prepare(`
    UPDATE pending_ceremonies
    SET status = 'completed', completed_at = datetime('now'),
        authenticator_credential_id = ?, authenticator_kind = ?, certificate_json = ?
    WHERE id = ?
  `).run(data.credentialId, data.kind, data.certificateJson, id);
  logAudit({ entityType: 'pending_ceremony', entityId: id, action: 'CEREMONY_COMPLETED', data: { authenticatorKind: data.kind } });
}

export function expireOldCeremonies(): number {
  return getDb()
    .prepare(`UPDATE pending_ceremonies SET status = 'expired' WHERE status = 'awaiting_webauthn' AND expires_at <= datetime('now')`)
    .run().changes;
}

// ─── Social layer ────────────────────────────────────────────────────────────

export {
  findSocialProfileByClerkId,
  findSocialProfileByHandle,
  listSocialProfiles,
  getFirstSocialProfile,
  insertSocialProfile,
  updateSocialProfile,
  getLinkedAgentsByProfileId,
  insertLinkedAgent,
  getProfileStats,
  listFeedPosts,
  listFeedPostsByHandle,
  insertSocialPost,
  getFollowStatus,
  insertSocialFollow,
  deleteSocialFollow,
  listSocialCommunities,
  findSocialCommunityBySlug,
  insertSocialCommunity,
  insertCommunityMembership,
  listCommunityFeedPosts,
  listJoinedCommunities,
  listFollowers,
  listFollowing,
  listSocialLongform,
  insertSocialLongform,
  type SocialProfileRow,
  type SocialProfileSummaryRow,
  type SocialLinkedAgentRow,
  type SocialPostWithAuthorRow,
  type SocialCommunityWithCreatorRow,
  type SocialCommunityMembershipRow,
  type SocialLongformWithAuthorRow,
} from './social';
