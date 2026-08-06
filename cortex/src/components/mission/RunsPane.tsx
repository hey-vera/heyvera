import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Circle, Loader2, RefreshCw } from 'lucide-react';
import {
  getRun,
  listRuns,
  streamRun,
  type RunListItem,
  type RunStep,
  type RunSummary,
} from '../../lib/cortexApi';

/**
 * Runs — pane one of mission control (SURFACE.md).
 *
 * Live state over SSE, per PLAN §6. WebSockets stay out of the frontend; the
 * WS infrastructure is for workers.
 *
 * What this pane deliberately does NOT show yet: receipts. A step's verdict
 * belongs here (VERIFIER.md V6) and will be, but the verifier does not execute
 * anything yet — rendering a "verified" badge now would be the hollow gate
 * shipped to customers. The pane says so where the badge will go, rather than
 * leaving a silence a reader fills in optimistically.
 */

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'completed']);

function StatusIcon({ status }: { status: string }) {
  if (status === 'succeeded' || status === 'completed') {
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />;
  }
  if (status === 'failed' || status === 'cancelled') {
    return <AlertCircle className="h-3.5 w-3.5 text-red-400" />;
  }
  if (status === 'running' || status === 'leased') {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent)]" />;
  }
  return <Circle className="h-3.5 w-3.5 text-[var(--muted)]" />;
}

function StepRow({ step }: { step: RunStep }) {
  const attempts =
    step.attempt_count && step.attempt_count > 1
      ? `attempt ${step.attempt_count}${step.max_attempts ? `/${step.max_attempts}` : ''}`
      : null;

  return (
    <li className="flex items-start gap-2.5 border-b border-white/5 px-3 py-2.5 last:border-b-0">
      <span className="mt-0.5">
        <StatusIcon status={step.status} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-white">
          {step.title || step.objective || step.goal || step.id}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--muted)]">
          <span>{step.status}</span>
          {step.kind && <span>· {step.kind}</span>}
          {step.tier && <span>· {step.tier}</span>}
          {step.risk && <span>· risk {step.risk}</span>}
          {attempts && <span>· {attempts}</span>}
        </p>
      </div>
    </li>
  );
}

export default function RunsPane() {
  const [runs, setRuns] = useState<RunListItem[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const streamRef = useRef<AbortController | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      const items = await listRuns(25, 0);
      setRuns(items);
      setError(null);
      setSelected((current) => current ?? items[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not load runs');
      setRuns([]);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  // One stream per selected run, torn down on switch. Without the cleanup a
  // user clicking through five runs would hold five open connections, and the
  // last one to deliver would win — which looks exactly like flapping state.
  useEffect(() => {
    streamRef.current?.abort();
    streamRef.current = null;
    setDetail(null);
    setLive(false);
    if (!selected) return;

    let cancelled = false;

    void (async () => {
      try {
        const summary = await getRun(selected);
        if (cancelled) return;
        setDetail(summary);
        setError(null);

        if (summary.status && TERMINAL.has(summary.status)) return;

        streamRef.current = streamRun(
          selected,
          (event) => {
            if (cancelled) return;
            setLive(true);
            setDetail((current) =>
              current
                ? {
                    ...current,
                    steps: event.steps ?? current.steps,
                    graph: event.graph ?? current.graph,
                    status: event.status ?? current.status,
                  }
                : current,
            );
            if (event.type === 'run_complete') setLive(false);
          },
          (err) => {
            if (cancelled) return;
            setLive(false);
            setError(err.message);
          },
        );
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'could not load run');
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.abort();
      streamRef.current = null;
    };
  }, [selected]);

  if (runs === null) {
    return <div className="p-8 text-sm text-[var(--muted)]">Loading runs…</div>;
  }

  // "Nothing has run yet" and "we could not ask" are different facts, and
  // only one of them is the user's problem. Conflating them tells someone
  // their work vanished when the truth is the backend is unreachable.
  if (runs.length === 0) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <h1 className="text-lg font-semibold text-white">Runs</h1>
        {error ? (
          <>
            <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
              Could not reach the Cortex API, so this list may be incomplete —
              this is not the same as having no runs.
            </p>
            <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
            <button
              type="button"
              onClick={() => void loadRuns()}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/6 px-3 py-1.5 text-xs text-white transition hover:bg-white/12"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Try again
            </button>
          </>
        ) : (
          <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
            Nothing has run yet. Start a task from the chat pane and it appears
            here, step by step, as it executes.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-72 shrink-0 overflow-y-auto border-r border-white/8">
        <div className="flex items-center justify-between px-3 py-2.5">
          <h1 className="text-sm font-semibold text-white">Runs</h1>
          <button
            type="button"
            onClick={() => void loadRuns()}
            className="rounded p-1 text-[var(--muted)] transition hover:bg-white/6 hover:text-white"
            aria-label="Refresh runs"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        <ul>
          {runs.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                onClick={() => setSelected(run.id)}
                className={`flex w-full items-start gap-2 border-b border-white/5 px-3 py-2.5 text-left transition ${
                  selected === run.id ? 'bg-white/8' : 'hover:bg-white/4'
                }`}
              >
                <span className="mt-0.5">
                  <StatusIcon status={run.status} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-white">{run.goal}</span>
                  <span className="block text-[11px] text-[var(--muted)]">
                    {run.status} · {run.profile}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto">
        {error && (
          <p className="border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        {!detail ? (
          <div className="p-8 text-sm text-[var(--muted)]">Loading run…</div>
        ) : (
          <div className="p-4">
            <header className="mb-3">
              <h2 className="text-base font-semibold text-white">{detail.goal}</h2>
              <p className="mt-1 flex items-center gap-2 text-[11px] text-[var(--muted)]">
                <span>{detail.status ?? 'unknown'}</span>
                {detail.profile && <span>· {detail.profile}</span>}
                {live && (
                  <span className="inline-flex items-center gap-1 text-[var(--accent)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                    live
                  </span>
                )}
              </p>
            </header>

            <ul className="rounded-lg border border-white/8 bg-white/[0.02]">
              {detail.steps.length === 0 ? (
                <li className="px-3 py-4 text-sm text-[var(--muted)]">No steps yet.</li>
              ) : (
                detail.steps.map((step) => <StepRow key={step.id} step={step} />)
              )}
            </ul>

            <p className="mt-3 rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-[var(--muted)]">
              Verification receipts will appear against each step once the verifier
              runs checks itself (VERIFIER.md V1–V5). Until then no step here claims
              to be verified — a badge with nothing behind it is worse than no badge.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
