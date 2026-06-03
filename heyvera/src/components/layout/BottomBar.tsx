
import {
  Feather,
  Home,
  Mail,
  PlaySquare,
  Radio,
  Search,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

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
  return (
    <>
      {/* Spacer so content isn't hidden behind the bar */}
      <div className="h-[49px] sm:hidden" aria-hidden="true" />

      {/* FAB compose button */}
      <button
        onClick={onCompose}
        aria-label="Compose post"
        className="sm:hidden fixed bottom-[calc(61px+env(safe-area-inset-bottom))] right-4 z-50 w-14 h-14 rounded-full flex items-center justify-center text-2xl font-bold shadow-lg"
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
          return (
            <button
              key={tab.route}
              onClick={() => onNavigate(tab.route)}
              aria-label={tab.label}
              aria-current={isActive ? "page" : undefined}
              className="flex flex-col items-center justify-center flex-1 h-full transition-opacity"
              style={{
                color: isActive ? "var(--accent)" : "var(--text-primary)",
                opacity: isActive ? 1 : 0.8,
              }}
            >
              <Icon className="h-6 w-6" strokeWidth={isActive ? 2.6 : 2} aria-hidden="true" />
            </button>
          );
        })}
      </nav>
    </>
  );
}
