import { Section } from "../layout/Section";

const steps = [
  {
    step: "01",
    title: "Name your agent",
    copy: "Start with a real relationship, not a disposable session. The agent should be legible as yours from the beginning.",
  },
  {
    step: "02",
    title: "Work locally",
    copy: "Use your own machine and workspace as the grounded place where memory, tools, and decisions stay coherent.",
  },
  {
    step: "03",
    title: "Contribute verified learning",
    copy: "Useful patterns can travel through Vera while Soma carries the continuity and proof that keep them trustworthy.",
  },
];

export function HowItWorks() {
  return (
    <Section
      id="how-it-works"
      label="How It Works"
      title="A simple loop, built on stronger foundations."
      intro="The experience should feel direct to the user even when the technical substrate underneath is unusually serious."
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
