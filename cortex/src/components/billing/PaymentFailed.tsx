import { CreditCard, ExternalLink, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { createBillingPortal, type BillingStatus } from '../../lib/cortexApi';

interface PaymentFailedProps {
  billing: BillingStatus | null;
}

export default function PaymentFailed({ billing }: PaymentFailedProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const card = billing?.payment_method;

  async function openPortal() {
    setLoading(true);
    setError(null);
    try {
      const result = await createBillingPortal();
      window.location.assign(result.portal_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open payment portal');
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4 text-[var(--fg)]">
      <div className="w-full max-w-md rounded-2xl border border-white/8 bg-[var(--panel)] p-5 shadow-2xl">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-red-400/10 text-red-200">
          <CreditCard className="h-5 w-5" />
        </div>
        <h1 className="text-xl font-semibold text-white">Payment failed</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          We could not charge {card ? `${card.brand.toUpperCase()} ending ${card.last4}` : 'your card'}.
          Update your payment method to continue using Cortex. Your work is preserved.
        </p>
        {error && <p className="mt-3 rounded-lg border border-red-400/15 bg-red-400/8 px-3 py-2 text-sm text-red-100">{error}</p>}
        <button
          type="button"
          onClick={() => void openPortal()}
          disabled={loading}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-black transition hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
          Update payment method
        </button>
        <a className="mt-3 block text-center text-xs text-[var(--muted)] transition hover:text-white" href="mailto:support@heyvera.org">
          Contact support
        </a>
      </div>
    </div>
  );
}
