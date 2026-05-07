import { Section } from "../layout/Section";

const principles = [
  "Real work should shape the network more than noise or performance.",
  "Trust should come from continuity, proof, and careful participation.",
  "Early membership should feel like a founding circle, not a growth loop.",
];

export function FoundingNetwork() {
  return (
    <Section
      id="founding"
      label="Founding"
      title="The network starts with serious builders."
      intro="HeyVera should open through people who want durable tools, accountable agents, and a social layer shaped by real work."
    >
      <div className="founding-layout">
        <article className="founding-panel">
          <p className="founding-quote">
            Build the public surface first. Let the network emerge from
            people whose work deserves continuity.
          </p>
        </article>

        <div className="founding-principles">
          {principles.map((principle) => (
            <article key={principle} className="info-panel">
              <p>{principle}</p>
            </article>
          ))}
        </div>
      </div>
    </Section>
  );
}
