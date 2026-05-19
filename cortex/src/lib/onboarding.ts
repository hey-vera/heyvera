const STORAGE_KEY = 'cortex_onboarded';

export function isOnboarded(userId: string): boolean {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return false;
    const parsed = JSON.parse(data) as Record<string, boolean>;
    return parsed[userId] === true;
  } catch {
    return false;
  }
}

export function markOnboarded(userId: string): void {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    const parsed = data ? (JSON.parse(data) as Record<string, boolean>) : {};
    parsed[userId] = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // storage unavailable
  }
}

export function resetOnboarding(userId: string): void {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return;
    const parsed = JSON.parse(data) as Record<string, boolean>;
    delete parsed[userId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // storage unavailable
  }
}
