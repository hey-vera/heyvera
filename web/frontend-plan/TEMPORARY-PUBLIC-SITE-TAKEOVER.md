# Temporary Public-Site Takeover

This is the canonical work doc for the temporary HeyVera public-site
execution-support takeover while Xotic is away.

## Purpose

Keep public-site execution moving without changing product identity.

This is a temporary operational artifact. It does not replace the core
frontend worldview in:
- `MASTER-PLAN.md`
- `PUBLIC-SITE.md`
- `APP-SURFACES.md`
- `EXECUTION-PACKETS.md`

## Current Truth

The public-site truth is still:
- one excellent public page first
- not a scattered multi-route build
- not a signed-in app shell
- not a crypto-first surface

The canonical section order remains:
1. Navbar
2. Hero
3. Problem
4. Surface Map
5. Three Pillars
6. How It Works
7. Founding Network
8. Get Started
9. Footer

## Current Repo Reality

Current `web/src` reality is still minimal:
- `src/App.tsx`
- `src/index.css`
- `src/main.tsx`

That means the repo does not justify parallelizing by routes or page
files yet.

## Temporary Takeover Decision

Parallelize by section/system, not by routes.

Reason:
- the canonical public-site truth still says one strong page
- the live repo does not already justify extra routes
- route-first parallelization would increase drift risk and merge noise

## Canonical Build Direction

First create a clean one-page component structure.

Allowed target structure:
- `src/App.tsx`
- `src/index.css`
- `src/components/layout/*`
- `src/components/public/*`

Do not add:
- public docs/blog/pricing routes
- auth or signed-in UI
- dashboard shells
- route-based app architecture

## Recommended Supervisor Topology

Use three Supervisors with disjoint write scopes.

### Supervisor 1 - Structural Integration / Top Of Page

Scope:
- page structure
- global tokens
- layout primitives
- navbar
- hero
- problem

Write scope:
- `src/App.tsx`
- `src/index.css`
- `src/components/layout/*`
- `src/components/public/Navbar.tsx`
- `src/components/public/Hero.tsx`
- `src/components/public/Problem.tsx`

Special responsibility:
- final integration owner for the one-page structure
- only this supervisor should mutate `App.tsx` and `index.css`

### Supervisor 2 - Mid-Page Product World

Scope:
- surface map
- three pillars
- how it works

Write scope:
- `src/components/public/SurfaceMap.tsx`
- `src/components/public/ThreePillars.tsx`
- `src/components/public/HowItWorks.tsx`

Rules:
- use the shared layout primitives from Supervisor 1
- do not edit `App.tsx` or `index.css`
- keep `Markets` contained inside the surface map

### Supervisor 3 - Lower-Page Trust / Conversion

Scope:
- founding network
- get started
- footer

Write scope:
- `src/components/public/FoundingNetwork.tsx`
- `src/components/public/GetStarted.tsx`
- `src/components/public/Footer.tsx`

Rules:
- use the shared layout primitives from Supervisor 1
- do not edit `App.tsx` or `index.css`
- keep CTA singular and honest

## Integration Rule

Do not ask multiple supervisors to edit `App.tsx`.

Parallel flow should be:
1. Supervisor 1 establishes structure and shared tokens
2. Supervisor 2 and Supervisor 3 build disjoint section components
3. Supervisor 1 integrates those components into `App.tsx`
4. final mobile/polish pass happens after integration, not during the
   initial parallel build

## Temporary Execution Sequence

1. Supervisor 1 starts first and creates the one-page structure
2. Supervisor 2 and Supervisor 3 can then work in parallel on their
   section files
3. Supervisor 1 performs integration and a first mobile sanity pass
4. review against Packet 2 and Packet 3 quality bars before deeper
   polish

## Not Approved For This Takeover

- route-based split
- multi-page marketing expansion
- signed-in shell work
- crypto-first visuals
- dashboard promo hero
- art-heavy detours before structure is real

## Launch Stub - Supervisor 1

Role:
- Supervisor

Responsibility:
- structural integration and top-of-page public-site build

Exact scope:
- `src/App.tsx`
- `src/index.css`
- `src/components/layout/*`
- `src/components/public/Navbar.tsx`
- `src/components/public/Hero.tsx`
- `src/components/public/Problem.tsx`

Directive:
- Build only the structural one-page shell plus Navbar, Hero, and
  Problem.
- Do not add routes or extra pages.
- Create shared layout primitives that the other supervisors can reuse.
- Keep the page aligned with `PUBLIC-SITE.md`.
- Stop after this scope is done.

## Launch Stub - Supervisor 2

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
- Assume shared layout primitives already exist.
- Do not edit `App.tsx` or `index.css`.
- Keep Surface Map structural and restrained.
- Keep `Markets` contained.
- Stop after this scope is done.

## Launch Stub - Supervisor 3

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
- Assume shared layout primitives already exist.
- Do not edit `App.tsx` or `index.css`.
- Keep the founding section serious, not hype-community.
- Keep the CTA singular and honest.
- Stop after this scope is done.

## Active Map Note

`m7` already owns frontend direction and execution planning, so no
session-id change is needed.

If the active-map description is updated later, the only change needed
is to note temporary public-site execution-support ownership during the
Xotic gap.
