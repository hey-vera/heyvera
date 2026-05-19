import { ChevronDown, Dot, Wifi } from 'lucide-react';
import type { ChatProject } from '../../types';

interface ChatHeaderProps {
  project: ChatProject;
}

export default function ChatHeader({ project }: ChatHeaderProps) {
  return (
    <header className="flex items-center justify-between gap-3 py-2">
      <button
        type="button"
        className="flex min-w-0 items-center gap-3 rounded-full border border-white/8 bg-white/4 px-3 py-2 text-left transition hover:bg-white/6"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent-soft)] text-sm font-semibold text-white">
          {project.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-white">{project.name}</div>
          <div className="flex items-center gap-1 text-xs text-[var(--muted)]">
            <Wifi className="h-3.5 w-3.5" />
            {project.environment}
            <Dot className="h-3.5 w-3.5" />
            {project.connectionStatus}
          </div>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-[var(--muted)]" />
      </button>
      <div className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200">
        Connected
      </div>
    </header>
  );
}
