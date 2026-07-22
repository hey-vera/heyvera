import { describe, expect, it } from "vitest";
import {
  brandPagePath,
  canAccessGuildFeed,
  filterDiscoverGuilds,
  isPrivateGuild,
  membershipRoleLabel,
  mergeCommunityLists,
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
  it("allows public always", () => {
    expect(canAccessGuildFeed("public", false)).toBe(true);
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

  it("returns null for member / empty", () => {
    expect(membershipRoleLabel("member")).toBeNull();
    expect(membershipRoleLabel(undefined)).toBeNull();
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
