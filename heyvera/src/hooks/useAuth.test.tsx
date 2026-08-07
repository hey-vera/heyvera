import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const clerkMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useUser: vi.fn(),
}));

vi.mock('@clerk/clerk-react', () => ({
  useAuth: clerkMocks.useAuth,
  useUser: clerkMocks.useUser,
}));

import { useAuth } from './useAuth';

describe('useAuth without ClerkProvider', () => {
  beforeEach(() => {
    clerkMocks.useAuth.mockReset();
    clerkMocks.useUser.mockReset();
    clerkMocks.useAuth.mockImplementation(() => {
      throw new Error('ClerkProvider is unavailable');
    });
  });

  it('returns one stable no-token function across rerenders', async () => {
    const { result, rerender } = renderHook(() => useAuth());
    const firstGetToken = result.current.getToken;

    expect(result.current).toMatchObject({
      authEnabled: false,
      isSignedIn: false,
      userId: null,
      viewerLabel: null,
    });
    await expect(firstGetToken()).resolves.toBeNull();

    rerender();

    expect(result.current.getToken).toBe(firstGetToken);
    await expect(result.current.getToken()).resolves.toBeNull();
    expect(clerkMocks.useUser).not.toHaveBeenCalled();
  });
});
