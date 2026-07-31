import { describe, expect, it } from "vitest";
import {
  brandPagePath,
  canAccessGuildFeed,
  communitiesListPath,
  filterDiscoverGuilds,
  guildInviteRedeemPath,
  guildInviteShareUrl,
  isPrivateGuild,
  membershipRoleLabel,
  mergeCommunityLists,
  PRIVATE_GUILD_CREATE_HINT,
  privateGuildJoinCtaCopy,
  privateGuildShareHint,
} from "./guildVisibility";

describe("isPrivateGuild", () => {
  it("treats private as private (case-insensitive)", () => {
    expect(isPrivateGuild("private")).toBe(true);
    expect(isPrivateGuild("Private")).toBe(true);
  });

  it("treats public / missing as not private", () => {
    expect(isPrivateGuild("public")).toBe(false);
    expect(isPrivateGuild(undefined)).toBe(false);
    expect(isPrivateGuild(null)).toBe(false);
  });
});

describe("filterDiscoverGuilds", () => {
  const guilds = [
    { id: "pub", visibility: "public" },
    { id: "priv", visibility: "private" },
    { id: "joined-priv", visibility: "private" },
  ];

  it("hides private guilds unless joined", () => {
    const joined = new Set(["joined-priv"]);
    const result = filterDiscoverGuilds(guilds, joined);
    expect(result.map((g) => g.id)).toEqual(["pub", "joined-priv"]);
  });

  it("shows only public when not a member of any private", () => {
    expect(filterDiscoverGuilds(guilds, new Set()).map((g) => g.id)).toEqual(["pub"]);
  });
});

describe("canAccessGuildFeed", () => {
  it("requires membership for public guild content", () => {
    expect(canAccessGuildFeed("public", false)).toBe(false);
    expect(canAccessGuildFeed("public", true)).toBe(true);
  });

  it("requires membership for private", () => {
    expect(canAccessGuildFeed("private", false)).toBe(false);
    expect(canAccessGuildFeed("private", true)).toBe(true);
  });
});

describe("membershipRoleLabel", () => {
  it("labels owners", () => {
    expect(membershipRoleLabel("owner")).toBe("Owner");
    expect(membershipRoleLabel("OWNER")).toBe("Owner");
  });

  it("labels members", () => {
    expect(membershipRoleLabel("member")).toBe("Member");
    expect(membershipRoleLabel("Member")).toBe("Member");
  });

  it("returns null for empty / unknown roles", () => {
    expect(membershipRoleLabel(undefined)).toBeNull();
    expect(membershipRoleLabel(null)).toBeNull();
    expect(membershipRoleLabel("mod")).toBeNull();
  });
});

describe("private guild honesty copy", () => {
  it("create hint mentions Discover and invite requirement", () => {
    expect(PRIVATE_GUILD_CREATE_HINT.toLowerCase()).toContain("discover");
    expect(PRIVATE_GUILD_CREATE_HINT.toLowerCase()).toContain("invite");
    expect(PRIVATE_GUILD_CREATE_HINT.toLowerCase()).toContain("open join");
    expect(PRIVATE_GUILD_CREATE_HINT.toLowerCase()).not.toContain("discord");
  });

  it("share hint points at Create invite, not fake open join", () => {
    expect(privateGuildShareHint("builders")).toContain("Slug: builders");
    expect(privateGuildShareHint("builders").toLowerCase()).toContain("invite");
    expect(privateGuildShareHint("builders", "gid_1")).toContain("id: gid_1");
  });

  it("join CTA distinguishes member vs non-member and invite gate", () => {
    const member = privateGuildJoinCtaCopy(true);
    const outsider = privateGuildJoinCtaCopy(false);
    expect(member.toLowerCase()).toContain("leave");
    expect(member.toLowerCase()).toContain("invite");
    expect(outsider.toLowerCase()).toContain("invite");
    expect(outsider.toLowerCase()).toContain("open join");
  });
});

describe("invite paths", () => {
  it("builds redeem path with encoding", () => {
    expect(guildInviteRedeemPath("hvinv_abc")).toBe("/invite/hvinv_abc");
    expect(guildInviteRedeemPath("a/b")).toBe("/invite/a%2Fb");
  });

  it("builds share URL with optional origin", () => {
    expect(guildInviteShareUrl("hvinv_x", "https://heyvera.org")).toBe(
      "https://heyvera.org/invite/hvinv_x",
    );
  });
});

describe("mergeCommunityLists", () => {
  it("merges by id and prefers mine fields", () => {
    const discover = [{ id: "a", name: "A", visibility: "public" }];
    const mine = [
      { id: "a", name: "A", visibility: "public", role: "owner" },
      { id: "b", name: "B", visibility: "private", role: "member" },
    ];
    const merged = mergeCommunityLists(discover, mine);
    expect(merged).toHaveLength(2);
    expect(merged.find((c) => c.id === "a")).toMatchObject({ role: "owner" });
    expect(merged.find((c) => c.id === "b")).toMatchObject({ visibility: "private" });
  });
});

describe("brandPagePath", () => {
  it("builds /page/:slug", () => {
    expect(brandPagePath("acme")).toBe("/page/acme");
    expect(brandPagePath("a b")).toBe("/page/a%20b");
  });
});

describe("communitiesListPath", () => {
  it("points at live communities surface", () => {
    expect(communitiesListPath()).toBe("/communities");
  });
});
