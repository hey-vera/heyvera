/**
 * Batch B2 — pure moderation helpers (filter + report body mapping).
 */

export type ReportTargetType = 'user' | 'post';

export type ReportBody = {
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
};

/**
 * Hide posts by author profile id (block/mute optimistic UX).
 * Matches either `author.id` or nested feed shapes.
 */
export function filterPostsExcludingAuthors<T extends { author?: { id?: string }; authorId?: string }>(
  posts: T[],
  excludedAuthorIds: Iterable<string>,
): T[] {
  const exclude = new Set(
    [...excludedAuthorIds].filter((id) => typeof id === 'string' && id.length > 0),
  );
  if (exclude.size === 0) return posts;
  return posts.filter((post) => {
    const authorId = post.author?.id ?? post.authorId;
    if (!authorId) return true;
    return !exclude.has(authorId);
  });
}

/** Map UI report fields → API camelCase body (also accepts snake aliases on input). */
export function mapReportToApiBody(input: {
  targetType?: string;
  target_type?: string;
  targetId?: string;
  target_id?: string;
  reason?: string;
}): ReportBody {
  const targetTypeRaw = (input.targetType ?? input.target_type ?? '').trim().toLowerCase();
  const targetType: ReportTargetType = targetTypeRaw === 'user' ? 'user' : 'post';
  const targetId = String(input.targetId ?? input.target_id ?? '').trim();
  const reason = String(input.reason ?? '').trim() || 'user_reported';
  return { targetType, targetId, reason };
}

/** Add author id into a mutable exclusion set (optimistic hide). */
export function addExcludedAuthor(
  current: ReadonlySet<string> | readonly string[],
  authorId: string,
): Set<string> {
  const next = new Set(current);
  if (authorId) next.add(authorId);
  return next;
}
