export type Tab = "home" | "socials" | "proof" | "market";

type TabDef = {
  id: Tab;
  label: string;
  disabled?: boolean;
};

const tabs: TabDef[] = [
  { id: "home", label: "Home" },
  { id: "socials", label: "Socials", disabled: true },
  { id: "proof", label: "Proof", disabled: true },
  { id: "market", label: "Market", disabled: true },
];

type TabBarProps = {
  active: Tab;
  onChange: (tab: Tab) => void;
};

export function TabBar({ active, onChange }: TabBarProps) {
  return (
    <nav className="tab-bar" aria-label="Page navigation">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`tab-bar-item${active === tab.id ? " tab-bar-item-active" : ""}${tab.disabled ? " tab-bar-item-disabled" : ""}`}
          onClick={tab.disabled ? undefined : () => onChange(tab.id)}
          aria-current={active === tab.id ? "page" : undefined}
          aria-disabled={tab.disabled}
          title={tab.disabled ? "Coming soon" : undefined}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
