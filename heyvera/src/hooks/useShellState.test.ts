import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useShellState } from "./useShellState";

describe("useShellState", () => {
  it("returns public when Clerk auth is unavailable", () => {
    const { result } = renderHook(() =>
      useShellState({
        authEnabled: false,
        isSignedIn: false,
        myProfileLoading: false,
        myProfileNotFound: false,
        hasProfile: false,
      }),
    );

    expect(result.current).toBe("public");
  });

  it("returns signed_out when Clerk is enabled without a session", () => {
    const { result } = renderHook(() =>
      useShellState({
        authEnabled: true,
        isSignedIn: false,
        myProfileLoading: false,
        myProfileNotFound: false,
        hasProfile: false,
      }),
    );

    expect(result.current).toBe("signed_out");
  });

  it("returns loading while the signed-in profile lookup is pending", () => {
    const { result } = renderHook(() =>
      useShellState({
        authEnabled: true,
        isSignedIn: true,
        myProfileLoading: true,
        myProfileNotFound: false,
        hasProfile: false,
      }),
    );

    expect(result.current).toBe("loading");
  });

  it("returns profile_missing when the signed-in viewer has no profile yet", () => {
    const { result } = renderHook(() =>
      useShellState({
        authEnabled: true,
        isSignedIn: true,
        myProfileLoading: false,
        myProfileNotFound: true,
        hasProfile: false,
      }),
    );

    expect(result.current).toBe("profile_missing");
  });

  it("returns ready when Clerk session and HeyVera profile are both present", () => {
    const { result } = renderHook(() =>
      useShellState({
        authEnabled: true,
        isSignedIn: true,
        myProfileLoading: false,
        myProfileNotFound: false,
        hasProfile: true,
      }),
    );

    expect(result.current).toBe("ready");
  });
});
