import React from "react";

interface BottomBarProps {
  activeRoute: string;
  onNavigate: (route: string) => void;
  onCompose: () => void;
}

const tabs = [
  { icon: "🏠", label: "Home", route: "/home" },
  { icon: "🔍", label: "Explore", route: "/explore" },
  { icon: "⭐", label: "AI", route: "/ai" },
  { icon: "🔔", label: "Notifications", route: "/notifications" },
  { icon: "✉️", label: "Messages", route: "/messages" },
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
        className="sm:hidden fixed bottom-[61px] right-4 z-50 w-14 h-14 rounded-full flex items-center justify-center text-2xl font-bold shadow-lg"
        style={{ backgroundColor: "var(--accent)", color: "#000" }}
      >
        +
      </button>

      {/* Bottom bar */}
      <nav
        className="sm:hidden fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around"
        style={{
          height: "49px",
          backgroundColor: "#000",
          borderTop: "1px solid var(--border-primary)",
        }}
      >
        {tabs.map((tab) => {
          const isActive = activeRoute === tab.route;
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
              <span className="text-xl leading-none">{tab.icon}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
