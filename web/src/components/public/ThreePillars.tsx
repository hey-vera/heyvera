import { Section } from "../layout/Section";

const pillars = [
  {
    title: "Own the agent",
    copy: "Give the relationship a name, a home, and a working memory that belongs to the person who depends on it.",
  },
  {
    title: "Learn through Vera",
    copy: "Let useful patterns improve through shared intelligence without collapsing everything into a remote black box.",
  },
  {
    title: "Prove through Soma",
    copy: "Carry identity, legitimacy, and receipts underneath the experience so trust is not just a promise.",
  },
];

export function ThreePillars() {
  return (
    <Section
      label="Pillars"
      title="Three anchors hold the surface together."
      intro="HeyVera should feel simple from the outside while still resting on a serious technical worldview."
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
