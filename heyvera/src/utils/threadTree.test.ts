import { describe, expect, it } from 'vitest';
import type { Post } from '../api/types';
import {
  MAX_VISUAL_DEPTH,
  buildReplyTree,
  flattenTreeForRender,
  parentHandleFor,
} from './threadTree';

function makePost(overrides: Partial<Post> & { id: string }): Post {
  return {
    author: {
      id: 'u1',
      display_name: 'User',
      handle: overrides.author?.handle ?? 'user',
      avatar_url: '',
      verified: false,
    },
    content: overrides.content ?? `body ${overrides.id}`,
    created_at: overrides.created_at ?? '2026-07-01T12:00:00.000Z',
    reply_count: 0,
    repost_count: 0,
    like_count: 0,
    view_count: 0,
    bookmarked: false,
    liked: false,
    reposted: false,
    ...overrides,
  };
}

describe('buildReplyTree', () => {
  it('nests replies under their parents', () => {
    const a = makePost({ id: 'a', reply_to: 'root', created_at: '2026-07-01T12:00:00Z' });
    const b = makePost({ id: 'b', reply_to: 'a', created_at: '2026-07-01T12:01:00Z' });
    const c = makePost({ id: 'c', reply_to: 'root', created_at: '2026-07-01T12:02:00Z' });

    const tree = buildReplyTree([c, b, a], 'root');
    expect(tree.map((n) => n.post.id)).toEqual(['a', 'c']);
    expect(tree[0].children.map((n) => n.post.id)).toEqual(['b']);
    expect(tree[0].children[0].depth).toBe(1);
    expect(tree[1].children).toHaveLength(0);
  });

  it('sorts siblings by created_at then id', () => {
    const late = makePost({ id: 'z', reply_to: 'root', created_at: '2026-07-01T13:00:00Z' });
    const early = makePost({ id: 'a', reply_to: 'root', created_at: '2026-07-01T12:00:00Z' });
    const mid = makePost({ id: 'm', reply_to: 'root', created_at: '2026-07-01T12:30:00Z' });

    const tree = buildReplyTree([late, mid, early], 'root');
    expect(tree.map((n) => n.post.id)).toEqual(['a', 'm', 'z']);
  });

  it('attaches orphans at top level when parent is missing', () => {
    const orphan = makePost({ id: 'o', reply_to: 'missing', created_at: '2026-07-01T12:00:00Z' });
    const tree = buildReplyTree([orphan], 'root');
    expect(tree).toHaveLength(1);
    expect(tree[0].post.id).toBe('o');
    expect(tree[0].depth).toBe(0);
  });

  it('handles deep nesting', () => {
    const posts: Post[] = [];
    let parent = 'root';
    for (let i = 0; i < 6; i++) {
      const id = `d${i}`;
      posts.push(
        makePost({
          id,
          reply_to: parent,
          created_at: `2026-07-01T12:0${i}:00Z`,
        }),
      );
      parent = id;
    }
    const tree = buildReplyTree(posts, 'root');
    let node = tree[0];
    expect(node.depth).toBe(0);
    for (let i = 1; i < 6; i++) {
      expect(node.children).toHaveLength(1);
      node = node.children[0];
      expect(node.depth).toBe(i);
    }
  });
});

describe('flattenTreeForRender', () => {
  it('depth-first flattens and clamps visual depth', () => {
    const a = makePost({ id: 'a', reply_to: 'root' });
    const b = makePost({ id: 'b', reply_to: 'a' });
    const c = makePost({ id: 'c', reply_to: 'b' });
    const d = makePost({ id: 'd', reply_to: 'c' });
    const e = makePost({ id: 'e', reply_to: 'd' });
    const f = makePost({ id: 'f', reply_to: 'e' });

    const tree = buildReplyTree([a, b, c, d, e, f], 'root');
    const flat = flattenTreeForRender(tree, MAX_VISUAL_DEPTH);

    expect(flat.map((r) => r.post.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(flat.map((r) => r.depth)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(flat.map((r) => r.visualDepth)).toEqual([0, 1, 2, 3, 4, 4]);
  });

  it('marks last leaf among siblings', () => {
    const a = makePost({ id: 'a', reply_to: 'root' });
    const b = makePost({ id: 'b', reply_to: 'root', created_at: '2026-07-01T13:00:00Z' });
    const tree = buildReplyTree([a, b], 'root');
    const flat = flattenTreeForRender(tree);
    expect(flat[0].isLastSibling).toBe(false);
    expect(flat[1].isLastSibling).toBe(true);
  });
});

describe('parentHandleFor', () => {
  it('returns root handle for direct replies', () => {
    expect(parentHandleFor('root', 'root', 'alice', new Map())).toBe('alice');
  });

  it('returns parent handle from map for nested replies', () => {
    const parent = makePost({ id: 'p1', author: { id: 'x', display_name: 'Bob', handle: 'bob', avatar_url: '', verified: false } });
    const map = new Map([['p1', parent]]);
    expect(parentHandleFor('p1', 'root', 'alice', map)).toBe('bob');
  });

  it('returns null when parent unknown', () => {
    expect(parentHandleFor('missing', 'root', 'alice', new Map())).toBeNull();
  });
});
