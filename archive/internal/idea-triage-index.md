# Idea Triage Index

Status: canonical

This is the operating index for turning brainstorms into production work without losing good ideas or promoting weak ones too early.

Use it before creating implementation issues. The flow is:

`internal note -> triage row -> GitHub Project discovery card -> proposal -> ADR when needed -> implementation issue/PR`

## Promotion Gates

- `project-card`: use for high-signal ideas that need shaping, ownership, or cross-repo coordination.
- `proposal`: use when the idea is serious enough to review and slice.
- `ADR`: use when the idea changes repo boundaries, trust model, product scope, production behavior, release posture, public package API, or protocol semantics.
- `issue`: use only after the next action is concrete enough to execute.
- `archive`: use when the idea is superseded, historical, or not actionable.
- `partial-foundation`: use when code or docs exist but the idea has not passed its proposal/ADR/spec/readiness gates.

## Completion Rule

An idea is not complete just because code exists or an experiment worked. Mark it terminal only as:

- `shipped`: accepted proposal, ADR/spec if needed, implementation merged, tests/docs updated, rollout/deploy completed when applicable.
- `rejected`: decision recorded with rationale.
- `archived`: preserved with status metadata and no longer treated as active truth.
- `superseded`: linked to the newer proposal, ADR, issue, or shipped implementation that replaced it.

For cross-repo work, the weakest required dependency controls completion. A ClawNet integration cannot be done if Soma semantics, trust model, package/API surface, or security posture is still undecided.

## Evidence Ledger Rule

Use an evidence ledger when a feature or idea was built before this operating system, salvaged from old notes, or partially implemented before its proposal/ADR/spec gates. The ledger is intentionally small:

- `current status`: `partial-foundation`, `proposal`, `ADR-needed`, `implementation-ready`, `shipped`, `superseded`, `archived`, or `rejected`.
- `vision fit`: why it still serves Soma, ClawNet, Pulse, or the cross-repo system.
- `security exposure`: what risk class it touches and whether the current evidence is enough.
- `upstream dependencies`: unresolved protocol/spec/package/runtime decisions.
- `missing evidence`: tests, docs, threat model, rollout, owner decision, or user/operator proof.
- `blocks current work`: whether this must be resolved now or can remain parked.
- `next gate`: proposal, ADR/spec, issue, focused audit, implementation slice, archive, or rejection.
- `terminal condition`: the concrete state that makes it done.

Do not audit the whole repo randomly. Add or update a ledger only when old work becomes active, security-sensitive, production-facing, confusing to agents, or blocks a current slice.

## Current High-Priority Queue

| Idea | Source | Owner | Stage | Confidence | Next action | Notes |
|---|---|---|---|---|---|---|
| Soma credential / wallet rotation controller | `internal/backlog/soma-rotation-controller-vision.md`, `internal/backlog/wallet-rotation-architecture.md`, `docs/proposals/credential-rotation-first-consumer.md` | cross-repo | proposal | high | proposal + ADR | Active current thread: Soma owns rotation semantics; ClawNet is first consumer and production tester. |
| Rotation battle-test and rollout | `internal/active/rotation-battle-test-and-roadmap.md` | cross-repo | proposal-candidate | high | project-card | Tie to ClawNet first-consumer rollout and Soma protocol issue. |
| Threat model, rollback, recovery | `internal/backlog/credential-rotation-architecture.md`, `internal/backlog/wallet-rotation-architecture.md` | cross-repo | proposal-candidate | high | proposal | Needs explicit rollback/recovery path before production rollout. |
| Soma 1.2 trust teeth | `internal/backlog/soma-1-2-scope.md`, `internal/backlog/soma-1-2-adversarial-pressure-test.md`, `internal/backlog/trust-accountability-teeth.md` | Soma | discovery | medium | project-card | Protocol-heavy; do not implement from ClawNet without Soma ADR/spec work. |
| ClawNet as first trust-mining/verification proving ground | `internal/active/soma-trust-mining.md`, `internal/backlog/trust-mining-economy.md`, `internal/backlog/proving-verification-revenue.md` | cross-repo | discovery | medium | proposal-candidate | Large strategic direction; keep away from implementation until scope is narrowed. |
| Pulse as Soma agent tree / custody demonstration | `docs/proposals/soma-agent-tree.md` in Pulse, related ClawNet notes | pulse | proposal-candidate | medium | project-card | Product-specific only if it serves Pulse X-agent behavior; protocol semantics stay in Soma. |
| Cortex Operations Room foundation | `internal/backlog/cortex-operations-room-foundation-checklist.md`, `docs/proposals/cortex-operations-room-contract.md`, `docs/reference/cortex-operations-room.md`, `docs/proposals/live-orchestration-mapping-view.md`, `docs/proposals/cortex-deployment-capability-adapters.md`, `docs/decisions/ADR-0007-cortex-deployment-capability-adapters.md`, `internal/vision/cortex.md` | cross-repo | proposal | medium-high | implementation slices | Product/surface contract promoted; event log and run timeline shipped. Next slices: task-run binding, task inspector projection, evidence gate, leases, and read-only deployment adapter inspection. |

## Owner Buckets

### Soma

| Source | Stage | Confidence | Next action | Reason |
|---|---|---|---|---|
| `internal/active/soma-delegation-spec.md` | proposal-candidate | high | proposal | Normative delegation semantics belong upstream in Soma. |
| `internal/active/soma-check-header-spec.md` | proposal-candidate | high | proposal | Protocol/wire contract; ClawNet can consume but should not own canonical spec. |
| `internal/active/soma-custody.md` | discovery | medium | project-card | Protocol primitive; needs boundary check against ClawNet custody endpoints. |
| `internal/active/soma-computation-witness.md` | discovery | medium | project-card | Protocol/trust model idea; needs threat model before implementation. |
| `internal/active/soma-security-audit-2026-04-07.md` | archive/reference | high | archive | Audit input; mine for issues, do not treat as current product truth. |
| `internal/active/soma-security-audit-2026-04-09.md` | archive/reference | high | archive | Audit input; mine for issues, do not treat as current product truth. |
| `internal/active/soma-heart-deep-audit-2026-04-09.md` | archive/reference | high | archive | Audit input; compare with current Soma before creating issues. |
| `internal/active/soma-heart-hacker-audit-2026-04-09.md` | archive/reference | high | archive | Attack-playbook input; promote only concrete unfixed findings. |
| `internal/backlog/soma-horizon.md` | brainstorm | low | leave | Future-looking protocol ideas; too broad for execution. |
| `internal/backlog/secret-scanner.md` | discovery | medium | project-card | Could become a Soma package/tool proposal if still aligned. |
| `internal/backlog/soma-agent-auth-paid-upgrades.md` | brainstorm | low | leave | Monetization idea; not core protocol until clearer. |

### ClawNet

| Source | Stage | Confidence | Next action | Reason |
|---|---|---|---|---|
| `internal/active/roadmap.md` | discovery | high | project-card | Platform roadmap; use to create small ClawNet issues only after current main is verified. |
| `internal/active/cache-layers-distinction.md` | proposal-candidate | high | proposal | ClawNet billing/cache docs and behavior boundary. |
| `internal/active/clawnet-quality-audit-2026-04-09.md` | discovery | medium | project-card | Mine for concrete quality issues; verify against current main first. |
| `internal/active/tech-landscape-audit-2026-04-09.md` | discovery | medium | research | Modernization ideas; require current-source check before adoption. |
| `internal/active/revenue-architecture.md` | discovery | medium | proposal-candidate | ClawNet economics; avoid mixing with Soma protocol economics. |
| `internal/active/founding-protocol.md` | discovery | medium | proposal-candidate | Strategic ClawNet operating model; not implementation truth. |
| `internal/backlog/future-pricing-ideas.md` | brainstorm | medium | leave | ClawNet pricing ideas; proposal only when product decision is needed. |
| `internal/backlog/moduleresolution-nodenext-migration.md` | implementation-candidate | medium | issue | Technical migration; verify current TS config first. |
| `internal/backlog/exit-and-opt-out.md` | discovery | medium | proposal-candidate | Product/trust principle; may need ADR if it changes user guarantees. |

### Pulse

| Source | Stage | Confidence | Next action | Reason |
|---|---|---|---|---|
| `docs/proposals/soma-agent-tree.md` in Pulse | proposal-candidate | medium | project-card | Pulse product integration with Soma; keep Pulse-specific. |
| `internal/backlog/heydata-clawapis-soma-pitch.md` | brainstorm | low | leave | External/product pitch; not Pulse execution yet. |
| Pulse-related notes inside `internal/backlog/brainstorm.md` | brainstorm | low | triage | Extract only if they affect X-only marketing-agent scope. |

### Cross-Repo

| Source | Stage | Confidence | Next action | Reason |
|---|---|---|---|---|
| `internal/backlog/credential-rotation-architecture.md` | proposal-candidate | high | proposal | Crosses Soma semantics and ClawNet first-consumer implementation. |
| `internal/backlog/wallet-rotation-architecture.md` | proposal-candidate | high | proposal | Wallet/API credential rotation needs protocol + platform boundary split. |
| `internal/backlog/soma-rotation-controller-vision.md` | proposal-candidate | high | proposal | Directly related to current credential rotation work. |
| `internal/backlog/soma-continuous-identity.md` | discovery | medium | project-card | Identity continuity affects Soma protocol and ClawNet policy. |
| `internal/backlog/soma-trust-architecture-rough.md` | brainstorm | medium | leave | Rough cross-repo trust direction; distill before issue creation. |
| `internal/backlog/soma-verified-server-access-rough.md` | brainstorm | medium | leave | Security-sensitive; needs threat model and owner split. |
| `internal/backlog/proof-of-delivery-roadmap.md` | discovery | medium | project-card | Crosses receipts, trust, and platform behavior. |
| `internal/backlog/provenance-chain-architecture.md` | discovery | medium | proposal-candidate | Crosses protocol provenance and ClawNet runtime. |
| `internal/backlog/x402-upto-and-visa-agent-cards.md` | brainstorm | low | research | External protocol/payment idea; needs current-source research before promotion. |

### Unsure / Keep As Idea Garden

| Source | Stage | Confidence | Next action | Reason |
|---|---|---|---|---|
| `internal/backlog/brainstorm.md` | brainstorm | low | triage | Running log; extract only specific high-signal ideas. |
| `internal/backlog/groundbreaking-extensions.md` | brainstorm | low | triage | Broad idea set; split before promotion. |
| `internal/backlog/moat-compounding-thesis.md` | brainstorm | low | leave | Strategic narrative; not execution work by itself. |
| `internal/backlog/rating.md` | brainstorm | low | archive-or-triage | Contains raw scoring and critique; extract only durable decisions. |
| `internal/backlog/dsdsdsds.PNG` | artifact | low | archive-artifacts | Non-doc artifact currently in backlog; move only when safe in a cleanup PR. |
| `internal/archive/*` | archive | high | leave | Historical/reference material unless a specific idea is revived. |
| `internal/archive-artifacts/*` | artifact | high | leave | Preserved raw artifacts, not planning docs. |

## Current Credential Rotation Path

Use this flow for the active Soma credential rotation work:

1. Keep the broad idea in the ClawNet project item and proposal doc.
2. Keep Soma protocol semantics in the Soma issue/proposal/ADR track.
3. Keep ClawNet first-consumer implementation in ClawNet issues/PRs.
4. Require threat model, rollback, recovery, and docs update before production rollout.
5. Do not implement straight from brainstorm notes.
6. Treat existing inert foundation work as `partial-foundation` until Soma protocol semantics and the ClawNet rollout/readiness gates are accepted.

## Maintenance Rule

Update this index whenever a brainstorm is promoted, archived, or split into repo-specific work. If a row becomes implementation-ready, it should point to a GitHub issue or PR.
