import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, ShieldCheck, X, Users, LayoutGrid } from 'lucide-react';
import { buildTaskSummary, readTaskManagerState, useTaskManager } from '../../lib/taskManager';
import type { CortexGroup } from '../../lib/groups';
import { getPersonalOperationsSummary, type PersonalOperationsGroupSummary, type PersonalOperationsSummary } from '../../lib/cortexApi';

interface PersonalTaskManagerProps {
  groups: CortexGroup[];
  userId: string;
  activeGroupId: string;
  onClose: () => void;
  onSwitchToGroup: (groupId: string) => void;
}

type OverviewTab = 'overview' | 'groups';

function localPersonalSummary(groups: CortexGroup[], userId: string) {
  return groups.reduce((acc, group) => {
    const summary = buildTaskSummary(readTaskManagerState(group, userId));
    return {
      open: acc.open + summary.open,
      inProgress: acc.inProgress + summary.inProgress,
      done: acc.done + summary.done,
    };
  }, { open: 0, inProgress: 0, done: 0 });
}

function usePersonalOperationsSummary() {
  const [summary, setSummary] = useState<PersonalOperationsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getPersonalOperationsSummary();
      setSummary(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operations summary unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 20_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return { summary, loading, error, refresh };
}

function GroupOverview({
  group,
  userId,
  operations,
  isActive,
  onClick
}: {
  group: CortexGroup;
  userId: string;
  operations?: PersonalOperationsGroupSummary;
  isActive: boolean;
  onClick: () => void;
}) {
  const taskManager = useTaskManager(group, userId);
  const localSummary = taskManager.summary;
  const open = operations?.tasks.open ?? localSummary.open;
  const active = operations?.tasks.active ?? localSummary.inProgress;
  const done = operations?.tasks.completion.gated_done ?? operations?.tasks.done_raw ?? localSummary.done;
  const needsAttention = (operations?.attention.length ?? 0) + (operations?.approvals.pending ?? 0);
  const activeLeases = operations?.resource_leases.active ?? 0;

  return (
    <div
      className={`rounded-xl border p-4 transition-all cursor-pointer ${
        isActive
          ? 'border-[var(--accent)]/40 bg-[var(--accent)]/10'
          : 'border-white/8 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/12'
      }`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: group.accent }}
            />
            <h3 className="font-medium text-white">{group.name}</h3>
            {group.kind === 'team' && (
              <span className="text-xs text-[var(--muted)]">
                {group.members} members
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {group.description}
          </p>
        </div>
        {isActive && (
          <div className="rounded-full bg-[var(--accent)]/20 px-2 py-1 text-[10px] font-medium text-[var(--accent)]">
            Active
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-center">
          <div className="text-lg font-semibold text-white">{open}</div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Open</div>
        </div>
        <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-center">
          <div className="text-lg font-semibold text-emerald-300">{active}</div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Active</div>
        </div>
        <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-center">
          <div className="text-lg font-semibold text-blue-300">{done}</div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Done</div>
        </div>
      </div>

      {operations && (needsAttention > 0 || activeLeases > 0 || operations.steps.failed > 0) && (
        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          {needsAttention > 0 && (
            <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-amber-200">
              {needsAttention} need attention
            </span>
          )}
          {activeLeases > 0 && (
            <span className="rounded-full border border-sky-300/20 bg-sky-300/10 px-2 py-1 text-sky-200">
              {activeLeases} active leases
            </span>
          )}
          {operations.steps.failed > 0 && (
            <span className="rounded-full border border-rose-300/20 bg-rose-300/10 px-2 py-1 text-rose-200">
              {operations.steps.failed} failed steps
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function MasterOverview({
  groups,
  userId,
  operations,
  loading,
  error,
  activeGroupId,
  onSwitchToGroup
}: {
  groups: CortexGroup[];
  userId: string;
  operations: PersonalOperationsSummary | null;
  loading: boolean;
  error: string | null;
  activeGroupId: string;
  onSwitchToGroup: (groupId: string) => void;
}) {
  const fallbackStats = useMemo(() => localPersonalSummary(groups, userId), [groups, userId]);
  const groupOperations = useMemo(() => {
    const byId = new Map<string, PersonalOperationsGroupSummary>();
    operations?.groups.forEach((group) => byId.set(group.group_id, group));
    return byId;
  }, [operations]);
  const open = operations?.tasks.open ?? fallbackStats.open;
  const active = operations?.tasks.active ?? fallbackStats.inProgress;
  const done = operations?.tasks.completion.gated_done ?? operations?.tasks.done_raw ?? fallbackStats.done;
  const attention = (operations?.attention.length ?? 0) + (operations?.approvals.pending ?? 0);
  const activeLeases = operations?.resource_leases.active ?? 0;
  const failedSteps = operations?.steps.failed ?? 0;

  return (
    <div className="space-y-6">
      {/* Master Stats */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Master Overview</h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {operations
                ? `Operations refreshed ${new Date(operations.generated_at).toLocaleTimeString()}`
                : 'Live operations are loading'}
            </p>
          </div>
          {loading ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-xs text-[var(--muted)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Syncing
            </div>
          ) : error ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs text-amber-200">
              <AlertTriangle className="h-3.5 w-3.5" />
              Local view
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs text-emerald-200">
              <ShieldCheck className="h-3.5 w-3.5" />
              Live source
            </div>
          )}
        </div>
        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-center">
            <div className="text-2xl font-bold text-white">{operations?.groups_total ?? groups.length}</div>
            <div className="text-xs text-[var(--muted)]">Scopes</div>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-center">
            <div className="text-2xl font-bold text-white">{open}</div>
            <div className="text-xs text-[var(--muted)]">Open</div>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-center">
            <div className="text-2xl font-bold text-emerald-300">{active}</div>
            <div className="text-xs text-[var(--muted)]">Active</div>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-center">
            <div className="text-2xl font-bold text-blue-300">{done}</div>
            <div className="text-xs text-[var(--muted)]">Completed</div>
          </div>
        </div>
        {operations && (
          <div className="mt-3 grid gap-2 md:grid-cols-4">
            <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
              <div className="text-xs text-[var(--muted)]">Needs attention</div>
              <div className="mt-1 text-lg font-semibold text-amber-200">{attention}</div>
            </div>
            <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
              <div className="text-xs text-[var(--muted)]">Active leases</div>
              <div className="mt-1 text-lg font-semibold text-sky-200">{activeLeases}</div>
            </div>
            <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
              <div className="text-xs text-[var(--muted)]">Failed steps</div>
              <div className="mt-1 text-lg font-semibold text-rose-200">{failedSteps}</div>
            </div>
            <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
              <div className="text-xs text-[var(--muted)]">Without runs</div>
              <div className="mt-1 text-lg font-semibold text-white">{operations.tasks.without_run}</div>
            </div>
          </div>
        )}
      </div>

      {/* Group Overviews */}
      <div>
        <h3 className="mb-3 text-sm font-medium text-white">Team Coordination</h3>
        <div className="grid gap-3 lg:grid-cols-2">
          {groups.map((group) => (
            <GroupOverview
              key={group.id}
              group={group}
              userId={userId}
              operations={groupOperations.get(group.id)}
              isActive={group.id === activeGroupId}
              onClick={() => onSwitchToGroup(group.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function PersonalTaskManager({
  groups,
  userId,
  activeGroupId,
  onClose,
  onSwitchToGroup,
}: PersonalTaskManagerProps) {
  const [activeTab, setActiveTab] = useState<OverviewTab>('overview');
  const { summary, loading, error } = usePersonalOperationsSummary();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="relative h-[90vh] w-full max-w-6xl rounded-2xl border border-white/10 bg-[var(--bg)] shadow-2xl">
        {/* Header */}
        <div className="border-b border-white/6 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-white">Personal Task Manager</h1>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Master overview of all your team coordination and work
              </p>
            </div>
            <button
              onClick={onClose}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-white/6 hover:text-white active:scale-95"
              aria-label="Close Personal Task Manager"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Tabs */}
          <div className="mt-4 flex gap-1 rounded-lg border border-white/8 bg-white/[0.03] p-1">
            <button
              onClick={() => setActiveTab('overview')}
              className={[
                'inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition',
                activeTab === 'overview'
                  ? 'bg-white/10 text-white'
                  : 'text-[var(--muted)] hover:text-white',
              ].join(' ')}
            >
              <LayoutGrid className="h-4 w-4" />
              Overview
            </button>
            <button
              onClick={() => setActiveTab('groups')}
              className={[
                'inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition',
                activeTab === 'groups'
                  ? 'bg-white/10 text-white'
                  : 'text-[var(--muted)] hover:text-white',
              ].join(' ')}
            >
              <Users className="h-4 w-4" />
              All Teams
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="h-[calc(90vh-120px)] overflow-y-auto px-6 py-6">
          {activeTab === 'overview' ? (
            <MasterOverview
              groups={groups}
              userId={userId}
              operations={summary}
              loading={loading}
              error={error}
              activeGroupId={activeGroupId}
              onSwitchToGroup={onSwitchToGroup}
            />
          ) : (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-white">All Teams</h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {groups.map((group) => (
                  <GroupOverview
                    key={group.id}
                    group={group}
                    userId={userId}
                    operations={summary?.groups.find((item) => item.group_id === group.id)}
                    isActive={group.id === activeGroupId}
                    onClick={() => onSwitchToGroup(group.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
