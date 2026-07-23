import { beforeEach, describe, expect, it, vi } from 'vitest';

type FetchMock = ReturnType<typeof vi.fn>;

function mockFetch(): FetchMock {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('api social (legacy-compatible functions)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('prefixes requests with the same-origin /v1 API base in production mode', async () => {
    vi.stubEnv('VITE_API_URL', '/v1');
    const fetchMock = mockFetch();

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ posts: [], next_cursor: null }),
    });

    const { getFeed } = await import('./social');
    await getFeed();

    expect(fetchMock).toHaveBeenCalledWith('/v1/social/feed/home', undefined);
  });

  it('surfaces invalid JSON errors when the API falls back to HTML', async () => {
    vi.stubEnv('VITE_API_URL', '/v1');
    const fetchMock = mockFetch();

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token < in JSON at position 0')),
    });

    const { getFeed } = await import('./social');

    await expect(getFeed()).rejects.toThrow('Unexpected token < in JSON at position 0');
    expect(fetchMock).toHaveBeenCalledWith('/v1/social/feed/home', undefined);
  });

  it('blocks signed-out legacy mutations when real API mode is enabled', async () => {
    vi.stubEnv('VITE_API_URL', '/v1');
    mockFetch();
    const { legacyCreatePost, followUser, unfollowUser } =
      await import('./social');

    await expect(legacyCreatePost('hello')).rejects.toThrow('Auth token required');
    await expect(followUser('user-1')).rejects.toThrow('Auth token required');
    await expect(unfollowUser('user-1')).rejects.toThrow('Auth token required');
  });

  it('calls the real API for authenticated social actions', async () => {
    vi.stubEnv('VITE_API_URL', '/v1');
    const fetchMock = mockFetch();

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ ok: true }),
    });

    const { likePost, unlikePost, repostPost, bookmarkPost } =
      await import('./social');

    await likePost('token-1', 'post-1');
    await unlikePost('token-1', 'post-1');
    await repostPost('token-1', 'post-1');
    await bookmarkPost('token-1', 'post-1');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('passes opaque feed cursor as a string (never Number-coerced)', async () => {
    vi.stubEnv('VITE_API_URL', '/v1');
    const fetchMock = mockFetch();

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ posts: [], cursor: null, has_more: false }),
    });

    const { fetchHomeFeed } = await import('./social');
    const cursor = 'MjAyNi0wNy0wMXxwb3N0X2FiYw';
    await fetchHomeFeed(20, cursor);

    const calledUrl = String(fetchMock.mock.calls[0]?.[0] ?? '');
    expect(calledUrl).toContain(`cursor=${encodeURIComponent(cursor)}`);
    // Must not be coerced to numeric NaN/0
    expect(calledUrl).not.toContain('cursor=NaN');
    expect(calledUrl).not.toMatch(/cursor=0(?:&|$)/);
  });

  it('unrepost uses DELETE /posts/{id}/repost', async () => {
    vi.stubEnv('VITE_API_URL', '/v1');
    const fetchMock = mockFetch();

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ ok: true }),
    });

    const { unrepostPost } = await import('./social');
    await unrepostPost('token-1', 'post-99');

    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/social/posts/post-99/repost',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
      }),
    );
  });

  it('markNotificationsRead POSTs /notifications/read', async () => {
    vi.stubEnv('VITE_API_URL', '/v1');
    const fetchMock = mockFetch();

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ ok: true, updated: 2 }),
    });

    const { markNotificationsRead } = await import('./social');
    const result = await markNotificationsRead('token-n');
    expect(result.ok).toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/social/notifications/read',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token-n' }),
      }),
    );
  });

  it('createConversation POSTs participant_ids', async () => {
    vi.stubEnv('VITE_API_URL', '/v1');
    const fetchMock = mockFetch();

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        id: 'conv_1',
        participants: [],
        last_message: null,
        unread_count: 0,
        pinned: false,
      }),
    });

    const { createConversation } = await import('./social');
    const conv = await createConversation('token-dm', ['profile_other']);
    expect(conv.id).toBe('conv_1');

    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/social/conversations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ participant_ids: ['profile_other'] }),
      }),
    );
  });

  it('createCommunity and joinCommunity hit real guild routes', async () => {
    vi.stubEnv('VITE_API_URL', '/v1');
    const fetchMock = mockFetch();

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ ok: true, community: { id: 'g1', slug: 'builders' } }),
    });

    const { createCommunity, joinCommunity, leaveCommunity, fetchMyCommunities } =
      await import('./social');

    await createCommunity('token-g', { slug: 'builders', name: 'Builders' });
    await joinCommunity('token-g', 'builders');
    await leaveCommunity('token-g', 'builders');
    await fetchMyCommunities('token-g');

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain('/v1/social/communities');
    expect(urls.some((u) => u.includes('/communities/builders/join'))).toBe(true);
    expect(urls.some((u) => u.includes('/communities/builders/leave'))).toBe(true);
    expect(urls.some((u) => u.includes('/communities/mine'))).toBe(true);
  });

  it('community invites, members, and redeem hit Batch C routes', async () => {
    vi.stubEnv('VITE_API_URL', '/v1');
    const fetchMock = mockFetch();

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        ok: true,
        invite: { id: 'cinv_1', token: 'hvinv_x', useCount: 0 },
        members: [],
        count: 0,
        invites: [],
        joined: true,
      }),
    });

    const {
      createCommunityInvite,
      fetchCommunityInvites,
      revokeCommunityInvite,
      fetchCommunityMembers,
      redeemCommunityInvite,
    } = await import('./social');

    await createCommunityInvite('tok', 'guild-1', { maxUses: 5 });
    await fetchCommunityInvites('tok', 'guild-1');
    await revokeCommunityInvite('tok', 'guild-1', 'cinv_1');
    await fetchCommunityMembers('guild-1', 20, 'tok');
    await redeemCommunityInvite('tok', 'hvinv_x');

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/communities/guild-1/invites'))).toBe(true);
    expect(urls.some((u) => u.includes('/communities/guild-1/invites/cinv_1'))).toBe(true);
    expect(urls.some((u) => u.includes('/communities/guild-1/members'))).toBe(true);
    expect(urls.some((u) => u.includes('/invites/hvinv_x/redeem'))).toBe(true);
  });
});
