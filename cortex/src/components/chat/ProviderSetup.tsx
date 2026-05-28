import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, ExternalLink, Loader2, XCircle } from 'lucide-react';
import {
  getAuthStatus,
  startAuth,
  submitAuthCode,
  type ProviderAuthInfo,
} from '../../lib/cortexApi';

interface ProviderSetupProps {
  onReady: () => void;
}

export default function ProviderSetup({ onReady }: ProviderSetupProps) {
  const [providers, setProviders] = useState<ProviderAuthInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [authInfo, setAuthInfo] = useState<{ auth_url?: string; message?: string } | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
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
    setConnectingProvider(provider);
    setAuthInfo(null);
    setCodeInput('');
    setError(null);

    try {
      const result = await startAuth(provider, 'subscription');
      setAuthInfo({ auth_url: result.auth_url ?? undefined, message: result.message });
      if (result.auth_url) {
        window.open(result.auth_url, '_blank', 'noopener');
      }
    } catch {
      setError('Failed to start authentication');
      setConnectingProvider(null);
    }
  };

  const handleSubmit = async () => {
    if (!connectingProvider || !codeInput.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const result = await submitAuthCode(connectingProvider, codeInput.trim(), undefined, 'subscription');
      if (result.success) {
        setConnectingProvider(null);
        setCodeInput('');
        setAuthInfo(null);
        await fetchStatus();
      } else {
        setError(result.message);
      }
    } catch {
      setError('Failed to save credential');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    setConnectingProvider(null);
    setCodeInput('');
    setAuthInfo(null);
    setError(null);
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
                    {p.email ?? p.label ?? 'Connected'}
                    {p.credential_type ? ` · ${p.credential_type}` : ''}
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-xs text-[var(--muted)]">
                    <XCircle className="h-3 w-3" />
                    Not connected
                  </div>
                )}
              </div>
            </div>

            {!p.authenticated && !connectingProvider && (
              <button
                onClick={() => handleConnect(p.provider)}
                className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/20"
              >
                Connect
              </button>
            )}
          </div>
        ))}
      </div>

      {connectingProvider && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-white">
              Connect {connectingProvider === 'claude' ? 'Claude' : 'OpenAI'}
            </span>
            <button onClick={handleCancel} className="text-xs text-[var(--muted)] hover:text-white transition">
              Cancel
            </button>
          </div>

          {authInfo?.message && (
            <p className="text-xs text-[var(--muted)] mb-3">{authInfo.message}</p>
          )}

          {authInfo?.auth_url && (
            <a
              href={authInfo.auth_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mb-3 inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
            >
              Open provider page <ExternalLink className="h-3 w-3" />
            </a>
          )}

          <div className="flex gap-2 mt-2">
            <input
              type="password"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="Paste your API key or session token..."
              className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              autoFocus
            />
            <button
              onClick={handleSubmit}
              disabled={submitting || !codeInput.trim()}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
            </button>
          </div>
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
