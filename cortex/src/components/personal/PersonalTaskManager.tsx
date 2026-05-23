import { useState } from 'react';
import { X, Users, LayoutGrid } from 'lucide-react';
import { buildTaskSummary, readTaskManagerState, useTaskManager } from '../../lib/taskManager';
import type { CortexGroup } from '../../lib/groups';

interface PersonalTaskManagerProps {
  groups: CortexGroup[];
  userId: string;
  activeGroupId: string;
  onClose: () => void;
  onSwitchToGroup: (groupId: string) => void;
}

type OverviewTab = 'overview' | 'groups';

function GroupOverview({
  group,
  userId,
  isActive,
  onClick
}: {
  group: CortexGroup;
  userId: string;
  isActive: boolean;
  onClick: () => void;
}) {
  const taskManager = useTaskManager(group, userId);
  const { summary } = taskManager;

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
          <div className="text-lg font-semibold text-white">{summary.open}</div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Open</div>
        </div>
        <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-center">
          <div className="text-lg font-semibold text-emerald-300">{summary.inProgress}</div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Active</div>
        </div>
        <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-center">
          <div className="text-lg font-semibold text-blue-300">{summary.done}</div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Done</div>
        </div>
      </div>
    </div>
  );
}

function MasterOverview({
  groups,
  userId,
  activeGroupId,
  onSwitchToGroup
}: {
  groups: CortexGroup[];
  userId: string;
  activeGroupId: string;
  onSwitchToGroup: (groupId: string) => void;
}) {
  const totalStats = groups.reduce((acc, group) => {
    const summary = buildTaskSummary(readTaskManagerState(group, userId));
    return {
      open: acc.open + summary.open,
      inProgress: acc.inProgress + summary.inProgress,
      done: acc.done + summary.done,
    };
  }, { open: 0, inProgress: 0, done: 0 });

  return (
    <div className="space-y-6">
      {/* Master Stats */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-white">Master Overview</h2>
        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-center">
            <div className="text-2xl font-bold text-white">{groups.length}</div>
            <div className="text-xs text-[var(--muted)]">Teams</div>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-center">
            <div className="text-2xl font-bold text-white">{totalStats.open}</div>
            <div className="text-xs text-[var(--muted)]">Open</div>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-center">
            <div className="text-2xl font-bold text-emerald-300">{totalStats.inProgress}</div>
            <div className="text-xs text-[var(--muted)]">Active</div>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-center">
            <div className="text-2xl font-bold text-blue-300">{totalStats.done}</div>
            <div className="text-xs text-[var(--muted)]">Completed</div>
          </div>
        </div>
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
