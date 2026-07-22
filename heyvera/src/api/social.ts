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
  Community as LegacyCommunity,
  TrendingTopic,
  FeedResponse,
  SearchResults,
} from './types';

export type {
  Post,
  UserProfile,
  CreateUserProfileInput,
  UpdateUserProfileInput,
  Notification,
  Conversation,
  Message,
  TrendingTopic,
  FeedResponse,
  SearchResults,
};
export type { LegacyCommunity };

// ─── Social API types ───────────────────────────────────────────────────────

export type Profile = {
  id: string;
  accountId: string;
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

export type CommunityMembership = Community & {
  joinedAt: string;
  role?: string;
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
  accountId: string;
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
function resolveSocialApiBase(): string {
  const raw = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
  if (!raw) return "/v1/social";
  if (raw.endsWith("/v1")) return `${raw}/social`;
  if (raw.endsWith("/v1/social")) return raw;
  return `${raw}/v1/social`;
}

const API_BASE = resolveSocialApiBase();

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

export async function fetchProfileStats(handle: string): Promise<{
  stats: ProfileStats;
}> {
  return apiFetch(`/profiles/${handle}/stats`);
}

export async function fetchProfiles(limit = 20): Promise<{
  profiles: ProfileSummary[];
}> {
  return apiFetch(`/profiles?limit=${limit}`);
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
): Promise<{
  profile: Profile;
  followers: ProfileSummary[];
  pageInfo: PageInfo;
}> {
  const qs = feedQueryParams(limit, cursor);
  const raw = await apiFetch<{ profile?: Profile; followers?: ProfileSummary[]; cursor: string | null }>(
    `/profiles/${handle}/followers?${qs}`,
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
): Promise<{
  profile: Profile;
  following: ProfileSummary[];
  pageInfo: PageInfo;
}> {
  const qs = feedQueryParams(limit, cursor);
  const raw = await apiFetch<{ profile?: Profile; following?: ProfileSummary[]; cursor: string | null }>(
    `/profiles/${handle}/following?${qs}`,
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
): Promise<{
  posts: FeedPost[];
  profiles: Array<{ id: string; handle: string; displayName: string; avatarUrl: string | null; bio: string }>;
}> {
  const params = new URLSearchParams({ q: query });
  if (type !== "all") params.set("type", type);
  // Surface errors to callers (ExplorePage shows ErrorState) — do not swallow.
  return apiFetch(`/search?${params.toString()}`);
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
  type: "like" | "follow" | "repost" | "reply" | "mention" | "quote";
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

export async function fetchNotifications(token: string): Promise<{
  notifications: SocialNotification[];
  cursor: string | null;
  has_more: boolean;
}> {
  const raw = await apiAuthFetch<{
    notifications?: BeNotification[];
    cursor?: string | null;
    has_more?: boolean;
  }>("/notifications", { method: "GET", token });
  return {
    notifications: (raw.notifications ?? []).map(mapNotification),
    cursor: raw.cursor ?? null,
    has_more: raw.has_more ?? false,
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

export async function createPost(
  token: string,
  data: {
    body: string;
    visibility?: string;
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
  const absolute =
    uploadUrl.startsWith("http://") || uploadUrl.startsWith("https://")
      ? uploadUrl
      : `${import.meta.env.VITE_API_URL ?? ""}${uploadUrl.startsWith("/") ? "" : "/"}${uploadUrl}`;

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
    url: finalized.url,
    type: finalized.type,
  };
}

export async function fetchSinglePost(postId: string): Promise<{
  post: FeedPost;
  replies: FeedPost[];
}> {
  return apiFetch(`/posts/${postId}`);
}

export async function fetchFollowStatus(
  token: string,
  handle: string,
): Promise<{ following: boolean }> {
  try {
    return await apiAuthFetch(`/follows/${handle}/status`, { method: "GET", token });
  } catch {
    // Status route may be missing; default to not following (UI can still toggle).
    return { following: false };
  }
}

export async function followProfile(
  token: string,
  handle: string,
): Promise<{ ok: true; followId: string; state: string }> {
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

// ─── x402 agent micropayments scaffold (Wave 8g) ─────────────────────────────

export type X402Status = {
  enabled: boolean;
  network: string;
  note: string;
};

/** GET /v1/social/x402/status — public scaffold status (no payments). */
export async function fetchX402Status(): Promise<X402Status> {
  return apiFetch("/x402/status");
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

/** Authenticated list of posts bookmarked by the viewer. */
export async function fetchBookmarks(
  token: string,
  limit = 20,
  cursor?: string | null,
): Promise<{
  posts: FeedPost[];
  cursor: string | null;
  has_more: boolean;
}> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return apiAuthFetch(`/bookmarks?${params.toString()}`, { method: "GET", token });
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

// ─── Moderation ────────────────────────────────────────────────────────────

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
): Promise<{ ok: true }> {
  return apiAuthFetch("/report", { method: "POST", token, body: data });
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
        url: m.url,
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

/** Get all conversations */
export async function getConversations(token?: string): Promise<Conversation[]> {

  if (!token) throw new Error('Auth token required');
  const res = await legacyFetchAuthedApi<{ conversations: Conversation[] }>('/conversations', token);
  return res.conversations ?? [];
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

/** Get messages in a conversation */
export async function getMessages(conversationId: string, token?: string): Promise<Message[]> {

  if (!token) throw new Error('Auth token required');
  const res = await legacyFetchAuthedApi<{ messages: Message[] }>(`/conversations/${conversationId}/messages`, token);
  return res.messages ?? [];
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
