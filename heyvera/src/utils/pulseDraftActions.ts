/**
 * Pure helpers for Pulse draft status → allowed UI actions.
 * Mirrors server `allowed_pulse_transition` (wave 10c).
 */

export type PulseDraftStatus = 'pending' | 'approved' | 'rejected' | 'published' | string;

export type PulseDraftAction =
  | 'approve'
  | 'approveAndPublish'
  | 'publish'
  | 'reject'
  | 'schedule';

/** Allowed UI actions for a draft status (honest labels; server still enforces CAS). */
export function allowedPulseDraftActions(status: PulseDraftStatus): PulseDraftAction[] {
  switch (status) {
    case 'pending':
      return ['approve', 'approveAndPublish', 'reject'];
    case 'approved':
      return ['publish', 'reject', 'schedule'];
    case 'published':
    case 'rejected':
      return [];
    default:
      return [];
  }
}

export function canPulseDraftAction(
  status: PulseDraftStatus,
  action: PulseDraftAction,
): boolean {
  return allowedPulseDraftActions(status).includes(action);
}

/** Honest button labels for draft actions. */
export function pulseDraftActionLabel(action: PulseDraftAction): string {
  switch (action) {
    case 'approve':
      return 'Approve only';
    case 'approveAndPublish':
      return 'Approve & publish';
    case 'publish':
      return 'Publish now';
    case 'reject':
      return 'Reject';
    case 'schedule':
      return 'Schedule';
    default:
      return action;
  }
}

/**
 * Map API errors (incl. 409 ILLEGAL_TRANSITION) to honest user-facing copy.
 * Prefers server message when present.
 */
export function pulseTransitionErrorMessage(
  err: unknown,
  status?: number | null,
): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : err && typeof err === 'object' && 'error' in err
          ? String((err as { error?: unknown }).error ?? '')
          : '';
  const msg = raw.trim();
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code ?? '')
      : '';

  if (status === 409 || code === 'ILLEGAL_TRANSITION' || /Illegal draft transition/i.test(msg)) {
    return (
      msg ||
      'That action is not allowed for this draft’s current status. Refresh and try a valid step (e.g. approve pending, then publish approved).'
    );
  }

  return msg || 'Draft action failed. Try again.';
}
