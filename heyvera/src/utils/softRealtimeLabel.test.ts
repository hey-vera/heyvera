import { describe, expect, it } from 'vitest';
import {
  DM_BANNER_OFFLINE,
  DM_BANNER_POLL_FALLBACK,
  DM_BANNER_RECONNECTING,
  LIVE_WS_LABEL,
  OFFLINE_STATUS_LABEL,
  RECONNECTING_STATUS_LABEL,
  SOFT_POLL_STATUS_LABEL,
  dmConnectionBanner,
  formatSoftPollAge,
  resolveSoftRealtimeMode,
  softPollTooltip,
  softRealtimeLabel,
  softRealtimeTooltip,
} from './softRealtimeLabel';

describe('softRealtimeLabel', () => {
  it('exposes an honest poll (not WS) status label', () => {
    expect(SOFT_POLL_STATUS_LABEL.toLowerCase()).toContain('poll');
    expect(SOFT_POLL_STATUS_LABEL.toLowerCase()).not.toContain('websocket');
  });

  it('exposes a Live websocket label when connected', () => {
    expect(LIVE_WS_LABEL.toLowerCase()).toContain('websocket');
    expect(softRealtimeLabel({ wsConnected: true })).toBe(LIVE_WS_LABEL);
    expect(softRealtimeLabel({ wsConnected: false })).toBe(SOFT_POLL_STATUS_LABEL);
    expect(softRealtimeLabel({ mode: 'live' })).toBe(LIVE_WS_LABEL);
  });

  it('never says Live for offline or reconnecting', () => {
    expect(softRealtimeLabel({ mode: 'offline' })).toBe(OFFLINE_STATUS_LABEL);
    expect(softRealtimeLabel({ mode: 'reconnecting' })).toBe(RECONNECTING_STATUS_LABEL);
    expect(softRealtimeLabel({ offline: true, wsConnected: true })).toBe(OFFLINE_STATUS_LABEL);
    expect(softRealtimeLabel({ reconnecting: true, wsConnected: false })).toBe(
      RECONNECTING_STATUS_LABEL,
    );
    expect(softRealtimeLabel({ mode: 'offline' }).toLowerCase()).not.toContain('live');
    expect(softRealtimeLabel({ mode: 'reconnecting' }).toLowerCase()).not.toContain('live');
  });

  it('resolveSoftRealtimeMode priority: offline > live > reconnecting > poll', () => {
    expect(resolveSoftRealtimeMode({ offline: true, wsConnected: true })).toBe('offline');
    expect(resolveSoftRealtimeMode({ offline: false, wsConnected: true })).toBe('live');
    expect(
      resolveSoftRealtimeMode({ offline: false, wsConnected: false, reconnecting: true }),
    ).toBe('reconnecting');
    expect(
      resolveSoftRealtimeMode({ offline: false, wsConnected: false, reconnecting: false }),
    ).toBe('poll');
  });

  it('tooltip states not websocket for poll mode', () => {
    expect(softPollTooltip().toLowerCase()).toContain('not websocket');
    expect(softRealtimeTooltip({ wsConnected: false }).toLowerCase()).toContain('not websocket');
    expect(softRealtimeTooltip({ wsConnected: true }).toLowerCase()).toContain('websocket');
    expect(softRealtimeTooltip({ mode: 'offline' }).toLowerCase()).not.toContain('live (websocket)');
    expect(softRealtimeTooltip({ mode: 'reconnecting' }).toLowerCase()).toContain('not live');
  });

  it('formats soft-poll age from real timestamps', () => {
    const now = 1_700_000_060_000;
    expect(formatSoftPollAge(now - 2_000, now)).toBe('just now');
    expect(formatSoftPollAge(now - 12_000, now)).toBe('12s ago');
    expect(formatSoftPollAge(now - 120_000, now)).toBe('2m ago');
    expect(formatSoftPollAge(null, now)).toBeNull();
  });
});

describe('dmConnectionBanner', () => {
  it('offline banner is honest', () => {
    expect(dmConnectionBanner({ mode: 'offline' })).toBe(DM_BANNER_OFFLINE);
    expect(dmConnectionBanner({ mode: 'offline' })?.toLowerCase()).not.toContain('live');
  });

  it('clears banner when live or clean poll', () => {
    expect(dmConnectionBanner({ mode: 'live' })).toBeNull();
    expect(dmConnectionBanner({ mode: 'poll' })).toBeNull();
    expect(dmConnectionBanner({ mode: 'poll', pollActive: true })).toBeNull();
  });

  it('reconnecting with poll active prefers poll-fallback copy', () => {
    expect(dmConnectionBanner({ mode: 'reconnecting', pollActive: true })).toBe(
      DM_BANNER_POLL_FALLBACK,
    );
    expect(dmConnectionBanner({ mode: 'reconnecting', pollActive: false })).toBe(
      DM_BANNER_RECONNECTING,
    );
  });
});
