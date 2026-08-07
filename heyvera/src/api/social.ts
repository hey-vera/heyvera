// ─── Legacy type re-exports (used by page components) ───────────────────────
// These keep existing page components working without import changes to types.ts
import type {
  Post,
  UserProfile,
  CreateUserProfileInput,
  UpdateUserProfileInput,
  Notification,
  Conversation,
  Message,
  ConversationPage,
  MessagePage,
  MessageRequest,
  MessageRequestBucket,
  MessageRequestPage,
  PendingMessageRequestReceipt,
  Community as LegacyCommunity,
  TrendingTopic,
  FeedResponse,
  SearchResults,
} from './types';
import { resolveSocialApiBase as resolveSocialApiBaseFromEnv } from '../utils/apiOrigin';

export type {
  Post,
  UserProfile,
  CreateUserProfileInput,
  UpdateUserProfileInput,
  Notification,
  Conversation,
  ConversationPage,
  Message,
  MessagePage,
  MessageRequest,
  MessageRequestBucket,
  MessageRequestPage,
  TrendingTopic,
  PendingMessageRequestReceipt,
  FeedResponse,
  SearchResults,
};
export type { LegacyCommunity };

// ─── Social API types ───────────────────────────────────────────────────────

export type Profile = {
  id: string;
  /** Internal identity is present only on authenticated owner/admin DTOs. */
  accountId?: string;
  displayName: string;
  handle: string;
  bio: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  location: string | null;
  websiteUrl: string | null;
  proofState: string;
  continuityState: string;
  createdAt: string;
  updatedAt: string;
  /** Present when request is authenticated as a viewer (from profile payload). */
  isFollowing?: boolean;
  isFollowedBy?: boolean;
};

export type LinkedAgent = {
  id: string;
  profileId: string;
  accountId?: string;
  agentName: string;
  agentSlug: string;
  /** Display prefix only (list/public). Full secret is never returned here. */
  agentKeyPrefix?: string;
  /** One-time full secret — present only on create/rotate responses. */
  agentKey?: string;
  agentType: string;
  linkState: string;
  visibility: string;
  proofState: string;
  isPrimary: boolean;
  /**
   * Wave 12a — steward preference for auto-reply. Defaults false.
   * Foundation only: no auto-reply worker runs yet.
   */
  autoReplyEnabled?: boolean;
  /**
   * Wave 12a — steward preference for auto-follow. Defaults false.
   * Foundation only: no auto-follow worker runs yet.
   */
  autoFollowEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Page multi-surface actor (Wave 6). Person = social_profile; agent = linked agent; brand = social_pages. */
export type SocialPageKind = "person" | "agent" | "brand";

export type SocialPage = {
  id: string;
  kind: SocialPageKind;
  handle: string;
  displayName: string;
  avatarUrl?: string | null;
  /** True only for the steward's person profile. */
  isDefault: boolean;
  /** Set for agent/brand pages owned by a person profile. */
  parentProfileId?: string;
  description?: string;
  /** Brand public slug (same as handle for brand pages). */
  slug?: string;
  followerCount?: number;
  isFollowing?: boolean;
  isOwner?: boolean;
  createdAt?: string;
};

export type CreateAuthorship = {
  authorMode: "person" | "agent" | "linked_pair";
  linkedAgentId?: string;
  pageId: string;
};

/** localStorage key for last-selected Page in compose. */
export const ACTIVE_PAGE_STORAGE_KEY = "heyvera-active-page-id";

/**
 * Map a selected Page to createPost authorship fields.
 * Brand posts as steward person in v1 (brand-as-author not complete).
 */
export function resolveCreateAuthorship(page: SocialPage): CreateAuthorship {
  if (page.kind === "agent") {
    return {
      authorMode: "agent",
      linkedAgentId: page.id,
      pageId: page.id,
    };
  }
  // person + brand → person authorship under steward profile
  return {
    authorMode: "person",
    pageId: page.id,
  };
}

/** Media object as returned on create/feed when attached (backend social_get_post_media). */
export type FeedPostMedia = {
  id: string;
  url: string;
  mediaType?: string;
  contentType?: string;
  filename?: string;
  sizeBytes?: number;
  position?: number;
  altText?: string | null;
  width?: number;
  height?: number;
  thumbnailUrl?: string | null;
};

export type FeedPost = {
  id: string;
  body: string;
  visibility: string;
  proofState: string;
  authorMode: "person" | "agent" | "linked_pair";
  replyToPostId: string | null;
  quotePostId: string | null;
  /**
   * Nested quoted post when BE enrich attaches it (feed / thread / create).
   * Absent when the target is missing/deleted — do not invent a shell client-side.
   */
  quotePost?: FeedPost | null;
  createdAt: string;
  updatedAt: string;
  author: {
    profileId: string;
    handle: string;
    displayName: string;
    avatar_url?: string | null;
  };
  linkedAgent: {
    id: string;
    agentName: string;
    agentSlug: string;
  } | null;
  media?: FeedPostMedia[];
  // Engagement counts (returned by backend when available)
  likeCount?: number;
  repostCount?: number;
  bookmarkCount?: number;
  replyCount?: number;
  viewCount?: number;
  // Viewer state
  liked?: boolean;
  bookmarked?: boolean;
  reposted?: boolean;
};

export type Community = {
  id: string;
  slug: string;
  name: string;
  description: string;
  visibility: string;
  createdAt: string;
  updatedAt: string;
  creator: {
    profileId: string;
    handle: string;
    displayName: string;
  };
  /** Present on /communities/mine — owner | member. */
  role?: string;
};

export type LongformEntry = {
  id: string;
  title: string;
  summary: string;
  body: string;
  formatType: string;
  visibility: string;
  proofState: string;
  authorMode: "person" | "agent" | "linked_pair";
  createdAt: string;
  updatedAt: string;
  author: {
    profileId: string;
    handle: string;
    displayName: string;
  };
  linkedAgent: {
    id: string;
    agentName: string;
    agentSlug: string;
  } | null;
};

/** Wave 11b — Page-owned empty media shelf (no items yet). */
export type MediaShelf = {
  id: string;
  ownerProfileId: string;
  title: string;
  description: string;
  /** Always 0 until shelf items ship — never invent cards. */
  itemCount: number;
  createdAt: string;
};

/**
 * Wave 14i LiveSession — real DB phase; provider URLs deferred (Wave 14k).
 * - phase "live" is real server state (not FE theater).
 * - ingestUrl / playbackUrl may be null even when phase is live.
 * - LIVE badge only when phase === "live"; prefer playbackUrl when present for player.
 */
export type LiveSessionPhase = "preview" | "scheduled" | "live" | "ended";

export type LiveSession = {
  id: string;
  ownerProfileId: string;
  title: string;
  description: string;
  phase: LiveSessionPhase;
  ingestUrl: string | null;
  playbackUrl: string | null;
  provider: string;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  owner?: {
    profileId: string;
    handle: string;
    displayName: string;
  };
  notes?: string;
};

export type CommunityMembership = Community & {
  joinedAt: string;
  role?: string;
};

/** Member row from GET /communities/{id}/members. */
export type CommunityMember = {
  profileId: string;
  handle: string;
  displayName: string;
  avatarUrl?: string | null;
  joinedAt: string;
  role?: string;
};

/** Invite metadata (token only present once on create). */
export type CommunityInvite = {
  id: string;
  communityId: string;
  createdByProfileId?: string;
  maxUses?: number | null;
  useCount: number;
  expiresAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
  /** Plaintext token — only on create response. */
  token?: string;
};

export type PageInfo = {
  limit: number;
  nextCursor: string | null;
};

export type ProfileStats = {
  postCount: number;
  followerCount: number;
  followingCount: number;
  linkedAgentCount: number;
  communityCount: number;
  longformCount: number;
};

export type ProfileSummary = {
  id: string;
  accountId?: string;
  displayName: string;
  handle: string;
  bio: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  location: string | null;
  websiteUrl: string | null;
  proofState: string;
  continuityState: string;
  createdAt: string;
  updatedAt: string;
  primaryAgent: {
    agentName: string;
    agentSlug: string;
    linkState: string;
  } | null;
};

// ─── API base URL ────────────────────────────────────────────────────────────
// VITE_API_URL may be empty (same-origin), an origin (https://api…), or already `/v1`.
// Empty → Vite dual proxy / Caddy apex → heyvera-server :3002 for /v1/social/*.
const API_BASE = resolveSocialApiBaseFromEnv(
  import.meta.env.VITE_API_URL as string | undefined,
);

function resolveMediaDeliveryUrl(url: string): string {
  if (!url.startsWith('/v1/social/') || !/^https?:\/\//i.test(API_BASE)) return url;
  return `${new URL(API_BASE).origin}${url}`;
}

// ─── Fetch helpers ───────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function apiAuthFetch<T>(
  path: string,
  options: {
    method: string;
    token: string;
    body?: unknown;
  },
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.token}`,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      `[${res.status}] ${(err as { error?: string }).error ?? res.statusText}`,
    );
  }
  // 204 No Content
  if (res.status === 204) return undefined as T;
  // Prefer json() when available (tests often mock only json).
  if (typeof res.json === "function" && typeof res.text !== "function") {
    return res.json() as Promise<T>;
  }
  const text = typeof res.text === "function" ? await res.text() : "";
  if (!text) {
    if (typeof res.json === "function") {
      try {
        return (await res.json()) as T;
      } catch {
        return undefined as T;
      }
    }
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

/** Build feed query params with an opaque string cursor (never coerce to Number). */
function feedQueryParams(limit: number, cursor?: string | null, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value) params.set(key, value);
    }
  }
  return params.toString();
}

// ─── Public endpoints ────────────────────────────────────────────────────────

export async function fetchProfile(
  handle: string,
  token?: string | null,
): Promise<{
  profile: Profile;
}> {
  // Backend mounts public profiles at /users/{handle} (object may be bare or wrapped).
  // Pass token when available so BE can attach isFollowing / isFollowedBy.
  const raw = await apiFetch<Profile & { profile?: Profile; isFollowing?: boolean; isFollowedBy?: boolean }>(
    `/users/${handle}`,
    token,
  );
  const profile = (raw as { profile?: Profile }).profile ?? (raw as Profile);
  // Ensure viewer flags bubble up even when wrapped under `.profile`.
  if (profile && raw.isFollowing !== undefined && profile.isFollowing === undefined) {
    profile.isFollowing = raw.isFollowing;
  }
  if (profile && raw.isFollowedBy !== undefined && profile.isFollowedBy === undefined) {
    profile.isFollowedBy = raw.isFollowedBy;
  }
  return { profile };
}

export async function fetchProfileWithLinkedAgents(handle: string): Promise<{
  profile: Profile;
  linkedAgents: LinkedAgent[];
}> {
  // Prefer /users/{handle}; linked-agents route is optional / may be empty.
  const { profile } = await fetchProfile(handle);
  try {
    const agents = await apiFetch<{ linkedAgents?: LinkedAgent[] }>(
      `/profiles/${handle}/linked-agents`,
    );
    return { profile, linkedAgents: agents.linkedAgents ?? [] };
  } catch {
    return { profile, linkedAgents: [] };
  }
}

export async function fetchFeaturedProfile(): Promise<{
  profile: Profile;
  linkedAgents: LinkedAgent[];
}> {
  return apiFetch(`/profiles/featured`);
}

export async function fetchHomeFeed(
  limit = 20,
  cursor: string | null = null,
  filter?: string,
  token?: string | null,
): Promise<{
  feed: FeedPost[];
  pageInfo: PageInfo;
}> {
  // Following feed is a separate authenticated route (not author_mode filter).
  if (filter === "following") {
    if (!token) {
      return { feed: [], pageInfo: { limit, nextCursor: null } };
    }
    const qs = feedQueryParams(limit, cursor);
    const raw = await apiAuthFetch<{
      posts: FeedPost[];
      cursor: string | null;
      has_more: boolean;
    }>(`/feed/following?${qs}`, { method: "GET", token });
    return {
      feed: raw.posts ?? [],
      pageInfo: { limit, nextCursor: raw.cursor ?? null },
    };
  }
  const extra =
    filter && filter !== "all" ? { filter } : undefined;
  const qs = feedQueryParams(limit, cursor, extra);
  // Pass Authorization when available so BE can enrich viewer liked/reposted/bookmarked.
  const raw = await apiFetch<{ posts: FeedPost[]; cursor: string | null; has_more: boolean }>(
    `/feed/home?${qs}`,
    token,
  );
  return { feed: raw.posts ?? [], pageInfo: { limit, nextCursor: raw.cursor ?? null } };
}

export async function fetchProfileFeed(
  handle: string,
  limit = 20,
  cursor: string | null = null,
  token?: string | null,
): Promise<{
  profile: Profile;
  feed: FeedPost[];
  pageInfo: PageInfo;
}> {
  const qs = feedQueryParams(limit, cursor);
  const raw = await apiFetch<{
    profile?: Profile;
    posts: FeedPost[];
    cursor: string | null;
    has_more: boolean;
  }>(`/users/${handle}/posts?${qs}`, token);
  return {
    profile: raw.profile as Profile,
    feed: raw.posts ?? [],
    pageInfo: { limit, nextCursor: raw.cursor ?? null },
  };
}

export async function fetchProfileStats(handle: string, token?: string | null): Promise<{
  stats: ProfileStats;
}> {
  return apiFetch(`/profiles/${handle}/stats`, token);
}

export async function fetchProfiles(limit = 20, token?: string | null): Promise<{
  profiles: ProfileSummary[];
}> {
  return apiFetch(`/profiles?limit=${limit}`, token);
}

export async function fetchCommunities(limit = 20): Promise<{
  communities: Community[];
}> {
  return apiFetch(`/communities?limit=${limit}`);
}

export async function fetchLongform(limit = 20, cursor: string | null = null): Promise<{
  longform: LongformEntry[];
  pageInfo: PageInfo;
}> {
  const qs = feedQueryParams(limit, cursor);
  const raw = await apiFetch<{ longform?: LongformEntry[]; posts?: LongformEntry[]; cursor: string | null }>(`/longform?${qs}`);
  return { longform: raw.longform ?? raw.posts ?? [], pageInfo: { limit, nextCursor: raw.cursor ?? null } };
}

export async function fetchCommunityFeed(
  communityId: string,
  limit = 20,
  cursor: string | null = null,
  token?: string | null,
): Promise<{
  community: Community;
  feed: FeedPost[];
  pageInfo: PageInfo;
}> {
  // Backend path is /communities/{id}/feed (id, not slug).
  const qs = feedQueryParams(limit, cursor);
  const raw = await apiFetch<{
    community?: Community;
    posts: FeedPost[];
    cursor: string | null;
    has_more: boolean;
  }>(`/communities/${communityId}/feed?${qs}`, token);
  return {
    community: raw.community as Community,
    feed: raw.posts ?? [],
    pageInfo: { limit, nextCursor: raw.cursor ?? null },
  };
}

export async function fetchProfileFollowers(
  handle: string,
  limit = 20,
  cursor: string | null = null,
  token?: string | null,
): Promise<{
  profile: Profile;
  followers: ProfileSummary[];
  pageInfo: PageInfo;
}> {
  const qs = feedQueryParams(limit, cursor);
  const raw = await apiFetch<{ profile?: Profile; followers?: ProfileSummary[]; cursor: string | null }>(
    `/profiles/${handle}/followers?${qs}`,
    token,
  );
  return {
    profile: raw.profile as Profile,
    followers: raw.followers ?? [],
    pageInfo: { limit, nextCursor: raw.cursor ?? null },
  };
}

export async function fetchProfileFollowing(
  handle: string,
  limit = 20,
  cursor: string | null = null,
  token?: string | null,
): Promise<{
  profile: Profile;
  following: ProfileSummary[];
  pageInfo: PageInfo;
}> {
  const qs = feedQueryParams(limit, cursor);
  const raw = await apiFetch<{ profile?: Profile; following?: ProfileSummary[]; cursor: string | null }>(
    `/profiles/${handle}/following?${qs}`,
    token,
  );
  return {
    profile: raw.profile as Profile,
    following: raw.following ?? [],
    pageInfo: { limit, nextCursor: raw.cursor ?? null },
  };
}

// ─── Public: search ─────────────────────────────────────────────────────────

export async function searchSocial(
  query: string,
  type: "all" | "posts" | "profiles" = "all",
  token?: string | null,
): Promise<{
  posts: FeedPost[];
  profiles: Array<{ id: string; handle: string; displayName: string; avatarUrl: string | null; bio: string }>;
}> {
  const params = new URLSearchParams({ q: query });
  if (type !== "all") params.set("type", type);
  // Surface errors to callers (ExplorePage shows ErrorState) — do not swallow.
  return apiFetch(`/search?${params.toString()}`, token);
}

// ─── Public: trending ───────────────────────────────────────────────────────

export async function fetchTrending(): Promise<{
  topics: Array<{ tag: string; postCount: number }>;
}> {
  try {
    return await apiFetch("/trending");
  } catch {
    return { topics: [] };
  }
}

// ─── Authenticated: notifications ───────────────────────────────────────────

export type SocialNotification = {
  id: string;
  type:
    | "like"
    | "follow"
    | "follow_request"
    | "follow_accepted"
    | "repost"
    | "reply"
    | "mention"
    | "quote";
  actorHandle: string;
  actorDisplayName: string;
  actorAvatarUrl: string | null;
  postId: string | null;
  createdAt: string;
  read?: boolean;
};

/** Raw BE notification shape (snake_case + actors array). */
type BeNotification = {
  id: string;
  type?: string;
  notification_type?: string;
  post?: string | null;
  post_id?: string | null;
  postId?: string | null;
  read?: boolean;
  created_at?: string;
  createdAt?: string;
  actors?: Array<{
    id?: string;
    handle?: string;
    display_name?: string;
    displayName?: string;
    avatar_url?: string | null;
    avatarUrl?: string | null;
  }>;
  actorHandle?: string;
  actorDisplayName?: string;
  actorAvatarUrl?: string | null;
};

function mapNotification(raw: BeNotification): SocialNotification {
  const actor = raw.actors?.[0];
  const typeRaw = (raw.type ?? raw.notification_type ?? "like").toLowerCase();
  const allowed = new Set(["like", "follow", "repost", "reply", "mention", "quote"]);
  const type = (allowed.has(typeRaw) ? typeRaw : "like") as SocialNotification["type"];

  return {
    id: raw.id,
    type,
    actorHandle: raw.actorHandle ?? actor?.handle ?? "",
    actorDisplayName:
      raw.actorDisplayName ?? actor?.display_name ?? actor?.displayName ?? actor?.handle ?? "Someone",
    actorAvatarUrl:
      raw.actorAvatarUrl ?? actor?.avatar_url ?? actor?.avatarUrl ?? null,
    postId: raw.postId ?? raw.post ?? raw.post_id ?? null,
    createdAt: raw.createdAt ?? raw.created_at ?? new Date().toISOString(),
    read: raw.read,
  };
}

/** Authenticated notification list. Opaque keyset cursor — never Number-coerced. */
export async function fetchNotifications(
  token: string,
  limit = 20,
  cursor?: string | null,
): Promise<{
  notifications: SocialNotification[];
  cursor: string | null;
  has_more: boolean;
}> {
  const qs = feedQueryParams(limit, cursor);
  const raw = await apiAuthFetch<{
    notifications?: BeNotification[];
    cursor?: string | null;
    has_more?: boolean;
  }>(`/notifications?${qs}`, { method: "GET", token });
  return {
    notifications: (raw.notifications ?? []).map(mapNotification),
    cursor: raw.cursor ?? null,
    has_more: raw.has_more ?? Boolean(raw.cursor),
  };
}

/** Mark all notifications as read for the signed-in profile. */
export async function markNotificationsRead(token: string): Promise<{ ok: true; updated?: number }> {
  return apiAuthFetch("/notifications/read", { method: "POST", token });
}

/** Count unread notifications (poll-friendly). Uses list endpoint; filters unread. */
export async function fetchUnreadNotificationCount(token: string): Promise<number> {
  try {
    const result = await fetchNotifications(token);
    return result.notifications.filter((n) => n.read === false).length;
  } catch {
    return 0;
  }
}

// ─── Authenticated: my profile ─────────────────────────────────────────────

export async function fetchMyProfile(token: string): Promise<{
  profile: Profile;
  linkedAgents: LinkedAgent[];
}> {
  // Prefer /me/profile (primary); fall back to /profile/me alias.
  try {
    const res = await apiAuthFetch<
      Profile & { profile?: Profile; linkedAgents?: LinkedAgent[]; error?: string }
    >("/me/profile", { method: "GET", token });
    if (res.error) throw new Error(res.error);
    if (res.profile) {
      return {
        profile: res.profile,
        linkedAgents: res.linkedAgents ?? [],
      };
    }
    // get_me_profile may return the profile object at the top level.
    const { linkedAgents, ...rest } = res as Profile & {
      linkedAgents?: LinkedAgent[];
    };
    if ((rest as Profile).id || (rest as Profile).handle) {
      return { profile: rest as Profile, linkedAgents: linkedAgents ?? [] };
    }
    throw new Error("No profile found");
  } catch (first) {
    const res = await apiAuthFetch<{
      profile?: Profile;
      linkedAgents?: LinkedAgent[];
      error?: string;
    }>("/profile/me", { method: "GET", token });
    if (!res.profile || res.error) {
      throw first instanceof Error ? first : new Error(res.error ?? "No profile found");
    }
    return { profile: res.profile, linkedAgents: res.linkedAgents ?? [] };
  }
}

// ─── Authenticated write endpoints ─────────────────────────────────────────

export async function createProfile(
  token: string,
  data: { handle: string; displayName: string; bio?: string },
): Promise<{ ok: true; profile: Profile }> {
  return apiAuthFetch("/profiles", { method: "POST", token, body: data });
}

export async function updateProfile(
  token: string,
  data: {
    displayName?: string;
    bio?: string;
    avatarUrl?: string;
    bannerUrl?: string;
    location?: string;
    websiteUrl?: string;
  },
): Promise<{ ok: true; profile: Profile }> {
  // BE UpdateProfileRequest accepts camelCase aliases (displayName, avatarUrl, websiteUrl, …).
  const body: Record<string, string> = {};
  if (data.displayName !== undefined) body.displayName = data.displayName;
  if (data.bio !== undefined) body.bio = data.bio;
  if (data.avatarUrl !== undefined) body.avatarUrl = data.avatarUrl;
  if (data.bannerUrl !== undefined) body.bannerUrl = data.bannerUrl;
  if (data.location !== undefined) body.location = data.location;
  if (data.websiteUrl !== undefined) body.websiteUrl = data.websiteUrl;
  return apiAuthFetch("/me/profile", { method: "PATCH", token, body });
}

export type PostAudience =
  | "public"
  | "followers"
  | "mutuals"
  | "guild"
  | "circle"
  | "author-only";

export async function createPost(
  token: string,
  data: {
    body: string;
    visibility?: PostAudience;
    authorMode?: string;
    linkedAgentId?: string;
    /** Page id from listMyPages — maps person/agent/brand → authorship. */
    pageId?: string;
    replyToPostId?: string;
    quotePostId?: string;
    mediaIds?: string[];
    communityId?: string;
  },
): Promise<{ ok: true; post: FeedPost; media?: FeedPostMedia[]; authorMode?: string }> {
  return apiAuthFetch("/posts", { method: "POST", token, body: data });
}

// ─── Pages (Wave 6 multi-surface) ────────────────────────────────────────────

/** List steward person Page + linked agent Pages + brand Pages. */
export async function listMyPages(
  token: string,
): Promise<{ pages: SocialPage[] }> {
  return apiAuthFetch("/pages/mine", { method: "GET", token });
}

/** Create a brand Page owned by the steward profile. */
export async function createBrandPage(
  token: string,
  data: { slug: string; displayName: string; description?: string },
): Promise<{ ok: true; page: SocialPage }> {
  return apiAuthFetch("/pages", {
    method: "POST",
    token,
    body: {
      kind: "brand",
      slug: data.slug,
      displayName: data.displayName,
      description: data.description,
    },
  });
}

/**
 * Public brand Page by slug (GET /pages/{slug}).
 * Optional auth enriches isFollowing / isOwner.
 */
export async function fetchBrandPage(
  slug: string,
  token?: string | null,
): Promise<{ page: SocialPage }> {
  return apiFetch(`/pages/${encodeURIComponent(slug)}`, token);
}

/** Follow a Page by id (brand → page follows; agent → owner profile; person → profile follow). */
export async function followPage(
  token: string,
  pageId: string,
): Promise<{ ok: true; kind?: string }> {
  return apiAuthFetch(`/pages/${encodeURIComponent(pageId)}/follow`, {
    method: "POST",
    token,
  });
}

/** Unfollow a Page by id. */
export async function unfollowPage(
  token: string,
  pageId: string,
): Promise<{ ok: true; kind?: string }> {
  return apiAuthFetch(`/pages/${encodeURIComponent(pageId)}/follow`, {
    method: "DELETE",
    token,
  });
}

// ─── Media upload (presign → PUT → finalize) ────────────────────────────────

export type MediaUploadUrlResponse = {
  upload_url: string;
  media_id: string;
  expires_in: number;
};

export type MediaFinalizeResponse = {
  media_id: string;
  url: string;
  type: string;
};

/** Request a presigned (or mock) upload URL for a local file. */
export async function requestMediaUploadUrl(
  token: string,
  file: File,
): Promise<MediaUploadUrlResponse> {
  return apiAuthFetch("/media/upload-url", {
    method: "POST",
    token,
    body: {
      filename: file.name || "upload.bin",
      content_type: file.type || "application/octet-stream",
      size: file.size,
    },
  });
}

/** PUT file bytes to the upload URL returned by requestMediaUploadUrl. */
export async function putMediaFile(uploadUrl: string, file: File): Promise<void> {
  const absolute = resolveMediaDeliveryUrl(uploadUrl);

  const res = await fetch(absolute, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  if (!res.ok) {
    throw new Error(`Media upload failed (${res.status})`);
  }
}

/** Mark an uploaded media object ready for attach. */
export async function finalizeMedia(
  token: string,
  mediaId: string,
): Promise<MediaFinalizeResponse> {
  return apiAuthFetch(`/media/${mediaId}/finalize`, { method: "POST", token });
}

/**
 * Full client upload pipeline: upload-url → PUT → finalize.
 * Returns the media id to pass as createPost mediaIds.
 */
export async function uploadMediaFile(
  token: string,
  file: File,
): Promise<{ mediaId: string; url: string; type: string }> {
  const { upload_url, media_id } = await requestMediaUploadUrl(token, file);
  await putMediaFile(upload_url, file);
  const finalized = await finalizeMedia(token, media_id);
  return {
    mediaId: finalized.media_id || media_id,
    url: resolveMediaDeliveryUrl(finalized.url),
    type: finalized.type,
  };
}

export async function fetchSinglePost(postId: string, token?: string | null): Promise<{
  post: FeedPost;
  replies: FeedPost[];
  /** True when BE walk stopped early (cap 100 / max depth 8). Missing on older servers. */
  repliesTruncated?: boolean;
  /** Reply list hard cap from BE when present. */
  repliesCap?: number;
}> {
  return apiFetch(`/posts/${postId}`, token);
}

/**
 * Related posts for a thread (Wave 14a).
 * Heuristic: shared hashtags + same author + recency — not AI/ML.
 * Default limit 8; server hard-caps at 20.
 */
export async function fetchRelatedPosts(
  postId: string,
  limit = 8,
  token?: string | null,
): Promise<{ posts: FeedPost[]; sourcePostId?: string }> {
  const capped = Math.min(Math.max(1, limit), 20);
  return apiFetch(`/posts/${encodeURIComponent(postId)}/related?limit=${capped}`, token);
}

export async function fetchFollowStatus(
  token: string,
  handle: string,
): Promise<{ following: boolean; pending?: boolean }> {
  try {
    return await apiAuthFetch(`/follows/${handle}/status`, { method: "GET", token });
  } catch {
    // Status route may be missing; default to not following (UI can still toggle).
    return { following: false, pending: false };
  }
}

export async function followProfile(
  token: string,
  handle: string,
): Promise<{
  ok: true;
  followId?: string;
  requestId?: string;
  state: 'following' | 'pending';
}> {
  return apiAuthFetch(`/follows/${handle}`, { method: "POST", token });
}

export async function unfollowProfile(
  token: string,
  handle: string,
): Promise<{ ok: true; state: string }> {
  return apiAuthFetch(`/follows/${handle}`, { method: "DELETE", token });
}

/** Create a community (POST /communities). May 404 if BE create is not mounted. */
export async function createCommunity(
  token: string,
  data: { slug: string; name: string; description?: string; visibility?: string },
): Promise<{ ok: true; community: Community }> {
  return apiAuthFetch("/communities", { method: "POST", token, body: data });
}

/**
 * Join a community. Backend path is `/communities/{id}/join`.
 * Pass community id (preferred). Slug works only if BE resolves it the same way.
 */
export async function joinCommunity(
  token: string,
  communityIdOrSlug: string,
): Promise<{ ok: true; joined?: boolean; message?: string }> {
  return apiAuthFetch(`/communities/${encodeURIComponent(communityIdOrSlug)}/join`, {
    method: "POST",
    token,
  });
}

/** Leave by community id/slug (DELETE /communities/{id}/leave). */
export async function leaveCommunity(
  token: string,
  communityIdOrSlug: string,
): Promise<{ ok: true; left?: boolean; message?: string }> {
  return apiAuthFetch(`/communities/${encodeURIComponent(communityIdOrSlug)}/leave`, {
    method: "DELETE",
    token,
  });
}

/**
 * Memberships for the signed-in profile (GET /communities/mine).
 * Throws if the route is not mounted — callers should handle and not invent folders.
 */
export async function fetchMyCommunities(token: string, limit = 20): Promise<{
  communities: CommunityMembership[];
}> {
  return apiAuthFetch(`/communities/mine?limit=${limit}`, { method: "GET", token });
}

/**
 * List community members (GET /communities/{id}/members).
 * Private guilds require membership (Bearer token recommended).
 */
export async function fetchCommunityMembers(
  communityIdOrSlug: string,
  limit = 50,
  token?: string | null,
): Promise<{ members: CommunityMember[]; count: number }> {
  const path = `/communities/${encodeURIComponent(communityIdOrSlug)}/members?limit=${limit}`;
  if (token) {
    return apiAuthFetch(path, { method: "GET", token });
  }
  return apiFetch(path);
}

/** Owner: create invite (POST /communities/{id}/invites). Token returned once. */
export async function createCommunityInvite(
  token: string,
  communityIdOrSlug: string,
  data?: { maxUses?: number; expiresInHours?: number },
): Promise<{ ok: true; invite: CommunityInvite }> {
  return apiAuthFetch(
    `/communities/${encodeURIComponent(communityIdOrSlug)}/invites`,
    { method: "POST", token, body: data ?? {} },
  );
}

/** Owner: list invites (GET /communities/{id}/invites) — no tokens. */
export async function fetchCommunityInvites(
  token: string,
  communityIdOrSlug: string,
  limit = 50,
): Promise<{ invites: CommunityInvite[]; count: number }> {
  return apiAuthFetch(
    `/communities/${encodeURIComponent(communityIdOrSlug)}/invites?limit=${limit}`,
    { method: "GET", token },
  );
}

/** Owner: revoke invite (DELETE /communities/{id}/invites/{inviteId}). */
export async function revokeCommunityInvite(
  token: string,
  communityIdOrSlug: string,
  inviteId: string,
): Promise<{ ok: true; revoked?: boolean }> {
  return apiAuthFetch(
    `/communities/${encodeURIComponent(communityIdOrSlug)}/invites/${encodeURIComponent(inviteId)}`,
    { method: "DELETE", token },
  );
}

/** Redeem invite token (POST /invites/{token}/redeem). Joins private guild. */
export async function redeemCommunityInvite(
  token: string,
  inviteToken: string,
): Promise<{
  ok: true;
  joined?: boolean;
  communityId?: string;
  community?: Community;
  message?: string;
}> {
  return apiAuthFetch(`/invites/${encodeURIComponent(inviteToken)}/redeem`, {
    method: "POST",
    token,
  });
}

export async function createLongform(
  token: string,
  data: {
    title: string;
    summary?: string;
    body: string;
    formatType?: string;
    visibility?: string;
    authorMode?: string;
    linkedAgentId?: string;
  },
): Promise<{ ok: true; longform: LongformEntry }> {
  return apiAuthFetch("/longform", { method: "POST", token, body: data });
}

// ─── Wave 11b: Page-owned media shelves (empty foundation) ───────────────────

/** GET /v1/social/shelves/mine — steward's empty shelves (auth required). */
export async function fetchMyShelves(
  token: string,
  limit = 50,
): Promise<{ shelves: MediaShelf[] }> {
  return apiAuthFetch(`/shelves/mine?limit=${limit}`, { method: "GET", token });
}

/** POST /v1/social/shelves — create an empty shelf for the steward person Page. */
export async function createShelf(
  token: string,
  data: { title: string; description?: string },
): Promise<{ ok: true; shelf: MediaShelf }> {
  return apiAuthFetch("/shelves", { method: "POST", token, body: data });
}

// ─── Wave 14i: LiveSession model (real phase; no provider yet) ────────────────

/**
 * GET /v1/social/live/sessions — public phase=live sessions.
 * Pass mine=true + token to also include the caller's preview/ended sessions.
 */
export async function fetchLiveSessions(
  opts: { limit?: number; mine?: boolean; token?: string | null } = {},
): Promise<{ sessions: LiveSession[]; notes?: string }> {
  const limit = opts.limit ?? 20;
  const qs = new URLSearchParams({ limit: String(limit) });
  if (opts.mine) qs.set("mine", "1");
  return apiFetch(`/live/sessions?${qs}`, opts.token);
}

/** GET /v1/social/live/sessions/{id} */
export async function fetchLiveSession(
  id: string,
): Promise<{ session: LiveSession }> {
  return apiFetch(`/live/sessions/${encodeURIComponent(id)}`);
}

/** POST /v1/social/live/sessions — create preview session (auth). */
export async function createLiveSession(
  token: string,
  data: { title: string; description?: string },
): Promise<{ ok: true; session: LiveSession }> {
  return apiAuthFetch("/live/sessions", { method: "POST", token, body: data });
}

/**
 * POST /v1/social/live/sessions/{id}/go-live — owner only.
 * Sets phase=live even when playbackUrl is still null (provider deferred).
 */
export async function goLiveSession(
  token: string,
  id: string,
): Promise<{ ok: true; session: LiveSession; notes?: string }> {
  return apiAuthFetch(`/live/sessions/${encodeURIComponent(id)}/go-live`, {
    method: "POST",
    token,
  });
}

/** POST /v1/social/live/sessions/{id}/end — owner only. */
export async function endLiveSession(
  token: string,
  id: string,
): Promise<{ ok: true; session: LiveSession }> {
  return apiAuthFetch(`/live/sessions/${encodeURIComponent(id)}/end`, {
    method: "POST",
    token,
  });
}

// ─── x402 agent micropayments (Wave 14m/n/o production path + product gate) ─

/** Server mode: disabled | shape_only | facilitator */
export type X402Mode = "disabled" | "shape_only" | "facilitator" | string;

export type X402Status = {
  enabled: boolean;
  network: string;
  /** Present on Wave 14m+ status; older servers may omit. */
  mode?: X402Mode;
  /** Public recipient address only (never a private key). */
  payTo?: string | null;
  note: string;
};

/** GET /v1/social/x402/status — public config honesty (no private keys). */
export async function fetchX402Status(): Promise<X402Status> {
  return apiFetch("/x402/status");
}

/** Response from POST /v1/social/x402/paid-ping (Wave 14o product gate). */
export type X402PaidPingResult = {
  ok: boolean;
  action?: string;
  pong?: boolean;
  mode?: X402Mode;
  settled?: boolean;
  verified?: boolean;
  status?: string;
  receiptId?: string | null;
  idempotencyKey?: string;
  network?: string;
  amount?: string | null;
  reason?: string;
  note?: string;
  message?: string;
  replay?: boolean;
  actor?: string;
};

/**
 * POST /v1/social/x402/paid-ping — authenticated Social product gate.
 *
 * - disabled → 501 payments off
 * - shape_only → accepts shape payment; settled=false
 * - facilitator → requires verified payment; fail-closed 402 otherwise
 *
 * Throws with `[status] reason` when the server rejects (including 402/501).
 */
export async function postX402PaidPing(
  token: string,
  body: {
    payload?: unknown;
    payment?: unknown;
    amount?: string;
    network?: string;
    idempotencyKey?: string;
  } = {},
): Promise<X402PaidPingResult> {
  const res = await fetch(`${API_BASE}/x402/paid-ping`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(body.idempotencyKey
        ? { "Idempotency-Key": body.idempotencyKey }
        : {}),
    },
    body: JSON.stringify({
      payload: body.payload,
      payment: body.payment,
      amount: body.amount,
      network: body.network,
      idempotencyKey: body.idempotencyKey,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as X402PaidPingResult & {
    error?: string;
    reason?: string;
  };
  if (!res.ok) {
    const reason =
      data.reason ?? data.error ?? data.message ?? res.statusText;
    const err = new Error(`[${res.status}] ${reason}`) as Error & {
      status?: number;
      body?: X402PaidPingResult;
    };
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

// ─── Post interactions ──────────────────────────────────────────────────────

export async function likePost(
  token: string,
  postId: string,
): Promise<{ ok: true }> {
  return apiAuthFetch(`/posts/${postId}/like`, { method: "POST", token });
}

export async function unlikePost(
  token: string,
  postId: string,
): Promise<{ ok: true }> {
  return apiAuthFetch(`/posts/${postId}/like`, { method: "DELETE", token });
}

export async function bookmarkPost(
  token: string,
  postId: string,
): Promise<{ ok: true }> {
  return apiAuthFetch(`/posts/${postId}/bookmark`, { method: "POST", token });
}

export async function unbookmarkPost(
  token: string,
  postId: string,
): Promise<{ ok: true }> {
  return apiAuthFetch(`/posts/${postId}/bookmark`, { method: "DELETE", token });
}

/** Authenticated list of posts bookmarked by the viewer. Opaque keyset cursor. */
export async function fetchBookmarks(
  token: string,
  limit = 20,
  cursor?: string | null,
): Promise<{
  posts: FeedPost[];
  cursor: string | null;
  has_more: boolean;
}> {
  const qs = feedQueryParams(limit, cursor);
  const raw = await apiAuthFetch<{
    posts?: FeedPost[];
    cursor?: string | null;
    has_more?: boolean;
  }>(`/bookmarks?${qs}`, { method: "GET", token });
  return {
    posts: raw.posts ?? [],
    cursor: raw.cursor ?? null,
    has_more: raw.has_more ?? Boolean(raw.cursor),
  };
}

export async function repostPost(
  token: string,
  postId: string,
): Promise<{ ok: true }> {
  return apiAuthFetch(`/posts/${postId}/repost`, { method: "POST", token });
}

export async function unrepostPost(
  token: string,
  postId: string,
): Promise<{ ok: true }> {
  return apiAuthFetch(`/posts/${postId}/repost`, { method: "DELETE", token });
}

/** Soft-delete own post (DELETE /v1/social/posts/{id}). Author-only on the server. */
export async function deletePost(
  token: string,
  postId: string,
): Promise<{ ok: true }> {
  return apiAuthFetch(`/posts/${postId}`, { method: "DELETE", token });
}

// ─── Privacy prefs (Batch B1) ──────────────────────────────────────────────

export type SocialPrefsResponse = {
  profileId?: string;
  dmPolicy: string;
  discoverableByContact: boolean;
  showInSearch: boolean;
  protectedPosts: boolean;
  profileVisibility: string;
  allowAgentDms: boolean;
  allowAgentMentions: boolean;
};

export async function fetchMyPrefs(token: string): Promise<SocialPrefsResponse> {
  return apiAuthFetch("/me/prefs", { method: "GET", token });
}

export async function updateMyPrefs(
  token: string,
  patch: Record<string, unknown>,
): Promise<SocialPrefsResponse> {
  return apiAuthFetch("/me/prefs", { method: "PATCH", token, body: patch });
}

// ─── Moderation ────────────────────────────────────────────────────────────

export type ModerationListEntry = {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt?: string;
};

export async function blockUser(
  token: string,
  userId: string,
): Promise<{ ok: true }> {
  return apiAuthFetch(`/users/${userId}/block`, { method: "POST", token });
}

export async function unblockUser(
  token: string,
  userId: string,
): Promise<{ ok: true }> {
  return apiAuthFetch(`/users/${userId}/block`, { method: "DELETE", token });
}

export async function muteUser(
  token: string,
  userId: string,
): Promise<{ ok: true }> {
  return apiAuthFetch(`/users/${userId}/mute`, { method: "POST", token });
}

export async function unmuteUser(
  token: string,
  userId: string,
): Promise<{ ok: true }> {
  return apiAuthFetch(`/users/${userId}/mute`, { method: "DELETE", token });
}

export async function reportContent(
  token: string,
  data: { targetType: string; targetId: string; reason: string },
): Promise<{ ok: true } | Record<string, unknown>> {
  return apiAuthFetch("/report", { method: "POST", token, body: data });
}

export async function fetchMyBlocks(
  token: string,
): Promise<{ blocks: ModerationListEntry[] }> {
  return apiAuthFetch("/me/blocks", { method: "GET", token });
}

export async function fetchMyMutes(
  token: string,
): Promise<{ mutes: ModerationListEntry[] }> {
  return apiAuthFetch("/me/mutes", { method: "GET", token });
}

// ─── Linked agents ─────────────────────────────────────────────────────────

/** List linked agents for the signed-in profile. */
export async function fetchMyLinkedAgents(
  token: string,
): Promise<{ linkedAgents: LinkedAgent[] }> {
  return apiAuthFetch("/linked-agents", { method: "GET", token });
}

export async function linkAgent(
  token: string,
  data: {
    agentName: string;
    agentSlug: string;
    /** Ignored by server for secret generation; kept for API compat. */
    agentKey?: string;
    agentType?: string;
    visibility?: string;
    proofState?: string;
    isPrimary?: boolean;
  },
): Promise<{ ok: true; linkedAgent: LinkedAgent }> {
  return apiAuthFetch("/linked-agents", {
    method: "POST",
    token,
    body: {
      agentName: data.agentName,
      agentSlug: data.agentSlug,
      agentType: data.agentType ?? "general",
      visibility: data.visibility,
      proofState: data.proofState,
      isPrimary: data.isPrimary,
    },
  });
}

/** Rotate the API key for a linked agent. Returns the new plaintext key once. */
export async function rotateLinkedAgentKey(
  token: string,
  agentId: string,
): Promise<{ ok: true; linkedAgent: LinkedAgent }> {
  return apiAuthFetch(`/linked-agents/${encodeURIComponent(agentId)}/rotate-key`, {
    method: "POST",
    token,
  });
}

/**
 * PATCH /v1/social/linked-agents/{id} — steward-gated policy flags (Wave 12a).
 * Flags persist only; API note reminds that auto-reply/follow is not live runtime.
 */
export async function updateLinkedAgentPolicies(
  token: string,
  agentId: string,
  data: {
    autoReplyEnabled?: boolean;
    autoFollowEnabled?: boolean;
  },
): Promise<{ ok: true; linkedAgent: LinkedAgent; note?: string }> {
  return apiAuthFetch(`/linked-agents/${encodeURIComponent(agentId)}`, {
    method: "PATCH",
    token,
    body: {
      autoReplyEnabled: data.autoReplyEnabled,
      autoFollowEnabled: data.autoFollowEnabled,
    },
  });
}

// ─── Shared adapter: FeedPost → legacy Post ─────────────────────────────────

function mapFeedMediaType(mediaType?: string, contentType?: string): 'image' | 'video' | 'gif' {
  const raw = (mediaType ?? contentType ?? 'image').toLowerCase();
  if (raw.includes('gif')) return 'gif';
  if (raw.includes('video')) return 'video';
  return 'image';
}

/** Map a real-API FeedPost into the legacy Post shape that PostCard expects. */
export function feedPostToPost(fp: FeedPost): Post {
  // Feed list enrichment does not always include media yet; map when present.
  const media = fp.media?.length
    ? fp.media.map((m) => ({
        id: m.id,
        type: mapFeedMediaType(m.mediaType, m.contentType),
        url: resolveMediaDeliveryUrl(m.url),
        thumbnail_url: m.thumbnailUrl ?? undefined,
        width: m.width ?? 0,
        height: m.height ?? 0,
        alt_text: m.altText ?? undefined,
      }))
    : undefined;

  const linkedAgent = fp.linkedAgent
    ? {
        id: fp.linkedAgent.id,
        agent_name: fp.linkedAgent.agentName,
        agent_slug: fp.linkedAgent.agentSlug,
      }
    : undefined;

  // Nested quote from BE enrich only — never fabricate a card without backend data.
  const quote_post = fp.quotePost ? feedPostToPost(fp.quotePost) : undefined;

  return {
    id: fp.id,
    author: {
      id: fp.author.profileId,
      display_name: fp.author.displayName,
      handle: fp.author.handle,
      avatar_url: fp.author.avatar_url ?? '',
      verified: false,
    },
    content: fp.body,
    ...(media ? { media } : {}),
    ...(linkedAgent ? { linked_agent: linkedAgent } : {}),
    ...(quote_post ? { quote_post } : {}),
    created_at: fp.createdAt,
    reply_count: fp.replyCount ?? 0,
    repost_count: fp.repostCount ?? 0,
    like_count: fp.likeCount ?? 0,
    // Prefer real view counts when BE sends them; otherwise 0 (PostCard hides vanity zeros).
    view_count: fp.viewCount ?? 0,
    bookmarked: fp.bookmarked ?? false,
    liked: fp.liked ?? false,
    reposted: fp.reposted ?? false,
    reply_to: fp.replyToPostId ?? undefined,
  };
}

// ─── Compatibility wrappers (single client base) ────────────────────────────
// All paths are relative to API_BASE (/v1/social). Prefer modern helpers above
// for new code; these remain for older page call sites.

function legacyJsonHeaders(headers?: HeadersInit): Headers {
  const next = new Headers(headers);
  if (!next.has('Content-Type')) next.set('Content-Type', 'application/json');
  return next;
}

async function legacyFetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) throw new Error(`API ${res.status}`);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function legacyFetchAuthedApi<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`API ${res.status}`);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function legacyFetchOptionalAuthedApi<T>(path: string, token: string, init?: RequestInit): Promise<T | null> {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json() as Promise<T>;
}

function compactUpdateUserProfileInput(input: UpdateUserProfileInput): UpdateUserProfileInput {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as UpdateUserProfileInput;
}

/** Current signed-in viewer's profile, or null when none exists yet */
export async function getCurrentUserProfile(token: string): Promise<UserProfile | null> {
  return legacyFetchOptionalAuthedApi<UserProfile>('/me/profile', token);
}

/** Create the signed-in viewer's profile */
export async function createUserProfile(token: string, input: CreateUserProfileInput): Promise<UserProfile> {
  return legacyFetchAuthedApi<UserProfile>('/me/profile', token, {
    method: 'POST',
    headers: legacyJsonHeaders(),
    body: JSON.stringify(input),
  });
}

/** Update the signed-in viewer's profile */
export async function updateCurrentUserProfile(token: string, input: UpdateUserProfileInput): Promise<UserProfile> {
  const updates = compactUpdateUserProfileInput(input);
  return legacyFetchAuthedApi<UserProfile>('/me/profile', token, {
    method: 'PATCH',
    headers: legacyJsonHeaders(),
    body: JSON.stringify(updates),
  });
}

/** Home / for-you feed */
export async function getFeed(cursor?: string, token?: string): Promise<FeedResponse> {
  const path = `/feed/home${cursor ? `?cursor=${cursor}` : ''}`;
  return token ? legacyFetchAuthedApi<FeedResponse>(path, token) : legacyFetchApi<FeedResponse>(path);
}

/** Following-only feed */
export async function getFollowingFeed(cursor?: string, token?: string): Promise<FeedResponse> {
  const path = `/feed/following${cursor ? `?cursor=${cursor}` : ''}`;
  return token ? legacyFetchAuthedApi<FeedResponse>(path, token) : legacyFetchApi<FeedResponse>(path);
}

/** Single post by ID */
export async function getPost(id: string, token?: string): Promise<Post> {

  return token ? legacyFetchAuthedApi<Post>(`/posts/${id}`, token) : legacyFetchApi<Post>(`/posts/${id}`);
}

/** Create a new post (legacy FormData interface) */
export async function legacyCreatePost(content: string, media?: File[], token?: string): Promise<Post> {

  if (!token) throw new Error('Auth token required');
  const form = new FormData();
  form.append('content', content);
  if (media) media.forEach(f => form.append('media', f));
  return legacyFetchAuthedApi<Post>('/posts', token, { method: 'POST', body: form });
}

/** Get notifications for the current user */
export async function getNotifications(token?: string): Promise<Notification[]> {

  if (!token) throw new Error('Auth token required');
  return legacyFetchAuthedApi<Notification[]>('/notifications', token);
}

/** Get one confidential inbox page. */
export async function getConversations(
  token?: string,
  options: { limit?: number; cursor?: string | null } = {},
): Promise<ConversationPage> {
  if (!token) throw new Error('Auth token required');
  const limit = options.limit ?? 30;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Conversation page limit must be between 1 and 100');
  }
  const params = new URLSearchParams({ limit: String(limit) });
  if (options.cursor) params.set('cursor', options.cursor);
  const response = await legacyFetchAuthedApi<Partial<ConversationPage>>(
    `/conversations?${params.toString()}`,
    token,
  );
  const nextCursor = response.next_cursor ?? null;
  return {
    conversations: response.conversations ?? [],
    next_cursor: nextCursor,
    has_more: response.has_more ?? nextCursor !== null,
    total_unread_count: response.total_unread_count ?? 0,
  };
}

/** Hydrate one accessible conversation, including deep links outside page one. */
export async function getConversation(
  token: string,
  conversationId: string,
): Promise<Conversation> {
  return legacyFetchAuthedApi<Conversation>(
    `/conversations/${encodeURIComponent(conversationId)}`,
    token,
  );
}

/** Get the uncapped inbox unread total used by global navigation badges. */
export async function getConversationUnreadCount(token: string): Promise<number> {
  const response = await legacyFetchAuthedApi<{ unread_count?: number }>(
    '/conversations/unread-count',
    token,
  );
  return response.unread_count ?? 0;
}
export type DirectMessageStartResult =
  | {
      kind: 'conversation';
      conversation: Conversation;
      message: Message;
      replayed: boolean;
    }
  | {
      kind: 'request';
      request: PendingMessageRequestReceipt;
      replayed: boolean;
    };

/** Start a direct conversation or create one pending message request atomically. */
export async function startDirectMessage(
  token: string,
  input: { recipientId: string; content: string; clientRequestId: string },
): Promise<DirectMessageStartResult> {
  return apiAuthFetch<DirectMessageStartResult>('/direct-message-starts', {
    method: 'POST',
    token,
    body: {
      recipient_id: input.recipientId,
      content: input.content,
      client_request_id: input.clientRequestId,
    },
  });
}

/** List one stable page of pending or spam-filtered inbound message requests. */
export async function getMessageRequests(
  token: string,
  options: { bucket?: MessageRequestBucket; limit?: number; cursor?: string | null } = {},
): Promise<MessageRequestPage> {
  const bucket = options.bucket ?? 'inbox';
  const limit = options.limit ?? 30;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Message request page limit must be between 1 and 100');
  }
  const params = new URLSearchParams({ bucket, limit: String(limit) });
  if (options.cursor) params.set('cursor', options.cursor);
  const response = await apiAuthFetch<Partial<MessageRequestPage>>(
    `/message-requests?${params.toString()}`,
    { method: 'GET', token },
  );
  const nextCursor = response.next_cursor ?? null;
  return {
    requests: response.requests ?? [],
    total_pending_count: response.total_pending_count ?? 0,
    next_cursor: nextCursor,
    has_more: response.has_more ?? nextCursor !== null,
  };
}

export type ResolvedMessageRequestReceipt = {
  id: string;
  state: 'accepted' | 'declined' | 'spam' | 'cancelled';
  created_at: string;
  resolved_at: string | null;
};

export type AcceptMessageRequestResult = {
  request: ResolvedMessageRequestReceipt;
  conversation: Conversation;
  message: Message;
  replayed: boolean;
};

/** Accept a pending inbound request and return the now-active conversation. */
export async function acceptMessageRequest(
  token: string,
  requestId: string,
): Promise<AcceptMessageRequestResult> {
  return apiAuthFetch<AcceptMessageRequestResult>(
    `/message-requests/${encodeURIComponent(requestId)}/accept`,
    { method: 'POST', token },
  );
}

export type ResolveMessageRequestResult = {
  request: ResolvedMessageRequestReceipt;
  conversation: null;
  message: null;
  replayed: boolean;
};

export type CancelMessageRequestResult = {
  request: ResolvedMessageRequestReceipt;
  replayed: boolean;
};

/** Decline a pending inbound request without creating a conversation. */
export async function declineMessageRequest(
  token: string,
  requestId: string,
): Promise<ResolveMessageRequestResult> {
  return apiAuthFetch<ResolveMessageRequestResult>(
    `/message-requests/${encodeURIComponent(requestId)}/decline`,
    { method: 'POST', token },
  );
}

/** Mark a pending inbound request as spam and remove it from the inbox. */
export async function markMessageRequestSpam(
  token: string,
  requestId: string,
): Promise<ResolveMessageRequestResult> {
  return apiAuthFetch<ResolveMessageRequestResult>(
    `/message-requests/${encodeURIComponent(requestId)}/spam`,
    { method: 'POST', token },
  );
}

/** Cancel one pending request created by the authenticated sender. */
export async function cancelMessageRequest(
  token: string,
  requestId: string,
): Promise<CancelMessageRequestResult> {
  return apiAuthFetch<CancelMessageRequestResult>(
    `/message-requests/${encodeURIComponent(requestId)}`,
    { method: 'DELETE', token },
  );
}
/**
 * Start or open a DM. POST /v1/social/conversations with participant_ids
 * (other profile ids; server adds the viewer).
 */
export async function createConversation(
  token: string,
  participantIds: string[],
): Promise<Conversation> {
  return apiAuthFetch<Conversation>('/conversations', {
    method: 'POST',
    token,
    body: { participant_ids: participantIds },
  });
}

/** Get a newest-first page boundary, returned in chronological display order. */
export async function getMessages(
  conversationId: string,
  token?: string,
  options: { limit?: number; cursor?: string | null; afterCursor?: string | null } = {},
): Promise<MessagePage> {
  if (!token) throw new Error('Auth token required');
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Message page limit must be between 1 and 100');
  }
  if (options.cursor && options.afterCursor) {
    throw new Error('Message cursor and after cursor are mutually exclusive');
  }
  const params = new URLSearchParams({ limit: String(limit) });
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.afterCursor) params.set('after_cursor', options.afterCursor);
  const id = encodeURIComponent(conversationId);
  const res = await legacyFetchAuthedApi<Partial<MessagePage>>(
    `/conversations/${id}/messages?${params.toString()}`,
    token,
  );
  const nextCursor = res.next_cursor ?? null;
  const syncCursor = res.sync_cursor ?? null;
  return {
    messages: res.messages ?? [],
    next_cursor: nextCursor,
    has_more: res.has_more ?? nextCursor !== null,
    sync_cursor: syncCursor,
  };
}

export type MarkConversationReadResult = {
  ok: true;
  through_message_id: string;
  unread_count: number;
};

/** Advance only the authenticated participant's read watermark. */
export async function markConversationRead(
  token: string,
  conversationId: string,
  throughMessageId: string,
): Promise<MarkConversationReadResult> {
  return apiAuthFetch<MarkConversationReadResult>(
    `/conversations/${encodeURIComponent(conversationId)}/read`,
    {
      method: 'POST',
      token,
      body: { through_message_id: throughMessageId },
    },
  );
}

export const SOCIAL_DM_MAX_MESSAGE_CHARS = 4_000;

/** POST a DM message. Uses shared social API base (resolveSocialApiBase). */
export async function sendMessage(
  token: string,
  conversationId: string,
  content: string,
  clientMessageId: string,
): Promise<Message> {
  return apiAuthFetch<Message>(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    token,
    body: { content, client_message_id: clientMessageId },
  });
}

export type FollowRequest = {
  id: string;
  status: 'pending';
  createdAt: string;
  requester: {
    id: string;
    handle: string;
    displayName: string;
    avatarUrl: string | null;
  };
};

export async function fetchFollowRequests(
  token: string,
  limit = 50,
): Promise<{ requests: FollowRequest[] }> {
  return apiAuthFetch(`/follow-requests?limit=${limit}`, { method: 'GET', token });
}

export async function approveFollowRequest(
  token: string,
  requestId: string,
): Promise<{ ok: true; state: 'accepted' }> {
  return apiAuthFetch(`/follow-requests/${encodeURIComponent(requestId)}/approve`, {
    method: 'POST',
    token,
  });
}

export async function rejectFollowRequest(
  token: string,
  requestId: string,
): Promise<{ ok: true; state: 'rejected' }> {
  return apiAuthFetch(`/follow-requests/${encodeURIComponent(requestId)}`, {
    method: 'DELETE',
    token,
  });
}

/** Mint a short-lived, single-use credential for the DM WebSocket handshake. */
export async function issueSocialDmWsTicket(token: string): Promise<string> {
  const response = await apiAuthFetch<{ ticket: string; expiresInSeconds: number }>(
    '/ws-ticket',
    { method: 'POST', token },
  );
  if (!response.ticket || !response.ticket.startsWith('hvws_')) {
    throw new Error('Realtime ticket response was invalid');
  }
  return response.ticket;
}

/** Full-text search across posts, users, and communities */
export async function searchAll(query: string, token?: string): Promise<SearchResults> {

  const path = `/search?q=${encodeURIComponent(query)}`;
  return token ? legacyFetchAuthedApi<SearchResults>(path, token) : legacyFetchApi<SearchResults>(path);
}

/** Trending topics */
export async function getTrending(): Promise<TrendingTopic[]> {

  return legacyFetchApi<TrendingTopic[]>('/trending');
}

/** User profile by handle */
export async function getUserProfile(handle: string, token?: string): Promise<UserProfile> {

  return token ? legacyFetchAuthedApi<UserProfile>(`/users/${handle}`, token) : legacyFetchApi<UserProfile>(`/users/${handle}`);
}

/** Posts for a user profile */
export async function getProfilePosts(handle: string, cursor?: string, token?: string): Promise<FeedResponse> {

  const path = `/users/${handle}/posts${cursor ? `?cursor=${cursor}` : ''}`;
  return token ? legacyFetchAuthedApi<FeedResponse>(path, token) : legacyFetchApi<FeedResponse>(path);
}

/** Follow a user */
export async function followUser(handle: string, token?: string): Promise<void> {

  if (!token) throw new Error('Auth token required');
  return legacyFetchAuthedApi<void>(`/follows/${handle}`, token, { method: 'POST' });
}

/** Unfollow a user */
export async function unfollowUser(handle: string, token?: string): Promise<void> {

  if (!token) throw new Error('Auth token required');
  return legacyFetchAuthedApi<void>(`/follows/${handle}`, token, { method: 'DELETE' });
}

/** All communities (legacy type) */
export async function getCommunities(): Promise<LegacyCommunity[]> {

  return legacyFetchApi<LegacyCommunity[]>('/communities');
}

/** Posts in a community */
export async function getCommunityFeed(id: string, cursor?: string, token?: string): Promise<FeedResponse> {

  const path = `/communities/${id}/feed${cursor ? `?cursor=${cursor}` : ''}`;
  return token ? legacyFetchAuthedApi<FeedResponse>(path, token) : legacyFetchApi<FeedResponse>(path);
}
