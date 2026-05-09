# HeyVera Frontend - Build Brief

Also read:
- `frontend-plan/README.md`
- `frontend-plan/PUBLIC-SITE.md`

Those files are the higher-resolution source of truth for current work.

## What Is HeyVera?

HeyVera is building a sovereignty-first AI surface where a person owns
their agent, improves it through Vera, and grounds it in Soma.

Product truths:
- HeyVera is the stewarded human-facing surface
- Vera is the shared intelligence fabric
- Soma is the continuity, identity, authority, and proof substrate

## What This Frontend Is

The current build target is the public mode of the HeyVera surface at
`heyvera.org`.

That means:
- it should work as a landing page today
- it should establish the visual system for later product surfaces
- it should preview the future region model without pretending the whole
  app already exists

It should not be treated like:
- a generic marketing site
- a dashboard promo page
- the full signed-in shell

## Experience Bar

This should feel 10/10 for a first release.

For HeyVera, 10/10 means:
- the product thesis is clear in under 10 seconds
- the visuals feel premium and intentional
- the page hints at a larger world behind it
- the page does not feel like AI SaaS boilerplate
- the page does not feel crypto-first
- mobile feels designed, not repaired

## Public Surface Direction

The public site should tell one story:

1. Most AI still is not really yours.
2. HeyVera gives you a named agent you can own.
3. Vera helps that agent learn through shared intelligence.
4. Soma gives identity, continuity, and proof underneath.
5. This grows into one living surface with work, network, discovery,
   proof, identity, and markets as related regions.

## Public Section Order

1. Navbar
2. Hero
3. Problem
4. Surface map
5. Three pillars
6. How it works
7. Founding network
8. Get started
9. Footer

## Design Direction

The site should feel:
- dark
- premium
- technical
- calm
- modern
- distinct

Keep:
- dark neutral surfaces
- generous spacing
- believable terminal/proof UI
- crisp borders and controlled glow

Avoid:
- purple-heavy styling
- dashboard copy
- crypto-trader aesthetics
- generic feature-grid filler

## Tech Stack

- React 19 + TypeScript
- Vite
- Tailwind CSS 4
- Cloudflare Pages

This is a static frontend build target right now.

## Build Rule

Build only the currently approved packet.

Right now:
- build Packet 1: foundation
- build Packet 2: core public sections
- build Packet 3: supporting public sections and mobile polish
- stop for review

Do not start signed-in app work from `web/` yet.
