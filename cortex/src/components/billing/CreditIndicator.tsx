import { Zap } from 'lucide-react';
import type { BillingStatus } from '../../lib/cortexApi';

interface CreditIndicatorProps {
  billing: BillingStatus | null;
  onOpenBilling?: () => void;
}

function tone(percentRemaining: number) {
  if (percentRemaining < 20) return 'bg-red-300 text-red-100';
  if (percentRemaining < 50) return 'bg-yellow-300 text-yellow-100';
  return 'bg-emerald-300 text-emerald-100';
}

function resetLabel(value: string | null) {
  if (!value) return 'No reset';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value));
}

export default function CreditIndicator({ billing, onOpenBilling }: CreditIndicatorProps) {
  if (!billing) return null;
  const remaining = billing.credits.total_remaining;
  const total = Math.max(billing.credits.subscription_total + billing.credits.pack_remaining, 1);
  const usedPercent = Math.min(Math.max(((total - remaining) / total) * 100, 0), 100);
  const remainingPercent = Math.max((remaining / total) * 100, 0);
  const color = tone(remainingPercent);

  return (
    <button
      type="button"
      onClick={onOpenBilling}
      className="w-full rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-left transition hover:bg-white/[0.05] active:scale-[0.98]"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
          <Zap className="h-3.5 w-3.5 text-[var(--accent)]" />
          Credits
        </span>
        <span className="text-[11px] font-medium text-white">{remaining}/{total}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
        <div className={`h-full rounded-full ${color.split(' ')[0]} transition-all`} style={{ width: `${100 - usedPercent}%` }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px]">
        <span className={color.split(' ')[1]}>{billing.access_state === 'credits_exhausted' ? 'Exhausted' : 'Available'}</span>
        <span className="text-[var(--muted)]">Resets {resetLabel(billing.credits.billing_period_end)}</span>
      </div>
    </button>
  );
}
