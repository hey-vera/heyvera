import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  TaskActivity,
  TaskCommandAction,
  TaskManagerState,
  TaskManagerTask,
  TaskMember,
  TaskPriority,
  TaskStatus,
} from '../types';
import {
  applyGroupTaskManagerActions,
  createGroupTaskManagerTask,
  getGroupTaskManagerState,
  patchGroupTaskManagerTask,
  updateGroupTaskManagerState,
} from './cortexApi';
import type { CortexGroup } from './groups';

const STORAGE_PREFIX = 'cortex:task-manager';
const CHANNEL_NAME = 'cortex-task-manager';

const STATUS_LABELS: Record<TaskStatus, string> = {
  created: 'Created',
  assigned: 'Assigned',
  'in-progress': 'In progress',
  done: 'Done',
};

const MEMBER_COLORS = ['#9cc7b8', '#f3c969', '#8fb4ff', '#d9a5ff', '#f69fae'];

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function storageKey(groupId: string) {
  return `${STORAGE_PREFIX}:${groupId}`;
}

function toInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'TM';
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return value === 'created' || value === 'assigned' || value === 'in-progress' || value === 'done';
}

function isTaskPriority(value: unknown): value is TaskPriority {
  return value === 'normal' || value === 'high' || value === 'urgent';
}

function isMember(value: unknown): value is TaskMember {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TaskMember>;
  return typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.initials === 'string'
    && (candidate.status === 'online' || candidate.status === 'working' || candidate.status === 'away')
    && typeof candidate.color === 'string';
}

function isTask(value: unknown): value is TaskManagerTask {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TaskManagerTask>;
  return typeof candidate.id === 'string'
    && typeof candidate.groupId === 'string'
    && typeof candidate.title === 'string'
    && isTaskStatus(candidate.status)
    && isTaskPriority(candidate.priority)
    && typeof candidate.createdAt === 'string'
    && typeof candidate.updatedAt === 'string'
    && typeof candidate.createdBy === 'string';
}

function isActivity(value: unknown): value is TaskActivity {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TaskActivity>;
  return typeof candidate.id === 'string'
    && typeof candidate.groupId === 'string'
    && typeof candidate.actor === 'string'
    && typeof candidate.summary === 'string'
    && typeof candidate.createdAt === 'string'
    && (
      candidate.kind === 'created'
      || candidate.kind === 'assigned'
      || candidate.kind === 'status'
      || candidate.kind === 'handoff'
      || candidate.kind === 'linked'
      || candidate.kind === 'note'
    );
}

function defaultMembers(group: CortexGroup, userId: string): TaskMember[] {
  const ownerName = group.kind === 'personal' ? 'You' : 'You';
  const baseNames = group.kind === 'personal'
    ? [ownerName]
    : [ownerName, 'Joe', 'Maya', 'Sam'].slice(0, Math.max(group.members, 2));

  return baseNames.map((name, index) => ({
    id: index === 0 ? userId : `member-${normalize(name).replace(/[^a-z0-9]+/g, '-')}`,
    name,
    initials: toInitials(name),
    status: index === 0 ? 'online' : index === 1 ? 'working' : 'online',
    currentTaskId: null,
    color: MEMBER_COLORS[index % MEMBER_COLORS.length],
  }));
}

function emptyState(group: CortexGroup, userId: string): TaskManagerState {
  const createdAt = nowIso();
  return {
    tasks: [],
    members: defaultMembers(group, userId),
    activity: [
      {
        id: createId('activity'),
        groupId: group.id,
        kind: 'note',
        actor: 'Cortex',
        summary: `${group.name} task manager is ready for coordination.`,
        createdAt,
      },
    ],
    updatedAt: createdAt,
  };
}

function mergeDefaultMembers(state: TaskManagerState, group: CortexGroup, userId: string): TaskManagerState {
  const byId = new Map(state.members.map((member) => [member.id, member]));
  for (const member of defaultMembers(group, userId)) {
    if (!byId.has(member.id)) byId.set(member.id, member);
  }
  return { ...state, members: Array.from(byId.values()) };
}

function readState(group: CortexGroup, userId: string): TaskManagerState {
  try {
    const raw = window.localStorage.getItem(storageKey(group.id));
    if (!raw) return emptyState(group, userId);
    const parsed = JSON.parse(raw) as Partial<TaskManagerState>;
    if (!parsed || typeof parsed !== 'object') return emptyState(group, userId);
    const tasks = Array.isArray(parsed.tasks) ? parsed.tasks.filter(isTask) : [];
    const members = Array.isArray(parsed.members) ? parsed.members.filter(isMember) : [];
    const activity = Array.isArray(parsed.activity) ? parsed.activity.filter(isActivity) : [];
    return mergeDefaultMembers({
      tasks,
      members,
      activity,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso(),
    }, group, userId);
  } catch {
    return emptyState(group, userId);
  }
}

export function readTaskManagerState(group: CortexGroup, userId: string): TaskManagerState {
  return readState(group, userId);
}

export const TASK_MANAGER_CHANNEL_NAME = CHANNEL_NAME;

function writeState(groupId: string, state: TaskManagerState) {
  try {
    window.localStorage.setItem(storageKey(groupId), JSON.stringify(state));
  } catch {
    // Local state is a bridge until the group task API lands.
  }
}

function broadcastTaskState(groupId: string) {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage({ groupId });
  channel.close();
}

function findMember(members: TaskMember[], name: string): TaskMember | null {
  const normalized = normalize(name);
  if (normalized === 'me' || normalized === 'myself') {
    return members.find((member) => normalize(member.name) === 'you') ?? members[0] ?? null;
  }
  return members.find((member) => normalize(member.name) === normalized)
    ?? members.find((member) => normalize(member.name).startsWith(normalized))
    ?? null;
}

function extractPriority(text: string): TaskPriority {
  const normalized = normalize(text);
  if (/\b(urgent|asap|blocker|p0)\b/.test(normalized)) return 'urgent';
  if (/\b(high|important|p1)\b/.test(normalized)) return 'high';
  return 'normal';
}

function cleanTitle(text: string) {
  return text
    .replace(/^task\s*[:-]\s*/i, '')
    .replace(/\b(please|can you|could you)\b/gi, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function titleFromText(text: string) {
  const cleaned = cleanTitle(text);
  if (cleaned.length <= 96) return cleaned || 'New coordination task';
  return `${cleaned.slice(0, 93).trimEnd()}...`;
}

export function formatTaskStatus(status: TaskStatus) {
  return STATUS_LABELS[status];
}

export function buildTaskSummary(state: TaskManagerState) {
  const open = state.tasks.filter((task) => task.status !== 'done').length;
  const inProgress = state.tasks.filter((task) => task.status === 'in-progress').length;
  const done = state.tasks.filter((task) => task.status === 'done').length;
  return { open, inProgress, done, total: state.tasks.length };
}

export type ParsedTaskAction = TaskCommandAction;

export type TaskManagerSyncPhase = 'loading' | 'syncing' | 'synced' | 'local';

export interface TaskManagerSyncState {
  phase: TaskManagerSyncPhase;
  source: 'local' | 'backend';
  lastBackendReadAt: string | null;
  lastBackendWriteAt: string | null;
  lastError: string | null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Backend task state is unavailable.';
}

export function parseTaskCommand(text: string, state: TaskManagerState): ParsedTaskAction[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const normalized = normalize(trimmed);
  const actions: ParsedTaskAction[] = [];

  const handoffMatch = trimmed.match(/^([a-z][\w -]{1,32}),?\s+(?:switch|move|handoff|change)\s+(?:to\s+)?(.+)$/i);
  if (handoffMatch) {
    const member = findMember(state.members, handoffMatch[1]);
    const title = titleFromText(handoffMatch[2]);
    actions.push({
      type: 'handoff',
      title,
      assigneeId: member?.id ?? null,
      status: 'in-progress',
      summary: member ? `${member.name} switched to ${title}.` : `Handoff noted: ${title}.`,
    });
    return actions;
  }

  const foundMatch = trimmed.match(/\bfound\s+(\d+)\s+([a-z][\w -]*?)(?:,|\.|$)/i);
  const assignmentMatches = Array.from(trimmed.matchAll(/(\d+)\s+to\s+([a-z][\w -]{1,32})(?=,|\.|$|\s+and\s+)/gi));
  if (foundMatch && assignmentMatches.length > 0) {
    const countLabel = foundMatch[2].trim().replace(/s$/i, '');
    assignmentMatches.forEach((match) => {
      const count = Number.parseInt(match[1], 10);
      const member = findMember(state.members, match[2]);
      for (let index = 0; index < count; index += 1) {
        const title = `${countLabel} ${actions.length + 1}`;
        actions.push({
          type: 'task',
          title,
          assigneeId: member?.id ?? null,
          status: member ? 'assigned' : 'created',
          summary: member ? `Assigned ${title} to ${member.name}.` : `Created ${title}.`,
        });
      }
    });
    return actions;
  }

  const assignMatch = trimmed.match(/\bassign\s+(.+?)\s+to\s+([a-z][\w -]{1,32})(?=,|\.|$)/i);
  if (assignMatch) {
    const member = findMember(state.members, assignMatch[2]);
    const title = titleFromText(assignMatch[1]);
    actions.push({
      type: 'task',
      title,
      assigneeId: member?.id ?? null,
      status: member ? 'assigned' : 'created',
      summary: member ? `Assigned ${title} to ${member.name}.` : `Created ${title}; assignee not found.`,
    });
    return actions;
  }

  const doneMatch = normalized.match(/\b(done|complete|completed|finish|finished)\b/);
  if (doneMatch) {
    const target = state.tasks.find((task) =>
      task.status !== 'done' && normalized.includes(normalize(task.title).slice(0, 24)),
    ) ?? state.tasks.find((task) => task.status !== 'done');
    if (target) {
      actions.push({
        type: 'status',
        title: target.title,
        targetTaskId: target.id,
        status: 'done',
        summary: `Marked ${target.title} done.`,
      });
      return actions;
    }
  }

  if (/\b(create|add|track|todo|task)\b/i.test(trimmed)) {
    const title = titleFromText(trimmed.replace(/\b(create|add|track|todo|task)\b/gi, ''));
    actions.push({
      type: 'task',
      title,
      status: 'created',
      summary: `Created ${title}.`,
    });
    return actions;
  }

  if (/\b(stop|pause|hold)\b/.test(normalized)) {
    actions.push({
      type: 'note',
      title: titleFromText(trimmed),
      summary: `Coordination note: ${trimmed}`,
    });
    return actions;
  }

  return actions;
}

function applyActions(
  groupId: string,
  current: TaskManagerState,
  actions: ParsedTaskAction[],
  actor: string,
): TaskManagerState {
  if (actions.length === 0) return current;
  const timestamp = nowIso();
  let tasks = current.tasks;
  let members = current.members;
  const activity: TaskActivity[] = [];

  for (const action of actions) {
    if (action.type === 'status' && action.targetTaskId && action.status) {
      tasks = tasks.map((task) =>
        task.id === action.targetTaskId
          ? { ...task, status: action.status ?? task.status, updatedAt: timestamp }
          : task,
      );
      activity.push({
        id: createId('activity'),
        groupId,
        taskId: action.targetTaskId,
        kind: 'status',
        actor,
        summary: action.summary,
        createdAt: timestamp,
      });
      continue;
    }

    if (action.type === 'note') {
      activity.push({
        id: createId('activity'),
        groupId,
        kind: 'note',
        actor,
        summary: action.summary,
        createdAt: timestamp,
      });
      continue;
    }

    const task: TaskManagerTask = {
      id: createId('task'),
      groupId,
      title: action.title,
      status: action.status ?? (action.assigneeId ? 'assigned' : 'created'),
      assigneeId: action.assigneeId ?? null,
      repo: null,
      priority: extractPriority(action.title),
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actor,
    };
    task.priority = task.priority === 'normal' ? extractPriority(action.summary) : task.priority;
    tasks = [task, ...tasks];
    if (task.assigneeId && task.status === 'in-progress') {
      members = members.map((member) =>
        member.id === task.assigneeId
          ? { ...member, status: 'working', currentTaskId: task.id }
          : member.currentTaskId === task.id
            ? { ...member, currentTaskId: null }
            : member,
      );
    }
    activity.push({
      id: createId('activity'),
      groupId,
      taskId: task.id,
      kind: action.type === 'handoff' ? 'handoff' : task.assigneeId ? 'assigned' : 'created',
      actor,
      summary: action.summary,
      createdAt: timestamp,
    });
  }

  return {
    tasks,
    members,
    activity: [...activity, ...current.activity].slice(0, 80),
    updatedAt: timestamp,
  };
}

export function useTaskManager(group: CortexGroup, userId: string) {
  const [state, setState] = useState<TaskManagerState>(() => readState(group, userId));
  const syncRequestId = useRef(0);
  const [sync, setSync] = useState<TaskManagerSyncState>({
    phase: 'loading',
    source: 'local',
    lastBackendReadAt: null,
    lastBackendWriteAt: null,
    lastError: null,
  });

  const commitRemoteState = useCallback((remoteState: TaskManagerState, writeKind: 'read' | 'write') => {
    const next = mergeDefaultMembers(remoteState, group, userId);
    const timestamp = nowIso();
    setState(next);
    writeState(group.id, next);
    setSync((current) => ({
      ...current,
      phase: 'synced',
      source: 'backend',
      lastBackendReadAt: writeKind === 'read' ? timestamp : current.lastBackendReadAt,
      lastBackendWriteAt: writeKind === 'write' ? timestamp : current.lastBackendWriteAt,
      lastError: null,
    }));
    broadcastTaskState(group.id);
    return next;
  }, [group, userId]);

  const markSyncing = useCallback(() => {
    setSync((current) => ({
      ...current,
      phase: 'syncing',
      source: 'local',
      lastError: null,
    }));
  }, []);

  const markLocalFallback = useCallback((error: unknown) => {
    setSync((current) => ({
      ...current,
      phase: 'local',
      source: 'local',
      lastError: errorMessage(error),
    }));
  }, []);

  const loadRemoteState = useCallback(async () => {
    const requestId = syncRequestId.current + 1;
    syncRequestId.current = requestId;
    setSync((current) => ({
      ...current,
      phase: 'loading',
      source: 'local',
      lastError: null,
    }));

    try {
      const remoteState = await getGroupTaskManagerState(group.id);
      if (syncRequestId.current !== requestId) return null;
      return commitRemoteState(remoteState, 'read');
    } catch (error) {
      if (syncRequestId.current === requestId) markLocalFallback(error);
      return null;
    }
  }, [commitRemoteState, group.id, markLocalFallback]);

  const persistOptimisticState = useCallback((optimisticState: TaskManagerState) => {
    setState(optimisticState);
    writeState(group.id, optimisticState);
    broadcastTaskState(group.id);
    markSyncing();
  }, [group.id, markSyncing]);

  const syncWholeState = useCallback((next: TaskManagerState) => {
    void updateGroupTaskManagerState(group.id, next)
      .then((remoteState) => {
        commitRemoteState(remoteState, 'write');
      })
      .catch(markLocalFallback);
  }, [commitRemoteState, group.id, markLocalFallback]);

  useEffect(() => {
    setState(readState(group, userId));
    setSync((current) => ({
      ...current,
      phase: 'loading',
      source: 'local',
      lastError: null,
    }));
  }, [group, userId]);

  useEffect(() => {
    void loadRemoteState();
  }, [loadRemoteState]);

  useEffect(() => {
    writeState(group.id, state);
  }, [group.id, state]);

  useEffect(() => {
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);
    const onMessage = (event: MessageEvent<{ groupId?: string }>) => {
      if (event.data?.groupId === group.id) setState(readState(group, userId));
    };
    channel?.addEventListener('message', onMessage);

    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey(group.id)) setState(readState(group, userId));
    };
    window.addEventListener('storage', onStorage);
    return () => {
      channel?.removeEventListener('message', onMessage);
      channel?.close();
      window.removeEventListener('storage', onStorage);
    };
  }, [group, userId]);

  const publish = useCallback((next: TaskManagerState) => {
    persistOptimisticState(next);
    syncWholeState(next);
  }, [persistOptimisticState, syncWholeState]);

  const publishTaskPatch = useCallback((
    taskId: string,
    patch: Partial<Pick<TaskManagerTask, 'assigneeId' | 'status' | 'title' | 'repo' | 'priority' | 'projectChatConversationId' | 'projectChatLaunchedAt' | 'latestRunId' | 'latestRunStatus' | 'latestRunSyncedAt' | 'latestRunStepSummary'>>,
    optimisticState: TaskManagerState,
  ) => {
    persistOptimisticState(optimisticState);
    void patchGroupTaskManagerTask(group.id, taskId, patch)
      .then((remoteState) => {
        commitRemoteState(remoteState, 'write');
      })
      .catch(() => {
        syncWholeState(optimisticState);
      });
  }, [commitRemoteState, group.id, persistOptimisticState, syncWholeState]);

  const publishTaskCreate = useCallback((task: TaskManagerTask, optimisticState: TaskManagerState) => {
    persistOptimisticState(optimisticState);
    void createGroupTaskManagerTask(group.id, task)
      .then((remoteState) => {
        commitRemoteState(remoteState, 'write');
      })
      .catch(() => {
        syncWholeState(optimisticState);
      });
  }, [commitRemoteState, group.id, persistOptimisticState, syncWholeState]);

  const publishTaskActions = useCallback((
    actions: ParsedTaskAction[],
    actor: string,
    optimisticState: TaskManagerState,
  ) => {
    persistOptimisticState(optimisticState);
    void applyGroupTaskManagerActions(group.id, actions, actor)
      .then((remoteState) => {
        commitRemoteState(remoteState, 'write');
      })
      .catch(() => {
        syncWholeState(optimisticState);
      });
  }, [commitRemoteState, group.id, persistOptimisticState, syncWholeState]);

  const applyTextCommand = useCallback((text: string, actor = 'You') => {
    const actions = parseTaskCommand(text, state);
    if (actions.length === 0) return [];
    publishTaskActions(actions, actor, applyActions(group.id, state, actions, actor));
    return actions;
  }, [group.id, publishTaskActions, state]);

  const createTask = useCallback((title: string, assigneeId?: string | null, repo?: string | null) => {
    const timestamp = nowIso();
    const assignee = state.members.find((member) => member.id === assigneeId);
    const task: TaskManagerTask = {
      id: createId('task'),
      groupId: group.id,
      title: titleFromText(title),
      status: assigneeId ? 'assigned' : 'created',
      assigneeId: assigneeId ?? null,
      repo: repo ?? null,
      priority: extractPriority(title),
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: 'You',
    };
    publishTaskCreate(task, {
      ...state,
      tasks: [task, ...state.tasks],
      activity: [{
        id: createId('activity'),
        groupId: group.id,
        taskId: task.id,
        kind: assigneeId ? 'assigned' as const : 'created' as const,
        actor: 'You',
        summary: assignee ? `Created ${task.title} for ${assignee.name}.` : `Created ${task.title}.`,
        createdAt: timestamp,
      }, ...state.activity].slice(0, 80),
      updatedAt: timestamp,
    });
  }, [group.id, publishTaskCreate, state]);

  const updateTask = useCallback((taskId: string, patch: Partial<Pick<TaskManagerTask, 'assigneeId' | 'status' | 'title' | 'repo' | 'priority' | 'projectChatConversationId' | 'projectChatLaunchedAt' | 'latestRunId' | 'latestRunStatus' | 'latestRunSyncedAt' | 'latestRunStepSummary'>>) => {
    const timestamp = nowIso();
    const previous = state.tasks.find((task) => task.id === taskId);
    if (!previous) return;
    const nextTask = { ...previous, ...patch, updatedAt: timestamp };
    const assignee = state.members.find((member) => member.id === nextTask.assigneeId);
    const summary = patch.assigneeId !== undefined
      ? `${nextTask.title} assigned to ${assignee?.name ?? 'unassigned'}.`
      : patch.status
        ? `${nextTask.title} moved to ${formatTaskStatus(patch.status)}.`
        : `${nextTask.title} updated.`;
    publishTaskPatch(taskId, patch, {
      ...state,
      tasks: state.tasks.map((task) => task.id === taskId ? nextTask : task),
      members: state.members.map((member) => {
        if (member.id === nextTask.assigneeId && nextTask.status === 'in-progress') {
          return { ...member, status: 'working', currentTaskId: nextTask.id };
        }
        if (member.currentTaskId === nextTask.id && nextTask.status !== 'in-progress') {
          return { ...member, currentTaskId: null, status: member.status === 'working' ? 'online' : member.status };
        }
        return member;
      }),
      activity: [{
        id: createId('activity'),
        groupId: group.id,
        taskId,
        kind: patch.assigneeId !== undefined ? 'assigned' as const : patch.status ? 'status' as const : 'note' as const,
        actor: 'You',
        summary,
        createdAt: timestamp,
      }, ...state.activity].slice(0, 80),
      updatedAt: timestamp,
    });
  }, [group.id, publishTaskPatch, state]);

  const updateTaskRunSnapshot = useCallback((taskId: string, snapshot: Pick<TaskManagerTask, 'latestRunStatus' | 'latestRunSyncedAt' | 'latestRunStepSummary'>) => {
    const previous = state.tasks.find((task) => task.id === taskId);
    if (!previous) return;
    const timestamp = nowIso();
    publishTaskPatch(taskId, snapshot, {
      ...state,
      tasks: state.tasks.map((task) => task.id === taskId
        ? { ...task, ...snapshot, updatedAt: timestamp }
        : task),
      updatedAt: timestamp,
    });
  }, [publishTaskPatch, state]);

  const launchTaskInProjectChat = useCallback((taskId: string, conversationId: string | null) => {
    const timestamp = nowIso();
    const previous = state.tasks.find((task) => task.id === taskId);
    if (!previous) return null;
    const nextTask: TaskManagerTask = {
      ...previous,
      status: previous.status === 'done' ? previous.status : 'in-progress',
      projectChatConversationId: conversationId,
      projectChatLaunchedAt: timestamp,
      updatedAt: timestamp,
    };
    const patch = {
      status: nextTask.status,
      projectChatConversationId: nextTask.projectChatConversationId,
      projectChatLaunchedAt: nextTask.projectChatLaunchedAt,
    };
    publishTaskPatch(taskId, patch, {
      ...state,
      tasks: state.tasks.map((task) => task.id === taskId ? nextTask : task),
      members: state.members.map((member) => {
        if (member.id === nextTask.assigneeId && nextTask.status === 'in-progress') {
          return { ...member, status: 'working', currentTaskId: nextTask.id };
        }
        return member;
      }),
      activity: [{
        id: createId('activity'),
        groupId: group.id,
        taskId,
        kind: 'linked' as const,
        actor: 'You',
        summary: conversationId
          ? `${nextTask.title} opened in Project Chat.`
          : `${nextTask.title} staged for Project Chat.`,
        createdAt: timestamp,
      }, ...state.activity].slice(0, 80),
      updatedAt: timestamp,
    });
    return nextTask;
  }, [group.id, publishTaskPatch, state]);

  const resetTasks = useCallback(() => {
    publish(emptyState(group, userId));
  }, [group, publish, userId]);

  const summary = useMemo(() => buildTaskSummary(state), [state]);

  return {
    state,
    summary,
    sync,
    refreshBackendState: loadRemoteState,
    applyTextCommand,
    createTask,
    updateTask,
    updateTaskRunSnapshot,
    launchTaskInProjectChat,
    resetTasks,
  };
}
