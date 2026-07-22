// ─── Pulse API client — agent-assisted publishing draft pipeline ────────────

export type PulseDraft = {
  id: string;
  profileId: string;
  body: string;
  visibility: string;
  authorMode: string;
  linkedAgentId: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'published';
  createdAt: string;
  updatedAt: string;
};

export type PulseAuditEntry = {
  id: string;
  draftId: string;
  action: string;
  actorProfileId: string;
  details: Record<string, unknown> | null;
  createdAt: string;
};

// ─── API base URL ───────────────────────────────────────────────────────────

const PULSE_API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/v1/pulse`
  : '/v1/pulse';

// ─── Fetch helper ───────────────────────────────────────────────────────────

export class PulseApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code?: string | null) {
    super(message);
    this.name = 'PulseApiError';
    this.status = status;
    this.code = code ?? null;
  }
}

async function pulseAuthFetch<T>(
  path: string,
  options: {
    method: string;
    token: string;
    body?: unknown;
  },
): Promise<T> {
  const res = await fetch(`${PULSE_API_BASE}${path}`, {
    method: options.method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.token}`,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
    };
    throw new PulseApiError(
      err.error ?? `API error ${res.status}`,
      res.status,
      err.code ?? null,
    );
  }
  return res.json() as Promise<T>;
}

// ─── Draft endpoints ────────────────────────────────────────────────────────

export async function createDraft(
  token: string,
  data: {
    body: string;
    visibility?: string;
    authorMode?: string;
    linkedAgentId?: string;
  },
): Promise<{ ok: true; draft: PulseDraft }> {
  return pulseAuthFetch('/drafts', { method: 'POST', token, body: data });
}

export async function listDrafts(
  token: string,
  status?: string,
): Promise<{ drafts: PulseDraft[] }> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return pulseAuthFetch(`/drafts${qs}`, { method: 'GET', token });
}

export async function getDraft(
  token: string,
  id: string,
): Promise<{ draft: PulseDraft }> {
  return pulseAuthFetch(`/drafts/${id}`, { method: 'GET', token });
}

export async function approveDraft(
  token: string,
  id: string,
): Promise<{ ok: true; draft: PulseDraft }> {
  return pulseAuthFetch(`/drafts/${id}/approve`, { method: 'POST', token });
}

export async function rejectDraft(
  token: string,
  id: string,
  reason?: string,
): Promise<{ ok: true; draft: PulseDraft }> {
  return pulseAuthFetch(`/drafts/${id}/reject`, {
    method: 'POST',
    token,
    body: reason ? { reason } : {},
  });
}

export async function publishDraft(
  token: string,
  id: string,
): Promise<{ ok: true; draft: PulseDraft; postId: string }> {
  return pulseAuthFetch(`/drafts/${id}/publish`, { method: 'POST', token });
}

export async function getDraftAudit(
  token: string,
  id: string,
): Promise<{ audit: PulseAuditEntry[] }> {
  return pulseAuthFetch(`/drafts/${id}/audit`, { method: 'GET', token });
}

// ─── Chat (tools_v1 keyword router; tools_v2 when server has LLM keys) ───────

/** tools_v1 = deterministic keywords; tools_v2 = LLM tool JSON (server keys only). */
export type PulseChatMode = 'tools_v1' | 'tools_v2' | string;

export type PulseChatResponse = {
  reply: string;
  mode: PulseChatMode;
  toolsUsed: string[];
  draft: PulseDraft | null;
  draftCount?: number;
  postId?: string;
  schedule?: PulseSchedule;
};

export type PulseSchedule = {
  id: string;
  draftId: string;
  publishAt: string;
  status: string;
  profileId?: string;
  createdAt?: string;
};

/** Call backend Pulse tools. Mode is tools_v2 only when server has LLM API keys. */
export async function pulseChat(
  token: string,
  message: string,
  history?: Array<{ role: string; content: string }>,
): Promise<PulseChatResponse> {
  return pulseAuthFetch('/chat', {
    method: 'POST',
    token,
    body: { message, history: history ?? [] },
  });
}

/** Schedule an approved draft for later publish. */
export async function scheduleDraft(
  token: string,
  draftId: string,
  publishAt: string,
): Promise<{ ok: true; schedule: PulseSchedule }> {
  return pulseAuthFetch('/schedules', {
    method: 'POST',
    token,
    body: { draftId, publishAt },
  });
}

export async function listSchedules(
  token: string,
): Promise<{ schedules: PulseSchedule[] }> {
  return pulseAuthFetch('/schedules', { method: 'GET', token });
}

// ─── Goal plan MVP (deterministic template; not Temporal) ───────────────────

export type PulseGoalStep = {
  tool: 'create_draft' | 'approve_required' | 'schedule_optional' | string;
  args: Record<string, unknown>;
  description: string;
  status: string;
};

export type PulseGoal = {
  id: string;
  profileId: string;
  goal: string;
  status: 'active' | 'completed' | 'cancelled' | string;
  plan: {
    goal?: string;
    runtime?: string;
    note?: string;
    tools?: string[];
    [key: string]: unknown;
  };
  steps: PulseGoalStep[];
  createdAt: string;
  updatedAt: string;
};

/** Create a goal; server returns a deterministic plan template (not Temporal). */
export async function createGoal(
  token: string,
  goal: string,
): Promise<{ ok: true; goal: PulseGoal }> {
  return pulseAuthFetch('/goals', {
    method: 'POST',
    token,
    body: { goal },
  });
}

export async function listGoals(
  token: string,
): Promise<{ goals: PulseGoal[] }> {
  return pulseAuthFetch('/goals', { method: 'GET', token });
}

export async function getGoal(
  token: string,
  id: string,
): Promise<{ goal: PulseGoal }> {
  return pulseAuthFetch(`/goals/${id}`, { method: 'GET', token });
}
