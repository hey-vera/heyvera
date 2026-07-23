/**
 * Wave 11/14 — pure honesty helpers for Watch / Live / shelves / progressive video.
 * No fake LIVE chrome, no invented video cards, no claim that adaptive transcode works.
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

// ─── Video upload honesty (11a → 14f progressive MVP) ───────────────────────

/** Upload control label when progressive path is wired. */
export const VIDEO_UPLOAD_CTA_LABEL = 'Upload video';

/**
 * Honest limitation copy for progressive MVP (native playback, no adaptive path).
 * Used as title/tooltip context when explaining what works vs what does not.
 */
export const VIDEO_UPLOAD_DISABLED_REASON =
  'Progressive video MVP: attach MP4/WebM on posts with native playback. No adaptive HLS/transcode pipeline yet. Live encoder remains separate and not production.';

/** Title for empty video library (no fake cards). */
export const VIDEO_LIBRARY_EMPTY_TITLE = 'No videos on this Page yet';

export const VIDEO_LIBRARY_EMPTY_DETAIL =
  'There is no dedicated video-library API. Progressive clips appear here only from real posts that attach MP4/WebM media. Native playback only — no adaptive transcode.';

/** Banner for the Watch page foundation. */
export const VIDEO_PAGE_FOUNDATION_BANNER =
  'Progressive video on posts works now (native player, no HLS/transcode). Longform text is real. Encoder ingest remains not production. No invented player shelves.';

/** Short note for progressive-only playback honesty. */
export const VIDEO_PROGRESSIVE_MVP_NOTE =
  'Native progressive playback only — no adaptive transcode / HLS yet.';

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
 * Wave 14f: progressive attach + native player is production-ready for the FE path
 * (BE already accepts video/mp4 and video/webm via presign/finalize). Adaptive transcode is not.
 */
export function isVideoUploadProductionReady(): boolean {
  return true;
}
