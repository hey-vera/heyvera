/**
 * Pure helpers for guild (community) visibility + membership roles (Wave 8e).
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

/** Display label for membership role; null when nothing special to show. */
export function membershipRoleLabel(role: GuildRole | null | undefined): string | null {
  if (!role) return null;
  if (role.toLowerCase() === "owner") return "Owner";
  return null;
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
