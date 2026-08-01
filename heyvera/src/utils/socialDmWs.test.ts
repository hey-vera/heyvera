import { describe, expect, it } from 'vitest';
import {
  nextDmReconnectDelayMs,
  parseSocialDmWsMessage,
  pingPayload,
  socialDmWsUrl,
  subscribePayload,
  unsubscribePayload,
} from './socialDmWs';

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

  it('parses participant read receipts in camelCase', () => {
    expect(
      parseSocialDmWsMessage(
        JSON.stringify({
          type: 'read',
          conversationId: 'c-2',
          profileId: 'profile-reader',
          throughMessageId: 'm-9',
        }),
      ),
    ).toEqual({
      type: 'read',
      conversationId: 'c-2',
      profileId: 'profile-reader',
      throughMessageId: 'm-9',
    });
  });

  it('accepts snake_case read receipt aliases and rejects incomplete receipts', () => {
    expect(
      parseSocialDmWsMessage(
        JSON.stringify({
          type: 'read',
          conversation_id: 'c-3',
          profile_id: 'profile-reader',
          through_message_id: 'm-10',
        }),
      ),
    ).toEqual(expect.objectContaining({ conversationId: 'c-3', throughMessageId: 'm-10' }));
    expect(parseSocialDmWsMessage(JSON.stringify({ type: 'read', conversationId: 'c-3' }))).toBeNull();
  });

  it('parses subscription acknowledgements and explicit slow-consumer gaps', () => {
    expect(
      parseSocialDmWsMessage(
        JSON.stringify({ type: 'subscribed', conversation_id: 'conversation-7' }),
      ),
    ).toEqual({ type: 'subscribed', conversationId: 'conversation-7' });
    expect(
      parseSocialDmWsMessage(
        JSON.stringify({
          type: 'gap',
          conversationId: 'conversation-7',
          reason: 'slow_consumer',
        }),
      ),
    ).toEqual({
      type: 'gap',
      conversationId: 'conversation-7',
      reason: 'slow_consumer',
    });
    expect(
      parseSocialDmWsMessage(
        JSON.stringify({ type: 'gap', conversationId: 'conversation-7', reason: 'unknown' }),
      ),
    ).toBeNull();
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
      'ws://localhost:3402/v1/social/ws?ticket=tok',
    );
    expect(socialDmWsUrl('a b', 'https://api.example.com/')).toBe(
      'wss://api.example.com/v1/social/ws?ticket=a%20b',
    );
  });

  it('builds subscribe frame', () => {
    expect(JSON.parse(subscribePayload('conv-9'))).toEqual({
      type: 'subscribe',
      conversationId: 'conv-9',
    });
  });

  it('builds unsubscribe frame', () => {
    expect(JSON.parse(unsubscribePayload('conv-9'))).toEqual({
      type: 'unsubscribe',
      conversationId: 'conv-9',
    });
  });
  it('builds ping frame', () => {
    expect(JSON.parse(pingPayload())).toEqual({ type: 'ping' });
  });

  it('exponential reconnect backoff 2s → 4s → 8s capped at 30s', () => {
    expect(nextDmReconnectDelayMs(0)).toBe(2_000);
    expect(nextDmReconnectDelayMs(1)).toBe(4_000);
    expect(nextDmReconnectDelayMs(2)).toBe(8_000);
    expect(nextDmReconnectDelayMs(3)).toBe(16_000);
    expect(nextDmReconnectDelayMs(4)).toBe(30_000);
    expect(nextDmReconnectDelayMs(10)).toBe(30_000);
  });
});
