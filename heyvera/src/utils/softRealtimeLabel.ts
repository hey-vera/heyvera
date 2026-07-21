/** Honest soft-realtime label — not WebSocket. */
export const SOFT_POLL_STATUS_LABEL = 'Updating live (poll)';

export function softPollTooltip(detail?: string): string {
  const base = 'Background poll while this tab is visible (not WebSocket)';
  return detail ? `${base}. ${detail}` : base;
}

/** Format last successful soft-poll time for status chrome. */
export function formatSoftPollAge(lastUpdatedAtMs: number | null, nowMs = Date.now()): string | null {
  if (lastUpdatedAtMs == null || !Number.isFinite(lastUpdatedAtMs)) return null;
  const ageSec = Math.max(0, Math.floor((nowMs - lastUpdatedAtMs) / 1000));
  if (ageSec < 5) return 'just now';
  if (ageSec < 60) return `${ageSec}s ago`;
  const ageMin = Math.floor(ageSec / 60);
  if (ageMin < 60) return `${ageMin}m ago`;
  return `${Math.floor(ageMin / 60)}h ago`;
}
