# Idea To Production Loop

Status: active

This file describes the preferred way to turn a broad idea into production-ready work without skipping the shaping steps.

## Why This Exists

The weak version of building is:

1. someone has an idea
2. an assistant brainstorms
3. implementation starts

That is fast, but it often skips boundary checks, architectural shaping, and risk framing.

The stronger version is:

1. capture the idea clearly
2. shape it into a proposal
3. decide ownership and repo boundaries
4. record any structural decisions
5. break work into small execution slices
6. implement through PRs

## Recommended Flow

### 1. Discovery

Start with the broad human statement.

Example:

"In ClawNet I have wallet addresses and API keys that should be rotated in a truly secure environment with identity continuity and an auditable chain of authorization."

At this step, define:

- the problem
- why it matters
- what "10/10" means

Start in:

- a GitHub Discussion
- `internal/backlog/`
- or a structured issue draft

### 2. Proposal Shaping

Turn the idea into a proposal that answers:

- what problem are we solving
- why here, why now
- which repo owns the truth
- which repo is the first consumer
- what security properties matter
- what production-readiness means
- what can ship in slices

If the idea is serious, write a proposal in `docs/proposals/`.

### 3. Boundary Check

Before building, decide:

- does this belong in `Soma`, `claw-net`, or `pulse`
- what is canonical protocol truth
- what is consumer-specific integration truth
- what can stay internal for now

Example:

- rotation protocol semantics belong in `Soma`
- first-consumer integration belongs in `claw-net`
- product usage docs belong in the consumer repo

### 4. Decision Record

If the work changes structure, scope, trust model, or repo boundaries, write an ADR.

### 5. Work Breakdown

Open a parent issue for the initiative, then create sub-issues for:

- protocol/spec work
- consumer integration
- security review
- ops/deploy consequences
- documentation updates

Each PR should land one reviewable slice.

### 6. Production Readiness Gate

Before merging a large capability, ask:

- is the threat model written down
- are failure modes explicit
- is rollback/recovery clear
- is the first-consumer path real, not hypothetical
- do docs reflect the shipped shape

## Heuristic

Use this rule:

- brainstorming happens in discussion/backlog
- adopted design happens in proposals
- accepted structure happens in ADRs
- shipped truth happens in canonical docs
