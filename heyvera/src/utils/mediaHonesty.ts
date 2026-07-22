/**
 * Wave 11 — pure honesty helpers for Watch / Live / shelves.
 * No fake LIVE chrome, no invented video cards, no claim that video processing works.
 */

// ─── Live stream labels (11c) ───────────────────────────────────────────────

/**
 * Broadcast UI phases.
 * - preview / soon / scheduled / offline: honest non-live chrome
 * - live: only when a real ingest session is known live (not used until encoder ships)
 */
export type LiveStreamPhase = 'preview' | 'soon' | 'scheduled' | 'offline' | 'live';

/** Badge text for stream chrome. Never invent LIVE without phase === 'live'. */
export function liveStreamBadgeLabel(phase: LiveStreamPhase): string {
  switch (phase) {
    case 'live':
      return 'LIVE';
    case 'soon':
    case 'scheduled':
      return 'Soon';
    case 'offline':
      return 'Offline';
    case 'preview':
    default:
      return 'Preview';
  }
}

/**
 * True only when real live chrome is allowed.
 * Wave 11 hold: encoder ingest is not production — callers pass 'preview' / 'soon' only.
 */
export function isLiveChromeAllowed(phase: LiveStreamPhase): boolean {
  return phase === 'live';
}

/** Default phase until real session API exists. */
export const LIVE_DEFAULT_PHASE: LiveStreamPhase = 'preview';

export const LIVE_INGEST_FOUNDATION_DETAIL =
  'Encoder ingest is not production. This surface is Preview only — no RTMP/WHIP session, no LIVE badge on real streams.';

// ─── Video upload honesty (11a) ─────────────────────────────────────────────

/** Disabled upload control label. */
export const VIDEO_UPLOAD_CTA_LABEL = 'Upload video (not production)';

/**
 * Why video upload is disabled in the UI.
 * Image media (presign → finalize → attach) remains the live path.
 */
export const VIDEO_UPLOAD_DISABLED_REASON =
  'Video upload pipeline is not production — no transcode or processing yet. Image attach on posts is the live media path today.';

/** Title for empty video library (no fake cards). */
export const VIDEO_LIBRARY_EMPTY_TITLE = 'No videos on this Page yet';

export const VIDEO_LIBRARY_EMPTY_DETAIL =
  'There is no production video library API yet. Longform text is live via the social API; video cards will appear here only when real uploads exist.';

/** Banner for the Watch page foundation. */
export const VIDEO_PAGE_FOUNDATION_BANNER =
  'Page-owned media foundation: longform is real; video upload and live ingest are not production. No invented player shelves.';

// ─── Shelves / playlists foundation (11b) ───────────────────────────────────

export const SHELVES_SECTION_TITLE = 'Shelves';

export const SHELVES_EMPTY_TITLE = 'No shelves yet';

export const SHELVES_EMPTY_DETAIL =
  'Create an empty shelf for your steward Page. Adding videos to shelves is not wired yet — no fake items.';

export const SHELF_ITEMS_EMPTY_LABEL = 'Empty shelf — no items yet';

export const SHELF_CREATE_CTA = 'Create empty shelf';

export const SHELF_CREATE_HINT =
  'Creates an empty Page-owned shelf via the real API. Playlist membership / video cards come later.';

/** Format shelf list line: title + honest empty item count. */
export function shelfListSubtitle(itemCount: number | null | undefined): string {
  const n = typeof itemCount === 'number' && Number.isFinite(itemCount) ? Math.max(0, itemCount) : 0;
  if (n === 0) return SHELF_ITEMS_EMPTY_LABEL;
  return `${n} item${n === 1 ? '' : 's'}`;
}

/**
 * Whether video upload UI may enable a real upload path.
 * Wave 11: always false until BE video processing is production.
 */
export function isVideoUploadProductionReady(): boolean {
  return false;
}
