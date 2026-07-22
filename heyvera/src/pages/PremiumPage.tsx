import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
  BILLING_HISTORY_DEFAULT_LIMIT,
  fetchBillingHistory,
  fetchBillingUsage,
  resolveBillingPath,
  type BillingHistoryEntry,
  type BillingUsageResponse,
} from '../api/billing';
import {
  accessStateLabel,
  formatAccessPlanLabel,
  isPremiumAccess,
  normalizeAccessState,
} from '../utils/accessState';

/** Premium is credits for automation — not “unlimited projects”. */
const FEATURES: { label: string; status: 'planned' | 'partial' | 'live' }[] = [
  { label: 'Pulse draft credits (automation runs)', status: 'partial' },
  { label: 'Scheduled post processing', status: 'partial' },
  { label: 'Agent / Page API key usage quota', status: 'planned' },
  { label: 'Higher rate limits for social write APIs', status: 'planned' },
  { label: 'Priority Pulse tool routing when LLM keys are set', status: 'planned' },
];

interface TierCardProps {
  label: string;
  price: string;
  period: string;
  badge: string;
  badgeHighlight?: boolean;
  onSubscribe?: () => void;
  disabled?: boolean;
  ctaLabel?: string;
  disabledReason?: string;
}

function TierCard({
  label,
  price,
  period,
  badge,
  badgeHighlight,
  onSubscribe,
  disabled,
  ctaLabel = 'Subscribe',
  disabledReason,
}: TierCardProps) {
  return (
    <div className="flex flex-1 flex-col rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-6">
      <div className="mb-4">
        <h3 className="text-[15px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">{label}</h3>
        <div className="mt-2 flex items-baseline gap-1">
          <span className="text-[36px] font-bold text-[var(--text-primary)]">{price}</span>
          <span className="text-[15px] text-[var(--text-secondary)]">/{period}</span>
        </div>
        <span
          className={`mt-2 inline-block rounded-full px-3 py-0.5 text-[13px] font-medium ${
            badgeHighlight
              ? 'bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-[var(--accent)]'
              : 'bg-[var(--border-primary)] text-[var(--text-secondary)]'
          }`}
        >
          {badge}
        </span>
      </div>

      <ul className="flex-1 space-y-3 mb-6">
        {FEATURES.map((feature) => (
          <li key={feature.label} className="flex items-start gap-3 text-[15px] text-[var(--text-primary)]">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-secondary)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="flex-shrink-0 mt-0.5"
              aria-hidden="true"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>
              {feature.label}
              <span className="ml-2 text-[12px] font-medium text-[var(--text-secondary)]">
                {feature.status === 'live'
                  ? 'Live'
                  : feature.status === 'partial'
                    ? 'Early access'
                    : 'Coming soon'}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled={disabled}
        onClick={onSubscribe}
        title={disabled ? disabledReason ?? 'Self-serve checkout is not available' : undefined}
        className="w-full rounded-full bg-[var(--accent)] py-3 text-[15px] font-bold text-[var(--bg-primary)] transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {ctaLabel}
      </button>
      {disabled && disabledReason ? (
        <p className="mt-2 text-center text-[12px] text-[var(--text-secondary)]">{disabledReason}</p>
      ) : null}
    </div>
  );
}

type BillingStatus = {
  active: boolean;
  plan?: string;
  period_end?: string;
  access_state?: string;
};

async function fetchBillingStatus(token: string): Promise<BillingStatus | null> {
  try {
    const res = await fetch(resolveBillingPath('/api/billing/status'), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as {
      active?: boolean;
      access_state?: string;
      plan?: { plan_type?: string; billing_period_end?: string } | string;
      period_end?: string;
      plan_info?: { plan_type?: string; billing_period_end?: string };
    };
    const planType =
      typeof raw.plan === 'string'
        ? raw.plan
        : raw.plan?.plan_type ?? raw.plan_info?.plan_type;
    const access = normalizeAccessState(raw.access_state);
    // Prefer server `active` when present; else derive only from known access states.
    const active =
      raw.active === true ||
      (raw.active !== false && isPremiumAccess(access));
    return {
      active,
      plan: planType,
      period_end:
        raw.period_end ??
        (typeof raw.plan === 'object' ? raw.plan?.billing_period_end : undefined) ??
        raw.plan_info?.billing_period_end,
      access_state: access,
    };
  } catch {
    return null;
  }
}

async function openBillingPortal(token: string): Promise<string | null> {
  try {
    const res = await fetch(resolveBillingPath('/api/billing/portal'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { url?: string; portal_url?: string };
    return data.url ?? data.portal_url ?? null;
  } catch {
    return null;
  }
}

/** Attempt Stripe checkout; returns null when Stripe/billing is not configured. */
async function startCheckout(
  token: string,
  plan: 'monthly' | 'annual',
): Promise<{ url: string | null; error: string | null }> {
  try {
    const res = await fetch(resolveBillingPath('/api/billing/checkout'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ plan }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      return {
        url: null,
        error: err.error ?? `Checkout unavailable (${res.status})`,
      };
    }
    const data = (await res.json()) as { checkout_url?: string; url?: string };
    const url = data.checkout_url || data.url || null;
    return { url, error: url ? null : 'Checkout session returned no URL' };
  } catch {
    return { url: null, error: 'Unable to reach billing service' };
  }
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatPlanStatus(usage: BillingUsageResponse | null, status: BillingStatus | null): string {
  return formatAccessPlanLabel({
    accessState: usage?.access_state ?? status?.access_state,
    planType: usage?.plan?.plan_type ?? status?.plan,
    active: usage?.active ?? status?.active,
  });
}

function UsageCreditsSection({
  usage,
  loading,
  billingStatus,
  getToken,
}: {
  usage: BillingUsageResponse | null;
  loading: boolean;
  billingStatus: BillingStatus | null;
  getToken: () => Promise<string | null>;
}) {
  const [historyItems, setHistoryItems] = useState<BillingHistoryEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyReady, setHistoryReady] = useState(false);

  // Initial history page from dedicated pagination API (not client-side slice).
  useEffect(() => {
    let cancelled = false;
    setHistoryReady(false);
    setHistoryItems([]);
    setHasMore(false);
    setNextOffset(null);
    setHistoryError(null);

    void (async () => {
      setHistoryLoading(true);
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const page = await fetchBillingHistory(token, {
          limit: BILLING_HISTORY_DEFAULT_LIMIT,
          offset: 0,
        });
        if (cancelled) return;
        if (!page) {
          // Fall back to embedded usage history (first page only) without inventing more.
          const fallback = usage?.history ?? [];
          setHistoryItems(fallback);
          setHasMore(false);
          setNextOffset(null);
          if (!usage) {
            setHistoryError('Billing history unavailable.');
          }
          return;
        }
        setHistoryItems(page.items);
        setHasMore(page.hasMore);
        setNextOffset(page.nextOffset);
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
          setHistoryReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Re-fetch when usage identity changes (sign-in / refresh).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getToken + usage load gate
  }, [usage, getToken]);

  const loadMoreHistory = useCallback(async () => {
    if (!hasMore || nextOffset == null || historyLoading) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const token = await getToken();
      if (!token) {
        setHistoryError('Sign in required to load more history.');
        return;
      }
      const page = await fetchBillingHistory(token, {
        limit: BILLING_HISTORY_DEFAULT_LIMIT,
        offset: nextOffset,
      });
      if (!page) {
        setHistoryError('Could not load more billing history.');
        return;
      }
      setHistoryItems((prev) => [...prev, ...page.items]);
      setHasMore(page.hasMore);
      setNextOffset(page.nextOffset);
    } finally {
      setHistoryLoading(false);
    }
  }, [getToken, hasMore, historyLoading, nextOffset]);

  if (loading) {
    return (
      <section
        className="mb-8 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-6"
        role="status"
        aria-live="polite"
      >
        <h2 className="text-[16px] font-bold text-[var(--text-primary)] mb-2">Usage &amp; credits</h2>
        <p className="text-[14px] text-[var(--text-secondary)]">Loading usage…</p>
      </section>
    );
  }

  const hasUsageData = usage !== null;
  const u = usage?.usage;
  const access = normalizeAccessState(usage?.access_state ?? billingStatus?.access_state);

  return (
    <section className="mb-8 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-6">
      <h2 className="text-[16px] font-bold text-[var(--text-primary)] mb-1">Usage &amp; credits</h2>
      <p className="text-[13px] text-[var(--text-secondary)] mb-4">
        Plan status and automation usage from the API. Credit balances are only shown when metered.
      </p>

      <dl className="space-y-3 text-[14px]">
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--text-secondary)]">Plan status</dt>
          <dd className="font-medium text-[var(--text-primary)] text-right">
            {formatPlanStatus(usage, billingStatus)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--text-secondary)]">Access</dt>
          <dd className="font-medium text-[var(--text-primary)] text-right">
            {accessStateLabel(access)}
            <span className="block text-[12px] mt-0.5 text-[var(--text-secondary)] font-normal">
              {access === 'unknown'
                ? 'No access_state from API'
                : `access_state: ${access}`}
            </span>
          </dd>
        </div>

        <div className="flex justify-between gap-4">
          <dt className="text-[var(--text-secondary)]">Credits balance</dt>
          <dd className="font-medium text-[var(--text-primary)] text-right">
            {usage && usage.creditsBalance !== null && usage.creditsBalance !== undefined ? (
              <span>
                {usage.creditsBalance}
                <span className="block text-[12px] mt-0.5 text-[var(--text-secondary)] font-normal">
                  {usage.note?.trim() || 'metered'}
                </span>
              </span>
            ) : (
              <span className="text-[var(--text-secondary)] font-normal">
                Not metered yet
                {usage?.note ? (
                  <span className="block text-[12px] mt-0.5">{usage.note}</span>
                ) : (
                  <span className="block text-[12px] mt-0.5">ledger balance not metered yet</span>
                )}
              </span>
            )}
          </dd>
        </div>

        {hasUsageData && u ? (
          <>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--text-secondary)]">Usage (24h)</dt>
              <dd className="text-right text-[var(--text-primary)]">
                {u.last_24h.step_count} steps · {u.last_24h.total_tokens_in + u.last_24h.total_tokens_out}{' '}
                tokens
                {u.last_24h.total_cost_estimate > 0
                  ? ` · ~$${u.last_24h.total_cost_estimate.toFixed(4)}`
                  : ''}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--text-secondary)]">Usage (30d)</dt>
              <dd className="text-right text-[var(--text-primary)]">
                {u.last_30d.step_count} steps · {u.last_30d.total_tokens_in + u.last_30d.total_tokens_out}{' '}
                tokens
                {u.last_30d.total_cost_estimate > 0
                  ? ` · ~$${u.last_30d.total_cost_estimate.toFixed(4)}`
                  : ''}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--text-secondary)]">Today (est. cost / steps)</dt>
              <dd className="text-right text-[var(--text-primary)]">
                ~${u.daily_cost.toFixed(4)} · {u.daily_steps} steps
              </dd>
            </div>
          </>
        ) : (
          <p className="text-[13px] text-[var(--text-secondary)]">
            Usage summary unavailable (sign in required, or API not reachable).
          </p>
        )}
      </dl>

      {historyReady && historyItems.length > 0 ? (
        <div className="mt-5 border-t border-[var(--border-primary)] pt-4">
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-3">
            Billing history
          </h3>
          <ul className="space-y-2">
            {historyItems.map((entry, i) => (
              <li
                key={`${entry.date}-${entry.description}-${i}`}
                className="flex items-start justify-between gap-3 text-[13px]"
              >
                <div>
                  <div className="text-[var(--text-primary)]">{entry.description}</div>
                  <div className="text-[var(--text-secondary)]">
                    {entry.date
                      ? (() => {
                          const d = new Date(entry.date);
                          return Number.isNaN(d.getTime())
                            ? entry.date
                            : d.toLocaleDateString();
                        })()
                      : '—'}
                    {' · '}
                    {entry.status}
                  </div>
                </div>
                <div className="shrink-0 font-medium text-[var(--text-primary)]">
                  {entry.amount_cents ? formatCents(entry.amount_cents) : '—'}
                </div>
              </li>
            ))}
          </ul>
          {hasMore ? (
            <button
              type="button"
              disabled={historyLoading}
              onClick={() => void loadMoreHistory()}
              className="mt-4 w-full rounded-full border border-[var(--border-primary)] py-2 text-[13px] font-semibold text-[var(--text-primary)] transition-opacity hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {historyLoading ? 'Loading…' : 'Load more'}
            </button>
          ) : null}
          {historyError ? (
            <p className="mt-2 text-[12px] text-[var(--color-danger)]" role="alert">
              {historyError}
            </p>
          ) : null}
        </div>
      ) : historyReady && (hasUsageData || historyError) ? (
        <p className="mt-4 text-[13px] text-[var(--text-secondary)]">
          {historyError ?? 'No billing history events yet.'}
        </p>
      ) : historyLoading ? (
        <p className="mt-4 text-[13px] text-[var(--text-secondary)]" role="status">
          Loading billing history…
        </p>
      ) : null}
    </section>
  );
}

function PremiumMemberView({
  status,
  onManage,
  managing,
}: {
  status: BillingStatus;
  onManage: () => void;
  managing: boolean;
}) {
  const access = normalizeAccessState(status.access_state);
  return (
    <div className="rounded-2xl border border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] p-6 mb-8">
      <div className="flex items-center gap-3 mb-3">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="flex-shrink-0"
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        <h2 className="text-[18px] font-bold text-[var(--accent)]">
          {access === 'trial_active' ? "You're on a Premium trial" : "You're a Premium member"}
        </h2>
      </div>
      <p className="text-[15px] text-[var(--text-secondary)] mb-5">
        {status.plan ? (
          <>
            You're on the <strong className="text-[var(--text-primary)]">{status.plan}</strong> plan
            {' · '}
            <span className="text-[var(--text-primary)]">{accessStateLabel(access)}</span>.
          </>
        ) : (
          <>
            Access: <strong className="text-[var(--text-primary)]">{accessStateLabel(access)}</strong>.
          </>
        )}
        {status.period_end ? (
          <> Renews on {new Date(status.period_end).toLocaleDateString()}.</>
        ) : null}
      </p>
      <button
        type="button"
        disabled={managing}
        onClick={onManage}
        className="rounded-full border border-[var(--accent)] px-5 py-2.5 text-[15px] font-bold text-[var(--accent)] transition-opacity hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {managing ? 'Opening portal...' : 'Manage subscription'}
      </button>
    </div>
  );
}

export function PremiumPage() {
  const { isSignedIn, getToken } = useAuth();

  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
  const [billingUsage, setBillingUsage] = useState<BillingUsageResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [managing, setManaging] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState<'monthly' | 'annual' | null>(null);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [checkoutAvailable, setCheckoutAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isSignedIn) {
      setCheckoutAvailable(null);
      setBillingStatus(null);
      setBillingUsage(null);
      return;
    }

    setLoadingStatus(true);
    setLoadingUsage(true);
    void (async () => {
      try {
        const token = await getToken();
        if (!token) return;

        const [status, usage] = await Promise.all([
          fetchBillingStatus(token),
          fetchBillingUsage(token),
        ]);
        setBillingStatus(status);
        setBillingUsage(usage);

        // Probe checkout once so Unavailable shows before first click when Stripe is down.
        // Using monthly plan as a lightweight probe; no redirect unless user explicitly subscribes.
        const probe = await startCheckout(token, 'monthly');
        if (probe.url) {
          // Do not auto-redirect; session may be single-use. Mark available only.
          setCheckoutAvailable(true);
        } else {
          const msg = (probe.error ?? '').toLowerCase();
          const stripeMissing =
            msg.includes('stripe') ||
            msg.includes('not configured') ||
            msg.includes('unavailable') ||
            msg.includes('502') ||
            msg.includes('503') ||
            msg.includes('501');
          setCheckoutAvailable(stripeMissing ? false : true);
          if (stripeMissing && probe.error) {
            setPortalError(probe.error);
          }
        }
      } finally {
        setLoadingStatus(false);
        setLoadingUsage(false);
      }
    })();
  }, [isSignedIn, getToken]);

  const handleManage = async () => {
    setManaging(true);
    setPortalError(null);
    try {
      const token = await getToken();
      if (!token) {
        setPortalError('You must be signed in to manage your subscription.');
        return;
      }
      const portalUrl = await openBillingPortal(token);
      if (portalUrl) {
        window.location.href = portalUrl;
      } else {
        setPortalError('Unable to open the billing portal. Please try again.');
      }
    } catch {
      setPortalError('Unable to open the billing portal. Please try again.');
    } finally {
      setManaging(false);
    }
  };

  const handleSubscribe = async (plan: 'monthly' | 'annual') => {
    setPortalError(null);
    if (!isSignedIn) {
      setPortalError('Sign in to subscribe.');
      return;
    }
    setCheckoutBusy(plan);
    try {
      const token = await getToken();
      if (!token) {
        setPortalError('Sign in again to start checkout.');
        return;
      }
      const result = await startCheckout(token, plan);
      if (result.url) {
        setCheckoutAvailable(true);
        window.location.href = result.url;
        return;
      }
      setCheckoutAvailable(false);
      setPortalError(
        result.error
          ? `${result.error}. Subscribe stays disabled until Stripe billing is configured.`
          : 'Checkout is not available yet (billing not configured).',
      );
    } finally {
      setCheckoutBusy(null);
    }
  };

  // Never invent premium — only server active flag or known access_state.
  const isPremium =
    billingStatus?.active === true ||
    billingUsage?.active === true ||
    isPremiumAccess(billingUsage?.access_state ?? billingStatus?.access_state);
  const subscribeDisabled = checkoutAvailable === false;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="sticky top-[var(--top-bar-height)] z-10 border-b border-[var(--border-primary)] bg-[color-mix(in_srgb,var(--bg-primary)_80%,transparent)] px-4 py-3 backdrop-blur-md">
        <h1 className="text-[20px] font-bold text-[var(--text-primary)]">HeyVera Premium</h1>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">
        <p className="mb-4 text-[15px] leading-relaxed text-[var(--text-secondary)]">
          Premium is for <strong className="text-[var(--text-primary)]">automation credits</strong> —
          Pulse drafts, scheduled posts, and API usage for your Page. It is not unlimited projects or vanity badges.
        </p>

        <div className="mb-8 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-4 py-3 text-[14px] text-[var(--text-secondary)]">
          <strong className="text-[var(--text-primary)]">Honest status.</strong>{' '}
          Self-serve checkout works only when Stripe is configured on the API. If checkout fails, we leave Subscribe
          disabled with a reason instead of faking a payment flow.
        </div>

        {loadingStatus ? (
          <div
            className="mb-8 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-6 text-center text-[15px] text-[var(--text-secondary)]"
            role="status"
            aria-live="polite"
          >
            Checking subscription status...
          </div>
        ) : null}

        {portalError ? (
          <div
            className="mb-6 rounded-xl border border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] px-4 py-3 text-[14px] text-[var(--color-danger)]"
            role="alert"
          >
            {portalError}
          </div>
        ) : null}

        {!loadingStatus && isPremium ? (
          <PremiumMemberView
            status={
              billingStatus ?? {
                active: true,
                plan: billingUsage?.plan?.plan_type,
                period_end: billingUsage?.plan?.billing_period_end,
                access_state: billingUsage?.access_state,
              }
            }
            onManage={() => void handleManage()}
            managing={managing}
          />
        ) : null}

        {isSignedIn ? (
          <UsageCreditsSection
            usage={billingUsage}
            loading={loadingUsage}
            billingStatus={billingStatus}
            getToken={getToken}
          />
        ) : null}

        {!loadingStatus && !isPremium ? (
          <>
            <div className="flex flex-col gap-4 sm:flex-row">
              <TierCard
                label="Monthly"
                price="$6.99"
                period="mo"
                badge="Credits plan"
                disabled={subscribeDisabled || !isSignedIn || checkoutBusy !== null}
                ctaLabel={
                  checkoutBusy === 'monthly'
                    ? 'Opening…'
                    : subscribeDisabled
                      ? 'Unavailable'
                      : !isSignedIn
                        ? 'Sign in to subscribe'
                        : 'Subscribe'
                }
                disabledReason={
                  subscribeDisabled
                    ? 'Stripe checkout not configured on this environment'
                    : !isSignedIn
                      ? 'Sign in required'
                      : undefined
                }
                onSubscribe={() => void handleSubscribe('monthly')}
              />
              <TierCard
                label="Annual"
                price="$69"
                period="yr"
                badge="Save 17%"
                badgeHighlight
                disabled={subscribeDisabled || !isSignedIn || checkoutBusy !== null}
                ctaLabel={
                  checkoutBusy === 'annual'
                    ? 'Opening…'
                    : subscribeDisabled
                      ? 'Unavailable'
                      : !isSignedIn
                        ? 'Sign in to subscribe'
                        : 'Subscribe'
                }
                disabledReason={
                  subscribeDisabled
                    ? 'Stripe checkout not configured on this environment'
                    : !isSignedIn
                      ? 'Sign in required'
                      : undefined
                }
                onSubscribe={() => void handleSubscribe('annual')}
              />
            </div>

            <p className="mt-6 text-center text-[13px] text-[var(--text-secondary)]">
              If you already have Premium, sign in to check status and manage billing above.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default PremiumPage;
