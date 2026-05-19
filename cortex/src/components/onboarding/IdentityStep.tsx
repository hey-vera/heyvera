import { CheckCircle, Fingerprint, Loader2, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getSomaMe, type SomaUserIdentity } from '../../lib/cortexApi';

interface IdentityStepProps {
  onBack: () => void;
  onFinish: () => void;
}

function shortDid(did: string) {
  if (did.length <= 30) return did;
  return `${did.slice(0, 16)}...${did.slice(-8)}`;
}

export default function IdentityStep({ onBack, onFinish }: IdentityStepProps) {
  const [identity, setIdentity] = useState<SomaUserIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSomaMe()
      .then((me) => {
        if (!cancelled) {
          setIdentity(me);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load identity');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="p-5">
      <div className="mb-5 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
          <Fingerprint className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-white">Confirm your Soma identity</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
            This DID is your signed identity inside Cortex. It lets Cortex prove which user delegated work without exposing account credentials to workers.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Creating identity...
          </div>
        ) : error ? (
          <p className="text-sm text-red-200">{error}</p>
        ) : identity ? (
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">User DID</span>
              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300">
                <CheckCircle className="h-3.5 w-3.5" />
                {identity.has_delegation ? 'Delegation active' : 'Identity ready'}
              </span>
            </div>
            <p className="truncate font-mono text-sm text-white" title={identity.did}>{shortDid(identity.did)}</p>
            <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-[var(--muted)]">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
              Spend receipts, approvals, and worker permissions can be tied back to this identity.
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg px-3 py-2 text-sm text-[var(--muted)] transition hover:bg-white/6 hover:text-white active:scale-95"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onFinish}
          disabled={loading}
          className="rounded-lg bg-[var(--accent-soft)] px-4 py-2 text-sm font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)]/20 active:scale-95 disabled:opacity-50"
        >
          Start building
        </button>
      </div>
    </div>
  );
}
