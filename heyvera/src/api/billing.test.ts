import { beforeEach, describe, expect, it, vi } from 'vitest';

type FetchMock = ReturnType<typeof vi.fn>;

function mockFetch(): FetchMock {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('fetchBillingUsage', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('hits GET /api/billing/usage with bearer token and maps real payload', async () => {
    vi.stubEnv('VITE_API_URL', '/v1');
    const fetchMock = mockFetch();

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        active: true,
        access_state: 'active',
        plan: { plan_type: 'monthly', status: 'active', billing_period_end: '2026-08-01' },
        creditsBalance: null,
        usage: {
          last_24h: {
            total_tokens_in: 100,
            total_tokens_out: 50,
            total_cost_estimate: 0.01,
            step_count: 2,
          },
          last_30d: {
            total_tokens_in: 1000,
            total_tokens_out: 500,
            total_cost_estimate: 0.2,
            step_count: 20,
          },
          daily_cost: 0.01,
          daily_steps: 2,
          monthly_cost: 0.2,
        },
        history: [
          {
            date: '2026-07-01T00:00:00Z',
            amount_cents: 699,
            description: 'Invoice paid',
            status: 'paid',
          },
        ],
        note: 'ledger balance not metered yet',
      }),
    });

    const { fetchBillingUsage } = await import('./billing');
    const result = await fetchBillingUsage('tok-abc');

    expect(fetchMock).toHaveBeenCalledWith('/api/billing/usage', {
      headers: { Authorization: 'Bearer tok-abc' },
    });
    expect(result).not.toBeNull();
    expect(result!.active).toBe(true);
    expect(result!.access_state).toBe('active');
    expect(result!.creditsBalance).toBeNull();
    expect(result!.usage.last_24h.step_count).toBe(2);
    expect(result!.usage.last_30d.total_tokens_in).toBe(1000);
    expect(result!.history).toHaveLength(1);
    expect(result!.history[0]?.amount_cents).toBe(699);
    expect(result!.note).toContain('not metered');
  });

  it('never invents a credits balance when field is absent', async () => {
    vi.stubEnv('VITE_API_URL', '');
    const fetchMock = mockFetch();

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        active: false,
        access_state: 'needs_checkout',
        usage: {},
        history: [],
      }),
    });

    const { fetchBillingUsage } = await import('./billing');
    const result = await fetchBillingUsage('tok');

    expect(result!.creditsBalance).toBeNull();
    expect(result!.usage.last_24h.step_count).toBe(0);
  });

  it('returns null on non-OK response', async () => {
    vi.stubEnv('VITE_API_URL', '/v1');
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: vi.fn() });

    const { fetchBillingUsage } = await import('./billing');
    await expect(fetchBillingUsage('bad')).resolves.toBeNull();
  });

  it('returns null when fetch throws', async () => {
    vi.stubEnv('VITE_API_URL', '/v1');
    const fetchMock = mockFetch();
    fetchMock.mockRejectedValue(new Error('network down'));

    const { fetchBillingUsage } = await import('./billing');
    await expect(fetchBillingUsage('tok')).resolves.toBeNull();
  });

  it('maps a real metered creditsBalance number when present', async () => {
    vi.stubEnv('VITE_API_URL', '');
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        active: true,
        access_state: 'active',
        creditsBalance: 42.5,
        usage: {},
        history: [],
        note: 'metered',
      }),
    });

    const { fetchBillingUsage } = await import('./billing');
    const result = await fetchBillingUsage('tok');
    expect(result!.creditsBalance).toBe(42.5);
    expect(result!.note).toBe('metered');
  });
});

describe('coerceCreditsBalance + billingMeteredLabel', () => {
  it('never invents a balance', async () => {
    const { coerceCreditsBalance, billingMeteredLabel } = await import('./billing');
    expect(coerceCreditsBalance(undefined, undefined)).toBeNull();
    expect(coerceCreditsBalance(null)).toBeNull();
    expect(coerceCreditsBalance('200' as unknown as number)).toBeNull();
    expect(coerceCreditsBalance(10)).toBe(10);
    expect(billingMeteredLabel(null).metered).toBe(false);
    expect(billingMeteredLabel(null).label).toContain('not metered');
    expect(billingMeteredLabel(5, 'metered')).toEqual({
      metered: true,
      label: 'metered',
    });
  });
});
