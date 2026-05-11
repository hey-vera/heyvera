# Xotic Workflow

This file is written for Xotic and his Qwen helper.

## Your Job

You do not need to invent the product.

Your job is to:
- read the current packet truth
- build one packet at a time
- stop when a packet is done
- avoid going off-script

## What To Read First

For actual packet implementation runs, keep the read set small.

Read in this order:

1. `PRE-FLIGHT.md`
2. `CONVENTIONS.md`
3. `frontend-plan/XOTIC-WORKFLOW.md`
4. `frontend-plan/AIDER-COMMANDS.md`
5. `frontend-plan/DRIFT-RECOVERY.md`
6. the current packet file:
   - `frontend-plan/PACKET-1-EXEC.md`
   - or `frontend-plan/PACKET-2-EXEC.md`
   - or `frontend-plan/PACKET-3-EXEC.md`
   - or `frontend-plan/PACKET-4-EXEC.md`
   - or `frontend-plan/PACKET-5-EXEC.md`
7. `frontend-sync/README.md`
8. `frontend-sync/GIT-SYNC.md`

Only re-read the longer planning docs if Josh explicitly says the
product or packet direction changed.

Only read the later planning files when Josh explicitly says to move
beyond the public site or when the current packet file tells you to:
- `frontend-plan/APP-SURFACES.md`
- `frontend-plan/BACKEND-SEAMS.md`
- `frontend-plan/SOVEREIGNTY-MIGRATION.md`

Use `frontend-plan/` for product truth and design direction.
Use `SETUP.md` for tooling and commands only.
Use `CONVENTIONS.md` as the short durable coding contract for Aider.

## Execution Gate

Only start work from committed repo files.

That means:
- do not start from chat-only packet names
- do not substitute a "closest" packet if the named one is missing
- do not infer the next packet from conversation history alone

If the packet file or file set is missing:
- log the blocker in `frontend-sync/BLOCKERS.md`
- stop
- wait for a committed packet file or an explicit redirect to an
  existing committed file set

Manager-owned prep should happen before you are asked to execute:
- packet authoring
- packet naming cleanup
- branch/status reconciliation
- small coordination and prompt-tightening tasks

## How To Work

- Build one packet only
- Edit only the files named by the packet file when possible
- Run `npm run proof`
- Then stop and explain what changed briefly

When the task is a cleanup or correction:
- make the smallest working edit
- preserve existing approved work where possible
- do not "help" by adding new structure that was not requested

Before moving to the next packet, ask yourself:
- did I finish the approved scope?
- did I accidentally add dashboard UI?
- did I accidentally make the page feel crypto-first?
- did I keep the hero and surface map structurally simple?

If you hit a blocker or unknown:
- update `frontend-sync/BLOCKERS.md`
- do not silently guess if it changes product truth or packet scope

Default handoff rule:
- do not spend extra time writing long explanations
- run `npm run status:update -- "Packet N" yes`
- push the branch
- stop so Josh/Codex can inspect the real repo state directly

Packet complete means:
- the code is committed
- the branch is pushed
- `frontend-sync/STATUS.md` names the last pushed commit
- `frontend-sync/STATUS.md` marks whether it is ready for review

If the branch is not pushed yet, the packet is still in progress.

## Handoff Proof

Before saying a packet is done, prove the current working copy actually
contains that packet.

Run this from `web/` unless told otherwise:

```bash
npm run proof
```

Then check one more thing:
- does `src/App.tsx` or the changed component file visibly contain the
  packet work you think you just built?

If the answer is no:
- do not say the packet is done
- do not move to the next packet
- stop and ask for help

This is especially important for Packet 2 and later. If Hero, Problem,
Surface Map, or Three Pillars do not show up in the actual files, the
packet is not done no matter what the model said.

Before starting a packet or after Josh says docs changed:
- run a sync check using `frontend-sync/GIT-SYNC.md`
- do not assume your local docs are current
- if docs and chat disagree, follow the committed repo files and log the
  mismatch

When starting Aider for a packet:
- stay in `web/`
- use `/read frontend-plan/PACKET-N-EXEC.md`
- use `/add` for only the file set that packet likely needs
- do not ask the model to infer the target files from memory

## Qwen Rules

Use Qwen like a coding helper, not like a product lead.

That means:
- keep prompts narrow
- do one packet at a time
- do not ask it to invent product strategy
- do not assume it has reliable internet access by default
- do not let it replace real content with generic filler
- do not let it invent placeholder metadata for status files
- do not let it widen a cleanup task into an architecture rewrite

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

Current signed-in repo truth:
- Packet 4 shell baseline already exists on the clean branch
- Packet 5 is the next execution-ready packet
- Packet 6 and later still wait for Packet 5 review

## Prompt Style

Use prompts like:

`Build only Packet N from PACKET-N-EXEC.md. Stop after the packet.`

When correcting drift, prefer prompts like:

`Make the smallest working edit needed to satisfy this task. Preserve existing structure and copy unless explicitly told otherwise. Do not add routes, pages, placeholder text, or placeholder metadata. If an exact value is unknown, stop instead of inventing one.`

If you see the design getting muddy:

`Stop. Re-read the current PACKET-N-EXEC.md file. Simplify the current packet. Do not add new sections. Do not add dashboard UI.`

## If You Feel Lost

If you feel lost, do not guess the product truth.

Instead:
- re-read the current packet file
- stay inside the current packet
- keep the code simple
- record the blocker in `frontend-sync/BLOCKERS.md`
- ask for a tighter packet rather than inventing a new direction

If the model starts producing generic filler like:
- `Welcome to the Public Site`
- fake branch names
- fake commit hashes
- extra routes or pages

that is drift, not progress. Stop and tighten the task.
