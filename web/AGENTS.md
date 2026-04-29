# HeyVera Frontend - AGENTS.md

Universal AI project memory for `web/`.

If you are an AI assistant working in this folder, read these files in
this order before writing code:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `BRIEF.md`
4. `PLAN.md`
5. `SETUP.md`
6. `frontend-plan/README.md`
7. `frontend-plan/PUBLIC-SITE.md`
8. `frontend-plan/EXECUTION-PACKETS.md`
9. `frontend-plan/XOTIC-WORKFLOW.md`
10. `frontend-sync/README.md`
11. `CONVENTIONS.md`

If a file in `frontend-plan/` is more specific than an older `web/`
doc, follow `frontend-plan/`.

## Project Type

`web/` is the current public mode of the HeyVera surface.

Today:
- it is a public-facing landing experience
- it is a static frontend app
- it should explain the product and establish the visual language

Not today:
- it is not the signed-in app shell yet
- it is not a backend app
- it is not an admin dashboard

Important nuance:
- the public site should feel related to the future signed-in product
- do not design it like an isolated brochure that ignores the later app

## Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS 4
- Cloudflare Pages

## Mission

Build a public HeyVera surface that makes people feel:
- this is real
- this is premium
- this is not generic AI SaaS
- this is not a crypto casino
- this has a clear future shape beyond one marketing page

## Product Guardrails

Stay aligned with the current vision:
- HeyVera helps people own AI agents
- Vera is the shared intelligence fabric
- Soma is the continuity, identity, and authority substrate
- the long-run product is one living surface with multiple regions
- crypto is a proving-ground region, not the center of the product
- offline-first local truth and online-shared legitimacy both matter

Do not invent:
- fake product claims
- enterprise platform promises
- live trust markets as if they already exist
- dashboard-first public UX
- random extra sections because they are common on startup sites

## Design Guardrails

- Dark neutral base
- One mineral accent
- Strong typography
- Calm motion
- Clean terminal and proof treatment
- Mobile-first layout
- Components split clearly

Avoid:
- purple-heavy UI
- template AI startup sections
- stock photos
- crypto-trader aesthetics
- fake partner logos
- overbuilt navigation

## Workflow

Build one packet at a time.

If you are using Aider from inside `web/`:
- `web/.aider.conf.yml` auto-loads the read-only planning files
- `CONVENTIONS.md` is the short durable coding contract
- `npm run build` is the automatic post-edit safety check

Current active packets:
1. Landing-page foundation
2. Core public sections
3. Supporting public sections and mobile polish

After each packet:
- run the page
- check for console errors
- verify mobile layout
- explain what changed
- stop

## Rules For AI Assistants

- Read the planning docs before coding
- Do not rewrite the whole app when one packet is requested
- Do not touch anything outside `web/`
- Do not add backend code or APIs
- Do not add unnecessary packages
- Do not make product decisions outside the docs
- Do not let old ClawNet or Pulse structures become automatic defaults
- Use `frontend-sync/` to log blockers, decisions, and packet status
  instead of guessing

## If You Get Stuck

- Re-read `frontend-plan/PUBLIC-SITE.md`
- Re-check the current packet scope
- Make the smallest correction needed
- Ask the human for the product decision instead of guessing
