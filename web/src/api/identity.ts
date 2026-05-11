// ─── Identity API — credential roster and ceremony seams ────────────────────

export type RosterEntry = {
  id: string;
  credential_id: string;
  ecosystem: string;
  role: string;
  status: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export type CeremonyEntry = {
  id: string;
  package_name: string;
  target_version: string;
  tarball_sha256: string;
  git_commit: string;
  status: string;
  expires_at: string;
  created_at: string;
};

async function identityFetch<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `API error ${res.status}`,
    );
  }
  return res.json() as Promise<T>;
}

export async function fetchCredentialRoster(): Promise<{
  roster: RosterEntry[];
}> {
  return identityFetch("/api/authn/roster");
}

export async function fetchPendingCeremonies(): Promise<{
  ceremonies: CeremonyEntry[];
}> {
  return identityFetch("/api/ceremony/pending");
}
