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
  };
  linkedAgent: {
    id: string;
    agentName: string;
    agentSlug: string;
  } | null;
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
// When VITE_API_URL is set (e.g. "https://api.heyvera.org" or "/v1"), all
// requests are prefixed with "<VITE_API_URL>/v1/social".
// When unset the app falls back to the relative path "/v1/social", which works
// both with the Vite dev-server proxy (dev) and a Cloudflare Pages /v1 proxy
// rule (production). Never falls back to localhost.

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
      (err as { error?: string }).error ?? `API error ${res.status}`,
    );
  }
  return res.json() as Promise<T>;
}

// ─── Public endpoints ────────────────────────────────────────────────────────

export async function fetchProfile(handle: string): Promise<{
  profile: Profile;
}> {
  return apiFetch(`/profiles/${handle}`);
}

export async function fetchProfileWithLinkedAgents(handle: string): Promise<{
  profile: Profile;
  linkedAgents: LinkedAgent[];
}> {
  return apiFetch(`/profiles/${handle}/linked-agents`);
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
  return apiFetch(`/feed/home?${params.toString()}`);
}

export async function fetchProfileFeed(handle: string, limit = 20, cursor = 0): Promise<{
  profile: Profile;
  feed: FeedPost[];
  pageInfo: PageInfo;
}> {
  return apiFetch(`/feed/profile/${handle}?limit=${limit}&cursor=${cursor}`);
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
  return apiFetch(`/longform?limit=${limit}&cursor=${cursor}`);
}

export async function fetchCommunityFeed(slug: string, limit = 20, cursor = 0): Promise<{
  community: Community;
  feed: FeedPost[];
  pageInfo: PageInfo;
}> {
  return apiFetch(`/feed/community/${slug}?limit=${limit}&cursor=${cursor}`);
}

export async function fetchProfileFollowers(handle: string, limit = 20, cursor = 0): Promise<{
  profile: Profile;
  followers: ProfileSummary[];
  pageInfo: PageInfo;
}> {
  return apiFetch(`/profiles/${handle}/followers?limit=${limit}&cursor=${cursor}`);
}

export async function fetchProfileFollowing(handle: string, limit = 20, cursor = 0): Promise<{
  profile: Profile;
  following: ProfileSummary[];
  pageInfo: PageInfo;
}> {
  return apiFetch(`/profiles/${handle}/following?limit=${limit}&cursor=${cursor}`);
}

// ─── Authenticated: my profile ─────────────────────────────────────────────

export async function fetchMyProfile(token: string): Promise<{
  profile: Profile;
  linkedAgents: LinkedAgent[];
}> {
  return apiAuthFetch("/profile/me", { method: "GET", token });
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
  return apiAuthFetch("/profile", { method: "PATCH", token, body: data });
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

export async function fetchFollowStatus(
  token: string,
  handle: string,
): Promise<{ following: boolean }> {
  return apiAuthFetch(`/follows/${handle}/status`, { method: "GET", token });
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
      avatar_url: '',
      verified: false,
    },
    content: fp.body,
    created_at: fp.createdAt,
    reply_count: 0,
    repost_count: 0,
    like_count: 0,
    view_count: 0,
    bookmarked: false,
    liked: false,
    reposted: false,
    reply_to: fp.replyToPostId ?? undefined,
  };
}

// ─── Legacy-compatible public API (replaces client.ts) ──────────────────────
// All calls go to the real backend. No mock fallbacks in production.

const LEGACY_API_BASE = import.meta.env.VITE_API_URL ?? '';

function ensureLegacyApiBase(): void {
  if (!LEGACY_API_BASE) {
    throw new Error('API is not configured. Set VITE_API_URL to connect to the backend.');
  }
}

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
  ensureLegacyApiBase();
  return legacyFetchOptionalAuthedApi<UserProfile>('/me/profile', token);
}

/** Create the signed-in viewer's profile */
export async function createUserProfile(token: string, input: CreateUserProfileInput): Promise<UserProfile> {
  ensureLegacyApiBase();
  return legacyFetchAuthedApi<UserProfile>('/me/profile', token, {
    method: 'POST',
    headers: legacyJsonHeaders(),
    body: JSON.stringify(input),
  });
}

/** Update the signed-in viewer's profile */
export async function updateCurrentUserProfile(token: string, input: UpdateUserProfileInput): Promise<UserProfile> {
  ensureLegacyApiBase();
  const updates = compactUpdateUserProfileInput(input);
  return legacyFetchAuthedApi<UserProfile>('/me/profile', token, {
    method: 'PATCH',
    headers: legacyJsonHeaders(),
    body: JSON.stringify(updates),
  });
}

/** Home / for-you feed */
export async function getFeed(cursor?: string, token?: string): Promise<FeedResponse> {
  ensureLegacyApiBase();
  const path = `/feed${cursor ? `?cursor=${cursor}` : ''}`;
  return token ? legacyFetchAuthedApi<FeedResponse>(path, token) : legacyFetchApi<FeedResponse>(path);
}

/** Following-only feed */
export async function getFollowingFeed(cursor?: string, token?: string): Promise<FeedResponse> {
  ensureLegacyApiBase();
  const path = `/feed/following${cursor ? `?cursor=${cursor}` : ''}`;
  return token ? legacyFetchAuthedApi<FeedResponse>(path, token) : legacyFetchApi<FeedResponse>(path);
}

/** Single post by ID */
export async function getPost(id: string, token?: string): Promise<Post> {
  ensureLegacyApiBase();
  return token ? legacyFetchAuthedApi<Post>(`/posts/${id}`, token) : legacyFetchApi<Post>(`/posts/${id}`);
}

/** Create a new post (legacy FormData interface) */
export async function legacyCreatePost(content: string, media?: File[], token?: string): Promise<Post> {
  ensureLegacyApiBase();
  if (!token) throw new Error('Auth token required');
  const form = new FormData();
  form.append('content', content);
  if (media) media.forEach(f => form.append('media', f));
  return legacyFetchAuthedApi<Post>('/posts', token, { method: 'POST', body: form });
}

/** Get notifications for the current user */
export async function getNotifications(token?: string): Promise<Notification[]> {
  ensureLegacyApiBase();
  if (!token) throw new Error('Auth token required');
  return legacyFetchAuthedApi<Notification[]>('/notifications', token);
}

/** Get all conversations */
export async function getConversations(token?: string): Promise<Conversation[]> {
  ensureLegacyApiBase();
  if (!token) throw new Error('Auth token required');
  return legacyFetchAuthedApi<Conversation[]>('/conversations', token);
}

/** Get messages in a conversation */
export async function getMessages(conversationId: string, token?: string): Promise<Message[]> {
  ensureLegacyApiBase();
  if (!token) throw new Error('Auth token required');
  return legacyFetchAuthedApi<Message[]>(`/conversations/${conversationId}/messages`, token);
}

/** Full-text search across posts, users, and communities */
export async function searchAll(query: string, token?: string): Promise<SearchResults> {
  ensureLegacyApiBase();
  const path = `/search?q=${encodeURIComponent(query)}`;
  return token ? legacyFetchAuthedApi<SearchResults>(path, token) : legacyFetchApi<SearchResults>(path);
}

/** Trending topics */
export async function getTrending(): Promise<TrendingTopic[]> {
  ensureLegacyApiBase();
  return legacyFetchApi<TrendingTopic[]>('/trending');
}

/** User profile by handle */
export async function getUserProfile(handle: string, token?: string): Promise<UserProfile> {
  ensureLegacyApiBase();
  return token ? legacyFetchAuthedApi<UserProfile>(`/users/${handle}`, token) : legacyFetchApi<UserProfile>(`/users/${handle}`);
}

/** Posts for a user profile */
export async function getProfilePosts(handle: string, cursor?: string, token?: string): Promise<FeedResponse> {
  ensureLegacyApiBase();
  const path = `/users/${handle}/posts${cursor ? `?cursor=${cursor}` : ''}`;
  return token ? legacyFetchAuthedApi<FeedResponse>(path, token) : legacyFetchApi<FeedResponse>(path);
}

/** Follow a user */
export async function followUser(handle: string, token?: string): Promise<void> {
  ensureLegacyApiBase();
  if (!token) throw new Error('Auth token required');
  return legacyFetchAuthedApi<void>(`/follows/${handle}`, token, { method: 'POST' });
}

/** Unfollow a user */
export async function unfollowUser(handle: string, token?: string): Promise<void> {
  ensureLegacyApiBase();
  if (!token) throw new Error('Auth token required');
  return legacyFetchAuthedApi<void>(`/follows/${handle}`, token, { method: 'DELETE' });
}

/** All communities (legacy type) */
export async function getCommunities(): Promise<LegacyCommunity[]> {
  ensureLegacyApiBase();
  return legacyFetchApi<LegacyCommunity[]>('/communities');
}

/** Posts in a community */
export async function getCommunityFeed(id: string, cursor?: string, token?: string): Promise<FeedResponse> {
  ensureLegacyApiBase();
  const path = `/communities/${id}/feed${cursor ? `?cursor=${cursor}` : ''}`;
  return token ? legacyFetchAuthedApi<FeedResponse>(path, token) : legacyFetchApi<FeedResponse>(path);
}
