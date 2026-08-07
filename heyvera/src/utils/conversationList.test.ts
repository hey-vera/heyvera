import { describe, expect, it } from 'vitest';
import type { Conversation } from '../api/types';
import {
  appendConversationPage,
  mergeConversationHead,
  promoteConversation,
} from './conversationList';

function conversation(id: string, unread = 0): Conversation {
  return {
    id,
    participants: [],
    last_message: null,
    unread_count: unread,
    pinned: false,
  };
}

describe('conversation list merging', () => {
  it('refreshes the head without discarding an already loaded tail', () => {
    const current = [conversation('c3'), conversation('c2'), conversation('c1')];
    const refreshed = [conversation('c2', 4), conversation('c4')];

    expect(mergeConversationHead(current, refreshed).map((item) => item.id)).toEqual([
      'c2',
      'c4',
      'c3',
      'c1',
    ]);
    expect(mergeConversationHead(current, refreshed)[0]?.unread_count).toBe(4);
  });

  it('appends overlapping pages once while refreshing duplicate representations', () => {
    const current = [conversation('c4'), conversation('c3')];
    const page = [conversation('c3', 2), conversation('c2')];
    const merged = appendConversationPage(current, page);

    expect(merged.map((item) => item.id)).toEqual(['c4', 'c3', 'c2']);
    expect(merged[1]?.unread_count).toBe(2);
  });

  it('promotes activity to the head without duplicating the conversation', () => {
    const current = [conversation('c3'), conversation('c2'), conversation('c1')];
    const promoted = promoteConversation(current, 'c1', (item) => ({
      ...item,
      unread_count: 1,
    }));

    expect(promoted.map((item) => item.id)).toEqual(['c1', 'c3', 'c2']);
    expect(promoted[0]?.unread_count).toBe(1);
  });
});
