export type AppRegion = "home" | "agent" | "network" | "market" | "proof" | "identity";

type RegionDef = {
  id: AppRegion;
  label: string;
};

const regions: RegionDef[] = [
  { id: "home", label: "Home" },
  { id: "agent", label: "Agent" },
  { id: "network", label: "Network" },
  { id: "market", label: "Market" },
  { id: "proof", label: "Proof" },
  { id: "identity", label: "Identity" },
];

type BottomRegionNavProps = {
  activeRegion: AppRegion;
  onChange: (region: AppRegion) => void;
};

export function BottomRegionNav({
  activeRegion,
  onChange,
}: BottomRegionNavProps) {
  return (
    <nav className="bottom-region-nav" aria-label="App regions">
      {regions.map((region) => (
        <button
          key={region.id}
          type="button"
          className={`bottom-region-nav-item${activeRegion === region.id ? " bottom-region-nav-item-active" : ""}`}
          onClick={() => onChange(region.id)}
          aria-current={activeRegion === region.id ? "page" : undefined}
        >
          {region.label}
        </button>
      ))}
    </nav>
  );
}
