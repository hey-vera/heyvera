import { Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AuthControls } from "../shared/AuthControls";

interface TopBarProps {
  title?: string;
  showAvatar?: boolean;
  onProfileClick?: () => void;
}

export function TopBar({
  title = "HeyVera",
  showAvatar = true,
  onProfileClick,
}: TopBarProps) {
  const navigate = useNavigate();
  const handleProfileClick = onProfileClick ?? (() => navigate("/profile"));

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between px-4 sm:ml-[88px] sm:w-[calc(100%-88px)] lg:hidden"
      style={{
        height: "53px",
        backgroundColor: "color-mix(in srgb, var(--bg-primary) 80%, transparent)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--border-primary)",
      }}
    >
      {/* Left: auth/account */}
      <div className="min-w-8">
        {showAvatar && (
          <AuthControls variant="mobile" onProfile={handleProfileClick} />
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
        className="w-8 h-8 flex items-center justify-center rounded-full transition-colors hover-overlay"
        style={{ color: "var(--text-secondary)" }}
        type="button"
      >
        <Settings className="h-5 w-5" aria-hidden="true" />
      </button>
    </header>
  );
}
