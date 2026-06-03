import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';

const FEATURES = [
  'Unlimited projects',
  'AI orchestration',
  'Priority support',
  'Verified badge',
  'Extended uploads',
];

interface TierCardProps {
  label: string;
  price: string;
  period: string;
  badge: string;
  badgeHighlight?: boolean;
  onSubscribe?: () => void;
  disabled?: boolean;
}

function TierCard({ label, price, period, badge, badgeHighlight, onSubscribe, disabled }: TierCardProps) {
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
          <li key={feature} className="flex items-center gap-3 text-[15px] text-[var(--text-primary)]">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="flex-shrink-0"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {feature}
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled={disabled}
        onClick={onSubscribe}
        className="w-full rounded-full bg-[var(--accent)] py-3 text-[15px] font-bold text-[var(--bg-primary)] transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Subscribe
      </button>
    </div>
  );
}

type BillingStatus = {
  active: boolean;
  plan?: string;
  period_end?: string;
};

const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function fetchBillingStatus(token: string): Promise<BillingStatus | null> {
  try {
    const res = await fetch(`${API_BASE}/api/billing/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return res.json() as Promise<BillingStatus>;
  } catch {
    return null;
  }
}

async function openBillingPortal(token: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/billing/portal`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { url?: string };
    return data.url ?? null;
  } catch {
    return null;
  }
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
        <h2 className="text-[18px] font-bold text-[var(--accent)]">You're a Premium member</h2>
      </div>
      <p className="text-[15px] text-[var(--text-secondary)] mb-5">
        {status.plan ? (
          <>
            You're on the <strong className="text-[var(--text-primary)]">{status.plan}</strong> plan.
          </>
        ) : (
          'Your subscription is active.'
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
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [managing, setManaging] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSignedIn) return;

    setLoadingStatus(true);
    void (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const status = await fetchBillingStatus(token);
        setBillingStatus(status);
      } finally {
        setLoadingStatus(false);
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

  const isPremium = billingStatus?.active === true;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Header */}
      <div className="sticky top-[var(--top-bar-height)] z-10 border-b border-[var(--border-primary)] bg-[color-mix(in_srgb,var(--bg-primary)_80%,transparent)] px-4 py-3 backdrop-blur-md">
        <h1 className="text-[20px] font-bold text-[var(--text-primary)]">HeyVera Premium</h1>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Description */}
        <p className="mb-8 text-[15px] leading-relaxed text-[var(--text-secondary)]">
          Unlock the full HeyVera experience. Get a verified badge, AI orchestration, unlimited
          projects, and priority support — all included with your subscription. Cancel any time.
        </p>

        {/* Loading state */}
        {loadingStatus ? (
          <div className="mb-8 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-6 text-center text-[15px] text-[var(--text-secondary)]">
            Checking subscription status...
          </div>
        ) : null}

        {/* Portal error */}
        {portalError ? (
          <div className="mb-6 rounded-xl border border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] px-4 py-3 text-[14px] text-[var(--color-danger)]">
            {portalError}
          </div>
        ) : null}

        {/* Active subscriber view */}
        {!loadingStatus && isPremium ? (
          <PremiumMemberView
            status={billingStatus!}
            onManage={() => void handleManage()}
            managing={managing}
          />
        ) : null}

        {/* Upgrade UI — shown when not subscribed (or not signed in) */}
        {!loadingStatus && !isPremium ? (
          <>
            <div className="flex flex-col gap-4 sm:flex-row">
              <TierCard
                label="Monthly"
                price="$6.99"
                period="mo"
                badge="7-day free trial"
              />
              <TierCard
                label="Annual"
                price="$69"
                period="yr"
                badge="Save 17%"
                badgeHighlight
              />
            </div>

            <p className="mt-6 text-center text-[13px] text-[var(--text-secondary)]">
              No credits, no limits. One flat price. By subscribing you agree to our Terms of Service.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default PremiumPage;
