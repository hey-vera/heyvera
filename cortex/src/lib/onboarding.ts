const ONBOARDING_KEY_PREFIX = 'cortex:onboarding-complete:';

export function isOnboardingComplete(userId: string): boolean {
  try {
    return window.localStorage.getItem(`${ONBOARDING_KEY_PREFIX}${userId}`) !== 'false';
  } catch {
    return true;
  }
}

export function markOnboardingComplete(userId: string): void {
  try {
    window.localStorage.setItem(`${ONBOARDING_KEY_PREFIX}${userId}`, 'true');
  } catch {
    // Onboarding should not block the app if local storage is unavailable.
  }
}
