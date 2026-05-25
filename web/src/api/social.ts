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

const env = (import.meta as unknown as { env?: Record<string, string> }).env;
const API_BASE = env?.VITE_API_URL ? `${env.VITE_API_URL}/v1/social` : "/v1/social";

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
