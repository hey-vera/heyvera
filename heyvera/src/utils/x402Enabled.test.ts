import { describe, expect, it } from 'vitest';
import {
  X402_DISABLED_NOTE,
  X402_FACILITATOR_NOTE,
  X402_SHAPE_ONLY_NOTE,
  formatX402PaidPingResult,
  isX402Enabled,
  showX402PaidAction,
  x402ModeLabel,
} from './x402Enabled';

describe('isX402Enabled (12c/14m)', () => {
  it('defaults off for null/undefined/empty', () => {
    expect(isX402Enabled(undefined)).toBe(false);
    expect(isX402Enabled(null)).toBe(false);
    expect(isX402Enabled('')).toBe(false);
    expect(isX402Enabled('0')).toBe(false);
    expect(isX402Enabled('true')).toBe(false);
    const emptyBag: { X402_ENABLED?: string | null } = Object.create(null);
    expect(isX402Enabled(emptyBag)).toBe(false);
    expect(isX402Enabled({ X402_ENABLED: 'true' })).toBe(false);
    expect(isX402Enabled({ X402_ENABLED: null })).toBe(false);
  });

  it('enabled only when exactly "1"', () => {
    expect(isX402Enabled('1')).toBe(true);
    expect(isX402Enabled({ X402_ENABLED: '1' })).toBe(true);
  });

  it('honesty copy never claims live payments', () => {
    expect(X402_DISABLED_NOTE.toLowerCase()).toMatch(/off|no settlement|no live/);
    expect(X402_SHAPE_ONLY_NOTE.toLowerCase()).toMatch(
      /shape_only|shape-only|pending|not facilitator/,
    );
    expect(X402_FACILITATOR_NOTE.toLowerCase()).toMatch(/facilitator|private keys/);
    expect(X402_DISABLED_NOTE.toLowerCase()).not.toContain('facilitator live');
    expect(X402_SHAPE_ONLY_NOTE.toLowerCase()).not.toContain('settlement complete');
  });

  it('x402ModeLabel maps server modes', () => {
    expect(x402ModeLabel({ enabled: false, mode: 'disabled' })).toBe('Disabled');
    expect(x402ModeLabel({ enabled: true, mode: 'shape_only' })).toBe('Shape-only');
    expect(x402ModeLabel({ enabled: true, mode: 'facilitator' })).toBe('Facilitator');
    expect(x402ModeLabel({ enabled: true })).toBe('Enabled (shape-only)');
    expect(x402ModeLabel(null)).toBe('Unknown');
  });
});

describe('Wave 14o paid action UI helpers', () => {
  it('showX402PaidAction only when enabled', () => {
    expect(showX402PaidAction(null)).toBe(false);
    expect(showX402PaidAction({ enabled: false, mode: 'disabled' })).toBe(false);
    expect(showX402PaidAction({ enabled: true, mode: 'shape_only' })).toBe(true);
    expect(showX402PaidAction({ enabled: true, mode: 'facilitator' })).toBe(true);
    expect(showX402PaidAction({ mode: 'shape_only' })).toBe(true);
    expect(showX402PaidAction({ mode: 'disabled' })).toBe(false);
  });

  it('formatX402PaidPingResult is honest about settlement', () => {
    expect(
      formatX402PaidPingResult({
        ok: true,
        settled: false,
        mode: 'shape_only',
        receiptId: 'x402_1',
      }),
    ).toMatch(/not settled \(shape_only\)/);
    expect(
      formatX402PaidPingResult({
        ok: true,
        settled: true,
        mode: 'facilitator',
        receiptId: 'x402_2',
      }),
    ).toMatch(/settled/);
    expect(
      formatX402PaidPingResult({
        ok: false,
        reason: 'payment not verified',
        mode: 'facilitator',
      }),
    ).toMatch(/Failed: payment not verified/);
  });
});
