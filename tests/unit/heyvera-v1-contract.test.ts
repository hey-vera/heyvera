import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMiddleware } from 'hono/factory';
import { createHeyveraV1Router } from '../../src/routes/heyvera-v1';
import {
  _resetDbForTests,
  closeDb,
  initDb,
  insertSocialPost,
  insertSocialProfile,
} from '../../src/db/index';

const testAuth = createMiddleware(async (c, next) => {
  c.set('clerkUserId', 'clerk_test_user');
  c.set('clerkEmail', null);
  await next();
});

describe('HeyVera flat /v1 frontend contract foundation', () => {
  beforeEach(() => {
    _resetDbForTests();
    initDb({ path: ':memory:' });
  });

  afterEach(() => {
    closeDb();
    _resetDbForTests();
  });

  it('returns X-style FeedResponse from existing social posts', async () => {
    const profile = insertSocialProfile({
      clerkUserId: 'clerk_author',
      handle: 'ava',
      displayName: 'Ava Stone',
      bio: 'builder',
    });
    insertSocialPost({
      profileId: profile.id,
      body: 'Hello HeyVera',
      visibility: 'public',
      authorMode: 'person',
      linkedAgentId: null,
      replyToPostId: null,
      quotePostId: null,
    });

    const app = createHeyveraV1Router(testAuth);
    const res = await app.request('/feed');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      has_more: false,
      posts: [
        {
          content: 'Hello HeyVera',
          reply_count: 0,
          repost_count: 0,
          like_count: 0,
          view_count: 0,
          bookmarked: false,
          liked: false,
          reposted: false,
          author: {
            id: profile.id,
            display_name: 'Ava Stone',
            handle: 'ava',
            avatar_url: '',
            verified: false,
          },
        },
      ],
    });
    expect(json.posts[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('creates and reads /me/profile using frontend snake_case fields', async () => {
    const app = createHeyveraV1Router(testAuth);

    const createRes = await app.request('/me/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        display_name: 'Vera User',
        handle: '@Vera_User',
        bio: 'shipping',
        avatar_url: 'https://example.test/avatar.png',
        banner_url: 'https://example.test/banner.png',
        location: 'Internet',
        website: 'https://heyvera.org',
      }),
    });
    const created = await createRes.json();

    expect(createRes.status).toBe(201);
    expect(created).toMatchObject({
      display_name: 'Vera User',
      handle: 'vera_user',
      bio: 'shipping',
      avatar_url: 'https://example.test/avatar.png',
      banner_url: 'https://example.test/banner.png',
      location: 'Internet',
      website: 'https://heyvera.org',
      follower_count: 0,
      following_count: 0,
      post_count: 0,
      is_following: false,
      is_followed_by: false,
    });

    const readRes = await app.request('/me/profile');
    const read = await readRes.json();

    expect(readRes.status).toBe(200);
    expect(read).toEqual(created);
  });

  it('updates /me/profile with frontend snake_case fields', async () => {
    insertSocialProfile({
      clerkUserId: 'clerk_test_user',
      handle: 'vera',
      displayName: 'Vera',
      bio: '',
    });
    const app = createHeyveraV1Router(testAuth);

    const res = await app.request('/me/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        display_name: 'Vera Updated',
        bio: 'new bio',
        website: 'https://updated.example',
      }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      display_name: 'Vera Updated',
      handle: 'vera',
      bio: 'new bio',
      website: 'https://updated.example',
    });
  });

  it('returns contract-shaped 404 when the signed-in user has no profile', async () => {
    const app = createHeyveraV1Router(testAuth);
    const res = await app.request('/me/profile');
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json).toEqual({
      error: {
        code: 'PROFILE_NOT_FOUND',
        message: 'Profile not found',
        details: null,
      },
    });
  });
});
