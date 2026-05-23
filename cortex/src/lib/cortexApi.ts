import type { ChatSessionControls, CortexState, RunProfile, SovereigntyLoopState, TaskManagerState } from '../types';

const CONFIGURED_API_BASE = import.meta.env.VITE_CORTEX_API as string | undefined;
const BASE_URL = CONFIGURED_API_BASE ?? (import.meta.env.DEV ? 'http://localhost:3001' : 'https://api.heyvera.org');
export const MEMORY_API_ENABLED = import.meta.env.VITE_CORTEX_MEMORY_ENABLED === 'true';

function apiUrl(path: string) {
  const base = BASE_URL.replace(/\/$/, '');
  if (!base) return path;
  if (base.endsWith('/api') && path.startsWith('/api/')) {
    return `${base}${path.slice(4)}`;
  }
  return `${base}${path}`;
}

let _tokenGetter: (() => Promise<string | null>) | null = null;
let _somaDelegation: SomaDelegation | null = null;

export function setAuthTokenGetter(getter: () => Promise<string | null>) {
  _tokenGetter = getter;
}

export function setSomaDelegation(delegation: SomaDelegation | null) {
  _somaDelegation = delegation;
}

async function getAuthToken(): Promise<string | null> {
  if (!_tokenGetter) return null;
  return _tokenGetter();
}

async function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (_somaDelegation) {
    headers.set('Authorization', `Soma ${JSON.stringify(_somaDelegation)}`);
  } else {
    const token = await getAuthToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && init?.method && init.method !== 'GET') {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(url, { ...init, headers });
}

async function bearerFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = await getAuthToken();
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

async function requestBillingJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await bearerFetch(apiUrl(path), init);
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
  routingContext: {
    controls: ChatSessionControls;
    run_profile: RunProfile;
    sovereignty: SovereigntyLoopState;
  } | null,
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
        body: JSON.stringify({
          message,
          file_paths: filePaths,
          routing_context: routingContext,
        }),
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

export interface SomaDelegation {
  id: string;
  issuer_did: string;
  subject_did: string;
  capabilities: string[];
  caveats?: Array<{ type?: string; timestamp?: number; [key: string]: unknown }>;
  issued_at: number;
  signature: string;
}

export interface SomaSession {
  delegation: SomaDelegation;
  user_identity: { did: string; public_key: string; created_at: number };
  cortex_did: string;
  root_did: string | null;
}

export interface SomaUserIdentity {
  did: string;
  public_key: string;
  has_delegation: boolean;
}

export async function createSomaSession(): Promise<SomaSession> {
  return requestJson<SomaSession>('/api/soma/session', { method: 'POST' });
}

export async function getSomaMe(): Promise<SomaUserIdentity> {
  return requestJson<SomaUserIdentity>('/api/soma/me');
}

export interface SomaSpendDelegation {
  delegation_id: string;
  subject_did: string;
  cumulative_spend: number;
  receipt_count: number;
  last_activity_ms: number | null;
  capabilities: string[];
}

export interface SomaSpendSummary {
  delegations: SomaSpendDelegation[];
  total_spend: number;
}

export interface SomaSpendReceipt {
  amount: number;
  cumulative: number;
  capability: string;
  timestamp: number;
}

export interface SomaDelegationSpend {
  delegation_id: string;
  receipts: SomaSpendReceipt[];
  cumulative: number;
}

export async function getSomaSpend(): Promise<SomaSpendSummary> {
  return requestJson<SomaSpendSummary>('/api/soma/spend');
}

export async function getSomaDelegationSpend(delegationId: string): Promise<SomaDelegationSpend> {
  return requestJson<SomaDelegationSpend>(`/api/soma/spend/${encodeURIComponent(delegationId)}`);
}

export async function revokeSomaDelegation(delegationId: string, subjectDid: string): Promise<{ revoked: boolean }> {
  return requestJson<{ revoked: boolean }>('/api/soma/revoke', {
    method: 'POST',
    body: JSON.stringify({ delegation_id: delegationId, subject_did: subjectDid }),
  });
}

export type BillingAccessState =
  | 'signed_out'
  | 'needs_phone'
  | 'needs_checkout'
  | 'trial_active'
  | 'active'
  | 'payment_failed'
  | 'cancelled';

export interface BillingStatus {
  access_state: BillingAccessState;
  plan: {
    plan_type: 'monthly' | 'annual';
    status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'paused';
    billing_period_end: string;
    next_charge_amount_cents: number | null;
    next_charge_date: string | null;
    started_at: string;
  } | null;
  trial: {
    trial_end: string;
    days_remaining: number;
    auto_charge_amount_cents: number;
    auto_charge_plan: 'monthly' | 'annual';
  } | null;
  delegation: {
    status: 'active' | 'pending' | 'expired' | 'revoked' | 'not_issued';
    budget_enforced: boolean;
    delegation_id: string | null;
    expires_at: string | null;
  };
  payment_method: {
    last4: string;
    brand: string;
    exp_month: number;
    exp_year: number;
  } | null;
  referral: {
    code: string;
    uses_remaining: number;
    total_uses: number;
    weeks_earned: number;
  } | null;
}

export interface CheckoutResponse {
  checkout_url: string;
  session_id: string;
}

export interface DiscountOption {
  label: string;
  discount_type: string;
  discount_value: number;
}

export interface ReferralValidateResponse {
  valid: boolean;
  discount_type: string | null;
  discount_value: number | null;
  description: string | null;
  options: DiscountOption[];
  uses_remaining: number | null;
  error: string | null;
}

export interface BillingHistoryEntry {
  date: string;
  amount_cents: number;
  description: string;
  status: string;
}

export async function getBillingStatus(): Promise<BillingStatus> {
  return requestBillingJson<BillingStatus>('/api/billing/status');
}

export async function createBillingCheckout(body: {
  plan: 'monthly' | 'annual';
  email?: string;
  referral_code?: string;
  referral_choice?: string;
}): Promise<CheckoutResponse> {
  return requestBillingJson<CheckoutResponse>('/api/billing/checkout', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function createBillingPortal(): Promise<{ portal_url: string }> {
  return requestBillingJson<{ portal_url: string }>('/api/billing/portal', { method: 'POST' });
}

export async function validateReferralCode(code: string): Promise<ReferralValidateResponse> {
  return requestBillingJson<ReferralValidateResponse>('/api/billing/referral/validate', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export async function getBillingHistory(): Promise<BillingHistoryEntry[]> {
  return requestBillingJson<BillingHistoryEntry[]>('/api/billing/history');
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

export async function getGroupTaskManagerState(groupId: string): Promise<TaskManagerState> {
  return requestJson<TaskManagerState>(`/api/groups/${encodeURIComponent(groupId)}/tasks`);
}

export async function updateGroupTaskManagerState(
  groupId: string,
  state: TaskManagerState,
): Promise<TaskManagerState> {
  return requestJson<TaskManagerState>(`/api/groups/${encodeURIComponent(groupId)}/tasks`, {
    method: 'PUT',
    body: JSON.stringify(state),
  });
}

export interface IntegrationConnection {
  id: string;
  provider: 'slack' | 'replit' | string;
  external_id: string | null;
  display_name: string;
  status: 'connected' | 'needs_config' | 'degraded' | string;
  scopes: string[];
  metadata: Record<string, unknown>;
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntegrationMapping {
  id: string;
  provider: 'slack' | 'replit' | string;
  group_id: string;
  external_id: string;
  external_name: string;
  mapping_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface IntegrationStatus {
  connections: IntegrationConnection[];
  mappings: IntegrationMapping[];
  slack_configured: boolean;
  replit_configured: boolean;
}

export interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  member_count: number;
}

export interface ReplitWorkspace {
  id: string;
  title: string;
  language: string;
  url: string | null;
}

export async function getIntegrationStatus(): Promise<IntegrationStatus> {
  return requestJson<IntegrationStatus>('/api/integrations/status');
}

export async function startSlackOAuth(): Promise<{ auth_url: string; state: string }> {
  return requestJson<{ auth_url: string; state: string }>('/api/integrations/slack/oauth/start', {
    method: 'POST',
    body: JSON.stringify({ redirect_after: window.location.pathname }),
  });
}

export async function getSlackChannels(): Promise<SlackChannel[]> {
  return requestJson<SlackChannel[]>('/api/integrations/slack/channels');
}

export async function importSlackChannels(channels: SlackChannel[]): Promise<{ groups: unknown[]; mappings: IntegrationMapping[] }> {
  return requestJson<{ groups: unknown[]; mappings: IntegrationMapping[] }>('/api/integrations/slack/import-channels', {
    method: 'POST',
    body: JSON.stringify({ channels }),
  });
}

export async function getReplitWorkspaces(): Promise<ReplitWorkspace[]> {
  return requestJson<ReplitWorkspace[]>('/api/integrations/replit/workspaces');
}

export async function importReplitWorkspace(workspace: ReplitWorkspace): Promise<{ groups: unknown[]; mappings: IntegrationMapping[] }> {
  return requestJson<{ groups: unknown[]; mappings: IntegrationMapping[] }>('/api/integrations/replit/import', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id: workspace.id,
      title: workspace.title,
      language: workspace.language,
    }),
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

// Admin — Promo Codes

export interface PromoCode {
  id: string;
  code: string;
  discount_type: 'trial_extension' | 'percent_off' | 'free_trial';
  discount_value: number;
  max_uses: number;
  current_uses: number;
  expires_at: string | null;
  active: boolean;
  created_by: string;
  created_at: string;
  description: string | null;
}

export interface CreatePromoCodeRequest {
  code: string;
  discount_type: string;
  discount_value: number;
  max_uses?: number;
  expires_at?: string;
  description?: string;
  discount_options?: DiscountOption[];
}

export interface UpdatePromoCodeRequest {
  active?: boolean;
  max_uses?: number;
  expires_at?: string | null;
  description?: string | null;
}

export interface CodeRedemption {
  id: string;
  promo_code_id: string;
  code: string;
  user_id: string;
  redeemed_at: string;
}

export async function getAdminPromoCodes(): Promise<{ codes: PromoCode[]; total: number }> {
  return requestJson<{ codes: PromoCode[]; total: number }>('/api/admin/codes');
}

export async function createAdminPromoCode(req: CreatePromoCodeRequest): Promise<PromoCode> {
  return requestJson<PromoCode>('/api/admin/codes', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function updateAdminPromoCode(id: string, req: UpdatePromoCodeRequest): Promise<{ updated: boolean }> {
  return requestJson<{ updated: boolean }>(`/api/admin/codes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(req),
  });
}

export async function deleteAdminPromoCode(id: string): Promise<{ deleted: boolean }> {
  return requestJson<{ deleted: boolean }>(`/api/admin/codes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function getAdminRedemptions(code?: string): Promise<{ redemptions: CodeRedemption[]; total: number }> {
  const query = code ? `?code=${encodeURIComponent(code)}` : '';
  return requestJson<{ redemptions: CodeRedemption[]; total: number }>(`/api/admin/redemptions${query}`);
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
  work_kind?: string;
  tier?: string;
  risk?: string;
  objective?: string;
  attempt_count?: number;
  max_attempts?: number;
  lease_gen?: number;
  lease_deadline?: number | null;
  assigned_worker?: string | null;
  lease_stale?: boolean;
  health?: string;
  blocked_by?: Array<{ id?: string; status?: string; edge_type?: string }>;
  latest_attempt?: {
    attempt_number?: number;
    worker_id?: string | null;
    lease_gen?: number;
    status?: string;
    provider?: string | null;
    model?: string | null;
    started_at?: number;
    finished_at?: number | null;
    failure_kind?: string | null;
    error_summary?: string | null;
  };
  error?: string | null;
  last_error?: string | null;
  output_summary?: string | null;
  files_changed?: string[] | null;
  verification_status?: string | null;
  verifier_verdict?: string | null;
  verifier_report_id?: string | null;
  recipe_seed?: unknown;
  work_recipe?: {
    version?: number;
    kind?: string;
    target_paths?: string[];
    acceptance?: Array<{ id?: string; text?: string; verification?: unknown }>;
    constraints?: string[];
    required_checks?: Array<{ name?: string; command?: string; required?: boolean }>;
  } | null;
  acceptance_criteria?: string[];
  required_checks?: Array<{ name?: string; command?: string; required?: boolean }>;
  predecessors?: string[];
  parent_id?: string | null;
}

export interface RunGraphNode {
  id: string;
  label: string;
  status?: string | null;
  kind?: string | null;
  work_kind?: string | null;
  tier?: string | null;
  risk?: string | null;
  verification_status?: string | null;
}

export interface RunGraphEdge {
  from: string;
  to: string;
  edge_type: 'success_required' | 'completion_required' | string;
}

export interface RunGraph {
  nodes: RunGraphNode[];
  edges: RunGraphEdge[];
}

export interface RunSummary {
  id: string;
  goal: string;
  status?: string;
  profile?: string;
  created_at?: string;
  steps: RunStep[];
  graph?: RunGraph;
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
  graph?: RunGraph;
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

export async function listConversations(_userId = 'local'): Promise<ConversationSummary[]> {
  void _userId;
  const res = await authedFetch(apiUrl('/api/conversations'));
  return res.json();
}

export async function createConversation(_userId = 'local', title?: string): Promise<{ id: string }> {
  void _userId;
  const res = await authedFetch(apiUrl('/api/conversations'), {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
  return res.json();
}

export async function getConversation(id: string, _userId = 'local'): Promise<ConversationWithMessages> {
  void _userId;
  const res = await authedFetch(apiUrl(`/api/conversations/${id}`));
  return res.json();
}

export async function deleteConversation(id: string, _userId = 'local'): Promise<void> {
  void _userId;
  await authedFetch(apiUrl(`/api/conversations/${id}`), { method: 'DELETE' });
}

export async function updateConversationTitle(id: string, title: string, _userId = 'local'): Promise<void> {
  void _userId;
  await authedFetch(apiUrl(`/api/conversations/${id}`), {
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

// Memory API

export interface MemoryStats {
  total: number;
  policies: number;
  team_rules: number;
  notes: number;
  avg_effectiveness: number;
}

export interface WorkspaceMemory {
  id: string;
  workspace_id: string;
  content: string;
  importance: 'Remember' | 'TeamRule' | 'Policy';
  created_by: string;
  created_at: string;
  expires_at: string | null;
  effectiveness_score: number;
  tags: string[];
}

export interface MemoryMatch {
  memory: WorkspaceMemory;
  relevance_score: number;
  match_reason: string;
}

export interface MemorySuggestion {
  text: string;
  category: 'remember' | 'recall' | 'forget' | 'list';
  command: string;
  description?: string;
}

export async function getMemoryStats(workspaceId = 'default'): Promise<MemoryStats> {
  if (!MEMORY_API_ENABLED) {
    void workspaceId;
    return { total: 0, policies: 0, team_rules: 0, notes: 0, avg_effectiveness: 0 };
  }
  return requestJson<MemoryStats>(`/api/memory/stats?workspace_id=${encodeURIComponent(workspaceId)}`);
}

export async function listMemories(
  workspaceId = 'default',
  importanceFilter?: string,
  limit = 20,
  offset = 0,
): Promise<WorkspaceMemory[]> {
  if (!MEMORY_API_ENABLED) {
    void workspaceId;
    void importanceFilter;
    void limit;
    void offset;
    return [];
  }
  const params = new URLSearchParams({
    workspace_id: workspaceId,
    limit: limit.toString(),
    offset: offset.toString(),
  });
  if (importanceFilter) {
    params.set('importance', importanceFilter);
  }
  return requestJson<WorkspaceMemory[]>(`/api/memory/memories?${params}`);
}

export async function searchMemories(
  query: string,
  workspaceId = 'default',
  limit = 10,
): Promise<MemoryMatch[]> {
  if (!MEMORY_API_ENABLED) {
    void query;
    void workspaceId;
    void limit;
    return [];
  }
  return requestJson<MemoryMatch[]>('/api/memory/memories/search', {
    method: 'POST',
    body: JSON.stringify({
      query,
      workspace_id: workspaceId,
      limit,
    }),
  });
}

export async function storeMemory(
  content: string,
  importance: 'Remember' | 'TeamRule' | 'Policy' = 'Remember',
  workspaceId = 'default',
  contextTrigger?: string,
  tags?: string[],
): Promise<WorkspaceMemory> {
  if (!MEMORY_API_ENABLED) {
    throw new CortexApiError(501, 'Cortex memory is not enabled.');
  }
  return requestJson<WorkspaceMemory>('/api/memory/memories', {
    method: 'POST',
    body: JSON.stringify({
      content,
      importance,
      workspace_id: workspaceId,
      context_trigger: contextTrigger,
      tags,
    }),
  });
}

export async function removeMemories(pattern: string, workspaceId = 'default'): Promise<{ count: number }> {
  if (!MEMORY_API_ENABLED) {
    void pattern;
    void workspaceId;
    return { count: 0 };
  }
  return requestJson<{ count: number }>('/api/memory/remove', {
    method: 'DELETE',
    body: JSON.stringify({
      pattern,
      workspace_id: workspaceId,
    }),
  });
}

export async function getMemorySuggestions(
  context?: {
    files?: string[];
    message?: string;
    recentMessages?: string[];
  },
): Promise<MemorySuggestion[]> {
  if (!MEMORY_API_ENABLED) {
    void context;
    return [];
  }
  return requestJson<MemorySuggestion[]>('/api/memory/suggestions', {
    method: 'POST',
    body: JSON.stringify(context || {}),
  });
}

export async function updateMemoryEffectiveness(
  memoryId: string,
  outcomeQuality: number,
): Promise<void> {
  if (!MEMORY_API_ENABLED) {
    void memoryId;
    void outcomeQuality;
    return;
  }
  await authedFetch(apiUrl(`/api/memory/memories/${encodeURIComponent(memoryId)}/effectiveness`), {
    method: 'POST',
    body: JSON.stringify({ outcome_quality: outcomeQuality }),
  });
}

// New memory-enhanced chat functions
export interface MemoryEnhancedChatRequest {
  message: string;
  files?: string[];
  workspaceId?: string;
  conversationId?: string;
  teamMembers?: string[];
  projectPhase?: string;
  activeTopics?: string[];
}

export interface MemoryEnhancedChatResponse {
  relevant_memories: MemoryMatch[];
  live_suggestions: LiveMemorySuggestion[];
  auto_capture?: AutoCaptureOpportunity;
  memory_stats: {
    total_memories: number;
    avg_effectiveness: number;
    recent_activity: number;
    context_quality: number;
  };
  enhanced_context: string;
}

export interface LiveMemorySuggestion {
  suggestion_id: string;
  suggestion_type: 'ProactiveMemory' | 'ContextualRetrieval' | 'KnowledgeGap' | 'ConflictWarning';
  relevance_score: number;
  confidence: number;
  suggestion: {
    suggested_content: string;
    prediction_type: string;
  };
  trigger_reason: string;
  suggested_action: string;
}

export interface AutoCaptureOpportunity {
  opportunity_id: string;
  content: string;
  suggested_importance: 'Remember' | 'TeamRule' | 'Policy';
  confidence: number;
  rationale: string;
  suggested_tags: string[];
  requires_approval: boolean;
}

export async function processMemoryEnhancedChat(
  request: MemoryEnhancedChatRequest
): Promise<MemoryEnhancedChatResponse> {
  if (!MEMORY_API_ENABLED) {
    void request;
    return {
      relevant_memories: [],
      live_suggestions: [],
      memory_stats: {
        total_memories: 0,
        avg_effectiveness: 0,
        recent_activity: 0,
        context_quality: 0,
      },
      enhanced_context: '',
    };
  }
  return requestJson<MemoryEnhancedChatResponse>('/api/memory/chat/process', {
    method: 'POST',
    body: JSON.stringify({
      message: {
        content: request.message,
        sender: 'user', // Would get from auth
        metadata: {},
      },
      context: {
        conversation_id: request.conversationId || 'default',
        messages: [{
          content: request.message,
          sender: 'user',
          metadata: {},
        }],
        current_files: request.files || [],
        active_topics: request.activeTopics || [],
        workspace_id: request.workspaceId || 'default',
        team_members: request.teamMembers || [],
        project_phase: request.projectPhase || 'development',
        priority_areas: [],
        knowledge_gaps: [],
      },
    }),
  });
}

export async function applyMemorySuggestion(suggestionId: string): Promise<void> {
  if (!MEMORY_API_ENABLED) {
    void suggestionId;
    return;
  }
  return requestJson<void>(`/api/memory/chat/suggestions/${encodeURIComponent(suggestionId)}/apply`, {
    method: 'POST',
  });
}

export async function createFromAutoCapture(
  opportunity: AutoCaptureOpportunity,
  workspaceId = 'default'
): Promise<WorkspaceMemory> {
  if (!MEMORY_API_ENABLED) {
    throw new CortexApiError(501, 'Cortex memory is not enabled.');
  }
  return requestJson<WorkspaceMemory>('/api/memory/chat/auto-capture', {
    method: 'POST',
    body: JSON.stringify({
      ...opportunity,
      workspace_id: workspaceId,
    }),
  });
}
