import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

// ─── Enrollment ───────────────────────────────────────────────────────────────

export async function getRegistrationOptions(ecosystem: string, intendedRole: string) {
  return request<{ options: PublicKeyCredentialCreationOptionsJSON; challengeKey: string }>(
    '/api/authn/register/options',
    { method: 'POST', body: JSON.stringify({ ecosystem, intendedRole }) },
  );
}

export async function verifyRegistration(
  response: unknown,
  challengeKey: string,
  ecosystem: string,
  intendedRole: string,
) {
  return request<{ ok: boolean; credentialId: string }>(
    '/api/authn/register/verify',
    { method: 'POST', body: JSON.stringify({ response, challengeKey, ecosystem, intendedRole }) },
  );
}

// ─── Authentication ───────────────────────────────────────────────────────────

export async function getAuthenticationOptions() {
  return request<{ options: PublicKeyCredentialRequestOptionsJSON; challengeKey: string }>(
    '/api/authn/authenticate/options',
    { method: 'POST' },
  );
}

export async function verifyAuthentication(response: unknown, challengeKey: string) {
  return request<{ ok: boolean; credentialId: string; ecosystem: string }>(
    '/api/authn/authenticate/verify',
    { method: 'POST', body: JSON.stringify({ response, challengeKey }) },
  );
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export interface RosterEntry {
  id: string;
  credential_id: string;
  ecosystem: string;
  role: string;
  status: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export async function getRoster() {
  return request<{ roster: RosterEntry[] }>('/api/authn/roster');
}

export async function promoteCredential(credentialId: string) {
  return request<{ ok: boolean; roster: RosterEntry[] }>(
    '/api/authn/promote',
    { method: 'POST', body: JSON.stringify({ credentialId }) },
  );
}

export async function revokeCredential(credentialId: string) {
  return request<{ ok: boolean; roster: RosterEntry[] }>(
    '/api/authn/revoke',
    { method: 'POST', body: JSON.stringify({ credentialId }) },
  );
}

// ─── Ceremony ─────────────────────────────────────────────────────────────────

export interface CeremonyEntry {
  id: string;
  package_name: string;
  target_version: string;
  tarball_sha256: string;
  git_commit: string;
  status: string;
  expires_at: string;
  created_at: string;
}

export async function createCeremonyRequest(data: {
  package: string;
  targetVersion: string;
  tarballSha256: string;
  gitCommit: string;
}) {
  return request<{ ok: boolean; ceremonyId: string; expiresAt: string }>(
    '/api/ceremony/request',
    { method: 'POST', body: JSON.stringify(data) },
  );
}

export async function getPendingCeremonies() {
  return request<{ ceremonies: CeremonyEntry[] }>('/api/ceremony/pending');
}

export async function getCeremony(id: string) {
  return request<CeremonyEntry>(`/api/ceremony/${id}`);
}

export async function getCeremonyApprovalOptions(id: string) {
  return request<{ options: PublicKeyCredentialRequestOptionsJSON; challengeKey: string }>(
    `/api/ceremony/${id}/approve/options`,
    { method: 'POST' },
  );
}

export async function verifyCeremonyApproval(id: string, response: unknown, challengeKey: string) {
  return request<{ ok: boolean; ceremonyId: string; status: string }>(
    `/api/ceremony/${id}/approve/verify`,
    { method: 'POST', body: JSON.stringify({ response, challengeKey }) },
  );
}
