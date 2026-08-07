import { useCallback, useEffect, useRef, useState } from 'react';
import { SignInButton } from '@clerk/clerk-react';
import { AtSign, Heart, MessageCircle, Repeat2, UserPlus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router';
import {
  approveFollowRequest,
  fetchFollowRequests,
  fetchNotifications,
  markNotificationsRead,
  rejectFollowRequest,
  type FollowRequest,
  type SocialNotification,
} from '../api/social';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/AsyncStates';
import { useAuth } from '../hooks/useAuth';
import { useVisibilityPoll } from '../hooks/useVisibilityPoll';
import { relativeTime } from '../utils/time';
import { SOFT_POLL_STATUS_LABEL, softPollTooltip } from '../utils/softRealtimeLabel';

type NotificationType = SocialNotification['type'];
type ApiNotification = SocialNotification;

const FILTER_TABS = ['All', 'Mentions'] as const;
type FilterTab = typeof FILTER_TABS[number];

/** Soft-realtime poll interval while page is visible (honest intermediate before WS). */
const NOTIFICATIONS_POLL_MS = 15_000;
const PAGE_SIZE = 20;

const notificationIcons: Record<NotificationType, { icon: LucideIcon; color: string }> = {
  like: { icon: Heart, color: 'var(--color-like)' },
  repost: { icon: Repeat2, color: 'var(--color-repost)' },
  follow: { icon: UserPlus, color: 'var(--accent)' },
  follow_request: { icon: UserPlus, color: 'var(--accent)' },
  follow_accepted: { icon: UserPlus, color: 'var(--accent)' },
  reply: { icon: MessageCircle, color: 'var(--color-reply)' },
  mention: { icon: AtSign, color: 'var(--accent)' },
  quote: { icon: MessageCircle, color: 'var(--color-reply)' },
};

function notificationText(notification: ApiNotification): string {
  const name = notification.actorDisplayName || 'Someone';

  switch (notification.type) {
    case 'like':
      return `${name} liked your post`;
    case 'repost':
      return `${name} reposted your post`;
    case 'follow':
      return `${name} followed you`;
    case 'follow_request':
      return `${name} requested to follow you`;
    case 'follow_accepted':
      return `${name} accepted your follow request`;
    case 'reply':
      return `${name} replied to your post`;
    case 'mention':
      return `${name} mentioned you`;
    case 'quote':
      return `${name} quoted your post`;
  }
}

function networkishErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : '';
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(msg)) {
    return 'Unable to reach the server. Check your connection and try again.';
  }
  return msg || 'Unable to load notifications';
}

function appendUniqueNotifications(
  current: ApiNotification[],
  incoming: ApiNotification[],
): ApiNotification[] {
  const existingIds = new Set(current.map((n) => n.id));
  const next = incoming.filter((n) => !existingIds.has(n.id));
  return next.length === 0 ? current : [...current, ...next];
}

/** Soft poll: refresh the first page at the top without dropping already-loaded pages. */
function mergeFirstPage(
  current: ApiNotification[],
  firstPage: ApiNotification[],
): ApiNotification[] {
  if (current.length === 0) return firstPage;
  const firstIds = new Set(firstPage.map((n) => n.id));
  const rest = current.filter((n) => !firstIds.has(n.id));
  return [...firstPage, ...rest];
}

export function NotificationsPage() {
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<ApiNotification[]>([]);
  const [followRequests, setFollowRequests] = useState<FollowRequest[]>([]);
  const [followRequestBusyId, setFollowRequestBusyId] = useState<string | null>(null);
  const [followRequestError, setFollowRequestError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Soft failure while the list remains visible (load-more only). */
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('All');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  /** Quiet background refresh — never toggles full-page LoadingState or wipes paginated rows. */
  const pollNotifications = useCallback(async () => {
    if (!isSignedIn) return;
    try {
      const token = await getToken();
      if (!token) return;
      const [result, requestResult] = await Promise.all([
        fetchNotifications(token, PAGE_SIZE),
        fetchFollowRequests(token, 50),
      ]);
      setNotifications((current) => mergeFirstPage(current, result.notifications));
      setFollowRequests(requestResult.requests);
      setError(null);
      setLastUpdatedAt(Date.now());
    } catch {
      // Keep existing list; background poll failures stay quiet.
    }
  }, [getToken, isSignedIn]);

  // Initial load + explicit retry (full LoadingState only here).
  useEffect(() => {
    let cancelled = false;

    async function loadNotifications() {
      setLoading(true);
      setError(null);
      setLoadMoreError(null);
      setCursor(null);
      setHasMore(false);
      try {
        if (authEnabled && !isSignedIn) {
          if (!cancelled) setNotifications([]);
          return;
        }

        const token = authEnabled ? await getToken() : null;
        if (authEnabled && !token) {
          if (!cancelled) {
            setNotifications([]);
            setError('Unable to verify your session. Sign in again to load notifications.');
          }
          return;
        }
        if (!token) {
          if (!cancelled) setNotifications([]);
          return;
        }
        const [result, requestResult] = await Promise.all([
          fetchNotifications(token, PAGE_SIZE),
          fetchFollowRequests(token, 50),
        ]);
        if (!cancelled) {
          setNotifications(result.notifications);
          setFollowRequests(requestResult.requests);
          setCursor(result.cursor);
          setHasMore(result.has_more && result.cursor != null);
          setError(null);
          setLastUpdatedAt(Date.now());
        }
        // Mark visible notifications read (fire-and-forget; do not block list render).
        void markNotificationsRead(token).catch(() => {
          /* ignore mark-read failures */
        });
      } catch (err) {
        if (!cancelled) {
          setNotifications([]);
          setCursor(null);
          setHasMore(false);
          setError(networkishErrorMessage(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadNotifications();
    return () => {
      cancelled = true;
    };
  }, [authEnabled, getToken, isSignedIn, reloadKey]);

  // Soft-realtime: quiet background poll while signed in (paused when tab hidden).
  useVisibilityPoll(pollNotifications, NOTIFICATIONS_POLL_MS, Boolean(isSignedIn), {
    runOnVisible: true,
  });

  const loadMoreNotifications = useCallback(async () => {
    if (loading || loadingMore || !hasMore || cursor == null || error) return;

    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const token = await getToken();
      if (!token) {
        setLoadMoreError('Unable to verify your session. Sign in again to load more.');
        return;
      }
      const result = await fetchNotifications(token, PAGE_SIZE, cursor);
      setNotifications((current) => appendUniqueNotifications(current, result.notifications));
      setCursor(result.cursor);
      setHasMore(result.has_more && result.cursor != null);
    } catch (err) {
      // Keep existing list; surface a soft error under the list.
      setLoadMoreError(networkishErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, error, getToken, hasMore, loading, loadingMore]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target) return undefined;
    // After a soft failure, stop IntersectionObserver spam until the user retries.
    if (loadMoreError) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMoreNotifications();
      },
      { rootMargin: '360px 0px' },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMoreError, loadMoreNotifications]);

  const filtered = activeFilter === 'All'
    ? notifications
    : notifications.filter((n) => n.type === 'mention' || n.type === 'reply');

  const handleNotificationClick = (notification: ApiNotification) => {
    if (notification.postId) {
      navigate(`/post/${notification.postId}`);
    } else if (notification.type === 'follow') {
      navigate(`/profile/${notification.actorHandle}`);
    }
  };

  const resolveFollowRequest = async (requestId: string, approve: boolean) => {
    if (followRequestBusyId) return;
    setFollowRequestBusyId(requestId);
    setFollowRequestError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Sign in again to manage follow requests.');
      if (approve) {
        await approveFollowRequest(token, requestId);
      } else {
        await rejectFollowRequest(token, requestId);
      }
      setFollowRequests((current) => current.filter((request) => request.id !== requestId));
    } catch (err) {
      setFollowRequestError(
        err instanceof Error ? err.message : 'Unable to update the follow request.',
      );
    } finally {
      setFollowRequestBusyId(null);
    }
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div className="sticky top-[var(--top-bar-height)] z-10 border-b sticky-header-bg backdrop-blur-md" style={{ borderColor: 'var(--border-primary)' }}>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <h1 className="text-[20px] font-bold">Notifications</h1>
          {isSignedIn && lastUpdatedAt != null && !loading && (
            <span
              className="flex items-center gap-1.5 text-[12px] font-medium"
              style={{ color: 'var(--text-secondary)' }}
              role="status"
              title={softPollTooltip()}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: 'var(--accent)' }}
                aria-hidden="true"
              />
              {SOFT_POLL_STATUS_LABEL}
            </span>
          )}
        </div>
        <div className="flex" style={{ borderTop: '1px solid var(--border-primary)' }}>
          {FILTER_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveFilter(tab)}
              className="flex-1 px-4 py-3 text-[15px] font-medium transition-colors hover:bg-[color:color-mix(in_srgb,var(--text-primary)_5%,transparent)]"
              style={{ color: activeFilter === tab ? 'var(--text-primary)' : 'var(--text-secondary)' }}
            >
              <span className="relative inline-block">
                {tab}
                {activeFilter === tab && (
                  <span className="absolute -bottom-[13px] left-0 right-0 h-[4px] rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
                )}
              </span>
            </button>
          ))}
        </div>
      </div>

      {loading && <LoadingState label="Loading notifications" />}
      {!loading && authEnabled && !isSignedIn && <SignedOutNotificationsPrompt />}
      {!loading && !(authEnabled && !isSignedIn) && error && (
        <ErrorState
          title="Couldn't load notifications"
          detail={error}
          onRetry={() => setReloadKey((key) => key + 1)}
        />
      )}
      {!loading && !error && followRequests.length > 0 && (
        <section className="border-b px-4 py-4" style={{ borderColor: 'var(--border-primary)' }}>
          <h2 className="text-[15px] font-bold">Follow requests</h2>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
            Approve only people you want to see protected and followers-only posts.
          </p>
          {followRequestError && (
            <p className="mt-3 text-[13px]" role="alert" style={{ color: 'var(--danger, #f4212e)' }}>
              {followRequestError}
            </p>
          )}
          <ul className="mt-3 space-y-3">
            {followRequests.map((request) => (
              <li key={request.id} className="flex items-center gap-3">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => navigate(`/profile/${request.requester.handle}`)}
                >
                  <span className="block truncate text-[14px] font-semibold">
                    {request.requester.displayName || request.requester.handle}
                  </span>
                  <span className="block truncate text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                    @{request.requester.handle}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={followRequestBusyId != null}
                  onClick={() => void resolveFollowRequest(request.id, false)}
                  className="rounded-full border px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
                  style={{ borderColor: 'var(--border-primary)' }}
                >
                  Decline
                </button>
                <button
                  type="button"
                  disabled={followRequestBusyId != null}
                  onClick={() => void resolveFollowRequest(request.id, true)}
                  className="rounded-full px-3 py-1.5 text-[13px] font-bold disabled:opacity-50"
                  style={{ backgroundColor: 'var(--accent)', color: '#000' }}
                >
                  Approve
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!loading && !(authEnabled && !isSignedIn) && !error && filtered.length === 0 && followRequests.length === 0 && (
        <EmptyState
          title="Nothing yet"
          detail={activeFilter === 'Mentions' ? 'Mentions and replies will appear here.' : 'Likes, reposts, follows, and replies will appear here.'}
        />
      )}
      {!loading && !(authEnabled && !isSignedIn) && !error && filtered.map((notification) => {
        const meta = notificationIcons[notification.type] ?? notificationIcons.like;
        const Icon = meta.icon;
        return (
          <article
            key={notification.id}
            className="flex cursor-pointer gap-3 border-b px-4 py-3 transition-colors hover-overlay"
            style={{ borderColor: 'var(--border-primary)' }}
            onClick={() => handleNotificationClick(notification)}
          >
            <div className="flex w-10 flex-shrink-0 justify-center pt-1" style={{ color: meta.color }}>
              <Icon className="h-6 w-6" fill={notification.type === 'like' ? 'currentColor' : 'none'} aria-hidden="true" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); navigate(`/profile/${notification.actorHandle}`); }}
                  className="shrink-0"
                  style={{ background: 'transparent', border: 'none', padding: 0 }}
                >
                  {notification.actorAvatarUrl ? (
                    <img
                      src={notification.actorAvatarUrl}
                      alt={notification.actorDisplayName}
                      className="h-8 w-8 rounded-full object-cover hover:brightness-90 transition-all"
                      style={{ backgroundColor: 'var(--border-primary)' }}
                    />
                  ) : (
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-full text-xs hover:brightness-90 transition-all"
                      style={{ backgroundColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
                    >
                      {notification.actorDisplayName.charAt(0)}
                    </div>
                  )}
                </button>
                <span className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                  {relativeTime(notification.createdAt)}
                </span>
              </div>

              <p className="text-[15px] leading-snug">{notificationText(notification)}</p>
            </div>
          </article>
        );
      })}

      {!loading && !(authEnabled && !isSignedIn) && !error && notifications.length > 0 && (
        <div ref={loadMoreRef} className="min-h-12">
          {loadingMore && <LoadingState label="Loading more notifications" />}
          {!loadingMore && loadMoreError && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"
              style={{ borderColor: 'var(--border-primary)' }}
            >
              <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                {loadMoreError}
              </p>
              <button
                type="button"
                onClick={() => void loadMoreNotifications()}
                className="shrink-0 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-opacity hover:opacity-80"
                style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
              >
                Retry
              </button>
            </div>
          )}
          {!loadingMore && !loadMoreError && hasMore && cursor != null && (
            <div className="px-4 py-4 text-center">
              <button
                type="button"
                onClick={() => void loadMoreNotifications()}
                className="rounded-full border px-4 py-2 text-[13px] font-semibold transition-opacity hover:opacity-80"
                style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
              >
                Load more
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SignedOutNotificationsPrompt() {
  return (
    <div className="px-4 py-10">
      <div className="mx-auto max-w-sm text-center">
        <h2 className="text-[20px] font-bold">Sign in to see notifications</h2>
        <p className="mt-2 text-[15px]" style={{ color: 'var(--text-secondary)' }}>
          Likes, reposts, follows, and replies from your account will appear here.
        </p>
        <SignInButton mode="modal">
          <button
            type="button"
            className="mt-5 rounded-full px-5 py-2 text-[15px] font-bold"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--bg-primary)' }}
          >
            Sign in
          </button>
        </SignInButton>
      </div>
    </div>
  );
}

export default NotificationsPage;
