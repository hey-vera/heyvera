
import {
  Bell,
  Bookmark,
  CircleEllipsis,
  Home,
  Mail,
  Search,
  Sparkles,
  User,
  Users,
  Feather,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AuthControls } from "../shared/AuthControls";

interface LeftNavProps {
  activeRoute: string;
  onNavigate: (route: string) => void;
  onCompose: () => void;
}

const navItems: ReadonlyArray<{ label: string; icon: LucideIcon; route: string }> = [
  { label: "Home", icon: Home, route: "/home" },
  { label: "Explore", icon: Search, route: "/explore" },
  { label: "Notifications", icon: Bell, route: "/notifications" },
  { label: "Messages", icon: Mail, route: "/messages" },
  { label: "Bookmarks", icon: Bookmark, route: "/bookmarks" },
  { label: "Communities", icon: Users, route: "/communities" },
  { label: "Premium", icon: Sparkles, route: "/premium" },
  { label: "Profile", icon: User, route: "/profile" },
  { label: "More", icon: CircleEllipsis, route: "" },
];

function HeyVeraLogo() {
  return (
    <div
      className="w-12 h-12 rounded-full flex items-center justify-center text-xl font-black select-none"
      style={{ backgroundColor: "var(--accent)", color: "#000" }}
      aria-label="HeyVera home"
    >
      HV
    </div>
  );
}

export function LeftNav({ activeRoute, onNavigate, onCompose }: LeftNavProps) {
  return (
    <nav
      className="fixed top-0 left-0 z-40 hidden h-full w-[88px] flex-col overflow-y-auto lg:left-[max(0px,calc((100vw-978px)/2))] xl:left-[max(0px,calc((100vw-1225px)/2))] xl:w-[275px] sm:flex"
      style={{
        paddingLeft: "12px",
        paddingRight: "12px",
        backgroundColor: "var(--bg-primary)",
      }}
    >
      {/* Inner container: icon-only at xl- range (1024-1279), full labels at xl+ */}
      <div className="flex flex-col h-full xl:items-start items-center pt-2 pb-4">

        {/* Logo */}
        <button
          onClick={() => onNavigate("/")}
          className="p-3 rounded-full transition-colors hover:bg-white/10 mb-1"
          aria-label="HeyVera"
        >
          <HeyVeraLogo />
        </button>

        {/* Nav items */}
        <div className="flex flex-col w-full gap-0.5 mt-1">
          {navItems.map((item) => {
            const isActive = item.route !== "" && activeRoute === item.route;
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                onClick={() => {
                  if (item.route) onNavigate(item.route);
                }}
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
                className="flex items-center gap-4 px-3 py-3 rounded-full transition-colors hover:bg-white/10 w-full xl:w-auto"
                style={{
                  color: "var(--text-primary)",
                  fontWeight: isActive ? 700 : 400,
                }}
              >
                <Icon className="h-6 w-6 flex-shrink-0" strokeWidth={isActive ? 2.6 : 2} aria-hidden="true" />

                {/* Label: hidden below xl breakpoint */}
                <span className="hidden xl:block text-xl leading-tight">
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Post button */}
        <div className="mt-4 w-full flex xl:block justify-center">
          {/* Full-width pill at xl+ */}
          <button
            onClick={onCompose}
            className="hidden xl:flex w-full items-center justify-center rounded-full py-3 px-6 text-base font-bold transition-colors"
            style={{
              backgroundColor: "var(--accent)",
              color: "#000",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.backgroundColor =
                "var(--accent-hover)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.backgroundColor =
                "var(--accent)")
            }
          >
            Post
          </button>

          {/* Circular icon button at lg (1024-1279px) */}
          <button
            onClick={onCompose}
            aria-label="Compose post"
            className="xl:hidden w-14 h-14 rounded-full flex items-center justify-center text-2xl font-bold transition-colors"
            style={{
              backgroundColor: "var(--accent)",
              color: "#000",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.backgroundColor =
                "var(--accent-hover)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.backgroundColor =
                "var(--accent)")
            }
          >
            <Feather className="h-6 w-6" strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        <AuthControls variant="desktop" onProfile={() => onNavigate("/profile")} />
      </div>
    </nav>
  );
}
