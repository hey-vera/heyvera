/**
 * Pure helpers for Home → Following empty-network onboarding (Batch C).
 * Builds suggestion cards from real profiles / communities / trending APIs — no invented users.
 */

export type ProfileSuggestion = {
  kind: "profile";
  id: string;
  handle: string;
  displayName: string;
  bio?: string | null;
  avatarUrl?: string | null;
};

export type CommunitySuggestion = {
  kind: "community";
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  visibility?: string;
};

export type TopicSuggestion = {
  kind: "topic";
  id: string;
  tag: string;
  postCount: number;
};

export type NetworkSuggestion = ProfileSuggestion | CommunitySuggestion | TopicSuggestion;

/** Normalize profiles list from GET /profiles into suggestion cards. */
export function mapProfilesToSuggestions(
  profiles: Array<{
    id?: string;
    handle?: string;
    displayName?: string;
    bio?: string | null;
    avatarUrl?: string | null;
  }>,
  limit = 6,
): ProfileSuggestion[] {
  const out: ProfileSuggestion[] = [];
  for (const p of profiles) {
    if (!p?.handle || !p?.id) continue;
    out.push({
      kind: "profile",
      id: p.id,
      handle: p.handle,
      displayName: p.displayName || p.handle,
      bio: p.bio ?? null,
      avatarUrl: p.avatarUrl ?? null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Public discover communities only — private guilds need invites and must not appear
 * as open-join suggestions.
 */
export function mapCommunitiesToSuggestions(
  communities: Array<{
    id?: string;
    slug?: string;
    name?: string;
    description?: string | null;
    visibility?: string;
  }>,
  limit = 4,
): CommunitySuggestion[] {
  const out: CommunitySuggestion[] = [];
  for (const c of communities) {
    if (!c?.id || !c?.name) continue;
    const visibility = (c.visibility ?? "public").toLowerCase();
    if (visibility === "private") continue;
    out.push({
      kind: "community",
      id: c.id,
      slug: c.slug || c.id,
      name: c.name,
      description: c.description ?? null,
      visibility,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Trending hashtags → topic suggestions (explore seed, not follow targets). */
export function mapTrendingToSuggestions(
  topics: Array<{ tag?: string; postCount?: number }>,
  limit = 4,
): TopicSuggestion[] {
  const out: TopicSuggestion[] = [];
  for (const t of topics) {
    const tag = (t.tag ?? "").replace(/^#/, "").trim();
    if (!tag) continue;
    out.push({
      kind: "topic",
      id: `topic:${tag.toLowerCase()}`,
      tag,
      postCount: typeof t.postCount === "number" ? t.postCount : 0,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Merge suggestion streams with stable priority: profiles → communities → topics.
 * Dedupes by id. Caps total length.
 */
export function mergeNetworkSuggestions(
  profiles: ProfileSuggestion[],
  communities: CommunitySuggestion[],
  topics: TopicSuggestion[],
  limit = 12,
): NetworkSuggestion[] {
  const out: NetworkSuggestion[] = [];
  const seen = new Set<string>();
  for (const item of [...profiles, ...communities, ...topics]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

export function emptyFollowingTitle(): string {
  return "Your network is empty";
}

export function emptyFollowingDetail(): string {
  return "Follow people and join public communities to fill Following. Suggestions below come from live profiles, communities, and trending APIs — not invented accounts.";
}

/** Explore path for a trending tag — posts search with `#tag` query. */
export function topicExplorePath(tag: string): string {
  const clean = tag.replace(/^#/, "").trim();
  if (!clean) return "/explore";
  return `/explore?q=${encodeURIComponent(`#${clean}`)}&filter=posts`;
}
