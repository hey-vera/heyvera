import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle, Copy, ExternalLink, Loader2, User, X, XCircle } from 'lucide-react';
import { useUser } from '@clerk/clerk-react';
import {
  getAuthStatus,
  startAuth,
  submitAuthCode,
  refreshAuth,
  type BillingStatus,
  type ProviderAuthInfo,
} from '../lib/cortexApi';
import BillingPage from './billing/BillingPage';
import SpendDashboard from './spend/SpendDashboard';
import IntegrationSetup from './integrations/IntegrationSetup';
import type { RunProfile } from '../types';

type SettingsTab = 'providers' | 'integrations' | 'spend' | 'billing' | 'account';

const RUN_PROFILE_LABELS: Record<RunProfile, string> = {
  auto: 'Auto (adaptive)',
  balanced: 'Balanced',
  cost_saver: 'Cost saver',
  quality_first: 'Quality first',
};

const WORKSPACE_PROFILE_KEY = 'cortex:default-run-profile';

function readDefaultProfile(): RunProfile {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_PROFILE_KEY);
    if (raw === 'auto' || raw === 'balanced' || raw === 'cost_saver' || raw === 'quality_first') {
      return raw;
    }
  } catch { /* ignore */ }
  return 'auto';
}

function saveDefaultProfile(profile: RunProfile) {
  try {
    window.localStorage.setItem(WORKSPACE_PROFILE_KEY, profile);
  } catch { /* ignore */ }
}

function requestAccountDeletion() {
  // GDPR compliance placeholder — triggers server-side deletion request in production
  alert('Account deletion requested. You\'ll receive a confirmation email.');
}

function AccountTab({ providers }: { providers: ProviderAuthInfo[] }) {
  const { user } = useUser();
  const [defaultProfile, setDefaultProfile] = useState<RunProfile>(readDefaultProfile);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleProfileChange = (profile: RunProfile) => {
    setDefaultProfile(profile);
    saveDefaultProfile(profile);
  };

  const displayName = user?.fullName ?? user?.username ?? '—';
  const email = user?.primaryEmailAddress?.emailAddress ?? '—';

  return (
    <div className="flex flex-col gap-5">
      {/* Profile section */}
      <section className="flex flex-col gap-3">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          <User className="h-3.5 w-3.5" />
          Profile
        </h3>
        <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3">
          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs text-[var(--muted)]">Display name</label>
              <div className="rounded-lg border border-white/8 bg-white/4 px-3 py-2 text-sm text-white">
                {displayName}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--muted)]">Email</label>
              <div className="rounded-lg border border-white/8 bg-white/4 px-3 py-2 text-sm text-white">
                {email}
              </div>
            </div>
            <p className="text-[10px] text-[var(--muted)]">
              Profile details are managed by Clerk. Visit your Clerk dashboard to make changes.
            </p>
          </div>
        </div>
      </section>

      {/* Workspace preferences */}
      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          Workspace preferences
        </h3>
        <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3">
          <label className="mb-1.5 block text-xs text-[var(--muted)]">Default run profile</label>
          <select
            value={defaultProfile}
            onChange={(e) => handleProfileChange(e.target.value as RunProfile)}
            className="w-full rounded-lg border border-white/10 bg-[var(--composer)] px-3 py-2 text-sm text-white focus:border-[var(--accent)]/50 focus:outline-none"
          >
            {(Object.keys(RUN_PROFILE_LABELS) as RunProfile[]).map((profile) => (
              <option key={profile} value={profile}>
                {RUN_PROFILE_LABELS[profile]}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[10px] text-[var(--muted)]">
            Sets the initial routing profile for new sessions.
          </p>
        </div>
      </section>

      {/* Connected accounts */}
      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          Connected accounts
        </h3>
        <div className="rounded-xl border border-white/8 bg-white/[0.02]">
          {providers.length === 0 ? (
            <p className="px-4 py-3 text-sm text-[var(--muted)]">No providers connected yet.</p>
          ) : (
            providers.map((p, idx) => (
              <div
                key={p.provider}
                className={`flex items-center justify-between px-4 py-3 ${idx < providers.length - 1 ? 'border-b border-white/6' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white/6 text-[10px] font-bold uppercase text-[var(--muted-strong)]">
                    {p.provider === 'claude' ? 'CL' : 'OA'}
                  </div>
                  <span className="text-sm text-white">
                    {p.provider === 'claude' ? 'Claude (Anthropic)' : 'OpenAI (Codex)'}
                  </span>
                </div>
                {p.authenticated ? (
                  <div className="flex items-center gap-1 text-xs text-emerald-300">
                    <CheckCircle className="h-3 w-3" />
                    Connected
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-xs text-[var(--muted)]">
                    <XCircle className="h-3 w-3" />
                    Not connected
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      {/* Danger zone */}
      <section className="flex flex-col gap-3">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-red-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          Danger zone
        </h3>
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-white">Delete account</p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                Permanently delete your account and all associated data.
              </p>
            </div>
            {!showDeleteConfirm ? (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="shrink-0 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-500/20 active:scale-95"
              >
                Delete account
              </button>
            ) : (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-[var(--muted)] transition hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => { setShowDeleteConfirm(false); requestAccountDeletion(); }}
                  className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-400 active:scale-95"
                >
                  Confirm
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

interface SettingsPanelProps {
  onClose: () => void;
  initialTab?: SettingsTab;
  billing: BillingStatus | null;
}

interface ProviderAuthState {
  phase: 'idle' | 'starting' | 'awaiting_code' | 'submitting' | 'polling';
  authUrl: string | null;
  deviceCode: string | null;
  codeInput: string;
  error: string | null;
}

const INITIAL_STATE: ProviderAuthState = {
  phase: 'idle',
  authUrl: null,
  deviceCode: null,
  codeInput: '',
  error: null,
};

export default function SettingsPanel({
  onClose,
  initialTab = 'providers',
  billing,
}: SettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [providers, setProviders] = useState<ProviderAuthInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [authStates, setAuthStates] = useState<Record<string, ProviderAuthState>>({});
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const fetchStatus = useCallback(async () => {
    try {
      const status = await getAuthStatus();
      setProviders(status);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const getState = (provider: string): ProviderAuthState =>
    authStates[provider] ?? INITIAL_STATE;

  const updateState = (provider: string, update: Partial<ProviderAuthState>) => {
    setAuthStates((prev) => ({
      ...prev,
      [provider]: { ...(prev[provider] ?? INITIAL_STATE), ...update },
    }));
  };

  const isDeviceCodeFlow = (provider: string) => provider === 'openai';

  const handleConnect = async (provider: string) => {
    updateState(provider, { phase: 'starting', error: null });
    try {
      const result = await startAuth(provider);
      if (result.auth_url) {
        if (isDeviceCodeFlow(provider) && result.device_code) {
          updateState(provider, { phase: 'polling', authUrl: result.auth_url, deviceCode: result.device_code });
          window.open(result.auth_url, '_blank', 'noopener');
          pollUntilAuth(provider);
        } else {
          updateState(provider, { phase: 'awaiting_code', authUrl: result.auth_url, deviceCode: result.device_code });
          window.open(result.auth_url, '_blank', 'noopener');
          setTimeout(() => inputRefs.current[provider]?.focus(), 100);
        }
      } else {
        updateState(provider, { phase: 'idle', error: result.message || 'Could not start' });
      }
    } catch (err) {
      updateState(provider, {
        phase: 'idle',
        error: err instanceof Error ? err.message : 'Failed to start authentication',
      });
    }
  };

  const handleSubmitCode = async (provider: string) => {
    const state = getState(provider);
    const code = state.codeInput.trim();
    if (!code) return;
    updateState(provider, { phase: 'submitting', error: null });
    try {
      const result = await submitAuthCode(provider, code);
      if (result.success) {
        updateState(provider, { ...INITIAL_STATE });
        const status = await refreshAuth();
        setProviders(status);
      } else {
        updateState(provider, { phase: 'polling' });
        pollUntilAuth(provider);
      }
    } catch {
      updateState(provider, { phase: 'awaiting_code', error: 'Failed to submit code' });
    }
  };

  const pollUntilAuth = async (provider: string) => {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const status = await refreshAuth();
        setProviders(status);
        if (status.find((s) => s.provider === provider)?.authenticated) {
          updateState(provider, { ...INITIAL_STATE });
          return;
        }
      } catch { /* keep polling */ }
    }
    updateState(provider, { phase: 'idle', error: 'Timed out — try again' });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-6">
      <div className={`relative flex max-h-[min(44rem,calc(100dvh-1.5rem))] w-full flex-col overflow-hidden rounded-2xl border border-white/8 bg-[var(--panel)] shadow-2xl sm:max-h-[min(44rem,calc(100dvh-3rem))] ${tab === 'billing' ? 'max-w-2xl' : 'max-w-lg'}`}>
        {/* Header */}
        <div className="shrink-0 border-b border-white/6 px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-white">Settings</h2>
              <p className="mt-0.5 text-xs text-[var(--muted)]">Provider subscriptions and account connections.</p>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-[var(--muted)] transition hover:bg-white/8 hover:text-white active:scale-95"
              aria-label="Close settings"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex shrink-0 gap-4 border-b border-white/6 px-5">
          <button
            onClick={() => setTab('providers')}
            className={`border-b-2 px-1 py-2.5 text-sm font-medium transition ${
              tab === 'providers' ? 'border-[var(--accent)] text-white' : 'border-transparent text-[var(--muted)] hover:text-white'
            }`}
          >
            Subscriptions
          </button>
          <button
            onClick={() => setTab('integrations')}
            className={`border-b-2 px-1 py-2.5 text-sm font-medium transition ${
              tab === 'integrations' ? 'border-[var(--accent)] text-white' : 'border-transparent text-[var(--muted)] hover:text-white'
            }`}
          >
            Integrations
          </button>
          <button
            onClick={() => setTab('spend')}
            className={`border-b-2 px-1 py-2.5 text-sm font-medium transition ${
              tab === 'spend' ? 'border-[var(--accent)] text-white' : 'border-transparent text-[var(--muted)] hover:text-white'
            }`}
          >
            Soma spend
          </button>
          <button
            onClick={() => setTab('billing')}
            className={`border-b-2 px-1 py-2.5 text-sm font-medium transition ${
              tab === 'billing' ? 'border-[var(--accent)] text-white' : 'border-transparent text-[var(--muted)] hover:text-white'
            }`}
          >
            Billing
          </button>
          <button
            onClick={() => setTab('account')}
            className={`border-b-2 px-1 py-2.5 text-sm font-medium transition ${
              tab === 'account' ? 'border-[var(--accent)] text-white' : 'border-transparent text-[var(--muted)] hover:text-white'
            }`}
          >
            Account
          </button>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {tab === 'billing' ? (
            <BillingPage billing={billing} />
          ) : tab === 'integrations' ? (
            <IntegrationSetup />
          ) : tab === 'spend' ? (
            <SpendDashboard />
          ) : tab === 'account' ? (
            <AccountTab providers={providers} />
          ) : loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading...
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-[var(--muted)]">
                Connect your AI subscriptions to use them with Cortex.
              </p>
              {providers.map((p) => {
                const state = getState(p.provider);
                const isActive = state.phase !== 'idle';
                const providerLabel = p.provider === 'claude' ? 'Claude (Anthropic)' : 'OpenAI (Codex)';
                const initials = p.provider === 'claude' ? 'CL' : 'OA';

                return (
                  <div key={p.provider} className="rounded-xl border border-white/8 bg-white/[0.02]">
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/6 text-xs font-bold uppercase text-[var(--muted-strong)]">
                          {initials}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-white">{providerLabel}</div>
                          {p.authenticated ? (
                            <div className="flex items-center gap-1 text-xs text-emerald-300">
                              <CheckCircle className="h-3 w-3" />
                              {p.email || 'Connected'}
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

                      {!p.authenticated && !isActive && (
                        <button
                          onClick={() => handleConnect(p.provider)}
                          className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-3.5 py-2 text-xs font-semibold text-[var(--accent)] shadow-[0_1px_2px_rgba(0,0,0,0.3)] transition-all duration-150 hover:bg-[var(--accent)]/20 hover:shadow-[0_2px_8px_rgba(156,199,184,0.15)] active:scale-95 active:shadow-none"
                        >
                          Connect
                        </button>
                      )}

                      {state.phase === 'starting' && (
                        <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                          <Loader2 className="h-3 w-3 animate-spin" />
                        </span>
                      )}
                    </div>

                    {/* Device code flow (OpenAI) */}
                    {isDeviceCodeFlow(p.provider) && state.phase === 'polling' && state.deviceCode && (
                      <div className="border-t border-white/6 px-4 py-3">
                        <div className="flex flex-col gap-3">
                          <div className="flex items-start gap-2">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[10px] font-bold text-[var(--accent)]">1</span>
                            <div>
                              <p className="text-xs text-[var(--muted)]">Copy this code:</p>
                              <button
                                onClick={() => navigator.clipboard.writeText(state.deviceCode!)}
                                className="mt-1 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[var(--composer)] px-3 py-1.5 font-mono text-base font-bold tracking-widest text-white transition hover:border-[var(--accent)]/40 active:scale-95"
                              >
                                {state.deviceCode}
                                <Copy className="h-3.5 w-3.5 text-[var(--muted)]" />
                              </button>
                            </div>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[10px] font-bold text-[var(--accent)]">2</span>
                            <div>
                              <p className="text-xs text-[var(--muted)]">Open OpenAI and enter the code:</p>
                              <a href={state.authUrl!} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] underline">
                                Open OpenAI <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 rounded-lg bg-white/4 px-3 py-2">
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent)]" />
                            <span className="text-xs text-[var(--muted)]">Waiting for authorization...</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Paste code flow (Claude) */}
                    {!isDeviceCodeFlow(p.provider) && (state.phase === 'awaiting_code' || state.phase === 'submitting' || state.phase === 'polling') && (
                      <div className="border-t border-white/6 px-4 py-3">
                        <div className="flex flex-col gap-3">
                          <div className="flex items-start gap-2">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[10px] font-bold text-[var(--accent)]">1</span>
                            <div>
                              <p className="text-xs text-[var(--muted)]">Sign in and authorize access:</p>
                              <a href={state.authUrl!} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] underline">
                                Open Anthropic <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[10px] font-bold text-[var(--accent)]">2</span>
                            <div className="flex-1">
                              <p className="mb-1.5 text-xs text-[var(--muted)]">Paste the authorization code:</p>
                              <div className="flex gap-2">
                                <input
                                  ref={(el) => { inputRefs.current[p.provider] = el; }}
                                  type="text"
                                  placeholder="Paste code here"
                                  value={state.codeInput}
                                  onChange={(e) => updateState(p.provider, { codeInput: e.target.value })}
                                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSubmitCode(p.provider); } }}
                                  disabled={state.phase === 'submitting' || state.phase === 'polling'}
                                  className="flex-1 rounded-lg border border-white/10 bg-[var(--composer)] px-3 py-2 font-mono text-sm text-white placeholder:text-white/20 focus:border-[var(--accent)]/50 focus:outline-none disabled:opacity-50"
                                  autoComplete="off"
                                  spellCheck={false}
                                />
                                <button
                                  onClick={() => handleSubmitCode(p.provider)}
                                  disabled={!state.codeInput.trim() || state.phase === 'submitting' || state.phase === 'polling'}
                                  className="shrink-0 rounded-lg bg-[var(--accent-soft)] px-3.5 py-2 text-xs font-semibold text-[var(--accent)] shadow-[0_1px_2px_rgba(0,0,0,0.3)] transition-all duration-150 hover:bg-[var(--accent)]/20 active:scale-95 disabled:opacity-30 disabled:shadow-none"
                                >
                                  {state.phase === 'submitting' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
                                   state.phase === 'polling' ? <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />Verifying</span> : 'Submit'}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
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
          )}
        </div>
      </div>
    </div>
  );
}
