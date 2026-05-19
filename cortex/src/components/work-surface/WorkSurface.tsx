import {
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  Copy,
  GitCommitHorizontal,
  ListChecks,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import AdminView from '../admin/AdminView';
import LedgerView from '../ledger/LedgerView';
import RunPanel from '../runs/RunPanel';
import UsageView from '../usage/UsageView';
import type { ApprovalRequest, ApprovalState, ChatMessage, RunProfile, WorkEventItem } from '../../types';

interface WorkSurfaceProps {
  messages: ChatMessage[];
  workEvents: WorkEventItem[];
  isStreaming: boolean;
  runProfile: RunProfile;
  runBridgeGoal: string | null;
  runBridgeNonce: number;
  open: boolean;
  onClose: () => void;
  onRunBridgeConsumed: () => void;
  onApprovalAction: (messageId: string, nextState: ApprovalState) => void;
}

const APPROVAL_LABELS: Record<ApprovalState, string> = {
  pending: 'Awaiting review',
  reviewed: 'Reviewed',
  approved: 'Approved',
  rejected: 'Rejected',
};

function collectApprovals(messages: ChatMessage[]): ApprovalRequest[] {
  return messages
    .map((message) => message.approvalRequest)
    .filter((request): request is ApprovalRequest => Boolean(request));
}

function collectEvents(messages: ChatMessage[]): WorkEventItem[] {
  return messages
    .filter((message) => message.role === 'assistant' && message.id !== 'm-init')
    .slice(-8)
    .map((message): WorkEventItem => {
      const failed = message.statusLabel?.toLowerCase().includes('failed')
        || message.statusLabel?.toLowerCase().includes('error');
      const waiting = message.approvalRequest?.state === 'pending'
        || message.statusLabel?.toLowerCase().includes('approval');
      const state: WorkEventItem['state'] = message.isStreaming
        ? 'active'
        : failed
          ? 'failed'
          : waiting
            ? 'waiting'
            : 'done';
      return {
        id: message.id,
        title: message.statusLabel || (message.isStreaming ? 'Working' : 'Response ready'),
        detail: message.content
          ? message.content.split('\n').find((line) => line.trim())?.slice(0, 120) || 'No detail yet.'
          : 'Waiting for Cortex output.',
        timestamp: message.createdAt,
        state,
      };
    })
    .reverse();
}

function formatTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function stateIcon(state: WorkEventItem['state']) {
  if (state === 'active') return <Clock3 className="h-3.5 w-3.5 animate-pulse text-emerald-300" />;
  if (state === 'failed') return <Circle className="h-3.5 w-3.5 fill-red-400 text-red-400" />;
  if (state === 'waiting') return <Circle className="h-3.5 w-3.5 fill-amber-300 text-amber-300" />;
  return <CheckCircle2 className="h-3.5 w-3.5 text-[var(--muted)]" />;
}

function WorkSurfaceContent({
  messages,
  workEvents,
  isStreaming,
  runProfile,
  runBridgeGoal,
  runBridgeNonce,
  onRunBridgeConsumed,
  onApprovalAction,
}: Pick<
  WorkSurfaceProps,
  | 'messages'
  | 'workEvents'
  | 'isStreaming'
  | 'runProfile'
  | 'runBridgeGoal'
  | 'runBridgeNonce'
  | 'onRunBridgeConsumed'
  | 'onApprovalAction'
>) {
  const [copiedEventId, setCopiedEventId] = useState<string | null>(null);
  const approvals = collectApprovals(messages);
  const pendingApprovals = approvals.filter((approval) => approval.state === 'pending');
  const events = workEvents.length > 0 ? workEvents : collectEvents(messages);
  const latestEvent = events[0] ?? null;
  const latestProvider = events.find((event) => event.provider)?.provider ?? 'Not routed yet';
  const latestModel = events.find((event) => event.model)?.model ?? 'Pending';
  const hasWork = events.length > 0 || approvals.length > 0 || isStreaming;

  useEffect(() => {
    if (!copiedEventId) return;
    const timeout = window.setTimeout(() => setCopiedEventId(null), 1400);
    return () => window.clearTimeout(timeout);
  }, [copiedEventId]);

  async function copyEvent(event: WorkEventItem) {
    try {
      await navigator.clipboard.writeText(
        `${formatTime(event.timestamp)} ${event.title}\n${event.detail}`,
      );
      setCopiedEventId(event.id);
    } catch {
      setCopiedEventId(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/6 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Work</h2>
            <p className="text-xs text-[var(--muted)]">
              Live session state, approvals, and review surfaces.
            </p>
          </div>
          <span
            className={`rounded-full border px-2.5 py-1 text-[11px] ${
              isStreaming
                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
                : pendingApprovals.length
                  ? 'border-amber-400/20 bg-amber-400/10 text-amber-200'
                  : 'border-white/8 bg-white/4 text-[var(--muted)]'
            }`}
          >
            {isStreaming ? 'Running' : pendingApprovals.length ? 'Approval' : 'Idle'}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-5">
          <RunPanel
            profile={runProfile}
            bridgeGoal={runBridgeGoal}
            bridgeNonce={runBridgeNonce}
            onBridgeConsumed={onRunBridgeConsumed}
          />
          <UsageView />
          <LedgerView />
          <AdminView />

          {!hasWork ? (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-5 text-center">
              <ListChecks className="h-7 w-7 text-[var(--muted)]" />
              <p className="mt-3 text-sm font-medium text-white">No active chat work yet</p>
              <p className="mt-1 max-w-64 text-xs leading-5 text-[var(--muted)]">
                Ask Cortex to inspect, edit, or review something. Live steps and approvals will appear here.
              </p>
            </div>
          ) : (
            <>
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
                    Timeline
                  </h3>
                  <span className="text-[11px] text-[var(--muted)]">{events.length} events</span>
                </div>
                <div className="space-y-2">
                  {events.map((event) => {
                    const copied = copiedEventId === event.id;
                    return (
                      <div
                        key={event.id}
                        className="group rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5"
                      >
                        <div className="flex items-start gap-2">
                          <div className="mt-0.5">{stateIcon(event.state)}</div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-medium text-white">{event.title}</p>
                              <div className="flex shrink-0 items-center gap-1">
                                <span className="text-[11px] text-[var(--muted)]">
                                  {formatTime(event.timestamp)}
                                </span>
                                <button
                                  type="button"
                                  aria-label="Copy event"
                                  onClick={() => void copyEvent(event)}
                                  className="rounded-md p-1 text-[var(--muted)] opacity-0 transition hover:bg-white/6 hover:text-white active:scale-95 group-hover:opacity-100 group-focus-within:opacity-100"
                                >
                                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                </button>
                              </div>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--muted)]">
                              {event.detail}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
                  Approvals
                </h3>
                {approvals.length === 0 ? (
                  <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-3 text-xs text-[var(--muted)]">
                    Nothing waiting for approval.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {approvals.map((approval) => {
                      const resolved = approval.state === 'approved' || approval.state === 'rejected';
                      return (
                        <div
                          key={`${approval.messageId}-${approval.title}`}
                          className="rounded-xl border border-white/8 bg-black/15 p-3"
                        >
                          <div className="flex items-start gap-2">
                            <GitCommitHorizontal className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-sm font-medium text-white">{approval.title}</p>
                                <span className="shrink-0 rounded-full border border-white/8 bg-white/4 px-2 py-0.5 text-[10px] text-[var(--muted)]">
                                  {APPROVAL_LABELS[approval.state]}
                                </span>
                              </div>
                              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                                {approval.filesChanged} files changed. {approval.diffSummary}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={resolved}
                                  onClick={() => onApprovalAction(approval.messageId, 'reviewed')}
                                  className="rounded-lg border border-white/8 bg-white/4 px-2.5 py-1.5 text-xs text-white transition hover:bg-white/8 active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
                                >
                                  Review
                                </button>
                                <button
                                  type="button"
                                  disabled={resolved}
                                  onClick={() => onApprovalAction(approval.messageId, 'approved')}
                                  className="rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-black transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  disabled={resolved}
                                  onClick={() => onApprovalAction(approval.messageId, 'rejected')}
                                  className="rounded-lg border border-white/8 px-2.5 py-1.5 text-xs text-[var(--muted-strong)] transition hover:bg-white/5 active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
                                >
                                  Reject
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
                  Session Signals
                </h3>
                <div className="grid gap-2">
                  {[
                    { label: 'Provider', value: latestProvider },
                    { label: 'Model', value: latestModel },
                    { label: 'Latest', value: latestEvent?.title ?? 'Idle' },
                  ].map(({ label, value }) => (
                    <div
                      key={label}
                      className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5"
                    >
                      <span className="inline-flex items-center gap-2 text-sm text-[var(--muted-strong)]">
                        <ListChecks className="h-3.5 w-3.5 text-[var(--muted)]" />
                        {label}
                      </span>
                      <span className="max-w-36 truncate text-[11px] text-[var(--muted)]">{value}</span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function WorkSurface({
  messages,
  workEvents,
  isStreaming,
  runProfile,
  runBridgeGoal,
  runBridgeNonce,
  open,
  onClose,
  onRunBridgeConsumed,
  onApprovalAction,
}: WorkSurfaceProps) {
  return (
    <>
      <aside className="hidden h-full w-80 shrink-0 border-l border-white/6 bg-[var(--panel)] xl:block">
        <WorkSurfaceContent
          messages={messages}
          workEvents={workEvents}
          isStreaming={isStreaming}
          runProfile={runProfile}
          runBridgeGoal={runBridgeGoal}
          runBridgeNonce={runBridgeNonce}
          onRunBridgeConsumed={onRunBridgeConsumed}
          onApprovalAction={onApprovalAction}
        />
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button
            type="button"
            aria-label="Close work surface"
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            onClick={onClose}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[88dvh] rounded-t-2xl border border-white/8 bg-[var(--panel)] shadow-2xl sm:inset-y-4 sm:right-4 sm:left-auto sm:w-96 sm:rounded-2xl">
            <button
              type="button"
              aria-label="Close work surface"
              onClick={onClose}
              className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-[var(--muted)] transition hover:bg-white/6 hover:text-white active:scale-95"
            >
              <X className="h-4 w-4" />
            </button>
            <WorkSurfaceContent
              messages={messages}
              workEvents={workEvents}
              isStreaming={isStreaming}
              runProfile={runProfile}
              runBridgeGoal={runBridgeGoal}
              runBridgeNonce={runBridgeNonce}
              onRunBridgeConsumed={onRunBridgeConsumed}
              onApprovalAction={onApprovalAction}
            />
          </div>
        </div>
      )}
    </>
  );
}
