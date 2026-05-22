import React from "react";

interface TopBarProps {
  title?: string;
  showAvatar?: boolean;
  onAvatarClick?: () => void;
}

export function TopBar({
  title = "HeyVera",
  showAvatar = true,
  onAvatarClick,
}: TopBarProps) {
  return (
    <header
      className="lg:hidden sticky top-0 z-30 flex items-center justify-between px-4"
      style={{
        height: "53px",
        backgroundColor: "rgba(0,0,0,0.8)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--border-primary)",
      }}
    >
      {/* Left: user avatar */}
      <div className="w-8">
        {showAvatar && (
          <button
            onClick={onAvatarClick}
            aria-label="Account"
            className="w-8 h-8 rounded-full overflow-hidden focus:outline-none focus:ring-2"
            style={{ focusRingColor: "var(--accent)" } as React.CSSProperties}
          >
            <div
              className="w-full h-full rounded-full flex items-center justify-center text-sm font-semibold"
              style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text-secondary)" }}
            >
              U
            </div>
          </button>
        )}
      </div>

      {/* Center: brand */}
      <span
        className="text-base font-bold tracking-tight select-none"
        style={{ color: "var(--text-primary)" }}
      >
        {title}
      </span>

      {/* Right: settings / context icon */}
      <button
        aria-label="Settings"
        className="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
        style={{ color: "var(--text-secondary)" }}
      >
        {/* Gear icon (inline SVG) */}
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </header>
  );
}
