import { Check, Copy, CreditCard, ExternalLink, ShieldCheck, Users } from 'lucide-react';
import { useState } from 'react';
import type { BillingStatus } from '../../lib/cortexApi';
import { createBillingPortal } from '../../lib/cortexApi';
import BillingHistory from './BillingHistory';
import PricingCards from './PricingCards';
import { formatDate, formatMoney } from './format';

interface BillingPageProps {
  billing: BillingStatus | null;
}

export default function BillingPage({ billing }: BillingPageProps) {
  const [portalError, setPortalError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

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

      {billing.referral && (
        <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-[var(--accent)]" />
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">Refer friends</p>
            </div>
            {billing.referral.weeks_earned > 0 && (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                {billing.referral.weeks_earned} free week{billing.referral.weeks_earned === 1 ? '' : 's'} earned
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Share your code — friends get 3 weeks free (instead of 7 days). You get 1 free week per signup.
          </p>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(billing.referral!.code);
              setCopiedCode(true);
              setTimeout(() => setCopiedCode(false), 2000);
            }}
            className="mt-2 flex items-center gap-2 rounded-lg bg-white/8 px-3 py-2 font-mono text-sm font-bold text-white transition hover:bg-white/12 active:scale-95"
          >
            {billing.referral.code}
            {copiedCode
              ? <Check className="h-3.5 w-3.5 text-emerald-300" />
              : <Copy className="h-3.5 w-3.5 text-[var(--muted)]" />
            }
          </button>
          <p className="mt-1.5 text-[11px] text-[var(--muted)]">
            {billing.referral.total_uses} referral{billing.referral.total_uses === 1 ? '' : 's'} used
            {billing.referral.uses_remaining > 0 && ` · ${billing.referral.uses_remaining} remaining`}
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
