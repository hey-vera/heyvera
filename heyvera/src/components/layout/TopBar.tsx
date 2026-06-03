import {
  Bot,
  ChevronDown,
  Coins,
  Compass,
  Feather,
  Home,
  Mail,
  PlaySquare,
  Radio,
  Search,
  Settings,
  Store,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { AuthControls } from "../shared/AuthControls";

interface TopBarProps {
  activeRoute: string;
  onNavigate: (route: string) => void;
  onCompose: () => void;
  onProfileClick?: () => void;
}

const socialNav: ReadonlyArray<{ label: string; route: string; icon: LucideIcon }> = [
  { label: "Home", route: "/home", icon: Home },
  { label: "Explore", route: "/explore", icon: Compass },
  { label: "Videos", route: "/videos", icon: PlaySquare },
  { label: "Live", route: "/live", icon: Radio },
  { label: "Communities", route: "/communities", icon: Users },
  { label: "Messages", route: "/messages", icon: Mail },
  { label: "AI", route: "/ai", icon: Bot },
];

const productAreas: ReadonlyArray<{ label: string; state: string; icon: LucideIcon }> = [
  { label: "Social", state: "Active", icon: Users },
  { label: "Crypto", state: "Planned", icon: Coins },
  { label: "Marketplace", state: "Planned", icon: Store },
  { label: "AI Agents", state: "Available", icon: Bot },
];

function isRouteActive(activeRoute: string, route: string): boolean {
  if (route === "/videos") return activeRoute === "/videos" || activeRoute === "/longform";
  return activeRoute === route;
}

export function TopBar({ activeRoute, onNavigate, onCompose, onProfileClick }: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

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
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="flex h-10 items-center gap-2 rounded-full px-2.5 text-[15px] font-black transition-colors hover-overlay sm:px-3"
            style={{ color: "var(--text-primary)" }}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
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

          {menuOpen && (
            <div
              className="absolute left-0 top-12 w-64 overflow-hidden rounded-xl border shadow-xl"
              style={{ backgroundColor: "var(--bg-primary)", borderColor: "var(--border-primary)" }}
              role="menu"
            >
              {productAreas.map(({ label, state, icon: Icon }) => {
                const active = label === "Social";
                return (
                  <button
                    key={label}
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover-overlay"
                    onClick={() => {
                      setMenuOpen(false);
                      if (label === "Social") onNavigate("/home");
                      if (label === "AI Agents") onNavigate("/ai");
                    }}
                    disabled={!active && label !== "AI Agents"}
                    style={{ opacity: active || label === "AI Agents" ? 1 : 0.56 }}
                    role="menuitem"
                  >
                    <Icon className="h-5 w-5 shrink-0" style={{ color: "var(--accent)" }} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-bold" style={{ color: "var(--text-primary)" }}>
                        {label}
                      </span>
                      <span className="block text-[13px]" style={{ color: "var(--text-secondary)" }}>
                        {state}
                      </span>
                    </span>
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

        <div className="hidden shrink-0 items-center gap-2 md:flex">
          <button
            type="button"
            onClick={() => onNavigate("/explore")}
            className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover-overlay"
            aria-label="Search"
            style={{ color: "var(--text-secondary)" }}
          >
            <Search className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onCompose}
            className="flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-bold"
            style={{ backgroundColor: "var(--accent)", color: "#000" }}
          >
            <Feather className="h-4 w-4" aria-hidden="true" />
            Create
          </button>
          <button
            type="button"
            onClick={() => onNavigate("/settings")}
            className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover-overlay"
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
