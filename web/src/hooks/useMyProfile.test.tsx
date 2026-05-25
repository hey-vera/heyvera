import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMyProfile } from "./useMyProfile";

const fetchMyProfileMock = vi.fn();

vi.mock("../api/social", () => ({
  fetchMyProfile: (...args: unknown[]) => fetchMyProfileMock(...args),
}));

describe("useMyProfile", () => {
  beforeEach(() => {
    fetchMyProfileMock.mockReset();
  });

  it("stays empty and skips profile fetch when no token is available", async () => {
    const getToken = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useMyProfile(getToken));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getToken).toHaveBeenCalledTimes(1);
    expect(fetchMyProfileMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
    expect(result.current.notFound).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("marks the profile as missing on a 404-style error", async () => {
    const getToken = vi.fn().mockResolvedValue("token-123");
    fetchMyProfileMock.mockRejectedValue(new Error("No profile found"));

    const { result } = renderHook(() => useMyProfile(getToken));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMyProfileMock).toHaveBeenCalledWith("token-123");
    expect(result.current.data).toBeNull();
    expect(result.current.notFound).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("returns the profile payload on success and supports refetch", async () => {
    const profilePayload = {
      profile: {
        id: "profile-1",
        accountId: "acct-1",
        displayName: "Worker C",
        handle: "worker-c",
        bio: "QA profile",
        avatarUrl: null,
        bannerUrl: null,
        location: null,
        websiteUrl: null,
        proofState: "pending",
        continuityState: "pending",
        createdAt: "2026-05-25T00:00:00.000Z",
        updatedAt: "2026-05-25T00:00:00.000Z",
      },
      linkedAgents: [],
    };
    const getToken = vi.fn().mockResolvedValue("token-123");
    fetchMyProfileMock.mockResolvedValue(profilePayload);

    const { result } = renderHook(() => useMyProfile(getToken));

    await waitFor(() => expect(result.current.data).toEqual(profilePayload));

    await act(async () => {
      result.current.refetch();
    });

    await waitFor(() => expect(fetchMyProfileMock).toHaveBeenCalledTimes(2));
    expect(result.current.notFound).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
