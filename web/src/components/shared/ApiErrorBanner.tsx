import { useEffect, useState } from "react";

const SESSION_KEY = "heyvera_api_error_banner_dismissed";

type ApiErrorBannerProps = {
  /** True while a periodic re-check probe is in flight */
  isRechecking?: boolean;
  /** True when the backend is unreachable */
  isFallback?: boolean;
};

/**
 * A subtle, dismissible banner shown at the top of the center column
 * when the API is unreachable and data may be stale.
 *
 * - Shows "Reconnecting..." while a re-check is in flight.
 * - Auto-dismisses when the backend recovers (isFallback flips to false).
 * - Dismissed state is persisted in sessionStorage so it only shows once
 *   per browser session (only for manual dismissal, not recovery).
 */
export function ApiErrorBanner({ isRechecking = false, isFallback = true }: ApiErrorBannerProps) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(SESSION_KEY) === "1";
    } catch {
      return false;
    }
  });

  // Auto-dismiss when backend recovers
  useEffect(() => {
    if (!isFallback && !dismissed) {
      setDismissed(true);
      // Don't persist to sessionStorage — if it goes down again we want to show it
    }
  }, [isFallback, dismissed]);

  function dismiss() {
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      // sessionStorage unavailable — just dismiss in memory
    }
    setDismissed(true);
  }

  if (dismissed) return null;

  return (
    <div className="api-error-banner" role="status" aria-live="polite">
      <span className="api-error-banner-text">
        {isRechecking
          ? "Reconnecting…"
          : "Backend unavailable — showing preview data"}
      </span>
      <button
        type="button"
        className="api-error-banner-dismiss"
        aria-label="Dismiss"
        onClick={dismiss}
      >
        &times;
      </button>
    </div>
  );
}
