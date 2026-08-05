# Opus 5 handoff — the one path

> Written 2026-08-05 by the Fable 5 session that closed the architecture
> phase. This is the map, not a spec — every spec it points to is merged and
> cited. If you are an Opus 5 session and you are lost, come back here.

## Read first, in this order

1. [PLAN-2026-08.md](PLAN-2026-08.md) — ground truth, contradictions resolved, phase plan
2. [CREDITS.md](CREDITS.md) — what a credit is; the two-ledger rule
3. [VERIFIER.md](VERIFIER.md) — what "verified" means; build plan V1–V7
4. [CONTEXT.md](CONTEXT.md) — the context engine; build plan C1–C5
5. [SURFACE.md](SURFACE.md) — where customers meet Cortex; build plan F1–F7
6. This file — sequencing, standing rules, stop conditions

## Standing rules (violating any of these is how sessions get lost)

- **The migration counter is a single integer.** v53–v59 belong to
  `fix/socials-message-integrity` (PR #438), v60 to credits (PR #437), v61 is
  reserved for the verifier tables (V3). Never mint a migration number
  without checking `apply_migrations` on main AND every open PR that touches
  `crates/api/src/db.rs`. Merge order: #438 before #437 before any v61 work.
- **CI is the only verifier.** The authoring machine cannot compile Rust
  (no MSVC Build Tools; broken MinGW). Do not burn time trying. Push a
  branch, open a PR, read the `rust` job. The three advisory jobs
  (cargo-deny, npm-audit ×2) fail on every PR until their triage lands —
  they are not your failure.
- **Commit early, push WIP.** Task #7 survived a quota cutoff only because
  its scratchpad happened to survive (backup:
  `C:\Users\Josh\Desktop\GitHub\task7-credit-idempotency-base2bfa7a9.patch`).
  Never hold >1 hour of work uncommitted.
- **Nothing grades its own homework** (PLAN standing rule). Applies to you:
  claim done only what a check confirms.
- **Branch per task, PR to `main`, non-draft only when mergeable.**
  Auto-merge arms on non-draft PRs with green required checks
  (`cortex`, `heyvera`, `rust`).
- **Do not touch the HeyVera Socials stream** beyond step 1 below — it is
  ChatGPT's lane; coordination happens through PRs, not shared working trees.
- **Pricing and customer-facing decisions belong to Josh.** Flag, don't decide.

## The queue

Work strictly in order inside each lane. Lane B may run parallel to Lane A
in cheap sessions.

**Lane A — the product**

| # | Task | Done when |
|---|---|---|
| A1 | Review PR #438 (Socials, migrations v53–v59; CI already green — review is for correctness, ~5k lines) and merge; then mark #437 ready and merge | `main` has migrations through v60; both PRs merged |
| A2 | Task 1.4: instrument real token cost on 3–5 representative tasks (~$300 budget) | measured $/task table committed as `cortex/plan/COSTS-MEASURED.md`; pricing handed to Josh |
| A3 | VERIFIER.md V1→V7, in the sequencing that file specifies (V3 = migration v61) | verdicts computed from Cortex-run checks; refund copy still withheld until V7 passes |
| A4 | CONTEXT.md C1→C4 (C5 later) | repo map in planning prompts; semantic leases demo on a real monorepo |
| A5 | Consult checkpoint: before Phase 3 cutover (Postgres/Temporal), request a Fable/xhigh review of the cutover plan | reviewed plan exists before any data moves |

**Lane C — the surface (per SURFACE.md; F1 may start immediately, the rest
gate on Lane A as SURFACE.md's dependency column specifies)**

| # | Task | Done when |
|---|---|---|
| C-F1 | Frontend audit + BYOK-era amputation; mission-control IA skeleton | six-pane IA on main; ReplitProjects and marketing relics gone |
| C-F2…F7 | Follow SURFACE.md's table and dependencies exactly | per-row criteria in SURFACE.md |

**Lane B — hygiene (cheap sessions)**

| # | Task | Done when |
|---|---|---|
| B1 | Dependabot triage: #435 (`rust` fails), #427 (`cortex` fails), #425 (`heyvera` fails) — find the offending bump in each, fix or `@dependabot ignore` it | all three merged or closed with reasons |
| B2 | Advisory triage: cargo-deny findings + npm audit for both apps, one PR with justified fixes/ignores | advisory jobs green on a fresh PR |
| B3 | Stale PR sweep if Josh has not: close #397 #408 #409 #410 (archive-targeting) and #105 (superseded) | open-PR list contains only live work |

**Blocked on Josh (surface these when relevant, never work around them)**

- #411: run the host commands in its description, then merge — deploys stay
  frozen until this lands (prod runs a June 3 binary)
- Anthropic conversation: §D.4 written clarification + rate-tier increase
- UNVERIFIED pricing row sign-off (VERIFIER.md gate table)
- `OPENCODE_ZEN_API_KEY` on the VPS for live Zen testing
- GHAS billing decision (blocks dependency-review restoration)
- Enterprise business track: SOC 2 / ISO certifications, IP-indemnity
  posture, index data-handling page (SURFACE.md) — months of lead time,
  gates six-figure deals, not an engineering task

## State as of this handoff

Merged today: #437's prerequisites chain intact; #439 (Zen provider — three
providers wired, OpenAI-compatible seam ready for the next gateway); #440
(VERIFIER.md). Open: #437 (draft, waits on #438), #438 (draft, CI-green,
needs review), #411 (Josh). Production: zero users, June 3 binary, decisions
still free — that stops being true at the first payment, which is why Lane A
runs in the order it does.
