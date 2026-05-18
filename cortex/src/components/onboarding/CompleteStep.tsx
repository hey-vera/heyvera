import { ArrowLeft, CheckCircle, Rocket } from 'lucide-react';

interface CompleteStepProps {
  onFinish: () => void;
  onBack: () => void;
}

export default function CompleteStep({ onFinish, onBack }: CompleteStepProps) {
  return (
    <div className="flex flex-col items-center gap-6 p-8">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--accent-soft)]">
        <Rocket className="h-8 w-8 text-[var(--accent)]" />
      </div>

      <div className="text-center">
        <h2 className="text-lg font-semibold text-white">You're all set</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Cortex will route your tasks to the right provider and tier automatically.
          Just describe what you need in natural language.
        </p>
      </div>

      <div className="w-full rounded-xl border border-white/8 bg-white/4 p-4">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
          Try saying
        </h3>
        <ul className="flex flex-col gap-2 text-sm text-[var(--muted-strong)]">
          <li className="flex items-start gap-2">
            <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
            "explore the auth module"
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
            "fix the login bug in src/auth.ts"
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
            "add a health check endpoint"
          </li>
        </ul>
      </div>

      <div className="flex w-full items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-xs text-[var(--muted)] transition hover:text-white"
        >
          <ArrowLeft className="h-3 w-3" />
          Back
        </button>
        <button
          onClick={onFinish}
          className="rounded-lg bg-[var(--accent-soft)] px-5 py-2.5 text-sm font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/20"
        >
          Start building
        </button>
      </div>
    </div>
  );
}
