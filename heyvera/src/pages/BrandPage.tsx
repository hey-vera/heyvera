import { useEffect, useState } from "react";
import { SignInButton } from "@clerk/clerk-react";
import { ArrowLeft, Building2 } from "lucide-react";
import { useNavigate, useParams } from "react-router";
import {
  fetchBrandPage,
  followPage,
  unfollowPage,
  type SocialPage,
} from "../api/social";
import { EmptyState, ErrorState, LoadingState } from "../components/shared/AsyncStates";
import { useAuth } from "../hooks/useAuth";
import {
  BRAND_FOLLOW_SIGN_IN_HINT,
  BRAND_OWNER_BADGE,
  BRAND_POSTS_EMPTY_DETAIL,
  BRAND_POSTS_EMPTY_TITLE,
  BRAND_POSTS_REGION_TITLE,
} from "../utils/activePageCopy";

/**
 * Public brand Page view — Wave 8d multi-Page polish + Wave 9c empty Posts honesty.
 * Route: /page/:slug → GET /v1/social/pages/{slug}
 */
export function BrandPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { authEnabled, isSignedIn, getToken } = useAuth();

  const [page, setPage] = useState<SocialPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!slug) {
        setError("Missing page slug");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const token = authEnabled && isSignedIn ? await getToken() : null;
        const res = await fetchBrandPage(slug, token);
        if (!cancelled) setPage(res.page);
      } catch (err) {
        if (!cancelled) {
          setPage(null);
          setError(err instanceof Error ? err.message : "Unable to load brand page");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [slug, authEnabled, isSignedIn, getToken, reloadKey]);

  const toggleFollow = async () => {
    if (!page || followBusy || page.isOwner) return;
    if (!authEnabled || !isSignedIn) return;

    const token = await getToken();
    if (!token) {
      setFollowError("Unable to get auth token. Try signing in again.");
      return;
    }

    const currentlyFollowing = Boolean(page.isFollowing);
    setFollowBusy(true);
    setFollowError(null);
    setPage((prev) =>
      prev
        ? {
            ...prev,
            isFollowing: !currentlyFollowing,
            followerCount: Math.max(
              0,
              (prev.followerCount ?? 0) + (currentlyFollowing ? -1 : 1),
            ),
          }
        : prev,
    );
    try {
      if (currentlyFollowing) {
        await unfollowPage(token, page.id);
      } else {
        await followPage(token, page.id);
      }
    } catch (err) {
      setPage((prev) =>
        prev
          ? {
              ...prev,
              isFollowing: currentlyFollowing,
              followerCount: Math.max(
                0,
                (prev.followerCount ?? 0) + (currentlyFollowing ? 1 : -1),
              ),
            }
          : prev,
      );
      setFollowError(err instanceof Error ? err.message : "Follow update failed");
    } finally {
      setFollowBusy(false);
    }
  };

  const handleBack = () => {
    // Prefer browser history for public visitors; fall back to home.
    if (typeof window !== "undefined" && window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate("/home");
  };

  const handle = page?.handle || page?.slug || slug || "";
  const following = Boolean(page?.isFollowing);

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: "var(--bg-primary)", color: "var(--text-primary)" }}
    >
      <div
        className="sticky top-[var(--top-bar-height)] z-10 border-b backdrop-blur-md"
        style={{
          backgroundColor: "color-mix(in srgb, var(--bg-primary) 80%, transparent)",
          borderColor: "var(--border-primary)",
        }}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={handleBack}
            className="-ml-2 flex h-9 w-9 items-center justify-center rounded-full transition-colors hover-overlay"
            aria-label="Back"
          >
            <ArrowLeft size={18} strokeWidth={2.25} />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-[18px] font-bold leading-5">
              {page?.displayName ?? "Brand Page"}
            </h1>
            {handle && (
              <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
                @{handle}
              </p>
            )}
          </div>
        </div>
      </div>

      {loading && <LoadingState label="Loading brand page" />}
      {!loading && error && (
        <ErrorState detail={error} onRetry={() => setReloadKey((k) => k + 1)} />
      )}
      {!loading && !error && !page && (
        <EmptyState title="Page not found" detail="This brand page does not exist." />
      )}
      {!loading && !error && page && (
        <>
          <section className="px-4 py-6">
            <div
              className="flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-start sm:justify-between"
              style={{
                borderColor: "var(--border-primary)",
                backgroundColor: "var(--bg-elevated)",
              }}
            >
              <div className="flex min-w-0 items-start gap-4">
                <div
                  className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl"
                  style={{ backgroundColor: "var(--border-primary)" }}
                >
                  {page.avatarUrl ? (
                    <img
                      src={page.avatarUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Building2 size={28} style={{ color: "var(--text-secondary)" }} />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[22px] font-bold leading-7">{page.displayName}</h2>
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--accent) 18%, transparent)",
                        color: "var(--accent)",
                      }}
                    >
                      Brand
                    </span>
                  </div>
                  <p className="mt-0.5 text-[15px]" style={{ color: "var(--text-secondary)" }}>
                    @{handle}
                  </p>
                  {page.description ? (
                    <p className="mt-3 text-[15px] leading-5">{page.description}</p>
                  ) : (
                    <p
                      className="mt-3 text-[14px] leading-5"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      No description yet.
                    </p>
                  )}
                  {typeof page.followerCount === "number" && (
                    <p className="mt-3 text-[13px]" style={{ color: "var(--text-secondary)" }}>
                      <span className="font-bold" style={{ color: "var(--text-primary)" }}>
                        {page.followerCount}
                      </span>{" "}
                      {page.followerCount === 1 ? "follower" : "followers"}
                    </p>
                  )}
                  <p className="mt-2 text-[12px]" style={{ color: "var(--text-secondary)" }}>
                    Brand Pages are early access — public profile + follow. Brand-as-author posts
                    are not complete yet.
                  </p>
                </div>
              </div>

              <div className="shrink-0">
                {page.isOwner ? (
                  <span
                    className="inline-block rounded-full border px-5 py-1.5 text-[14px] font-bold"
                    style={{
                      borderColor: "var(--border-primary)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {BRAND_OWNER_BADGE}
                  </span>
                ) : authEnabled && !isSignedIn ? (
                  <div className="flex flex-col items-start gap-1.5 sm:items-end">
                    <SignInButton mode="modal">
                      <button
                        type="button"
                        className="rounded-full px-5 py-1.5 text-[14px] font-bold transition-all hover:opacity-90"
                        style={{
                          backgroundColor: "var(--accent)",
                          color: "var(--bg-primary)",
                        }}
                      >
                        Follow
                      </button>
                    </SignInButton>
                    <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
                      {BRAND_FOLLOW_SIGN_IN_HINT}
                    </p>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={followBusy || !authEnabled}
                    title={!authEnabled ? "Sign-in is not configured" : undefined}
                    onClick={() => void toggleFollow()}
                    className="rounded-full px-5 py-1.5 text-[14px] font-bold transition-all hover:opacity-90 disabled:opacity-50"
                    style={{
                      border: following ? "1px solid var(--border-primary)" : undefined,
                      backgroundColor: following ? "transparent" : "var(--accent)",
                      color: following ? "var(--text-primary)" : "var(--bg-primary)",
                    }}
                  >
                    {followBusy ? "…" : following ? "Following" : "Follow"}
                  </button>
                )}
              </div>
            </div>

            {followError && (
              <p className="mt-3 text-[13px]" style={{ color: "var(--danger, #f4212e)" }} role="alert">
                {followError}
              </p>
            )}
          </section>

          {/* Posts region — honest empty; no fake feed API / placeholder cards */}
          <section
            className="border-t px-4 py-6"
            style={{ borderColor: "var(--border-primary)" }}
            aria-labelledby="brand-posts-heading"
          >
            <h3
              id="brand-posts-heading"
              className="mb-3 text-[17px] font-bold leading-5"
            >
              {BRAND_POSTS_REGION_TITLE}
            </h3>
            <div
              className="rounded-2xl border px-4 py-8 text-center"
              style={{
                borderColor: "var(--border-primary)",
                backgroundColor: "var(--bg-elevated)",
              }}
            >
              <p className="text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
                {BRAND_POSTS_EMPTY_TITLE}
              </p>
              <p
                className="mx-auto mt-2 max-w-md text-[13px] leading-5"
                style={{ color: "var(--text-secondary)" }}
              >
                {BRAND_POSTS_EMPTY_DETAIL}
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default BrandPage;
