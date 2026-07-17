import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComposePost } from "./ComposePost";
import type { LinkedAgent } from "../../api/social";

const createPostMock = vi.fn();

vi.mock("../../api/social", async () => {
  const actual = await vi.importActual<typeof import("../../api/social")>("../../api/social");
  return {
    ...actual,
    createPost: (...args: unknown[]) => createPostMock(...args),
  };
});

const linkedAgent: LinkedAgent = {
  id: "agent-1",
  profileId: "profile-1",
  accountId: "acct-1",
  agentName: "Worker Agent",
  agentSlug: "worker-agent",
  agentKeyPrefix: "hvak_abc123…",
  agentType: "assistant",
  linkState: "verified",
  visibility: "public",
  proofState: "verified",
  isPrimary: true,
  createdAt: "2026-05-25T00:00:00.000Z",
  updatedAt: "2026-05-25T00:00:00.000Z",
};

describe("ComposePost", () => {
  beforeEach(() => {
    createPostMock.mockReset();
  });

  it("creates a person-authored post and clears the composer", async () => {
    const user = userEvent.setup();
    const getToken = vi.fn().mockResolvedValue("token-123");
    const onPostCreated = vi.fn();
    createPostMock.mockResolvedValue({
      ok: true,
      post: { id: "post-1", body: "Hello Vera" },
    });

    render(<ComposePost getToken={getToken} linkedAgents={[]} onPostCreated={onPostCreated} />);

    const textarea = screen.getByLabelText("Write a post");
    await user.type(textarea, "  Hello Vera  ");
    await user.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() =>
      expect(createPostMock).toHaveBeenCalledWith("token-123", {
        body: "Hello Vera",
        authorMode: "person",
        linkedAgentId: undefined,
      }),
    );
    expect(onPostCreated).toHaveBeenCalledWith({ id: "post-1", body: "Hello Vera" });
    expect((textarea as HTMLTextAreaElement).value).toBe("");
  });

  it("includes the linked agent when posting as an agent", async () => {
    const user = userEvent.setup();
    const getToken = vi.fn().mockResolvedValue("token-123");
    createPostMock.mockResolvedValue({
      ok: true,
      post: { id: "post-2", body: "Agent update" },
    });

    render(<ComposePost getToken={getToken} linkedAgents={[linkedAgent]} />);

    await user.type(screen.getByLabelText("Write a post"), "Agent update");
    await user.selectOptions(screen.getByLabelText("Choose posting identity"), "agent");
    await user.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() =>
      expect(createPostMock).toHaveBeenCalledWith("token-123", {
        body: "Agent update",
        authorMode: "agent",
        linkedAgentId: "agent-1",
      }),
    );
  });

  it("shows an auth error without a Clerk token", async () => {
    const user = userEvent.setup();
    const getToken = vi.fn().mockResolvedValue(null);

    render(<ComposePost getToken={getToken} linkedAgents={[]} />);

    await user.type(screen.getByLabelText("Write a post"), "Needs auth");
    await user.click(screen.getByRole("button", { name: "Post" }));

    expect(await screen.findByText("Not authenticated")).toBeTruthy();
    expect(createPostMock).not.toHaveBeenCalled();
  });
});
