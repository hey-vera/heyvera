import type { PropsWithChildren } from "react";

type SectionProps = PropsWithChildren<{
  id?: string;
  label: string;
  title: string;
  intro?: string;
  className?: string;
}>;

export function Section({
  id,
  label,
  title,
  intro,
  className,
  children,
}: SectionProps) {
  const sectionClassName = ["section-shell", className].filter(Boolean).join(" ");

  return (
    <section id={id} className={sectionClassName}>
      <div className="section-heading">
        <p className="section-label">{label}</p>
        <h2>{title}</h2>
        {intro ? <p className="section-intro">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}
