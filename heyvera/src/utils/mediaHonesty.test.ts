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
  VIDEO_PAGE_FOUNDATION_BANNER,
  VIDEO_PROGRESSIVE_MVP_NOTE,
  VIDEO_UPLOAD_DISABLED_REASON,
  VIDEO_UPLOAD_CTA_LABEL,
  isLiveChromeAllowed,
  isVideoUploadProductionReady,
  liveStreamBadgeLabel,
  shelfListSubtitle,
} from './mediaHonesty';

describe('liveStreamBadgeLabel (11c)', () => {
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
  });

  it('LIVE label only for explicit live phase', () => {
    expect(liveStreamBadgeLabel('live')).toBe('LIVE');
  });

  it('isLiveChromeAllowed is false for all non-live phases', () => {
    expect(isLiveChromeAllowed('preview')).toBe(false);
    expect(isLiveChromeAllowed('soon')).toBe(false);
    expect(isLiveChromeAllowed('scheduled')).toBe(false);
    expect(isLiveChromeAllowed('offline')).toBe(false);
    expect(isLiveChromeAllowed('live')).toBe(true);
  });

  it('foundation copy never claims broadcasting', () => {
    expect(LIVE_INGEST_FOUNDATION_DETAIL.toLowerCase()).toContain('not production');
    expect(LIVE_INGEST_FOUNDATION_DETAIL.toLowerCase()).not.toMatch(/\bis live\b/);
  });
});

describe('video upload honesty (11a → 14f progressive)', () => {
  it('upload is production-ready for progressive attach path', () => {
    expect(isVideoUploadProductionReady()).toBe(true);
  });

  it('CTA label enables real upload wording', () => {
    expect(VIDEO_UPLOAD_CTA_LABEL.toLowerCase()).toContain('upload');
    expect(VIDEO_UPLOAD_CTA_LABEL.toLowerCase()).not.toMatch(/not production/);
  });

  it('limitation copy is honest about progressive-only (no HLS/transcode)', () => {
    const reason = VIDEO_UPLOAD_DISABLED_REASON.toLowerCase();
    expect(reason).toMatch(/progressive|native/);
    expect(reason).toMatch(/no adaptive|no.*hls|transcode/);
    expect(VIDEO_PROGRESSIVE_MVP_NOTE.toLowerCase()).toMatch(/native|progressive/);
    expect(VIDEO_PROGRESSIVE_MVP_NOTE.toLowerCase()).toMatch(/no adaptive|transcode|hls/);
  });

  it('foundation banner does not claim LIVE/encoder broadcasting', () => {
    const banner = VIDEO_PAGE_FOUNDATION_BANNER.toLowerCase();
    expect(banner).toMatch(/progressive|native/);
    expect(banner).toMatch(/not production/);
    expect(banner).not.toMatch(/\blive now\b|\bgoing live\b|encoder ready|\blive badge\b/);
    // "Live encoder" phrase is ok as a product surface name only if paired with not production.
    expect(banner).toMatch(/encoder.*not production|not production.*encoder/);
  });

  it('empty library copy does not invent cards', () => {
    expect(VIDEO_LIBRARY_EMPTY_TITLE.toLowerCase()).toContain('no videos');
    expect(VIDEO_LIBRARY_EMPTY_DETAIL.toLowerCase()).toMatch(/no dedicated|progressive|real posts/);
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
