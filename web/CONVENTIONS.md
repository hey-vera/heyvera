# HeyVera Web Conventions

These are the durable coding conventions for `web/`.

Use this file as a read-only guide in Aider.

## Scope

- Work only inside `web/`
- Build only the currently approved packet
- Do not build signed-in app UI yet
- Do not add backend logic or API wiring

## Product Truth

- `heyvera.org` is the public mode of one larger HeyVera surface
- the page is not a generic landing page
- the page is not a dashboard
- the page is not crypto-first

Core message:
- own the agent
- learn through Vera
- prove through Soma

## Packet Discipline

- One packet at a time
- Do not jump ahead automatically
- Stop after the packet and explain what changed
- If the current packet is unclear, simplify rather than expand
- Make the smallest working edit that satisfies the packet
- Preserve existing structure unless the packet explicitly requires a restructure

## Editing Discipline

- Do not replace real copy with generic filler
- Do not add placeholder values to live repo files
- Do not invent example branch names, commit hashes, or status values
- Do not create extra files, routes, pages, or components unless the packet explicitly needs them
- If asked to wire an existing component, wire it into the existing scaffold with the smallest sensible diff

If you do not know an exact value:
- leave the field unchanged or blank if appropriate
- or stop and ask for a tighter instruction
- do not fabricate a stand-in value

## Design Rules

- dark neutral base
- one mineral-mint accent
- strong typography
- calm motion
- mobile-first layout
- clean terminal/proof treatment

Avoid:
- dashboard UI
- crypto terminal aesthetics
- fake partner logos
- feature-soup section design
- random extra sections

## Hero Rules

- one primary active surface preview
- no dense admin layout
- no charts or wallet dashboards
- must feel understandable in a few seconds

## Surface Map Rules

- structural preview only
- one sentence or short phrase per region
- no fake screenshots
- no fake metrics
- `Markets` stays contained

## Tailwind Rules

- Tailwind CSS 4 with Vite is already set up
- prefer CSS-first patterns in `src/index.css`
- do not depend on `tailwind.config.js` unless there is a specific reason

## Safety Rule

If you hit a product, design, or scope ambiguity:
- do not guess
- update `frontend-sync/STATUS.md`
- log it in `frontend-sync/BLOCKERS.md`

If you are about to:
- replace existing copy with generic text
- add routing or pages that were not requested
- write placeholder status metadata
- restructure the app beyond the packet

stop and simplify instead.
