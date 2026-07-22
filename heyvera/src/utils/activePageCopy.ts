/**
 * Honest copy helpers for Brand Page empty feed + Create active-Page UX (Wave 9c).
 * Pure strings / predicates — no fabricated feeds or Join/Available CTAs.
 */

/** Brand Page "Posts" region title. */
export const BRAND_POSTS_REGION_TITLE = 'Posts';

/**
 * Honest empty feed for brand-as-author posts (not complete yet).
 * Follow is real; do not invent placeholder cards or call a fake feed API.
 */
export const BRAND_POSTS_EMPTY_TITLE = 'No posts from this Page yet';

export const BRAND_POSTS_EMPTY_DETAIL =
  'Brand-as-author posts are not complete yet. You can follow this Page — follow is real. A brand feed will show here when publishing as the brand is ready.';

/** Signed-out helper under Follow (SignIn → Follow). */
export const BRAND_FOLLOW_SIGN_IN_HINT = 'Sign in to follow this Page';

/** Owner badge — never "Follow" / "Join" / "Available". */
export const BRAND_OWNER_BADGE = 'Your page';

/**
 * When a Brand Page is selected in compose: posts still publish as person identity.
 * Show near the Page selector and near the Post action for crystal-clear authorship.
 */
export const BRAND_AS_PERSON_WARNING =
  'Posts still publish as your person identity for now — brand-as-author is not complete yet.';

/**
 * After creating a brand page while it remains selected: strong honesty notice.
 */
export const BRAND_CREATED_NOTICE =
  'Brand page created. Posts still publish as your person identity until brand-as-author ships.';

/**
 * When listMyPages fails: never leave active Page as a silent void.
 */
export const PAGES_LIST_FALLBACK_NOTICE = 'Posting as your person Page';

/** Page kind used for authorship UI (matches SocialPage.kind). */
export type ActivePageKind = 'person' | 'agent' | 'brand';

/** True when compose should warn that posts publish as person, not the brand. */
export function shouldShowBrandAsPersonWarning(
  pageKind: ActivePageKind | null | undefined,
): boolean {
  return pageKind === 'brand';
}

/**
 * Notice to show under the Page selector / Post chrome.
 * - pagesLoadFailed: listMyPages failed → person fallback
 * - brandSelected: brand page active → person authorship warning
 * - brandJustCreated: after create while brand stays selected → stronger notice
 * Otherwise null (person/agent with a healthy list).
 */
export function activePageAuthorshipNotice(opts: {
  pagesLoadFailed?: boolean;
  pageKind?: ActivePageKind | null;
  brandJustCreated?: boolean;
}): string | null {
  if (opts.pagesLoadFailed) {
    return PAGES_LIST_FALLBACK_NOTICE;
  }
  if (opts.brandJustCreated && shouldShowBrandAsPersonWarning(opts.pageKind)) {
    return BRAND_CREATED_NOTICE;
  }
  if (shouldShowBrandAsPersonWarning(opts.pageKind)) {
    return BRAND_AS_PERSON_WARNING;
  }
  return null;
}

/** Short line near the Post button when brand is selected (or just created). */
export function postButtonAuthorshipHint(opts: {
  pagesLoadFailed?: boolean;
  pageKind?: ActivePageKind | null;
  brandJustCreated?: boolean;
}): string | null {
  // Same honesty rules as selector notice; keep one source of truth for when to show.
  return activePageAuthorshipNotice(opts);
}
