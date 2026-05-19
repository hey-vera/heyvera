import { Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { purchaseCreditPack } from '../../lib/cortexApi';

interface CreditPackPurchaseProps {
  compact?: boolean;
}

export default function CreditPackPurchase({ compact = false }: CreditPackPurchaseProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buyCredits() {
    setLoading(true);
    setError(null);
    try {
      const result = await purchaseCreditPack();
      window.location.assign(result.checkout_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start credit purchase');
      setLoading(false);
    }
  }

  return (
    <div className={compact ? '' : 'rounded-xl border border-white/8 bg-white/[0.03] p-4'}>
      {!compact && (
        <div className="mb-3">
          <h3 className="text-sm font-medium text-white">Need more credits?</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">Add 100 orchestration credits instantly for $4.99.</p>
        </div>
      )}
      <button
        type="button"
        onClick={() => void buyCredits()}
        disabled={loading}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-black transition hover:brightness-110 active:scale-95 disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Buy 100 credits — $4.99
      </button>
      {error && <p className="mt-2 text-xs text-red-200">{error}</p>}
    </div>
  );
}
