import { verifyToken } from '@clerk/backend';
import { Hono, type MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import { env } from '../config/index';
import {
  findSocialProfileByClerkId,
  findSocialProfileByHandle,
  getProfileStats,
  insertSocialProfile,
  listFeedPosts,
  updateSocialProfile,
  type SocialPostWithAuthorRow,
  type SocialProfileRow,
} from '../db/index';
import { logger } from '../utils/logger';

type ErrorCode =
  | 'UNAUTHORIZED'
  | 'AUTH_NOT_CONFIGURED'
  | 'PROFILE_NOT_FOUND'
  | 'HANDLE_CONFLICT'
  | 'INVALID_INPUT'
  | 'INTERNAL_ERROR';

function errorBody(code: ErrorCode, message: string, details: unknown = null) {
  return { error: { code, message, details } };
}

function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, '').toLowerCase();
}

function toIso(value: string): string {
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function profileToXStyle(p: SocialProfileRow) {
  const stats = getProfileStats(p.id);
  return {
    id: p.id,
    display_name: p.display_name,
    handle: p.handle,
    avatar_url: p.avatar_url ?? '',
    verified: p.proof_state === 'verified',
    banner_url: p.banner_url ?? '',
    bio: p.bio,
    location: p.location ?? undefined,
    website: p.website_url ?? undefined,
    joined_at: toIso(p.created_at),
    follower_count: stats.followerCount,
    following_count: stats.followingCount,
    post_count: stats.postCount,
    is_following: false,
    is_followed_by: false,
  };
}

function postToXStyle(p: SocialPostWithAuthorRow) {
  return {
    id: p.id,
    author: {
      id: p.profile_id,
      display_name: p.author_display_name,
      handle: p.author_handle,
      avatar_url: '',
      verified: p.proof_state === 'verified',
    },
    content: p.body,
    media: [],
    created_at: toIso(p.created_at),
    reply_count: 0,
    repost_count: 0,
    like_count: 0,
    view_count: 0,
    bookmarked: false,
    liked: false,
    reposted: false,
    reply_to: p.reply_to_post_id,
    quote_post: undefined,
  };
}

function feedResponse(posts: SocialPostWithAuthorRow[], limit: number, cursor: number) {
  return {
    posts: posts.map(postToXStyle),
    cursor: posts.length === limit ? String(cursor + limit) : undefined,
    has_more: posts.length === limit,
  };
}

export const requireHeyveraAuth = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return c.json(errorBody('UNAUTHORIZED', 'Missing bearer token'), 401);
  }

  const secretKey = env.CLERK_SECRET_KEY ?? '';
  if (!secretKey) {
    logger.error('CLERK_SECRET_KEY not set for HeyVera v1 auth');
    return c.json(errorBody('AUTH_NOT_CONFIGURED', 'Authentication is not configured'), 500);
  }

  try {
    const payload = await verifyToken(token, { secretKey });
    c.set('clerkUserId', payload.sub);
    c.set('clerkEmail', null);
    await next();
  } catch (err) {
    logger.warn({ err }, 'HeyVera v1 Clerk token verification failed');
    return c.json(errorBody('UNAUTHORIZED', 'Invalid or expired session'), 401);
  }
});

export function createHeyveraV1Router(auth: MiddlewareHandler = requireHeyveraAuth) {
  const router = new Hono();

  router.get('/feed', (c) => {
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? '20'), 1), 100);
    const cursor = Math.max(Number(c.req.query('cursor') ?? '0'), 0);
    const posts = listFeedPosts(limit, cursor);
    return c.json(feedResponse(posts, limit, cursor));
  });

  router.get('/feed/following', (c) => {
    return c.json({ posts: [], cursor: undefined, has_more: false });
  });

  router.get('/me/profile', auth, (c) => {
    const clerkUserId = c.get('clerkUserId');
    const profile = findSocialProfileByClerkId(clerkUserId);
    if (!profile) {
      return c.json(errorBody('PROFILE_NOT_FOUND', 'Profile not found'), 404);
    }
    return c.json(profileToXStyle(profile));
  });

  router.post('/me/profile', auth, async (c) => {
    const clerkUserId = c.get('clerkUserId');
    if (findSocialProfileByClerkId(clerkUserId)) {
      return c.json(errorBody('HANDLE_CONFLICT', 'Profile already exists'), 409);
    }

    const body = await c.req.json<{
      display_name?: string;
      handle?: string;
      bio?: string;
      avatar_url?: string;
      banner_url?: string;
      location?: string;
      website?: string;
    }>().catch(() => null);

    const handle = normalizeHandle(body?.handle ?? '');
    const displayName = (body?.display_name ?? '').trim();
    if (!/^[a-z0-9_]{2,30}$/.test(handle)) {
      return c.json(errorBody('INVALID_INPUT', 'Handle must be 2-30 characters: letters, digits, underscores'), 422);
    }
    if (!displayName) {
      return c.json(errorBody('INVALID_INPUT', 'display_name is required'), 422);
    }
    if (findSocialProfileByHandle(handle)) {
      return c.json(errorBody('HANDLE_CONFLICT', 'Handle is already taken'), 409);
    }

    try {
      const profile = insertSocialProfile({
        clerkUserId,
        handle,
        displayName,
        bio: (body?.bio ?? '').trim(),
      });
      const updated = updateSocialProfile(clerkUserId, {
        avatarUrl: body?.avatar_url ?? null,
        bannerUrl: body?.banner_url ?? null,
        location: body?.location ?? null,
        websiteUrl: body?.website ?? null,
      }) ?? profile;
      return c.json(profileToXStyle(updated), 201);
    } catch (err) {
      logger.error({ err }, 'Failed to create HeyVera v1 profile');
      return c.json(errorBody('INTERNAL_ERROR', 'Failed to create profile'), 500);
    }
  });

  router.patch('/me/profile', auth, async (c) => {
    const clerkUserId = c.get('clerkUserId');
    const profile = findSocialProfileByClerkId(clerkUserId);
    if (!profile) {
      return c.json(errorBody('PROFILE_NOT_FOUND', 'Profile not found'), 404);
    }

    const body = await c.req.json<{
      display_name?: string;
      bio?: string;
      avatar_url?: string | null;
      banner_url?: string | null;
      location?: string | null;
      website?: string | null;
    }>().catch(() => null);

    if (!body) {
      return c.json(errorBody('INVALID_INPUT', 'Invalid JSON body'), 400);
    }
    if (body.display_name !== undefined && !body.display_name.trim()) {
      return c.json(errorBody('INVALID_INPUT', 'display_name cannot be empty'), 422);
    }

    const updated = updateSocialProfile(clerkUserId, {
      displayName: body.display_name?.trim(),
      bio: body.bio,
      avatarUrl: body.avatar_url,
      bannerUrl: body.banner_url,
      location: body.location,
      websiteUrl: body.website,
    });

    return c.json(profileToXStyle(updated!));
  });

  return router;
}

export const heyveraV1Router = createHeyveraV1Router();
