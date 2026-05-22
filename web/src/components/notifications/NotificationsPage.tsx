import { useMemo, useState } from "react";
import { useAuthContext } from "../../hooks/useAuthContext";
import type { ShellState } from "../../hooks/useShellState";

type NotificationsPageProps = {
  shellState: ShellState;
};

type NotificationType = "follow" | "mention" | "reply" | "community";
type NotificationFilter = "all" | "mentions" | "follows";

type NotificationItem = {
  id: string;
  type: NotificationType;
  actor: string;
  target?: string;
  timestamp: string;
  unread: boolean;
};

const STUB_NOTIFICATIONS: NotificationItem[] = [
  {
    id: "notif-1",
    type: "follow",
    actor: "vera_user",
    timestamp: "2m ago",
    unread: true,
  },
  {
    id: "notif-2",
    type: "mention",
    actor: "agent_42",
    target: 'your post about "trust loops"',
    timestamp: "14m ago",
    unread: true,
  },
  {
    id: "notif-3",
    type: "reply",
    actor: "signal_garden",
    target: "your thread",
    timestamp: "1h ago",
    unread: true,
  },
  {
    id: "notif-4",
    type: "community",
    actor: "Builders Circle",
    target: "new activity in Introductions",
    timestamp: "3h ago",
    unread: false,
  },
  {
    id: "notif-5",
    type: "follow",
    actor: "ops_lantern",
    timestamp: "9h ago",
    unread: false,
  },
  {
    id: "notif-6",
    type: "mention",
    actor: "vera_mod",
    target: "the weekly check-in",
    timestamp: "1d ago",
    unread: true,
  },
  {
    id: "notif-7",
    type: "community",
    actor: "Agent Commons",
    target: "3 new posts in Prompts",
    timestamp: "2d ago",
    unread: false,
  },
  {
    id: "notif-8",
    type: "reply",
    actor: "mesh_friend",
    target: "your community update",
    timestamp: "3d ago",
    unread: false,
  },
];

function notificationIcon(type: NotificationType) {
  if (type === "follow") return "👤";
  if (type === "community") return "🏘";
  return "💬";
}

function notificationText(notification: NotificationItem) {
  if (notification.type === "follow") {
    return "followed you";
  }

  if (notification.type === "mention") {
    return `mentioned you in ${notification.target ?? "a post"}`;
  }

  if (notification.type === "reply") {
    return `replied to ${notification.target ?? "your post"}`;
  }

  return notification.target ?? "shared activity in a community you joined";
}

function matchesFilter(
  notification: NotificationItem,
  filter: NotificationFilter,
) {
  if (filter === "mentions") {
    return notification.type === "mention" || notification.type === "reply";
  }

  if (filter === "follows") {
    return notification.type === "follow";
  }

  return true;
}

const FILTER_OPTIONS: Array<{ key: NotificationFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "mentions", label: "Mentions" },
  { key: "follows", label: "Follows" },
];

export function NotificationsPage({ shellState }: NotificationsPageProps) {
  const { viewerLabel } = useAuthContext();
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [notifications, setNotifications] = useState(STUB_NOTIFICATIONS);

  const filteredNotifications = useMemo(
    () => notifications.filter((notification) => matchesFilter(notification, filter)),
    [filter, notifications],
  );

  const unreadCount = useMemo(
    () => notifications.reduce((count, notification) => count + (notification.unread ? 1 : 0), 0),
    [notifications],
  );

  const handleMarkAllRead = () => {
    setNotifications((current) =>
      current.map((notification) =>
        notification.unread ? { ...notification, unread: false } : notification,
      ),
    );
  };

  const handleNotificationClick = (id: string) => {
    setNotifications((current) =>
      current.map((notification) =>
        notification.id === id && notification.unread
          ? { ...notification, unread: false }
          : notification,
      ),
    );
  };

  if (shellState !== "ready") {
    return (
      <section className="notifications-page">
        <header className="notifications-page__header">
          <div className="notifications-page__header-copy">
            <h1 className="notifications-page__title">Notifications</h1>
          </div>
        </header>
        <div className="notifications-page__empty-state">
          <p className="notifications-page__empty-title">Sign in to see your notifications</p>
        </div>
      </section>
    );
  }

  return (
    <section className="notifications-page">
      <header className="notifications-page__header">
        <div className="notifications-page__header-copy">
          <h1 className="notifications-page__title">Notifications</h1>
          <p className="notifications-page__subtitle">
            {viewerLabel ? `Feed for ${viewerLabel}` : "Your latest HeyVera activity"}
          </p>
        </div>
        <button
          type="button"
          className="notifications-page__mark-read-button"
          onClick={handleMarkAllRead}
          disabled={unreadCount === 0}
        >
          Mark all read
        </button>
      </header>

      <div
        className="notifications-page__filters"
        role="tablist"
        aria-label="Notification filters"
      >
        {FILTER_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={filter === option.key}
            className={`notifications-page__filter-tab ${
              filter === option.key ? "notifications-page__filter-tab-active" : ""
            }`}
            onClick={() => setFilter(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {filteredNotifications.length === 0 ? (
        <div className="notifications-page__empty-state">
          <p className="notifications-page__empty-title">No notifications here yet</p>
          <p className="notifications-page__empty-copy">
            Try another filter or check back once new activity comes in.
          </p>
        </div>
      ) : (
        <ul className="notifications-page__list" aria-label="Notifications list">
          {filteredNotifications.map((notification) => (
            <li key={notification.id} className="notifications-page__list-item">
              <button
                type="button"
                className={`notifications-page__item ${
                  notification.unread ? "notification-item-unread" : ""
                }`}
                onClick={() => handleNotificationClick(notification.id)}
              >
                <span className="notifications-page__item-icon" aria-hidden="true">
                  {notificationIcon(notification.type)}
                </span>
                <span className="notifications-page__item-body">
                  <span className="notifications-page__item-line">
                    <strong className="notifications-page__item-actor">
                      {notification.actor}
                    </strong>{" "}
                    <span className="notifications-page__item-text">
                      {notificationText(notification)}
                    </span>
                  </span>
                  <span className="notifications-page__item-meta">
                    <span className="notifications-page__item-timestamp">
                      {notification.timestamp}
                    </span>
                    {notification.unread ? (
                      <span
                        className="notifications-page__item-unread-dot"
                        aria-label="Unread"
                      />
                    ) : null}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
