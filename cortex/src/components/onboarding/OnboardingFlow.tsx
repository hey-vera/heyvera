import { ArrowRight } from 'lucide-react';
import { markOnboardingComplete } from '../../lib/onboarding';

interface OnboardingFlowProps {
  userId: string;
  onComplete: () => void;
}

export default function OnboardingFlow({ userId, onComplete }: OnboardingFlowProps) {
  function completeOnboarding() {
    markOnboardingComplete(userId);
    onComplete();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4 text-[var(--fg)]">
      <section className="w-full max-w-md rounded-xl border border-white/10 bg-[var(--panel)] p-5 shadow-2xl">
        <h1 className="text-lg font-semibold text-white">Set up Cortex</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Cortex is ready to use. Continue to your workspace to connect providers, manage tasks, and run project chat.
        </p>
        <button
          type="button"
          onClick={completeOnboarding}
          className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-black transition hover:brightness-110 active:scale-95"
        >
          Continue
          <ArrowRight className="h-4 w-4" />
        </button>
      </section>
    </main>
  );
}
