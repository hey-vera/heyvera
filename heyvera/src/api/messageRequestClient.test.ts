import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('message request API contract', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('starts a direct message with one stable request id and preserves the discriminant', async () => {
    vi.stubEnv('VITE_API_URL', '/v1');
    const response = {
      kind: 'request' as const,
      replayed: false,
      request: {
        id: 'request-1',
        state: 'pending',
        created_at: '2026-08-01T00:00:00Z',
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(response),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { startDirectMessage } = await import('./social');
    await expect(startDirectMessage('token-dm', {
      recipientId: 'profile/other',
      content: 'Hello there',
      clientRequestId: 'client-request-1',
    })).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/social/direct-message-starts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          recipient_id: 'profile/other',
          content: 'Hello there',
          client_request_id: 'client-request-1',
        }),
      }),
    );
  });

  it('lists an encoded opaque request page for the selected bucket', async () => {
    vi.stubEnv('VITE_API_URL', '/v1');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        requests: [],
        next_cursor: 'hvr1.next',
        has_more: true,
        total_pending_count: 7,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getMessageRequests } = await import('./social');
    await expect(getMessageRequests('token-dm', {
      bucket: 'inbox',
      limit: 25,
      cursor: 'hvr1.a/b?',
    })).resolves.toEqual({ requests: [], next_cursor: 'hvr1.next', has_more: true, total_pending_count: 7 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/v1/social/message-requests?bucket=inbox&limit=25&cursor=hvr1.a%2Fb%3F',
    );
  });

  it('encodes request ids for accept, decline, spam, and cancellation', async () => {
    vi.stubEnv('VITE_API_URL', '/v1');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ ok: true, state: 'declined' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const api = await import('./social');
    await api.declineMessageRequest('token-dm', 'request/1');
    await api.markMessageRequestSpam('token-dm', 'request/1');
    await api.cancelMessageRequest('token-dm', 'request/1');

    expect(fetchMock.mock.calls.map((call) => [call[0], (call[1] as RequestInit).method])).toEqual([
      ['/v1/social/message-requests/request%2F1/decline', 'POST'],
      ['/v1/social/message-requests/request%2F1/spam', 'POST'],
      ['/v1/social/message-requests/request%2F1', 'DELETE'],
    ]);
  });

  it('rejects request page limits outside the backend contract', async () => {
    const { getMessageRequests } = await import('./social');
    await expect(getMessageRequests('token-dm', { limit: 0 })).rejects.toThrow('between 1 and 100');
    await expect(getMessageRequests('token-dm', { limit: 101 })).rejects.toThrow('between 1 and 100');
  });
});
