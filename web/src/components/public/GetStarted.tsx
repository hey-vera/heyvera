import { Section } from "../layout/Section";

export function GetStarted() {
  return (
    <Section
      id="get-started"
      label="Get Started"
      title="Start at the public surface."
      intro="HeyVera should be usable before it asks people to believe the whole future stack. Read the feed, create a profile when ready, and follow the build as the shell deepens."
      className="get-started-shell"
    >
      <div className="cta-panel">
        <p>
          The current product path is public Home first, signed-in profile next,
          then Identity, Agent, and Proof becoming more real over time.
        </p>
        <a
          className="button button-primary"
          href="https://github.com/hey-vera/heyvera"
          target="_blank"
          rel="noreferrer"
        >
          Track the build on GitHub
        </a>
      </div>
    </Section>
  );
}
