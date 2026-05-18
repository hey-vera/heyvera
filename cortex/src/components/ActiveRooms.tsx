import type { RoomsState } from '../types';

export default function ActiveRooms({ data }: { data: RoomsState | null }) {
  if (!data) {
    return (
      <div className="bg-neutral-900 rounded-lg p-6 border border-neutral-800">
        <h2 className="text-lg font-semibold text-white mb-4">Active Rooms</h2>
        <p className="text-neutral-500 text-sm">Waiting for state data...</p>
      </div>
    );
  }

  const active = data.rooms.filter((r) => r.status === 'active');
  const closed = data.rooms.filter((r) => r.status === 'closed');

  return (
    <div className="bg-neutral-900 rounded-lg p-6 border border-neutral-800">
      <h2 className="text-lg font-semibold text-white mb-4">
        Active Rooms
        {active.length > 0 && (
          <span className="ml-2 text-sm font-normal text-green-400">{active.length} active</span>
        )}
      </h2>

      {data.rooms.length === 0 ? (
        <p className="text-neutral-500 text-sm">No rooms.</p>
      ) : (
        <div className="space-y-2">
          {active.map((r) => (
            <div key={r.id} className="bg-neutral-800 rounded px-3 py-2 border border-neutral-700">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-white text-sm">{r.project}</span>
                  <span className="text-neutral-500 text-xs ml-2 font-mono">{r.id.slice(0, 8)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-neutral-400 text-xs">{r.workerCount} workers</span>
                  <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                </div>
              </div>
            </div>
          ))}
          {closed.slice(0, 5).map((r) => (
            <div key={r.id} className="bg-neutral-800/50 rounded px-3 py-2 border border-neutral-800 opacity-60">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-neutral-400 text-sm">{r.project}</span>
                  <span className="text-neutral-600 text-xs ml-2 font-mono">{r.id.slice(0, 8)}</span>
                </div>
                <span className="text-neutral-500 text-xs">closed</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
