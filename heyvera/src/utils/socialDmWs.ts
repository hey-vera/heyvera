import type { Message } from '../api/types';

/** Server → client frames we care about for DMs. */
export type SocialDmWsServerEvent =
  | { type: 'welcome'; protocol?: string; user_id?: string; profile_id?: string | null }
  | { type: 'subscribed'; conversationId: string }
  | { type: 'unsubscribed'; conversationId: string }
  | { type: 'message'; conversationId: string; message: Message }
  | { type: 'read'; conversationId: string; profileId: string; throughMessageId: string }
  | { type: 'pong' }
  | { type: 'gap'; conversationId: string; reason: 'slow_consumer' }
  | { type: 'error'; code?: string; message?: string; conversationId?: string }
  | { type: 'unknown'; rawType: string };

/**
 * Pure helper: parse a social DM WebSocket text frame.
 * Returns null when the payload is not valid JSON or not an object.
 */
export function parseSocialDmWsMessage(raw: string): SocialDmWsServerEvent | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const obj = data as Record<string, unknown>;
    if (typeof obj.type !== 'string' || !obj.type) return null;

    if (obj.type === 'message') {
      const conversationId =
        typeof obj.conversationId === 'string'
          ? obj.conversationId
          : typeof obj.conversation_id === 'string'
            ? obj.conversation_id
            : null;
      const message = obj.message;
      if (!conversationId || !message || typeof message !== 'object') return null;
      const msg = message as Record<string, unknown>;
      if (typeof msg.id !== 'string' || typeof msg.content !== 'string') return null;
      return {
        type: 'message',
        conversationId,
        message: message as Message,
      };
    }

    if (obj.type === 'read') {
      const conversationId = stringField(obj, 'conversationId', 'conversation_id');
      const profileId = stringField(obj, 'profileId', 'profile_id');
      const throughMessageId = stringField(obj, 'throughMessageId', 'through_message_id');
      if (!conversationId || !profileId || !throughMessageId) return null;
      return { type: 'read', conversationId, profileId, throughMessageId };
    }

    if (obj.type === 'gap') {
      const conversationId = stringField(obj, 'conversationId', 'conversation_id');
      if (!conversationId || obj.reason !== 'slow_consumer') return null;
      return {
        type: 'gap',
        conversationId,
        reason: 'slow_consumer',
      };
    }
    if (obj.type === 'subscribed' || obj.type === 'unsubscribed') {
      const conversationId = stringField(obj, 'conversationId', 'conversation_id');
      if (!conversationId) return null;
      return { type: obj.type, conversationId };
    }
    if (obj.type === 'welcome' || obj.type === 'pong' || obj.type === 'error') {
      return obj as SocialDmWsServerEvent;
    }
    return { type: 'unknown', rawType: obj.type };
  } catch {
    return null;
  }
}

function stringField(
  value: Record<string, unknown>,
  camelCase: string,
  snakeCase: string,
): string | null {
  const candidate = value[camelCase] ?? value[snakeCase];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

/** Build ws(s) URL using an opaque, short-lived, single-use ticket. */
export function socialDmWsUrl(ticket: string, apiBase?: string): string {
  const base = apiBase ?? (typeof import.meta !== 'undefined' ? import.meta.env.VITE_API_URL : undefined);
  if (base && typeof base === 'string' && base.length > 0) {
    const u = new URL(base.endsWith('/') ? base.slice(0, -1) : base);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    // API base may be origin or origin + path; always target /v1/social/ws
    u.pathname = '/v1/social/ws';
    u.search = `?ticket=${encodeURIComponent(ticket)}`;
    u.hash = '';
    return u.toString();
  }

  if (typeof window !== 'undefined' && window.location) {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/v1/social/ws?ticket=${encodeURIComponent(ticket)}`;
  }

  return `ws://localhost/v1/social/ws?ticket=${encodeURIComponent(ticket)}`;
}

export function subscribePayload(conversationId: string): string {
  return JSON.stringify({ type: 'subscribe', conversationId });
}

export function unsubscribePayload(conversationId: string): string {
  return JSON.stringify({ type: 'unsubscribe', conversationId });
}

/** Client application ping (server replies with `{ type: "pong" }`). */
export function pingPayload(): string {
  return JSON.stringify({ type: 'ping' });
}

/**
 * Light exponential backoff for DM WebSocket reconnect.
 * attempt 0 → 2s, 1 → 4s, 2 → 8s, … capped at 30s.
 */
export function nextDmReconnectDelayMs(attempt: number, capMs = 30_000): number {
  const n = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  const delay = 2_000 * Math.pow(2, n);
  return Math.min(capMs, delay);
}
