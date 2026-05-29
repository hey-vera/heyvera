import { useCallback, useMemo, useState } from "react";
import {
  Routes,
  Route,
  Navigate,
  NavLink,
  Outlet,
} from "react-router-dom";
import { useAuthContext } from "../../hooks/useAuthContext";
import type { ShellState } from "../../hooks/useShellState";

type SettingsPageProps = {
  shellState: ShellState;
};

type SettingsNavItem = {
  key: string;
  label: string;
};

type ToggleRowProps = {
  label: string;
  detail: string;
  checked: boolean;
  onChange: () => void;
};

const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { key: "account", label: "Account" },
  { key: "display", label: "Display" },
  { key: "notifications", label: "Notifications" },
  { key: "privacy", label: "Privacy" },
  { key: "accessibility", label: "Accessibility" },
];

function formatStateLabel(value: string | null | undefined) {
  if (!value) return "Unavailable";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function shellStateLabel(shellState: ShellState) {
  if (shellState === "public") return "Public preview";
  if (shellState === "signed_out") return "Signed out";
  if (shellState === "loading") return "Loading";
  if (shellState === "profile_missing") return "Profile needed";
  return "Ready";
}

function NotLiveChip() {
  return <span className="settings-chip settings-chip-muted">Not live yet</span>;
}

function ToggleRow({ label, detail, checked, onChange }: ToggleRowProps) {
  return (
    <div className="settings-toggle-row">
      <div className="settings-toggle-copy">
        <div className="settings-toggle-heading-row">
          <strong className="settings-toggle-label">{label}</strong>
          <NotLiveChip />
        </div>
        <p className="settings-toggle-detail">{detail}</p>
      </div>
      <button
        type="button"
        className={`settings-toggle ${checked ? "settings-toggle-active" : ""}`}
        aria-pressed={checked}
        onClick={onChange}
      >
        <span className="settings-toggle-knob" />
      </button>
    </div>
  );
}

function SettingsNav() {
  return (
    <>
      <nav className="settings-mobile-nav" aria-label="Settings sections">
        {SETTINGS_NAV_ITEMS.map((item) => (
          <NavLink
            key={`mobile-${item.key}`}
            to={item.key}
            className={({ isActive }) =>
              `settings-mobile-link ${isActive ? "settings-mobile-link-active" : ""}`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <aside className="settings-sidebar">
        <div className="settings-sidebar-header">
          <h1 className="settings-sidebar-title">Settings</h1>
          <p className="settings-sidebar-copy">Manage your HeyVera shell.</p>
        </div>

        <nav className="settings-sidebar-nav" aria-label="Settings sections">
          {SETTINGS_NAV_ITEMS.map((item) => (
            <NavLink
              key={item.key}
              to={item.key}
              className={({ isActive }) =>
                `settings-sidebar-link ${isActive ? "settings-sidebar-link-active" : ""}`
              }
            >
              <span className="settings-sidebar-link-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}

function SettingsLayout({ shellState }: SettingsPageProps) {
  return (
    <div className="settings-page">
      <div className="settings-shell">
        <SettingsNav />

        <section className="settings-panel">
          <header className="settings-panel-header">
            <p className="settings-panel-eyebrow">HeyVera</p>
            <p className="settings-panel-state">{shellStateLabel(shellState)}</p>
          </header>

          <div className="settings-panel-body">
            <Outlet />
          </div>
        </section>
      </div>
    </div>
  );
}

function AccountSection() {
  const { myProfile, myProfileLoading, viewerLabel } = useAuthContext();
  const profile = myProfile?.profile ?? null;

  return (
    <section className="settings-section settings-section-account">
      <header className="settings-section-header">
        <h2 className="settings-section-title">Account</h2>
        <p className="settings-section-copy">Core identity and proof surfaces.</p>
      </header>

      <div className="settings-card-list">
        <div className="settings-card">
          <div className="settings-row">
            <span className="settings-row-label">Handle</span>
            <span className="settings-row-value">
              {myProfileLoading ? "Loading..." : profile ? `@${profile.handle}` : "No profile yet"}
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Email</span>
            <span className="settings-row-value">
              {viewerLabel ?? "Placeholder until account email is exposed here"}
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Continuity state</span>
            <span className="settings-chip settings-chip-accent">
              {profile ? formatStateLabel(profile.continuityState) : "Pending"}
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Proof state</span>
            <span className="settings-chip settings-chip-accent">
              {profile ? formatStateLabel(profile.proofState) : "Pending"}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function DisplaySection() {
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === "undefined") return false;
    const stored = localStorage.getItem("vera-dark-mode");
    if (stored !== null) return stored === "true";
    return document.documentElement.classList.contains("dark");
  });

  const handleDarkModeToggle = useCallback(() => {
    setDarkMode((previous) => {
      const next = !previous;
      if (next) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
      localStorage.setItem("vera-dark-mode", String(next));
      return next;
    });
  }, []);

  return (
    <section className="settings-section settings-section-display">
      <header className="settings-section-header">
        <h2 className="settings-section-title">Display</h2>
        <p className="settings-section-copy">Visual preferences for your shell.</p>
      </header>

      <div className="settings-card-list">
        <div className="settings-card">
          <ToggleRow
            label="Dark mode"
            detail="Uses the same local HeyVera theme preference saved in this browser."
            checked={darkMode}
            onChange={handleDarkModeToggle}
          />
          <div className="settings-row settings-row-stack">
            <div className="settings-row-heading">
              <span className="settings-row-label">Font size</span>
              <NotLiveChip />
            </div>
            <p className="settings-row-detail">Placeholder for compact, default, and large text controls.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function NotificationsSection() {
  const [mentions, setMentions] = useState(true);
  const [follows, setFollows] = useState(true);
  const [replies, setReplies] = useState(true);
  const [communityActivity, setCommunityActivity] = useState(false);

  return (
    <section className="settings-section settings-section-notifications">
      <header className="settings-section-header">
        <h2 className="settings-section-title">Notifications</h2>
        <p className="settings-section-copy">Choose which social signals should reach you.</p>
      </header>

      <div className="settings-card-list">
        <div className="settings-card">
          <ToggleRow
            label="Mentions"
            detail="Placeholder for direct mention alerts."
            checked={mentions}
            onChange={() => setMentions((value) => !value)}
          />
          <ToggleRow
            label="Follows"
            detail="Placeholder for new follower notifications."
            checked={follows}
            onChange={() => setFollows((value) => !value)}
          />
          <ToggleRow
            label="Replies"
            detail="Placeholder for reply and thread activity alerts."
            checked={replies}
            onChange={() => setReplies((value) => !value)}
          />
          <ToggleRow
            label="Community activity"
            detail="Placeholder for community launches, posts, and highlights."
            checked={communityActivity}
            onChange={() => setCommunityActivity((value) => !value)}
          />
        </div>
      </div>
    </section>
  );
}

function PrivacySection() {
  const [profileVisibility, setProfileVisibility] = useState(true);
  const [dmPermissions, setDmPermissions] = useState(false);
  const [blockList, setBlockList] = useState(false);

  return (
    <section className="settings-section settings-section-privacy">
      <header className="settings-section-header">
        <h2 className="settings-section-title">Privacy</h2>
        <p className="settings-section-copy">Control who can see and reach your profile.</p>
      </header>

      <div className="settings-card-list">
        <div className="settings-card">
          <ToggleRow
            label="Profile visibility"
            detail="Placeholder for profile visibility controls."
            checked={profileVisibility}
            onChange={() => setProfileVisibility((value) => !value)}
          />
          <ToggleRow
            label="DM permissions"
            detail="Placeholder for who can send you direct messages."
            checked={dmPermissions}
            onChange={() => setDmPermissions((value) => !value)}
          />
          <ToggleRow
            label="Block list"
            detail="Placeholder for block list review and management."
            checked={blockList}
            onChange={() => setBlockList((value) => !value)}
          />
        </div>
      </div>
    </section>
  );
}

function AccessibilitySection() {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [highContrast, setHighContrast] = useState(false);

  return (
    <section className="settings-section settings-section-accessibility">
      <header className="settings-section-header">
        <h2 className="settings-section-title">Accessibility</h2>
        <p className="settings-section-copy">Placeholders for comfort and readability controls.</p>
      </header>

      <div className="settings-card-list">
        <div className="settings-card">
          <ToggleRow
            label="Reduced motion"
            detail="Placeholder for reducing motion-heavy transitions."
            checked={reducedMotion}
            onChange={() => setReducedMotion((value) => !value)}
          />
          <ToggleRow
            label="High contrast"
            detail="Placeholder for stronger contrast across the interface."
            checked={highContrast}
            onChange={() => setHighContrast((value) => !value)}
          />
        </div>
      </div>
    </section>
  );
}

function SettingsPage({ shellState }: SettingsPageProps) {
  const layoutElement = useMemo(
    () => <SettingsLayout shellState={shellState} />,
    [shellState],
  );

  return (
    <Routes>
      <Route element={layoutElement}>
        <Route index element={<Navigate to="account" replace />} />
        <Route path="account" element={<AccountSection />} />
        <Route path="display" element={<DisplaySection />} />
        <Route path="notifications" element={<NotificationsSection />} />
        <Route path="privacy" element={<PrivacySection />} />
        <Route path="accessibility" element={<AccessibilitySection />} />
        <Route path="*" element={<Navigate to="account" replace />} />
      </Route>
    </Routes>
  );
}

export default SettingsPage;
