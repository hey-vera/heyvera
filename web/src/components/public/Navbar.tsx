const navLinks = [
  { href: "#feed", label: "Feed" },
  { href: "#surface", label: "Surface" },
  { href: "#why", label: "Why" },
  { href: "#founding", label: "Founding" },
];

export function Navbar() {
  return (
    <header className="site-nav">
      <a className="brand-mark" href="#top" aria-label="HeyVera home">
        <span className="brand-mark-badge">HV</span>
        <span className="brand-mark-copy">
          <strong>HeyVera</strong>
          <span>Public social surface, signed-in shell</span>
        </span>
      </a>

      <nav className="site-nav-links" aria-label="Primary">
        {navLinks.map((link) => (
          <a key={link.href} href={link.href}>
            {link.label}
          </a>
        ))}
      </nav>

      <a className="button button-primary site-nav-cta" href="#feed">
        Open Feed
      </a>
    </header>
  );
}
