# HeyVera Frontend Plan

This folder is the current source of truth for the HeyVera frontend
management lane.

## Core Thesis

HeyVera should be designed as one living surface.

That surface has:
- a public mode now
- a signed-in mode later
- multiple regions that belong to one world, not separate products

The public site is not a random brochure.
It is the front door to that larger surface.

## Current Priority

Right now, the only active build target is the public `heyvera.org`
surface.

That means:
- finish the public site first
- make it excellent before expanding
- use future-region docs only to prevent drift
- do not start the signed-in shell yet

## What 10/10 Means

For this project, 10/10 means:
- the public page explains the thesis fast
- the page feels premium and intentional
- the visual system can grow into the later app
- the future regions feel implied, not bolted on
- Xotic can build it with very little guesswork

## Read Order

### For the current build

1. `README.md`
2. `MASTER-PLAN.md`
3. `PUBLIC-SITE.md`
4. `FRONTEND-PARALLELIZATION.md` when the temporary manager takeover lane
   is active
5. `EXECUTION-PACKETS.md`
6. `XOTIC-WORKFLOW.md`
7. `AIDER-COMMANDS.md`
8. `DRIFT-RECOVERY.md`
9. `PACKET-1-EXEC.md`
10. `PACKET-2-EXEC.md`
11. `PACKET-3-EXEC.md`
12. `TEMPORARY-PUBLIC-SITE-TAKEOVER.md` only for historical continuity

### For later planning and wiring

13. `APP-SURFACES.md`
14. `BACKEND-SEAMS.md`
15. `SOVEREIGNTY-MIGRATION.md`

## Who This Is For

- Xotic, a first-time vibe coder
- Qwen 14B, acting as a narrow coding helper
- Josh and future reviewers who need one stable frontend truth

These docs are intentionally:
- concrete
- packet-based
- beginner-safe
- aligned to the actual product direction

## Override Rule

If an older `web/` doc and a file in this folder conflict:
- use the more specific file in this folder
- update the older doc later if the conflict matters

## Quick Map

This plan package covers four linked tracks:
- public site truth
- signed-in surface truth
- backend seam map
- sovereignty migration map

For current implementation, Track 1 is active.
Tracks 2 to 4 exist so the public site does not drift away from the
later product.
