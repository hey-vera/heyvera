import { Section } from "../layout/Section";

const pillars = [
  {
    title: "Home first",
    copy: "Make the public social surface immediately understandable before asking people to believe the whole long-term system.",
  },
  {
    title: "Agent nearby",
    copy: "Keep the human-agent relationship visible as work, approvals, and authority become more real.",
  },
  {
    title: "Proof honest",
    copy: "Show proof labels and lineage posture now, while keeping Soma-native receipts clearly marked as pending.",
  },
];

export function ThreePillars() {
  return (
    <Section
      label="Pillars"
      title="Three product anchors hold the surface together."
      intro="HeyVera should feel premium and alive without turning the homepage into an architecture diagram."
    >
      <div className="panel-grid pillar-grid">
        {pillars.map((pillar) => (
          <article key={pillar.title} className="info-panel pillar-card">
            <span className="pillar-index" aria-hidden="true">
              0{pillars.indexOf(pillar) + 1}
            </span>
            <h3>{pillar.title}</h3>
            <p>{pillar.copy}</p>
          </article>
        ))}
      </div>
    </Section>
  );
}
