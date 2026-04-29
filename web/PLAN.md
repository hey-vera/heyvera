# HeyVera Frontend - Build Plan

Also read:
- `frontend-plan/README.md`
- `frontend-plan/PUBLIC-SITE.md`
- `frontend-plan/EXECUTION-PACKETS.md`

Current priority:
- build and review the public HeyVera surface first
- do not start signed-in app work from this folder until the public
  site is approved

## Objective

Ship a strong first public surface for `heyvera.org` that:
- explains the product clearly
- feels premium and memorable
- previews the long-run product shape
- is simple for Xotic and Qwen to build packet by packet

## Packet Order

### Packet 1 - Foundation

Build:
- global tokens
- type system
- background atmosphere
- section rhythm
- shared layout patterns

Done when:
- the page already feels intentional before all content is present
- styling is not trapped in one giant component

### Packet 2 - Core public sections

Build:
- navbar
- hero
- problem
- surface map
- three pillars

Done when:
- the hero explains HeyVera quickly
- the surface preview looks believable
- the surface-map section makes the future shape legible

### Packet 3 - Supporting public sections

Build:
- how it works
- founding network
- get started
- footer
- mobile polish

Done when:
- the page story resolves clearly
- the page hints at the future living surface
- the page feels premium on desktop and mobile

## Stop Gate

After Packet 3:
- stop
- review the result
- decide whether it feels 10/10
- only then continue into later planning or implementation

## Reuse Strategy

Reuse from old ClawNet:
- dark craft
- spacing rhythm
- terminal treatment

Reuse from Pulse carefully:
- network/discovery instincts
- only as future region input, not public-site structure

Do not reuse:
- old product copy
- purple dashboards
- ceremony or roster admin language
- marketplace-first IA

## Definition Of Success

Xotic should be able to:
- open `web/`
- run the page
- read the docs in order
- build one packet at a time
- avoid guessing the product truth
