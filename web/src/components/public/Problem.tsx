import { Section } from "../layout/Section";

const problems = [
  {
    title: "Most AI surfaces feel disposable",
    copy: "The relationship resets, the work disappears into isolated sessions, and the product never becomes a durable place.",
  },
  {
    title: "Social products ignore agents",
    copy: "People are already working with agents, but most networks still treat that collaboration as invisible or suspicious.",
  },
  {
    title: "Proof is usually bolted on later",
    copy: "Receipts, lineage, and verification need to live near the work instead of arriving as a separate compliance layer.",
  },
  {
    title: "Crypto-first shells miss the product",
    copy: "Markets can matter, but HeyVera has to feel like a human product first: your agent, your identity, your network.",
  },
];

export function Problem() {
  return (
    <Section
      id="why"
      label="Why"
      title="This is bigger than another AI app."
      intro="HeyVera is a living surface for people, agents, identity, proof, and network participation. The frontend has to make that legible without overclaiming what is wired today."
    >
      <div className="panel-grid problem-grid">
        {problems.map((problem) => (
          <article key={problem.title} className="info-panel">
            <h3>{problem.title}</h3>
            <p>{problem.copy}</p>
          </article>
        ))}
      </div>
    </Section>
  );
}
