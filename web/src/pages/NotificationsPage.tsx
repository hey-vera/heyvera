import { useEffect, useState } from 'react';
import { SignInButton } from '@clerk/clerk-react';
import { Heart, Repeat2, UserPlus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { fetchNotifications } from '../api/social';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/AsyncStates';
import { useAuth } from '../hooks/useAuth';

type NotificationType = 'like' | 'follow' | 'repost';

type ApiNotification = {
  id: string;
  type: NotificationType;
  actorHandle: string;
  actorDisplayName: string;
  actorAvatarUrl: string | null;
  postId: string | null;
  createdAt: string;
};

const notificationIcons: Record<NotificationType, { icon: LucideIcon; color: string }> = {
  like: { icon: Heart, color: 'var(--color-like)' },
  repost: { icon: Repeat2, color: 'var(--color-repost)' },
  follow: { icon: UserPlus, color: 'var(--accent)' },
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
  }
}

export function NotificationsPage() {
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const [notifications, setNotifications] = useState<ApiNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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
        if (!token) {
          if (!cancelled) setNotifications([]);
          return;
        }
        const result = await fetchNotifications(token);
        if (!cancelled) setNotifications(result.notifications);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load notifications');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadNotifications();
    return () => {
      cancelled = true;
    };
  }, [authEnabled, isSignedIn, reloadKey]);

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div className="sticky top-[var(--top-bar-height)] z-10 border-b sticky-header-bg backdrop-blur-md lg:top-0" style={{ borderColor: 'var(--border-primary)' }}>
        <div className="px-4 py-3">
          <h1 className="text-[20px] font-bold">Notifications</h1>
        </div>
      </div>

      {loading && <LoadingState label="Loading notifications" />}
      {!loading && authEnabled && !isSignedIn && <SignedOutNotificationsPrompt />}
      {!loading && error && <ErrorState detail={error} onRetry={() => setReloadKey((key) => key + 1)} />}
      {!loading && !(authEnabled && !isSignedIn) && !error && notifications.length === 0 && (
        <EmptyState title="Nothing yet" detail="Likes, reposts, and follows will appear here." />
      )}
      {!loading && !(authEnabled && !isSignedIn) && !error && notifications.map((notification) => {
        const meta = notificationIcons[notification.type];
        const Icon = meta.icon;
        return (
          <article
            key={notification.id}
            className="flex cursor-pointer gap-3 border-b px-4 py-3 transition-colors hover:bg-white/5"
            style={{ borderColor: 'var(--border-primary)' }}
          >
            <div className="flex w-10 flex-shrink-0 justify-center pt-1" style={{ color: meta.color }}>
              <Icon className="h-6 w-6" fill={notification.type === 'like' ? 'currentColor' : 'none'} aria-hidden="true" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="mb-2 flex gap-1">
                {notification.actorAvatarUrl ? (
                  <img
                    src={notification.actorAvatarUrl}
                    alt={notification.actorDisplayName}
                    className="h-8 w-8 rounded-full object-cover"
                    style={{ backgroundColor: 'var(--border-primary)' }}
                  />
                ) : (
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-full text-xs"
                    style={{ backgroundColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
                  >
                    {notification.actorDisplayName.charAt(0)}
                  </div>
                )}
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
