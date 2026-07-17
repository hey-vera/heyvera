import { useEffect, useRef } from 'react';
import { startVisibilityPoll } from '../utils/visibilityPoll';

/**
 * React wrapper around {@link startVisibilityPoll}.
 * Calls `callback` on `intervalMs` while the document is visible and `enabled` is true.
 * Cleans up on unmount or when deps change.
 */
export function useVisibilityPoll(
  callback: () => void,
  intervalMs: number,
  enabled: boolean,
  options?: { runOnStart?: boolean; runOnVisible?: boolean },
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const runOnStart = options?.runOnStart ?? false;
  const runOnVisible = options?.runOnVisible ?? true;

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;

    return startVisibilityPoll(() => {
      callbackRef.current();
    }, {
      intervalMs,
      runOnStart,
      runOnVisible,
    });
  }, [enabled, intervalMs, runOnStart, runOnVisible]);
}
