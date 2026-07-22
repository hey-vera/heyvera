/**
 * Whether to show the honest thread truncation notice.
 * Pure helper — no fake pagination / no invented totals.
 */
export function shouldShowThreadCapNotice(repliesTruncated: boolean | undefined): boolean {
  return repliesTruncated === true;
}

export const THREAD_CAP_NOTICE =
  'This thread is large — showing up to 100 replies (max depth 8). More may exist that are not loaded yet.';
