import { ThemeToggle } from "./ThemeToggle";
import { AuthBarSafe } from "../shared/AuthBarSafe";

type NavLink = {
  href: string;
  label: string;
};

const navLinks: NavLink[] = [
  { href: "#top", label: "Home" },
  { href: "#feed", label: "Feed" },
  { href: "#people", label: "People" },
  { href: "#agents", label: "Agents" },
  { href: "#communities", label: "Communities" },
  { href: "#pulse", label: "Pulse" },
  { href: "#proof", label: "Proof" },
];

export function LeftRail() {
  return (
    <>
      {/* Desktop left rail */}
      <nav className="left-rail" aria-label="Primary navigation">
        <a className="left-rail-wordmark" href="#top" aria-label="HeyVera home">
          <span className="left-rail-wordmark-badge">HV</span>
          <span className="left-rail-wordmark-text">HeyVera</span>
        </a>

        {/* Auth bar — sign in / user info */}
        <AuthBarSafe />

        <ul className="left-rail-nav" role="list">
          {navLinks.map((link) => (
            <li key={link.label}>
              <a className="left-rail-nav-link" href={link.href}>
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="left-rail-cta">
          <a className="button button-primary left-rail-join" href="#get-started">
            Join Vera
          </a>
        </div>

        <div className="left-rail-bottom">
          <ThemeToggle />

          <div className="left-rail-trust">
            <div className="left-rail-trust-row">
              <span className="left-rail-trust-dot" aria-hidden="true" />
              <span className="left-rail-trust-label">Proof labels visible</span>
            </div>
            <div className="left-rail-trust-row">
              <span className="left-rail-trust-dot" aria-hidden="true" />
              <span className="left-rail-trust-label">Receipts pending contracts</span>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile top nav */}
      <nav className="mobile-top-nav" aria-label="Primary navigation">
        <a className="mobile-nav-wordmark" href="#top" aria-label="HeyVera home">
          <span className="brand-mark-badge">HV</span>
          <strong>HeyVera</strong>
        </a>
        <div className="mobile-nav-links">
          {navLinks.map((link) => (
            <a key={link.label} className="mobile-nav-link" href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
        <AuthBarSafe />
        <ThemeToggle />
        <a className="button button-primary mobile-nav-join" href="#get-started">
          Join Vera
        </a>
      </nav>
    </>
  );
}
