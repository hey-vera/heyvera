/**
 * Pure helpers for guild (community) visibility + membership roles (Wave 8e / 9d).
 */

export type GuildVisibility = "public" | "private" | string;
export type GuildRole = "owner" | "member" | string;

export function isPrivateGuild(visibility: GuildVisibility | null | undefined): boolean {
  return (visibility ?? "public").toLowerCase() === "private";
}

/**
 * Discover list: hide private guilds unless the viewer is already a member.
 * (Public discover API already omits private; this is a client safety net.)
 */
export function filterDiscoverGuilds<T extends { id: string; visibility?: string }>(
  communities: T[],
  joinedIds: Set<string>,
): T[] {
  return communities.filter(
    (c) => !isPrivateGuild(c.visibility) || joinedIds.has(c.id),
  );
}

/** Private guild feeds require membership; public are open. */
export function canAccessGuildFeed(
  visibility: GuildVisibility | null | undefined,
  isMember: boolean,
): boolean {
  if (isPrivateGuild(visibility)) return isMember;
  return true;
}

/**
 * Display label for membership role when known.
 * Owner and Member are both shown (Wave 9d); unknown/empty → null.
 */
export function membershipRoleLabel(role: GuildRole | null | undefined): string | null {
  if (!role) return null;
  const normalized = role.toLowerCase();
  if (normalized === "owner") return "Owner";
  if (normalized === "member") return "Member";
  return null;
}

/**
 * Honest copy when creating a private community.
 * Private = unlisted from Discover; no invite system yet.
 */
export const PRIVATE_GUILD_CREATE_HINT =
  "Not listed in Discover. No invite system yet — anyone who already joined can use the feed. Share the slug yourself if you want others to find it; join still uses the real join API when someone has the slug or id.";

/**
 * After creating a private guild: surface slug/id for manual share.
 * Do not pretend Discord-style invite links exist.
 */
export function privateGuildShareHint(slug: string, id?: string | null): string {
  const parts = [`Slug: ${slug}`];
  if (id) parts.push(`id: ${id}`);
  return `Share this yourself — no invite links yet. ${parts.join(" · ")}`;
}

/**
 * Join/leave CTA honesty for private guilds (no fake Invite button).
 * Public communities do not need this helper.
 */
export function privateGuildJoinCtaCopy(isMember: boolean): string {
  if (isMember) {
    return "Private community — not listed in Discover. No invite system yet. Leave uses the real leave API.";
  }
  return "Private community — unlisted from Discover. No invite system yet. Join uses the real join API if you can open this community by slug or id.";
}

/** Merge discover + mine lists so private memberships appear in "Your Communities". */
export function mergeCommunityLists<T extends { id: string }>(
  discover: T[],
  mine: T[],
): T[] {
  const byId = new Map<string, T>();
  for (const c of discover) byId.set(c.id, c);
  for (const c of mine) {
    // Prefer mine row when present (carries joinedAt / role).
    byId.set(c.id, { ...byId.get(c.id), ...c } as T);
  }
  return Array.from(byId.values());
}

/** Public path for a brand Page by slug. */
export function brandPagePath(slug: string): string {
  return `/page/${encodeURIComponent(slug)}`;
}

/** Live communities surface (not orphan /community/:slug). */
export function communitiesListPath(): string {
  return "/communities";
}
