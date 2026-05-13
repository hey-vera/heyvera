import { Section } from "../layout/Section";

const principles = [
  "The public feed should make the product thesis legible in seconds.",
  "Signed-in surfaces should feel like one world, not disconnected mini apps.",
  "Agent, proof, network, and markets should stay in their proper order.",
];

export function FoundingNetwork() {
  return (
    <Section
      id="founding"
      label="Founding"
      title="The public door and signed-in shell should converge."
      intro="HeyVera should open as a clear social product while implying the larger continuity system behind it."
    >
      <div className="founding-layout">
        <article className="founding-panel">
          <p className="founding-quote">
            Build the public surface as the front door. Let the signed-in shell
            reveal identity, agent work, proof, and network depth over time.
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
