
import {
  Feather,
  Home,
  Mail,
  PlaySquare,
  Radio,
  Search,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { getConversations } from '../../api/social';
import { useAuth } from '../../hooks/useAuth';
import { useVisibilityPoll } from '../../hooks/useVisibilityPoll';
import { inboxAriaLabel } from '../../utils/inboxAriaLabel';

interface BottomBarProps {
  activeRoute: string;
  onNavigate: (route: string) => void;
  onCompose: () => void;
}

const tabs: ReadonlyArray<{ icon: LucideIcon; label: string; route: string }> = [
  { icon: Home, label: "Home", route: "/home" },
  { icon: Search, label: "Explore", route: "/explore" },
  { icon: PlaySquare, label: "Videos", route: "/videos" },
  { icon: Radio, label: "Live", route: "/live" },
  { icon: Mail, label: "Messages", route: "/messages" },
];

export function BottomBar({ activeRoute, onNavigate, onCompose }: BottomBarProps) {
  const { authEnabled, isSignedIn, getToken } = useAuth();
  /** DM unread only — not notification Bell (Wave 9b). */
  const [dmUnreadCount, setDmUnreadCount] = useState(0);

  const pollDmUnread = useCallback(async () => {
    if (!authEnabled || !isSignedIn) {
      setDmUnreadCount(0);
      return;
    }
    try {
      const token = await getToken();
      if (!token) {
        setDmUnreadCount(0);
        return;
      }
      const convos = await getConversations(token);
      const sum = convos.reduce((acc, c) => acc + (c.unread_count ?? 0), 0);
      setDmUnreadCount(sum);
    } catch {
      // quiet poll
    }
  }, [authEnabled, getToken, isSignedIn]);

  useEffect(() => {
    void pollDmUnread();
  }, [pollDmUnread, activeRoute]);

  useVisibilityPoll(pollDmUnread, 30_000, Boolean(authEnabled && isSignedIn), {
    runOnVisible: true,
  });

  return (
    <>
      {/* Spacer so content isn't hidden behind the bar */}
      <div className="h-[49px] sm:hidden" aria-hidden="true" />

      {/* FAB compose button */}
      <button
        type="button"
        onClick={onCompose}
        aria-label="Compose post"
        className="sm:hidden fixed bottom-[calc(61px+env(safe-area-inset-bottom))] right-4 z-50 w-14 h-14 rounded-full flex items-center justify-center text-2xl font-bold shadow-lg focus-visible:outline-none focus-ring"
        style={{ backgroundColor: "var(--accent)", color: "#000" }}
      >
        <Feather className="h-6 w-6" strokeWidth={2.4} aria-hidden="true" />
      </button>

      {/* Bottom bar */}
      <nav
        className="sm:hidden fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around"
        style={{
          height: "calc(49px + env(safe-area-inset-bottom))",
          paddingBottom: "env(safe-area-inset-bottom)",
          backgroundColor: "var(--bg-primary)",
          borderTop: "1px solid var(--border-primary)",
        }}
      >
        {tabs.map((tab) => {
          const isActive = activeRoute === tab.route;
          const Icon = tab.icon;
          const isMessages = tab.route === "/messages";
          // Zero unread → "Messages" only (honest); count when > 0.
          const ariaLabel = isMessages
            ? inboxAriaLabel("Messages", dmUnreadCount)
            : tab.label;
          return (
            <button
              type="button"
              key={tab.route}
              onClick={() => onNavigate(tab.route)}
              aria-label={ariaLabel}
              aria-current={isActive ? "page" : undefined}
              className="relative flex flex-col items-center justify-center flex-1 h-full transition-opacity focus-visible:outline-none focus-ring"
              style={{
                color: isActive ? "var(--accent)" : "var(--text-primary)",
                opacity: isActive ? 1 : 0.8,
              }}
            >
              <span className="relative inline-flex">
                <Icon className="h-6 w-6" strokeWidth={isActive ? 2.6 : 2} aria-hidden="true" />
                {isMessages && dmUnreadCount > 0 && (
                  <span
                    className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none"
                    style={{ backgroundColor: "var(--accent)", color: "#000" }}
                    aria-hidden="true"
                  >
                    {dmUnreadCount > 99 ? "99+" : dmUnreadCount}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
