/**
 * Billing / usage client for Premium.
 * Paths use `/api/billing/*` (same host or VITE_API_URL without trailing /v1).
 */

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

/** Resolve `/api/billing/*` against optional VITE_API_URL (which may end with `/v1`). */
export function resolveBillingPath(path: string): string {
  if (!API_BASE) return path;
  if (API_BASE.endsWith('/v1')) return `${API_BASE.replace(/\/v1$/, '')}${path}`;
  return `${API_BASE}${path}`;
}

/**
 * Coerce raw credits balance fields to number | null.
 * Never invent a default balance client-side.
 */
export function coerceCreditsBalance(
  creditsBalance: unknown,
  credits_balance?: unknown,
): number | null {
  if (creditsBalance === undefined && credits_balance === undefined) {
    return null;
  }
  const v = creditsBalance !== undefined ? creditsBalance : credits_balance;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Map server note + balance presence to honest UI label. */
export function billingMeteredLabel(
  creditsBalance: number | null,
  note?: string | null,
): { metered: boolean; label: string } {
  if (creditsBalance !== null && creditsBalance !== undefined) {
    return { metered: true, label: note?.trim() || 'metered' };
  }
  return {
    metered: false,
    label: note?.trim() || 'ledger balance not metered yet',
  };
}

export type BillingUsageWindow = {
  total_tokens_in: number;
  total_tokens_out: number;
  total_cost_estimate: number;
  step_count: number;
};

export type BillingUsageSummary = {
  last_24h: BillingUsageWindow;
  last_30d: BillingUsageWindow;
  daily_cost: number;
  daily_steps: number;
  monthly_cost: number;
};

export type BillingHistoryEntry = {
  date: string;
  amount_cents: number;
  description: string;
  status: string;
};

export type BillingUsageResponse = {
  active: boolean;
  access_state: string;
  plan?: {
    plan_type?: string;
    status?: string;
    billing_period_end?: string;
  } | null;
  /** null until a real metered ledger is wired — never invent a balance client-side. */
  creditsBalance: number | null;
  usage: BillingUsageSummary;
  history: BillingHistoryEntry[];
  note: string;
};

/**
 * GET /api/billing/usage — subscription access, usage aggregates, billing history.
 * Returns null when the request fails (network/auth/non-OK).
 */
export async function fetchBillingUsage(token: string): Promise<BillingUsageResponse | null> {
  try {
    const res = await fetch(resolveBillingPath('/api/billing/usage'), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as {
      active?: boolean;
      access_state?: string;
      plan?: BillingUsageResponse['plan'];
      creditsBalance?: number | null;
      credits_balance?: number | null;
      usage?: Partial<BillingUsageSummary> & {
        last_24h?: Partial<BillingUsageWindow>;
        last_30d?: Partial<BillingUsageWindow>;
      };
      history?: BillingHistoryEntry[];
      note?: string;
    };

    const emptyWindow = (): BillingUsageWindow => ({
      total_tokens_in: 0,
      total_tokens_out: 0,
      total_cost_estimate: 0,
      step_count: 0,
    });

    const mapWindow = (w?: Partial<BillingUsageWindow>): BillingUsageWindow => ({
      total_tokens_in: Number(w?.total_tokens_in ?? 0),
      total_tokens_out: Number(w?.total_tokens_out ?? 0),
      total_cost_estimate: Number(w?.total_cost_estimate ?? 0),
      step_count: Number(w?.step_count ?? 0),
    });

    // Prefer explicit null over inventing a balance when the field is missing.
    const creditsBalance = coerceCreditsBalance(
      raw.creditsBalance,
      raw.credits_balance,
    );

    return {
      active: raw.active === true,
      access_state: raw.access_state ?? '',
      plan: raw.plan ?? null,
      creditsBalance,
      usage: {
        last_24h: mapWindow(raw.usage?.last_24h) || emptyWindow(),
        last_30d: mapWindow(raw.usage?.last_30d) || emptyWindow(),
        daily_cost: Number(raw.usage?.daily_cost ?? 0),
        daily_steps: Number(raw.usage?.daily_steps ?? 0),
        monthly_cost: Number(raw.usage?.monthly_cost ?? 0),
      },
      history: Array.isArray(raw.history) ? raw.history : [],
      note: raw.note ?? 'ledger balance not metered yet',
    };
  } catch {
    return null;
  }
}
