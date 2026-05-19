import { useEffect, useState } from 'react';
import { ArrowLeft, Fingerprint, Loader2, Rocket } from 'lucide-react';
import {
  getAuthStatus,
  getGitHubStatus,
  getSomaIdentity,
  type ProviderAuthInfo,
  type SomaIdentity,
} from '../../lib/cortexApi';

interface CompleteStepProps {
  userId: string;
  onFinish: () => void;
  onBack: () => void;
}

function shortDid(did: string) {
  if (did.length <= 24) return did;
  return `${did.slice(0, 14)}...${did.slice(-7)}`;
}

export default function CompleteStep({ userId, onFinish, onBack }: CompleteStepProps) {
  const [providers, setProviders] = useState<ProviderAuthInfo[]>([]);
  const [githubLinked, setGithubLinked] = useState<boolean | null>(null);
  const [soma, setSoma] = useState<SomaIdentity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchSummary() {
      try {
        const [nextProviders, github, identity] = await Promise.all([
          getAuthStatus().catch(() => []),
          getGitHubStatus().catch(() => ({ linked: false })),
          getSomaIdentity().catch(() => null),
        ]);
        if (!cancelled) {
          setProviders(nextProviders);
          setGithubLinked(Boolean(github.linked));
          setSoma(identity);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchSummary();
    return () => {
      cancelled = true;
    };
  }, []);

  const connectedProviders = providers.filter((provider) => provider.authenticated);

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
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
          Connected
        </h3>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking setup...
          </div>
        ) : (
          <div className="space-y-2 text-sm text-[var(--muted-strong)]">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-white/6 bg-black/10 px-3 py-2">
              <span>AI providers</span>
              <span className="text-xs text-[var(--muted)]">
                {connectedProviders.length > 0
                  ? connectedProviders.map((provider) => provider.provider).join(', ')
                  : 'None connected'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-white/6 bg-black/10 px-3 py-2">
              <span>GitHub</span>
              <span className="text-xs text-[var(--muted)]">{githubLinked ? 'Linked' : 'Skipped'}</span>
            </div>
            {soma && (
              <div className="rounded-lg border border-[var(--accent)]/15 bg-[var(--accent)]/8 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5">
                    <Fingerprint className="h-3.5 w-3.5 text-[var(--accent)]" />
                    Soma identity
                  </span>
                  <span className="text-xs text-[var(--accent)]">{soma.heartbeats} pulses</span>
                </div>
                <p className="mt-1 truncate font-mono text-xs text-[var(--muted)]" title={soma.did}>
                  {shortDid(soma.did)}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="w-full rounded-xl border border-white/8 bg-white/[0.02] p-4">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
          First run
        </h3>
        <p className="text-sm leading-6 text-[var(--muted-strong)]">
          Ask Cortex to inspect, patch, test, and prepare a PR. The run panel will show routing, progress, and approvals.
        </p>
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
          title={`Finish onboarding for ${userId}`}
          className="rounded-lg bg-[var(--accent-soft)] px-5 py-2.5 text-sm font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/20"
        >
          Start building
        </button>
      </div>
    </div>
  );
}
