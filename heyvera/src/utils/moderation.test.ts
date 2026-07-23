import { describe, expect, it } from 'vitest';
import {
  addExcludedAuthor,
  filterPostsExcludingAuthors,
  mapReportToApiBody,
  normalizeReportReason,
  REPORT_REASON_CHOICES,
} from './moderation';

describe('filterPostsExcludingAuthors', () => {
  const posts = [
    { id: '1', author: { id: 'a' } },
    { id: '2', author: { id: 'b' } },
    { id: '3', author: { id: 'a' } },
    { id: '4', authorId: 'c' },
  ];

  it('returns all when exclusion set empty', () => {
    expect(filterPostsExcludingAuthors(posts, [])).toHaveLength(4);
    expect(filterPostsExcludingAuthors(posts, new Set())).toHaveLength(4);
  });

  it('filters by author.id', () => {
    const filtered = filterPostsExcludingAuthors(posts, ['a']);
    expect(filtered.map((p) => p.id)).toEqual(['2', '4']);
  });

  it('filters by authorId field', () => {
    const filtered = filterPostsExcludingAuthors(posts, new Set(['c']));
    expect(filtered.map((p) => p.id)).toEqual(['1', '2', '3']);
  });
});

describe('normalizeReportReason', () => {
  it('maps UI choices spam/abuse/other', () => {
    expect(normalizeReportReason('spam')).toBe('spam');
    expect(normalizeReportReason('Abuse')).toBe('abuse');
    expect(normalizeReportReason(' OTHER ')).toBe('other');
  });

  it('defaults empty to user_reported', () => {
    expect(normalizeReportReason('')).toBe('user_reported');
    expect(normalizeReportReason(null)).toBe('user_reported');
    expect(normalizeReportReason(undefined)).toBe('user_reported');
  });

  it('passes through free-text reasons lowercased', () => {
    expect(normalizeReportReason('Custom Reason')).toBe('custom reason');
  });

  it('exposes three short UI choices', () => {
    expect(REPORT_REASON_CHOICES.map((c) => c.id)).toEqual(['spam', 'abuse', 'other']);
  });
});

describe('mapReportToApiBody', () => {
  it('maps camelCase', () => {
    expect(
      mapReportToApiBody({
        targetType: 'post',
        targetId: 'p1',
        reason: 'spam',
      }),
    ).toEqual({ targetType: 'post', targetId: 'p1', reason: 'spam' });
  });

  it('maps snake_case aliases and defaults', () => {
    expect(
      mapReportToApiBody({
        target_type: 'user',
        target_id: 'u1',
      }),
    ).toEqual({ targetType: 'user', targetId: 'u1', reason: 'user_reported' });
  });

  it('normalizes abuse/other UI reasons', () => {
    expect(
      mapReportToApiBody({
        targetType: 'user',
        targetId: 'u2',
        reason: 'Abuse',
      }),
    ).toEqual({ targetType: 'user', targetId: 'u2', reason: 'abuse' });
    expect(
      mapReportToApiBody({
        targetType: 'post',
        targetId: 'p2',
        reason: 'other',
      }).reason,
    ).toBe('other');
  });

  it('coerces unknown target type to post', () => {
    expect(mapReportToApiBody({ targetType: 'comment', targetId: 'x' }).targetType).toBe(
      'post',
    );
  });
});

describe('addExcludedAuthor', () => {
  it('adds to a new set without mutating input', () => {
    const base = new Set(['a']);
    const next = addExcludedAuthor(base, 'b');
    expect([...next].sort()).toEqual(['a', 'b']);
    expect(base.has('b')).toBe(false);
  });
});
