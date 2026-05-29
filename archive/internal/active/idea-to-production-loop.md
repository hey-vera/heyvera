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
2. triage owner, stage, confidence, and next action
3. shape it into a proposal
4. decide ownership and repo boundaries
5. record any structural decisions
6. break work into small execution slices
7. implement through PRs

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
- `internal/triage/` if owner or next action is unclear
- or a structured issue draft

### 2. Triage

Before a brainstorm becomes execution work, classify it in `internal/idea-triage-index.md`.

Required fields:

- repo owner: `Soma`, `claw-net`, `pulse`, `cross-repo`, or `unsure`
- stage: `brainstorm`, `discovery`, `proposal-candidate`, `ADR-candidate`, `implementation-candidate`, or `archive`
- confidence: `high`, `medium`, or `low`
- next action: `leave`, `research`, `project-card`, `proposal`, `ADR`, `issue`, or `archive`
- canonical target if accepted

Do not create implementation issues from raw brainstorms.

### 3. Proposal Shaping

Turn the idea into a proposal that answers:

- what problem are we solving
- why here, why now
- which repo owns the truth
- which repo is the first consumer
- what security properties matter
- what production-readiness means
- what can ship in slices

If the idea is serious, write a proposal in `docs/proposals/`.

### 4. Boundary Check

Before building, decide:

- does this belong in `Soma`, `claw-net`, or `pulse`
- what is canonical protocol truth
- what is consumer-specific integration truth
- what can stay internal for now

Example:

- rotation protocol semantics belong in `Soma`
- first-consumer integration belongs in `claw-net`
- product usage docs belong in the consumer repo

### 5. Decision Record

If the work changes structure, scope, trust model, or repo boundaries, write an ADR.

### 6. Work Breakdown

Open a parent issue for the initiative, then create sub-issues for:

- protocol/spec work
- consumer integration
- security review
- ops/deploy consequences
- documentation updates

Each PR should land one reviewable slice.

### 7. Production Readiness Gate

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
