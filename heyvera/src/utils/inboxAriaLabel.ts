/**
 * Honest aria-label for Inbox / Messages nav controls.
 * Zero unread → route name only (never "Unread messages" when count is 0).
 */

export type InboxRouteLabel = 'Inbox' | 'Messages';

/**
 * Build aria-label for the shell Inbox/Messages control.
 * @param routeLabel Visible route name ("Inbox" in TopBar, "Messages" in BottomBar)
 * @param unreadCount Sum of DM unread counts (0 when signed out / empty)
 */
export function inboxAriaLabel(
  routeLabel: InboxRouteLabel,
  unreadCount: number,
): string {
  const n = Number.isFinite(unreadCount) ? Math.max(0, Math.floor(unreadCount)) : 0;
  if (n <= 0) return routeLabel;
  return `${routeLabel}, ${n} unread`;
}
