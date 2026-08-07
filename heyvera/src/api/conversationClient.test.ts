import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('conversation inbox API contract', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('passes a bounded opaque cursor and normalizes page metadata', async () => {
    vi.stubEnv('VITE_API_URL', '/v1');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        conversations: [],
        next_cursor: 'hvc1.next',
        has_more: true,
        total_unread_count: 47,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getConversations } = await import('./social');
    const page = await getConversations('token-dm', {
      limit: 25,
      cursor: 'hvc1.a/b?',
    });

    expect(page).toEqual({
      conversations: [],
      next_cursor: 'hvc1.next',
      has_more: true,
      total_unread_count: 47,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/v1/social/conversations?limit=25&cursor=hvc1.a%2Fb%3F',
    );
  });

  it('hydrates one encoded conversation and reads the uncapped badge total', async () => {
    vi.stubEnv('VITE_API_URL', '/v1');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          id: 'conversation-1',
          participants: [],
          last_message: null,
          unread_count: 0,
          pinned: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ unread_count: 123 }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { getConversation, getConversationUnreadCount } = await import('./social');
    const conversation = await getConversation('token-dm', 'conversation/1');
    const unread = await getConversationUnreadCount('token-dm');

    expect(conversation.id).toBe('conversation-1');
    expect(unread).toBe(123);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/social/conversations/conversation%2F1');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/v1/social/conversations/unread-count');
  });

  it('rejects limits outside the backend contract', async () => {
    const { getConversations } = await import('./social');
    await expect(getConversations('token-dm', { limit: 0 })).rejects.toThrow(
      'between 1 and 100',
    );
    await expect(getConversations('token-dm', { limit: 101 })).rejects.toThrow(
      'between 1 and 100',
    );
  });
});
