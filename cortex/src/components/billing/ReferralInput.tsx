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

const OPTION_LABELS = {
  discount_25_annual: '25% off first year',
  extra_2_weeks: '2 extra free weeks',
};

export default function ReferralInput({ value, choice, selectedPlan, onChange, onChoiceChange }: ReferralInputProps) {
  const [result, setResult] = useState<ReferralValidateResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function validate() {
    const code = value.trim();
    if (!code) return;
    setLoading(true);
    try {
      const next = await validateReferralCode(code);
      setResult(next);
      onChoiceChange(next.valid && next.options.length > 0 ? next.options[0] : null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
      <label className="flex items-center gap-2 text-xs font-medium text-[var(--muted-strong)]">
        <Tag className="h-3.5 w-3.5 text-[var(--accent)]" />
        Referral code
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
          placeholder="JOSH25"
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
            {result.valid ? `${result.creator_name ?? 'A teammate'} invited you` : result.error ?? 'Invalid code'}
          </p>
          {result.valid && (
            <div className="mt-2 grid gap-2">
              {result.options.map((option) => {
                const disabled = option === 'discount_25_annual' && selectedPlan !== 'annual';
                return (
                  <label key={option} className={`flex items-center gap-2 rounded-lg border border-white/8 px-3 py-2 ${disabled ? 'opacity-45' : 'cursor-pointer hover:bg-white/5'}`}>
                    <input type="radio" checked={choice === option} disabled={disabled} onChange={() => onChoiceChange(option)} />
                    <span>{OPTION_LABELS[option]}{disabled ? ' · annual only' : ''}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
