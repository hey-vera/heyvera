import {
  Bell,
  Bot,
  ChevronDown,
  Compass,
  Feather,
  Film,
  Home,
  Mail,
  PlaySquare,
  Radio,
  Search,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchUnreadNotificationCount } from "../../api/social";
import { useAuth } from "../../hooks/useAuth";
import { useVisibilityPoll } from "../../hooks/useVisibilityPoll";
import { AuthControls } from "../shared/AuthControls";

export type CreateAction = "post" | "video" | "automate";

interface TopBarProps {
  activeRoute: string;
  onNavigate: (route: string) => void;
  onCreateAction: (action: CreateAction) => void;
  onProfileClick?: () => void;
}

/** Social sub-nav (unique labels; not a product switcher). */
const socialNav: ReadonlyArray<{ label: string; route: string; icon: LucideIcon }> = [
  { label: "Network", route: "/home", icon: Home },
  { label: "Discover", route: "/explore", icon: Compass },
  { label: "Watch", route: "/videos", icon: PlaySquare },
  { label: "Live", route: "/live", icon: Radio },
  { label: "Guilds", route: "/communities", icon: Users },
  { label: "Inbox", route: "/messages", icon: Mail },
  { label: "Pulse", route: "/ai", icon: Bot },
];

type ProductArea = {
  label: string;
  state: string;
  icon: LucideIcon;
  navigable: boolean;
  route?: string;
};

/** Product page switcher — Social active; Agents WIP (not a full product page yet). */
const productAreas: ReadonlyArray<ProductArea> = [
  { label: "Social", state: "Active", icon: Users, navigable: true, route: "/home" },
  { label: "Agents", state: "WIP", icon: Bot, navigable: false },
];

const createMenuItems: ReadonlyArray<{
  action: CreateAction;
  label: string;
  detail: string;
  icon: LucideIcon;
}> = [
  { action: "post", label: "Post", detail: "Share text with the network", icon: Feather },
  { action: "video", label: "Video", detail: "Watch surface (preview)", icon: Film },
  { action: "automate", label: "Automate", detail: "Pulse drafts and agent assist", icon: Sparkles },
];

function isRouteActive(activeRoute: string, route: string): boolean {
  if (route === "/videos") return activeRoute === "/videos" || activeRoute === "/longform";
  return activeRoute === route;
}

export function TopBar({ activeRoute, onNavigate, onCreateAction, onProfileClick }: TopBarProps) {
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const [productMenuOpen, setProductMenuOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const productMenuRef = useRef<HTMLDivElement | null>(null);
  const createMenuRef = useRef<HTMLDivElement | null>(null);

  const pollUnread = useCallback(async () => {
    if (!authEnabled || !isSignedIn) {
      setUnreadCount(0);
      return;
    }
    try {
      const token = await getToken();
      if (!token) {
        setUnreadCount(0);
        return;
      }
      const count = await fetchUnreadNotificationCount(token);
      setUnreadCount(count);
    } catch {
      // quiet poll
    }
  }, [authEnabled, getToken, isSignedIn]);

  useEffect(() => {
    void pollUnread();
  }, [pollUnread, activeRoute]);

  useVisibilityPoll(pollUnread, 30_000, Boolean(authEnabled && isSignedIn), {
    runOnVisible: true,
  });

  useEffect(() => {
    if (!productMenuOpen && !createMenuOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (productMenuOpen && productMenuRef.current && !productMenuRef.current.contains(target)) {
        setProductMenuOpen(false);
      }
      if (createMenuOpen && createMenuRef.current && !createMenuRef.current.contains(target)) {
        setCreateMenuOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProductMenuOpen(false);
        setCreateMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [productMenuOpen, createMenuOpen]);

  return (
    <header
      className="sticky top-0 z-40 border-b backdrop-blur-md"
      style={{
        minHeight: "var(--top-bar-height)",
        backgroundColor: "color-mix(in srgb, var(--bg-primary) 88%, transparent)",
        borderColor: "var(--border-primary)",
      }}
    >
      <div className="mx-auto flex min-h-[var(--top-bar-height)] w-full max-w-[1225px] items-center gap-2 px-3 sm:px-4">
        <div className="relative shrink-0" ref={productMenuRef}>
          <button
            type="button"
            onClick={() => {
              setProductMenuOpen((open) => !open);
              setCreateMenuOpen(false);
            }}
            className="flex h-10 items-center gap-2 rounded-full px-2.5 text-[15px] font-black transition-colors hover-overlay sm:px-3"
            style={{ color: "var(--text-primary)" }}
            aria-expanded={productMenuOpen}
            aria-haspopup="menu"
            aria-label="Product switcher"
          >
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-black"
              style={{ backgroundColor: "var(--accent)", color: "#000" }}
              aria-hidden="true"
            >
              HV
            </span>
            <span className="hidden sm:inline">Social</span>
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>

          {productMenuOpen && (
            <div
              className="absolute left-0 top-12 w-64 overflow-hidden rounded-xl border shadow-xl"
              style={{ backgroundColor: "var(--bg-primary)", borderColor: "var(--border-primary)" }}
              role="menu"
              aria-label="Products"
            >
              {productAreas.map(({ label, state, icon: Icon, navigable, route }) => {
                const active = label === "Social";
                const wip = !navigable;
                return (
                  <button
                    key={label}
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover-overlay disabled:cursor-not-allowed"
                    onClick={() => {
                      if (!navigable || !route) return;
                      setProductMenuOpen(false);
                      onNavigate(route);
                    }}
                    disabled={!navigable}
                    style={{ opacity: wip ? 0.45 : 1 }}
                    role="menuitem"
                    aria-disabled={wip || undefined}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon
                      className="h-5 w-5 shrink-0"
                      style={{ color: wip ? "var(--text-secondary)" : "var(--accent)" }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className="block text-[15px] font-bold"
                        style={{ color: wip ? "var(--text-secondary)" : "var(--text-primary)" }}
                      >
                        {label}
                      </span>
                      <span className="block text-[13px]" style={{ color: "var(--text-secondary)" }}>
                        {active ? "Active" : state}
                      </span>
                    </span>
                    {wip && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                        style={{
                          backgroundColor: "var(--border-primary)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        WIP
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1" aria-label="Social navigation">
          {socialNav.map(({ label, route, icon: Icon }) => {
            const active = isRouteActive(activeRoute, route);
            return (
              <button
                key={route}
                type="button"
                onClick={() => onNavigate(route)}
                className="flex h-10 shrink-0 items-center gap-2 rounded-full px-3 text-[14px] font-semibold transition-colors hover-overlay"
                style={{
                  color: active ? "var(--text-primary)" : "var(--text-secondary)",
                  backgroundColor: active ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "transparent",
                }}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-4 w-4" strokeWidth={active ? 2.6 : 2} aria-hidden="true" />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={() => onNavigate("/explore")}
            className="hidden h-10 w-10 items-center justify-center rounded-full transition-colors hover-overlay sm:flex"
            aria-label="Search"
            style={{ color: "var(--text-secondary)" }}
          >
            <Search className="h-5 w-5" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => onNavigate("/notifications")}
            className="relative flex h-10 w-10 items-center justify-center rounded-full transition-colors hover-overlay"
            aria-label={
              unreadCount > 0
                ? `Notifications, ${unreadCount} unread`
                : "Notifications"
            }
            style={{
              color:
                activeRoute === "/notifications"
                  ? "var(--text-primary)"
                  : "var(--text-secondary)",
            }}
          >
            <Bell className="h-5 w-5" aria-hidden="true" />
            {unreadCount > 0 && (
              <span
                className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none"
                style={{ backgroundColor: "var(--accent)", color: "#000" }}
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>

          <div className="relative" ref={createMenuRef}>
            <button
              type="button"
              onClick={() => {
                setCreateMenuOpen((open) => !open);
                setProductMenuOpen(false);
              }}
              className="flex h-10 items-center gap-1.5 rounded-full px-3 text-[14px] font-bold sm:gap-2 sm:px-4"
              style={{ backgroundColor: "var(--accent)", color: "#000" }}
              aria-expanded={createMenuOpen}
              aria-haspopup="menu"
              aria-label="Create"
            >
              <Feather className="h-4 w-4" aria-hidden="true" />
              <span className="hidden xs:inline sm:inline">Create</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-80" aria-hidden="true" />
            </button>

            {createMenuOpen && (
              <div
                className="absolute right-0 top-12 w-72 overflow-hidden rounded-xl border shadow-xl"
                style={{ backgroundColor: "var(--bg-primary)", borderColor: "var(--border-primary)" }}
                role="menu"
                aria-label="Create options"
              >
                {createMenuItems.map(({ action, label, detail, icon: Icon }) => (
                  <button
                    key={action}
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover-overlay"
                    onClick={() => {
                      setCreateMenuOpen(false);
                      onCreateAction(action);
                    }}
                    role="menuitem"
                  >
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                      style={{ backgroundColor: "color-mix(in srgb, var(--accent) 16%, transparent)" }}
                    >
                      <Icon className="h-4 w-4" style={{ color: "var(--accent)" }} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-bold" style={{ color: "var(--text-primary)" }}>
                        {label}
                      </span>
                      <span className="block text-[13px]" style={{ color: "var(--text-secondary)" }}>
                        {detail}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => onNavigate("/settings")}
            className="hidden h-10 w-10 items-center justify-center rounded-full transition-colors hover-overlay sm:flex"
            aria-label="Settings"
            style={{ color: "var(--text-secondary)" }}
          >
            <Settings className="h-5 w-5" aria-hidden="true" />
          </button>

          <AuthControls variant="mobile" onProfile={onProfileClick ?? (() => onNavigate("/profile"))} />
        </div>
      </div>
    </header>
  );
}
