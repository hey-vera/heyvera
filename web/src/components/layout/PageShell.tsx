import type { PropsWithChildren } from "react";

export function PageShell({ children }: PropsWithChildren) {
  return (
    <div className="site-shell">
      <div className="site-backdrop site-backdrop-grid" aria-hidden="true" />
      <div className="site-backdrop site-backdrop-glow" aria-hidden="true" />
      <div className="site-content">{children}</div>
    </div>
  );
}
