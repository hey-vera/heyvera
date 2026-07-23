/**
 * Pure helpers for guild (community) visibility + membership roles (Wave 8e / 9d / Batch C).
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
 * Private = unlisted from Discover; join requires an owner invite (Batch C).
 */
export const PRIVATE_GUILD_CREATE_HINT =
  "Not listed in Discover. Open join is closed — share an invite link from the community detail after create. Invites use the real create/redeem APIs.";

/**
 * After creating a private guild: point owner at invite UI (no Discord theater).
 */
export function privateGuildShareHint(slug: string, id?: string | null): string {
  const parts = [`Slug: ${slug}`];
  if (id) parts.push(`id: ${id}`);
  return `Private guild created. Open it and use Create invite to share a link — open join by slug is closed. ${parts.join(" · ")}`;
}

/**
 * Join/leave CTA honesty for private guilds.
 * Public communities do not need this helper.
 */
export function privateGuildJoinCtaCopy(isMember: boolean): string {
  if (isMember) {
    return "Private community — not listed in Discover. Leave uses the real leave API. Owners can create invite links for new members.";
  }
  return "Private community — unlisted from Discover. Open join is closed; redeem an invite link to join.";
}

/** Client path for redeeming a guild invite token. */
export function guildInviteRedeemPath(token: string): string {
  return `/invite/${encodeURIComponent(token)}`;
}

/** Absolute-ish invite URL for clipboard (same origin). */
export function guildInviteShareUrl(token: string, origin?: string): string {
  const path = guildInviteRedeemPath(token);
  if (origin) return `${origin.replace(/\/$/, "")}${path}`;
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${path}`;
  }
  return path;
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
