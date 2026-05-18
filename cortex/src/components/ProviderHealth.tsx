import type { ProvidersState } from '../types';

function scoreColor(score: number): string {
  if (score >= 0.8) return 'text-green-400';
  if (score >= 0.5) return 'text-yellow-400';
  return 'text-red-400';
}

function scoreBg(score: number): string {
  if (score >= 0.8) return 'bg-green-400';
  if (score >= 0.5) return 'bg-yellow-400';
  return 'bg-red-400';
}

export default function ProviderHealth({ data }: { data: ProvidersState | null }) {
  if (!data) {
    return (
      <div className="bg-neutral-900 rounded-lg p-6 border border-neutral-800">
        <h2 className="text-lg font-semibold text-white mb-4">Provider Health</h2>
        <p className="text-neutral-500 text-sm">Waiting for state data...</p>
      </div>
    );
  }

  const providers = Object.entries(data.providers);
  const now = new Date(data.timestamp).getTime();

  return (
    <div className="bg-neutral-900 rounded-lg p-6 border border-neutral-800">
      <h2 className="text-lg font-semibold text-white mb-4">Provider Health</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {providers.map(([name, info]) => {
          const inCooldown = info.cooldownUntil && info.cooldownUntil > now;
          return (
            <div key={name} className="bg-neutral-800 rounded-lg p-4 border border-neutral-700">
              <div className="flex items-center justify-between mb-3">
                <span className="text-white font-medium capitalize">{name}</span>
                <span className={`text-2xl font-bold ${scoreColor(info.score)}`}>
                  {Math.round(info.score * 100)}%
                </span>
              </div>
              <div className="w-full bg-neutral-700 rounded-full h-2 mb-3">
                <div
                  className={`h-2 rounded-full transition-all ${scoreBg(info.score)}`}
                  style={{ width: `${info.score * 100}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-neutral-400">
                <span>{info.dispatchCount} dispatches</span>
                {info.degraded && <span className="text-yellow-400">Degraded</span>}
                {inCooldown && <span className="text-red-400">Cooldown</span>}
              </div>
              {info.lastError && (
                <p className="mt-2 text-xs text-red-400 truncate">{info.lastError}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
