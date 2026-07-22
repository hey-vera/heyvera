import { describe, expect, it } from 'vitest';
import { parseSocialDmWsMessage, socialDmWsUrl, subscribePayload } from './socialDmWs';

describe('parseSocialDmWsMessage', () => {
  it('parses message events with camelCase conversationId', () => {
    const raw = JSON.stringify({
      type: 'message',
      conversationId: 'c-1',
      message: {
        id: 'm-1',
        content: 'hi',
        created_at: '2026-01-01T00:00:00Z',
        read: false,
        sender: {
          id: 'p1',
          display_name: 'Ada',
          handle: 'ada',
          avatar_url: '',
          verified: false,
        },
      },
    });
    const parsed = parseSocialDmWsMessage(raw);
    expect(parsed).toEqual({
      type: 'message',
      conversationId: 'c-1',
      message: expect.objectContaining({ id: 'm-1', content: 'hi' }),
    });
  });

  it('accepts snake_case conversation_id alias', () => {
    const raw = JSON.stringify({
      type: 'message',
      conversation_id: 'c-2',
      message: { id: 'm-2', content: 'yo', created_at: 't', read: true, sender: { id: 'x' } },
    });
    const parsed = parseSocialDmWsMessage(raw);
    expect(parsed?.type).toBe('message');
    if (parsed?.type === 'message') {
      expect(parsed.conversationId).toBe('c-2');
    }
  });

  it('returns null for invalid payloads', () => {
    expect(parseSocialDmWsMessage('')).toBeNull();
    expect(parseSocialDmWsMessage('not-json')).toBeNull();
    expect(parseSocialDmWsMessage('[]')).toBeNull();
    expect(parseSocialDmWsMessage(JSON.stringify({ foo: 1 }))).toBeNull();
    expect(
      parseSocialDmWsMessage(JSON.stringify({ type: 'message', conversationId: 'c' })),
    ).toBeNull();
  });

  it('passes through welcome / error frames', () => {
    expect(parseSocialDmWsMessage(JSON.stringify({ type: 'welcome', protocol: 'social-dm/v1' }))).toEqual(
      expect.objectContaining({ type: 'welcome' }),
    );
    expect(parseSocialDmWsMessage(JSON.stringify({ type: 'error', code: 'auth_failed' }))).toEqual(
      expect.objectContaining({ type: 'error', code: 'auth_failed' }),
    );
  });
});

describe('socialDmWsUrl / subscribePayload', () => {
  it('builds ws url from http API base', () => {
    expect(socialDmWsUrl('tok', 'http://localhost:3402')).toBe(
      'ws://localhost:3402/v1/social/ws?token=tok',
    );
    expect(socialDmWsUrl('a b', 'https://api.example.com/')).toBe(
      'wss://api.example.com/v1/social/ws?token=a%20b',
    );
  });

  it('builds subscribe frame', () => {
    expect(JSON.parse(subscribePayload('conv-9'))).toEqual({
      type: 'subscribe',
      conversationId: 'conv-9',
    });
  });
});
