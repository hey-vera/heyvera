/**
 * Pure access_state normalization for Premium / billing UI.
 * Never invent premium — only map known server states.
 */

/** Canonical access states from GET /api/billing/status|usage. */
export type AccessState =
  | 'signed_out'
  | 'needs_phone'
  | 'needs_checkout'
  | 'trial_active'
  | 'active'
  | 'payment_failed'
  | 'cancelled'
  | 'unknown';

const KNOWN: ReadonlySet<string> = new Set([
  'signed_out',
  'needs_phone',
  'needs_checkout',
  'trial_active',
  'active',
  'payment_failed',
  'cancelled',
]);

/**
 * Normalize raw API `access_state` (or aliases) to a canonical value.
 * Does not invent "premium" / "active" from empty or unknown input.
 */
export function normalizeAccessState(raw: unknown): AccessState {
  if (raw == null) return 'unknown';
  const s = String(raw).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!s) return 'unknown';

  // Honest aliases only — never map invented product names to active.
  if (s === 'trialing' || s === 'trial') return 'trial_active';
  if (s === 'past_due' || s === 'past_due_payment' || s === 'payment_failed') {
    return 'payment_failed';
  }
  if (s === 'canceled') return 'cancelled';

  if (KNOWN.has(s)) return s as AccessState;
  return 'unknown';
}

/** True only for paid active or in-trial access (matches BE usage rules). */
export function isPremiumAccess(state: AccessState | unknown): boolean {
  const n = typeof state === 'string' || state == null
    ? normalizeAccessState(state)
    : normalizeAccessState(String(state));
  return n === 'active' || n === 'trial_active';
}

/** Human label for plan/access display — never claims Premium without access. */
export function accessStateLabel(state: AccessState | unknown): string {
  const n = normalizeAccessState(
    typeof state === 'string' || state == null ? state : String(state),
  );
  switch (n) {
    case 'active':
      return 'Active';
    case 'trial_active':
      return 'Trial active';
    case 'needs_checkout':
      return 'Needs checkout';
    case 'needs_phone':
      return 'Needs phone verification';
    case 'payment_failed':
      return 'Payment failed';
    case 'cancelled':
      return 'Cancelled';
    case 'signed_out':
      return 'Signed out';
    case 'unknown':
    default:
      return 'Unknown';
  }
}

/**
 * Format plan + access for UI. Never invents a Premium plan name when inactive.
 */
export function formatAccessPlanLabel(opts: {
  accessState?: unknown;
  planType?: string | null;
  active?: boolean | null;
}): string {
  const access = normalizeAccessState(opts.accessState);
  const premium =
    opts.active === true || (opts.active !== false && isPremiumAccess(access));

  if (premium) {
    const plan = (opts.planType ?? '').trim() || 'Premium';
    return `${plan} · ${accessStateLabel(access)}`;
  }

  if (access !== 'unknown') {
    return accessStateLabel(access);
  }
  return 'No active subscription';
}
