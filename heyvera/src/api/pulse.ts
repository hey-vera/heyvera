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
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ?? `API error ${res.status}`,
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
