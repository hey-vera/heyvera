import { useCallback, useState } from 'react';
import ProviderStep from './ProviderStep';
import GitHubStep from './GitHubStep';
import CompleteStep from './CompleteStep';

interface OnboardingFlowProps {
  onComplete: () => void;
}

const STEPS = ['providers', 'github', 'complete'] as const;
type Step = (typeof STEPS)[number];

export default function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState<Step>('providers');
  const currentIndex = STEPS.indexOf(step);

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
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--bg)] px-4">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-white">Set up Cortex</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Step {currentIndex + 1} of {STEPS.length}
          </p>
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

        <div className="rounded-2xl border border-white/8 bg-[var(--panel)] shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          {step === 'providers' && <ProviderStep onNext={next} />}
          {step === 'github' && <GitHubStep onNext={next} onBack={back} />}
          {step === 'complete' && <CompleteStep onFinish={onComplete} onBack={back} />}
        </div>
      </div>
    </div>
  );
}
