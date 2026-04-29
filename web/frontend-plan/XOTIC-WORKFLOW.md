# Xotic Workflow

This file is written for Xotic and his Qwen helper.

## Your Job

You do not need to invent the product.

Your job is to:
- read the current frontend truth
- build one packet at a time
- stop when a packet is done
- avoid going off-script

## What To Read First

For the current public-site work, read in this order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `BRIEF.md`
4. `PLAN.md`
5. `SETUP.md`
6. `frontend-plan/README.md`
7. `frontend-plan/MASTER-PLAN.md`
8. `frontend-plan/PUBLIC-SITE.md`
9. `frontend-plan/EXECUTION-PACKETS.md`
10. `frontend-plan/XOTIC-WORKFLOW.md`
11. `frontend-sync/README.md`
12. `frontend-sync/GIT-SYNC.md`
13. `CONVENTIONS.md`

Only read the later planning files when Josh explicitly says to move
beyond the public site:
- `frontend-plan/APP-SURFACES.md`
- `frontend-plan/BACKEND-SEAMS.md`
- `frontend-plan/SOVEREIGNTY-MIGRATION.md`

Use `SETUP.md` for tooling and commands only.
Use `frontend-plan/` for product truth and design direction.
Use `CONVENTIONS.md` as the short durable coding contract for Aider.

## How To Work

- Build one packet only
- Run the app
- Check mobile
- Make sure nothing broke
- Then stop and explain what changed

Before moving to the next packet, ask yourself:
- did I finish the approved scope?
- did I accidentally add dashboard UI?
- did I accidentally make the page feel crypto-first?
- did I keep the hero and surface map structurally simple?

If you hit a blocker or unknown:
- update `frontend-sync/STATUS.md`
- log the issue in `frontend-sync/BLOCKERS.md`
- do not silently guess if it changes product truth or packet scope

Before starting a packet or after Josh says docs changed:
- run a sync check using `frontend-sync/GIT-SYNC.md`
- do not assume your local docs are current

## Qwen Rules

Use Qwen like a coding helper, not like a product lead.

That means:
- keep prompts narrow
- do one packet at a time
- do not ask it to invent product strategy
- do not assume it has reliable internet access by default

If internet context is needed:
- give it exact URLs
- or paste the exact source text

Do not ask it to:
- research the product direction
- decide the information architecture
- choose random design motifs from the web

## Do Not Assume

Do not assume:
- old ClawNet visuals are correct for HeyVera
- old Pulse ideas should be copied over directly
- crypto is the center of the product
- the public site is just a generic landing page
- the signed-in app should be a dashboard
- `SETUP.md` is where product decisions live

## Safe Build Order

### Phase 1

- Packet 1: foundation
- Packet 2: core public sections
- Packet 3: supporting public sections and mobile polish

Stop after Phase 1 and wait for review.

### Phase 2

- Packet 4: signed-in shell prototype with static placeholders

### Phase 3

- Packet 5: `Identity Lite`

### Phase 4

- Packet 6: `Work Lite`

### Phase 5

- Packet 7: `Proof`, `Network`, `Discover`, and `Markets` shells

Phases 2 to 5 are later. They are not current work.

## Prompt Style

Use prompts like:

`Read the docs listed in XOTIC-WORKFLOW.md. Build only Packet N. Do not build any other packet. Explain what you changed and stop.`

Current prompt pattern:

`Build only Packet 1. Do not build anything related to the signed-in app. Explain what you changed and stop.`

Then later:

`Build only Packet 2. Do not build anything related to the signed-in app. Explain what you changed and stop.`

Then later:

`Build only Packet 3. Do not build anything related to the signed-in app. Explain what you changed and stop.`

If you see the design getting muddy:

`Stop. Re-read frontend-plan/PUBLIC-SITE.md and EXECUTION-PACKETS.md. Simplify the current packet. Do not add new sections. Do not add dashboard UI.`

## If You Feel Lost

If you feel lost, do not guess the product truth.

Instead:
- re-read the frontend-plan docs
- stay inside the current packet
- keep the code simple
- record the blocker in `frontend-sync/BLOCKERS.md`
- ask for a tighter packet rather than inventing a new direction
