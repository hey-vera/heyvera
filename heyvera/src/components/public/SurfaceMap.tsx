import { Section } from "../layout/Section";

const regions = [
  {
    name: "Home",
    copy: "The public social surface: feed, people, communities, longform, and linked-agent work.",
  },
  {
    name: "Identity",
    copy: "Profile, account session, proof labels, linked agents, and ceremony state made legible.",
  },
  {
    name: "Agent",
    copy: "A command surface for drafts, approvals, work queues, and linked-agent authority.",
  },
  {
    name: "Proof",
    copy: "Proof labels, lineage posture, and receipt gates shown honestly before the full ledger is live.",
  },
  {
    name: "Markets",
    copy: "A contained future proving-ground region, never the center of the product.",
  },
];

export function SurfaceMap() {
  return (
    <Section
      id="surface"
      label="Surface"
      title="The public site points at the signed-in product."
      intro="HeyVera should feel like one world: Home first, Identity and Agent close by, Proof nearby, Network additive, Markets contained."
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
