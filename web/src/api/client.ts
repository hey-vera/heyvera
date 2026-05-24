// ─── HeyVera API client ───────────────────────────────────────────────────────
// When VITE_API_URL is unset, all calls return mock data with a 100ms delay.
// When set, calls go to the Rust backend via fetch.

import type {
  Post,
  UserProfile,
  CreateUserProfileInput,
  Notification,
  Conversation,
  Message,
  Community,
  TrendingTopic,
  FeedResponse,
  SearchResults,
} from './types';

import {
  MOCK_POSTS,
  MOCK_PROFILES,
  MOCK_NOTIFICATIONS,
  MOCK_CONVERSATIONS,
  MOCK_MESSAGES,
  MOCK_TRENDING,
  MOCK_COMMUNITIES,
  buildFeedResponse,
  buildSearchResults,
} from './mock';

// ─── Config ───────────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const MOCK_VIEWER_PROFILE_KEY = 'heyvera.mock.viewer_profile';

// ─── Internal helpers ─────────────────────────────────────────────────────────

function delay(ms = 100): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function jsonHeaders(headers?: HeadersInit): Headers {
  const next = new Headers(headers);
  if (!next.has('Content-Type')) next.set('Content-Type', 'application/json');
  return next;
}

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json() as Promise<T>;
}

async function fetchAuthedApi<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json() as Promise<T>;
}

async function fetchOptionalAuthedApi<T>(path: string, token: string, init?: RequestInit): Promise<T | null> {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json() as Promise<T>;
}

function getMockViewerProfile(): UserProfile | null {
  if (typeof localStorage === 'undefined') return null;

  const raw = localStorage.getItem(MOCK_VIEWER_PROFILE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as UserProfile;
  } catch {
    localStorage.removeItem(MOCK_VIEWER_PROFILE_KEY);
    return null;
  }
}

function setMockViewerProfile(profile: UserProfile): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(MOCK_VIEWER_PROFILE_KEY, JSON.stringify(profile));
}

function buildMockViewerProfile(input: CreateUserProfileInput): UserProfile {
  const handle = input.handle.trim().replace(/^@/, '').toLowerCase();
  const displayName = input.display_name.trim();

  return {
    id: `mock_viewer_${handle || Date.now()}`,
    display_name: displayName,
    handle,
    avatar_url: input.avatar_url ?? `https://api.dicebear.com/7.x/personas/svg?seed=${encodeURIComponent(handle || displayName)}`,
    verified: false,
    banner_url: input.banner_url ?? '',
    bio: input.bio ?? '',
    location: input.location,
    website: input.website,
    joined_at: new Date().toISOString(),
    follower_count: 0,
    following_count: 0,
    post_count: 0,
    is_following: false,
    is_followed_by: false,
  };
}

// getMockData routes mock responses by path pattern.
// Each branch returns the appropriate mock, then real fetch branches replace them.
async function getMockData<T>(path: string, _body?: unknown): Promise<T> {
  await delay(100);

  // Feed
  if (path === '/feed' || path.startsWith('/feed?')) return buildFeedResponse(MOCK_POSTS) as T;
  if (path === '/feed/following' || path.startsWith('/feed/following?')) return buildFeedResponse(MOCK_POSTS.slice(1, 4)) as T;

  // Posts
  if (path.startsWith('/posts/') && !path.includes('/reply') && !path.includes('/like') && !path.includes('/repost') && !path.includes('/bookmark')) {
    const id = path.replace('/posts/', '');
    const post = MOCK_POSTS.find(p => p.id === id) ?? MOCK_POSTS[0];
    return post as T;
  }

  // Notifications
  if (path === '/notifications') return MOCK_NOTIFICATIONS as T;

  // Messages / conversations
  if (path === '/conversations') return MOCK_CONVERSATIONS as T;
  if (path.startsWith('/conversations/') && path.endsWith('/messages')) {
    const convId = path.split('/')[2];
    return (MOCK_MESSAGES[convId] ?? []) as T;
  }

  // Search
  if (path.startsWith('/search?')) {
    const q = new URLSearchParams(path.split('?')[1]).get('q') ?? '';
    return buildSearchResults(q) as T;
  }

  // Trending
  if (path === '/trending') return MOCK_TRENDING as T;

  // Users / profiles
  if (path.startsWith('/users/')) {
    const handle = path.replace('/users/', '').split('/')[0];
    const profile = MOCK_PROFILES[handle] ?? Object.values(MOCK_PROFILES)[0];
    if (path.endsWith('/posts')) return buildFeedResponse(MOCK_POSTS.filter(p => p.author.handle === handle)) as T;
    return profile as T;
  }

  // Communities
  if (path === '/communities') return MOCK_COMMUNITIES as T;
  if (path.startsWith('/communities/') && path.endsWith('/feed')) {
    const id = path.split('/')[2];
    return buildFeedResponse(MOCK_POSTS.filter((_, i) => i % 2 === 0), id) as T;
  }

  // Void mutations (like, repost, bookmark, follow, unfollow)
  return undefined as T;
}

// ─── Public API functions ─────────────────────────────────────────────────────

/** Current signed-in viewer's profile, or null when none exists yet */
export async function getCurrentUserProfile(token: string): Promise<UserProfile | null> {
  if (!API_BASE) {
    await delay(100);
    return getMockViewerProfile();
  }
  return fetchOptionalAuthedApi<UserProfile>('/me/profile', token);
}

/** Create the signed-in viewer's profile */
export async function createUserProfile(token: string, input: CreateUserProfileInput): Promise<UserProfile> {
  if (!API_BASE) {
    await delay(100);
    const profile = buildMockViewerProfile(input);
    setMockViewerProfile(profile);
    return profile;
  }
  return fetchAuthedApi<UserProfile>('/me/profile', token, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(input),
  });
}

/** Home / for-you feed */
export async function getFeed(cursor?: string): Promise<FeedResponse> {
  if (!API_BASE) return getMockData<FeedResponse>(`/feed${cursor ? `?cursor=${cursor}` : ''}`);
  return fetchApi<FeedResponse>(`/feed${cursor ? `?cursor=${cursor}` : ''}`);
}

/** Following-only feed */
export async function getFollowingFeed(cursor?: string): Promise<FeedResponse> {
  if (!API_BASE) return getMockData<FeedResponse>(`/feed/following${cursor ? `?cursor=${cursor}` : ''}`);
  return fetchApi<FeedResponse>(`/feed/following${cursor ? `?cursor=${cursor}` : ''}`);
}

/** Single post by ID */
export async function getPost(id: string): Promise<Post> {
  if (!API_BASE) return getMockData<Post>(`/posts/${id}`);
  return fetchApi<Post>(`/posts/${id}`);
}

/** Create a new post */
export async function createPost(content: string, media?: File[]): Promise<Post> {
  if (!API_BASE) {
    await delay(100);
    const newPost: Post = {
      id: `mock_${Date.now()}`,
      author: Object.values(MOCK_PROFILES)[1],
      content,
      created_at: new Date().toISOString(),
      reply_count: 0,
      repost_count: 0,
      like_count: 0,
      view_count: 0,
      bookmarked: false,
      liked: false,
      reposted: false,
    };
    return newPost;
  }
  const form = new FormData();
  form.append('content', content);
  if (media) media.forEach(f => form.append('media', f));
  return fetchApi<Post>('/posts', { method: 'POST', body: form });
}

/** Like a post */
export async function likePost(id: string): Promise<void> {
  if (!API_BASE) return getMockData<void>(`/posts/${id}/like`);
  return fetchApi<void>(`/posts/${id}/like`, { method: 'POST' });
}

/** Unlike a post */
export async function unlikePost(id: string): Promise<void> {
  if (!API_BASE) return getMockData<void>(`/posts/${id}/like`);
  return fetchApi<void>(`/posts/${id}/like`, { method: 'DELETE' });
}

/** Repost */
export async function repostPost(id: string): Promise<void> {
  if (!API_BASE) return getMockData<void>(`/posts/${id}/repost`);
  return fetchApi<void>(`/posts/${id}/repost`, { method: 'POST' });
}

/** Bookmark a post */
export async function bookmarkPost(id: string): Promise<void> {
  if (!API_BASE) return getMockData<void>(`/posts/${id}/bookmark`);
  return fetchApi<void>(`/posts/${id}/bookmark`, { method: 'POST' });
}

/** Get notifications for the current user */
export async function getNotifications(): Promise<Notification[]> {
  if (!API_BASE) return getMockData<Notification[]>('/notifications');
  return fetchApi<Notification[]>('/notifications');
}

/** Get all conversations */
export async function getConversations(): Promise<Conversation[]> {
  if (!API_BASE) return getMockData<Conversation[]>('/conversations');
  return fetchApi<Conversation[]>('/conversations');
}

/** Get messages in a conversation */
export async function getMessages(conversationId: string): Promise<Message[]> {
  const path = `/conversations/${conversationId}/messages`;
  if (!API_BASE) return getMockData<Message[]>(path);
  return fetchApi<Message[]>(path);
}

/** Full-text search across posts, users, and communities */
export async function searchAll(query: string): Promise<SearchResults> {
  const path = `/search?q=${encodeURIComponent(query)}`;
  if (!API_BASE) return getMockData<SearchResults>(path);
  return fetchApi<SearchResults>(path);
}

/** Trending topics */
export async function getTrending(): Promise<TrendingTopic[]> {
  if (!API_BASE) return getMockData<TrendingTopic[]>('/trending');
  return fetchApi<TrendingTopic[]>('/trending');
}

/** User profile by handle */
export async function getUserProfile(handle: string): Promise<UserProfile> {
  if (!API_BASE) return getMockData<UserProfile>(`/users/${handle}`);
  return fetchApi<UserProfile>(`/users/${handle}`);
}

/** Posts for a user profile */
export async function getProfilePosts(handle: string, cursor?: string): Promise<FeedResponse> {
  const path = `/users/${handle}/posts${cursor ? `?cursor=${cursor}` : ''}`;
  if (!API_BASE) return getMockData<FeedResponse>(path);
  return fetchApi<FeedResponse>(path);
}

/** Follow a user */
export async function followUser(id: string): Promise<void> {
  if (!API_BASE) return getMockData<void>(`/users/${id}/follow`);
  return fetchApi<void>(`/users/${id}/follow`, { method: 'POST' });
}

/** Unfollow a user */
export async function unfollowUser(id: string): Promise<void> {
  if (!API_BASE) return getMockData<void>(`/users/${id}/follow`);
  return fetchApi<void>(`/users/${id}/follow`, { method: 'DELETE' });
}

/** All communities */
export async function getCommunities(): Promise<Community[]> {
  if (!API_BASE) return getMockData<Community[]>('/communities');
  return fetchApi<Community[]>('/communities');
}

/** Posts in a community */
export async function getCommunityFeed(id: string, cursor?: string): Promise<FeedResponse> {
  const path = `/communities/${id}/feed${cursor ? `?cursor=${cursor}` : ''}`;
  if (!API_BASE) return getMockData<FeedResponse>(path);
  return fetchApi<FeedResponse>(path);
}
