import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, ExternalLink, Loader2, XCircle } from 'lucide-react';
import {
  getAuthStatus,
  startAuth,
  refreshAuth,
  type ProviderAuthInfo,
} from '../../lib/cortexApi';

interface ProviderStepProps {
  onNext: () => void;
}

interface ProviderAuthState {
  connecting: boolean;
  authUrl: string | null;
  error: string | null;
}

export default function ProviderStep({ onNext }: ProviderStepProps) {
  const [providers, setProviders] = useState<ProviderAuthInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [authStates, setAuthStates] = useState<Record<string, ProviderAuthState>>({});

  const fetchStatus = useCallback(async () => {
    try {
      const status = await getAuthStatus();
      setProviders(status);
      setFetchError(null);
    } catch {
      setFetchError('Cannot reach Cortex backend');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const getAuthState = (provider: string): ProviderAuthState =>
    authStates[provider] ?? { connecting: false, authUrl: null, error: null };

  const updateAuthState = (provider: string, update: Partial<ProviderAuthState>) => {
    setAuthStates((prev) => ({
      ...prev,
      [provider]: { ...getAuthState(provider), ...update },
    }));
  };

  const handleConnect = async (provider: string) => {
    updateAuthState(provider, { connecting: true, authUrl: null, error: null });

    try {
      const result = await startAuth(provider);
      if (result.auth_url) {
        updateAuthState(provider, { authUrl: result.auth_url });
        window.open(result.auth_url, '_blank', 'noopener');
        pollUntilAuth(provider);
      } else {
        updateAuthState(provider, {
          error: result.message,
          connecting: false,
        });
      }
    } catch {
      updateAuthState(provider, {
        error: 'Failed to start authentication',
        connecting: false,
      });
    }
  };

  const pollUntilAuth = async (provider: string) => {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const status = await refreshAuth();
        setProviders(status);
        if (status.find((s) => s.provider === provider)?.authenticated) {
          updateAuthState(provider, {
            connecting: false,
            authUrl: null,
            error: null,
          });
          return;
        }
      } catch {
        // keep polling
      }
    }
    updateAuthState(provider, {
      connecting: false,
      authUrl: null,
      error: 'Authentication timed out — try again',
    });
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

  if (fetchError) {
    return (
      <div className="flex flex-col gap-4 p-5">
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200">
          {fetchError}
        </div>
        <button
          onClick={fetchStatus}
          className="rounded-lg bg-[var(--accent-soft)] px-4 py-2 text-sm font-medium text-[var(--accent)]"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-base font-medium text-white">Connect your AI providers</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Cortex orchestrates your existing subscriptions. Connect at least one.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {providers.map((p) => {
          const state = getAuthState(p.provider);
          return (
            <div
              key={p.provider}
              className="rounded-xl border border-white/8 bg-white/4"
            >
              <div className="flex items-center justify-between px-4 py-3">
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
                        {p.email ?? 'Connected'}
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

                {!p.authenticated && !state.connecting && (
                  <button
                    onClick={() => handleConnect(p.provider)}
                    className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/20"
                  >
                    Connect
                  </button>
                )}

                {state.connecting && (
                  <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Waiting...
                  </span>
                )}
              </div>

              {state.authUrl && (
                <div className="border-t border-white/6 px-4 py-3">
                  <p className="text-xs text-[var(--muted)]">
                    Complete sign-in in the tab that opened. If it didn't open:
                  </p>
                  <a
                    href={state.authUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] underline"
                  >
                    Open authentication page <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}

              {state.error && (
                <div className="border-t border-white/6 px-4 py-2.5">
                  <p className="text-xs text-red-300">{state.error}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-2">
        <button
          onClick={onNext}
          className="text-xs text-[var(--muted)] transition hover:text-white"
        >
          Skip for now
        </button>
        <button
          onClick={onNext}
          disabled={!anyAuthed}
          className="rounded-lg bg-[var(--accent-soft)] px-4 py-2 text-sm font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/20 disabled:opacity-30"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
