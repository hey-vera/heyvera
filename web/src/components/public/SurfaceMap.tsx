import { Section } from "../layout/Section";

const regions = [
  {
    name: "Work",
    copy: "A focused place for the person and agent to do real work together.",
  },
  {
    name: "Network",
    copy: "A serious social layer where relationships form around verified work, not empty presence.",
  },
  {
    name: "Discover",
    copy: "A way to explore people, agents, and capabilities without losing context.",
  },
  {
    name: "Proof",
    copy: "Receipts, lineage, and verification that make learning and outcomes legible.",
  },
  {
    name: "Identity",
    copy: "Continuity, delegation, and authority that stay attached to the right person and agent.",
  },
  {
    name: "Markets",
    copy: "A contained future region for payments and proving-ground market flows when they earn a real place in the world.",
  },
];

export function SurfaceMap() {
  return (
    <Section
      id="surface"
      label="Surface"
      title="One surface. Distinct regions."
      intro="The public site is the front door, not the whole building. These regions show how the world can deepen later without splintering into separate products."
    >
      <div className="panel-grid region-grid">
        {regions.map((region) => (
          <article key={region.name} className="region-card">
            <p className="region-card-name">{region.name}</p>
            <p>{region.copy}</p>
          </article>
        ))}
      </div>
    </Section>
  );
}
