# Team Architecture Round 2: Opus 4.7 Challenges GPT-5.5

## Core Verdict

GPT-5.5 designed the system we want in 18 months. Opus designed the system we need to ship in 6 weeks. The merged consensus builds GPT-5.5's schema, implements Opus's subset, and grows into the full model as users demand it.

**Final score: Opus wins 14, GPT-5.5 wins 10, Merge 3.**

GPT-5.5's wins are foundational (primitives, DAG, BranchSet, decision targeting, GitHub App, scheduler framing). Opus's wins are mostly about scope reduction (fewer layers, fewer types, fewer policies, defer features).

---

## 1. Concurrent Goal Arbitration

### GPT-5.5 Got Right
- Core insight — "collaboration is a scheduler problem first" — correct
- Five durable primitives (Goal, Step, Lease, Artifact, Evidence) is cleaner framing
- Supersession detection ("broader goal makes narrow fix obsolete") is genuinely novel

### Over-Engineered
- **6-layer conflict detection** — Layers 2-4 (Symbol, Domain, Contract) require full AST/language server that won't exist in v1-v3. Ship 2 layers (path + branch/diff), schema for 4.
- **8 impact levels** — `LikelyEdit` vs `DefiniteEdit` is unpredictable. `Migration`/`SecuritySensitive` are risk tags, not impacts. Collapse to 4: `Read | Edit | Exclusive | ContractChange`
- **0-100 numeric severity** — Fake precision. Thresholds prove you bucket into named levels anyway. Use ordinal named levels: `Parallel < Constrain < Queue < Block`
- **Full lease model** — Symbol/Domain/Contract leases need infrastructure that doesn't exist. Path leases with 3 modes (Read/Edit/Exclusive) ship now.
- **Merge train** — GitHub already has merge queues. Cortex tracks state, doesn't reimplement CI.

### What Both Miss
Semantic conflicts that don't touch the same files (function signature change in lib.rs, caller in main.rs). Honest answer: catch through test failures after merge, not prediction.

---

## 2. Cross-Repo Orchestration

### GPT-5.5 Got Right
- **Typed DAG of GlobalSteps** — cleaner than CrossRepoDep edges, self-documenting
- **BranchSet** — essential for cross-repo, simple concept, high value
- **Compensation steps** — real problem for partial failures

### Over-Engineered
- **ContextArtifact typed enum** — requires code changes for new artifact types. Use freeform kind string + JSON Schema runtime validation.
- **6 step types** — CoordinationStep is a DAG join, CompensationStep is a flagged RepoStep. Collapse to 3: `Repo | CrossRepoContract | HumanGate`
- **4 release policies** — Ship AtomicPreferred with manual override only.

---

## 3. Team Chat Without Hardlocks

### GPT-5.5 Got Right
- **Decision-targeted questions** with `decision_id` — strictly better than PendingQuestion
- **Thread lifecycle tied to goal** — thread state IS goal state projection
- **Compaction with pinned decisions** — essential for long-running goals (but v2)

### Over-Engineered
- **6 thread types** — Collapse to 3: `Goal | Conflict | Review`
- **Presence system** — infrastructure cost not justified for small teams v1
- **Priority system with audit trail** — `Normal | Urgent` enum, audit through chat history

---

## 4. Frontend Orchestration Map

### GPT-5.5 Got Right
- **MapEvent SSE** — right transport for live updates
- **Typed MapNode/MapEdge** — explicit relationship semantics

### Over-Engineered
- **16 node types, 9 edge types** — unrenderable. Reduce to 4-5 nodes, 3-4 edges per view level.
- **ViewportHints** — backend concern leaking into frontend. Drop it.

### Opus Better
- **Hierarchical OrgMap→RepoMap→GoalMap** — matches user mental model, reduces payload vs flat graph.

---

## 5. GitHub Integration

### GPT-5.5 Got Right
- **GitHub App for repo operations** — team operations need org-scoped tokens, not personal tokens
- **Permission inheritance** — if GitHub says no, Cortex says no
- **6-table schema** — maps cleanly to GitHub data model

### Phase It
- v1: GitHub OAuth for identity + user's token for repo ops
- v2: GitHub App installation, permission inheritance, webhook sync

---

## Conflict Resolution Table

| # | Disagreement | Winner | Rationale |
|---|---|---|---|
| 1 | Conflict detection layers (6 vs 2) | **Opus** — ship 2, schema for 4 | AST/domain layers won't exist v1-v2 |
| 2 | Impact levels (8 vs 4) | **Opus** — 4 levels | LikelyEdit vs DefiniteEdit unpredictable |
| 3 | Conflict severity (0-100 vs named) | **Merge** — named with ordinal semantics | Numeric = fake precision |
| 4 | Lease model (full vs simple) | **Opus** v1, **GPT** schema v2 | Path leases ship now |
| 5 | Merge train | **Opus** — drop it | GitHub has merge queues |
| 6 | Supersession detection | **GPT-5.5** — keep it | Genuinely novel, prevents wasted work |
| 7 | Cross-repo step types (6 vs 3) | **Opus** — 3 types | Others are degenerate cases |
| 8 | DAG vs SubGoals | **GPT-5.5** — typed DAG | More expressive, self-documenting |
| 9 | BranchSet | **GPT-5.5** — keep it | Essential, simple, high value |
| 10 | ContextArtifact (typed vs freeform) | **Opus** — freeform + runtime validation | Extensible without code changes |
| 11 | Release policies (4 vs 1) | **Opus** v1 | Ship AtomicPreferred, add when needed |
| 12 | Compensation steps | **GPT-5.5** — but v2 | Real problem, not needed until cross-repo ships |
| 13 | Thread types (6 vs 3) | **Opus** — 3 types | Others are degenerate cases |
| 14 | Decision-targeted questions | **GPT-5.5** — adopt | Strictly better mechanism |
| 15 | Thread lifecycle = goal lifecycle | **GPT-5.5** — adopt | Eliminates state sync issues |
| 16 | Chat compaction | **GPT-5.5** — but v2 | Not needed until goals run long |
| 17 | Presence system | **Opus** — drop v1-v2 | Infrastructure cost not justified |
| 18 | Priority/urgency | **Opus** — simplify | Normal/Urgent enum, audit via history |
| 19 | Map types (16+9 vs 4+4) | **Opus** — fewer per level | Flat graph unrenderable |
| 20 | Map transport | **GPT-5.5** — SSE | Right choice for live data |
| 21 | ViewportHints | **Opus** — drop | Backend leaking into frontend |
| 22 | Hierarchical vs flat map | **Opus** — hierarchical | Matches user mental model |
| 23 | GitHub App vs OAuth-only | **GPT-5.5** — App (phased) | Team ops need org-scoped tokens |
| 24 | Permission inheritance | **GPT-5.5** — keep | Don't reinvent permissions |
| 25 | Background membership refresh | **Opus** — drop v1 | Login + webhook sufficient |
| 26 | Core primitives framing | **GPT-5.5** — adopt | Goal/Step/Lease/Artifact/Evidence is right |
| 27 | Scheduler-first philosophy | **GPT-5.5** — adopt with caveat | Correct, but don't delay shipping chat |
