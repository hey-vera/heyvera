import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Clock3,
  GitBranch,
  Loader2,
  MessageSquareText,
  PlayCircle,
  ShieldCheck,
  UserCircle2,
} from 'lucide-react';
import type { TaskActivity, TaskManagerTask, TaskMember, TaskStatus } from '../../types';
import { formatTaskStatus } from '../../lib/taskManager';

interface TaskInspectorProps {
  task: TaskManagerTask | null;
  members: TaskMember[];
  activity: TaskActivity[];
  isCreatingRun?: boolean;
  runError?: string | null;
  onCreateRun?: (task: TaskManagerTask) => void;
  onLaunchTask?: (task: TaskManagerTask) => void;
}

const STATUS_TONE: Record<TaskStatus, string> = {
  created: 'border-white/8 bg-white/[0.04] text-[var(--muted-strong)]',
  assigned: 'border-sky-300/20 bg-sky-400/10 text-sky-100',
  'in-progress': 'border-emerald-300/20 bg-emerald-400/10 text-emerald-100',
  done: 'border-[var(--accent)]/25 bg-[var(--accent)]/10 text-[var(--accent)]',
};

function formatDateTime(timestamp?: string | null) {
  if (!timestamp) return 'Not available';
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function ownerLabel(task: TaskManagerTask, members: TaskMember[]) {
  if (!task.assigneeId) return 'Unassigned';
  return members.find((member) => member.id === task.assigneeId)?.name ?? 'Unknown owner';
}

function getExecutionSignal(task: TaskManagerTask) {
  if (task.status === 'done') return 'Terminal: marked done';
  if (task.latestRunId) return 'Run attached';
  if (task.projectChatConversationId || task.projectChatLaunchedAt) return 'Project Chat attached';
  if (task.status === 'in-progress') return 'Active without backend run';
  if (task.status === 'assigned') return 'Queued for owner';
  return 'Needs launch or assignment';
}

function getRiskSignal(task: TaskManagerTask) {
  if (task.status === 'in-progress' && !task.latestRunId) {
    return 'No backend run is linked yet, so progress is chat/task state only.';
  }
  if (task.priority === 'urgent' && task.status !== 'in-progress' && task.status !== 'done') {
    return 'Urgent task is not active yet.';
  }
  if (!task.assigneeId && task.status !== 'done') {
    return 'No owner assigned.';
  }
  return null;
}

export default function TaskInspector({
  task,
  members,
  activity,
  isCreatingRun = false,
  runError,
  onCreateRun,
  onLaunchTask,
}: TaskInspectorProps) {
  if (!task) {
    return (
      <section className="rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-3">
        <div className="flex items-center gap-2">
          <CircleDot className="h-4 w-4 text-[var(--muted)]" />
          <h2 className="text-sm font-semibold text-white">Task Inspector</h2>
        </div>
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
          Select a task to inspect ownership, execution state, evidence, blockers, and recent movement.
        </p>
      </section>
    );
  }

  const taskActivity = activity.filter((item) => item.taskId === task.id).slice(0, 5);
  const riskSignal = getRiskSignal(task);

  return (
    <section className="rounded-lg border border-white/8 bg-white/[0.03] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CircleDot className="h-4 w-4 shrink-0 text-[var(--muted)]" />
            <h2 className="truncate text-sm font-semibold text-white">Task Inspector</h2>
          </div>
          <p className="mt-2 line-clamp-3 text-sm font-medium leading-5 text-white">{task.title}</p>
          {task.description && (
            <p className="mt-1 line-clamp-3 text-xs leading-5 text-[var(--muted)]">{task.description}</p>
          )}
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${STATUS_TONE[task.status]}`}>
          {formatTaskStatus(task.status)}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="min-w-0 rounded-md border border-white/8 bg-black/10 p-2">
          <div className="flex items-center gap-1.5 text-[10px] uppercase text-[var(--muted)]">
            <UserCircle2 className="h-3.5 w-3.5" />
            Owner
          </div>
          <p className="mt-1 truncate text-xs text-[var(--muted-strong)]">{ownerLabel(task, members)}</p>
        </div>
        <div className="min-w-0 rounded-md border border-white/8 bg-black/10 p-2">
          <div className="flex items-center gap-1.5 text-[10px] uppercase text-[var(--muted)]">
            <GitBranch className="h-3.5 w-3.5" />
            Repo
          </div>
          <p className="mt-1 truncate text-xs text-[var(--muted-strong)]">{task.repo || 'No repo set'}</p>
        </div>
        <div className="min-w-0 rounded-md border border-white/8 bg-black/10 p-2">
          <div className="flex items-center gap-1.5 text-[10px] uppercase text-[var(--muted)]">
            <PlayCircle className="h-3.5 w-3.5" />
            Execution
          </div>
          <p className="mt-1 truncate text-xs text-[var(--muted-strong)]">{getExecutionSignal(task)}</p>
        </div>
        <div className="min-w-0 rounded-md border border-white/8 bg-black/10 p-2">
          <div className="flex items-center gap-1.5 text-[10px] uppercase text-[var(--muted)]">
            <Clock3 className="h-3.5 w-3.5" />
            Updated
          </div>
          <p className="mt-1 truncate text-xs text-[var(--muted-strong)]">{formatDateTime(task.updatedAt)}</p>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {riskSignal ? (
          <div className="rounded-md border border-amber-300/20 bg-amber-300/10 px-2.5 py-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-200" />
              <p className="text-xs leading-5 text-amber-100">{riskSignal}</p>
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-[var(--accent)]/20 bg-[var(--accent)]/10 px-2.5 py-2">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
              <p className="text-xs leading-5 text-[var(--muted-strong)]">No obvious task-level blocker from current state.</p>
            </div>
          </div>
        )}

        <div className="rounded-md border border-white/8 bg-black/10 p-2.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--muted-strong)]">
            <ShieldCheck className="h-3.5 w-3.5 text-[var(--muted)]" />
            Evidence
          </div>
          <div className="mt-2 space-y-1 text-[11px] leading-4 text-[var(--muted)]">
            <p>Project Chat: {task.projectChatLaunchedAt ? formatDateTime(task.projectChatLaunchedAt) : 'Not launched'}</p>
            <p>Conversation: {task.projectChatConversationId || 'Not attached'}</p>
            <p>Latest run: {task.latestRunId || 'Not linked'}</p>
          </div>
        </div>
      </div>

      {runError && (
        <div className="mt-3 rounded-md border border-red-300/20 bg-red-400/10 px-2.5 py-2 text-xs leading-5 text-red-100">
          {runError}
        </div>
      )}

      <div className="mt-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-[var(--muted-strong)]">Recent Movement</h3>
          <span className="text-[10px] text-[var(--muted)]">{taskActivity.length}</span>
        </div>
        {taskActivity.length === 0 ? (
          <div className="rounded-md border border-dashed border-white/10 px-2.5 py-2 text-[11px] text-[var(--muted)]">
            No task-specific activity yet.
          </div>
        ) : (
          <div className="max-h-32 space-y-1.5 overflow-y-auto pr-1">
            {taskActivity.map((item) => (
              <div key={item.id} className="rounded-md border border-white/8 bg-black/10 px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] font-medium text-[var(--muted-strong)]">{item.actor}</span>
                  <span className="shrink-0 text-[10px] text-[var(--muted)]">{formatDateTime(item.createdAt)}</span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-[var(--muted)]">{item.summary}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onLaunchTask?.(task)}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-white/8 bg-white/[0.03] text-xs text-[var(--muted-strong)] transition hover:bg-white/[0.07] hover:text-white active:scale-[0.99]"
        >
          <MessageSquareText className="h-3.5 w-3.5" />
          Chat
        </button>
        <button
          type="button"
          disabled={isCreatingRun}
          onClick={() => onCreateRun?.(task)}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[var(--accent)]/20 bg-[var(--accent)]/10 text-xs text-[var(--accent)] transition hover:bg-[var(--accent)]/15 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isCreatingRun ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
          Run
        </button>
      </div>
    </section>
  );
}
