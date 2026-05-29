import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateProfileForm } from "./CreateProfileForm";

const createProfileMock = vi.fn();

vi.mock("../../api/social", () => ({
  createProfile: (...args: unknown[]) => createProfileMock(...args),
}));

describe("CreateProfileForm", () => {
  beforeEach(() => {
    createProfileMock.mockReset();
  });

  it("creates a profile with a lowercased handle and trimmed values", async () => {
    const getToken = vi.fn().mockResolvedValue("token-123");
    const onProfileCreated = vi.fn();
    createProfileMock.mockResolvedValue({
      ok: true,
      profile: { id: "profile-1" },
    });

    render(<CreateProfileForm getToken={getToken} onProfileCreated={onProfileCreated} />);

    fireEvent.change(screen.getByLabelText("Handle"), {
      target: { value: "Vera_User" },
    });
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "  Vera QA  " },
    });
    fireEvent.change(screen.getByLabelText("Bio"), {
      target: { value: "  production confidence  " },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Create Profile" }).closest("form")!);

    await waitFor(() =>
      expect(createProfileMock).toHaveBeenCalledWith("token-123", {
        handle: "vera_user",
        displayName: "Vera QA",
        bio: "production confidence",
      }),
    );
    expect(onProfileCreated).toHaveBeenCalledTimes(1);
  });

  it("shows an auth error when Clerk cannot provide a token", async () => {
    const user = userEvent.setup();
    const getToken = vi.fn().mockResolvedValue(null);

    render(<CreateProfileForm getToken={getToken} />);

    await user.type(screen.getByLabelText("Handle"), "verauser");
    await user.type(screen.getByLabelText("Display name"), "Vera QA");
    await user.click(screen.getByRole("button", { name: "Create Profile" }));

    expect(await screen.findByText("Not authenticated")).toBeTruthy();
    expect(createProfileMock).not.toHaveBeenCalled();
  });

  it("surfaces API errors from profile creation", async () => {
    const user = userEvent.setup();
    const getToken = vi.fn().mockResolvedValue("token-123");
    createProfileMock.mockRejectedValue(new Error("Handle already taken"));

    render(<CreateProfileForm getToken={getToken} />);

    await user.type(screen.getByLabelText("Handle"), "verauser");
    await user.type(screen.getByLabelText("Display name"), "Vera QA");
    await user.click(screen.getByRole("button", { name: "Create Profile" }));

    expect(await screen.findByText("Handle already taken")).toBeTruthy();
  });
});
