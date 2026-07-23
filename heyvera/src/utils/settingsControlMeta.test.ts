import { describe, expect, it } from 'vitest';
import {
  DEVICE_PREFS_STORAGE_KEY,
  emptyDevicePrefs,
  readDevicePrefs,
  settingsControlMeta,
  writeDevicePref,
} from './settingsControlMeta';

describe('settingsControlMeta', () => {
  it('marks privacy prefs as account-persisted', () => {
    for (const id of [
      'protected-posts',
      'discoverability',
      'show-in-search',
      'allow-agent-dms',
      'allow-agent-mentions',
      'profile-visibility',
      'message-requests',
    ]) {
      expect(settingsControlMeta(id)).toEqual({
        persists: 'account',
        label: 'Saved to account',
      });
    }
  });

  it('marks display / device notification controls as device-scoped', () => {
    for (const id of [
      'push-notifications',
      'conversation-quality',
      'text-size',
      'timeline-density',
      'reduce-motion',
    ]) {
      expect(settingsControlMeta(id)).toEqual({
        persists: 'device',
        label: 'This device',
      });
    }
  });

  it('labels non-persisted controls honestly', () => {
    expect(settingsControlMeta('two-factor').persists).toBe('none');
    expect(settingsControlMeta('two-factor').label).toMatch(/Clerk/i);
    expect(settingsControlMeta('login-alerts')).toEqual({
      persists: 'none',
      label: 'Not saved to account',
    });
    expect(settingsControlMeta('email-digest').persists).toBe('none');
    expect(settingsControlMeta('premium-plan').label).toMatch(/Premium/i);
    expect(settingsControlMeta('ai-personalization').persists).toBe('none');
    expect(settingsControlMeta('unknown-control').persists).toBe('none');
  });

  it('treats manage-account and manage-billing as real account systems', () => {
    expect(settingsControlMeta('manage-account').persists).toBe('account');
    expect(settingsControlMeta('manage-billing').persists).toBe('account');
  });
});

describe('device prefs storage helpers', () => {
  function memStorage(seed?: string): Storage {
    const map = new Map<string, string>();
    if (seed) map.set(DEVICE_PREFS_STORAGE_KEY, seed);
    return {
      get length() {
        return map.size;
      },
      clear() {
        map.clear();
      },
      getItem(k: string) {
        return map.has(k) ? map.get(k)! : null;
      },
      setItem(k: string, v: string) {
        map.set(k, v);
      },
      removeItem(k: string) {
        map.delete(k);
      },
      key() {
        return null;
      },
    };
  }

  it('returns empty when missing or invalid', () => {
    expect(readDevicePrefs(null)).toEqual(emptyDevicePrefs());
    expect(readDevicePrefs(memStorage())).toEqual(emptyDevicePrefs());
    expect(readDevicePrefs(memStorage('not-json'))).toEqual(emptyDevicePrefs());
  });

  it('round-trips toggles and choices', () => {
    const storage = memStorage();
    writeDevicePref(storage, 'toggle', 'reduce-motion', true);
    writeDevicePref(storage, 'choice', 'text-size', 'Large');
    const prefs = readDevicePrefs(storage);
    expect(prefs.toggles['reduce-motion']).toBe(true);
    expect(prefs.choices['text-size']).toBe('Large');
  });
});
