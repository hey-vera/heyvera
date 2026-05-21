import { ArrowRight, Check, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { createBillingCheckout } from '../../lib/cortexApi';
import ReferralInput from './ReferralInput';

interface PricingCardsProps {
  compact?: boolean;
}

const DEFAULT_TRIAL_DAYS = 7;

export default function PricingCards({ compact = false }: PricingCardsProps) {
  const [plan, setPlan] = useState<'monthly' | 'annual'>('monthly');
  const [referralCode, setReferralCode] = useState('');
  const [referralChoice, setReferralChoice] = useState<'discount_25_annual' | 'extra_2_weeks' | null>(null);
  const [promoTrialDays, setPromoTrialDays] = useState<number | null>(null);
  const [promoPercentOff, setPromoPercentOff] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveTrialDays = promoTrialDays ?? DEFAULT_TRIAL_DAYS;
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
        referral_choice: referralChoice ?? undefined,
      });
      window.location.assign(result.checkout_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout');
      setLoading(false);
    }
  }

  function handlePromoChoiceChange(choice: 'discount_25_annual' | 'extra_2_weeks' | null) {
    setReferralChoice(choice);
    if (choice === 'discount_25_annual') {
      setPromoPercentOff(25);
      setPromoTrialDays(null);
    } else if (choice === 'extra_2_weeks') {
      setPromoTrialDays(14);
      setPromoPercentOff(null);
    } else {
      setPromoTrialDays(null);
      setPromoPercentOff(null);
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
              onClick={() => {
                setPlan(item.id);
                if (item.id === 'monthly' && referralChoice === 'discount_25_annual') {
                  handlePromoChoiceChange(null);
                }
              }}
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
            choice={referralChoice}
            selectedPlan={plan}
            onChange={(code) => {
              setReferralCode(code);
              if (!code.trim()) {
                setPromoTrialDays(null);
                setPromoPercentOff(null);
              }
            }}
            onChoiceChange={handlePromoChoiceChange}
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
