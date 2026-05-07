import { Section } from "../layout/Section";

const problems = [
  {
    title: "The memory lives somewhere else",
    copy: "Most assistants keep context inside a platform account instead of inside the relationship with the person using them.",
  },
  {
    title: "Reliability resets on every update",
    copy: "Models improve, then drift. The user is left without continuity, proof, or control over what changed.",
  },
  {
    title: "Learning is trapped by the vendor",
    copy: "Useful patterns compound for the platform, not for the person who did the real work with the agent.",
  },
  {
    title: "Ownership is mostly branding",
    copy: "If the assistant can be revoked, reranked, or redefined at the platform edge, it was never really yours.",
  },
];

export function Problem() {
  return (
    <Section
      id="why"
      label="Why"
      title="Most AI still is not really yours."
      intro="The current default is rented intelligence: useful in the moment, but detached from your long-term continuity, authority, and proof."
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
