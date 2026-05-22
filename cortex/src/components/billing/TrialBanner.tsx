import { CalendarClock, X } from 'lucide-react';
import { useState } from 'react';
import type { BillingStatus } from '../../lib/cortexApi';
import { formatMoney } from './format';

interface TrialBannerProps {
  billing: BillingStatus | null;
  onOpenBilling: () => void;
}

export default function TrialBanner({ billing, onOpenBilling }: TrialBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  if (!billing?.trial || billing.access_state !== 'trial_active' || dismissed || billing.trial.days_remaining > 3) {
    return null;
  }

  return (
    <div className="border-b border-[var(--accent)]/15 bg-[var(--accent)]/10 px-3 py-2 sm:px-4">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <CalendarClock className="h-4 w-4 shrink-0 text-[var(--accent)]" />
        <p className="min-w-0 flex-1 text-xs text-[var(--muted-strong)]">
          Trial ends {billing.trial.days_remaining === 0 ? 'today' : `in ${billing.trial.days_remaining} days`}.
          {' '}You will be charged {formatMoney(billing.trial.auto_charge_amount_cents)} automatically.
        </p>
        <button type="button" onClick={onOpenBilling} className="rounded-lg px-2 py-1 text-xs text-white transition hover:bg-white/8 active:scale-95">
          Review
        </button>
        <button type="button" onClick={() => setDismissed(true)} className="rounded-lg p-1 text-[var(--muted)] transition hover:bg-white/8 hover:text-white" aria-label="Dismiss trial notice">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
