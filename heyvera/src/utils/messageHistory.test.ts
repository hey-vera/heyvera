import { describe, expect, it } from 'vitest';
import type { Message } from '../api/types';
import { mergeMessageHistory } from './messageHistory';

function message(sequence: number, id: string, readBy: string[] = []): Message {
  return {
    id,
    sequence,
    client_message_id: null,
    sender: {
      id: 'sender',
      display_name: 'Sender',
      handle: 'sender',
      avatar_url: '',
      verified: false,
    },
    content: id,
    created_at: `2026-01-01T00:00:${String(sequence).padStart(2, '0')}Z`,
    read: readBy.length > 0,
    read_by_profile_ids: readBy,
  };
}

describe('mergeMessageHistory', () => {
  it('prepends older pages and keeps canonical sequence order', () => {
    const current = [message(3, 'm3'), message(4, 'm4')];
    const older = [message(1, 'm1'), message(2, 'm2')];

    expect(mergeMessageHistory(current, older).map((item) => item.id)).toEqual([
      'm1',
      'm2',
      'm3',
      'm4',
    ]);
  });

  it('deduplicates overlapping pages and lets receipt metadata advance', () => {
    const current = [message(1, 'm1'), message(2, 'm2')];
    const refreshed = [message(2, 'm2', ['reader']), message(3, 'm3')];

    const merged = mergeMessageHistory(current, refreshed);
    expect(merged.map((item) => item.id)).toEqual(['m1', 'm2', 'm3']);
    expect(merged[1]?.read_by_profile_ids).toEqual(['reader']);
  });

  it('uses timestamp and id as deterministic tie breakers', () => {
    const a = { ...message(1, 'b'), created_at: '2026-01-01T00:00:00Z' };
    const b = { ...message(1, 'a'), created_at: '2026-01-01T00:00:00Z' };
    expect(mergeMessageHistory([], [a, b]).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('returns the existing reference when there is nothing to merge', () => {
    const current = [message(1, 'm1')];
    expect(mergeMessageHistory(current, [])).toBe(current);
  });
});
