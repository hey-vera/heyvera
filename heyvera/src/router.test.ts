import { describe, expect, it } from 'vitest';
import { router } from './router';

describe('router surface', () => {
  it('keeps the expected top-level route map', () => {
    const rootRoute = router.routes.find(route => route.path === '/');

    expect(rootRoute).toBeDefined();
    expect(rootRoute?.children).toBeDefined();

    const childPaths = new Set(
      (rootRoute?.children ?? []).map(route => (route.index ? '(index)' : route.path ?? ''))
    );

    expect(childPaths).toEqual(
      new Set([
        '(index)',
        'home',
        'explore',
        'notifications',
        'messages',
        'bookmarks',
        'communities',
        'videos',
        'longform',
        'live',
        'premium',
        'profile',
        'profile/:handle',
        'settings',
        'page/:slug',
        'ai',
        'post/:id',
        '*',
      ])
    );
  });
});
