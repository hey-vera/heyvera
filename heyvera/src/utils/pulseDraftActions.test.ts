import { describe, expect, it } from 'vitest';
import {
  allowedPulseDraftActions,
  canPulseDraftAction,
  pulseDraftActionLabel,
  pulseTransitionErrorMessage,
} from './pulseDraftActions';
import { PulseApiError } from '../api/pulse';

describe('allowedPulseDraftActions', () => {
  it('pending allows approve, approveAndPublish, reject only', () => {
    expect(allowedPulseDraftActions('pending').sort()).toEqual(
      ['approve', 'approveAndPublish', 'reject'].sort(),
    );
    expect(canPulseDraftAction('pending', 'publish')).toBe(false);
    expect(canPulseDraftAction('pending', 'schedule')).toBe(false);
  });

  it('approved allows publish, reject, schedule', () => {
    expect(allowedPulseDraftActions('approved').sort()).toEqual(
      ['publish', 'reject', 'schedule'].sort(),
    );
    expect(canPulseDraftAction('approved', 'approve')).toBe(false);
  });

  it('published and rejected allow no actions', () => {
    expect(allowedPulseDraftActions('published')).toEqual([]);
    expect(allowedPulseDraftActions('rejected')).toEqual([]);
  });

  it('unknown status allows nothing', () => {
    expect(allowedPulseDraftActions('weird')).toEqual([]);
  });
});

describe('pulseDraftActionLabel', () => {
  it('uses honest Approve only vs Approve & publish labels', () => {
    expect(pulseDraftActionLabel('approve')).toBe('Approve only');
    expect(pulseDraftActionLabel('approveAndPublish')).toBe('Approve & publish');
    expect(pulseDraftActionLabel('publish')).toBe('Publish now');
    expect(pulseDraftActionLabel('reject')).toBe('Reject');
  });
});

describe('pulseTransitionErrorMessage', () => {
  it('surfaces 409 ILLEGAL_TRANSITION from PulseApiError', () => {
    const err = new PulseApiError(
      "Illegal draft transition: published → approved",
      409,
      'ILLEGAL_TRANSITION',
    );
    const msg = pulseTransitionErrorMessage(err, err.status);
    expect(msg).toContain('Illegal draft transition');
  });

  it('uses honest fallback for empty 409', () => {
    const msg = pulseTransitionErrorMessage('', 409);
    expect(msg.toLowerCase()).toMatch(/not allowed|status/);
  });

  it('passes through non-transition errors', () => {
    expect(pulseTransitionErrorMessage(new Error('network down'))).toBe('network down');
  });
});
