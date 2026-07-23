/**
 * Soft-launch integrity — honest metadata for Settings controls.
 *
 * Account: backed by GET/PATCH /v1/social/me/prefs (or real Clerk/billing actions).
 * Device:  localStorage only — label "This device".
 * None:    UI present but not persisted to account (badge / helper).
 */

export type SettingsPersist = 'account' | 'device' | 'none';

export type SettingsControlMeta = {
  persists: SettingsPersist;
  /** Short badge or helper suffix for the control row. */
  label: string;
};

export const DEVICE_PREFS_STORAGE_KEY = 'heyvera.devicePrefs';

const ACCOUNT_IDS = new Set([
  'profile-visibility',
  'protected-posts',
  'message-requests',
  'discoverability',
  'show-in-search',
  'allow-agent-dms',
  'allow-agent-mentions',
  // Real actions / managed systems (not silent theater)
  'manage-account',
  'manage-billing',
]);

/** Display / notification prefs that sensibly stay on this browser. */
const DEVICE_IDS = new Set([
  'push-notifications',
  'conversation-quality',
  'text-size',
  'timeline-density',
  'reduce-motion',
]);

const NONE_LABELS: Record<string, string> = {
  'two-factor': 'Managed in Clerk — use Manage account',
  'login-alerts': 'Not saved to account',
  'email-digest': 'Not saved to account',
  'premium-plan': 'See Premium page',
  'usage-alerts': 'Not saved to account',
  'ai-personalization': 'Not saved to account',
  'memory-retention': 'Not saved to account',
  'export-data': 'Coming soon',
  deactivate: 'Contact support',
};

const DEVICE_LABEL = 'This device';
const ACCOUNT_LABEL = 'Saved to account';
const NONE_DEFAULT_LABEL = 'Not saved to account';

/**
 * Map a Settings control id → persistence honesty metadata.
 * Unknown ids default to `none` so new theater cannot claim account save.
 */
export function settingsControlMeta(id: string): SettingsControlMeta {
  if (ACCOUNT_IDS.has(id)) {
    return { persists: 'account', label: ACCOUNT_LABEL };
  }
  if (DEVICE_IDS.has(id)) {
    return { persists: 'device', label: DEVICE_LABEL };
  }
  if (Object.prototype.hasOwnProperty.call(NONE_LABELS, id)) {
    return { persists: 'none', label: NONE_LABELS[id] };
  }
  return { persists: 'none', label: NONE_DEFAULT_LABEL };
}

export type DevicePrefs = {
  toggles: Record<string, boolean>;
  choices: Record<string, string>;
};

export function emptyDevicePrefs(): DevicePrefs {
  return { toggles: {}, choices: {} };
}

/** Read device prefs from a storage-like object (testable without DOM). */
export function readDevicePrefs(
  storage: Pick<Storage, 'getItem'> | null | undefined,
): DevicePrefs {
  if (!storage) return emptyDevicePrefs();
  try {
    const raw = storage.getItem(DEVICE_PREFS_STORAGE_KEY);
    if (!raw) return emptyDevicePrefs();
    const parsed = JSON.parse(raw) as Partial<DevicePrefs>;
    return {
      toggles:
        parsed.toggles && typeof parsed.toggles === 'object' ? { ...parsed.toggles } : {},
      choices:
        parsed.choices && typeof parsed.choices === 'object' ? { ...parsed.choices } : {},
    };
  } catch {
    return emptyDevicePrefs();
  }
}

/** Merge one toggle/choice into device prefs and write. */
export function writeDevicePref(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined,
  kind: 'toggle' | 'choice',
  id: string,
  value: boolean | string,
): DevicePrefs {
  const current = readDevicePrefs(storage);
  if (kind === 'toggle') {
    current.toggles[id] = Boolean(value);
  } else {
    current.choices[id] = String(value);
  }
  if (storage) {
    try {
      storage.setItem(DEVICE_PREFS_STORAGE_KEY, JSON.stringify(current));
    } catch {
      // quota / private mode — keep in-memory only
    }
  }
  return current;
}

/** Apply reduce-motion device pref to documentElement when available. */
export function applyReduceMotionPreference(enabled: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.reduceMotion = enabled ? 'true' : 'false';
}
