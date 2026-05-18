import type { RoutingState } from '../types';

function emaColor(ema: number): string {
  if (ema >= 0.8) return 'text-green-400';
  if (ema >= 0.5) return 'text-yellow-400';
  return 'text-red-400';
}

export default function RoutingIntel({ data }: { data: RoutingState | null }) {
  if (!data) {
    return (
      <div className="bg-neutral-900 rounded-lg p-6 border border-neutral-800">
        <h2 className="text-lg font-semibold text-white mb-4">Routing Intelligence</h2>
        <p className="text-neutral-500 text-sm">Waiting for state data...</p>
      </div>
    );
  }

  return (
    <div className="bg-neutral-900 rounded-lg p-6 border border-neutral-800">
      <h2 className="text-lg font-semibold text-white mb-4">Routing Intelligence</h2>
      <p className="text-xs text-neutral-400 mb-4">{data.totalObservations} total observations</p>

      {data.topPerformers.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-medium text-neutral-300 mb-2">Top Performers</h3>
          <div className="space-y-2">
            {data.topPerformers.slice(0, 5).map((p, i) => (
              <div key={i} className="flex items-center justify-between bg-neutral-800 rounded px-3 py-2">
                <div>
                  <span className="text-white text-sm">{p.model}</span>
                  <span className="text-neutral-500 text-xs ml-2">{p.cell}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-neutral-400 text-xs">{p.observations} obs</span>
                  <span className={`font-mono text-sm font-bold ${emaColor(p.ema)}`}>
                    {p.ema.toFixed(3)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.worstPerformers.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-neutral-300 mb-2">Underperformers</h3>
          <div className="space-y-2">
            {data.worstPerformers.slice(0, 3).map((p, i) => (
              <div key={i} className="flex items-center justify-between bg-neutral-800 rounded px-3 py-2">
                <div>
                  <span className="text-white text-sm">{p.model}</span>
                  <span className="text-neutral-500 text-xs ml-2">{p.cell}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-neutral-400 text-xs">{p.observations} obs</span>
                  <span className={`font-mono text-sm font-bold ${emaColor(p.ema)}`}>
                    {p.ema.toFixed(3)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
