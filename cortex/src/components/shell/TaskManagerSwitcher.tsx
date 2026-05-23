import { useCallback, useRef, useEffect } from 'react';
import { ChevronRight, Users, User, Pin, LayoutGrid } from 'lucide-react';
import { buildTaskSummary, readTaskManagerState, useTaskManager } from '../../lib/taskManager';
import type { CortexGroup } from '../../lib/groups';

interface TaskManagerSwitcherProps {
  groups: CortexGroup[];
  userId: string;
  activeGroupId: string;
  isOpen: boolean;
  onClose: () => void;
  onSwitchToGroup: (groupId: string) => void;
  onOpenPersonalTaskManager: () => void;
}

function GroupSwitcherItem({
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
    <button
      onClick={onClick}
      className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all ${
        isActive
          ? 'bg-[var(--accent)]/15 border border-[var(--accent)]/25'
          : 'hover:bg-white/[0.06] border border-transparent hover:border-white/8'
      }`}
    >
      {/* Group Indicator */}
      <div className="flex items-center gap-2">
        <div
          className="h-3 w-3 rounded-full border border-white/20"
          style={{ backgroundColor: group.accent }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`text-sm font-medium ${isActive ? 'text-[var(--accent)]' : 'text-white'}`}>
              {group.name}
            </span>
            {group.kind === 'team' && (
              <span className="text-xs text-[var(--muted)]">
                {group.members}
              </span>
            )}
            {isActive && (
              <span className="rounded-full bg-[var(--accent)]/20 px-2 py-0.5 text-[9px] font-medium text-[var(--accent)]">
                Active
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="flex items-center gap-2 text-xs">
        <span className="flex items-center gap-1 text-[var(--muted)]">
          <span className={`font-medium ${summary.inProgress > 0 ? 'text-emerald-300' : 'text-[var(--muted)]'}`}>
            {summary.inProgress}
          </span>
          active
        </span>
        <span className="text-[var(--muted)]">•</span>
        <span className="font-medium text-[var(--muted-strong)]">{summary.open}</span>
        <span className="text-[var(--muted)]">open</span>
      </div>

      <ChevronRight className="h-3.5 w-3.5 text-[var(--muted)] transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

export default function TaskManagerSwitcher({
  groups,
  userId,
  activeGroupId,
  isOpen,
  onClose,
  onSwitchToGroup,
  onOpenPersonalTaskManager,
}: TaskManagerSwitcherProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  // Close on escape
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const handleSwitchToGroup = useCallback((groupId: string) => {
    onSwitchToGroup(groupId);
    onClose();
  }, [onSwitchToGroup, onClose]);

  const handleOpenPersonal = useCallback(() => {
    onOpenPersonalTaskManager();
    onClose();
  }, [onOpenPersonalTaskManager, onClose]);

  if (!isOpen) return null;

  // Calculate total stats across all groups
  const totalStats = groups.reduce((acc, group) => {
    const summary = buildTaskSummary(readTaskManagerState(group, userId));
    return {
      open: acc.open + summary.open,
      inProgress: acc.inProgress + summary.inProgress,
      done: acc.done + summary.done,
    };
  }, { open: 0, inProgress: 0, done: 0 });

  return (
    <div
      ref={dropdownRef}
      className="absolute left-2 top-14 z-50 w-80 rounded-xl border border-white/10 bg-[var(--bg)] shadow-2xl backdrop-blur-md"
    >
      {/* Header */}
      <div className="border-b border-white/6 px-4 py-3">
        <div className="flex items-center gap-2">
          <LayoutGrid className="h-4 w-4 text-[var(--accent)]" />
          <h3 className="font-semibold text-white">Task Manager</h3>
        </div>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Coordination across {groups.length} teams
        </p>
      </div>

      {/* Personal Task Manager */}
      <div className="border-b border-white/6 px-4 py-3">
        <button
          onClick={handleOpenPersonal}
          className="group flex w-full items-center gap-3 rounded-lg border border-dashed border-white/20 px-3 py-3 text-left transition-all hover:border-[var(--accent)]/30 hover:bg-[var(--accent)]/[0.08]"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)]/20 border border-[var(--accent)]/30">
            <User className="h-4 w-4 text-[var(--accent)]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-white">Personal Overview</span>
              <Pin className="h-3 w-3 text-[var(--muted)] opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
            <p className="text-xs text-[var(--muted)]">
              Master view: {totalStats.inProgress} active, {totalStats.open} open
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-[var(--muted)] transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>

      {/* Team Task Managers */}
      <div className="px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <Users className="h-3.5 w-3.5 text-[var(--muted)]" />
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
            Team Coordination
          </span>
        </div>

        <div className="space-y-1">
          {groups.map((group) => (
            <GroupSwitcherItem
              key={group.id}
              group={group}
              userId={userId}
              isActive={group.id === activeGroupId}
              onClick={() => handleSwitchToGroup(group.id)}
            />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-white/6 px-4 py-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-[var(--muted)]">
            {totalStats.inProgress} active across all teams
          </span>
          <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[var(--muted)]">
            Ctrl+P
          </span>
        </div>
      </div>
    </div>
  );
}
