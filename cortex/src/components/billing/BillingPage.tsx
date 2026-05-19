import { CreditCard, ExternalLink, ShieldCheck, WalletCards } from 'lucide-react';
import { useState } from 'react';
import type { BillingStatus } from '../../lib/cortexApi';
import { createBillingPortal } from '../../lib/cortexApi';
import BillingHistory from './BillingHistory';
import CreditPackPurchase from './CreditPackPurchase';
import PricingCards from './PricingCards';
import { formatDate, formatMoney } from './format';

interface BillingPageProps {
  billing: BillingStatus | null;
}

export default function BillingPage({ billing }: BillingPageProps) {
  const [portalError, setPortalError] = useState<string | null>(null);

  if (!billing) {
    return <PricingCards compact />;
  }

  const planLabel = billing.plan
    ? `Cortex Pro ${billing.plan.plan_type === 'annual' ? 'Annual' : 'Monthly'}`
    : 'Cortex Pro';
  const payment = billing.payment_method
    ? `${billing.payment_method.brand.toUpperCase()} ending ${billing.payment_method.last4}`
    : 'Add in Stripe checkout';

  async function openPortal() {
    setPortalError(null);
    try {
      const { portal_url } = await createBillingPortal();
      window.location.assign(portal_url);
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : 'Could not open Stripe portal');
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">Plan</p>
            <h3 className="mt-1 text-base font-semibold text-white">{planLabel}</h3>
            <p className="mt-1 text-xs capitalize text-[var(--muted)]">{billing.plan?.status ?? billing.access_state}</p>
          </div>
          <ShieldCheck className="h-5 w-5 text-[var(--accent)]" />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-white/[0.03] p-3">
            <p className="text-[11px] text-[var(--muted)]">Next billing</p>
            <p className="mt-1 text-sm text-white">{formatDate(billing.plan?.next_charge_date ?? billing.plan?.billing_period_end)}</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">{formatMoney(billing.plan?.next_charge_amount_cents)}</p>
          </div>
          <div className="rounded-lg bg-white/[0.03] p-3">
            <p className="text-[11px] text-[var(--muted)]">Payment method</p>
            <p className="mt-1 text-sm text-white">{payment}</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">Managed securely by Stripe</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void openPortal()}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/8 active:scale-95"
        >
          <CreditCard className="h-4 w-4" />
          Manage subscription
          <ExternalLink className="h-3.5 w-3.5 text-[var(--muted)]" />
        </button>
        {portalError && <p className="mt-3 text-xs text-red-200">{portalError}</p>}
      </div>

      <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">Credits</p>
            <p className="mt-1 text-2xl font-semibold text-white">{billing.credits.total_remaining}</p>
          </div>
          <WalletCards className="h-5 w-5 text-[var(--accent)]" />
        </div>
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-lg bg-white/[0.03] px-3 py-2 text-[var(--muted-strong)]">
            Subscription: {billing.credits.subscription_remaining}/{billing.credits.subscription_total}
          </div>
          <div className="rounded-lg bg-white/[0.03] px-3 py-2 text-[var(--muted-strong)]">
            Packs: {billing.credits.pack_remaining}
          </div>
        </div>
      </div>

      <CreditPackPurchase />

      {billing.referral && (
        <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
          <p className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">Refer friends</p>
          <p className="mt-2 font-mono text-sm text-white">{billing.referral.code}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {billing.referral.uses_remaining}/{billing.referral.total_uses} uses remaining · {billing.referral.credits_earned} credits earned
          </p>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-medium text-white">Purchase history</h3>
        <BillingHistory />
      </div>
    </div>
  );
}
