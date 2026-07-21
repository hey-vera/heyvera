import { describe, expect, it } from 'vitest';
import {
  SOFT_POLL_STATUS_LABEL,
  formatSoftPollAge,
  softPollTooltip,
} from './softRealtimeLabel';

describe('softRealtimeLabel', () => {
  it('exposes an honest poll (not WS) status label', () => {
    expect(SOFT_POLL_STATUS_LABEL.toLowerCase()).toContain('poll');
    expect(SOFT_POLL_STATUS_LABEL.toLowerCase()).not.toContain('websocket');
  });

  it('tooltip states not websocket', () => {
    expect(softPollTooltip().toLowerCase()).toContain('not websocket');
  });

  it('formats soft-poll age from real timestamps', () => {
    const now = 1_700_000_060_000;
    expect(formatSoftPollAge(now - 2_000, now)).toBe('just now');
    expect(formatSoftPollAge(now - 12_000, now)).toBe('12s ago');
    expect(formatSoftPollAge(now - 120_000, now)).toBe('2m ago');
    expect(formatSoftPollAge(null, now)).toBeNull();
  });
});
