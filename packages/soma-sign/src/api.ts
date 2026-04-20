const BASE_URL = process.env.CLAWNET_URL ?? 'http://localhost:3402';

interface ApiError {
  error: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  const body = await res.json() as T | ApiError;

  if (!res.ok) {
    const message = (body as ApiError).error ?? `API error ${res.status}`;
    throw new Error(message);
  }

  return body as T;
}

export interface Credential {
  credential_id: string;
  ecosystem: string;
  role: string;
  status: string;
  created_at: string;
  last_used_at: string | null;
}

export interface Ceremony {
  id: string;
  package: string;
  targetVersion: string;
  tarballSha256: string;
  gitCommit: string;
  status: string;
  expires_at: string;
  created_at: string;
}

export async function getRoster(): Promise<Credential[]> {
  return request<Credential[]>('/api/authn/roster');
}

export async function promoteCredential(id: string): Promise<Credential> {
  return request<Credential>(`/api/authn/promote`, {
    method: 'POST',
    body: JSON.stringify({ credential_id: id }),
  });
}

export async function getPendingCeremonies(): Promise<Ceremony[]> {
  return request<Ceremony[]>('/api/ceremony/pending');
}

export async function getCeremony(id: string): Promise<Ceremony> {
  return request<Ceremony>(`/api/ceremony/${id}`);
}
