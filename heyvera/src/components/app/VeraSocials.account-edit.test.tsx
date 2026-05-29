import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountEditProfile } from "./VeraSocials";
import type { Profile } from "../../api/social";

const updateProfileMock = vi.fn();

vi.mock("../../api/social", async () => {
  const actual = await vi.importActual<typeof import("../../api/social")>("../../api/social");
  return {
    ...actual,
    updateProfile: (...args: unknown[]) => updateProfileMock(...args),
  };
});

const profile: Profile = {
  id: "profile-1",
  accountId: "acct-1",
  displayName: "Worker C",
  handle: "worker-c",
  bio: "Current bio",
  avatarUrl: null,
  bannerUrl: null,
  location: "Remote",
  websiteUrl: "https://heyvera.org",
  proofState: "pending",
  continuityState: "pending",
  createdAt: "2026-05-25T00:00:00.000Z",
  updatedAt: "2026-05-25T00:00:00.000Z",
};

describe("AccountEditProfile", () => {
  beforeEach(() => {
    updateProfileMock.mockReset();
  });

  it("updates the profile and triggers a refetch", async () => {
    const user = userEvent.setup();
    const getToken = vi.fn().mockResolvedValue("token-123");
    const refetchMyProfile = vi.fn();
    updateProfileMock.mockResolvedValue({
      ok: true,
      profile: { ...profile, displayName: "Worker QA" },
    });

    render(
      <AccountEditProfile
        profile={profile}
        getToken={getToken}
        refetchMyProfile={refetchMyProfile}
      />,
    );

    await user.clear(screen.getByLabelText("Display Name"));
    await user.type(screen.getByLabelText("Display Name"), "Worker QA");
    await user.clear(screen.getByLabelText("Location"));
    await user.type(screen.getByLabelText("Location"), "Austin");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() =>
      expect(updateProfileMock).toHaveBeenCalledWith("token-123", {
        displayName: "Worker QA",
        bio: "Current bio",
        location: "Austin",
        websiteUrl: "https://heyvera.org",
      }),
    );
    expect(refetchMyProfile).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Profile updated.")).toBeTruthy();
  });

  it("stops with an auth error when no token is available", async () => {
    const user = userEvent.setup();
    const getToken = vi.fn().mockResolvedValue(null);

    render(
      <AccountEditProfile
        profile={profile}
        getToken={getToken}
        refetchMyProfile={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText("Not authenticated.")).toBeTruthy();
    expect(updateProfileMock).not.toHaveBeenCalled();
  });
});
