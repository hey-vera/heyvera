import { useCallback, useState, useEffect } from 'react';
import { ExternalLink, MessageSquareText, PanelRightClose, PanelRightOpen, LayoutGrid } from 'lucide-react';
import TaskManagerChat from '../tasks/TaskManagerChat';
import TaskBoard from '../tasks/TaskBoard';
import TaskInspector from '../tasks/TaskInspector';
import { openDetachedPanel } from '../../lib/shell/windowManager';
import { useTaskManager } from '../../lib/taskManager';
import { CortexApiError, createRun } from '../../lib/cortexApi';
import type { CortexGroup } from '../../lib/groups';
import type {
  ApprovalState,
  ChatMessage,
  RunProfile,
  TaskManagerState,
  TaskManagerTask,
} from '../../types';

interface TaskManagerSidebarProps {
  group: CortexGroup;
  userId: string;
  activeConversationId: string | null;
  messages: ChatMessage[];
  draft: string;
  isStreaming: boolean;
  isLoadingConversation: boolean;
  needsSubscription: boolean;
  runProfile: RunProfile;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onStop?: () => void;
  onSubscribe: () => void;
  onApprovalAction: (messageId: string, nextState: ApprovalState) => void;
  onTaskStateChange?: (state: TaskManagerState) => void;
  onLaunchTaskInProjectChat?: (task: TaskManagerTask) => void;
}

type SidebarView = 'chat' | 'map';

export default function TaskManagerSidebar({
  group,
  userId,
  activeConversationId,
  messages,
  draft,
  isStreaming,
  isLoadingConversation,
  needsSubscription,
  runProfile,
  onDraftChange,
  onSend,
  onStop,
  onSubscribe,
  onApprovalAction,
  onTaskStateChange,
  onLaunchTaskInProjectChat,
}: TaskManagerSidebarProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeView, setActiveView] = useState<SidebarView>('chat');
  const [groupTransition, setGroupTransition] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [creatingRunTaskId, setCreatingRunTaskId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const taskManager = useTaskManager(group, userId);
  const selectedTask = taskManager.state.tasks.find((task) => task.id === selectedTaskId)
    ?? taskManager.state.tasks[0]
    ?? null;

  // Handle group switching with visual feedback
  useEffect(() => {
    setGroupTransition(true);
    const timer = setTimeout(() => setGroupTransition(false), 300);
    return () => clearTimeout(timer);
  }, [group.id]);

  const handlePopOut = useCallback(() => {
    openDetachedPanel('task-manager', group);
  }, [group]);

  const handleToggleExpand = useCallback(() => {
    setIsExpanded(!isExpanded);
  }, [isExpanded]);

  const handleLaunchTaskInProjectChat = useCallback((task: TaskManagerTask) => {
    const linkedTask = taskManager.launchTaskInProjectChat(task.id, activeConversationId);
    setSelectedTaskId(task.id);
    onLaunchTaskInProjectChat?.(linkedTask ?? task);
    setActiveView('chat');
  }, [activeConversationId, onLaunchTaskInProjectChat, taskManager]);

  const handleSelectTask = useCallback((task: TaskManagerTask) => {
    setSelectedTaskId(task.id);
  }, []);

  const handleCreateTaskRun = useCallback(async (task: TaskManagerTask) => {
    if (creatingRunTaskId) return;
    setSelectedTaskId(task.id);
    setCreatingRunTaskId(task.id);
    setRunError(null);
    const goal = [
      `Work on task: ${task.title}`,
      task.repo ? `Repo/context: ${task.repo}` : null,
      `Task id: ${task.id}`,
      task.description ? `Details: ${task.description}` : null,
      'Create a safe decomposed run plan, execute the work, verify it, and preserve evidence for review.',
    ].filter(Boolean).join('\n');

    try {
      const created = await createRun(goal, runProfile);
      taskManager.updateTask(task.id, {
        status: task.status === 'done' ? task.status : 'in-progress',
        latestRunId: created.run_id,
      });
    } catch (error) {
      if (error instanceof CortexApiError && error.status === 503) {
        setRunError('Runtime is starting up. Try again in a moment.');
      } else {
        setRunError(error instanceof Error ? error.message : 'Could not create backend run.');
      }
    } finally {
      setCreatingRunTaskId(null);
    }
  }, [creatingRunTaskId, runProfile, taskManager]);

  const handleSyncRunState = useCallback((
    task: TaskManagerTask,
    status: TaskManagerTask['status'],
    snapshot: Pick<TaskManagerTask, 'latestRunStatus' | 'latestRunSyncedAt' | 'latestRunStepSummary'>,
  ) => {
    taskManager.updateTask(task.id, { status, ...snapshot });
  }, [taskManager]);

  const handleUpdateRunSnapshot = useCallback((
    task: TaskManagerTask,
    snapshot: Pick<TaskManagerTask, 'latestRunStatus' | 'latestRunSyncedAt' | 'latestRunStepSummary'>,
  ) => {
    taskManager.updateTaskRunSnapshot(task.id, snapshot);
  }, [taskManager]);

  // Minimized state
  if (!isExpanded) {
    return (
      <div className="flex h-full w-12 flex-col border-l border-white/6 bg-[var(--bg)]">
        <div className="flex items-center justify-center p-2">
          <button
            type="button"
            onClick={handleToggleExpand}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-white/6 hover:text-white active:scale-95"
            aria-label="Expand Task Manager"
            title={`Expand Task Manager for ${group.name}`}
          >
            <PanelRightOpen className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 border-t border-white/6 p-2">
          <div className="text-vertical rotate-180 text-xs text-[var(--muted)]">
            {group.name}
          </div>
        </div>

        {/* Group indicator */}
        <div className="p-2">
          <div
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: group.accent }}
            title={`${group.name} Task Manager`}
          />
        </div>
      </div>
    );
  }

  // Expanded state
  return (
    <div className={`flex h-full w-96 flex-col border-l border-white/6 bg-[var(--bg)] transition-all duration-300 ${
      groupTransition ? 'opacity-90' : 'opacity-100'
    }`}>
      {/* Header */}
      <div className="border-b border-white/6 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <MessageSquareText className="h-4 w-4 text-[var(--muted)]" />
              <h2 className="truncate text-sm font-semibold text-white">Task Manager</h2>
            </div>
            <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
              Live coordination for{' '}
              <span className="font-medium text-[var(--muted-strong)]">{group.name}</span>
              {group.kind === 'team' && ` • ${group.members} members`}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handlePopOut}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-white/6 hover:text-white active:scale-95"
              aria-label="Pop out Task Manager"
              title="Open in separate window"
            >
              <ExternalLink className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleToggleExpand}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-white/6 hover:text-white active:scale-95"
              aria-label="Minimize Task Manager"
              title="Minimize sidebar"
            >
              <PanelRightClose className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* View Tabs */}
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg border border-white/8 bg-white/[0.03] p-1">
          <button
            type="button"
            onClick={() => setActiveView('chat')}
            className={[
              'inline-flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition',
              activeView === 'chat'
                ? 'bg-white/10 text-white'
                : 'text-[var(--muted)] hover:text-white',
            ].join(' ')}
          >
            <MessageSquareText className="h-3.5 w-3.5" />
            Chat
          </button>
          <button
            type="button"
            onClick={() => setActiveView('map')}
            className={[
              'inline-flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition',
              activeView === 'map'
                ? 'bg-white/10 text-white'
                : 'text-[var(--muted)] hover:text-white',
            ].join(' ')}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Live Map
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeView === 'chat' ? (
          <TaskManagerChat
            group={group}
            userId={userId}
            activeConversationId={activeConversationId}
            messages={messages}
            draft={draft}
            isStreaming={isStreaming}
            isLoadingConversation={isLoadingConversation}
            needsSubscription={needsSubscription}
            runProfile={runProfile}
            onDraftChange={onDraftChange}
            onSend={onSend}
            onStop={onStop}
            onSubscribe={onSubscribe}
            onApprovalAction={onApprovalAction}
            onTaskStateChange={onTaskStateChange}
            onLaunchTaskInProjectChat={onLaunchTaskInProjectChat}
            sidebarMode={true}
          />
        ) : (
          <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-white">Live Map</h3>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  {taskManager.summary.open} open · {taskManager.summary.inProgress} active · {taskManager.summary.done} done
                </p>
              </div>
            </div>
            <TaskBoard
              tasks={taskManager.state.tasks}
              members={taskManager.state.members}
              compact
              selectedTaskId={selectedTask?.id ?? null}
              onUpdateTask={taskManager.updateTask}
              onSelectTask={handleSelectTask}
              onLaunchTask={handleLaunchTaskInProjectChat}
            />
            <TaskInspector
              task={selectedTask}
              members={taskManager.state.members}
              activity={taskManager.state.activity}
              isCreatingRun={creatingRunTaskId === selectedTask?.id}
              runError={runError}
              onCreateRun={handleCreateTaskRun}
              onSyncRunState={handleSyncRunState}
              onUpdateRunSnapshot={handleUpdateRunSnapshot}
              onLaunchTask={handleLaunchTaskInProjectChat}
            />
          </div>
        )}
      </div>
    </div>
  );
}
