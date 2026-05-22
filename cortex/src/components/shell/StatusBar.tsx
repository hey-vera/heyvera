import { Activity, CircleDot, GitBranch, LayoutPanelTop, Radio, WifiOff, Zap } from 'lucide-react';
import type { TaskManagerState } from '../../types';
import type { RunProfile } from '../../types';
import { formatShortcut } from '../../lib/shell/shortcuts';

interface StatusBarProps {
  groupName: string;
  activeConversationTitle: string;
  isStreaming: boolean;
  isLoadingConversation: boolean;
  runProfile: RunProfile;
  taskState?: TaskManagerState | null;
  detached?: boolean;
  providerCount?: number;
  onOpenCommandPalette: () => void;
  onOpenWorkSurface: () => void;
}

export default function StatusBar({
  groupName,
  activeConversationTitle,
  isStreaming,
  isLoadingConversation,
  runProfile,
  taskState,
  detached,
  providerCount = 0,
  onOpenCommandPalette,
  onOpenWorkSurface,
}: StatusBarProps) {
  const openTasks = taskState?.tasks.filter((task) => task.status !== 'done').length ?? 0;
  const activeTasks = taskState?.tasks.filter((task) => task.status === 'in-progress').length ?? 0;
  const connectionLabel = isLoadingConversation ? 'Syncing' : isStreaming ? 'Streaming' : 'Ready';

  return (
    <footer className="flex h-8 shrink-0 items-center justify-between gap-2 border-t border-white/6 bg-[#101313] px-2 text-[11px] text-[var(--muted)]">
      <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
        <span className="inline-flex items-center gap-1.5">
          {isLoadingConversation ? (
            <Radio className="h-3.5 w-3.5 animate-pulse text-amber-200" />
          ) : isStreaming ? (
            <CircleDot className="h-3.5 w-3.5 animate-pulse text-emerald-300" />
          ) : (
            <CircleDot className="h-3.5 w-3.5 text-[var(--accent)]" />
          )}
          <span className="hidden xs:inline">{connectionLabel}</span>
        </span>
        <span className="hidden min-w-0 items-center gap-1.5 sm:inline-flex">
          <GitBranch className="h-3.5 w-3.5" />
          <span className="truncate">{groupName}</span>
        </span>
        <span className="hidden min-w-0 items-center gap-1.5 md:inline-flex">
          <Activity className="h-3.5 w-3.5" />
          <span className="truncate">{activeConversationTitle}</span>
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <span className="hidden items-center gap-1.5 rounded-md border border-white/8 px-1.5 py-0.5 md:inline-flex">
          <Zap className="h-3 w-3" />
          {runProfile.replace('_', ' ')}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-white/8 px-1.5 py-0.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
          {providerCount || 'local'} providers
        </span>
        <span className="hidden rounded-md border border-white/8 px-1.5 py-0.5 sm:inline">
          {activeTasks} active / {openTasks} open
        </span>
        {detached && (
          <span className="hidden items-center gap-1.5 rounded-md border border-[var(--accent)]/20 bg-[var(--accent)]/10 px-1.5 py-0.5 sm:inline-flex">
            <LayoutPanelTop className="h-3 w-3" />
            detached
          </span>
        )}
        <button
          type="button"
          onClick={onOpenWorkSurface}
          className="inline-flex h-6 items-center rounded-md px-1.5 transition hover:bg-white/8 hover:text-white"
        >
          Work
        </button>
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 transition hover:bg-white/8 hover:text-white"
          title={`Command palette (${formatShortcut(['mod', 'k'])})`}
        >
          <WifiOff className="hidden h-0 w-0" aria-hidden="true" />
          {formatShortcut(['mod', 'k'])}
        </button>
      </div>
    </footer>
  );
}
