import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, MessageSquare, Radio, Settings, ShieldCheck, Video } from 'lucide-react';
import {
  createLiveSession,
  endLiveSession,
  fetchLiveSessions,
  goLiveSession,
  type LiveSession,
} from '../api/social';
import { useAuth } from '../hooks/useAuth';
import {
  LIVE_DEFAULT_PHASE,
  LIVE_INGEST_FOUNDATION_DETAIL,
  hasLivePlayback,
  isLiveChromeAllowed,
  liveSessionToUiPhase,
  liveStreamBadgeLabel,
  type LiveStreamPhase,
} from '../utils/mediaHonesty';

const SETUP_STEPS = [
  'Verify Clerk account and HeyVera profile',
  'Create a LiveSession (preview phase) via API',
  'Go live — phase becomes live in DB (provider URLs may still be null)',
  'Wire encoder ingest / playback provider (Wave 14k — not yet)',
];

function sessionSubtitle(session: LiveSession): string {
  const handle = session.owner?.handle ? `@${session.owner.handle}` : 'Unknown page';
  if (session.phase === 'live' && !hasLivePlayback(session)) {
    return `${handle} · phase live · no playback yet`;
  }
  if (session.phase === 'live' && hasLivePlayback(session)) {
    return `${handle} · broadcasting`;
  }
  if (session.phase === 'ended') {
    return `${handle} · ended`;
  }
  return `${handle} · ${session.phase}`;
}

export function LivePage() {
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const [sessions, setSessions] = useState<LiveSession[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'live' | 'error'>('loading');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createTitle, setCreateTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  const reload = useCallback(() => setRefresh((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    (async () => {
      try {
        let token: string | null = null;
        if (authEnabled && isSignedIn) {
          token = await getToken();
        }
        const result = await fetchLiveSessions({
          limit: 30,
          mine: !!(token && authEnabled && isSignedIn),
          token,
        });
        if (!cancelled) {
          setSessions(result.sessions ?? []);
          setStatus('live');
        }
      } catch {
        if (!cancelled) {
          setSessions(null);
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authEnabled, isSignedIn, getToken, refresh]);

  const selected = useMemo(() => {
    if (!sessions || sessions.length === 0) return null;
    if (selectedId) {
      return sessions.find((s) => s.id === selectedId) ?? sessions[0];
    }
    // Prefer a live session, then first.
    return sessions.find((s) => s.phase === 'live') ?? sessions[0];
  }, [sessions, selectedId]);

  const uiPhase: LiveStreamPhase = selected
    ? liveSessionToUiPhase(selected)
    : LIVE_DEFAULT_PHASE;
  const playerBadge = liveStreamBadgeLabel(uiPhase);
  // LIVE chrome only for phase live; prefer playback for actual stream attach.
  const showLiveChrome = isLiveChromeAllowed(uiPhase);
  const playbackReady = hasLivePlayback(selected);

  const onCreate = async () => {
    if (!authEnabled || !isSignedIn) return;
    const title = createTitle.trim();
    if (!title) {
      setActionError('Title is required');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const token = await getToken();
      if (!token) {
        setActionError('Sign in required');
        return;
      }
      const { session } = await createLiveSession(token, { title });
      setCreateTitle('');
      setSelectedId(session.id);
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  const onGoLive = async (id: string) => {
    if (!authEnabled || !isSignedIn) return;
    setBusy(true);
    setActionError(null);
    try {
      const token = await getToken();
      if (!token) {
        setActionError('Sign in required');
        return;
      }
      await goLiveSession(token, id);
      setSelectedId(id);
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Go live failed');
    } finally {
      setBusy(false);
    }
  };

  const onEnd = async (id: string) => {
    if (!authEnabled || !isSignedIn) return;
    setBusy(true);
    setActionError(null);
    try {
      const token = await getToken();
      if (!token) {
        setActionError('Sign in required');
        return;
      }
      await endLiveSession(token, id);
      setSelectedId(id);
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'End failed');
    } finally {
      setBusy(false);
    }
  };

  const hasSessions = Array.isArray(sessions) && sessions.length > 0;
  const isEmpty = status === 'live' && Array.isArray(sessions) && sessions.length === 0;

  return (
    <div className="min-h-screen px-3 pb-10 pt-4 sm:px-5" style={{ color: 'var(--text-primary)' }}>
      <header className="mb-5 border-b pb-4" style={{ borderColor: 'var(--border-primary)' }}>
        <div
          className="mb-2 inline-flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.08em]"
          style={{ color: 'var(--text-secondary)' }}
        >
          <Radio className="h-4 w-4" aria-hidden="true" />
          Social / Live
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-[28px] font-black leading-tight sm:text-[34px]">Live</h1>
            <p className="mt-1 max-w-2xl text-[15px]" style={{ color: 'var(--text-secondary)' }}>
              LiveSession model is live on the API. Phase is real DB state; encoder ingest and
              playback providers ship later (Wave 14k).
            </p>
          </div>
        </div>
      </header>

      <div
        className="mb-5 rounded-2xl border px-4 py-3"
        style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}
        role="status"
      >
        <p className="text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>
          Wave 14i — LiveSession model
        </p>
        <p className="mt-1 text-[13px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {LIVE_INGEST_FOUNDATION_DETAIL} LIVE badge only when phase is live
          {showLiveChrome ? '' : ' (no LIVE chrome without phase=live)'}.
        </p>
      </div>

      {actionError && (
        <div
          className="mb-4 rounded-xl border px-3 py-2 text-[13px]"
          style={{ borderColor: '#dc2626', color: '#fca5a5' }}
          role="alert"
        >
          {actionError}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <main className="min-w-0">
          <section
            className="border"
            style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}
          >
            <div
              className="relative flex min-h-[320px] items-center justify-center border-b"
              style={{ borderColor: 'var(--border-primary)', backgroundColor: '#050505' }}
            >
              <div className="text-center px-4">
                <span
                  className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full"
                  style={{ backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff' }}
                >
                  <Radio className="h-8 w-8" aria-hidden="true" />
                </span>
                <h2 className="text-[24px] font-black text-white">
                  {selected ? selected.title : 'Live room'}
                </h2>
                <p className="mt-2 max-w-md text-[14px] text-white/70 mx-auto">
                  {status === 'loading' && 'Loading sessions…'}
                  {status === 'error' && 'Could not load live sessions. Try again later.'}
                  {isEmpty &&
                    'No live sessions yet. Create a preview session, then go live. Playback attaches when a provider is wired.'}
                  {selected && showLiveChrome && !playbackReady && (
                    <>
                      Phase is <strong>live</strong> in the database, but no playback URL yet —
                      stream offline until Wave 14k provider.
                    </>
                  )}
                  {selected && showLiveChrome && playbackReady && (
                    <>Playback URL present — attach player to this session.</>
                  )}
                  {selected && !showLiveChrome && (
                    <>Session phase: {selected.phase}. Not broadcasting.</>
                  )}
                </p>
              </div>
              <span
                className="absolute left-3 top-3 rounded-full px-3 py-1 text-[13px] font-black"
                style={{
                  backgroundColor: showLiveChrome ? '#dc2626' : 'var(--border-primary)',
                  color: showLiveChrome ? '#fff' : 'var(--text-secondary)',
                }}
                data-live-chrome={showLiveChrome ? 'true' : 'false'}
                data-playback-ready={playbackReady ? 'true' : 'false'}
              >
                {playerBadge}
              </span>
            </div>
            <div className="grid gap-4 p-4 md:grid-cols-[1fr_280px]">
              <div>
                <h2 className="text-[22px] font-black">
                  {selected?.title ?? 'No session selected'}
                </h2>
                <p className="mt-2 text-[15px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  {selected?.description?.trim()
                    ? selected.description
                    : 'Sessions belong to the steward Page (profile). Create, go live, and end are real API transitions.'}
                </p>
                {selected && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <span
                      className="rounded-full border px-3 py-1.5 text-[13px] font-semibold"
                      style={{ borderColor: 'var(--border-primary)', color: 'var(--accent)' }}
                    >
                      phase:{selected.phase}
                    </span>
                    <span
                      className="rounded-full border px-3 py-1.5 text-[13px] font-semibold"
                      style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
                    >
                      provider:{selected.provider || 'none'}
                    </span>
                    {selected.owner?.handle && (
                      <span
                        className="rounded-full border px-3 py-1.5 text-[13px] font-semibold"
                        style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
                      >
                        @{selected.owner.handle}
                      </span>
                    )}
                  </div>
                )}
                {selected && authEnabled && isSignedIn && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {(selected.phase === 'preview' || selected.phase === 'scheduled') && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onGoLive(selected.id)}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[14px] font-bold disabled:opacity-50"
                        style={{ backgroundColor: 'var(--accent)', color: '#000' }}
                      >
                        <Video className="h-4 w-4" aria-hidden="true" />
                        Go live
                      </button>
                    )}
                    {selected.phase !== 'ended' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onEnd(selected.id)}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-full border px-4 text-[14px] font-bold disabled:opacity-50"
                        style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                      >
                        End session
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div
                className="border p-3"
                style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}
              >
                <h3 className="mb-2 flex items-center gap-2 text-[15px] font-black">
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />
                  Live comments (not wired)
                </h3>
                <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                  Chat is out of scope for Wave 14i. Session phase and ownership are real; comments
                  come later.
                </p>
              </div>
            </div>
          </section>

          <section className="mt-6">
            <h2 className="mb-3 text-[20px] font-black">Sessions</h2>
            {status === 'loading' && (
              <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                Loading…
              </p>
            )}
            {status === 'error' && (
              <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                Sessions unavailable.
              </p>
            )}
            {isEmpty && (
              <p className="mb-3 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                Honest empty — no sessions from the API. Nothing invented.
              </p>
            )}
            {hasSessions && (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {sessions!.map((session) => {
                  const phase = liveSessionToUiPhase(session);
                  const badge = liveStreamBadgeLabel(phase);
                  const liveChrome = isLiveChromeAllowed(phase);
                  const active = selected?.id === session.id;
                  return (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => setSelectedId(session.id)}
                      className="border p-4 text-left"
                      style={{
                        borderColor: active ? 'var(--accent)' : 'var(--border-primary)',
                        backgroundColor: 'var(--bg-elevated)',
                      }}
                    >
                      <span
                        className="mb-3 inline-flex items-center gap-2 text-[13px] font-bold"
                        style={{ color: liveChrome ? '#f87171' : 'var(--text-secondary)' }}
                      >
                        <CalendarClock className="h-4 w-4" aria-hidden="true" />
                        {badge}
                      </span>
                      <h3 className="text-[16px] font-black leading-snug">{session.title}</h3>
                      <p className="mt-1 text-[14px]" style={{ color: 'var(--text-secondary)' }}>
                        {sessionSubtitle(session)}
                      </p>
                      <p className="mt-3 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {hasLivePlayback(session)
                          ? 'Playback URL present'
                          : session.phase === 'live'
                            ? 'Live phase · no playback URL'
                            : `Phase: ${session.phase}`}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </main>

        <aside className="grid content-start gap-4">
          <section
            className="border p-4"
            style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}
          >
            <h2 className="mb-3 flex items-center gap-2 text-[17px] font-black">
              <Video className="h-5 w-5" style={{ color: 'var(--accent)' }} aria-hidden="true" />
              Create session
            </h2>
            {!authEnabled || !isSignedIn ? (
              <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>
                Sign in with a HeyVera profile to create a preview session.
              </p>
            ) : (
              <div className="grid gap-3">
                <label className="grid gap-1 text-[13px] font-semibold">
                  Title
                  <input
                    type="text"
                    value={createTitle}
                    onChange={(e) => setCreateTitle(e.target.value)}
                    maxLength={200}
                    placeholder="Studio open room"
                    className="h-10 rounded-lg border px-3 text-[14px] font-normal"
                    style={{
                      borderColor: 'var(--border-primary)',
                      backgroundColor: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                    }}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || !createTitle.trim()}
                  onClick={onCreate}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[14px] font-bold disabled:opacity-50"
                  style={{ backgroundColor: 'var(--accent)', color: '#000' }}
                >
                  Create preview session
                </button>
              </div>
            )}
          </section>

          <section
            className="border p-4"
            style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}
          >
            <h2 className="mb-3 flex items-center gap-2 text-[17px] font-black">
              <Settings className="h-5 w-5" style={{ color: 'var(--accent)' }} aria-hidden="true" />
              Creator setup
            </h2>
            <ol className="grid gap-3">
              {SETUP_STEPS.map((step, index) => (
                <li key={step} className="flex gap-3 text-[14px]" style={{ color: 'var(--text-secondary)' }}>
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-black"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--accent) 16%, transparent)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </section>

          <section
            className="border p-4"
            style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}
          >
            <h2 className="mb-2 flex items-center gap-2 text-[17px] font-black">
              <ShieldCheck className="h-5 w-5" style={{ color: 'var(--accent)' }} aria-hidden="true" />
              Account routing
            </h2>
            <p className="text-[14px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Create / go-live / end require a signed-in Clerk user with a HeyVera profile. Public
              viewers can list phase=live sessions. Ingest provider integration is not in this wave.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
