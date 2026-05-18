const BASE_URL = import.meta.env.VITE_CORTEX_API ?? '';

let _tokenGetter: (() => Promise<string | null>) | null = null;

export function setAuthTokenGetter(getter: () => Promise<string | null>) {
  _tokenGetter = getter;
}

async function getAuthToken(): Promise<string | null> {
  if (!_tokenGetter) return null;
  return _tokenGetter();
}

async function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = await getAuthToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type') && init?.method && init.method !== 'GET') {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(url, { ...init, headers });
}

export interface WorkerEvent {
  type: 'started' | 'output' | 'completed' | 'failed';
  task_id: string;
  provider?: string;
  model?: string;
  line?: string;
  exit_code?: number;
  error?: string;
}

export function streamChat(
  message: string,
  filePaths: string[],
  onEvent: (event: WorkerEvent) => void,
  onDone: () => void,
  onError: (err: Error) => void,
): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await authedFetch(`${BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, file_paths: filePaths }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Cortex API ${res.status}: ${body}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (!json) continue;
          try {
            onEvent(JSON.parse(json) as WorkerEvent);
          } catch {
            // skip malformed lines
          }
        }
      }
      onDone();
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') onError(err);
    }
  })();

  return controller;
}

export interface ProviderAuthInfo {
  provider: string;
  authenticated: boolean;
  email: string | null;
  subscription: string | null;
}

export interface AuthStartResponse {
  provider: string;
  auth_url: string | null;
  device_code: string | null;
  message: string;
}

export async function getAuthStatus(): Promise<ProviderAuthInfo[]> {
  const res = await fetch(`${BASE_URL}/api/auth/status`);
  return res.json();
}

export async function startAuth(provider: string): Promise<AuthStartResponse> {
  const res = await authedFetch(`${BASE_URL}/api/auth/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider }),
  });
  return res.json();
}

export async function refreshAuth(): Promise<ProviderAuthInfo[]> {
  const res = await authedFetch(`${BASE_URL}/api/auth/refresh`, { method: 'POST' });
  return res.json();
}

export async function getProviders() {
  const res = await authedFetch(`${BASE_URL}/api/providers`);
  return res.json();
}

export async function getHealth() {
  const res = await fetch(`${BASE_URL}/api/health`);
  return res.json();
}

export interface GitHubStatus {
  linked: boolean;
  username: string | null;
  repos: GitHubRepo[];
}

export interface GitHubRepo {
  id: number;
  full_name: string;
  description: string | null;
  html_url: string;
  private: boolean;
  language: string | null;
}

export async function getGitHubStatus(): Promise<GitHubStatus> {
  const res = await authedFetch(`${BASE_URL}/api/user/github/status`);
  return res.json();
}

export async function selectRepos(repoIds: number[]): Promise<void> {
  await authedFetch(`${BASE_URL}/api/user/repos/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_ids: repoIds }),
  });
}

export async function getUserProfile() {
  const res = await authedFetch(`${BASE_URL}/api/user/profile`);
  return res.json();
}
