import { describe, expect, it } from "vitest";
import {
  emptyFollowingDetail,
  emptyFollowingTitle,
  mapCommunitiesToSuggestions,
  mapProfilesToSuggestions,
  mapTrendingToSuggestions,
  mergeNetworkSuggestions,
  topicExplorePath,
} from "./emptyNetworkOnboard";

describe("mapProfilesToSuggestions", () => {
  it("maps and caps profiles with handle+id", () => {
    const profiles = [
      { id: "1", handle: "alice", displayName: "Alice", bio: "hi" },
      { id: "2", handle: "bob", displayName: "Bob" },
      { id: "3" }, // missing handle
      { handle: "no-id" }, // missing id
    ];
    const mapped = mapProfilesToSuggestions(profiles as never, 10);
    expect(mapped).toHaveLength(2);
    expect(mapped[0]).toMatchObject({ kind: "profile", handle: "alice", displayName: "Alice" });
  });

  it("respects limit", () => {
    const profiles = Array.from({ length: 10 }, (_, i) => ({
      id: `p${i}`,
      handle: `u${i}`,
      displayName: `U${i}`,
    }));
    expect(mapProfilesToSuggestions(profiles, 3)).toHaveLength(3);
  });
});

describe("mapCommunitiesToSuggestions", () => {
  it("skips private guilds (invite-only)", () => {
    const communities = [
      { id: "c1", slug: "pub", name: "Public", visibility: "public" },
      { id: "c2", slug: "priv", name: "Private", visibility: "private" },
    ];
    const mapped = mapCommunitiesToSuggestions(communities, 10);
    expect(mapped.map((c) => c.id)).toEqual(["c1"]);
    expect(mapped[0].kind).toBe("community");
  });
});

describe("mapTrendingToSuggestions", () => {
  it("strips # and builds topic ids", () => {
    const mapped = mapTrendingToSuggestions(
      [{ tag: "#builders", postCount: 12 }, { tag: "  ", postCount: 1 }],
      5,
    );
    expect(mapped).toEqual([
      { kind: "topic", id: "topic:builders", tag: "builders", postCount: 12 },
    ]);
  });
});

describe("mergeNetworkSuggestions", () => {
  it("prioritizes profiles then communities then topics and dedupes", () => {
    const profiles = mapProfilesToSuggestions([
      { id: "p1", handle: "a", displayName: "A" },
    ]);
    const communities = mapCommunitiesToSuggestions([
      { id: "c1", slug: "c", name: "C", visibility: "public" },
    ]);
    const topics = mapTrendingToSuggestions([{ tag: "x", postCount: 1 }]);
    const merged = mergeNetworkSuggestions(profiles, communities, topics, 10);
    expect(merged.map((s) => s.kind)).toEqual(["profile", "community", "topic"]);
  });

  it("caps total", () => {
    const profiles = mapProfilesToSuggestions(
      Array.from({ length: 5 }, (_, i) => ({
        id: `p${i}`,
        handle: `u${i}`,
        displayName: `U${i}`,
      })),
    );
    const communities = mapCommunitiesToSuggestions(
      Array.from({ length: 5 }, (_, i) => ({
        id: `c${i}`,
        slug: `c${i}`,
        name: `C${i}`,
        visibility: "public",
      })),
    );
    expect(mergeNetworkSuggestions(profiles, communities, [], 4)).toHaveLength(4);
  });
});

describe("empty following copy", () => {
  it("is honest about real APIs", () => {
    expect(emptyFollowingTitle().toLowerCase()).toContain("empty");
    expect(emptyFollowingDetail().toLowerCase()).toContain("live");
    expect(emptyFollowingDetail().toLowerCase()).not.toContain("discord");
  });
});

describe("topicExplorePath", () => {
  it("builds explore posts search with hashtag query", () => {
    expect(topicExplorePath("#rust")).toBe(
      `/explore?q=${encodeURIComponent("#rust")}&filter=posts`,
    );
    expect(topicExplorePath("heyvera")).toBe(
      `/explore?q=${encodeURIComponent("#heyvera")}&filter=posts`,
    );
  });
});
