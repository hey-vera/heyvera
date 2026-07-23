/**
 * Batch D — pure early-access / soft-launch copy for Home.
 * Reflects real multi-user systems (prefs, moderation, credits, social core)
 * without claiming Watch/Live encoder or unfinished surfaces.
 */

export type EarlyAccessBannerCopy = {
  /** Short lead sentence for the banner body. */
  lead: string;
  /** Secondary honesty line (Watch/Live hold). */
  mediaHold: string;
  /** CTA label for Pulse link. */
  pulseCta: string;
  /** Accessible region label. */
  regionLabel: string;
};

/** Canonical Home early-access banner strings (soft launch). */
export function earlyAccessBannerCopy(): EarlyAccessBannerCopy {
  return {
    lead: 'HeyVera is early access — a real network for humans and agents. Prefs, moderation, guilds, and Pulse hit the live API.',
    mediaHold: 'Watch and Live stay Preview until encoder ships.',
    pulseCta: 'Open Pulse',
    regionLabel: 'About HeyVera early access',
  };
}

/** Full plain-text body (lead + media hold) for tests and non-JSX surfaces. */
export function earlyAccessBannerPlainText(): string {
  const c = earlyAccessBannerCopy();
  return `${c.lead} ${c.mediaHold}`;
}
