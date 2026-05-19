import { useCallback, useEffect, useMemo, useState } from 'react';
import { GitBranch, Loader2, Play, RefreshCcw } from 'lucide-react';
import { CortexApiError, createRun, getRun, type RunSummary, type RunStep } from '../../lib/cortexApi';
import type { RunProfile } from '../../types';

interface RunPanelProps {
  profile: RunProfile;
  bridgeGoal: string | null;
  bridgeNonce: number;
  onBridgeConsumed: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  leased: 'Leased',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
};

const STATUS_CLASSES: Record<string, string> = {
  pending: 'border-white/8 bg-white/4 text-[var(--muted)]',
  leased: 'border-sky-400/20 bg-sky-400/10 text-sky-200',
  running: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200',
  succeeded: 'border-[var(--accent)]/20 bg-[var(--accent)]/10 text-[var(--accent)]',
  failed: 'border-red-400/20 bg-red-400/10 text-red-200',
};

function statusClass(status: string) {
  return STATUS_CLASSES[status] ?? 'border-white/8 bg-white/4 text-[var(--muted)]';
}

function stepLabel(step: RunStep, index: number) {
  return step.title || step.goal || `Step ${index + 1}`;
}

function getWorkerSignal(run: RunSummary | null) {
  if (!run) return { label: 'Worker status unknown', className: 'border-white/8 bg-white/4 text-[var(--muted)]' };
  const statuses = run.steps.map((step) => step.status);
  if (statuses.some((status) => status === 'leased' || status === 'running' || status === 'succeeded')) {
    return { label: 'Worker activity detected', className: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' };
  }
  if (statuses.length > 0 && statuses.every((status) => status === 'pending')) {
    return { label: 'No worker progress yet', className: 'border-red-400/20 bg-red-400/10 text-red-200' };
  }
  return { label: 'Worker status unknown', className: 'border-white/8 bg-white/4 text-[var(--muted)]' };
}

export default function RunPanel({
  profile,
  bridgeGoal,
  bridgeNonce,
  onBridgeConsumed,
}: RunPanelProps) {
  const [goal, setGoal] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunSummary | null>(null);
  const [expectedSteps, setExpectedSteps] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workerSignal = useMemo(() => getWorkerSignal(run), [run]);

  async function refreshRun(id: string) {
    setIsPolling(true);
    try {
      setRun(await getRun(id));
      setError(null);
    } catch (err) {
      if (err instanceof CortexApiError && err.status === 503) {
        setError('Starting up...');
      } else {
        setError(err instanceof Error ? err.message : 'Could not load run status');
      }
    } finally {
      setIsPolling(false);
    }
  }

  useEffect(() => {
    if (!runId) return;
    void refreshRun(runId);
    const interval = window.setInterval(() => {
      void refreshRun(runId);
    }, 2500);
    return () => window.clearInterval(interval);
  }, [runId]);

  const submitRun = useCallback(async (goalOverride?: string) => {
    const nextGoal = (goalOverride ?? goal).trim();
    if (!nextGoal || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const created = await createRun(nextGoal, profile);
      setRunId(created.run_id);
      setExpectedSteps(created.steps);
      setRun({ id: created.run_id, goal: nextGoal, steps: [] });
      setGoal('');
    } catch (err) {
      if (err instanceof CortexApiError && err.status === 503) {
        setError('Starting up...');
      } else {
        setError(err instanceof Error ? err.message : 'Could not create run');
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [goal, isSubmitting, profile]);

  useEffect(() => {
    if (!bridgeGoal) return;
    setGoal(bridgeGoal);
    void submitRun(bridgeGoal);
    onBridgeConsumed();
  }, [bridgeGoal, bridgeNonce, onBridgeConsumed, submitRun]);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
            Ship Captain
          </h3>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            Create a decomposed run for compound coding goals.
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] ${workerSignal.className}`}>
          {workerSignal.label}
        </span>
      </div>

      <div className="rounded-xl border border-white/8 bg-white/[0.03] p-2">
        <textarea
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          rows={3}
          placeholder="Fix the auth bug, add tests, and prepare the commit."
          className="max-h-28 min-h-20 w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-6 text-white outline-none placeholder:text-[var(--muted)]"
        />
        <div className="flex items-center justify-between gap-2 border-t border-white/6 pt-2">
          <span className="truncate px-1 text-[11px] text-[var(--muted)]">
            Profile: {profile.replace('_', '-')}
          </span>
          <button
            type="button"
            disabled={!goal.trim() || isSubmitting}
            onClick={() => void submitRun()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-black transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Run
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
          {error}
        </div>
      )}

      {run && (
        <div className="rounded-xl border border-white/8 bg-black/15 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{run.goal}</p>
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                {run.steps.length || expectedSteps || 0} steps · {run.id}
              </p>
            </div>
            <button
              type="button"
              disabled={isPolling}
              onClick={() => runId && void refreshRun(runId)}
              className="rounded-lg p-1.5 text-[var(--muted)] transition hover:bg-white/6 hover:text-white active:scale-95 disabled:opacity-50"
              aria-label="Refresh run"
            >
              <RefreshCcw className={`h-3.5 w-3.5 ${isPolling ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {run.steps.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-xs text-[var(--muted)]">
                Waiting for scheduler steps.
              </div>
            ) : (
              run.steps.map((step, index) => (
                <div
                  key={step.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-2"
                >
                  <span className="inline-flex min-w-0 items-center gap-2 text-xs text-[var(--muted-strong)]">
                    <GitBranch className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
                    <span className="truncate">{stepLabel(step, index)}</span>
                  </span>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${statusClass(step.status)}`}>
                    {STATUS_LABELS[step.status] ?? step.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}
