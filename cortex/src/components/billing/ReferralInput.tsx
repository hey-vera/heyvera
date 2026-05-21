import { CheckCircle, Loader2, Tag, XCircle } from 'lucide-react';
import { useState } from 'react';
import { validateReferralCode, type ReferralValidateResponse } from '../../lib/cortexApi';

interface ReferralInputProps {
  value: string;
  choice: 'discount_25_annual' | 'extra_2_weeks' | null;
  selectedPlan: 'monthly' | 'annual';
  onChange: (code: string) => void;
  onChoiceChange: (choice: 'discount_25_annual' | 'extra_2_weeks' | null) => void;
}

function formatDiscountLabel(type: string | null, value: number | null): string {
  if (!type || value == null) return 'Promo applied';
  if (type === 'percent_off') return `${value}% off`;
  if (type === 'trial_extension') return `${value} extra free days`;
  if (type === 'free_trial') return `${value}-day free trial`;
  return 'Promo applied';
}

export default function ReferralInput({ value, choice: _choice, selectedPlan: _selectedPlan, onChange, onChoiceChange }: ReferralInputProps) {
  const [result, setResult] = useState<ReferralValidateResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function validate() {
    const code = value.trim();
    if (!code) return;
    setLoading(true);
    try {
      const next = await validateReferralCode(code);
      setResult(next);
      if (next.valid && next.discount_type === 'percent_off') {
        onChoiceChange('discount_25_annual');
      } else if (next.valid) {
        onChoiceChange('extra_2_weeks');
      } else {
        onChoiceChange(null);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
      <label className="flex items-center gap-2 text-xs font-medium text-[var(--muted-strong)]">
        <Tag className="h-3.5 w-3.5 text-[var(--accent)]" />
        Promo code
      </label>
      <div className="mt-2 flex gap-2">
        <input
          value={value}
          onChange={(event) => {
            onChange(event.target.value.toUpperCase());
            setResult(null);
            onChoiceChange(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void validate();
            }
          }}
          className="min-w-0 flex-1 rounded-lg border border-white/8 bg-[var(--composer)] px-3 py-2 text-sm text-white outline-none transition focus:border-[var(--accent)]/50"
          placeholder="CORTEX25"
        />
        <button
          type="button"
          onClick={() => void validate()}
          disabled={!value.trim() || loading}
          className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white transition hover:bg-white/8 active:scale-95 disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Apply'}
        </button>
      </div>
      {result && (
        <div className="mt-3 text-xs">
          <p className={`flex items-center gap-1.5 ${result.valid ? 'text-emerald-300' : 'text-red-300'}`}>
            {result.valid ? <CheckCircle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
            {result.valid
              ? formatDiscountLabel(result.discount_type, result.discount_value)
              : result.error ?? 'Invalid code'}
          </p>
          {result.valid && result.description && (
            <p className="mt-1.5 text-[var(--muted)]">{result.description}</p>
          )}
          {result.valid && result.uses_remaining != null && (
            <p className="mt-1 text-[var(--muted)]">
              {result.uses_remaining} use{result.uses_remaining === 1 ? '' : 's'} remaining
            </p>
          )}
        </div>
      )}
    </div>
  );
}
