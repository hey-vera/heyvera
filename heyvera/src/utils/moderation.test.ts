import { describe, expect, it } from 'vitest';
import {
  addExcludedAuthor,
  filterPostsExcludingAuthors,
  mapReportToApiBody,
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
