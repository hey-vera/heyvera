import type { Outcome } from '../types';

export default function PerformanceChart({ outcomes }: { outcomes: Outcome[] }) {
  if (outcomes.length === 0) {
    return (
      <div className="bg-neutral-900 rounded-lg p-6 border border-neutral-800">
        <h2 className="text-lg font-semibold text-white mb-4">Performance</h2>
        <p className="text-neutral-500 text-sm">No outcome data yet.</p>
      </div>
    );
  }

  const sorted = [...outcomes].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const last50 = sorted.slice(-50);

  const successRate = outcomes.filter((o) => o.success).length / outcomes.length;
  const avgScore = outcomes.reduce((s, o) => s + o.score, 0) / outcomes.length;
  const avgDuration = outcomes.reduce((s, o) => s + o.durationMs, 0) / outcomes.length;

  const chartHeight = 80;
  const barWidth = Math.max(4, Math.floor(500 / last50.length) - 1);

  return (
    <div className="bg-neutral-900 rounded-lg p-6 border border-neutral-800">
      <h2 className="text-lg font-semibold text-white mb-4">Performance</h2>

      <div className="grid grid-cols-3 gap-4 mb-4 text-center">
        <div>
          <p className={`text-xl font-bold ${successRate >= 0.8 ? 'text-green-400' : successRate >= 0.5 ? 'text-yellow-400' : 'text-red-400'}`}>
            {Math.round(successRate * 100)}%
          </p>
          <p className="text-xs text-neutral-500">success rate</p>
        </div>
        <div>
          <p className="text-xl font-bold text-white">{avgScore.toFixed(2)}</p>
          <p className="text-xs text-neutral-500">avg score</p>
        </div>
        <div>
          <p className="text-xl font-bold text-white">{(avgDuration / 1000).toFixed(1)}s</p>
          <p className="text-xs text-neutral-500">avg duration</p>
        </div>
      </div>

      <div className="bg-neutral-800 rounded p-3">
        <svg width="100%" height={chartHeight} viewBox={`0 0 ${last50.length * (barWidth + 1)} ${chartHeight}`} preserveAspectRatio="none">
          {last50.map((o, i) => {
            const h = o.score * chartHeight;
            return (
              <rect
                key={i}
                x={i * (barWidth + 1)}
                y={chartHeight - h}
                width={barWidth}
                height={h}
                rx={1}
                fill={o.success ? '#4ade80' : '#f87171'}
                opacity={0.8}
              />
            );
          })}
        </svg>
        <div className="flex justify-between text-xs text-neutral-500 mt-1">
          <span>oldest</span>
          <span>latest ({last50.length} outcomes)</span>
        </div>
      </div>
    </div>
  );
}
