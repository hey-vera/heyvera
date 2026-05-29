# HeyVera Frontend Parallelization

This is the canonical manager-owned work doc for frontend parallelization
during the temporary takeover lane while Xotic is away.

It exists to:
- keep execution aligned with current product truth
- route parallel work without inventing extra routes or fake readiness
- protect `m7` as the Xotic-facing and local coding-model workflow lane

This file does not replace:
- `MASTER-PLAN.md`
- `PUBLIC-SITE.md`
- `APP-SURFACES.md`
- `BACKEND-SEAMS.md`
- `SOVEREIGNTY-MIGRATION.md`

It translates those docs plus the current repo state into a safe execution
plan.

## Boundary

Keep these boundaries explicit:
- `m7` stays the Xotic-facing and local coding-model workflow lane
- this lane owns temporary manager routing, cross-surface planning, and
  supervisor launch structure
- do not absorb `m7`
- do not rename `m7`

## Launch-Container Correction

Do not blur:
- logical role
- live container
- control-plane registration

A spawned coding worker is not automatically a real supervisor lane.

Only call something a real supervisor lane when all of these are true:
- the role/container pairing is intentionally chosen
- the lane has a real active-map registration
- inbox and mailbox paths are provisioned if required
- a lane capsule exists

If those are not all true, describe it honestly as:
- a background helper
- a spawned worker container
- or a helper pending registration

## Verified Repo Truth

Read date for this plan: 2026-05-06.

Current verified `web/src` state:
- `src/App.tsx`
- `src/index.css`
- `src/main.tsx`

Current verified execution status:
- `frontend-sync/STATUS.md` is still `Not started`
- active packets are still only Packet 1, Packet 2, and Packet 3
- the public site is still the only active build target

That means the repo does not yet justify:
- route-based parallelization
- signed-in app UI work
- public multi-page expansion
- separate socials, crypto, or marketplace builds

## Immediate Answer

Yes.

The correct immediate target is still one excellent home page.

More exact version:
- use one supervisor first
- keep section-level parallelization as a later option only if the home
  page grows enough to justify it
- do not parallelize by routes
- do not jump ahead to signed-in or market surfaces

## Execution-Ready Now

Only this work is execution-ready right now:
- Packet 1 foundation work
- Packet 2 core public sections
- Packet 3 supporting public sections and mobile polish

Execution-ready means:
- one public home page
- shared visual system
- one disciplined surface preview
- section-level componentization inside `web/src`

Not execution-ready now:
- signed-in app shell
- public proof explorer
- standalone socials surface
- standalone crypto surface
- standalone marketplace surface

## Surface Map

Use this map when deciding whether a surface is real enough to build,
spec, or defer.

| Surface | Repo and doc truth | Current classification | What is allowed now | What is not allowed now |
| --- | --- | --- | --- | --- |
| Home page | Strongest truth across `README.md`, `MASTER-PLAN.md`, `PUBLIC-SITE.md`, packet docs, and current `web/src` | `Build now` | Build the one-page public site and split it by sections/systems | Extra public routes, signed-in UI, dashboard promo patterns |
| Socials | Real as future direction via `Founding Network`, `Network` region, `Pulse` instincts, and `soma-social-trust-layer.md`, but still backlog / future-facing | `Concept/spec only` | Use it to shape copy, surface-map language, and founding-network framing on the home page | Separate public socials route, signed-in social feed, fake social activity UI |
| Crypto | Real only as one contained proving-ground region in `Markets`; docs repeatedly reject crypto-first framing | `Deferred except contained mention` | Mention `Markets` once as a contained future region in the home page surface map | Crypto-first story, wallet dashboard hero, separate crypto route, market-led IA |
| Marketplace | Real as backlog concept in `soma-marketplace.md`, but depends on actualization, Vouch, Soma Check, and payment seams | `Concept/spec only, execution deferred` | Preserve room for a future `Markets` region and note marketplace as one possible proving-ground expression | Marketplace page build, listing UI, commerce flow mocks presented as active product |

## Build Now / Design Now / Backend-Blocked

### Build now

- public home page in `web/`
- Packet 1 foundation
- Packet 2 public core sections
- Packet 3 supporting sections and mobile polish
- shared layout primitives and reusable section structure

### Design now, wire later

- signed-in region worldview as planning only
- `Network` and founding/social framing as copy and IA guidance
- `Markets` as one contained region in the surface map
- proof and identity affordance language that leaves room for later seams

### Blocked on backend truth

- real social feed or agent-native social interaction UX
- real marketplace listing and purchase flows
- live wallet/payment authority surfaces
- public proof explorer backed by stable receipts and lineage data
- rich signed-in app regions beyond shell planning

## Future Surface Reality Check

These are the manager answers to the future-surface questions.

### Socials

Real enough to plan now:
- yes, as a future region and narrative layer

Current status:
- concept/spec only

Why:
- there is real directional truth in `PUBLIC-SITE.md`, `APP-SURFACES.md`,
  and `internal/backlog/soma-social-trust-layer.md`
- it is still backlog, depends on deeper platform actualization, and has
  no current `web/src` or packet-level execution target

### Crypto

Real enough to plan now:
- yes, but only as a containment rule

Current status:
- deferred as a standalone surface

Why:
- the docs consistently allow `Markets` as one future proving-ground
  region
- the docs consistently reject crypto-first framing
- there is no repo truth supporting a separate crypto page or immediate
  crypto execution packet

### Marketplace

Real enough to plan now:
- yes, as a future market-region concept

Current status:
- concept/spec only for IA
- execution deferred
- backend-blocked for real product work

Why:
- `internal/backlog/soma-marketplace.md` gives a real concept with clear
  dependencies
- those dependencies are not live frontend targets yet
- current frontend truth supports only a contained future-region mention

## Safe Supervisor Topology

The cleanest current topology is one supervisor now.

Reason:
- the repo is still too small to benefit from supervisor splitting
- one owner lowers merge churn and interpretation drift
- the current job is still Packet 1 to Packet 3 on one public page
- it keeps the home page as the single public truth

### Supervisor 1 - Homepage Owner

Responsibility:
- foundation
- section implementation
- integration
- mobile polish

Write scope:
- `src/App.tsx`
- `src/index.css`
- `src/components/layout/*`
- `src/components/public/*`

Rules:
- build only the one-page public site
- stay inside Packet 1, Packet 2, and Packet 3 truth
- do not add routes, signed-in UI, or separate future-surface pages
- keep `Markets` contained as one future-region mention only

## Later Parallelization Option

Only consider this after the homepage is coherent and reviewable.

If later splitting becomes necessary, the safe fallback is four
supervisors with disjoint write scopes:
- foundation and integration
- top narrative
- product world
- trust and conversion

### Supervisor A - Foundation And Integration

Responsibility:
- shared tokens
- base atmosphere
- section container primitives
- page assembly
- final integration of section components

Write scope:
- `src/App.tsx`
- `src/index.css`
- `src/components/layout/*`

Rules:
- create the reusable layout contract first
- integrate section components after the other supervisors finish
- do not expand scope into signed-in or route architecture

### Supervisor B - Top Narrative

Responsibility:
- navbar
- hero
- problem

Write scope:
- `src/components/public/Navbar.tsx`
- `src/components/public/Hero.tsx`
- `src/components/public/Problem.tsx`

Rules:
- consume shared layout primitives only
- do not edit `App.tsx`
- do not edit `index.css`
- keep the hero as one believable surface preview, not a dashboard

### Supervisor C - Product World

Responsibility:
- surface map
- three pillars
- how it works

Write scope:
- `src/components/public/SurfaceMap.tsx`
- `src/components/public/ThreePillars.tsx`
- `src/components/public/HowItWorks.tsx`

Rules:
- consume shared layout primitives only
- do not edit `App.tsx`
- do not edit `index.css`
- keep `Markets` contained inside the surface map

### Supervisor D - Trust And Conversion

Responsibility:
- founding network
- get started
- footer

Write scope:
- `src/components/public/FoundingNetwork.tsx`
- `src/components/public/GetStarted.tsx`
- `src/components/public/Footer.tsx`

Rules:
- consume shared layout primitives only
- do not edit `App.tsx`
- do not edit `index.css`
- keep the founding tone serious and the CTA singular

## Safe Launch Sequence

1. launch one supervisor for the homepage only
2. complete Packet 1, Packet 2, and Packet 3 scope on the one-page
   public site
3. review the full page against the public-site quality bars
4. only then decide whether any further supervisor split is warranted

Do not launch section supervisors by default.

## Exact Launch Stubs

Use these only after this file is the accepted canonical source.

### Launch Stub - Supervisor 1

Role:
- Supervisor

Responsibility:
- homepage owner for the one-page public site

Exact scope:
- `src/App.tsx`
- `src/index.css`
- `src/components/layout/*`
- `src/components/public/*`

Directive:
- Build only the one-page public HeyVera homepage.
- Stay inside Packet 1, Packet 2, and Packet 3 truth.
- Do not add routes, extra pages, signed-in UI, or market-first visuals.
- Keep `Markets` present only as one contained future-region mention.
- Stop after the homepage is coherent and reviewable.

## Optional Later Launch Stubs

Only use these if the homepage later becomes large enough to justify a
split.

### Launch Stub - Supervisor B

Role:
- Supervisor

Responsibility:
- top-of-page narrative sections

Exact scope:
- `src/components/public/Navbar.tsx`
- `src/components/public/Hero.tsx`
- `src/components/public/Problem.tsx`

Directive:
- Build only Navbar, Hero, and Problem for the one-page public site.
- Use the shared layout primitives already created by Supervisor A.
- Do not edit `App.tsx` or `index.css`.
- Keep the hero disciplined, believable, and non-dashboard.
- Stop after this scope is complete.

### Launch Stub - Supervisor C

Role:
- Supervisor

Responsibility:
- mid-page product-world sections

Exact scope:
- `src/components/public/SurfaceMap.tsx`
- `src/components/public/ThreePillars.tsx`
- `src/components/public/HowItWorks.tsx`

Directive:
- Build only Surface Map, Three Pillars, and How It Works.
- Use the shared layout primitives already created by Supervisor A.
- Do not edit `App.tsx` or `index.css`.
- Keep the section structural and restrained.
- Keep `Markets` present only as one contained future region.
- Stop after this scope is complete.

### Launch Stub - Supervisor D

Role:
- Supervisor

Responsibility:
- lower-page trust and conversion sections

Exact scope:
- `src/components/public/FoundingNetwork.tsx`
- `src/components/public/GetStarted.tsx`
- `src/components/public/Footer.tsx`

Directive:
- Build only Founding Network, Get Started, and Footer.
- Use the shared layout primitives already created by Supervisor A.
- Do not edit `App.tsx` or `index.css`.
- Keep the founding section serious, not hype-community.
- Keep the CTA singular and honest.
- Stop after this scope is complete.

## `m7` Versus This Lane

What should stay with `m7`:
- Xotic-facing workflow
- local coding-model packet execution
- narrow packet prompts and correction loops
- packet-level sync discipline in `frontend-sync/`
- eventual handback to the normal frontend execution lane

What this temporary manager lane should own:
- canonical parallelization truth
- the decision that homepage execution stays single-supervisor by default
- cross-surface readiness classification
- supervisor topology
- disjoint write-scope planning
- temporary takeover routing while Xotic is away
- the recommendation for when later surfaces are ready to move from spec
  to execution

## Active Map Recommendation

The active map should be updated only if a real routed lane id is being
kept live for this temporary takeover.

Current recommendation:
- do not edit `ACTIVE-CHAT-MAP.md` yet if the new lane has not been
  assigned a stable display name, stable lane, and routing id
- once that metadata is real, add a separate active manager row for this
  temporary frontend-parallelization lane
- do not repurpose the `m7` row
- until then, do not describe spawned helpers as launched supervisor
  lanes

## Non-Approved Expansions

Not approved from this doc:
- extra public routes
- signed-in app UI
- socials page build
- crypto page build
- marketplace page build
- fake product stats or fake market activity
- route-first parallelization
- making `Markets` the frame

## Review Standard

This plan is holding the line when:
- the home page remains the only active frontend build target
- socials, crypto, and marketplace stay correctly classified
- supervisors have disjoint write scopes
- `m7` remains intact as its own lane
- nobody has to invent product truth ad hoc during execution
