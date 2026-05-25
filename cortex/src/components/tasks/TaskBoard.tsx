import {
  CheckCircle2,
  Circle,
  GripVertical,
  ListTodo,
  MessageSquareText,
  PlayCircle,
  UserPlus,
} from 'lucide-react';
import { useEffect, useMemo, useState, type DragEvent } from 'react';
import type { TaskManagerTask, TaskMember, TaskPriority, TaskStatus } from '../../types';
import { getTaskProjection, type TaskProjection } from '../../lib/cortexApi';
import { formatTaskStatus } from '../../lib/taskManager';

interface TaskBoardProps {
  tasks: TaskManagerTask[];
  members: TaskMember[];
  compact?: boolean;
  showBackendSignals?: boolean;
  selectedTaskId?: string | null;
  onUpdateTask: (
    taskId: string,
    patch: Partial<Pick<TaskManagerTask, 'assigneeId' | 'status' | 'title' | 'repo' | 'priority' | 'projectChatConversationId' | 'projectChatLaunchedAt' | 'latestRunId' | 'latestRunStatus' | 'latestRunSyncedAt' | 'latestRunStepSummary'>>,
  ) => void;
  onSelectTask?: (task: TaskManagerTask) => void;
  onLaunchTask?: (task: TaskManagerTask) => void;
}

const STATUSES: TaskStatus[] = ['created', 'assigned', 'in-progress', 'done'];

const STATUS_ICON: Record<TaskStatus, typeof Circle> = {
  created: Circle,
  assigned: UserPlus,
  'in-progress': PlayCircle,
  done: CheckCircle2,
};

const PRIORITY_STYLE: Record<TaskPriority, string> = {
  normal: 'border-white/8 bg-white/[0.03] text-[var(--muted)]',
  high: 'border-amber-300/20 bg-amber-300/10 text-amber-100',
  urgent: 'border-red-300/25 bg-red-400/10 text-red-100',
};

interface TaskBackendSignal {
  runCount: number;
  chatCount: number;
  eventCount: number;
  latestRunId?: string | null;
  latestRunStatus?: string | null;
  latestEventAt?: number | null;
  tone: 'quiet' | 'attached' | 'active' | 'stale' | 'failed';
}

function formatAge(timestamp: string) {
  const ageMs = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.max(Math.floor(ageMs / 60000), 0);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function getMember(members: TaskMember[], memberId?: string | null) {
  if (!memberId) return null;
  return members.find((member) => member.id === memberId) ?? null;
}

function formatRunStatus(status?: string | null) {
  return status ? status.replaceAll('_', ' ') : 'run linked';
}

function statusTone(status?: string | null): TaskBackendSignal['tone'] {
  if (!status) return 'attached';
  if (status === 'failed' || status === 'orphaned' || status === 'cancelled') return 'failed';
  if (status === 'pending' || status === 'ready' || status === 'leased' || status === 'running') return 'active';
  return 'attached';
}

function backendSignalFromProjection(projection: TaskProjection): TaskBackendSignal {
  const latestRun = projection.runs[0] ?? null;
  const latestEvent = projection.events[0] ?? null;
  let tone = statusTone(latestRun?.status);
  const latestEventAt = latestEvent?.created_at ?? null;
  const quietMs = latestEventAt ? Date.now() - latestEventAt : null;
  if (tone === 'active' && quietMs !== null && quietMs > 5 * 60 * 1000) {
    tone = 'stale';
  }
  if (projection.runs.length === 0 && projection.chats.length === 0) {
    tone = 'quiet';
  }
  return {
    runCount: projection.runs.length,
    chatCount: projection.chats.length,
    eventCount: projection.events.length,
    latestRunId: projection.task.latest_run_id ?? latestRun?.id ?? null,
    latestRunStatus: latestRun?.status ?? null,
    latestEventAt,
    tone,
  };
}

function backendSignalLabel(signal: TaskBackendSignal) {
  if (signal.tone === 'failed') return 'Needs attention';
  if (signal.tone === 'stale') return 'Stale';
  if (signal.tone === 'active') return formatRunStatus(signal.latestRunStatus);
  if (signal.tone === 'attached') return 'Attached';
  return 'No backend work';
}

function backendSignalStyle(tone: TaskBackendSignal['tone']) {
  if (tone === 'failed') return 'border-red-300/20 bg-red-400/10 text-red-100';
  if (tone === 'stale') return 'border-amber-300/20 bg-amber-300/10 text-amber-100';
  if (tone === 'active') return 'border-emerald-300/20 bg-emerald-400/10 text-emerald-100';
  if (tone === 'attached') return 'border-sky-300/20 bg-sky-400/10 text-sky-100';
  return 'border-white/8 bg-white/[0.03] text-[var(--muted)]';
}

function getRunSnapshotAge(timestamp?: string | null) {
  if (!timestamp) return null;
  const ageMs = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.max(Math.floor(ageMs / 60000), 0);
  return {
    label: minutes < 1 ? 'fresh' : `${formatAge(timestamp)} ago`,
    stale: minutes >= 5,
  };
}

function TaskCard({
  task,
  assignee,
  compact,
  selected,
  onUpdateTask,
  onSelectTask,
  onLaunchTask,
  backendSignal,
}: {
  task: TaskManagerTask;
  assignee: TaskMember | null;
  compact?: boolean;
  selected?: boolean;
  onUpdateTask: TaskBoardProps['onUpdateTask'];
  onSelectTask?: TaskBoardProps['onSelectTask'];
  onLaunchTask?: TaskBoardProps['onLaunchTask'];
  backendSignal?: TaskBackendSignal | null;
}) {
  const runSnapshotAge = getRunSnapshotAge(task.latestRunSyncedAt);

  function onDragStart(event: DragEvent<HTMLDivElement>) {
    event.dataTransfer.setData('application/cortex-task-id', task.id);
    event.dataTransfer.effectAllowed = 'move';
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={() => onSelectTask?.(task)}
      role={onSelectTask ? 'button' : undefined}
      tabIndex={onSelectTask ? 0 : undefined}
      onKeyDown={(event) => {
        if (!onSelectTask) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelectTask(task);
        }
      }}
      className={[
        'group rounded-lg border bg-[var(--panel)] p-3 text-left shadow-[0_1px_0_rgba(255,255,255,0.02)] transition hover:border-white/14 hover:bg-white/[0.05]',
        selected ? 'border-[var(--accent)]/40 bg-[var(--accent)]/10' : 'border-white/8',
        onSelectTask ? 'cursor-pointer' : '',
      ].join(' ')}
    >
      <div className="flex items-start gap-2">
        <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted)] opacity-60" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 text-sm font-medium leading-5 text-white">{task.title}</p>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${PRIORITY_STYLE[task.priority]}`}>
              {task.priority}
            </span>
          </div>
          {task.repo && (
            <p className="mt-1 truncate text-[11px] text-[var(--muted)]">{task.repo}</p>
          )}
          {task.projectChatLaunchedAt && (
            <p className="mt-1 truncate text-[11px] text-[var(--accent)]">Attached to Project Chat</p>
          )}
          {task.latestRunId && (
            <p className="mt-1 truncate text-[11px] text-[var(--muted-strong)]">
              Run: {formatRunStatus(task.latestRunStatus)}
              {task.latestRunStepSummary ? ` · ${task.latestRunStepSummary.done}/${task.latestRunStepSummary.total} done` : ''}
              {runSnapshotAge ? ` · ${runSnapshotAge.label}` : ''}
            </p>
          )}
          {runSnapshotAge?.stale && (
            <p className="mt-1 truncate text-[10px] text-amber-200">Select to refresh backend signal</p>
          )}
          {backendSignal && (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-white/8 bg-black/10 px-2 py-1.5">
              <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] capitalize ${backendSignalStyle(backendSignal.tone)}`}>
                {backendSignalLabel(backendSignal)}
              </span>
              <span className="min-w-0 truncate text-[10px] text-[var(--muted)]">
                {backendSignal.runCount} run{backendSignal.runCount === 1 ? '' : 's'}
                {' · '}
                {backendSignal.chatCount} chat{backendSignal.chatCount === 1 ? '' : 's'}
                {' · '}
                {backendSignal.eventCount} event{backendSignal.eventCount === 1 ? '' : 's'}
              </span>
            </div>
          )}
          <div className="mt-3 flex items-center justify-between gap-2">
            {assignee ? (
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-black"
                  style={{ backgroundColor: assignee.color }}
                >
                  {assignee.initials}
                </span>
                <span className="truncate text-xs text-[var(--muted-strong)]">{assignee.name}</span>
              </div>
            ) : (
              <span className="text-xs text-[var(--muted)]">Unassigned</span>
            )}
            <span className="shrink-0 text-[11px] text-[var(--muted)]">{formatAge(task.updatedAt)}</span>
          </div>
          {!compact && (
            <div className="mt-3 flex items-center gap-1.5">
              {STATUSES.map((status) => (
                <button
                  key={status}
                  type="button"
                  title={formatTaskStatus(status)}
                  aria-label={`Move to ${formatTaskStatus(status)}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onUpdateTask(task.id, { status });
                  }}
                  className={[
                    'h-6 flex-1 rounded-md border text-[10px] transition active:scale-95',
                    task.status === status
                      ? 'border-[var(--accent)]/40 bg-[var(--accent)]/20 text-white'
                      : 'border-white/8 bg-white/[0.02] text-[var(--muted)] hover:bg-white/[0.06] hover:text-white',
                  ].join(' ')}
                >
                  {status === 'in-progress' ? 'Active' : formatTaskStatus(status)}
                </button>
              ))}
              <button
                type="button"
                title="Open in Project Chat"
                aria-label="Open task in Project Chat"
                onClick={(event) => {
                  event.stopPropagation();
                  onLaunchTask?.(task);
                }}
                className="inline-flex h-6 w-8 shrink-0 items-center justify-center rounded-md border border-white/8 bg-white/[0.02] text-[var(--muted)] transition hover:bg-white/[0.06] hover:text-white active:scale-95"
              >
                <MessageSquareText className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {compact && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onLaunchTask?.(task);
              }}
              className="mt-3 inline-flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-white/8 bg-white/[0.03] text-[11px] text-[var(--muted-strong)] transition hover:bg-white/[0.07] hover:text-white active:scale-[0.99]"
            >
              <MessageSquareText className="h-3.5 w-3.5" />
              Open in Project Chat
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function DropColumn({
  status,
  tasks,
  members,
  compact,
  selectedTaskId,
  onUpdateTask,
  onSelectTask,
  onLaunchTask,
  backendSignals,
}: {
  status: TaskStatus;
  tasks: TaskManagerTask[];
  members: TaskMember[];
  compact?: boolean;
  selectedTaskId?: string | null;
  onUpdateTask: TaskBoardProps['onUpdateTask'];
  onSelectTask?: TaskBoardProps['onSelectTask'];
  onLaunchTask?: TaskBoardProps['onLaunchTask'];
  backendSignals?: Record<string, TaskBackendSignal>;
}) {
  const Icon = STATUS_ICON[status];
  const [scrollTop, setScrollTop] = useState(0);
  const shouldVirtualize = tasks.length > 60;
  const estimatedRowHeight = compact ? 122 : 154;
  const virtualWindow = useMemo(() => {
    if (!shouldVirtualize) {
      return {
        items: tasks,
        top: 0,
        bottom: 0,
      };
    }
    const start = Math.max(0, Math.floor(scrollTop / estimatedRowHeight) - 6);
    const visibleCount = 18;
    const end = Math.min(tasks.length, start + visibleCount);
    return {
      items: tasks.slice(start, end),
      top: start * estimatedRowHeight,
      bottom: Math.max(0, (tasks.length - end) * estimatedRowHeight),
    };
  }, [estimatedRowHeight, scrollTop, shouldVirtualize, tasks]);

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('application/cortex-task-id');
    if (taskId) onUpdateTask(taskId, { status });
  }

  return (
    <section
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      className="flex min-h-44 flex-col rounded-lg border border-white/8 bg-white/[0.025]"
    >
      <div className="flex h-10 items-center justify-between border-b border-white/6 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 text-[var(--muted)]" />
          <h3 className="truncate text-xs font-semibold uppercase text-[var(--muted-strong)]">
            {formatTaskStatus(status)}
          </h3>
        </div>
        <span className="rounded-full bg-white/6 px-2 py-0.5 text-[11px] text-[var(--muted)]">
          {tasks.length}
        </span>
      </div>
      <div
        className="flex flex-1 flex-col gap-2 overflow-y-auto p-2"
        onScroll={(event) => {
          if (shouldVirtualize) setScrollTop(event.currentTarget.scrollTop);
        }}
      >
        {tasks.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-white/8 px-3 py-6 text-center text-xs leading-5 text-[var(--muted)]">
            Drop tasks here
          </div>
        ) : (
          <>
            {virtualWindow.top > 0 && <div style={{ height: virtualWindow.top }} aria-hidden="true" />}
            {virtualWindow.items.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                assignee={getMember(members, task.assigneeId)}
                compact={compact}
                selected={task.id === selectedTaskId}
                onUpdateTask={onUpdateTask}
                onSelectTask={onSelectTask}
                onLaunchTask={onLaunchTask}
                backendSignal={backendSignals?.[task.id] ?? null}
              />
            ))}
            {virtualWindow.bottom > 0 && <div style={{ height: virtualWindow.bottom }} aria-hidden="true" />}
          </>
        )}
      </div>
    </section>
  );
}

export default function TaskBoard({
  tasks,
  members,
  compact = false,
  showBackendSignals = false,
  selectedTaskId,
  onUpdateTask,
  onSelectTask,
  onLaunchTask,
}: TaskBoardProps) {
  const hasTasks = tasks.length > 0;
  const visibleStatuses = compact ? STATUSES.filter((status) => status !== 'done') : STATUSES;
  const [backendSignals, setBackendSignals] = useState<Record<string, TaskBackendSignal>>({});
  const projectionTaskKeys = useMemo(() => {
    if (!showBackendSignals) return [];
    const selected = selectedTaskId ? tasks.find((task) => task.id === selectedTaskId) : null;
    const candidates = tasks
      .filter((task) => task.status !== 'done')
      .slice(0, 12);
    const byId = new Map<string, TaskManagerTask>();
    for (const task of candidates) byId.set(task.id, task);
    if (selected) byId.set(selected.id, selected);
    return Array.from(byId.values()).map((task) => `${task.groupId}:${task.id}`);
  }, [selectedTaskId, showBackendSignals, tasks]);

  useEffect(() => {
    if (!showBackendSignals || projectionTaskKeys.length === 0) {
      setBackendSignals({});
      return undefined;
    }
    let cancelled = false;
    const loadSignals = async () => {
      const nextSignals: Record<string, TaskBackendSignal> = {};
      await Promise.all(projectionTaskKeys.map(async (key) => {
        const separatorIndex = key.indexOf(':');
        const groupId = key.slice(0, separatorIndex);
        const taskId = key.slice(separatorIndex + 1);
        try {
          const projection = await getTaskProjection(groupId, taskId);
          nextSignals[taskId] = backendSignalFromProjection(projection);
        } catch {
          // Projection gaps stay quiet on the map; the inspector shows the detailed error.
        }
      }));
      if (!cancelled) setBackendSignals(nextSignals);
    };

    void loadSignals();
    const interval = window.setInterval(() => {
      void loadSignals();
    }, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [projectionTaskKeys, showBackendSignals]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!hasTasks ? (
        <div className="flex min-h-64 flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-white/10 bg-white/[0.02] px-5 text-center">
          <ListTodo className="h-8 w-8 text-[var(--muted)]" />
          <p className="mt-3 text-sm font-medium text-white">No coordinated tasks yet</p>
          <p className="mt-1 max-w-72 text-xs leading-5 text-[var(--muted)]">
            Ask Cortex to assign work or create a task from the form.
          </p>
        </div>
      ) : (
        <div className={compact ? 'grid gap-3' : 'grid min-h-0 flex-1 gap-3 xl:grid-cols-4'}>
          {visibleStatuses.map((status) => (
            <DropColumn
              key={status}
              status={status}
              tasks={tasks.filter((task) => task.status === status)}
              members={members}
              compact={compact}
              selectedTaskId={selectedTaskId}
              onUpdateTask={onUpdateTask}
              onSelectTask={onSelectTask}
              onLaunchTask={onLaunchTask}
              backendSignals={backendSignals}
            />
          ))}
        </div>
      )}
    </div>
  );
}
