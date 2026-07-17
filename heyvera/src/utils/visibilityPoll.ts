/**
 * Soft-realtime helper: run a callback on an interval only while the page is visible.
 * Pauses when `document.visibilityState` is `hidden` (no wasted polls); resumes on visible.
 * Returns a dispose function — always call on unmount.
 *
 * Honest intermediate before full websockets/SSE (see docs/OPS-TOPOLOGY.md).
 */

export type VisibilityPollOptions = {
  /** Interval between ticks while the document is visible. */
  intervalMs: number;
  /** Invoke once immediately when the poll starts (default false). */
  runOnStart?: boolean;
  /** Invoke immediately when the tab becomes visible again (default true). */
  runOnVisible?: boolean;
};

/**
 * Schedule `callback` on an interval only while `document.visibilityState === 'visible'`.
 * Clears the interval when the tab is hidden; restarts when visible again.
 * Safe in non-browser environments: no-ops and returns a no-op dispose.
 */
export function startVisibilityPoll(
  callback: () => void,
  options: VisibilityPollOptions,
): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return () => {};
  }

  const { intervalMs, runOnStart = false, runOnVisible = true } = options;
  if (intervalMs <= 0) {
    return () => {};
  }

  let intervalId: ReturnType<typeof setInterval> | null = null;

  const clear = () => {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };

  const start = () => {
    clear();
    intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        callback();
      }
    }, intervalMs);
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      if (runOnVisible) {
        callback();
      }
      start();
    } else {
      clear();
    }
  };

  if (document.visibilityState === 'visible') {
    if (runOnStart) {
      callback();
    }
    start();
  }

  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    clear();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
