import { useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle, Code2, MessageSquare, Settings, Shield, Terminal } from 'lucide-react';
import { markOnboardingComplete } from '../../lib/onboarding';

interface OnboardingFlowProps {
  userId: string;
  onComplete: () => void;
}

const TOTAL_STEPS = 3;

function ProgressDots({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 rounded-full transition-all duration-200 ${
            i === current
              ? 'w-5 bg-[var(--accent)]'
              : i < current
              ? 'w-1.5 bg-[var(--accent)]/50'
              : 'w-1.5 bg-white/15'
          }`}
        />
      ))}
    </div>
  );
}

// Step 1: Welcome
function WelcomeStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-soft)]">
          <Terminal className="h-7 w-7 text-[var(--accent)]" />
        </div>
        <h1 className="text-xl font-semibold text-white">Welcome to Cortex</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Your personal AI command center. Here's what you can do:
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        <li className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/[0.025] px-4 py-3">
          <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
          <div>
            <span className="text-sm font-medium text-white">Task management</span>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Create, assign, and track work with natural language commands.
            </p>
          </div>
        </li>
        <li className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/[0.025] px-4 py-3">
          <Code2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
          <div>
            <span className="text-sm font-medium text-white">Code orchestration</span>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Dispatch Claude and OpenAI agents to write, review, and ship code.
            </p>
          </div>
        </li>
        <li className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/[0.025] px-4 py-3">
          <Shield className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
          <div>
            <span className="text-sm font-medium text-white">Sovereignty</span>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Your subscriptions, your compute. No vendor lock-in or usage limits.
            </p>
          </div>
        </li>
      </ul>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onNext}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] text-sm font-medium text-black transition hover:brightness-110 active:scale-95"
        >
          Get started
          <ArrowRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="text-center text-xs text-[var(--muted)] transition hover:text-white"
        >
          Skip setup
        </button>
      </div>
    </div>
  );
}

// Step 2: Connect Provider
function ConnectProviderStep({
  onNext,
  onBack,
  onSkip,
}: {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-white">Connect your AI providers</h2>
        <p className="mt-1.5 text-sm text-[var(--muted)]">
          Cortex uses your own Claude and OpenAI subscriptions. Connect at least
          one provider to run agents.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {[
          { initials: 'CL', label: 'Claude (Anthropic)', description: 'claude.ai Max subscription' },
          { initials: 'OA', label: 'OpenAI (Codex)', description: 'ChatGPT Pro subscription' },
        ].map(({ initials, label, description }) => (
          <div
            key={label}
            className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.025] px-4 py-3"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/6 text-xs font-bold text-[var(--muted-strong)]">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-white">{label}</div>
              <div className="text-xs text-[var(--muted)]">{description}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-[var(--accent)]/20 bg-[var(--accent-soft)] p-4">
        <p className="text-xs text-[var(--muted)]">
          Provider connections are managed in Settings. Open Settings to authorize
          your subscriptions — it takes about 30 seconds per provider.
        </p>
        <button
          type="button"
          onClick={onNext}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] transition hover:brightness-110"
        >
          <Settings className="h-3.5 w-3.5" />
          Connect in Settings
        </button>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 text-sm text-[var(--muted)] transition hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <button
            type="button"
            onClick={onNext}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--accent-soft)] px-4 text-sm font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/20 active:scale-95"
          >
            Continue
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={onSkip}
          className="text-center text-xs text-[var(--muted)] transition hover:text-white"
        >
          Skip setup
        </button>
      </div>
    </div>
  );
}

// Step 3: First Task
function FirstTaskStep({
  onComplete,
  onBack,
  onSkip,
}: {
  onComplete: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-white">Natural language task management</h2>
        <p className="mt-1.5 text-sm text-[var(--muted)]">
          Just describe what you want. Cortex understands plain English.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
          Example commands
        </p>
        {[
          'create task fix the login bug',
          'assign to me',
          'mark done',
        ].map((cmd) => (
          <div
            key={cmd}
            className="flex items-center gap-3 rounded-lg border border-white/6 bg-white/[0.03] px-3 py-2.5"
          >
            <MessageSquare className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
            <span className="font-mono text-sm text-white">{cmd}</span>
          </div>
        ))}
      </div>

      <p className="text-xs text-[var(--muted)]">
        You can also use the task board to create and manage work visually, or
        run the full agent pipeline with a single chat message.
      </p>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 text-sm text-[var(--muted)] transition hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <button
            type="button"
            onClick={onComplete}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-black transition hover:brightness-110 active:scale-95"
          >
            Try it now
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={onSkip}
          className="text-center text-xs text-[var(--muted)] transition hover:text-white"
        >
          Skip setup
        </button>
      </div>
    </div>
  );
}

export default function OnboardingFlow({ userId, onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState(0);

  function completeOnboarding() {
    markOnboardingComplete(userId);
    onComplete();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4 text-[var(--fg)]">
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-[var(--panel)] p-6 shadow-2xl">
        <div className="mb-6">
          <ProgressDots current={step} />
        </div>

        {step === 0 && (
          <WelcomeStep
            onNext={() => setStep(1)}
            onSkip={completeOnboarding}
          />
        )}
        {step === 1 && (
          <ConnectProviderStep
            onNext={() => setStep(2)}
            onBack={() => setStep(0)}
            onSkip={completeOnboarding}
          />
        )}
        {step === 2 && (
          <FirstTaskStep
            onComplete={completeOnboarding}
            onBack={() => setStep(1)}
            onSkip={completeOnboarding}
          />
        )}
      </section>
    </main>
  );
}
