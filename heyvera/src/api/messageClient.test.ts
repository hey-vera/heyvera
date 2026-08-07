import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('message API contract', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('passes a bounded opaque cursor and returns page metadata', async () => {
    vi.stubEnv('VITE_API_URL', '/v1');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        messages: [],
        next_cursor: 'hvm1.next',
        has_more: true,
      }),
    });

    const { getMessages } = await import('./social');
    const page = await getMessages('conv/1', 'token-dm', {
      limit: 25,
      cursor: 'hvm1.a/b?',
    });

    expect(page).toEqual({
      messages: [],
      next_cursor: 'hvm1.next',
      has_more: true,
      sync_cursor: null,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/v1/social/conversations/conv%2F1/messages?limit=25&cursor=hvm1.a%2Fb%3F',
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(request.headers).get('Authorization')).toBe('Bearer token-dm');
  });

  it('passes a forward sync cursor and returns the advanced recovery boundary', async () => {
    vi.stubEnv('VITE_API_URL', '/v1');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        messages: [],
        next_cursor: null,
        sync_cursor: 'hvs1.advanced',
        has_more: false,
      }),
    });

    const { getMessages } = await import('./social');
    const page = await getMessages('conv/1', 'token-dm', {
      limit: 100,
      afterCursor: 'hvs1.current/a?',
    });

    expect(page).toEqual({
      messages: [],
      next_cursor: null,
      sync_cursor: 'hvs1.advanced',
      has_more: false,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/v1/social/conversations/conv%2F1/messages?limit=100&after_cursor=hvs1.current%2Fa%3F',
    );
  });

  it('advances only the viewer read watermark through one message', async () => {
    vi.stubEnv('VITE_API_URL', '/v1');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ ok: true, through_message_id: 'msg_9', unread_count: 0 }),
    });

    const { markConversationRead } = await import('./social');
    const result = await markConversationRead('token-dm', 'conv/1', 'msg_9');

    expect(result.unread_count).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/social/conversations/conv%2F1/read',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ through_message_id: 'msg_9' }),
        headers: expect.objectContaining({ Authorization: 'Bearer token-dm' }),
      }),
    );
  });

  it('rejects limits outside the backend contract', async () => {
    const { getMessages } = await import('./social');
    await expect(getMessages('conv_1', 'token-dm', { limit: 101 })).rejects.toThrow(
      'between 1 and 100',
    );
  });
});
