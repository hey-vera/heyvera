import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { SignInButton } from '@clerk/clerk-react';
import {
  bookmarkPost,
  createPost,
  feedPostToPost,
  fetchCommunities,
  fetchHomeFeed,
  fetchMyProfile,
  fetchProfiles,
  fetchTrending,
  followProfile,
  joinCommunity,
  likePost,
  repostPost,
  unbookmarkPost,
  unlikePost,
  unrepostPost,
  uploadMediaFile,
} from '../api/social';
import type { Post } from '../api/types';
import { LoadingState, EmptyState, ErrorState } from '../components/shared/AsyncStates';
import { PostCard } from '../components/shared/PostCard';
import { TabbedCompose } from '../components/shared/TabbedCompose';
import { HEYVERA_POST_CREATED_EVENT } from '../components/layout/AppShell';
import { useAuth } from '../hooks/useAuth';
import type { FeedPost } from '../api/social';
import { earlyAccessBannerCopy } from '../utils/earlyAccessBanner';
import {
  emptyFollowingDetail,
  emptyFollowingTitle,
  mapCommunitiesToSuggestions,
  mapProfilesToSuggestions,
  mapTrendingToSuggestions,
  mergeNetworkSuggestions,
  topicExplorePath,
  type NetworkSuggestion,
} from '../utils/emptyNetworkOnboard';
import { isVideoFile, validateComposeMediaFile } from '../utils/imageUpload';
import { addExcludedAuthor, filterPostsExcludingAuthors } from '../utils/moderation';

const TABS = ['For you', 'Following', 'Humans', 'Agents'] as const;
type Tab = typeof TABS[number];

const PULL_REFRESH_THRESHOLD = 72;
const FEED_PAGE_SIZE = 20;
const ONBOARD_STORAGE_KEY = 'heyvera-onboard-v1';

/** Parsed feed result in the shape HomePage state expects. */
type FeedResult = {
  posts: Post[];
  nextCursor: string | null;
};

/** Map raw fetch/API failures to a clear user-facing message. */
function formatRequestError(err: unknown, fallback: string): string {
  if (!(err instanceof Error) || !err.message) return fallback;
  const msg = err.message;
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(msg)) {
    return 'Unable to reach the server. Check your connection and try again.';
  }
  return msg;
}

export function HomePage() {
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('For you');
  const [posts, setPosts] = useState<Post[]>([]);
  const [hiddenAuthorIds, setHiddenAuthorIds] = useState<Set<string>>(() => new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  /** Full-page feed failure (initial load / hard reload). */
  const [error, setError] = useState<string | null>(null);
  /** Soft failure while posts remain visible (load-more / refresh). */
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [posting, setPosting] = useState(false);
  const [composeNotice, setComposeNotice] = useState<string | null>(null);
  /** Local media attachment for inline Home compose: one image OR progressive video. */
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const mediaIsVideo = Boolean(imageFile && isVideoFile(imageFile));
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [pendingFeed, setPendingFeed] = useState<FeedResult | null>(null);
  const [newPostCount, setNewPostCount] = useState(0);
  const [showOnboard, setShowOnboard] = useState(() => {
    try {
      return localStorage.getItem(ONBOARD_STORAGE_KEY) !== '1';
    } catch {
      return true;
    }
  });
  /** Batch D soft-launch copy — pure helper, stable strings. */
  const earlyAccess = earlyAccessBannerCopy();
  /** Following empty: real suggestions from profiles/communities/trending. */
  const [networkSuggestions, setNetworkSuggestions] = useState<NetworkSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [followedHandles, setFollowedHandles] = useState<Set<string>>(new Set());
  const [requestedHandles, setRequestedHandles] = useState<Set<string>>(new Set());
  const [joinedCommunityIds, setJoinedCommunityIds] = useState<Set<string>>(new Set());
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const touchStartY = useRef<number | null>(null);

  const dismissOnboard = useCallback(() => {
    setShowOnboard(false);
    try {
      localStorage.setItem(ONBOARD_STORAGE_KEY, '1');
    } catch {
      /* ignore quota / private mode */
    }
  }, []);

  const retryFeed = useCallback(() => {
    setBannerError(null);
    setError(null);
    setReloadKey((key) => key + 1);
  }, []);

  const loadFeedPage = useCallback(async (pageCursor: string | null = null): Promise<FeedResult> => {
    // Backend home feed: filter=person | agent (author_mode); following uses /feed/following
    const filter =
      activeTab === 'Following'
        ? 'following'
        : activeTab === 'Humans'
          ? 'person'
          : activeTab === 'Agents'
            ? 'agent'
            : undefined;
    // Pass token whenever signed in so BE can enrich liked/reposted/bookmarked (following requires it).
    const token = authEnabled && isSignedIn ? await getToken() : null;
    const response = await fetchHomeFeed(FEED_PAGE_SIZE, pageCursor, filter, token);
    return {
      posts: response.feed.map(feedPostToPost),
      // Opaque keyset cursor — never Number().
      nextCursor: response.pageInfo.nextCursor ?? null,
    };
  }, [activeTab, authEnabled, getToken, isSignedIn]);

  useEffect(() => {
    let cancelled = false;

    async function loadFeed() {
      setLoading(true);
      setError(null);
      setBannerError(null);
      setPendingFeed(null);
      setNewPostCount(0);
      try {
        const response = await loadFeedPage();
        if (!cancelled) {
          setPosts(response.posts);
          setCursor(response.nextCursor);
          setHasMore(response.nextCursor !== null);
        }
      } catch (err) {
        if (!cancelled) {
          // Hard failure: clear feed so empty state is not confused with API down.
          setPosts([]);
          setCursor(null);
          setHasMore(false);
          setError(formatRequestError(err, 'Unable to load feed'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadFeed();
    return () => {
      cancelled = true;
    };
  }, [loadFeedPage, reloadKey]);

  // Shell Create posts should appear instantly on Home without a hard refresh.
  useEffect(() => {
    const onShellPostCreated = (event: Event) => {
      const custom = event as CustomEvent<{ post?: FeedPost }>;
      const created = custom.detail?.post;
      if (!created) return;
      const mapped = feedPostToPost(created);
      setPosts((current) => {
        if (current.some((post) => post.id === mapped.id)) return current;
        return [mapped, ...current];
      });
    };

    window.addEventListener(HEYVERA_POST_CREATED_EVENT, onShellPostCreated);
    return () => window.removeEventListener(HEYVERA_POST_CREATED_EVENT, onShellPostCreated);
  }, []);

  // Empty Following: load real network suggestions (no invented users).
  useEffect(() => {
    let cancelled = false;
    const followingEmpty =
      activeTab === 'Following' && !loading && !error && posts.length === 0;
    if (!followingEmpty) {
      setNetworkSuggestions([]);
      setSuggestionsError(null);
      setSuggestionsLoading(false);
      return undefined;
    }

    async function loadSuggestions() {
      setSuggestionsLoading(true);
      setSuggestionsError(null);
      try {
        const token = authEnabled && isSignedIn ? await getToken() : null;
        const [profilesRes, communitiesRes, trendingRes] = await Promise.all([
          fetchProfiles(12, token).catch(() => ({ profiles: [] as never[] })),
          fetchCommunities(12).catch(() => ({ communities: [] as never[] })),
          fetchTrending().catch(() => ({ topics: [] as never[] })),
        ]);
        if (cancelled) return;
        const merged = mergeNetworkSuggestions(
          mapProfilesToSuggestions(profilesRes.profiles ?? [], 6),
          mapCommunitiesToSuggestions(communitiesRes.communities ?? [], 4),
          mapTrendingToSuggestions(trendingRes.topics ?? [], 4),
          12,
        );
        setNetworkSuggestions(merged);
      } catch (err) {
        if (!cancelled) {
          setNetworkSuggestions([]);
          setSuggestionsError(
            err instanceof Error ? err.message : 'Unable to load suggestions',
          );
        }
      } finally {
        if (!cancelled) setSuggestionsLoading(false);
      }
    }

    void loadSuggestions();
    return () => {
      cancelled = true;
    };
  }, [activeTab, loading, error, posts.length, authEnabled, isSignedIn, getToken]);

  const handleFollowSuggestion = async (handle: string) => {
    if (actionBusyId || followedHandles.has(handle) || requestedHandles.has(handle)) return;
    setActionNotice(null);
    if (!authEnabled || !isSignedIn) {
      setActionNotice(authEnabled ? 'Sign in to follow.' : 'Sign-in is not configured.');
      return;
    }
    const token = await getToken();
    if (!token) {
      setActionNotice('Sign in again to follow.');
      return;
    }
    setActionBusyId(`profile:${handle}`);
    try {
      const result = await followProfile(token, handle);
      if (result.state === 'pending') {
        setRequestedHandles((prev) => new Set(prev).add(handle));
        setActionNotice(`Follow request sent to @${handle}`);
      } else {
        setFollowedHandles((prev) => new Set(prev).add(handle));
        setActionNotice(`Following @${handle}`);
      }
    } catch (err) {
      setActionNotice(err instanceof Error ? err.message : 'Follow failed');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleJoinSuggestion = async (communityId: string) => {
    if (actionBusyId || joinedCommunityIds.has(communityId)) return;
    setActionNotice(null);
    if (!authEnabled || !isSignedIn) {
      setActionNotice(authEnabled ? 'Sign in to join.' : 'Sign-in is not configured.');
      return;
    }
    const token = await getToken();
    if (!token) {
      setActionNotice('Sign in again to join.');
      return;
    }
    setActionBusyId(`community:${communityId}`);
    try {
      await joinCommunity(token, communityId);
      setJoinedCommunityIds((prev) => new Set(prev).add(communityId));
      setActionNotice('Joined community');
    } catch (err) {
      setActionNotice(err instanceof Error ? err.message : 'Join failed');
    } finally {
      setActionBusyId(null);
    }
  };

  const loadMorePosts = useCallback(async () => {
    if (loading || loadingMore || !hasMore || cursor === null || error) return;
    // After a soft failure, stop IntersectionObserver spam until the user retries via banner.
    if (bannerError) return;

    setLoadingMore(true);
    try {
      const response = await loadFeedPage(cursor);
      setPosts((current) => {
        const existingIds = new Set(current.map((post) => post.id));
        const nextPosts = response.posts.filter((post) => !existingIds.has(post.id));
        return [...current, ...nextPosts];
      });
      setCursor(response.nextCursor);
      setHasMore(response.nextCursor !== null);
      setBannerError(null);
    } catch (err) {
      // Keep existing posts; surface a dismissible/retry banner instead of empty theater.
      setBannerError(formatRequestError(err, 'Unable to load more posts'));
    } finally {
      setLoadingMore(false);
    }
  }, [bannerError, cursor, error, hasMore, loadFeedPage, loading, loadingMore]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMorePosts();
      },
      { rootMargin: '360px 0px' },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMorePosts]);

  const checkForNewPosts = useCallback(async () => {
    if (refreshing || error) return;

    setRefreshing(true);
    setBannerError(null);
    try {
      const response = await loadFeedPage();
      const visibleIds = new Set(posts.map((post) => post.id));
      const unseenCount = response.posts.filter((post) => !visibleIds.has(post.id)).length;

      // Only show the banner when there are genuinely unseen posts — never invent a count.
      if (unseenCount === 0) {
        setPendingFeed(null);
        setNewPostCount(0);
        return;
      }

      setPendingFeed(response);
      setNewPostCount(unseenCount);
    } catch (err) {
      setBannerError(formatRequestError(err, 'Unable to refresh feed'));
    } finally {
      setRefreshing(false);
    }
  }, [error, loadFeedPage, posts, refreshing]);

  const showPendingPosts = () => {
    if (!pendingFeed) return;

    setPosts(pendingFeed.posts);
    setCursor(pendingFeed.nextCursor);
    setHasMore(pendingFeed.nextCursor !== null);
    setPendingFeed(null);
    setNewPostCount(0);
    setBannerError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (window.scrollY > 0 || loading || refreshing) return;
    touchStartY.current = event.touches[0]?.clientY ?? null;
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartY.current === null) return;

    const currentY = event.touches[0]?.clientY;
    if (currentY === undefined) return;

    const distance = Math.max(0, currentY - touchStartY.current);
    setPullDistance(Math.min(distance, 96));
  };

  const handleTouchEnd = () => {
    const shouldRefresh = pullDistance >= PULL_REFRESH_THRESHOLD;
    touchStartY.current = null;
    setPullDistance(0);

    if (shouldRefresh) void checkForNewPosts();
  };

  const clearComposeImage = useCallback(() => {
    setImagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setImageFile(null);
  }, []);

  const onComposeImagePick = useCallback(
    (file: File) => {
      const validationError = validateComposeMediaFile(file);
      if (validationError) {
        setComposeNotice(validationError);
        clearComposeImage();
        return;
      }
      setImagePreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
      setImageFile(file);
      setComposeNotice(null);
    },
    [clearComposeImage],
  );

  // Keep latest preview URL for unmount revoke (avoid leaking object URLs).
  const imagePreviewUrlRef = useRef<string | null>(null);
  imagePreviewUrlRef.current = imagePreviewUrl;
  useEffect(() => {
    return () => {
      if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current);
    };
  }, []);

  const submitPost = async () => {
    const trimmed = content.trim();
    if ((!trimmed && !imageFile) || posting) return;

    setPosting(true);
    setComposeNotice(null);
    try {
      if (!authEnabled || !isSignedIn) {
        setComposeNotice(authEnabled ? 'Sign in to post.' : 'Sign-in is not configured for this environment.');
        return;
      }

      const token = await getToken();
      if (!token) {
        setComposeNotice('Sign in again to post.');
        return;
      }

      try {
        await fetchMyProfile(token);
      } catch (profileErr: unknown) {
        const msg = profileErr instanceof Error ? profileErr.message.toLowerCase() : '';
        if (msg.includes('404') || msg.includes('not found')) {
          setComposeNotice('Create your profile before posting.');
          return;
        }
        throw profileErr;
      }

      const mediaIds: string[] = [];
      if (imageFile) {
        try {
          const uploaded = await uploadMediaFile(token, imageFile);
          mediaIds.push(uploaded.mediaId);
        } catch (uploadErr) {
          setComposeNotice(
            formatRequestError(
              uploadErr,
              'Media upload failed. Try again or post without an attachment.',
            ),
          );
          return;
        }
      }

      const result = await createPost(token, {
        body: trimmed,
        ...(mediaIds.length > 0 ? { mediaIds } : {}),
      });
      setPosts((current) => [feedPostToPost(result.post), ...current]);
      setContent('');
      clearComposeImage();
      setComposeNotice(null);
      // A successful write means the API is up; clear any soft feed banner.
      setBannerError(null);
    } catch (err) {
      setComposeNotice(formatRequestError(err, 'Post failed. Try again.'));
    } finally {
      setPosting(false);
    }
  };

  return (
    <div
      className="min-h-screen"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
    >
      <div
        className="sticky top-[var(--top-bar-height)] z-10 flex border-b sticky-header-bg backdrop-blur-md"
        style={{ borderColor: 'var(--border-primary)' }}
        role="tablist"
        aria-label="Feed filters"
      >
        {TABS.map((tab) => {
          const selected = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveTab(tab)}
              className="flex-1 py-4 text-[15px] font-medium transition-colors hover-overlay focus-visible:outline-none focus-ring"
              style={{ color: selected ? 'var(--text-primary)' : 'var(--text-secondary)' }}
            >
              <span className="relative inline-block">
                {tab}
                {selected && (
                  <span className="absolute -bottom-[17px] left-0 right-0 h-[4px] rounded-full" style={{ backgroundColor: 'var(--accent)' }} aria-hidden="true" />
                )}
              </span>
            </button>
          );
        })}
      </div>

      {showOnboard && (
        <div
          role="region"
          aria-label={earlyAccess.regionLabel}
          className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"
          style={{
            borderColor: 'var(--border-primary)',
            backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)',
          }}
        >
          <p className="min-w-0 flex-1 text-[14px]" style={{ color: 'var(--text-primary)' }}>
            {earlyAccess.lead}{' '}
            <span style={{ color: 'var(--text-secondary)' }}>{earlyAccess.mediaHold}</span>{' '}
            <Link to="/ai" className="font-semibold underline-offset-2 hover:underline" style={{ color: 'var(--accent)' }}>
              {earlyAccess.pulseCta}
            </Link>
          </p>
          <button
            type="button"
            onClick={dismissOnboard}
            className="shrink-0 rounded-full border px-3 py-1 text-[13px] font-medium transition-colors hover-overlay"
            style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' }}
            aria-label="Dismiss onboarding banner"
          >
            Dismiss
          </button>
        </div>
      )}

      <div
        aria-hidden={pullDistance === 0 && !refreshing}
        className="overflow-hidden border-b text-center text-[13px] transition-[height] duration-150 sm:hidden"
        style={{
          borderColor: pullDistance > 0 || refreshing ? 'var(--border-primary)' : 'transparent',
          color: 'var(--text-secondary)',
          height: refreshing ? 36 : pullDistance > 0 ? Math.min(pullDistance, 36) : 0,
        }}
      >
        <div className="py-2">
          {refreshing ? 'Checking for new posts' : pullDistance >= PULL_REFRESH_THRESHOLD ? 'Release to refresh' : 'Pull to refresh'}
        </div>
      </div>

      <TabbedCompose
        content={content}
        onContentChange={setContent}
        onSubmitPost={submitPost}
        posting={posting}
        composeNotice={composeNotice}
        getToken={getToken}
        isSignedIn={isSignedIn}
        authEnabled={authEnabled}
        imagePreviewUrl={imagePreviewUrl}
        mediaIsVideo={mediaIsVideo}
        onImagePick={onComposeImagePick}
        onImageClear={clearComposeImage}
        signInButton={
          authEnabled ? (
            <SignInButton mode="modal">
              <button
                type="button"
                className="rounded-full border px-3 py-1 text-[13px] font-bold transition-colors hover-overlay"
                style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-primary)' }}
              >
                Sign in
              </button>
            </SignInButton>
          ) : undefined
        }
        profileLink={
          <a
            href="/profile"
            className="rounded-full border px-3 py-1 text-[13px] font-bold transition-colors hover-overlay"
            style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-primary)' }}
          >
            Go to profile
          </a>
        }
      />

      {pendingFeed && newPostCount > 0 && (
        <button
          type="button"
          onClick={showPendingPosts}
          className="sticky top-[calc(var(--top-bar-height)+53px)] z-[9] w-full border-b py-3 text-[15px] font-bold transition-colors hover-overlay"
          style={{
            backgroundColor: 'var(--bg-primary)',
            borderColor: 'var(--border-primary)',
            color: 'var(--accent)',
          }}
        >
          Show {newPostCount} new {newPostCount === 1 ? 'post' : 'posts'}
        </button>
      )}

      {!loading && bannerError && !error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"
          style={{
            borderColor: 'var(--border-primary)',
            backgroundColor: 'color-mix(in srgb, var(--color-danger) 8%, transparent)',
          }}
        >
          <p className="min-w-0 flex-1 text-[13px]" style={{ color: 'var(--color-danger)' }}>
            {bannerError}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={retryFeed}
              className="rounded-full px-3 py-1 text-[13px] font-bold transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--accent)', color: 'var(--bg-primary)' }}
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => setBannerError(null)}
              className="rounded-full border px-3 py-1 text-[13px] font-medium transition-colors hover-overlay"
              style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {loading && <LoadingState label="Loading feed" />}
      {!loading && error && (
        <ErrorState
          title="Couldn't load feed"
          detail={error}
          onRetry={retryFeed}
        />
      )}
      {!loading && !error && filterPostsExcludingAuthors(posts, hiddenAuthorIds).length === 0 && activeTab !== 'Following' && (
        <EmptyState
          title="No posts yet"
          detail="When there is activity in this feed, it will appear here."
        />
      )}
      {!loading && !error && filterPostsExcludingAuthors(posts, hiddenAuthorIds).length === 0 && activeTab === 'Following' && (
        <section className="border-b px-4 py-6" style={{ borderColor: 'var(--border-primary)' }}>
          <EmptyState title={emptyFollowingTitle()} detail={emptyFollowingDetail()} />
          {actionNotice && (
            <p className="mt-3 text-center text-[13px]" style={{ color: 'var(--text-secondary)' }} role="status">
              {actionNotice}
            </p>
          )}
          {suggestionsLoading && <LoadingState label="Loading suggestions" />}
          {!suggestionsLoading && suggestionsError && (
            <p className="mt-3 text-center text-[13px]" style={{ color: 'var(--danger, #f4212e)' }} role="alert">
              {suggestionsError}
            </p>
          )}
          {!suggestionsLoading && !suggestionsError && networkSuggestions.length === 0 && (
            <p className="mt-3 text-center text-[13px]" style={{ color: 'var(--text-secondary)' }}>
              No live suggestions yet. Try Explore when profiles or communities appear.
            </p>
          )}
          {!suggestionsLoading && networkSuggestions.length > 0 && (
            <ul className="mx-auto mt-4 max-w-lg space-y-3">
              {networkSuggestions.map((item) => {
                if (item.kind === 'profile') {
                  const busy = actionBusyId === `profile:${item.handle}`;
                  const followed = followedHandles.has(item.handle);
                  const requested = requestedHandles.has(item.handle);
                  return (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-2xl border px-4 py-3"
                      style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}
                    >
                      <div className="min-w-0">
                        <Link
                          to={`/profile/${encodeURIComponent(item.handle)}`}
                          className="text-[15px] font-bold underline-offset-2 hover:underline"
                        >
                          {item.displayName}
                        </Link>
                        <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                          @{item.handle}
                        </p>
                        {item.bio ? (
                          <p className="mt-1 line-clamp-2 text-[13px]">{item.bio}</p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        disabled={busy || followed || requested}
                        onClick={() => void handleFollowSuggestion(item.handle)}
                        className="shrink-0 rounded-full px-4 py-1.5 text-[13px] font-bold transition-opacity hover:opacity-90 disabled:opacity-60"
                        style={{
                          backgroundColor: followed || requested ? 'transparent' : 'var(--accent)',
                          color: followed || requested ? 'var(--text-primary)' : 'var(--bg-primary)',
                          border: followed || requested ? '1px solid var(--border-primary)' : undefined,
                        }}
                      >
                        {busy ? '…' : followed ? 'Following' : requested ? 'Requested' : 'Follow'}
                      </button>
                    </li>
                  );
                }
                if (item.kind === 'community') {
                  const busy = actionBusyId === `community:${item.id}`;
                  const joined = joinedCommunityIds.has(item.id);
                  return (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-2xl border px-4 py-3"
                      style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}
                    >
                      <div className="min-w-0">
                        <Link
                          to="/communities"
                          className="text-[15px] font-bold underline-offset-2 hover:underline"
                        >
                          {item.name}
                        </Link>
                        <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                          Community · {item.slug}
                        </p>
                        {item.description ? (
                          <p className="mt-1 line-clamp-2 text-[13px]">{item.description}</p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        disabled={busy || joined}
                        onClick={() => void handleJoinSuggestion(item.id)}
                        className="shrink-0 rounded-full px-4 py-1.5 text-[13px] font-bold transition-opacity hover:opacity-90 disabled:opacity-60"
                        style={{
                          backgroundColor: joined ? 'transparent' : 'var(--accent)',
                          color: joined ? 'var(--text-primary)' : 'var(--bg-primary)',
                          border: joined ? '1px solid var(--border-primary)' : undefined,
                        }}
                      >
                        {busy ? '…' : joined ? 'Joined' : 'Join'}
                      </button>
                    </li>
                  );
                }
                // topic
                return (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border px-4 py-3"
                    style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}
                  >
                    <div className="min-w-0">
                      <p className="text-[15px] font-bold">#{item.tag}</p>
                      <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                        Trending · {item.postCount} posts
                      </p>
                    </div>
                    <Link
                      to={topicExplorePath(item.tag)}
                      className="shrink-0 rounded-full border px-4 py-1.5 text-[13px] font-bold transition-colors hover-overlay"
                      style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-primary)' }}
                    >
                      Explore
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
      {!loading && !error && filterPostsExcludingAuthors(posts, hiddenAuthorIds).map((post) => (
        <PostCard
          key={post.id}
          post={post}
          onLike={(id, liked, token) => (liked ? likePost(token, id) : unlikePost(token, id))}
          onRepost={(id, reposted, token) => (reposted ? repostPost : unrepostPost)(token, id)}
          onBookmark={(id, bookmarked, token) =>
            bookmarked ? bookmarkPost(token, id) : unbookmarkPost(token, id)
          }
          onHideAuthor={(authorId) => {
            setHiddenAuthorIds((current) => addExcludedAuthor(current, authorId));
          }}
          onDelete={(id) => {
            setPosts((current) => current.filter((p) => p.id !== id));
          }}
        />
      ))}
      {!loading && !error && (
        <div ref={loadMoreRef} className="min-h-12">
          {loadingMore && <LoadingState label="Loading more posts" />}
          {!loadingMore && hasMore && cursor === null && !bannerError && (
            <div className="px-4 py-6 text-center text-[13px]" style={{ color: 'var(--text-secondary)' }}>
              More posts will load when the feed returns a cursor.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default HomePage;
