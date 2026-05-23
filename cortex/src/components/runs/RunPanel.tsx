import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, FileText, GitBranch, GitPullRequest, Loader2, Play, RefreshCcw } from 'lucide-react';
import {
  CortexApiError,
  createRun,
  createRunPullRequest,
  getAuthStatus,
  getRun,
  listRuns,
  streamRun,
  type RunListItem,
  type RunSummary,
  type RunStep,
} from '../../lib/cortexApi';
import type { RunProfile } from '../../types';

interface RunPanelProps {
  profile: RunProfile;
  bridgeGoal: string | null;
  bridgeNonce: number;
  onBridgeConsumed: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  ready: 'Ready',
  leased: 'Leased',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  recovered: 'Recovered',
  cancelled: 'Cancelled',
  orphaned: 'Orphaned',
  skipped: 'Skipped',
};

const STATUS_CLASSES: Record<string, string> = {
  pending: 'border-white/8 bg-white/4 text-[var(--muted)]',
  ready: 'border-white/8 bg-white/4 text-[var(--muted)]',
  leased: 'border-sky-400/20 bg-sky-400/10 text-sky-200',
  running: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200',
  succeeded: 'border-[var(--accent)]/20 bg-[var(--accent)]/10 text-[var(--accent)]',
  failed: 'border-red-400/20 bg-red-400/10 text-red-200',
  recovered: 'border-amber-300/20 bg-amber-300/10 text-amber-200',
  cancelled: 'border-zinc-300/20 bg-zinc-300/10 text-zinc-200',
  orphaned: 'border-orange-300/20 bg-orange-300/10 text-orange-200',
  skipped: 'border-zinc-300/20 bg-zinc-300/10 text-zinc-200',
};

const HEALTH_LABELS: Record<string, string> = {
  attempts_exhausted: 'Attempts exhausted',
  in_progress: 'In progress',
  lease_stale: 'Lease stale',
  ready: 'Ready',
  terminal: 'Terminal',
  verification_rejected: 'Verification rejected',
  waiting_on_dependency: 'Waiting on dependency',
};

function statusClass(status: string) {
  return STATUS_CLASSES[status] ?? 'border-white/8 bg-white/4 text-[var(--muted)]';
}

function stepLabel(step: RunStep, index: number) {
  return step.title || step.objective || step.goal || `Step ${index + 1}`;
}

function stepDetail(step: RunStep) {
  if (step.last_error || step.error) return step.last_error || step.error;
  if (step.output_summary) return step.output_summary;
  if (step.verification_status) {
    const verdict = step.verifier_verdict ? ` · ${step.verifier_verdict}` : '';
    return `${step.verification_status}${verdict}`;
  }
  return null;
}

function stepRecipeLine(step: RunStep) {
  const kind = step.work_recipe?.kind ?? step.work_kind;
  const paths = step.work_recipe?.target_paths ?? [];
  const checks = step.required_checks ?? step.work_recipe?.required_checks ?? [];
  const parts = [];
  if (kind) parts.push(kind);
  if (paths.length > 0) parts.push(paths.slice(0, 2).join(', '));
  if (checks.length > 0) parts.push(`${checks.length} check${checks.length === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

function stepHealthLabel(step: RunStep) {
  if (!step.health) return null;
  return HEALTH_LABELS[step.health] ?? step.health.replaceAll('_', ' ');
}

function blockedByLine(step: RunStep, run: RunSummary) {
  if (!step.blocked_by?.length) return null;
  const labels = step.blocked_by.map((blocker) => {
    const match = run.steps.find((candidate) => candidate.id === blocker.id);
    const label = match ? stepLabel(match, run.steps.indexOf(match)) : blocker.id;
    return `${label ?? 'dependency'} (${blocker.status ?? 'unknown'})`;
  });
  return labels.join(', ');
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

function formatRunTime(timestamp: string) {
  return new Date(timestamp).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
}

function mergeSteps(currentSteps: RunStep[], nextSteps: RunStep[]) {
  const byId = new Map(currentSteps.map((step) => [step.id, step]));
  return nextSteps.map((step) => ({ ...(byId.get(step.id) ?? {}), ...step }));
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
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [expectedSteps, setExpectedSteps] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingRun, setIsLoadingRun] = useState(false);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [isCreatingPr, setIsCreatingPr] = useState(false);
  const [pullRequest, setPullRequest] = useState<{ pr_url: string; branch: string } | null>(null);
  const [providerReady, setProviderReady] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const streamRef = useRef<AbortController | null>(null);
  const workerSignal = useMemo(() => getWorkerSignal(run), [run]);
  const operationMap = useMemo(() => {
    const nodes = run?.graph?.nodes ?? [];
    const edges = run?.graph?.edges ?? [];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const incomingByNode = new Map<string, typeof edges>();

    for (const edge of edges) {
      if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) continue;
      incomingByNode.set(edge.to, [...(incomingByNode.get(edge.to) ?? []), edge]);
    }

    return { nodes, edges, nodeById, incomingByNode };
  }, [run?.graph]);
  const selectedStep = useMemo(() => {
    if (!run?.steps.length) return null;
    return run.steps.find((step) => step.id === selectedStepId) ?? run.steps[0] ?? null;
  }, [run?.steps, selectedStepId]);

  const refreshRuns = useCallback(async () => {
    setIsLoadingRuns(true);
    try {
      setRuns(await listRuns(8));
    } catch {
      // run history is secondary to creating a run
    } finally {
      setIsLoadingRuns(false);
    }
  }, []);

  const refreshRun = useCallback(async (id: string) => {
    setIsLoadingRun(true);
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
      setIsLoadingRun(false);
    }
  }, []);

  useEffect(() => {
    if (!runId) return;
    streamRef.current?.abort();
    streamRef.current = null;

    void refreshRun(runId);

    const controller = streamRun(
      runId,
      (event) => {
        setRun((currentRun) => {
          if (!currentRun || currentRun.id !== event.run_id) return currentRun;
          if (event.type === 'run_update' && event.steps) {
            return {
              ...currentRun,
              steps: mergeSteps(currentRun.steps, event.steps),
              graph: event.graph ?? currentRun.graph,
            };
          }
          if (event.type === 'run_complete') {
            return { ...currentRun, status: event.status ?? currentRun.status };
          }
          return currentRun;
        });
        if (event.type === 'run_complete') {
          void refreshRuns();
        }
      },
      (err) => {
        setError(err instanceof CortexApiError && err.status === 503
          ? 'Starting up...'
          : err.message);
      },
    );
    streamRef.current = controller;

    return () => {
      controller.abort();
      if (streamRef.current === controller) streamRef.current = null;
    };
  }, [refreshRun, refreshRuns, runId]);

  useEffect(() => {
    void refreshRuns();
  }, [refreshRuns]);

  useEffect(() => {
    let cancelled = false;

    async function fetchProviderReadiness() {
      try {
        const providers = await getAuthStatus();
        if (!cancelled) {
          setProviderReady(providers.some((provider) => provider.authenticated));
        }
      } catch {
        if (!cancelled) setProviderReady(null);
      }
    }

    void fetchProviderReadiness();
    const interval = window.setInterval(fetchProviderReadiness, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const submitRun = useCallback(async (goalOverride?: string) => {
    const nextGoal = (goalOverride ?? goal).trim();
    if (!nextGoal || isSubmitting) return;
    if (providerReady === false) {
      setError('Connect at least one provider before creating a run.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const created = await createRun(nextGoal, profile);
      setRunId(created.run_id);
      setExpectedSteps(created.steps);
      setRun({ id: created.run_id, goal: nextGoal, steps: [] });
      setSelectedStepId(null);
      setPullRequest(null);
      setGoal('');
      void refreshRuns();
    } catch (err) {
      if (err instanceof CortexApiError && err.status === 503) {
        setError('Starting up...');
      } else {
        setError(err instanceof Error ? err.message : 'Could not create run');
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [goal, isSubmitting, profile, providerReady, refreshRuns]);

  useEffect(() => {
    if (!bridgeGoal) return;
    setGoal(bridgeGoal);
    void submitRun(bridgeGoal);
    onBridgeConsumed();
  }, [bridgeGoal, bridgeNonce, onBridgeConsumed, submitRun]);

  async function selectRun(nextRunId: string) {
    setRunId(nextRunId);
    setSelectedStepId(null);
    setPullRequest(null);
    await refreshRun(nextRunId);
  }

  async function createPr() {
    if (!runId || isCreatingPr) return;
    setIsCreatingPr(true);
    setError(null);
    try {
      setPullRequest(await createRunPullRequest(runId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create pull request');
    } finally {
      setIsCreatingPr(false);
    }
  }

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
            {providerReady === false ? 'Provider required' : `Profile: ${profile.replace('_', '-')}`}
          </span>
          <button
            type="button"
            disabled={!goal.trim() || isSubmitting || providerReady === false}
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
              disabled={isLoadingRun}
              onClick={() => runId && void refreshRun(runId)}
              className="rounded-lg p-1.5 text-[var(--muted)] transition hover:bg-white/6 hover:text-white active:scale-95 disabled:opacity-50"
              aria-label="Refresh run"
            >
              <RefreshCcw className={`h-3.5 w-3.5 ${isLoadingRun ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {operationMap.nodes.length > 0 && (
            <div className="mt-3 rounded-lg border border-white/8 bg-white/[0.02] p-2.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-[var(--muted-strong)]">
                  <GitBranch className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
                  <span className="truncate">Operation map</span>
                </span>
                <span className="shrink-0 text-[10px] text-[var(--muted)]">
                  {operationMap.nodes.length} ops · {operationMap.edges.length} deps
                </span>
              </div>
              <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
                {operationMap.nodes.map((node) => {
                  const incoming = operationMap.incomingByNode.get(node.id) ?? [];
                  const status = node.status ?? 'pending';
                  const dependencyLabels = incoming
                    .map((edge) => operationMap.nodeById.get(edge.from)?.label)
                    .filter(Boolean);
                  return (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => setSelectedStepId(node.id)}
                      className={`w-full min-w-0 rounded-md border px-2 py-1.5 text-left transition hover:bg-white/6 active:scale-[0.99] ${
                        selectedStep?.id === node.id
                          ? 'border-[var(--accent)]/30 bg-[var(--accent)]/10'
                          : 'border-white/8 bg-black/10'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <span className={`h-2 w-2 shrink-0 rounded-full border ${statusClass(status)}`} />
                          <span className="truncate text-[11px] font-medium text-white">{node.label}</span>
                        </span>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] ${statusClass(status)}`}>
                          {STATUS_LABELS[status] ?? status}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-[10px] text-[var(--muted)]">
                        {dependencyLabels.length > 0
                          ? `After: ${dependencyLabels.join(', ')}`
                          : 'Starts immediately'}
                      </div>
                    </button>
                  );
                })}
              </div>
              {selectedStep && (
                <div className="mt-2 rounded-md border border-white/8 bg-black/15 p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-medium text-white">
                        {stepLabel(selectedStep, run.steps.findIndex((step) => step.id === selectedStep.id))}
                      </p>
                      <p className="mt-0.5 truncate text-[10px] text-[var(--muted)]">
                        {stepHealthLabel(selectedStep) ?? STATUS_LABELS[selectedStep.status] ?? selectedStep.status}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] ${statusClass(selectedStep.status)}`}>
                      {STATUS_LABELS[selectedStep.status] ?? selectedStep.status}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px] text-[var(--muted)]">
                    <div className="min-w-0 truncate">
                      Worker: {selectedStep.assigned_worker ?? 'unassigned'}
                    </div>
                    <div className="min-w-0 truncate">
                      Attempts: {selectedStep.attempt_count ?? 0}/{selectedStep.max_attempts ?? 0}
                    </div>
                    <div className="min-w-0 truncate">
                      Lease: {selectedStep.lease_stale ? 'stale' : selectedStep.lease_gen ? `gen ${selectedStep.lease_gen}` : 'none'}
                    </div>
                    <div className="min-w-0 truncate">
                      Checks: {selectedStep.required_checks?.length ?? selectedStep.work_recipe?.required_checks?.length ?? 0}
                    </div>
                  </div>
                  {(blockedByLine(selectedStep, run) || stepRecipeLine(selectedStep) || selectedStep.verification_status || selectedStep.last_error || selectedStep.output_summary) && (
                    <div className="mt-2 space-y-1 text-[10px] leading-4 text-[var(--muted)]">
                      {blockedByLine(selectedStep, run) && (
                        <div className="truncate text-amber-200">
                          Blocked by: {blockedByLine(selectedStep, run)}
                        </div>
                      )}
                      {stepRecipeLine(selectedStep) && (
                        <div className="truncate text-[var(--muted-strong)]">Recipe: {stepRecipeLine(selectedStep)}</div>
                      )}
                      {selectedStep.verification_status && (
                        <div className="truncate">
                          Verify: {selectedStep.verification_status}{selectedStep.verifier_verdict ? ` · ${selectedStep.verifier_verdict}` : ''}
                        </div>
                      )}
                      {(selectedStep.last_error || selectedStep.output_summary) && (
                        <div className="max-h-12 overflow-hidden">
                          {selectedStep.last_error || selectedStep.output_summary}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="mt-3 space-y-2">
            {run.steps.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-xs text-[var(--muted)]">
                Waiting for scheduler steps.
              </div>
            ) : (
              run.steps.map((step, index) => (
                <div
                  key={step.id}
                  className="rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex min-w-0 items-center gap-2 text-xs text-[var(--muted-strong)]">
                      {step.status === 'failed'
                        ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-300" />
                        : <GitBranch className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />}
                      <span className="truncate">{stepLabel(step, index)}</span>
                    </span>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${statusClass(step.status)}`}>
                      {STATUS_LABELS[step.status] ?? step.status}
                    </span>
                  </div>
                  {(stepDetail(step) || stepRecipeLine(step) || (step.files_changed?.length ?? 0) > 0 || step.verification_status) && (
                    <div className="mt-1.5 space-y-1 pl-5 text-[10px] leading-4 text-[var(--muted)]">
                      {stepRecipeLine(step) && (
                        <div className="truncate text-[var(--muted-strong)]">
                          Recipe: {stepRecipeLine(step)}
                        </div>
                      )}
                      {step.verification_status && (
                        <div className="truncate">
                          Verify: {step.verification_status}{step.verifier_verdict ? ` · ${step.verifier_verdict}` : ''}
                        </div>
                      )}
                      {stepDetail(step) && (
                        <div className="max-h-8 overflow-hidden">{stepDetail(step)}</div>
                      )}
                      {(step.files_changed?.length ?? 0) > 0 && (
                        <div className="inline-flex max-w-full items-center gap-1 text-[var(--muted-strong)]">
                          <FileText className="h-3 w-3 shrink-0" />
                          <span className="truncate">{step.files_changed?.slice(0, 3).join(', ')}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/6 pt-3">
            <button
              type="button"
              disabled={isCreatingPr}
              onClick={() => void createPr()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/4 px-2.5 py-1.5 text-xs text-white transition hover:bg-white/8 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCreatingPr ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitPullRequest className="h-3.5 w-3.5" />}
              Create PR
            </button>
            {pullRequest && (
              <a
                href={pullRequest.pr_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1.5 rounded-lg border border-[var(--accent)]/20 bg-[var(--accent)]/10 px-2.5 py-1.5 text-xs text-[var(--accent)] transition hover:bg-[var(--accent)]/15"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{pullRequest.branch}</span>
              </a>
            )}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
            Recent Runs
          </h4>
          <button
            type="button"
            disabled={isLoadingRuns}
            onClick={() => void refreshRuns()}
            className="rounded-md p-1 text-[var(--muted)] transition hover:bg-white/6 hover:text-white active:scale-95 disabled:opacity-50"
            aria-label="Refresh runs"
          >
            <RefreshCcw className={`h-3.5 w-3.5 ${isLoadingRuns ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {runs.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">No runs yet.</p>
        ) : (
          <div className="space-y-1.5">
            {runs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void selectRun(item.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-white/6 active:scale-[0.99] ${
                  item.id === runId ? 'bg-white/8 text-white' : 'text-[var(--muted-strong)]'
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">{item.goal}</span>
                  <span className="mt-0.5 block text-[10px] text-[var(--muted)]">
                    {item.profile} · {formatRunTime(item.created_at)}
                  </span>
                </span>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${statusClass(item.status)}`}>
                  {STATUS_LABELS[item.status] ?? item.status}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
