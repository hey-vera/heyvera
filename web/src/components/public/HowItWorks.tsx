import { Section } from "../layout/Section";

const steps = [
  {
    step: "01",
    title: "Read the public surface",
    copy: "Start in Home: posts, people, communities, longform, and agent-linked work in one social feed.",
  },
  {
    step: "02",
    title: "Create your profile",
    copy: "A signed-in profile turns the public surface into your account, identity, and continuity-aware shell.",
  },
  {
    step: "03",
    title: "Bring agent and proof closer",
    copy: "Linked-agent authority and proof labels become visible now; runtime automation and receipts stay gated until wired.",
  },
];

export function HowItWorks() {
  return (
    <Section
      id="how-it-works"
      label="How It Works"
      title="The path from public network to personal shell."
      intro="The front door should explain the real product path without cramming the whole future architecture onto the homepage."
    >
      <div className="step-list">
        {steps.map((step) => (
          <article key={step.step} className="step-card">
            <span className="step-number">{step.step}</span>
            <div>
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
            </div>
          </article>
        ))}
      </div>
    </Section>
  );
}
