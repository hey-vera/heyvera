import { describe, expect, it } from 'vitest';
import {
  earlyAccessBannerCopy,
  earlyAccessBannerPlainText,
} from './earlyAccessBanner';

describe('earlyAccessBannerCopy', () => {
  it('marks early access and real multi-user systems', () => {
    const c = earlyAccessBannerCopy();
    expect(c.lead.toLowerCase()).toContain('early access');
    expect(c.lead.toLowerCase()).toMatch(/prefs|moderation|guilds|pulse/);
    expect(c.lead.toLowerCase()).toContain('live api');
  });

  it('holds Watch/Live as Preview (no fake LIVE claim)', () => {
    const c = earlyAccessBannerCopy();
    expect(c.mediaHold.toLowerCase()).toMatch(/watch|live/);
    expect(c.mediaHold.toLowerCase()).toContain('preview');
    expect(c.mediaHold.toLowerCase()).not.toMatch(/\blive now\b|\bgoing live\b/);
  });

  it('exposes Pulse CTA and region label', () => {
    const c = earlyAccessBannerCopy();
    expect(c.pulseCta).toBe('Open Pulse');
    expect(c.regionLabel.toLowerCase()).toContain('heyvera');
  });
});

describe('earlyAccessBannerPlainText', () => {
  it('joins lead and media hold', () => {
    const plain = earlyAccessBannerPlainText();
    const c = earlyAccessBannerCopy();
    expect(plain).toContain(c.lead);
    expect(plain).toContain(c.mediaHold);
  });
});
