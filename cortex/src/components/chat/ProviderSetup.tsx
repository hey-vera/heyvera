import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, ExternalLink, Loader2, XCircle } from 'lucide-react';
import {
  getAuthStatus,
  startAuth,
  refreshAuth,
  type ProviderAuthInfo,
} from '../../lib/cortexApi';

interface ProviderSetupProps {
  onReady: () => void;
}

export default function ProviderSetup({ onReady }: ProviderSetupProps) {
  const [providers, setProviders] = useState<ProviderAuthInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [authInProgress, setAuthInProgress] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const status = await getAuthStatus();
      setProviders(status);
      if (status.some((p) => p.authenticated)) {
        onReady();
      }
    } catch {
      setError('Cannot reach Cortex backend');
    } finally {
      setLoading(false);
    }
  }, [onReady]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleConnect = async (provider: string) => {
    setAuthInProgress(provider);
    setAuthUrl(null);
    setError(null);

    try {
      const result = await startAuth(provider);
      if (result.auth_url) {
        setAuthUrl(result.auth_url);
        window.open(result.auth_url, '_blank', 'noopener');
        pollUntilAuth(provider);
      } else {
        setError(result.message);
        setAuthInProgress(null);
      }
    } catch {
      setError('Failed to start authentication');
      setAuthInProgress(null);
    }
  };

  const pollUntilAuth = async (provider: string) => {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const status = await refreshAuth();
        setProviders(status);
        const p = status.find((s) => s.provider === provider);
        if (p?.authenticated) {
          setAuthInProgress(null);
          setAuthUrl(null);
          if (status.some((s) => s.authenticated)) {
            onReady();
          }
          return;
        }
      } catch {
        // keep polling
      }
    }
    setAuthInProgress(null);
    setAuthUrl(null);
    setError('Authentication timed out — try again');
  };

  const anyAuthed = providers.some((p) => p.authenticated);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-8 text-sm text-[var(--muted)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking providers...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-base font-medium text-white">Connect your AI providers</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Cortex routes work across your existing subscriptions. Connect at least one to get started.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {providers.map((p) => (
          <div
            key={p.provider}
            className="flex items-center justify-between rounded-xl border border-white/8 bg-white/4 px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/6 text-xs font-bold uppercase text-[var(--muted-strong)]">
                {p.provider === 'claude' ? 'CL' : 'OA'}
              </div>
              <div>
                <div className="text-sm font-medium text-white">
                  {p.provider === 'claude' ? 'Claude (Anthropic)' : 'OpenAI (Codex)'}
                </div>
                {p.authenticated ? (
                  <div className="flex items-center gap-1 text-xs text-emerald-300">
                    <CheckCircle className="h-3 w-3" />
                    {p.email ?? p.subscription ?? 'Connected'}
                    {p.subscription ? ` · ${p.subscription}` : ''}
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-xs text-[var(--muted)]">
                    <XCircle className="h-3 w-3" />
                    Not connected
                  </div>
                )}
              </div>
            </div>

            {!p.authenticated && (
              <button
                onClick={() => handleConnect(p.provider)}
                disabled={authInProgress !== null}
                className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/20 disabled:opacity-40"
              >
                {authInProgress === p.provider ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Waiting...
                  </span>
                ) : (
                  'Connect'
                )}
              </button>
            )}
          </div>
        ))}
      </div>

      {authUrl && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
          <p className="text-xs text-amber-200">
            Complete sign-in in the browser tab that opened. If it didn't open:
          </p>
          <a
            href={authUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-100 underline"
          >
            Open authentication page <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200">
          {error}
        </div>
      )}

      {anyAuthed && (
        <button
          onClick={onReady}
          className="self-end rounded-lg bg-[var(--accent-soft)] px-4 py-2 text-sm font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/20"
        >
          Continue to chat
        </button>
      )}
    </div>
  );
}
