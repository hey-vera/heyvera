import { useCallback, useEffect, useState } from 'react';
import { SignInButton } from '@clerk/clerk-react';
import { AtSign, Heart, MessageCircle, Repeat2, UserPlus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { fetchNotifications, markNotificationsRead, type SocialNotification } from '../api/social';
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

const notificationIcons: Record<NotificationType, { icon: LucideIcon; color: string }> = {
  like: { icon: Heart, color: 'var(--color-like)' },
  repost: { icon: Repeat2, color: 'var(--color-repost)' },
  follow: { icon: UserPlus, color: 'var(--accent)' },
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

export function NotificationsPage() {
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<ApiNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('All');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  /** Quiet background refresh — never toggles full-page LoadingState. */
  const pollNotifications = useCallback(async () => {
    if (!isSignedIn) return;
    try {
      const token = await getToken();
      if (!token) return;
      const result = await fetchNotifications(token);
      setNotifications(result.notifications);
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
        const result = await fetchNotifications(token);
        if (!cancelled) {
          setNotifications(result.notifications);
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
      {!loading && !(authEnabled && !isSignedIn) && !error && filtered.length === 0 && (
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
