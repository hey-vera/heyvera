import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startVisibilityPoll } from './visibilityPoll';

describe('startVisibilityPoll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible' as DocumentVisibilityState,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('invokes callback on interval while visible', () => {
    const cb = vi.fn();
    const stop = startVisibilityPoll(cb, { intervalMs: 1000 });

    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(cb).toHaveBeenCalledTimes(3);

    stop();
  });

  it('runs immediately when runOnStart is true', () => {
    const cb = vi.fn();
    const stop = startVisibilityPoll(cb, { intervalMs: 5000, runOnStart: true });
    expect(cb).toHaveBeenCalledTimes(1);
    stop();
  });

  it('pauses while hidden and resumes with runOnVisible', () => {
    const cb = vi.fn();
    let state: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => state,
    });

    const stop = startVisibilityPoll(cb, { intervalMs: 1000, runOnVisible: true });

    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(1);

    state = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(5000);
    expect(cb).toHaveBeenCalledTimes(1);

    state = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(cb).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(3);

    stop();
  });

  it('dispose clears interval and does not fire further', () => {
    const cb = vi.fn();
    const stop = startVisibilityPoll(cb, { intervalMs: 1000 });
    stop();
    vi.advanceTimersByTime(5000);
    expect(cb).not.toHaveBeenCalled();
  });
});
