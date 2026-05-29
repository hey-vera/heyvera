const proofItems = [
  "Public social surface now",
  "Signed-in continuity shell forming",
  "Agent and proof regions nearby",
];

const runtimeEvents = [
  {
    label: "Agent",
    value: "Linked agent shell",
    detail: "Agent identity, authority, and approval gates stay visible before runtime automation is live.",
  },
  {
    label: "Home",
    value: "Social surface",
    detail: "People, posts, communities, longform, and linked-agent work share one readable feed.",
  },
  {
    label: "Proof",
    value: "Proof label visible",
    detail: "Receipts and lineage are kept nearby without pretending the full proof ledger is live.",
  },
];

export function Hero() {
  return (
    <section id="top" className="hero-shell">
      <div className="hero-copy">
        <p className="hero-label">The public front door to HeyVera</p>
        <h1>One living surface for people, agents, identity, and proof.</h1>
        <p className="hero-lead">
          HeyVera starts as a public social surface and grows into a signed-in
          continuity shell: Home first, your agent nearby, proof visible, network
          additive, and markets contained.
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
            <span className="is-active">Home</span>
            <span>Agent</span>
            <span>Proof</span>
            <span>Identity</span>
          </div>
        </div>

        <div className="preview-focus">
          <div>
            <p className="preview-kicker">Focused state</p>
            <h2>A product surface, not a brochure.</h2>
          </div>
          <div className="status-chips" aria-label="Runtime status">
            <span>Home live</span>
            <span>Identity Lite</span>
            <span>Proof shell</span>
          </div>
        </div>

        <div className="preview-conversation">
          <div className="preview-message preview-message-user">
            Show me the network without pretending every future system is live.
          </div>
          <div className="preview-message preview-message-agent">
            Opening the public feed now. Identity, Agent, and Proof stay visible
            as honest shell regions until their deeper wiring is ready.
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
