import { Hono } from 'hono';
import { requireSocialAuth } from '../middleware/clerk-auth';
import {
  findSocialProfileByClerkId,
  findSocialProfileByHandle,
  listSocialProfiles,
  getFirstSocialProfile,
  insertSocialProfile,
  updateSocialProfile,
  getLinkedAgentsByProfileId,
  insertLinkedAgent,
  getProfileStats,
  listFeedPosts,
  listFeedPostsByHandle,
  insertSocialPost,
  getFollowStatus,
  insertSocialFollow,
  deleteSocialFollow,
  listSocialCommunities,
  findSocialCommunityBySlug,
  insertSocialCommunity,
  insertCommunityMembership,
  listCommunityFeedPosts,
  listJoinedCommunities,
  listFollowers,
  listFollowing,
  listSocialLongform,
  insertSocialLongform,
  type SocialProfileRow,
  type SocialProfileSummaryRow,
  type SocialLinkedAgentRow,
  type SocialPostWithAuthorRow,
  type SocialCommunityWithCreatorRow,
  type SocialCommunityMembershipRow,
  type SocialLongformWithAuthorRow,
} from '../db/index';

export const socialRouter = new Hono();

// ─── Transformers (DB snake_case → API camelCase) ─────────────────────────────

function profileToApi(p: SocialProfileRow) {
  return {
    id: p.id,
    accountId: p.clerk_user_id,
    displayName: p.display_name,
    handle: p.handle,
    bio: p.bio,
    avatarUrl: p.avatar_url,
    bannerUrl: p.banner_url,
    location: p.location,
    websiteUrl: p.website_url,
    proofState: p.proof_state,
    continuityState: p.continuity_state,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

function profileSummaryToApi(p: SocialProfileSummaryRow) {
  return {
    ...profileToApi(p),
    primaryAgent: p.primary_agent_name
      ? {
          agentName: p.primary_agent_name,
          agentSlug: p.primary_agent_slug!,
          linkState: p.primary_agent_link_state!,
        }
      : null,
  };
}

function linkedAgentToApi(a: SocialLinkedAgentRow, clerkUserId: string) {
  return {
    id: a.id,
    profileId: a.profile_id,
    accountId: clerkUserId,
    agentName: a.agent_name,
    agentSlug: a.agent_slug,
    agentKey: a.agent_key,
    agentType: a.agent_type,
    linkState: a.link_state,
    visibility: a.visibility,
    proofState: a.proof_state,
    isPrimary: a.is_primary === 1,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
  };
}

function postToApi(r: SocialPostWithAuthorRow) {
  return {
    id: r.id,
    body: r.body,
    visibility: r.visibility,
    proofState: r.proof_state,
    authorMode: r.author_mode as 'person' | 'agent' | 'linked_pair',
    replyToPostId: r.reply_to_post_id,
    quotePostId: r.quote_post_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    author: {
      profileId: r.profile_id,
      handle: r.author_handle,
      displayName: r.author_display_name,
    },
    linkedAgent: r.linked_agent_id && r.agent_name
      ? {
          id: r.linked_agent_id,
          agentName: r.agent_name,
          agentSlug: r.agent_slug!,
        }
      : null,
  };
}

function communityToApi(c: SocialCommunityWithCreatorRow) {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: c.description,
    visibility: c.visibility,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    creator: {
      profileId: c.creator_profile_id,
      handle: c.creator_handle,
      displayName: c.creator_display_name,
    },
  };
}

function communityMembershipToApi(c: SocialCommunityMembershipRow) {
  return {
    ...communityToApi(c),
    joinedAt: c.joined_at,
  };
}

function longformToApi(l: SocialLongformWithAuthorRow) {
  return {
    id: l.id,
    title: l.title,
    summary: l.summary,
    body: l.body,
    formatType: l.format_type,
    visibility: l.visibility,
    proofState: l.proof_state,
    authorMode: l.author_mode as 'person' | 'agent' | 'linked_pair',
    createdAt: l.created_at,
    updatedAt: l.updated_at,
    author: {
      profileId: l.profile_id,
      handle: l.author_handle,
      displayName: l.author_display_name,
    },
    linkedAgent: l.linked_agent_id && l.agent_name
      ? {
          id: l.linked_agent_id,
          agentName: l.agent_name,
          agentSlug: l.agent_slug!,
        }
      : null,
  };
}

// ─── Authenticated: my profile ───────────────────────────────────────────────

socialRouter.get('/profile/me', requireSocialAuth, (c) => {
  const clerkUserId = c.get('clerkUserId');
  const profile = findSocialProfileByClerkId(clerkUserId);
  if (!profile) {
    return c.json({ error: 'No profile found', code: 'NOT_FOUND' }, 404);
  }
  const agents = getLinkedAgentsByProfileId(profile.id);
  return c.json({
    profile: profileToApi(profile),
    linkedAgents: agents.map((a) => linkedAgentToApi(a, clerkUserId)),
  });
});

// ─── Public: featured profile ────────────────────────────────────────────────

socialRouter.get('/profiles/featured', (c) => {
  const profile = getFirstSocialProfile();
  if (!profile) {
    return c.json({ error: 'No featured profile', code: 'NOT_FOUND' }, 404);
  }
  const agents = getLinkedAgentsByProfileId(profile.id);
  return c.json({
    profile: profileSummaryToApi(profile),
    linkedAgents: agents.map((a) => linkedAgentToApi(a, profile.clerk_user_id)),
  });
});

// ─── Public: profile linked agents ──────────────────────────────────────────

socialRouter.get('/profiles/:handle/linked-agents', (c) => {
  const handle = c.req.param('handle');
  const profile = findSocialProfileByHandle(handle);
  if (!profile) {
    return c.json({ error: 'Profile not found', code: 'NOT_FOUND' }, 404);
  }
  const agents = getLinkedAgentsByProfileId(profile.id);
  return c.json({
    profile: profileToApi(profile),
    linkedAgents: agents.map((a) => linkedAgentToApi(a, profile.clerk_user_id)),
  });
});

// ─── Public: profile stats ───────────────────────────────────────────────────

socialRouter.get('/profiles/:handle/stats', (c) => {
  const handle = c.req.param('handle');
  const profile = findSocialProfileByHandle(handle);
  if (!profile) {
    return c.json({ error: 'Profile not found', code: 'NOT_FOUND' }, 404);
  }
  const stats = getProfileStats(profile.id);
  return c.json({ stats });
});

// ─── Public: follower / following lists ──────────────────────────────────────

socialRouter.get('/profiles/:handle/followers', (c) => {
  const handle = c.req.param('handle');
  const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);
  const cursor = Math.max(Number(c.req.query('cursor') ?? '0'), 0);
  const profile = findSocialProfileByHandle(handle);
  if (!profile) {
    return c.json({ error: 'Profile not found', code: 'NOT_FOUND' }, 404);
  }
  const followers = listFollowers(profile.id, limit, cursor);
  return c.json({
    profile: profileToApi(profile),
    followers: followers.map(profileSummaryToApi),
    pageInfo: { limit, nextCursor: followers.length === limit ? String(cursor + limit) : null },
  });
});

socialRouter.get('/profiles/:handle/following', (c) => {
  const handle = c.req.param('handle');
  const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);
  const cursor = Math.max(Number(c.req.query('cursor') ?? '0'), 0);
  const profile = findSocialProfileByHandle(handle);
  if (!profile) {
    return c.json({ error: 'Profile not found', code: 'NOT_FOUND' }, 404);
  }
  const following = listFollowing(profile.id, limit, cursor);
  return c.json({
    profile: profileToApi(profile),
    following: following.map(profileSummaryToApi),
    pageInfo: { limit, nextCursor: following.length === limit ? String(cursor + limit) : null },
  });
});

// ─── Public: single profile ──────────────────────────────────────────────────

socialRouter.get('/profiles/:handle', (c) => {
  const handle = c.req.param('handle');
  const profile = findSocialProfileByHandle(handle);
  if (!profile) {
    return c.json({ error: 'Profile not found', code: 'NOT_FOUND' }, 404);
  }
  return c.json({ profile: profileToApi(profile) });
});

// ─── Public: profile list ────────────────────────────────────────────────────

socialRouter.get('/profiles', (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);
  const profiles = listSocialProfiles(limit);
  return c.json({ profiles: profiles.map(profileSummaryToApi) });
});

// ─── Public: home feed ───────────────────────────────────────────────────────

socialRouter.get('/feed/home', (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);
  const cursor = Math.max(Number(c.req.query('cursor') ?? '0'), 0);
  const filter = c.req.query('filter');
  const posts = listFeedPosts(limit, cursor, filter);
  return c.json({
    feed: posts.map(postToApi),
    pageInfo: { limit, nextCursor: posts.length === limit ? String(cursor + limit) : null },
  });
});

// ─── Public: profile feed ────────────────────────────────────────────────────

socialRouter.get('/feed/profile/:handle', (c) => {
  const handle = c.req.param('handle');
  const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);
  const cursor = Math.max(Number(c.req.query('cursor') ?? '0'), 0);
  const profile = findSocialProfileByHandle(handle);
  if (!profile) {
    return c.json({ error: 'Profile not found', code: 'NOT_FOUND' }, 404);
  }
  const posts = listFeedPostsByHandle(handle, limit, cursor);
  return c.json({
    profile: profileToApi(profile),
    feed: posts.map(postToApi),
    pageInfo: { limit, nextCursor: posts.length === limit ? String(cursor + limit) : null },
  });
});

// ─── Public: community activity feed ─────────────────────────────────────────

socialRouter.get('/feed/community/:slug', (c) => {
  const slug = c.req.param('slug');
  const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);
  const cursor = Math.max(Number(c.req.query('cursor') ?? '0'), 0);
  const community = findSocialCommunityBySlug(slug);
  if (!community) {
    return c.json({ error: 'Community not found', code: 'NOT_FOUND' }, 404);
  }
  const posts = listCommunityFeedPosts(community.id, limit, cursor);
  return c.json({
    community: communityToApi(community),
    feed: posts.map(postToApi),
    pageInfo: { limit, nextCursor: posts.length === limit ? String(cursor + limit) : null },
  });
});

// ─── Public: communities ─────────────────────────────────────────────────────

socialRouter.get('/communities', (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);
  const communities = listSocialCommunities(limit);
  return c.json({ communities: communities.map(communityToApi) });
});

// ─── Authenticated: my joined communities ────────────────────────────────────
// Note: must remain before any future GET /communities/:slug to prevent "mine"
// from being swallowed by a slug param (Hono's radix router prefers literals,
// but keeping the ordering explicit is safer).

socialRouter.get('/communities/mine', requireSocialAuth, (c) => {
  const clerkUserId = c.get('clerkUserId');
  const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);
  const profile = findSocialProfileByClerkId(clerkUserId);
  if (!profile) {
    return c.json({ error: 'No profile found', code: 'NOT_FOUND' }, 404);
  }
  const communities = listJoinedCommunities(profile.id, limit);
  return c.json({ communities: communities.map(communityMembershipToApi) });
});

// ─── Public: longform ────────────────────────────────────────────────────────

socialRouter.get('/longform', (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);
  const cursor = Math.max(Number(c.req.query('cursor') ?? '0'), 0);
  const entries = listSocialLongform(limit, cursor);
  return c.json({
    longform: entries.map(longformToApi),
    pageInfo: { limit, nextCursor: entries.length === limit ? String(cursor + limit) : null },
  });
});

// ─── Authenticated: create profile ───────────────────────────────────────────

socialRouter.post('/profiles', requireSocialAuth, async (c) => {
  const clerkUserId = c.get('clerkUserId');

  const existing = findSocialProfileByClerkId(clerkUserId);
  if (existing) {
    return c.json({ error: 'Profile already exists', code: 'CONFLICT' }, 409);
  }

  const body = await c.req.json<{ handle?: string; displayName?: string; bio?: string }>();
  const handle = (body.handle ?? '').trim().toLowerCase();
  const displayName = (body.displayName ?? '').trim();

  if (!handle || !/^[a-z0-9_]{2,30}$/.test(handle)) {
    return c.json({ error: 'Handle must be 2–30 characters: letters, digits, underscores', code: 'INVALID_INPUT' }, 400);
  }
  if (!displayName) {
    return c.json({ error: 'displayName is required', code: 'INVALID_INPUT' }, 400);
  }

  const handleTaken = findSocialProfileByHandle(handle);
  if (handleTaken) {
    return c.json({ error: 'Handle is already taken', code: 'CONFLICT' }, 409);
  }

  try {
    const profile = insertSocialProfile({
      clerkUserId,
      handle,
      displayName,
      bio: (body.bio ?? '').trim(),
    });
    return c.json({ ok: true, profile: profileToApi(profile) }, 201);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      return c.json({ error: 'Handle is already taken', code: 'CONFLICT' }, 409);
    }
    throw err;
  }
});

// ─── Authenticated: update profile ───────────────────────────────────────────

socialRouter.patch('/profile', requireSocialAuth, async (c) => {
  const clerkUserId = c.get('clerkUserId');
  const profile = findSocialProfileByClerkId(clerkUserId);
  if (!profile) {
    return c.json({ error: 'No profile found', code: 'NOT_FOUND' }, 404);
  }

  const body = await c.req.json<{
    displayName?: string;
    bio?: string;
    avatarUrl?: string | null;
    bannerUrl?: string | null;
    location?: string | null;
    websiteUrl?: string | null;
  }>();

  const updated = updateSocialProfile(clerkUserId, {
    displayName: body.displayName,
    bio: body.bio,
    avatarUrl: body.avatarUrl,
    bannerUrl: body.bannerUrl,
    location: body.location,
    websiteUrl: body.websiteUrl,
  });
  return c.json({ ok: true, profile: profileToApi(updated!) });
});

// ─── Authenticated: create post ──────────────────────────────────────────────

socialRouter.post('/posts', requireSocialAuth, async (c) => {
  const clerkUserId = c.get('clerkUserId');
  const profile = findSocialProfileByClerkId(clerkUserId);
  if (!profile) {
    return c.json({ error: 'No profile found — create a profile first', code: 'NOT_FOUND' }, 404);
  }

  const body = await c.req.json<{
    body?: string;
    visibility?: string;
    authorMode?: string;
    linkedAgentId?: string;
    replyToPostId?: string;
    quotePostId?: string;
  }>();

  const text = (body.body ?? '').trim();
  if (!text) {
    return c.json({ error: 'Post body is required', code: 'INVALID_INPUT' }, 400);
  }
  if (text.length > 5000) {
    return c.json({ error: 'Post body exceeds 5000 characters', code: 'INVALID_INPUT' }, 400);
  }

  const post = insertSocialPost({
    profileId: profile.id,
    body: text,
    visibility: body.visibility ?? 'public',
    authorMode: body.authorMode ?? 'person',
    linkedAgentId: body.linkedAgentId ?? null,
    replyToPostId: body.replyToPostId ?? null,
    quotePostId: body.quotePostId ?? null,
  });
  return c.json({ ok: true, post: postToApi(post) }, 201);
});

// ─── Authenticated: follow status ────────────────────────────────────────────

socialRouter.get('/follows/:handle/status', requireSocialAuth, (c) => {
  const clerkUserId = c.get('clerkUserId');
  const handle = c.req.param('handle');

  const myProfile = findSocialProfileByClerkId(clerkUserId);
  if (!myProfile) {
    return c.json({ following: false });
  }
  const target = findSocialProfileByHandle(handle);
  if (!target) {
    return c.json({ error: 'Profile not found', code: 'NOT_FOUND' }, 404);
  }
  const following = getFollowStatus(myProfile.id, target.id);
  return c.json({ following });
});

// ─── Authenticated: follow ───────────────────────────────────────────────────

socialRouter.post('/follows/:handle', requireSocialAuth, (c) => {
  const clerkUserId = c.get('clerkUserId');
  const handle = c.req.param('handle');

  const myProfile = findSocialProfileByClerkId(clerkUserId);
  if (!myProfile) {
    return c.json({ error: 'No profile found — create a profile first', code: 'NOT_FOUND' }, 404);
  }
  const target = findSocialProfileByHandle(handle);
  if (!target) {
    return c.json({ error: 'Profile not found', code: 'NOT_FOUND' }, 404);
  }
  if (myProfile.id === target.id) {
    return c.json({ error: 'Cannot follow yourself', code: 'INVALID_INPUT' }, 400);
  }
  const followId = insertSocialFollow(myProfile.id, target.id);
  return c.json({ ok: true, followId, state: 'following' }, 201);
});

// ─── Authenticated: unfollow ─────────────────────────────────────────────────

socialRouter.delete('/follows/:handle', requireSocialAuth, (c) => {
  const clerkUserId = c.get('clerkUserId');
  const handle = c.req.param('handle');

  const myProfile = findSocialProfileByClerkId(clerkUserId);
  if (!myProfile) {
    return c.json({ error: 'No profile found', code: 'NOT_FOUND' }, 404);
  }
  const target = findSocialProfileByHandle(handle);
  if (!target) {
    return c.json({ error: 'Profile not found', code: 'NOT_FOUND' }, 404);
  }
  deleteSocialFollow(myProfile.id, target.id);
  return c.json({ ok: true, state: 'not_following' });
});

// ─── Authenticated: create community ─────────────────────────────────────────

socialRouter.post('/communities', requireSocialAuth, async (c) => {
  const clerkUserId = c.get('clerkUserId');
  const profile = findSocialProfileByClerkId(clerkUserId);
  if (!profile) {
    return c.json({ error: 'No profile found — create a profile first', code: 'NOT_FOUND' }, 404);
  }

  const body = await c.req.json<{
    slug?: string;
    name?: string;
    description?: string;
    visibility?: string;
  }>();

  const slug = (body.slug ?? '').trim().toLowerCase();
  const name = (body.name ?? '').trim();
  if (!slug || !/^[a-z0-9-]{2,50}$/.test(slug)) {
    return c.json({ error: 'Slug must be 2–50 characters: lowercase letters, digits, hyphens', code: 'INVALID_INPUT' }, 400);
  }
  if (!name) {
    return c.json({ error: 'name is required', code: 'INVALID_INPUT' }, 400);
  }

  const existing = findSocialCommunityBySlug(slug);
  if (existing) {
    return c.json({ error: 'Community slug is already taken', code: 'CONFLICT' }, 409);
  }

  try {
    const community = insertSocialCommunity({
      creatorProfileId: profile.id,
      slug,
      name,
      description: (body.description ?? '').trim(),
      visibility: body.visibility ?? 'public',
    });
    return c.json({ ok: true, community: communityToApi(community) }, 201);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      return c.json({ error: 'Community slug is already taken', code: 'CONFLICT' }, 409);
    }
    throw err;
  }
});

// ─── Authenticated: join community ───────────────────────────────────────────

socialRouter.post('/communities/:slug/join', requireSocialAuth, (c) => {
  const clerkUserId = c.get('clerkUserId');
  const slug = c.req.param('slug');

  const profile = findSocialProfileByClerkId(clerkUserId);
  if (!profile) {
    return c.json({ error: 'No profile found — create a profile first', code: 'NOT_FOUND' }, 404);
  }
  const community = findSocialCommunityBySlug(slug);
  if (!community) {
    return c.json({ error: 'Community not found', code: 'NOT_FOUND' }, 404);
  }
  const membershipId = insertCommunityMembership(community.id, profile.id);
  return c.json({ ok: true, membershipId }, 201);
});

// ─── Authenticated: create longform ──────────────────────────────────────────

socialRouter.post('/longform', requireSocialAuth, async (c) => {
  const clerkUserId = c.get('clerkUserId');
  const profile = findSocialProfileByClerkId(clerkUserId);
  if (!profile) {
    return c.json({ error: 'No profile found — create a profile first', code: 'NOT_FOUND' }, 404);
  }

  const body = await c.req.json<{
    title?: string;
    summary?: string;
    body?: string;
    formatType?: string;
    visibility?: string;
    authorMode?: string;
    linkedAgentId?: string;
  }>();

  const title = (body.title ?? '').trim();
  const text = (body.body ?? '').trim();
  if (!title) {
    return c.json({ error: 'title is required', code: 'INVALID_INPUT' }, 400);
  }
  if (!text) {
    return c.json({ error: 'body is required', code: 'INVALID_INPUT' }, 400);
  }

  const entry = insertSocialLongform({
    profileId: profile.id,
    title,
    summary: (body.summary ?? '').trim(),
    body: text,
    formatType: body.formatType ?? 'essay',
    visibility: body.visibility ?? 'public',
    authorMode: body.authorMode ?? 'person',
    linkedAgentId: body.linkedAgentId ?? null,
  });
  return c.json({ ok: true, longform: longformToApi(entry) }, 201);
});
