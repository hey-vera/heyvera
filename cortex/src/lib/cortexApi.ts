import type { CortexState } from '../types';

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

export class CortexApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'CortexApiError';
    this.status = status;
  }
}

async function readErrorMessage(res: Response): Promise<string> {
  const fallback = res.status === 503 ? 'Starting up...' : `Cortex API ${res.status}`;
  try {
    const body = await res.json();
    return typeof body?.error === 'string' ? body.error : fallback;
  } catch {
    return fallback;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authedFetch(`${BASE_URL}${path}`, init);
  if (!res.ok) {
    throw new CortexApiError(res.status, await readErrorMessage(res));
  }
  return res.json() as Promise<T>;
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
  return requestJson<ProviderAuthInfo[]>('/api/auth/status');
}

export async function startAuth(provider: string): Promise<AuthStartResponse> {
  const res = await authedFetch(`${BASE_URL}/api/auth/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider }),
  });
  return res.json();
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
  await authedFetch(`${BASE_URL}/api/user/repos/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_ids: repoIds }),
  });
}

export async function getUserProfile() {
  return requestJson('/api/user/profile');
}

// Runs

export type RunStepStatus = 'pending' | 'leased' | 'running' | 'succeeded' | 'failed' | string;

export interface RunStep {
  id: string;
  status: RunStepStatus;
  goal?: string;
  title?: string;
  error?: string | null;
  parent_id?: string | null;
}

export interface RunSummary {
  id: string;
  goal: string;
  steps: RunStep[];
}

export interface CreateRunResponse {
  run_id: string;
  steps: number;
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
  const res = await authedFetch(`${BASE_URL}/api/conversations?user_id=${userId}`);
  return res.json();
}

export async function createConversation(userId = 'local', title?: string): Promise<{ id: string }> {
  const res = await authedFetch(`${BASE_URL}/api/conversations`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, title }),
  });
  return res.json();
}

export async function getConversation(id: string, userId = 'local'): Promise<ConversationWithMessages> {
  const res = await authedFetch(`${BASE_URL}/api/conversations/${id}?user_id=${userId}`);
  return res.json();
}

export async function deleteConversation(id: string, userId = 'local'): Promise<void> {
  await authedFetch(`${BASE_URL}/api/conversations/${id}?user_id=${userId}`, { method: 'DELETE' });
}

export async function updateConversationTitle(id: string, title: string, userId = 'local'): Promise<void> {
  await authedFetch(`${BASE_URL}/api/conversations/${id}?user_id=${userId}`, {
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
  const res = await authedFetch(`${BASE_URL}/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ role, content, provider, model }),
  });
  return res.json();
}
