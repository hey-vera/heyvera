import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  fetchHomeFeed: vi.fn(),
  fetchProfiles: vi.fn(),
  fetchCommunities: vi.fn(),
  fetchTrending: vi.fn(),
  followProfile: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  getToken: vi.fn(),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    authEnabled: true,
    isSignedIn: true,
    getToken: authMocks.getToken,
  }),
}));

vi.mock('../api/social', async () => {
  const actual = await vi.importActual<typeof import('../api/social')>('../api/social');
  return { ...actual, ...apiMocks };
});

vi.mock('../components/shared/TabbedCompose', () => ({
  TabbedCompose: () => null,
}));

vi.mock('../components/shared/PostCard', () => ({
  PostCard: () => null,
}));

vi.mock('../components/layout/AppShell', () => ({
  HEYVERA_POST_CREATED_EVENT: 'heyvera:test-post-created',
}));

import { HomePage } from './HomePage';

describe('HomePage protected-profile suggestion', () => {
  beforeEach(() => {
    for (const mock of Object.values(apiMocks)) mock.mockReset();
    authMocks.getToken.mockReset();
    localStorage.setItem('heyvera-onboard-v1', '1');

    authMocks.getToken.mockResolvedValue('viewer-token');
    apiMocks.fetchHomeFeed.mockResolvedValue({
      feed: [],
      pageInfo: { limit: 20, nextCursor: null },
    });
    apiMocks.fetchProfiles.mockResolvedValue({
      profiles: [
        {
          id: 'profile-protected',
          handle: 'protected',
          displayName: 'Protected Person',
          bio: '',
        },
      ],
    });
    apiMocks.fetchCommunities.mockResolvedValue({ communities: [] });
    apiMocks.fetchTrending.mockResolvedValue({ topics: [] });
    apiMocks.followProfile.mockResolvedValue({
      ok: true,
      requestId: 'follow-request-1',
      state: 'pending',
    });

    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
  });

  it('labels a protected-profile request as Requested, not Following', async () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Following' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Follow' }));

    expect(
      (await screen.findByRole('button', { name: 'Requested' })).hasAttribute(
        'disabled',
      ),
    ).toBe(true);
    expect(screen.queryByRole('button', { name: 'Following' })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain(
      'Follow request sent to @protected',
    );
    expect(apiMocks.followProfile).toHaveBeenCalledWith('viewer-token', 'protected');
  });
});
