import { CheckCircle, Loader2, Tag, XCircle } from 'lucide-react';
import { useState } from 'react';
import { validateReferralCode, type DiscountOption, type ReferralValidateResponse } from '../../lib/cortexApi';

interface ReferralInputProps {
  value: string;
  chosenOptionIndex: number | null;
  selectedPlan: 'monthly' | 'annual';
  onChange: (code: string) => void;
  onOptionChosen: (index: number | null, option: DiscountOption | null) => void;
}

export default function ReferralInput({ value, chosenOptionIndex, onChange, onOptionChosen }: ReferralInputProps) {
  const [result, setResult] = useState<ReferralValidateResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function validate() {
    const code = value.trim();
    if (!code) return;
    setLoading(true);
    try {
      const next = await validateReferralCode(code);
      setResult(next);
      if (next.valid && next.options.length === 1) {
        onOptionChosen(0, next.options[0]);
      } else if (next.valid && next.options.length > 1) {
        onOptionChosen(null, null);
      } else {
        onOptionChosen(null, null);
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
            onOptionChosen(null, null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void validate();
            }
          }}
          className="min-w-0 flex-1 rounded-lg border border-white/8 bg-[var(--composer)] px-3 py-2 text-sm text-white outline-none transition focus:border-[var(--accent)]/50"
          placeholder="Enter code"
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
              ? (result.options.length > 1 ? 'Choose your discount' : result.options[0]?.label ?? 'Promo applied')
              : result.error ?? 'Invalid code'}
          </p>
          {result.valid && result.description && (
            <p className="mt-1.5 text-[var(--muted)]">{result.description}</p>
          )}
          {result.valid && result.options.length > 1 && (
            <div className="mt-3 space-y-2">
              {result.options.map((opt, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onOptionChosen(idx, opt)}
                  className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition hover:bg-white/[0.04] active:scale-[0.99] ${
                    chosenOptionIndex === idx
                      ? 'border-[var(--accent)]/50 bg-[var(--accent)]/10'
                      : 'border-white/8 bg-white/[0.02]'
                  }`}
                >
                  <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    chosenOptionIndex === idx
                      ? 'border-[var(--accent)] bg-[var(--accent)]'
                      : 'border-white/20'
                  }`}>
                    {chosenOptionIndex === idx && (
                      <div className="h-1.5 w-1.5 rounded-full bg-black" />
                    )}
                  </div>
                  <span className="text-sm text-white">{opt.label}</span>
                </button>
              ))}
            </div>
          )}
          {result.valid && result.uses_remaining != null && (
            <p className="mt-2 text-[var(--muted)]">
              {result.uses_remaining} use{result.uses_remaining === 1 ? '' : 's'} remaining
            </p>
          )}
        </div>
      )}
    </div>
  );
}
