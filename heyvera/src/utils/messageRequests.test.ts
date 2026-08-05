import { describe, expect, it } from 'vitest';
import type { MessageRequest } from '../api/types';
import {
  appendMessageRequestPage,
  formatMessageRequestSharedContext,
  mergeMessageRequestHead,
  messageRequestCountLabel,
  removeMessageRequest,
} from './messageRequests';

function request(id: string, followsYou = false, youFollow = false, communities = 0): MessageRequest {
  return {
    id,
    state: 'pending',
    bucket: 'inbox',
    content: `message ${id}`,
    created_at: '2026-08-01T00:00:00Z',
    sender: { id: `sender-${id}`, display_name: id, handle: id, avatar_url: '', verified: false },
    shared_context: {
      sender_follows_you: followsYou,
      you_follow_sender: youFollow,
      shared_community_count: communities,
    },
  };
}

describe('message request list utilities', () => {
  it('refreshes the head without discarding loaded request pages', () => {
    expect(mergeMessageRequestHead(
      [request('r3'), request('r2'), request('r1')],
      [request('r2'), request('r4')],
    ).map((item) => item.id)).toEqual(['r2', 'r4', 'r3', 'r1']);
  });

  it('appends overlapping pages once and removes resolved requests', () => {
    const merged = appendMessageRequestPage(
      [request('r3'), request('r2')],
      [request('r2', true, true), request('r1')],
    );
    expect(merged.map((item) => item.id)).toEqual(['r3', 'r2', 'r1']);
    expect(merged[1]?.shared_context.sender_follows_you).toBe(true);
    expect(removeMessageRequest(merged, 'r2').map((item) => item.id)).toEqual(['r3', 'r1']);
  });

  it('formats only real shared context and labels partial counts honestly', () => {
    expect(formatMessageRequestSharedContext(request('r1'))).toBeNull();
    expect(formatMessageRequestSharedContext(request('r2', true, true, 2))).toBe(
      'You follow each other · 2 shared Guilds',
    );
    expect(messageRequestCountLabel(7, false)).toBe('7');
    expect(messageRequestCountLabel(30, true)).toBe('30+');
    expect(messageRequestCountLabel(0, true)).toBeNull();
  });
});
