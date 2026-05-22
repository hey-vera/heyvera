import { ArrowRight, Check, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { createBillingCheckout, type DiscountOption } from '../../lib/cortexApi';
import ReferralInput from './ReferralInput';

interface PricingCardsProps {
  compact?: boolean;
}

const DEFAULT_TRIAL_DAYS = 7;

export default function PricingCards({ compact = false }: PricingCardsProps) {
  const [plan, setPlan] = useState<'monthly' | 'annual'>('monthly');
  const [referralCode, setReferralCode] = useState('');
  const [chosenOptionIndex, setChosenOptionIndex] = useState<number | null>(null);
  const [chosenOption, setChosenOption] = useState<DiscountOption | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const promoTrialDays = chosenOption?.discount_type === 'trial_extension' || chosenOption?.discount_type === 'free_trial'
    ? chosenOption.discount_value
    : null;
  const promoPercentOff = chosenOption?.discount_type === 'percent_off'
    ? chosenOption.discount_value
    : null;

  const effectiveTrialDays = promoTrialDays
    ? DEFAULT_TRIAL_DAYS + promoTrialDays
    : DEFAULT_TRIAL_DAYS;

  const annualPrice = promoPercentOff && plan === 'annual'
    ? `$${(69 * (1 - promoPercentOff / 100)).toFixed(0)}/yr`
    : '$69/yr';
  const annualNote = promoPercentOff
    ? `${promoPercentOff}% off first year`
    : 'Save 17%';

  const plans = [
    { id: 'monthly' as const, label: 'Monthly', price: '$6.99/mo', note: `${effectiveTrialDays}-day free trial` },
    { id: 'annual' as const, label: 'Annual', price: annualPrice, note: annualNote },
  ];

  async function startCheckout() {
    setLoading(true);
    setError(null);
    try {
      const result = await createBillingCheckout({
        plan,
        referral_code: referralCode.trim() || undefined,
        referral_choice: chosenOptionIndex != null ? String(chosenOptionIndex) : undefined,
      });
      window.location.assign(result.checkout_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout');
      setLoading(false);
    }
  }

  function handleOptionChosen(index: number | null, option: DiscountOption | null) {
    setChosenOptionIndex(index);
    setChosenOption(option);
    if (option?.discount_type === 'percent_off' && plan === 'monthly') {
      setPlan('annual');
    }
  }

  return (
    <div className={compact ? 'space-y-4' : 'flex min-h-screen items-center justify-center bg-[var(--bg)] p-4 text-[var(--fg)]'}>
      <div className="w-full max-w-2xl rounded-2xl border border-white/8 bg-[var(--panel)] p-5 shadow-2xl">
        <div className="mb-5">
          <h1 className="text-xl font-semibold text-white">
            Start your {effectiveTrialDays}-day free trial
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Full access to Cortex Pro. Unlimited projects, AI orchestration, personal live map.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {plans.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setPlan(item.id)}
              className={`rounded-xl border p-4 text-left transition hover:bg-white/[0.04] active:scale-[0.99] ${
                plan === item.id ? 'border-[var(--accent)]/50 bg-[var(--accent)]/10' : 'border-white/8 bg-white/[0.02]'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">{item.label}</span>
                {plan === item.id && <Check className="h-4 w-4 text-[var(--accent)]" />}
              </div>
              <p className="mt-2 text-2xl font-semibold text-white">{item.price}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">{item.note}</p>
            </button>
          ))}
        </div>
        <div className="mt-4">
          <ReferralInput
            value={referralCode}
            chosenOptionIndex={chosenOptionIndex}
            selectedPlan={plan}
            onChange={(code) => {
              setReferralCode(code);
              if (!code.trim()) {
                setChosenOption(null);
                setChosenOptionIndex(null);
              }
            }}
            onOptionChosen={handleOptionChosen}
          />
        </div>
        {error && <p className="mt-3 rounded-lg border border-red-400/15 bg-red-400/8 px-3 py-2 text-sm text-red-100">{error}</p>}
        <button
          type="button"
          onClick={() => void startCheckout()}
          disabled={loading}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-black transition hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Start free trial'}
          {!loading && <ArrowRight className="h-4 w-4" />}
        </button>
        <p className="mt-3 text-center text-xs text-[var(--muted)]">Card required. Cancel anytime from billing settings.</p>
      </div>
    </div>
  );
}
