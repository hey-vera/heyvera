/**
 * Honest soft-realtime status chrome for DM / soft-poll surfaces.
 * Never claim "Live" unless the WebSocket is actually open.
 */

/** Soft-poll transport (not WebSocket). */
export const SOFT_POLL_STATUS_LABEL = 'Updating live (poll)';

/** True WebSocket connected (Wave 8b+ DMs). */
export const LIVE_WS_LABEL = 'Live (websocket)';

/** Browser / network offline — never "Live". */
export const OFFLINE_STATUS_LABEL = 'Offline';

/** WS reconnect in progress — never "Live". */
export const RECONNECTING_STATUS_LABEL = 'Reconnecting…';

/** Scoped Messages banner copy (Wave 9b). */
export const DM_BANNER_OFFLINE =
  "You're offline — messages will resume when you're back.";
export const DM_BANNER_POLL_FALLBACK = 'Connection lost — updating via poll.';
export const DM_BANNER_RECONNECTING = 'Reconnecting…';

/**
 * Connection modes for DM status chrome.
 * - live: WebSocket open
 * - poll: soft-poll is the active transport
 * - reconnecting: WS closed / connecting with backoff
 * - offline: navigator.onLine === false
 */
export type SoftRealtimeMode = 'offline' | 'reconnecting' | 'poll' | 'live';

export type SoftRealtimeLabelOpts = {
  /** Preferred explicit mode. */
  mode?: SoftRealtimeMode;
  /**
   * Legacy / convenience flags (ignored when `mode` is set).
   * Priority: offline > wsConnected (live) > reconnecting > poll.
   */
  offline?: boolean;
  wsConnected?: boolean;
  reconnecting?: boolean;
};

/** Resolve mode from flags. Offline always wins; live only when WS open. */
export function resolveSoftRealtimeMode(opts: {
  offline?: boolean;
  wsConnected?: boolean;
  reconnecting?: boolean;
}): SoftRealtimeMode {
  if (opts.offline) return 'offline';
  if (opts.wsConnected) return 'live';
  if (opts.reconnecting) return 'reconnecting';
  return 'poll';
}

function modeFromOpts(opts: SoftRealtimeLabelOpts): SoftRealtimeMode {
  if (opts.mode) return opts.mode;
  return resolveSoftRealtimeMode({
    offline: opts.offline,
    wsConnected: opts.wsConnected,
    reconnecting: opts.reconnecting,
  });
}

/** Pick status chrome label for soft-poll vs live WS vs offline/reconnect. */
export function softRealtimeLabel(opts: SoftRealtimeLabelOpts): string {
  const mode = modeFromOpts(opts);
  switch (mode) {
    case 'live':
      return LIVE_WS_LABEL;
    case 'offline':
      return OFFLINE_STATUS_LABEL;
    case 'reconnecting':
      return RECONNECTING_STATUS_LABEL;
    case 'poll':
    default:
      return SOFT_POLL_STATUS_LABEL;
  }
}

export function softPollTooltip(detail?: string): string {
  const base = 'Background poll while this tab is visible (not WebSocket)';
  return detail ? `${base}. ${detail}` : base;
}

export function liveWsTooltip(detail?: string): string {
  const base = 'Connected over WebSocket for this conversation';
  return detail ? `${base}. ${detail}` : base;
}

export function offlineTooltip(detail?: string): string {
  const base = 'No network connection — messages will resume when you are back online';
  return detail ? `${base}. ${detail}` : base;
}

export function reconnectingTooltip(detail?: string): string {
  const base = 'WebSocket disconnected — reconnecting (not live)';
  return detail ? `${base}. ${detail}` : base;
}

export function softRealtimeTooltip(
  opts: SoftRealtimeLabelOpts & { ageDetail?: string },
): string {
  const mode = modeFromOpts(opts);
  switch (mode) {
    case 'live':
      return liveWsTooltip(opts.ageDetail);
    case 'offline':
      return offlineTooltip(opts.ageDetail);
    case 'reconnecting':
      return reconnectingTooltip(opts.ageDetail);
    case 'poll':
    default:
      return softPollTooltip(opts.ageDetail);
  }
}

/**
 * Scoped connection banner under Messages header.
 * Clear when live or clean poll with no error.
 * When reconnecting with poll active, prefer poll-fallback copy.
 */
export function dmConnectionBanner(opts: {
  mode: SoftRealtimeMode;
  /** True when soft-poll is actively refreshing messages/list. */
  pollActive?: boolean;
}): string | null {
  switch (opts.mode) {
    case 'offline':
      return DM_BANNER_OFFLINE;
    case 'live':
      return null;
    case 'poll':
      // Clean poll — no error banner.
      return null;
    case 'reconnecting':
      if (opts.pollActive) return DM_BANNER_POLL_FALLBACK;
      return DM_BANNER_RECONNECTING;
    default:
      return null;
  }
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
