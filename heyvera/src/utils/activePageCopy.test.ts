import { describe, expect, it } from 'vitest';
import {
  BRAND_AS_PERSON_WARNING,
  BRAND_CREATED_NOTICE,
  BRAND_FOLLOW_SIGN_IN_HINT,
  BRAND_OWNER_BADGE,
  BRAND_POSTS_EMPTY_DETAIL,
  BRAND_POSTS_EMPTY_TITLE,
  BRAND_POSTS_REGION_TITLE,
  PAGES_LIST_FALLBACK_NOTICE,
  activePageAuthorshipNotice,
  postButtonAuthorshipHint,
  shouldShowBrandAsPersonWarning,
} from './activePageCopy';

describe('shouldShowBrandAsPersonWarning', () => {
  it('shows for brand only', () => {
    expect(shouldShowBrandAsPersonWarning('brand')).toBe(true);
  });

  it('hides for person and agent', () => {
    expect(shouldShowBrandAsPersonWarning('person')).toBe(false);
    expect(shouldShowBrandAsPersonWarning('agent')).toBe(false);
  });

  it('hides when kind is missing', () => {
    expect(shouldShowBrandAsPersonWarning(null)).toBe(false);
    expect(shouldShowBrandAsPersonWarning(undefined)).toBe(false);
  });
});

describe('activePageAuthorshipNotice', () => {
  it('prefers listMyPages failure fallback over brand warning', () => {
    expect(
      activePageAuthorshipNotice({
        pagesLoadFailed: true,
        pageKind: 'brand',
        brandJustCreated: true,
      }),
    ).toBe(PAGES_LIST_FALLBACK_NOTICE);
  });

  it('shows brand-created notice when brand stays selected after create', () => {
    expect(
      activePageAuthorshipNotice({
        pageKind: 'brand',
        brandJustCreated: true,
      }),
    ).toBe(BRAND_CREATED_NOTICE);
  });

  it('shows brand-as-person warning when brand selected', () => {
    expect(activePageAuthorshipNotice({ pageKind: 'brand' })).toBe(BRAND_AS_PERSON_WARNING);
  });

  it('returns null for person / agent with healthy pages list', () => {
    expect(activePageAuthorshipNotice({ pageKind: 'person' })).toBeNull();
    expect(activePageAuthorshipNotice({ pageKind: 'agent' })).toBeNull();
    expect(activePageAuthorshipNotice({})).toBeNull();
  });
});

describe('postButtonAuthorshipHint', () => {
  it('mirrors authorship notice rules near Post', () => {
    expect(postButtonAuthorshipHint({ pageKind: 'brand' })).toBe(BRAND_AS_PERSON_WARNING);
    expect(postButtonAuthorshipHint({ pagesLoadFailed: true })).toBe(PAGES_LIST_FALLBACK_NOTICE);
    expect(postButtonAuthorshipHint({ pageKind: 'person' })).toBeNull();
  });
});

describe('honest brand page copy constants', () => {
  it('labels empty posts without Join/Available/LIVE/fabricated feed language', () => {
    const bundle = [
      BRAND_POSTS_REGION_TITLE,
      BRAND_POSTS_EMPTY_TITLE,
      BRAND_POSTS_EMPTY_DETAIL,
      BRAND_FOLLOW_SIGN_IN_HINT,
      BRAND_OWNER_BADGE,
      BRAND_AS_PERSON_WARNING,
      BRAND_CREATED_NOTICE,
      PAGES_LIST_FALLBACK_NOTICE,
    ].join(' ');

    expect(bundle.toLowerCase()).not.toMatch(/\bjoin\b/);
    expect(bundle.toLowerCase()).not.toMatch(/\bavailable\b/);
    expect(bundle).not.toMatch(/\bLIVE\b/);
    expect(BRAND_POSTS_EMPTY_DETAIL.toLowerCase()).toMatch(/not complete/);
    expect(BRAND_FOLLOW_SIGN_IN_HINT).toMatch(/Sign in to follow this Page/);
    expect(BRAND_OWNER_BADGE).toBe('Your page');
  });
});
