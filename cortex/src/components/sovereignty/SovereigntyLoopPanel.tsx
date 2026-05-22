import { BrainCircuit, KeyRound, Route, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import type { ChatSessionControls, RunProfile } from '../../types';
import type { CortexGroup } from '../../lib/groups';
import {
  recordRoutingPreference,
  recommendRoute,
  synthesizeContext,
} from '../../lib/sovereignty';

interface SovereigntyLoopPanelProps {
  draft: string;
  group: CortexGroup;
  userId: string;
  signedIn: boolean;
  controls: ChatSessionControls;
  runProfile: RunProfile;
  onControlsChange: (next: ChatSessionControls) => void;
  onRunProfileChange: (next: RunProfile) => void;
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

export default function SovereigntyLoopPanel({
  draft,
  group,
  userId,
  signedIn,
  controls,
  runProfile,
  onControlsChange,
  onRunProfileChange,
}: SovereigntyLoopPanelProps) {
  const prompt = draft.trim() || 'New Cortex coding session';
  const context = synthesizeContext(prompt, group, controls);
  const route = recommendRoute(prompt, controls, runProfile);
  const credentialMode = signedIn ? 'Delegated user session' : 'Local preview only';

  function preferQuality() {
    recordRoutingPreference('quality');
    onRunProfileChange('quality_first');
    onControlsChange({ ...controls, intelligence: 'deep' });
  }

  function preferCost() {
    recordRoutingPreference('cost');
    onRunProfileChange('cost_saver');
    onControlsChange({ ...controls, speed: 'rapid', intelligence: 'focused' });
  }

  function requireManual() {
    recordRoutingPreference('manual');
    onControlsChange({ ...controls, autonomy: 'manual' });
  }

  return (
    <section className="border-t border-white/6 px-3 py-3 sm:px-4">
      <div className="mx-auto grid w-full max-w-3xl gap-2 lg:grid-cols-3">
        <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5">
          <div className="mb-2 flex items-center gap-2">
            <BrainCircuit className="h-3.5 w-3.5 text-[var(--accent)]" />
            <h2 className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
              Context
            </h2>
          </div>
          <p className="text-sm font-medium text-white">{context.gene.title}</p>
          <div className="mt-2 space-y-1">
            {context.liveRepo.signals.slice(0, 3).map((signal) => (
              <p key={signal} className="truncate text-xs text-[var(--muted)]">{signal}</p>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--accent)]/20 bg-[var(--accent)]/10 px-3 py-2.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2">
              <Route className="h-3.5 w-3.5 text-[var(--accent)]" />
              <h2 className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
                Route
              </h2>
            </span>
            <span className="rounded-full border border-white/10 bg-black/15 px-2 py-0.5 text-[10px] text-[var(--muted-strong)]">
              {pct(route.confidence)}
            </span>
          </div>
          <p className="truncate text-sm font-medium text-white">{route.provider}</p>
          <p className="mt-1 truncate text-xs text-[var(--muted-strong)]">
            {route.model} · {route.mode}
          </p>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--muted)]">
            {route.rationale.join(', ')}
          </p>
        </div>

        <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5">
          <div className="mb-2 flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-[var(--accent)]" />
            <h2 className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
              Boundary
            </h2>
          </div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-white">
            <KeyRound className="h-3.5 w-3.5 text-[var(--muted)]" />
            {credentialMode}
          </p>
          <p className="mt-1 truncate text-xs text-[var(--muted)]">{userId}</p>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--muted)]">
            Session receipts: context, route, boundary.
          </p>
        </div>
      </div>

      <div className="mx-auto mt-2 flex w-full max-w-3xl flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)]">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Steer this chat
        </span>
        <button
          type="button"
          onClick={preferQuality}
          className="rounded-lg border border-white/8 bg-white/[0.03] px-2.5 py-1.5 text-xs text-[var(--muted-strong)] transition hover:bg-white/6 hover:text-white active:scale-95"
        >
          Prefer quality
        </button>
        <button
          type="button"
          onClick={preferCost}
          className="rounded-lg border border-white/8 bg-white/[0.03] px-2.5 py-1.5 text-xs text-[var(--muted-strong)] transition hover:bg-white/6 hover:text-white active:scale-95"
        >
          Prefer speed/cost
        </button>
        <button
          type="button"
          onClick={requireManual}
          className="rounded-lg border border-white/8 bg-white/[0.03] px-2.5 py-1.5 text-xs text-[var(--muted-strong)] transition hover:bg-white/6 hover:text-white active:scale-95"
        >
          Require approval
        </button>
      </div>
    </section>
  );
}
