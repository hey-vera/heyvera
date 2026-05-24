import {
  CheckCircle2,
  Circle,
  GripVertical,
  ListTodo,
  MessageSquareText,
  PlayCircle,
  UserPlus,
} from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';
import type { TaskManagerTask, TaskMember, TaskPriority, TaskStatus } from '../../types';
import { formatTaskStatus } from '../../lib/taskManager';

interface TaskBoardProps {
  tasks: TaskManagerTask[];
  members: TaskMember[];
  compact?: boolean;
  onUpdateTask: (
    taskId: string,
    patch: Partial<Pick<TaskManagerTask, 'assigneeId' | 'status' | 'title' | 'repo' | 'priority' | 'projectChatConversationId' | 'projectChatLaunchedAt' | 'latestRunId'>>,
  ) => void;
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

function TaskCard({
  task,
  assignee,
  compact,
  onUpdateTask,
  onLaunchTask,
}: {
  task: TaskManagerTask;
  assignee: TaskMember | null;
  compact?: boolean;
  onUpdateTask: TaskBoardProps['onUpdateTask'];
  onLaunchTask?: TaskBoardProps['onLaunchTask'];
}) {
  function onDragStart(event: DragEvent<HTMLDivElement>) {
    event.dataTransfer.setData('application/cortex-task-id', task.id);
    event.dataTransfer.effectAllowed = 'move';
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="group rounded-lg border border-white/8 bg-[var(--panel)] p-3 shadow-[0_1px_0_rgba(255,255,255,0.02)] transition hover:border-white/14 hover:bg-white/[0.05]"
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
                  onClick={() => onUpdateTask(task.id, { status })}
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
                onClick={() => onLaunchTask?.(task)}
                className="inline-flex h-6 w-8 shrink-0 items-center justify-center rounded-md border border-white/8 bg-white/[0.02] text-[var(--muted)] transition hover:bg-white/[0.06] hover:text-white active:scale-95"
              >
                <MessageSquareText className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {compact && (
            <button
              type="button"
              onClick={() => onLaunchTask?.(task)}
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
  onUpdateTask,
  onLaunchTask,
}: {
  status: TaskStatus;
  tasks: TaskManagerTask[];
  members: TaskMember[];
  compact?: boolean;
  onUpdateTask: TaskBoardProps['onUpdateTask'];
  onLaunchTask?: TaskBoardProps['onLaunchTask'];
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
                onUpdateTask={onUpdateTask}
                onLaunchTask={onLaunchTask}
              />
            ))}
            {virtualWindow.bottom > 0 && <div style={{ height: virtualWindow.bottom }} aria-hidden="true" />}
          </>
        )}
      </div>
    </section>
  );
}

export default function TaskBoard({ tasks, members, compact = false, onUpdateTask, onLaunchTask }: TaskBoardProps) {
  const hasTasks = tasks.length > 0;
  const visibleStatuses = compact ? STATUSES.filter((status) => status !== 'done') : STATUSES;

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
              onUpdateTask={onUpdateTask}
              onLaunchTask={onLaunchTask}
            />
          ))}
        </div>
      )}
    </div>
  );
}
