# internal/ — private strategy docs

Anything in this folder is **private**. Do not publish externally, link from public docs, or paste into outreach without redaction.

## Convention

- Internal strategy, roadmaps, pricing analysis, partner pitches, competitive positioning, revenue models → here.
- Public-facing engineering docs (architecture, billing mechanics, integration guides for customers) → `docs/`.
- Public protocol specs, API references, philosophy, limits → live in their respective project repos (e.g. `Soma/docs/` for Soma, not here).

## Scope

These docs cover strategy across:
- Soma — scaling plans, internal audits, adoption strategy
- x402 ETag — protocol family roadmap, value capture, clawapis pilot
- ClawNet — positioning, moat analysis, revenue model options

## Naming

- `{topic}-strategy.md` for comprehensive strategy on one topic
- `{topic}-plan.md` for time-phased build/roll-out plans
- `{partner}-pitch.md` for partner-specific outreach drafts

If a doc needs to grow into multiple files, make a subdirectory (e.g. `internal/soma/` or `internal/x402-etag/`).

## Doc index (2026-04-05)

**Start here:**
- `roadmap.md` — **master what/why/todos doc. Single source of truth for forward plans.** Read this first.

**Soma Check (conditional payment protocol):**
- `soma-check-strategy.md` — canonical strategy, locked decisions
- `soma-check-billing.md` — 90/10 split math, volume paradox, scale projections
- `soma-check-header-spec.md` — ETag + X-Soma-* header contract
- `soma-onboarding-ladder.md` — 4-tier provider migration ladder

**Soma broader:**
- `cache-layers-distinction.md` — ClawNet L1/L2 cache vs Soma Check (CRITICAL: do not conflate)
- `funds-flow.md` — how money reaches providers + "is 10% sketchy?" professionalism analysis
- `groundbreaking-extensions.md` — extension ideas (Bazaar, transitive trust, 9.5, etc.)
- `proof-of-delivery-roadmap.md` — Receipt Layer 5-phase plan
- `scale-test-plan.md` — Soma scale test sequencing (blocks Receipt Layer)
- `soma-future-proofing.md` — pause-and-resume strategy

**Capture:**
- `brainstorm.md` — raw idea log, pre-sifting

## Convention for plans

Plans in this folder should always answer:
1. **What** — concrete deliverable
2. **Why** — motivation / unsolved problem / strategic rationale
3. **Todos** — actionable checklist items

The `roadmap.md` file enforces this pattern — follow suit in any new plan docs.
