import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedPost } from './social';

type FetchMock = ReturnType<typeof vi.fn>;

function successfulJson(body: unknown, status = 200) {
  return {
    ok: true,
    status,
    statusText: 'OK',
    json: vi.fn().mockResolvedValue(body),
  };
}

function stubFetch(): FetchMock {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function feedPostWithMedia(url: string): FeedPost {
  return {
    id: 'post-1',
    body: 'media post',
    visibility: 'public',
    proofState: 'unverified',
    authorMode: 'person',
    replyToPostId: null,
    quotePostId: null,
    createdAt: '2026-07-31T00:00:00Z',
    updatedAt: '2026-07-31T00:00:00Z',
    author: {
      profileId: 'profile-1',
      handle: 'author',
      displayName: 'Author',
    },
    linkedAgent: null,
    media: [{ id: 'media-1', url, mediaType: 'image' }],
  };
}

describe('viewer-aware Socials API requests', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('sends the viewer token when listing profiles', async () => {
    vi.stubEnv('VITE_API_URL', '/v1');
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValue(successfulJson({ profiles: [] }));

    const { fetchProfiles } = await import('./social');
    await fetchProfiles(7, 'viewer-token');

    expect(fetchMock).toHaveBeenCalledWith('/v1/social/profiles?limit=7', {
      headers: { Authorization: 'Bearer viewer-token' },
    });
  });
});

describe('media URL resolution', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('maps API-relative delivery URLs to the configured API origin', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.heyvera.org/v1');

    const { feedPostToPost } = await import('./social');
    const post = feedPostToPost(feedPostWithMedia('/v1/social/media/media-1/content'));

    expect(post.media?.[0]?.url).toBe(
      'https://api.heyvera.org/v1/social/media/media-1/content',
    );
  });

  it('uploads an API-relative URL against the API origin without duplicating /v1', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.heyvera.org/v1');
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const { putMediaFile } = await import('./social');
    const file = new File(['pixels'], 'photo.png', { type: 'image/png' });
    await putMediaFile('/v1/social/media/media-1/upload', file);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.heyvera.org/v1/social/media/media-1/upload',
      expect.objectContaining({
        method: 'PUT',
        body: file,
      }),
    );
  });

  it('preserves external media URLs', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.heyvera.org/v1/social');

    const { feedPostToPost } = await import('./social');
    const post = feedPostToPost(feedPostWithMedia('https://cdn.heyvera.org/media-1.webp'));

    expect(post.media?.[0]?.url).toBe('https://cdn.heyvera.org/media-1.webp');
  });
});

describe('protected-profile follow contracts', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('preserves pending follow state from create and status responses', async () => {
    vi.stubEnv('VITE_API_URL', '/v1');
    const fetchMock = stubFetch();
    fetchMock
      .mockResolvedValueOnce(
        successfulJson({
          ok: true,
          requestId: 'follow-request-1',
          state: 'pending',
        }),
      )
      .mockResolvedValueOnce(
        successfulJson({
          following: false,
          pending: true,
        }),
      );

    const { followProfile, fetchFollowStatus } = await import('./social');
    const created = await followProfile('viewer-token', 'protected');
    const status = await fetchFollowStatus('viewer-token', 'protected');

    expect(created).toEqual({
      ok: true,
      requestId: 'follow-request-1',
      state: 'pending',
    });
    expect(status).toEqual({ following: false, pending: true });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/v1/social/follows/protected',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/v1/social/follows/protected/status',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('uses explicit approve and reject routes for incoming requests', async () => {
    vi.stubEnv('VITE_API_URL', '/v1');
    const fetchMock = stubFetch();
    fetchMock
      .mockResolvedValueOnce(successfulJson({ ok: true, state: 'accepted' }))
      .mockResolvedValueOnce(successfulJson({ ok: true, state: 'rejected' }));

    const { approveFollowRequest, rejectFollowRequest } = await import('./social');
    await approveFollowRequest('owner-token', 'request/1');
    await rejectFollowRequest('owner-token', 'request/2');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/v1/social/follow-requests/request%2F1/approve',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/v1/social/follow-requests/request%2F2',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
