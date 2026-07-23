/**
 * Small helpers for optimistic engagement mutations (like / repost / bookmark).
 * Apply local UI first, await the API, and revert if the request fails.
 */

export type OptimisticPostMutationOptions<T> = {
  /** Apply optimistic local state (sync). */
  apply: () => void;
  /** Server mutation. */
  mutate: () => Promise<T>;
  /** Restore prior local state on failure (sync). */
  revert: () => void;
  /** Optional error side-effect (toast, banner, log). Does not swallow the error. */
  onError?: (error: unknown) => void;
};

/**
 * Run an optimistic mutation: apply → mutate → revert + rethrow on failure.
 */
export async function withOptimisticPostMutation<T>(
  options: OptimisticPostMutationOptions<T>,
): Promise<T> {
  options.apply();
  try {
    return await options.mutate();
  } catch (error) {
    options.revert();
    options.onError?.(error);
    throw error;
  }
}

/** User-facing message for failed engagement mutations. */
export function mutationErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

/** Patch a single post's like flag + count. No-op when already at target. */
export function applyLikeState<T extends { liked: boolean; like_count: number }>(
  post: T,
  liked: boolean,
): T {
  if (post.liked === liked) return post;
  return {
    ...post,
    liked,
    like_count: Math.max(0, post.like_count + (liked ? 1 : -1)),
  };
}

/** Patch a single post's repost flag + count. No-op when already at target. */
export function applyRepostState<
  T extends { reposted: boolean; repost_count: number },
>(post: T, reposted: boolean): T {
  if (post.reposted === reposted) return post;
  return {
    ...post,
    reposted,
    repost_count: Math.max(0, post.repost_count + (reposted ? 1 : -1)),
  };
}

/** Patch a single post's bookmark flag. No-op when already at target. */
export function applyBookmarkState<T extends { bookmarked: boolean }>(
  post: T,
  bookmarked: boolean,
): T {
  if (post.bookmarked === bookmarked) return post;
  return { ...post, bookmarked };
}

/** Map over a list and apply like state to the matching id. */
export function mapLikeInPosts<T extends { id: string; liked: boolean; like_count: number }>(
  posts: readonly T[],
  id: string,
  liked: boolean,
): T[] {
  return posts.map((post) => (post.id === id ? applyLikeState(post, liked) : post));
}

/** Map over a list and apply repost state to the matching id. */
export function mapRepostInPosts<
  T extends { id: string; reposted: boolean; repost_count: number },
>(posts: readonly T[], id: string, reposted: boolean): T[] {
  return posts.map((post) => (post.id === id ? applyRepostState(post, reposted) : post));
}

/** Map over a list and apply bookmark state to the matching id. */
export function mapBookmarkInPosts<T extends { id: string; bookmarked: boolean }>(
  posts: readonly T[],
  id: string,
  bookmarked: boolean,
): T[] {
  return posts.map((post) => (post.id === id ? applyBookmarkState(post, bookmarked) : post));
}
