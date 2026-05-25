import { describe, expect, it } from "vitest";

import {
  getFallbackProbeUrl,
  isHealthyFallbackResponse,
} from "./useFallbackDetector";

function makeResponse({
  ok = true,
  contentType,
  jsonImpl = async () => ({ posts: [], next_cursor: null }),
}: {
  ok?: boolean;
  contentType?: string;
  jsonImpl?: () => Promise<unknown>;
}): Pick<Response, "ok" | "headers" | "json"> {
  return {
    ok,
    headers: new Headers(contentType ? { "content-type": contentType } : undefined),
    json: jsonImpl,
  };
}

describe("useFallbackDetector helpers", () => {
  it("builds the probe URL from VITE_API_URL", () => {
    expect(getFallbackProbeUrl({ VITE_API_URL: "/v1" })).toBe("/v1/feed?limit=1");
    expect(getFallbackProbeUrl({ VITE_API_URL: "https://api.heyvera.org/v1/" })).toBe(
      "https://api.heyvera.org/v1/feed?limit=1",
    );
  });

  it("skips probing when VITE_API_URL is not configured", () => {
    expect(getFallbackProbeUrl({})).toBeNull();
    expect(getFallbackProbeUrl({ VITE_API_URL: "  " })).toBeNull();
  });

  it("treats HTML SPA fallback responses as unhealthy even when they return 200", async () => {
    const isHealthy = await isHealthyFallbackResponse(
      makeResponse({
        ok: true,
        contentType: "text/html; charset=utf-8",
        jsonImpl: async () => {
          throw new SyntaxError("Unexpected token < in JSON at position 0");
        },
      }),
    );

    expect(isHealthy).toBe(false);
  });

  it("treats invalid JSON as unhealthy even when the content type claims JSON", async () => {
    const isHealthy = await isHealthyFallbackResponse(
      makeResponse({
        ok: true,
        contentType: "application/json; charset=utf-8",
        jsonImpl: async () => {
          throw new SyntaxError("Unexpected end of JSON input");
        },
      }),
    );

    expect(isHealthy).toBe(false);
  });

  it("accepts successful JSON API responses as healthy", async () => {
    const isHealthy = await isHealthyFallbackResponse(
      makeResponse({
        ok: true,
        contentType: "application/json; charset=utf-8",
      }),
    );

    expect(isHealthy).toBe(true);
  });
});
