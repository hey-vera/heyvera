import type { Decision, Outcome } from '../types';

type FeedItem =
  | { kind: 'decision'; ts: number; data: Decision }
  | { kind: 'outcome'; ts: number; data: Outcome };

function tierBadge(tier: string) {
  const colors: Record<string, string> = {
    search: 'bg-blue-900 text-blue-300',
    execute: 'bg-purple-900 text-purple-300',
    think: 'bg-amber-900 text-amber-300',
  };
  return colors[tier] ?? 'bg-neutral-700 text-neutral-300';
}

export default function LiveFeed({ decisions, outcomes }: { decisions: Decision[]; outcomes: Outcome[] }) {
  const items: FeedItem[] = [
    ...decisions.map((d) => ({ kind: 'decision' as const, ts: new Date(d.timestamp).getTime(), data: d })),
    ...outcomes.map((o) => ({ kind: 'outcome' as const, ts: new Date(o.timestamp).getTime(), data: o })),
  ].sort((a, b) => b.ts - a.ts).slice(0, 20);

  return (
    <div className="bg-neutral-900 rounded-lg p-6 border border-neutral-800">
      <h2 className="text-lg font-semibold text-white mb-4">Live Feed</h2>
      {items.length === 0 ? (
        <p className="text-neutral-500 text-sm">No activity yet.</p>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {items.map((item, i) => {
            if (item.kind === 'decision') {
              const d = item.data;
              return (
                <div key={`d-${i}`} className="bg-neutral-800 rounded px-3 py-2 border-l-2 border-blue-500">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${tierBadge(d.tier)}`}>{d.tier}</span>
                    <span className="text-white text-sm">{d.model}</span>
                    <span className="text-neutral-500 text-xs">{d.provider}</span>
                    {d.explored && <span className="text-xs text-cyan-400">explore</span>}
                  </div>
                  <p className="text-neutral-400 text-xs truncate">{d.promptSummary}</p>
                  <p className="text-neutral-500 text-xs mt-1">{d.reason}</p>
                </div>
              );
            }
            const o = item.data;
            return (
              <div key={`o-${i}`} className={`bg-neutral-800 rounded px-3 py-2 border-l-2 ${o.success ? 'border-green-500' : 'border-red-500'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${o.success ? 'text-green-400' : 'text-red-400'}`}>
                      {o.success ? 'PASS' : 'FAIL'}
                    </span>
                    <span className="text-white text-sm">{o.model}</span>
                    <span className="text-neutral-500 text-xs">{o.provider}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-neutral-400">
                    <span>score: {o.score.toFixed(2)}</span>
                    <span>{(o.durationMs / 1000).toFixed(1)}s</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
