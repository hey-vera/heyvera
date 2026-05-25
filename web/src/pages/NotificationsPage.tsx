import { useEffect, useState } from 'react';
import { SignInButton } from '@clerk/clerk-react';
import { Heart, MessageCircle, Quote, Repeat2, UserPlus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getNotifications } from '../api/social';
import type { Notification } from '../api/types';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/AsyncStates';
import { useAuth } from '../hooks/useAuth';

const TABS = ['All', 'Verified'] as const;
type Tab = typeof TABS[number];

const notificationIcons: Record<Notification['type'], { icon: LucideIcon; color: string }> = {
  like: { icon: Heart, color: 'var(--color-like)' },
  repost: { icon: Repeat2, color: 'var(--color-repost)' },
  follow: { icon: UserPlus, color: 'var(--accent)' },
  reply: { icon: MessageCircle, color: 'var(--color-reply)' },
  mention: { icon: MessageCircle, color: 'var(--color-reply)' },
  quote: { icon: Quote, color: 'var(--color-reply)' },
};

function notificationText(notification: Notification): string {
  const names = notification.actors.map((actor) => actor.display_name);
  const actorText =
    names.length === 0
      ? 'Someone'
      : names.length === 1
        ? names[0]
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

  switch (notification.type) {
    case 'like':
      return `${actorText} liked your post`;
    case 'repost':
      return `${actorText} reposted your post`;
    case 'follow':
      return `${actorText} followed you`;
    case 'reply':
      return `${actorText} replied to your post`;
    case 'mention':
      return `${actorText} mentioned you`;
    case 'quote':
      return `${actorText} quoted your post`;
  }
}

export function NotificationsPage() {
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('All');
  const [notifications, setNotifications] = useState<Notification[]>([]);
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
        const items = await getNotifications(token ?? undefined);
        if (!cancelled) setNotifications(items);
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

  const visibleNotifications =
    activeTab === 'Verified'
      ? notifications.filter((notification) => notification.actors.some((actor) => actor.verified))
      : notifications;

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div className="sticky top-[var(--top-bar-height)] z-10 border-b bg-black/80 backdrop-blur-md lg:top-0" style={{ borderColor: 'var(--border-primary)' }}>
        <div className="px-4 py-3">
          <h1 className="text-[20px] font-bold">Notifications</h1>
        </div>
        <div className="flex">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className="flex-1 py-4 text-[15px] font-medium transition-colors hover:bg-white/5"
              style={{ color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-secondary)' }}
            >
              <span className="relative inline-block">
                {tab}
                {activeTab === tab && (
                  <span className="absolute -bottom-[17px] left-0 right-0 h-[4px] rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
                )}
              </span>
            </button>
          ))}
        </div>
      </div>

      {loading && <LoadingState label="Loading notifications" />}
      {!loading && authEnabled && !isSignedIn && <SignedOutNotificationsPrompt />}
      {!loading && error && <ErrorState detail={error} onRetry={() => setReloadKey((key) => key + 1)} />}
      {!loading && !(authEnabled && !isSignedIn) && !error && visibleNotifications.length === 0 && (
        <EmptyState title="Nothing yet" detail="Likes, reposts, follows, and replies will appear here." />
      )}
      {!loading && !(authEnabled && !isSignedIn) && !error && visibleNotifications.map((notification) => {
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
                {notification.actors.map((actor) => (
                  <img
                    key={actor.id}
                    src={actor.avatar_url}
                    alt={actor.display_name}
                    className="h-8 w-8 rounded-full object-cover"
                    style={{ backgroundColor: 'var(--border-primary)' }}
                  />
                ))}
              </div>

              <p className="text-[15px] leading-snug">{notificationText(notification)}</p>

              {notification.post && (
                <p className="mt-1 truncate text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                  {notification.post.content}
                </p>
              )}
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
