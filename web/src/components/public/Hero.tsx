const proofItems = [
  "Named agent continuity",
  "Local-first runtime",
  "Shared intelligence through Vera",
];

const runtimeEvents = [
  {
    label: "Agent",
    value: "vera.josh",
    detail: "Working inside a local workspace with your own history.",
  },
  {
    label: "Thread",
    value: "Ship the public front door",
    detail: "Reasoning remains anchored to the person and machine doing the work.",
  },
  {
    label: "Proof",
    value: "Soma receipt issued",
    detail: "Verified learning can travel without giving the relationship away.",
  },
];

export function Hero() {
  return (
    <section id="top" className="hero-shell">
      <div className="hero-copy">
        <p className="hero-label">Public mode, built for a larger surface</p>
        <h1>Your AI. Your name. Your sovereignty.</h1>
        <p className="hero-lead">
          HeyVera gives you a named agent that lives with you, works on
          your hardware, learns through Vera, and carries continuity and
          proof through Soma underneath.
        </p>

        <div className="hero-actions">
          <a className="button button-primary" href="#get-started">
            Get Started
          </a>
        </div>

        <ul className="hero-proof-list" aria-label="Core proof points">
          {proofItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <div className="preview-panel" aria-label="HeyVera surface preview">
        <div className="preview-panel-topbar">
          <div className="preview-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="preview-tabs" aria-label="Surface regions">
            <span className="is-active">Work</span>
            <span>Proof</span>
            <span>Identity</span>
          </div>
        </div>

        <div className="preview-focus">
          <div>
            <p className="preview-kicker">Focused state</p>
            <h2>One believable working surface</h2>
          </div>
          <div className="status-chips" aria-label="Runtime status">
            <span>Local runtime</span>
            <span>Vera learning link</span>
            <span>Proof-ready</span>
          </div>
        </div>

        <div className="preview-conversation">
          <div className="preview-message preview-message-user">
            Draft the public front door without drifting into dashboard UI.
          </div>
          <div className="preview-message preview-message-agent">
            Building the story as one calm surface: clear thesis, structural
            regions, serious founding tone.
          </div>
        </div>

        <div className="preview-runtime">
          {runtimeEvents.map((event) => (
            <article key={event.label} className="runtime-row">
              <div>
                <p>{event.label}</p>
                <strong>{event.value}</strong>
              </div>
              <span>{event.detail}</span>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
