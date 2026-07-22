import { describe, expect, it } from 'vitest';
import { inboxAriaLabel } from './inboxAriaLabel';

describe('inboxAriaLabel', () => {
  it('uses route name only when unread is 0', () => {
    expect(inboxAriaLabel('Inbox', 0)).toBe('Inbox');
    expect(inboxAriaLabel('Messages', 0)).toBe('Messages');
  });

  it('never claims unread when count is zero', () => {
    expect(inboxAriaLabel('Inbox', 0).toLowerCase()).not.toContain('unread');
    expect(inboxAriaLabel('Messages', 0).toLowerCase()).not.toContain('unread');
  });

  it('includes unread count when > 0', () => {
    expect(inboxAriaLabel('Inbox', 1)).toBe('Inbox, 1 unread');
    expect(inboxAriaLabel('Messages', 3)).toBe('Messages, 3 unread');
    expect(inboxAriaLabel('Inbox', 99)).toBe('Inbox, 99 unread');
  });

  it('floors and clamps non-positive / non-finite to zero-state', () => {
    expect(inboxAriaLabel('Inbox', -1)).toBe('Inbox');
    expect(inboxAriaLabel('Inbox', Number.NaN)).toBe('Inbox');
    expect(inboxAriaLabel('Messages', 1.9)).toBe('Messages, 1 unread');
  });
});
