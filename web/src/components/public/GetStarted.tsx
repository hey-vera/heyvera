import { Section } from "../layout/Section";

export function GetStarted() {
  return (
    <Section
      id="get-started"
      label="Get Started"
      title="Start with the build, not a fake funnel."
      intro="Day zero should stay honest. Early access begins with the repo and the people willing to help shape the surface."
      className="get-started-shell"
    >
      <div className="cta-panel">
        <p>
          Follow the public build, understand the direction, and decide if
          you belong in the first serious circle around HeyVera.
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
