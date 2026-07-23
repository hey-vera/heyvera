import { describe, expect, it } from 'vitest';
import {
  LIVE_DEFAULT_PHASE,
  LIVE_INGEST_FOUNDATION_DETAIL,
  SHELF_CREATE_HINT,
  SHELF_ITEMS_EMPTY_LABEL,
  SHELVES_EMPTY_DETAIL,
  SHELVES_EMPTY_TITLE,
  VIDEO_LIBRARY_EMPTY_DETAIL,
  VIDEO_LIBRARY_EMPTY_TITLE,
  VIDEO_UPLOAD_DISABLED_REASON,
  VIDEO_UPLOAD_CTA_LABEL,
  hasLivePlayback,
  isLiveChromeAllowed,
  isVideoUploadProductionReady,
  liveSessionToUiPhase,
  liveStreamBadgeLabel,
  shelfListSubtitle,
} from './mediaHonesty';

describe('liveStreamBadgeLabel (11c / 14i)', () => {
  it('returns Preview for default / preview phase', () => {
    expect(liveStreamBadgeLabel('preview')).toBe('Preview');
    expect(liveStreamBadgeLabel(LIVE_DEFAULT_PHASE)).toBe('Preview');
  });

  it('returns Soon for soon/scheduled — never LIVE', () => {
    expect(liveStreamBadgeLabel('soon')).toBe('Soon');
    expect(liveStreamBadgeLabel('scheduled')).toBe('Soon');
    expect(liveStreamBadgeLabel('soon').toLowerCase()).not.toContain('live');
    expect(liveStreamBadgeLabel('scheduled').toLowerCase()).not.toContain('live');
  });

  it('returns Offline without LIVE chrome', () => {
    expect(liveStreamBadgeLabel('offline')).toBe('Offline');
    expect(liveStreamBadgeLabel('offline').toLowerCase()).not.toContain('live');
    expect(liveStreamBadgeLabel('ended')).toBe('Offline');
  });

  it('LIVE label only for explicit live phase', () => {
    expect(liveStreamBadgeLabel('live')).toBe('LIVE');
  });

  it('isLiveChromeAllowed is false for all non-live phases', () => {
    expect(isLiveChromeAllowed('preview')).toBe(false);
    expect(isLiveChromeAllowed('soon')).toBe(false);
    expect(isLiveChromeAllowed('scheduled')).toBe(false);
    expect(isLiveChromeAllowed('offline')).toBe(false);
    expect(isLiveChromeAllowed('ended')).toBe(false);
    expect(isLiveChromeAllowed('live')).toBe(true);
  });

  it('maps LiveSession phase honestly (14i)', () => {
    expect(liveSessionToUiPhase(null)).toBe('preview');
    expect(liveSessionToUiPhase({ phase: 'preview' })).toBe('preview');
    expect(liveSessionToUiPhase({ phase: 'live', playbackUrl: null })).toBe('live');
    expect(liveSessionToUiPhase({ phase: 'ended' })).toBe('ended');
    expect(liveStreamBadgeLabel(liveSessionToUiPhase({ phase: 'live' }))).toBe('LIVE');
    expect(liveStreamBadgeLabel(liveSessionToUiPhase({ phase: 'preview' }))).not.toBe('LIVE');
  });

  it('hasLivePlayback requires phase live and non-empty URL', () => {
    expect(hasLivePlayback({ phase: 'live', playbackUrl: null })).toBe(false);
    expect(hasLivePlayback({ phase: 'live', playbackUrl: '' })).toBe(false);
    expect(hasLivePlayback({ phase: 'preview', playbackUrl: 'https://x' })).toBe(false);
    expect(hasLivePlayback({ phase: 'live', playbackUrl: 'https://play.example/x' })).toBe(true);
  });

  it('foundation copy is honest about deferred provider', () => {
    expect(LIVE_INGEST_FOUNDATION_DETAIL.toLowerCase()).toMatch(/not production|null/);
    expect(LIVE_INGEST_FOUNDATION_DETAIL.toLowerCase()).not.toMatch(/\bis broadcasting\b/);
  });
});

describe('video upload honesty (11a)', () => {
  it('upload is not production-ready', () => {
    expect(isVideoUploadProductionReady()).toBe(false);
  });

  it('disabled reason is honest about pipeline', () => {
    expect(VIDEO_UPLOAD_DISABLED_REASON.toLowerCase()).toMatch(/not production|transcode|processing/);
    expect(VIDEO_UPLOAD_CTA_LABEL.toLowerCase()).toMatch(/not production|soon|upload/);
  });

  it('empty library copy does not invent cards', () => {
    expect(VIDEO_LIBRARY_EMPTY_TITLE.toLowerCase()).toContain('no videos');
    expect(VIDEO_LIBRARY_EMPTY_DETAIL.toLowerCase()).toMatch(/no production|longform|real/);
    expect(VIDEO_LIBRARY_EMPTY_DETAIL.toLowerCase()).not.toContain('featured upload');
  });
});

describe('shelves foundation (11b)', () => {
  it('empty shelf subtitle is honest', () => {
    expect(shelfListSubtitle(0)).toBe(SHELF_ITEMS_EMPTY_LABEL);
    expect(shelfListSubtitle(null)).toBe(SHELF_ITEMS_EMPTY_LABEL);
    expect(shelfListSubtitle(undefined)).toBe(SHELF_ITEMS_EMPTY_LABEL);
    expect(shelfListSubtitle(0).toLowerCase()).toContain('empty');
  });

  it('nonzero item count formats without inventing content', () => {
    expect(shelfListSubtitle(1)).toBe('1 item');
    expect(shelfListSubtitle(3)).toBe('3 items');
  });

  it('empty shelves copy is foundation-only', () => {
    expect(SHELVES_EMPTY_TITLE.toLowerCase()).toContain('no shelves');
    expect(SHELVES_EMPTY_DETAIL.toLowerCase()).toMatch(/empty|not wired|no fake/);
    expect(SHELF_CREATE_HINT.toLowerCase()).toMatch(/empty|api|later/);
  });
});
