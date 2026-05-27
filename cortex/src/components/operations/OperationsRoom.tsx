import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  GitBranch,
  Loader2,
  RefreshCw,
  Shield,
  XCircle,
} from 'lucide-react';
import OperationsGraphPanel from '../tasks/OperationsGraphPanel';
import {
  getGroupOperationsSummary,
  type GroupOperationsSummary,
} from '../../lib/cortexApi';

const GROUP_LABELS: Record<string, string> = {
  personal: 'Personal',
  heyvera: 'HeyVera',
  cortex: 'Cortex',
};

function groupLabel(groupId: string) {
  return GROUP_LABELS[groupId] ?? groupId;
}

function SummaryCard({ label, value, detail, tone }: { label: string; value: number; detail?: string; tone?: 'normal' | 'warning' | 'danger' }) {
  const border = tone === 'danger' ? 'border-red-300/20' : tone === 'warning' ? 'border-amber-300/20' : 'border-white/8';
  const bg = tone === 'danger' ? 'bg-red-400/[0.06]' : tone === 'warning' ? 'bg-amber-300/[0.06]' : 'bg-white/[0.03]';
  return (
    <div className={`rounded-lg border ${border} ${bg} px-4 py-3`}>
      <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
      {detail && <p className="mt-0.5 text-[11px] text-[var(--muted)]">{detail}</p>}
    </div>
  );
}

function EventTimeline({ events }: { events: GroupOperationsSummary['recent_events'] }) {
  if (events.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-white/8 bg-black/15 text-sm text-[var(--muted)]">
        No recent events
      </div>
    );
  }
  return (
    <div className="max-h-[400px] space-y-1.5 overflow-y-auto rounded-lg border border-white/8 bg-black/15 p-3">
      {events.slice(0, 30).map((event) => (
        <div key={event.id} className="flex items-start gap-3 rounded-md border border-white/6 bg-white/[0.02] px-3 py-2">
          <div className="mt-0.5 shrink-0">
            {event.event_type.includes('failed') ? (
              <XCircle className="h-3.5 w-3.5 text-red-300" />
            ) : event.event_type.includes('completed') || event.event_type.includes('verified') ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
            ) : event.event_type.includes('approval') ? (
              <Shield className="h-3.5 w-3.5 text-sky-300" />
            ) : (
              <GitBranch className="h-3.5 w-3.5 text-[var(--muted)]" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-white">{event.event_type.replaceAll('.', ' ').replaceAll('_', ' ')}</p>
            <p className="mt-0.5 truncate text-[10px] text-[var(--muted)]">
              {event.entity_type} {event.entity_id ? `· ${event.entity_id.slice(0, 8)}` : ''}
            </p>
          </div>
          <span className="shrink-0 text-[10px] text-[var(--muted)]">
            {new Date(event.created_at).toLocaleTimeString()}
          </span>
        </div>
      ))}
    </div>
  );
}

function AttentionList({ items }: { items: GroupOperationsSummary['attention'] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-2 rounded-md border border-amber-300/15 bg-amber-300/[0.06] px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-200" />
          <span className="min-w-0 truncate text-xs text-amber-100">
            {item.kind.replaceAll('_', ' ')} {item.status ? `(${item.status})` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function OperationsRoom() {
  const { groupId = 'personal' } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<GroupOperationsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getGroupOperationsSummary(groupId);
      setSummary(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operations data unavailable');
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    setLoading(true);
    refresh();
    const interval = window.setInterval(refresh, 15_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const attentionItems = useMemo(() => summary?.attention ?? [], [summary]);
  const failedCount = (summary?.runs.failed ?? 0) + (summary?.steps.failed ?? 0);
  const activeCount = (summary?.tasks.active ?? 0) + (summary?.runs.active ?? 0);

  return (
    <div className="flex h-screen flex-col bg-[var(--bg)] text-white">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/8 px-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate(`/app/groups/${groupId}/tasks`)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/8 bg-white/[0.03] text-[var(--muted)] transition hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-sm font-semibold text-white">{groupLabel(groupId)} Operations Room</h1>
            <p className="text-[11px] text-[var(--muted)]">
              {loading ? 'Loading...' : summary
                ? `${summary.tasks.open + summary.tasks.active} open tasks · ${summary.runs.active} active runs · refreshed ${new Date().toLocaleTimeString()}`
                : 'Waiting for data'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/8 bg-white/[0.03] text-[var(--muted)] transition hover:text-white"
          aria-label="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {error && (
        <div className="mx-6 mt-4 flex items-center gap-2 rounded-lg border border-amber-300/20 bg-amber-300/10 px-4 py-2.5 text-xs text-amber-100">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading && !summary ? (
          <div className="flex h-64 items-center justify-center text-[var(--muted)]">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading operations data
          </div>
        ) : (
          <div className="space-y-6">
            {summary && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <SummaryCard label="Open Tasks" value={summary.tasks.open} detail={`${summary.tasks.active} active`} />
                <SummaryCard label="Active Runs" value={summary.runs.active} detail={`${summary.runs.total} total`} />
                <SummaryCard
                  label="Completion"
                  value={summary.tasks.completion.gated_done ?? summary.tasks.done_raw}
                  detail={summary.tasks.completion.gated_done_available
                    ? `${summary.tasks.completion.done_without_evidence ?? 0} need evidence`
                    : `${summary.tasks.done_raw} raw done`}
                />
                <SummaryCard
                  label="Attention"
                  value={attentionItems.length}
                  tone={attentionItems.length > 0 ? 'warning' : 'normal'}
                  detail={`${summary.approvals?.pending ?? 0} pending approvals`}
                />
                <SummaryCard
                  label="Failures"
                  value={failedCount}
                  tone={failedCount > 0 ? 'danger' : 'normal'}
                  detail={`${summary.runs.failed} runs · ${summary.steps.failed} steps`}
                />
              </div>
            )}

            <div>
              <h2 className="mb-3 text-sm font-semibold text-white">Live Map</h2>
              <OperationsGraphPanel
                groupId={groupId}
                groupName={groupLabel(groupId)}
                focusedTaskId={focusedTaskId}
                onFocusTask={setFocusedTaskId}
              />
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div>
                <h2 className="mb-3 text-sm font-semibold text-white">Event Timeline</h2>
                <EventTimeline events={summary?.recent_events ?? []} />
              </div>
              <div>
                <h2 className="mb-3 text-sm font-semibold text-white">
                  Attention ({attentionItems.length})
                </h2>
                {attentionItems.length > 0 ? (
                  <AttentionList items={attentionItems} />
                ) : (
                  <div className="flex h-32 items-center justify-center rounded-lg border border-white/8 bg-black/15 text-sm text-[var(--muted)]">
                    No items need attention
                  </div>
                )}

                {summary && (summary.resource_leases?.active ?? 0) > 0 && (
                  <div className="mt-4">
                    <h3 className="mb-2 text-xs font-semibold uppercase text-[var(--muted)]">Resource Leases</h3>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-md border border-white/8 bg-black/10 px-3 py-2 text-center">
                        <p className="text-lg font-semibold text-white">{summary.resource_leases?.by_type.path ?? 0}</p>
                        <p className="text-[9px] uppercase text-[var(--muted)]">Path Locks</p>
                      </div>
                      <div className="rounded-md border border-white/8 bg-black/10 px-3 py-2 text-center">
                        <p className="text-lg font-semibold text-white">{summary.resource_leases?.by_type.task ?? 0}</p>
                        <p className="text-[9px] uppercase text-[var(--muted)]">Task Locks</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
