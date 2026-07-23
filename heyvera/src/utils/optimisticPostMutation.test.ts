import { describe, expect, it, vi } from 'vitest';
import {
  applyBookmarkState,
  applyLikeState,
  applyRepostState,
  mapBookmarkInPosts,
  mapLikeInPosts,
  mapRepostInPosts,
  mutationErrorMessage,
  withOptimisticPostMutation,
} from './optimisticPostMutation';

describe('withOptimisticPostMutation', () => {
  it('applies then returns mutate result on success (no revert)', async () => {
    const apply = vi.fn();
    const revert = vi.fn();
    const onError = vi.fn();
    const mutate = vi.fn().mockResolvedValue('ok');

    await expect(
      withOptimisticPostMutation({ apply, mutate, revert, onError }),
    ).resolves.toBe('ok');

    expect(apply).toHaveBeenCalledOnce();
    expect(mutate).toHaveBeenCalledOnce();
    expect(revert).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('reverts, calls onError, and rethrows on failure', async () => {
    const apply = vi.fn();
    const revert = vi.fn();
    const onError = vi.fn();
    const err = new Error('network down');
    const mutate = vi.fn().mockRejectedValue(err);

    await expect(
      withOptimisticPostMutation({ apply, mutate, revert, onError }),
    ).rejects.toThrow('network down');

    expect(apply).toHaveBeenCalledOnce();
    expect(mutate).toHaveBeenCalledOnce();
    expect(revert).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(err);
    // apply before mutate; revert after failure
    expect(apply.mock.invocationCallOrder[0]).toBeLessThan(
      mutate.mock.invocationCallOrder[0]!,
    );
    expect(mutate.mock.invocationCallOrder[0]).toBeLessThan(
      revert.mock.invocationCallOrder[0]!,
    );
  });

  it('reverts even when onError is omitted', async () => {
    const apply = vi.fn();
    const revert = vi.fn();
    const mutate = vi.fn().mockRejectedValue(new Error('fail'));

    await expect(withOptimisticPostMutation({ apply, mutate, revert })).rejects.toThrow(
      'fail',
    );
    expect(revert).toHaveBeenCalledOnce();
  });
});

describe('mutationErrorMessage', () => {
  it('prefers Error.message', () => {
    expect(mutationErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
  });

  it('accepts plain strings', () => {
    expect(mutationErrorMessage('  nope  ', 'fallback')).toBe('  nope  ');
  });

  it('falls back when empty/unknown', () => {
    expect(mutationErrorMessage(new Error('  '), 'fallback')).toBe('fallback');
    expect(mutationErrorMessage(null, 'fallback')).toBe('fallback');
    expect(mutationErrorMessage(42, 'fallback')).toBe('fallback');
  });
});

describe('engagement state patches', () => {
  const base = {
    id: 'p1',
    liked: false,
    like_count: 2,
    reposted: false,
    repost_count: 1,
    bookmarked: false,
  };

  it('applyLikeState increments and decrements without going negative', () => {
    expect(applyLikeState(base, true)).toEqual({
      ...base,
      liked: true,
      like_count: 3,
    });
    expect(applyLikeState({ ...base, liked: true, like_count: 0 }, false)).toEqual({
      ...base,
      liked: false,
      like_count: 0,
    });
    const already = { ...base, liked: true, like_count: 5 };
    expect(applyLikeState(already, true)).toBe(already);
  });

  it('applyRepostState patches counts', () => {
    expect(applyRepostState(base, true).repost_count).toBe(2);
    expect(applyRepostState({ ...base, reposted: true, repost_count: 3 }, false)).toEqual({
      ...base,
      reposted: false,
      repost_count: 2,
    });
  });

  it('applyBookmarkState toggles flag only', () => {
    expect(applyBookmarkState(base, true).bookmarked).toBe(true);
    const already = { ...base, bookmarked: true };
    expect(applyBookmarkState(already, true)).toBe(already);
  });

  it('map*InPosts only touch the matching id', () => {
    const posts = [
      { ...base, id: 'a' },
      { ...base, id: 'b', liked: true, like_count: 4 },
    ];
    expect(mapLikeInPosts(posts, 'a', true).map((p) => p.liked)).toEqual([true, true]);
    expect(mapRepostInPosts(posts, 'b', true)[1]!.reposted).toBe(true);
    expect(mapBookmarkInPosts(posts, 'missing', true)).toEqual(posts);
  });
});
