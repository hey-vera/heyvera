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
};

export type LinkedAgent = {
  id: string;
  profileId: string;
  accountId: string;
  agentName: string;
  agentSlug: string;
  agentKey: string;
  agentType: string;
  linkState: string;
  visibility: string;
  proofState: string;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
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
  // Engagement counts (returned by backend when available)
  likeCount?: number;
  repostCount?: number;
  bookmarkCount?: number;
  replyCount?: number;
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
//
const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/v1/social`
  : "/v1/social";

// ─── Fetch helpers ───────────────────────────────────────────────────────────

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
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
  return res.json() as Promise<T>;
}

// ─── Public endpoints ────────────────────────────────────────────────────────

export async function fetchProfile(handle: string): Promise<{
  profile: Profile;
}> {
  // Backend mounts public profiles at /users/{handle} (object may be bare or wrapped).
  const raw = await apiFetch<Profile & { profile?: Profile }>(`/users/${handle}`);
  const profile = (raw as { profile?: Profile }).profile ?? (raw as Profile);
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

export async function fetchHomeFeed(limit = 20, cursor = 0, filter?: string): Promise<{
  feed: FeedPost[];
  pageInfo: PageInfo;
}> {
  const params = new URLSearchParams({ limit: String(limit), cursor: String(cursor) });
  if (filter && filter !== "all") params.set("filter", filter);
  const raw = await apiFetch<{ posts: FeedPost[]; cursor: string | null; has_more: boolean }>(`/feed/home?${params.toString()}`);
  return { feed: raw.posts ?? [], pageInfo: { limit, nextCursor: raw.cursor ?? null } };
}

export async function fetchProfileFeed(handle: string, limit = 20, cursor = 0): Promise<{
  profile: Profile;
  feed: FeedPost[];
  pageInfo: PageInfo;
}> {
  const raw = await apiFetch<{ profile?: Profile; posts: FeedPost[]; cursor: string | null; has_more: boolean }>(`/users/${handle}/posts?limit=${limit}&cursor=${cursor}`);
  return { profile: raw.profile as Profile, feed: raw.posts ?? [], pageInfo: { limit, nextCursor: raw.cursor ?? null } };
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

export async function fetchLongform(limit = 20, cursor = 0): Promise<{
  longform: LongformEntry[];
  pageInfo: PageInfo;
}> {
  const raw = await apiFetch<{ longform?: LongformEntry[]; posts?: LongformEntry[]; cursor: string | null }>(`/longform?limit=${limit}&cursor=${cursor}`);
  return { longform: raw.longform ?? raw.posts ?? [], pageInfo: { limit, nextCursor: raw.cursor ?? null } };
}

export async function fetchCommunityFeed(slug: string, limit = 20, cursor = 0): Promise<{
  community: Community;
  feed: FeedPost[];
  pageInfo: PageInfo;
}> {
  const raw = await apiFetch<{ community?: Community; posts: FeedPost[]; cursor: string | null; has_more: boolean }>(`/communities/${slug}/feed?limit=${limit}&cursor=${cursor}`);
  return { community: raw.community as Community, feed: raw.posts ?? [], pageInfo: { limit, nextCursor: raw.cursor ?? null } };
}

export async function fetchProfileFollowers(handle: string, limit = 20, cursor = 0): Promise<{
  profile: Profile;
  followers: ProfileSummary[];
  pageInfo: PageInfo;
}> {
  const raw = await apiFetch<{ profile?: Profile; followers?: ProfileSummary[]; cursor: string | null }>(`/profiles/${handle}/followers?limit=${limit}&cursor=${cursor}`);
  return { profile: raw.profile as Profile, followers: raw.followers ?? [], pageInfo: { limit, nextCursor: raw.cursor ?? null } };
}

export async function fetchProfileFollowing(handle: string, limit = 20, cursor = 0): Promise<{
  profile: Profile;
  following: ProfileSummary[];
  pageInfo: PageInfo;
}> {
  const raw = await apiFetch<{ profile?: Profile; following?: ProfileSummary[]; cursor: string | null }>(`/profiles/${handle}/following?limit=${limit}&cursor=${cursor}`);
  return { profile: raw.profile as Profile, following: raw.following ?? [], pageInfo: { limit, nextCursor: raw.cursor ?? null } };
}

// ─── Public: search ─────────────────────────────────────────────────────────

export async function searchSocial(
  query: string,
  type: "all" | "posts" | "profiles" = "all",
): Promise<{
  posts: FeedPost[];
  profiles: Array<{ id: string; handle: string; displayName: string; avatarUrl: string | null; bio: string }>;
}> {
  try {
    const params = new URLSearchParams({ q: query });
    if (type !== "all") params.set("type", type);
    return await apiFetch(`/search?${params.toString()}`);
  } catch {
    return { posts: [], profiles: [] };
  }
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

export async function fetchNotifications(token: string): Promise<{
  notifications: Array<{
    id: string;
    type: "like" | "follow" | "repost";
    actorHandle: string;
    actorDisplayName: string;
    actorAvatarUrl: string | null;
    postId: string | null;
    createdAt: string;
  }>;
}> {
  return apiAuthFetch("/notifications", { method: "GET", token });
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
  // Backend update_me_profile expects snake_case field names on /me/profile.
  const body = {
    display_name: data.displayName,
    bio: data.bio,
    avatar_url: data.avatarUrl,
    banner_url: data.bannerUrl,
    location: data.location,
    website: data.websiteUrl,
  };
  return apiAuthFetch("/me/profile", { method: "PATCH", token, body });
}

export async function createPost(
  token: string,
  data: {
    body: string;
    visibility?: string;
    authorMode?: string;
    linkedAgentId?: string;
    replyToPostId?: string;
    quotePostId?: string;
  },
): Promise<{ ok: true; post: FeedPost }> {
  return apiAuthFetch("/posts", { method: "POST", token, body: data });
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

export async function createCommunity(
  token: string,
  data: { slug: string; name: string; description?: string; visibility?: string },
): Promise<{ ok: true; community: Community }> {
  return apiAuthFetch("/communities", { method: "POST", token, body: data });
}

export async function joinCommunity(
  token: string,
  slug: string,
): Promise<{ ok: true; membershipId: string }> {
  return apiAuthFetch(`/communities/${slug}/join`, { method: "POST", token });
}

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

export async function linkAgent(
  token: string,
  data: {
    agentName: string;
    agentSlug: string;
    agentKey: string;
    agentType: string;
    visibility?: string;
    proofState?: string;
    isPrimary?: boolean;
  },
): Promise<{ ok: true; linkedAgent: LinkedAgent }> {
  return apiAuthFetch("/linked-agents", { method: "POST", token, body: data });
}

// ─── Shared adapter: FeedPost → legacy Post ─────────────────────────────────

/** Map a real-API FeedPost into the legacy Post shape that PostCard expects. */
export function feedPostToPost(fp: FeedPost): Post {
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
    created_at: fp.createdAt,
    reply_count: fp.replyCount ?? 0,
    repost_count: fp.repostCount ?? 0,
    like_count: fp.likeCount ?? 0,
    view_count: 0,
    bookmarked: fp.bookmarked ?? false,
    liked: fp.liked ?? false,
    reposted: fp.reposted ?? false,
    reply_to: fp.replyToPostId ?? undefined,
  };
}

// ─── Legacy-compatible public API (replaces client.ts) ──────────────────────
// All calls go to the real backend. No mock fallbacks in production.

const LEGACY_API_BASE = import.meta.env.VITE_API_URL || '';

function legacyJsonHeaders(headers?: HeadersInit): Headers {
  const next = new Headers(headers);
  if (!next.has('Content-Type')) next.set('Content-Type', 'application/json');
  return next;
}

async function legacyFetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${LEGACY_API_BASE}${path}`, init);
  if (!res.ok) throw new Error(`API ${res.status}`);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function legacyFetchAuthedApi<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${LEGACY_API_BASE}${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`API ${res.status}`);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function legacyFetchOptionalAuthedApi<T>(path: string, token: string, init?: RequestInit): Promise<T | null> {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${LEGACY_API_BASE}${path}`, { ...init, headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json() as Promise<T>;
}

function compactUpdateUserProfileInput(input: UpdateUserProfileInput): UpdateUserProfileInput {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as UpdateUserProfileInput;
}

/** Current signed-in viewer's profile, or null when none exists yet */
export async function getCurrentUserProfile(token: string): Promise<UserProfile | null> {

  return legacyFetchOptionalAuthedApi<UserProfile>('/v1/social/me/profile', token);
}

/** Create the signed-in viewer's profile */
export async function createUserProfile(token: string, input: CreateUserProfileInput): Promise<UserProfile> {

  return legacyFetchAuthedApi<UserProfile>('/v1/social/me/profile', token, {
    method: 'POST',
    headers: legacyJsonHeaders(),
    body: JSON.stringify(input),
  });
}

/** Update the signed-in viewer's profile */
export async function updateCurrentUserProfile(token: string, input: UpdateUserProfileInput): Promise<UserProfile> {

  const updates = compactUpdateUserProfileInput(input);
  return legacyFetchAuthedApi<UserProfile>('/v1/social/me/profile', token, {
    method: 'PATCH',
    headers: legacyJsonHeaders(),
    body: JSON.stringify(updates),
  });
}

/** Home / for-you feed */
export async function getFeed(cursor?: string, token?: string): Promise<FeedResponse> {

  const path = `/v1/social/feed/home${cursor ? `?cursor=${cursor}` : ''}`;
  return token ? legacyFetchAuthedApi<FeedResponse>(path, token) : legacyFetchApi<FeedResponse>(path);
}

/** Following-only feed */
export async function getFollowingFeed(cursor?: string, token?: string): Promise<FeedResponse> {

  const path = `/v1/social/feed/following${cursor ? `?cursor=${cursor}` : ''}`;
  return token ? legacyFetchAuthedApi<FeedResponse>(path, token) : legacyFetchApi<FeedResponse>(path);
}

/** Single post by ID */
export async function getPost(id: string, token?: string): Promise<Post> {

  return token ? legacyFetchAuthedApi<Post>(`/v1/social/posts/${id}`, token) : legacyFetchApi<Post>(`/v1/social/posts/${id}`);
}

/** Create a new post (legacy FormData interface) */
export async function legacyCreatePost(content: string, media?: File[], token?: string): Promise<Post> {

  if (!token) throw new Error('Auth token required');
  const form = new FormData();
  form.append('content', content);
  if (media) media.forEach(f => form.append('media', f));
  return legacyFetchAuthedApi<Post>('/v1/social/posts', token, { method: 'POST', body: form });
}

/** Get notifications for the current user */
export async function getNotifications(token?: string): Promise<Notification[]> {

  if (!token) throw new Error('Auth token required');
  return legacyFetchAuthedApi<Notification[]>('/v1/social/notifications', token);
}

/** Get all conversations */
export async function getConversations(token?: string): Promise<Conversation[]> {

  if (!token) throw new Error('Auth token required');
  const res = await legacyFetchAuthedApi<{ conversations: Conversation[] }>('/v1/social/conversations', token);
  return res.conversations ?? [];
}

/** Get messages in a conversation */
export async function getMessages(conversationId: string, token?: string): Promise<Message[]> {

  if (!token) throw new Error('Auth token required');
  const res = await legacyFetchAuthedApi<{ messages: Message[] }>(`/v1/social/conversations/${conversationId}/messages`, token);
  return res.messages ?? [];
}

/** Full-text search across posts, users, and communities */
export async function searchAll(query: string, token?: string): Promise<SearchResults> {

  const path = `/v1/social/search?q=${encodeURIComponent(query)}`;
  return token ? legacyFetchAuthedApi<SearchResults>(path, token) : legacyFetchApi<SearchResults>(path);
}

/** Trending topics */
export async function getTrending(): Promise<TrendingTopic[]> {

  return legacyFetchApi<TrendingTopic[]>('/v1/social/trending');
}

/** User profile by handle */
export async function getUserProfile(handle: string, token?: string): Promise<UserProfile> {

  return token ? legacyFetchAuthedApi<UserProfile>(`/v1/social/users/${handle}`, token) : legacyFetchApi<UserProfile>(`/v1/social/users/${handle}`);
}

/** Posts for a user profile */
export async function getProfilePosts(handle: string, cursor?: string, token?: string): Promise<FeedResponse> {

  const path = `/v1/social/users/${handle}/posts${cursor ? `?cursor=${cursor}` : ''}`;
  return token ? legacyFetchAuthedApi<FeedResponse>(path, token) : legacyFetchApi<FeedResponse>(path);
}

/** Follow a user */
export async function followUser(handle: string, token?: string): Promise<void> {

  if (!token) throw new Error('Auth token required');
  return legacyFetchAuthedApi<void>(`/v1/social/follows/${handle}`, token, { method: 'POST' });
}

/** Unfollow a user */
export async function unfollowUser(handle: string, token?: string): Promise<void> {

  if (!token) throw new Error('Auth token required');
  return legacyFetchAuthedApi<void>(`/v1/social/follows/${handle}`, token, { method: 'DELETE' });
}

/** All communities (legacy type) */
export async function getCommunities(): Promise<LegacyCommunity[]> {

  return legacyFetchApi<LegacyCommunity[]>('/v1/social/communities');
}

/** Posts in a community */
export async function getCommunityFeed(id: string, cursor?: string, token?: string): Promise<FeedResponse> {

  const path = `/v1/social/communities/${id}/feed${cursor ? `?cursor=${cursor}` : ''}`;
  return token ? legacyFetchAuthedApi<FeedResponse>(path, token) : legacyFetchApi<FeedResponse>(path);
}
