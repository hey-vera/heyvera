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
6. [PACKAGING.md](PACKAGING.md) — how Cortex is bought; credits pooled, seats never metered
7. `docs/ARCHITECTURE.md` — the implementation spec. **Read its
   "Amendment 2026-08-02" table first**: it marks section by section what
   survives operator-funded keys, what is revised, and what the code
   refuted. Trust the amendment over any section below it.
8. This file — sequencing, standing rules, stop conditions

Two names that will not match your memory of the docs: the authoritative
ledger table is **`credit_transactions`** (rebuilt as integers by v60), not
`credit_ledger` as CREDITS.md's draft SQL called it, and its columns are
`amount` / `balance_type` / `clerk_user_id`. CREDITS.md now carries the
reconciliation table; the decisions are unchanged, only the names.

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
- **This repo holds two products; you own one.** Cortex sessions work
  `cortex/**` and the Rust backend. HeyVera Socials (PR #438, branch
  `fix/socials-message-integrity`) is handled in a HeyVera conversation —
  never review, merge, or rebase it from a Cortex session. The only thing
  that crosses the line is the shared migration counter, and it crosses as a
  wait, not as work.
- **Pricing and customer-facing decisions belong to Josh.** Flag, don't decide.

## Definition of done — "ready for external users"

The lanes below are not the goal; this is. Every task exists to move a row
here from no to yes, and a lane that is "finished" while a row is still no
is not finished.

| # | A stranger can… | Gated on |
|---|---|---|
| 1 | reach a Cortex that is running current code | A0 (deploy unfrozen and firing) |
| 2 | sign up and land somewhere coherent | F1, F4, WorkOS (3.6) |
| 3 | connect a repo and start a task | F3 (GitHub App), C1–C2 |
| 4 | see what it will cost before it runs | SURFACE cost-confidence section |
| 5 | get work back with a receipt they believe | V1–V5 |
| 6 | be charged correctly, and refunded when it fails | #437 live, V4, **V7 before refund copy ships** |
| 7 | pay Cortex at all | JOSH-ACTIONS §5 — entity, ToS, Stripe |
| 8 | trust it with a real repo | 3.4 sandboxes, 2.7 secret scanning, red-team pass |

Row 7 is a Josh gate with multi-day external lead times, so it starts in
parallel with the build, not after it. Row 6's V7 dependency is the one
place where shipping early is actively harmful — a refund promise on an
unhardened verifier either leaks money or breaks trust.

**Josh is the acceptance test for rows 2–5** ([JOSH-ACTIONS.md](JOSH-ACTIONS.md)
§6). Ask for his pass before calling those done; an agent cannot judge whether
a first-time user is confused, because it already knows the answer.

## The queue

Work strictly in order inside each lane. Lane B may run parallel to Lane A
in cheap sessions.

**Lane A — the product**

| # | Task | Done when |
|---|---|---|
| A0 | Ship it. Once #411 lands, verify the deploy path actually fires and production runs current `main` — note PLAN §5's finding that auto-merge commits as `app/github-actions`, so `deploy-frontend.yml` has not triggered since 2026-07-23 (`GITHUB_TOKEN` pushes do not start workflows). Fix that trigger too | `/health` or equivalent on the VPS reports a build from this week, frontend included; Josh can log in |
| A1 | Land #437 (credits, v60). **#438 is HeyVera Socials — not this lane's work**; it is reviewed and merged in a HeyVera session. Your job is only to wait for it, because the migration counter forces #438 → #437. When #438 is on main: mark #437 ready, merge | `main` has migrations through v60 |
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

**Josh's own list — see [JOSH-ACTIONS.md](JOSH-ACTIONS.md).** His role is two
things: **using the product as a real user**, and holding credentials. Agents
do the rest. Surface these when relevant; never work around them.

- #411 host commands + merge (unfreezes deploys). Gated on a Tailscale
  authorization click, not on Josh running commands — once authorized, an
  agent with SSH runs the sequence; only a `/etc/cortex` write may bounce
  back to him for sudo.
- Anthropic **rate-tier / spend-cap request** — the one that matters
  operationally (low tiers cap monthly spend and would strangle launch week).
  The §A.1 commercial comfort check is *optional insurance*, not a blocker:
  operator API keys powering a product is the API's intended use; §D.4
  covers reselling access, which Cortex does not do. Its only real value is
  as a saved answer for a future enterprise security review.
- UNVERIFIED pricing row: approve/reject (recommendation: approve)
- SOC 2 clock: trigger condition + concrete path are in the doc
- Legal entity + Terms of Service + privacy policy before Stripe goes live
- `OPENCODE_ZEN_API_KEY` on the VPS for live Zen testing
- GHAS billing decision (blocks dependency-review restoration)

## State as of this handoff

Merged: #439 (Zen provider — three providers wired, OpenAI-compatible seam
ready for the next gateway), #440 (VERIFIER.md), #442 (this plan set).

Open PRs, verified against GitHub at handoff time — the whole list, so
nothing looks like a surprise later:

| PR | State | Whose |
|---|---|---|
| #437 credits (v60) | draft, mergeable, waits on #438 | **yours (A1)** |
| #438 Socials (v53–v59) | draft, mergeable, CI-green | HeyVera session |
| #411 db out of git tree | draft, mergeable | host step, then merge |
| #435 / #427 / #425 dependabot | open, checks failing | yours (B1) |
| #410 / #409 / #408 / #397 | open, archive-targeting | close (B3) |
| #105 Socials P09 | open, superseded | close (B3) |

Production: zero users, June 3 binary, decisions still free — that stops
being true at the first payment, which is why Lane A runs in the order it
does.
