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

    expect(fetchMock).toHaveBeenCalledWith('/v1/feed', undefined);
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
    expect(fetchMock).toHaveBeenCalledWith('/v1/feed', undefined);
  });

  it('blocks signed-out mutations when real API mode is enabled', async () => {
    vi.stubEnv('VITE_API_URL', '/v1');
    const fetchMock = mockFetch();
    const { bookmarkPost, legacyCreatePost, followUser, likePost, repostPost, unlikePost, unfollowUser } =
      await import('./social');

    await expect(legacyCreatePost('hello')).rejects.toThrow('Auth token required');
    await expect(likePost('post-1')).rejects.toThrow('Auth token required');
    await expect(unlikePost('post-1')).rejects.toThrow('Auth token required');
    await expect(repostPost('post-1')).rejects.toThrow('Auth token required');
    await expect(bookmarkPost('post-1')).rejects.toThrow('Auth token required');
    await expect(followUser('user-1')).rejects.toThrow('Auth token required');
    await expect(unfollowUser('user-1')).rejects.toThrow('Auth token required');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
