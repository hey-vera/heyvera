import { describe, expect, it } from 'vitest';
import {
  accessStateLabel,
  formatAccessPlanLabel,
  isPremiumAccess,
  normalizeAccessState,
} from './accessState';

describe('normalizeAccessState', () => {
  it('maps known snake_case server values', () => {
    expect(normalizeAccessState('active')).toBe('active');
    expect(normalizeAccessState('trial_active')).toBe('trial_active');
    expect(normalizeAccessState('needs_checkout')).toBe('needs_checkout');
    expect(normalizeAccessState('payment_failed')).toBe('payment_failed');
    expect(normalizeAccessState('cancelled')).toBe('cancelled');
    expect(normalizeAccessState('signed_out')).toBe('signed_out');
    expect(normalizeAccessState('needs_phone')).toBe('needs_phone');
  });

  it('accepts honest aliases only', () => {
    expect(normalizeAccessState('trialing')).toBe('trial_active');
    expect(normalizeAccessState('trial')).toBe('trial_active');
    expect(normalizeAccessState('past_due')).toBe('payment_failed');
    expect(normalizeAccessState('canceled')).toBe('cancelled');
    expect(normalizeAccessState('Trial Active')).toBe('trial_active');
  });

  it('never invents active/premium from empty or marketing labels', () => {
    expect(normalizeAccessState(undefined)).toBe('unknown');
    expect(normalizeAccessState(null)).toBe('unknown');
    expect(normalizeAccessState('')).toBe('unknown');
    expect(normalizeAccessState('premium')).toBe('unknown');
    expect(normalizeAccessState('Premium')).toBe('unknown');
    expect(normalizeAccessState('subscribed')).toBe('unknown');
    expect(normalizeAccessState('yes')).toBe('unknown');
  });
});

describe('isPremiumAccess', () => {
  it('is true only for active and trial_active', () => {
    expect(isPremiumAccess('active')).toBe(true);
    expect(isPremiumAccess('trial_active')).toBe(true);
    expect(isPremiumAccess('trialing')).toBe(true);
    expect(isPremiumAccess('needs_checkout')).toBe(false);
    expect(isPremiumAccess('payment_failed')).toBe(false);
    expect(isPremiumAccess('cancelled')).toBe(false);
    expect(isPremiumAccess('premium')).toBe(false);
    expect(isPremiumAccess(undefined)).toBe(false);
    expect(isPremiumAccess('')).toBe(false);
  });
});

describe('accessStateLabel + formatAccessPlanLabel', () => {
  it('labels access honestly', () => {
    expect(accessStateLabel('active')).toBe('Active');
    expect(accessStateLabel('trial_active')).toBe('Trial active');
    expect(accessStateLabel('needs_checkout')).toBe('Needs checkout');
    expect(accessStateLabel('premium')).toBe('Unknown');
  });

  it('formatAccessPlanLabel never invents Premium when inactive', () => {
    expect(
      formatAccessPlanLabel({ accessState: 'needs_checkout', planType: null }),
    ).toBe('Needs checkout');
    expect(formatAccessPlanLabel({ accessState: undefined })).toBe(
      'No active subscription',
    );
    expect(
      formatAccessPlanLabel({
        accessState: 'active',
        planType: 'monthly',
      }),
    ).toBe('monthly · Active');
    expect(
      formatAccessPlanLabel({
        accessState: 'trial_active',
        planType: 'annual',
      }),
    ).toBe('annual · Trial active');
    // Explicit active:false wins over a stale plan type.
    expect(
      formatAccessPlanLabel({
        accessState: 'cancelled',
        planType: 'monthly',
        active: false,
      }),
    ).toBe('Cancelled');
  });
});
