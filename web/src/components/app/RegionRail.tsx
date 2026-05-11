import { AuthBarSafe } from "../shared/AuthBarSafe";
import { ThemeToggle } from "../public/ThemeToggle";
import type { AppRegion } from "./BottomRegionNav";
import type { ShellState } from "../../hooks/useShellState";

const regionDefs: Array<{ id: AppRegion; label: string; detail: string }> = [
  { id: "home", label: "Home", detail: "Orientation" },
  { id: "agent", label: "Agent", detail: "Quiet work mode" },
  { id: "network", label: "Network", detail: "People + agents" },
  { id: "market", label: "Market", detail: "Launches and work" },
  { id: "proof", label: "Proof", detail: "Trust and lineage" },
  { id: "identity", label: "Identity", detail: "Continuity and authority" },
];

type RegionRailProps = {
  activeRegion: AppRegion;
  onChange: (region: AppRegion) => void;
  shellState: ShellState;
  viewerLabel: string | null;
};

function shellStateLabel(shellState: ShellState) {
  if (shellState === "public") return "Public preview mode";
  if (shellState === "signed_out") return "Sign in to unlock your shell";
  if (shellState === "loading") return "Loading signed-in identity";
  if (shellState === "profile_missing") return "Create your profile to continue";
  return "Signed-in shell active";
}

export function RegionRail({
  activeRegion,
  onChange,
  shellState,
  viewerLabel,
}: RegionRailProps) {
  return (
    <aside className="region-rail">
      <a className="region-rail-wordmark" href="#top" aria-label="HeyVera home">
        <span className="region-rail-wordmark-badge">HV</span>
        <span className="region-rail-wordmark-copy">
          <strong>HeyVera</strong>
          <span>Sovereign life surface</span>
        </span>
      </a>

      <AuthBarSafe />

      <nav className="region-rail-nav" aria-label="Signed-in app regions">
        {regionDefs.map((region) => (
          <button
            key={region.id}
            type="button"
            className={`region-rail-item${activeRegion === region.id ? " region-rail-item-active" : ""}`}
            onClick={() => onChange(region.id)}
            aria-current={activeRegion === region.id ? "page" : undefined}
          >
            <span className="region-rail-item-label">{region.label}</span>
            <span className="region-rail-item-detail">{region.detail}</span>
          </button>
        ))}
      </nav>

      <div className="region-rail-footer">
        <ThemeToggle />
        <div className="region-rail-identity">
          <strong className="region-rail-identity-name">
            {viewerLabel ?? "Vera guest"}
          </strong>
          <span className="region-rail-identity-state">
            {shellStateLabel(shellState)}
          </span>
        </div>
        <div className="region-rail-status">
          <div className="region-rail-status-row">
            <span className="region-rail-status-dot" aria-hidden="true" />
            <span>Home, Network, and Identity ready now</span>
          </div>
          <div className="region-rail-status-row">
            <span className="region-rail-status-dot" aria-hidden="true" />
            <span>Agent, Market, and Proof waiting on contracts</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
