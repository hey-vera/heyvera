import type { CortexState } from '../types';

const CONFIGURED_API_BASE = import.meta.env.VITE_CORTEX_API as string | undefined;
const BASE_URL = CONFIGURED_API_BASE ?? (import.meta.env.DEV ? 'http://localhost:3001' : '');

function apiUrl(path: string) {
  const base = BASE_URL.replace(/\/$/, '');
  if (!base) return path;
  if (base.endsWith('/api') && path.startsWith('/api/')) {
    return `${base}${path.slice(4)}`;
  }
  return `${base}${path}`;
}

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

export class CortexApiError extends Error {
  status: number;
  retryAfter: string | null;

  constructor(status: number, message: string, retryAfter: string | null = null) {
    super(message);
    this.name = 'CortexApiError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

async function readErrorMessage(res: Response): Promise<string> {
  const fallback = res.status === 503
    ? 'Starting up...'
    : res.status === 429
      ? 'Rate limit reached. Try again shortly.'
      : `Cortex API ${res.status}`;
  try {
    const body = await res.json();
    return typeof body?.error === 'string' ? body.error : fallback;
  } catch {
    return fallback;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authedFetch(apiUrl(path), init);
  if (!res.ok) {
    throw new CortexApiError(res.status, await readErrorMessage(res), res.headers.get('Retry-After'));
  }
  return res.json() as Promise<T>;
}

export interface WorkerEvent {
  type: 'started' | 'output' | 'completed' | 'failed';
  task_id?: string;
  step_id?: string;
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
      const res = await authedFetch(apiUrl('/api/chat'), {
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
  return requestJson<ProviderAuthInfo[]>('/api/auth/status');
}

export async function startAuth(provider: string): Promise<AuthStartResponse> {
  return requestJson<AuthStartResponse>('/api/auth/start', {
    method: 'POST',
    body: JSON.stringify({ provider }),
  });
}

export async function submitAuthCode(provider: string, code: string): Promise<{ success: boolean; message: string }> {
  return requestJson<{ success: boolean; message: string }>('/api/auth/submit', {
    method: 'POST',
    body: JSON.stringify({ provider, code }),
  });
}

export async function refreshAuth(): Promise<ProviderAuthInfo[]> {
  return requestJson<ProviderAuthInfo[]>('/api/auth/refresh', { method: 'POST' });
}

export async function getProviders() {
  return requestJson('/api/providers');
}

export async function getHealth() {
  return requestJson('/api/health');
}

export async function getCortexState(): Promise<CortexState> {
  return requestJson<CortexState>('/api/cortex/state');
}

export interface SomaIdentity {
  did: string;
  genome?: unknown;
  protocol: string;
  heartbeats: number;
  head_hash?: string;
  capabilities?: unknown;
}

export async function getSomaIdentity(): Promise<SomaIdentity> {
  return requestJson<SomaIdentity>('/api/soma/identity');
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
  return requestJson<GitHubStatus>('/api/user/github/status');
}

export async function selectRepos(repoIds: number[]): Promise<void> {
  await authedFetch(apiUrl('/api/user/repos/select'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_ids: repoIds }),
  });
}

export async function getUserProfile() {
  return requestJson('/api/user/profile');
}

export interface UserRoutingSettings {
  profile: string;
  auto_mode?: string;
  pressure?: unknown;
}

export async function getUserRouting(): Promise<UserRoutingSettings> {
  return requestJson<UserRoutingSettings>('/api/user/routing');
}

export async function updateUserRouting(profile: string): Promise<UserRoutingSettings> {
  return requestJson<UserRoutingSettings>('/api/user/routing', {
    method: 'POST',
    body: JSON.stringify({ profile }),
  });
}

export interface UsageSummary {
  last_24h?: unknown;
  last_30d?: unknown;
  gate?: unknown;
}

export interface DailyUsage {
  date: string;
  tokens_in?: number;
  tokens_out?: number;
  cost?: number;
  steps?: number;
}

export async function getUsage(): Promise<UsageSummary> {
  return requestJson<UsageSummary>('/api/usage');
}

export async function getDailyUsage(days = 30): Promise<DailyUsage[]> {
  return requestJson<DailyUsage[]>(`/api/usage/daily?days=${days}`);
}

export interface AdminStats {
  runs?: unknown;
  steps?: unknown;
  workers?: unknown;
  users?: unknown;
  decisions?: unknown;
}

export interface AdminWorkers {
  connected?: unknown[];
  all?: unknown[];
  count?: number;
}

export async function getAdminStats(): Promise<AdminStats> {
  return requestJson<AdminStats>('/api/admin/stats');
}

export async function getAdminWorkers(): Promise<AdminWorkers> {
  return requestJson<AdminWorkers>('/api/admin/workers');
}

// Decision ledger

export interface LedgerEntry {
  id: string;
  timestamp: string;
  event: {
    type: string;
    task_id?: string;
    provider?: string;
    model?: string;
    tier?: string;
    risk?: string;
    rationale?: string[];
    score?: number;
    alternatives_considered?: Array<{
      provider?: string;
      model?: string;
      tier?: string;
      score?: number;
    }>;
    status?: string;
    duration_ms?: number;
    files_changed?: number;
    tests_passed?: boolean | null;
    authenticated?: boolean;
    pressure?: number;
  };
}

export async function getLedger(): Promise<LedgerEntry[]> {
  return requestJson<LedgerEntry[]>('/api/ledger');
}

// Runs

export type RunStepStatus = 'pending' | 'leased' | 'running' | 'succeeded' | 'failed' | string;

export interface RunStep {
  id: string;
  status: RunStepStatus;
  goal?: string;
  title?: string;
  kind?: string;
  objective?: string;
  error?: string | null;
  parent_id?: string | null;
}

export interface RunSummary {
  id: string;
  goal: string;
  status?: string;
  profile?: string;
  created_at?: string;
  steps: RunStep[];
}

export interface RunListItem {
  id: string;
  goal: string;
  status: string;
  profile: string;
  created_at: string;
}

export interface CreateRunResponse {
  run_id: string;
  steps: number;
}

export interface RunStreamEvent {
  type: 'run_update' | 'run_complete';
  run_id: string;
  steps?: RunStep[];
  status?: string;
}

export async function createRun(
  goal: string,
  profile: string,
  filePaths: string[] = [],
): Promise<CreateRunResponse> {
  return requestJson<CreateRunResponse>('/api/runs', {
    method: 'POST',
    body: JSON.stringify({ goal, file_paths: filePaths, profile }),
  });
}

export async function getRun(runId: string): Promise<RunSummary> {
  return requestJson<RunSummary>(`/api/runs/${runId}`);
}

export async function listRuns(limit = 10, offset = 0): Promise<RunListItem[]> {
  return requestJson<RunListItem[]>(`/api/runs?limit=${limit}&offset=${offset}`);
}

export async function createRunPullRequest(
  runId: string,
  body: { title?: string; base?: string } = {},
): Promise<{ pr_url: string; branch: string }> {
  return requestJson<{ pr_url: string; branch: string }>(`/api/runs/${runId}/pr`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function streamRun(
  runId: string,
  onEvent: (event: RunStreamEvent) => void,
  onError: (err: Error) => void,
): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await authedFetch(apiUrl(`/api/runs/${runId}/stream`), {
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new CortexApiError(res.status, await readErrorMessage(res), res.headers.get('Retry-After'));
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
            onEvent(JSON.parse(json) as RunStreamEvent);
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') onError(err);
    }
  })();

  return controller;
}

// Conversations

export interface ConversationSummary {
  id: string;
  title: string | null;
  updated_at: string;
  message_count: number;
  last_message_preview: string | null;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  provider: string | null;
  model: string | null;
  created_at: string;
}

export interface ConversationWithMessages {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  messages: ConversationMessage[];
}

export async function listConversations(userId = 'local'): Promise<ConversationSummary[]> {
  const res = await authedFetch(apiUrl(`/api/conversations?user_id=${userId}`));
  return res.json();
}

export async function createConversation(userId = 'local', title?: string): Promise<{ id: string }> {
  const res = await authedFetch(apiUrl('/api/conversations'), {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, title }),
  });
  return res.json();
}

export async function getConversation(id: string, userId = 'local'): Promise<ConversationWithMessages> {
  const res = await authedFetch(apiUrl(`/api/conversations/${id}?user_id=${userId}`));
  return res.json();
}

export async function deleteConversation(id: string, userId = 'local'): Promise<void> {
  await authedFetch(apiUrl(`/api/conversations/${id}?user_id=${userId}`), { method: 'DELETE' });
}

export async function updateConversationTitle(id: string, title: string, userId = 'local'): Promise<void> {
  await authedFetch(apiUrl(`/api/conversations/${id}?user_id=${userId}`), {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

export async function addMessageToConversation(
  conversationId: string,
  role: string,
  content: string,
  provider?: string,
  model?: string,
): Promise<ConversationMessage> {
  const res = await authedFetch(apiUrl(`/api/conversations/${conversationId}/messages`), {
    method: 'POST',
    body: JSON.stringify({ role, content, provider, model }),
  });
  return res.json();
}
