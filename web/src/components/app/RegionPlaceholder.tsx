import type { AppRegion } from "./BottomRegionNav";

type RegionPlaceholderSection = {
  label: string;
  items: string[];
};

type RegionPlaceholderProps = {
  region: AppRegion;
  title: string;
  intro: string;
  sections: RegionPlaceholderSection[];
};

export function RegionPlaceholder({
  region,
  title,
  intro,
  sections,
}: RegionPlaceholderProps) {
  return (
    <div className="region-placeholder">
      <div className="region-intro-card">
        <p className="region-intro-kicker">{region}</p>
        <h1 className="region-intro-title">{title}</h1>
        <p className="region-intro-copy">{intro}</p>
      </div>

      <div className="region-placeholder-grid">
        {sections.map((section) => (
          <section key={section.label} className="region-placeholder-card">
            <p className="region-summary-label">{section.label}</p>
            <ul className="region-placeholder-list">
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
