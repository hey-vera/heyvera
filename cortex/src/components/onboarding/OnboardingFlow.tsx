import { useCallback, useState } from 'react';
import ProviderStep from './ProviderStep';
import GitHubStep from './GitHubStep';
import IdentityStep from './IdentityStep';

interface OnboardingFlowProps {
  userId: string;
  onComplete: () => void;
}

const STEPS = ['providers', 'github', 'identity'] as const;
type Step = (typeof STEPS)[number];

export default function OnboardingFlow({ userId, onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState<Step>('providers');
  const currentIndex = STEPS.indexOf(step);
  void userId;

  const next = useCallback(() => {
    const i = STEPS.indexOf(step);
    if (i < STEPS.length - 1) {
      setStep(STEPS[i + 1]);
    }
  }, [step]);

  const back = useCallback(() => {
    const i = STEPS.indexOf(step);
    if (i > 0) {
      setStep(STEPS[i - 1]);
    }
  }, [step]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--bg)] px-4 py-6">
      <div className="w-full max-w-xl">
        <div className="mb-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-white">Set up Cortex</h1>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Connect the essentials once. Cortex keeps the workflow quiet after that.
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-white/8 bg-white/4 px-2.5 py-1 text-[11px] text-[var(--muted)]">
              {currentIndex + 1}/{STEPS.length}
            </span>
          </div>
        </div>

        {/* Step indicator */}
        <div className="mb-6 flex items-center justify-center gap-2">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`h-1.5 w-8 rounded-full transition-colors ${
                i <= currentIndex ? 'bg-[var(--accent)]' : 'bg-white/10'
              }`}
            />
          ))}
        </div>

        <div className="rounded-2xl border border-white/8 bg-[var(--panel)] shadow-2xl">
          {step === 'providers' && <ProviderStep onNext={next} />}
          {step === 'github' && <GitHubStep onNext={next} onBack={back} />}
          {step === 'identity' && <IdentityStep onFinish={onComplete} onBack={back} />}
        </div>
      </div>
    </div>
  );
}
