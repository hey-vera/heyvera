import React from "react";
import { Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";

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
  const navigate = useNavigate();

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between px-4 sm:ml-[88px] sm:w-[calc(100%-88px)] lg:hidden"
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
        onClick={() => navigate("/settings")}
        aria-label="Settings"
        className="w-8 h-8 flex items-center justify-center rounded-full transition-colors hover:bg-white/10"
        style={{ color: "var(--text-secondary)" }}
        type="button"
      >
        <Settings className="h-5 w-5" aria-hidden="true" />
      </button>
    </header>
  );
}
