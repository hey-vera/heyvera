import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  TaskActivity,
  TaskManagerState,
  TaskManagerTask,
  TaskMember,
  TaskPriority,
  TaskStatus,
} from '../types';
import { getGroupTaskManagerState, updateGroupTaskManagerState } from './cortexApi';
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

export interface ParsedTaskAction {
  type: 'task' | 'status' | 'handoff' | 'note';
  title: string;
  assigneeId?: string | null;
  status?: TaskStatus;
  targetTaskId?: string;
  summary: string;
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

  useEffect(() => {
    setState(readState(group, userId));
  }, [group, userId]);

  useEffect(() => {
    let cancelled = false;
    void getGroupTaskManagerState(group.id)
      .then((remoteState) => {
        if (cancelled) return;
        const next = mergeDefaultMembers(remoteState, group, userId);
        setState(next);
        writeState(group.id, next);
      })
      .catch(() => {
        // The local task manager remains usable until backend task endpoints land.
      });
    return () => {
      cancelled = true;
    };
  }, [group, userId]);

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
    setState(next);
    writeState(group.id, next);
    void updateGroupTaskManagerState(group.id, next).catch(() => {
      // Keep local state as the source of truth when the API is unavailable.
    });
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.postMessage({ groupId: group.id });
      channel.close();
    }
  }, [group.id]);

  const applyTextCommand = useCallback((text: string, actor = 'You') => {
    const actions = parseTaskCommand(text, state);
    if (actions.length === 0) return [];
    publish(applyActions(group.id, state, actions, actor));
    return actions;
  }, [group.id, publish, state]);

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
    publish({
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
  }, [group.id, publish, state]);

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
    publish({
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
  }, [group.id, publish, state]);

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
    publish({
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
  }, [group.id, publish, state]);

  const resetTasks = useCallback(() => {
    publish(emptyState(group, userId));
  }, [group, publish, userId]);

  const summary = useMemo(() => buildTaskSummary(state), [state]);

  return {
    state,
    summary,
    applyTextCommand,
    createTask,
    updateTask,
    launchTaskInProjectChat,
    resetTasks,
  };
}
