import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  fetchProfile: vi.fn(),
  fetchProfileFeed: vi.fn(),
  fetchProfileStats: vi.fn(),
  fetchFollowStatus: vi.fn(),
  fetchMyProfile: vi.fn(),
  followProfile: vi.fn(),
  unfollowProfile: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  getToken: vi.fn(),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    authEnabled: true,
    isSignedIn: true,
    getToken: authMocks.getToken,
    userId: 'clerk-viewer',
    viewerLabel: 'Viewer',
  }),
}));

vi.mock('../api/social', async () => {
  const actual = await vi.importActual<typeof import('../api/social')>('../api/social');
  return { ...actual, ...apiMocks };
});

import { ProfilePage } from './ProfilePage';

const targetProfile = {
  id: 'profile-target',
  displayName: 'Protected Person',
  handle: 'protected',
  bio: '',
  avatarUrl: null,
  bannerUrl: null,
  location: null,
  websiteUrl: null,
  proofState: 'unverified',
  continuityState: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('ProfilePage protected follow state', () => {
  beforeEach(() => {
    for (const mock of Object.values(apiMocks)) mock.mockReset();
    authMocks.getToken.mockReset();

    authMocks.getToken.mockResolvedValue('viewer-token');
    apiMocks.fetchProfile.mockResolvedValue({ profile: targetProfile });
    apiMocks.fetchProfileFeed.mockResolvedValue({
      profile: targetProfile,
      feed: [],
      pageInfo: { limit: 20, nextCursor: null },
    });
    apiMocks.fetchProfileStats.mockResolvedValue({
      stats: {
        postCount: 0,
        followerCount: 0,
        followingCount: 0,
        linkedAgentCount: 0,
        communityCount: 0,
        longformCount: 0,
      },
    });
    apiMocks.fetchFollowStatus.mockResolvedValue({ following: false, pending: false });
    apiMocks.fetchMyProfile.mockResolvedValue({ profile: { ...targetProfile, id: 'viewer' } });
    apiMocks.followProfile.mockResolvedValue({
      ok: true,
      requestId: 'follow-request-1',
      state: 'pending',
    });
    apiMocks.unfollowProfile.mockResolvedValue({ ok: true, state: 'not_following' });
  });

  it('shows Requested for a pending follow and lets the viewer cancel it', async () => {
    render(
      <MemoryRouter initialEntries={['/profile/protected']}>
        <Routes>
          <Route path="/profile/:handle" element={<ProfilePage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Follow' }));

    expect(
      (await screen.findByRole('button', { name: 'Requested' })).getAttribute(
        'aria-pressed',
      ),
    ).toBe('false');
    expect(apiMocks.followProfile).toHaveBeenCalledWith('viewer-token', 'protected');

    fireEvent.click(screen.getByRole('button', { name: 'Requested' }));

    await waitFor(() => {
      expect(apiMocks.unfollowProfile).toHaveBeenCalledWith('viewer-token', 'protected');
      expect(screen.getByRole('button', { name: 'Follow' })).toBeTruthy();
    });
  });
});
