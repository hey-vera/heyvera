/** Honest soft-realtime label — not WebSocket. */
export const SOFT_POLL_STATUS_LABEL = 'Updating live (poll)';

/** True WebSocket connected (Wave 8b DMs). */
export const LIVE_WS_LABEL = 'Live (websocket)';

export function softPollTooltip(detail?: string): string {
  const base = 'Background poll while this tab is visible (not WebSocket)';
  return detail ? `${base}. ${detail}` : base;
}

export function liveWsTooltip(detail?: string): string {
  const base = 'Connected over WebSocket for this conversation';
  return detail ? `${base}. ${detail}` : base;
}

/** Pick status chrome label for soft-poll vs live WS. */
export function softRealtimeLabel(opts: { wsConnected: boolean }): string {
  return opts.wsConnected ? LIVE_WS_LABEL : SOFT_POLL_STATUS_LABEL;
}

export function softRealtimeTooltip(opts: {
  wsConnected: boolean;
  ageDetail?: string;
}): string {
  if (opts.wsConnected) return liveWsTooltip(opts.ageDetail);
  return softPollTooltip(opts.ageDetail);
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
