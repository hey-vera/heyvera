# Cortex: The Definitive Vision

**Version:** 1.0
**Date:** May 19, 2026
**Synthesized from:** 4 rounds of dual-brain debate (GPT-5.5 + Opus 4.7), 70+ research papers, and production infrastructure audit
**Status:** Canonical reference document. Supersedes all prior vision docs.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [The Cortex Stack](#2-the-cortex-stack)
3. [The 5-Layer Routing Architecture](#3-the-5-layer-routing-architecture)
4. [The Soma Integration Layer](#4-the-soma-integration-layer)
5. [The x402 Data Layer](#5-the-x402-data-layer)
6. [The Dial System](#6-the-dial-system)
7. [Competitive Positioning](#7-competitive-positioning)
8. [Build Sequence](#8-build-sequence)
9. [The HeyVera Platform Map](#9-the-heyvera-platform-map)
10. [Risk Analysis](#10-risk-analysis)
11. [The 10 Things That Make Cortex + Soma + ClawNet Unprecedented](#11-the-10-things-that-make-cortex--soma--clawnet-unprecedented)
12. [Research Foundation](#12-research-foundation)

---

## 1. Executive Summary

### What Cortex Is

Cortex is a learning operating system for AI-assisted development. It is not an LLM router. It is not a chatbot. It is not an IDE plugin. It is a five-layer intelligence system that decomposes developer intent into structured work, routes that work to the best available models and providers, enforces safety invariants that cannot be learned away, collects objective evidence of outcomes, and uses that evidence to improve every future decision. The system adapts continuously: it learns which model handles which task shape in which repository context, detects when providers drift, routes around failures, and explains every decision it makes.

### Why It Matters

The AI coding tool market is $12.8 billion in 2026 and growing at 27% CAGR. Every major tool -- Cursor ($2B ARR), Copilot (4.7M paid users), Claude Code (satisfaction leader at 46%) -- routes to models internally, but none treat routing as a learning problem. They pick models by tier or cost. They do not learn from outcomes. They do not decompose multi-step intent. They do not enforce evidence-based verification floors. They do not pool subscriptions across teams. They do not provide cryptographic proof of what their agents did. Cortex does all of this, and it does it on infrastructure that already exists in production.

### What Makes It Unprecedented

Cortex sits on top of Soma and ClawNet -- production systems that solve problems the rest of the industry treats as unsolved. Soma Delegation provides scoped, bounded, revocable agent-to-agent authority transfer with cascade revoke, spend caps, and intent declaration. No other protocol has this. Soma Check provides ETag-based data freshness verification so agents know whether to pay for updated data. Soma Pulse Tree provides cryptographic proof of an agent's entire execution history compressed into 192 bytes. ClawNet provides production x402 payment routing. These are not roadmap items. They are running at localhost:3402 with metrics endpoints live.

The combination of a learning routing brain (Cortex), a cryptographic identity and trust heart (Soma), and a payment nervous system (ClawNet) creates a platform that no competitor can replicate by building a better autocomplete engine. It is infrastructure-layer differentiation.

---

## 2. The Cortex Stack

```
                    +---------------------------+
                    |      User (Dial 1-10)     |
                    |  "Fix the auth bug and    |
                    |   write tests for it"     |
                    +-------------+-------------+
                                  |
                                  v
                    +---------------------------+
                    |      Cortex Brain         |
                    |  5-Layer Routing Engine    |
                    |  (Intent -> Schedule ->   |
                    |   Policy -> Route ->      |
                    |   Evidence -> Learn)      |
                    +-------------+-------------+
                                  |
                    +-------------+-------------+
                    |       Soma Heart          |
                    |  Identity + Trust +       |
                    |  Delegation + Pulse Tree  |
                    |  (Cryptographic proofs    |
                    |   from birth)             |
                    +-------------+-------------+
                                  |
                    +-------------+-------------+
                    |     ClawNet Router        |
                    |  x402 Payment +           |
                    |  Delegation Enforcement + |
                    |  Data Marketplace         |
                    |  (Production Q1 2026)     |
                    +-------------+-------------+
                                  |
                    +-------------+-------------+
                    |        Workers            |
                    |  User containers ONLY     |
                    |  Never VPS. Never cloud.  |
                    |  Code stays local.        |
                    +---------------------------+
```

### Layer Responsibilities

**User Layer.** The developer expresses intent through natural language and a single dial (1-10) that controls how much resource investment they want. The dial adjusts cost, parallelism, verification depth, and autonomy -- but never safety. A developer at dial 1 and a developer at dial 10 both get the same evidence floors for high-risk auth changes.

**Cortex Brain.** The five-layer routing intelligence. Decomposes intent into a DAG of typed work nodes. Schedules them with scoped blocking and route-around-blocks. Enforces invariant policy constraints that no learner can override. Selects models, providers, agent topologies, and verification strategies using contextual bandits. Collects objective evidence and attributes credit across the pipeline. Learns continuously from outcomes.

**Soma Heart.** The identity and trust layer. Every agent spawned by Cortex gets a Soma identity. When Cortex operates at dial 7+, agents receive Soma Delegation keys with spend caps, scope narrowing, depth limits, and cascade revoke. Every action updates the Soma Pulse Tree -- an MMR with typed leaves and sum annotations that provides cryptographic proof of the agent's entire execution history. Trust scores decay on ephemeral identities and accumulate on established ones.

**ClawNet Router.** The payment and data infrastructure. Handles x402 payment flows for data marketplace transactions. Enforces delegation key constraints at serving time. Provides metrics endpoints for delegation chain health. Routes payments to the right facilitator on the right network (Base, Solana, Stellar).

**Workers.** Execute in user containers. Raw code never leaves the user's machine. No VPS. No cloud compute. This is the trust foundation -- Cortex orchestrates, but execution happens where the user's code lives.

### What Day 1 Looks Like

Opus correctly identified that GPT's synthesis never described the actual developer experience. Here is what using Cortex looks like, concretely:

**Individual developer, day 1:**

```bash
# Install
cargo install cortex-cli

# Connect your existing subscriptions (OAuth, no API keys)
cortex auth add anthropic  # Opens browser, OAuth flow
cortex auth add openai     # Opens browser, OAuth flow

# That's it. Start working.
cortex route "fix the login bug in src/auth/login.ts" --dial 5

# Cortex:
# - Detects task: BugFix, TypeScript, auth/ (High risk)
# - Selects BestSingle template (dial 5, single provider)
# - Routes to Claude Sonnet (strongest prior for TS bug fixes)
# - Evidence floor: compile + existing tests + repro test (High risk)
# - Autonomy: AskBeforeProceeding (High risk, first time in this repo)
#
# Output:
# "I've analyzed the session timeout bug in src/auth/login.ts.
#  Proposed fix: [diff]. This touches auth code (High risk).
#  Evidence: TypeScript compiles. 12/12 existing tests pass.
#  Confidence: 0.72 (limited by first observation in this repo).
#  Approve? [y/n]"
```

**No configuration wizard. No dashboard. No provider setup beyond OAuth.** The value is instant. Configuration (dial defaults, risk overrides, provider preferences) is available but never required.

**Team, month 2:**

```bash
# Team lead sets up pooling
cortex team create "backend-team"
cortex team add-sub anthropic-max --share
cortex team add-sub openai-pro --share
cortex team add-sub gemini-advanced --share
cortex team invite alice@company.com bob@company.com

# Team members use Cortex normally. Subscriptions are pooled.
# Fair-share allocation prevents any member from dominating.
# Alice's critical-risk auth work gets priority over Bob's docs cleanup.
# Routing decisions use team-level evidence, not just individual history.
```

**Enterprise, month 6:**

```bash
# Platform engineer configures policy
cortex policy set --risk-floor "billing/**" critical
cortex policy set --privacy-deny google-cloud  # No code to Google
cortex policy set --evidence-floor critical "compile + tests + security-scan + independent-review + human-review"
cortex policy set --max-delegation-depth 3
cortex policy set --audit-retention 7-years

# Developers use Cortex normally. Policies are invisible but enforced.
# Every routing decision is logged with full audit trail.
# Pulse Tree provides cryptographic proof for compliance.
```

### What It Is NOT

To prevent scope confusion, here is what Cortex explicitly does not do:

- **Cortex is not an editor.** It does not provide syntax highlighting, code completion, or file management. It integrates with existing editors via plugins.
- **Cortex is not a chat interface.** It does not have a conversation UI. It takes a goal, decomposes it, executes it, and reports results.
- **Cortex is not a model provider.** It does not serve model inference. It routes to existing providers using the user's own subscriptions.
- **Cortex is not a CI/CD system.** It does not replace GitHub Actions, Jenkins, or any build system. It uses existing CI as an evidence source.
- **Cortex is not a project management tool.** It does not track sprints, user stories, or roadmaps. It tracks work nodes within a single task decomposition.
- **Cortex is not a VPS or cloud compute provider.** Workers execute in user containers on the user's machine. Cortex never runs code remotely.

### Data Flow

```
User intent
  |
  v
[Intent Decomposer] --> IntentGraph (typed DAG)
  |
  v
[Intent Scheduler] --> ready nodes (scoped blocking, route-around)
  |
  v per ready node
[Policy Gate] --> filtered candidates (privacy, budget, evidence floor, auth)
  |
[Capacity Tracker] --> available providers (subscriptions, health, reservations)
  |
[Dial Mapper] --> resource envelope (relative to subscription pool)
  |
  v
[Route Scorer] --> ranked strategies (UCB v1, Thompson v2)
  |
[Autonomy Gate] --> proceed / suggest / block (confidence x risk thresholds)
  |
  v
[Workers execute in user container]
  |
  v
[Evidence Collection] --> append-only ledger (compile, test, CI, user feedback)
  |
[Attribution Engine] --> contamination-aware causal credit (capped at 1.0/event)
  |
[Belief Updater] --> hierarchical beliefs (global > tenant > repo > context)
  |
  v
[Learning loop closes: next routing decision is better]
```

---

## 3. The 5-Layer Routing Architecture

This section summarizes the merged consensus from four rounds of GPT-5.5 vs Opus 4.7 dual-brain debate. The full consensus document with all Rust types is at `.dualbrain/routing-intelligence-consensus.md` (1686 lines, 45 conflict resolutions, definitive type definitions).

### Design Principles

Ten principles govern the entire architecture. These are not aspirational. They are enforcement boundaries.

1. **Evidence floor NEVER bends to dial.** Dial 1 on a high-risk auth change still requires the full evidence floor for that risk class. The dial controls optional investment above the floor, never verification below it.

2. **Simple learner on clean evidence beats sophisticated learner on garbage.** v1 ships UCB scoring over an append-only evidence graph with contamination tracking. Thompson sampling comes in v2 after evidence quality is validated.

3. **Route templates CONFIGURED, selection LEARNED.** Humans define safe, auditable route template schemas. The learner picks which template works best for which task shape. The learner does not invent arbitrary execution graphs.

4. **Risk classification is INVARIANT floor, not purely learned.** File-path patterns for auth/payments/secrets/crypto establish a minimum risk class. Learned classifiers can raise risk, never lower it below the invariant floor.

5. **Contamination is a first-class dimension.** Every signal carries reward, confidence, and contamination penalty. A generated test passing against generated code is not as trustworthy as a human-written regression test passing after independent review.

6. **Causal credit sums capped at 1.0 per event.** Even for failures with joint responsibility, the total credit weight per evidence event must not exceed 1.0. This prevents double-penalization of routes.

7. **Confidence decides current action; reward updates future belief.** These are separate axes. A route can have high confidence (proceed autonomously) but uncertain reward (still learning which template is best).

8. **Circuit breaker thresholds are CONFIGURED, not learned.** Learning the threshold creates a meta-learning problem. The detection signals that trigger the breaker may come from learned detectors, but the threshold itself is policy.

9. **Exploration scales with dial level.** At dial 1, exploration must be cheap or absent. At dial 10, full counterfactual evaluation is permitted. The cost of exploration must be proportional to the user's investment posture.

10. **Append-only evidence graph with compensating updates.** History is never mutated. Delayed negative evidence (reverts, incidents) appends compensating updates. Beliefs are derived state, recalculated from the immutable ledger.

### Layer 1: Intent Decomposer

**Purpose:** Transform a user's natural language goal into a typed, dependency-aware work graph.

**Input:** User goal string + repository context + risk metadata.

**Output:** `IntentGraph` -- a DAG of `WorkNode` entries connected by typed edges (`Then`, `Parallel`, `FeedsInto`, `IteratesOver`, `BlockedUntilUser`).

**Key types:**
- `IntentShape` classifies the overall goal: `SingleTask`, `MultiPhaseBuild`, `IterativeAudit`, `DiscussionThenExecution`, `Investigation`, `Deployment`, `IncidentResponse`, `ResearchAndProposal`, `OpenEndedExploration`, `Mixed`.
- `WorkNodeKind` classifies individual work units: `Clarify`, `Plan`, `Research`, `InspectCode`, `Implement`, `Test`, `Review`, `Verify`, `Deploy`, `Document`, `AskUser`, `WaitForUserAction`, `Decide`, `Summarize`.
- `IterationSpec` handles repeated work: `Once`, `NTimes(u32)`, `UntilCondition { condition, max }`, `UntilUserSatisfied { max }`.

**Example decompositions:**

| User goal | IntentShape | Work nodes |
|-----------|-------------|------------|
| "Fix the login bug" | SingleTask | InspectCode -> Implement -> Test -> Verify |
| "Fix the auth bug and write tests" | MultiPhaseBuild | InspectCode -> (Implement \| Test writing in parallel) -> Verify |
| "Run 20 security audit rounds" | IterativeAudit | 20+ nodes with `IteratesOver` edges, later rounds narrower/cheaper |
| "Discuss approach, then build it" | DiscussionThenExecution | Plan {requires_user_action: true} -> BlockedUntilUser -> Implement -> Test |

**Design rationale:** "20 security audit rounds" at dial 8 does not mean 20x dial-8 cost. Later rounds have narrower scope and incremental findings. The decomposer captures this via `IterationSpec` and dependency edges. Each node gets its own independent routing decision.

**Research basis:** GoalAct (NCIIP 2025 Best Paper) validates continuously-updating global plans with hierarchical skill execution. HiPlan validates retrieval-augmented milestone libraries from past successful trajectories. DELTA validates dependency DAG representations for coding work.

### Layer 2: Intent Scheduler

**Purpose:** Track ready, blocked, and waiting nodes. Route around blocked work so progress continues.

**Key behavior:** When a node blocks on user input, sibling nodes that are ready continue executing. When a dependency fails, only dependent nodes are blocked. Capacity reservation accounts for blocked nodes that may unblock soon.

**Scheduler tick questions:**
1. Which nodes are ready?
2. Which nodes are blocked?
3. Which blocked nodes have runnable siblings?
4. Which ready nodes fit the dial envelope?
5. Which ready nodes fit available capacity?
6. Which nodes require user confirmation?
7. Which nodes can proceed autonomously?

**Key types:**
- `WorkNodeState`: `Pending`, `Ready`, `Running`, `Blocked`, `WaitingForUser`, `WaitingForExternalSystem`, `Completed`, `Failed`, `Cancelled`, `Superseded`.
- `BlockerKind`: `NeedsUserClarification`, `NeedsUserApproval`, `NeedsUserShellCommand`, `NeedsExternalCi`, `NeedsVpsAccess`, `NeedsSecretOrCredential`, `CapacityUnavailable`, `PolicyForbidden`, and more.
- `BlockerScope`: `NodeOnly` (just this node), `Subtree` (this node and dependents), `Intent` (entire graph), `Global` (all active intents).
- `DependencyKind`: `MustCompleteBefore`, `ShouldCompleteBefore`, `BlocksIfFailed`, `ProvidesContext`, `ProvidesVerification`, `AlternativePath`.

**Design rationale:** Most multi-agent systems either stall entirely on any blocker or proceed recklessly. Scoped blocking is the middle ground -- the system continues useful work while preserving causal integrity. This is what makes multi-step coding workflows actually complete instead of stalling.

### Layer 3: Invariant Policy Gate + Capacity Tracker + Dial Mapper

Three sub-systems that **must remain separate** because they serve fundamentally different purposes:

#### 3a. Invariant Policy Gate

The hard constraints the learner cannot override. The policy gate filters candidates before the learner sees them.

**Policy stack (evaluated in order, learner cannot override steps 1-6):**
1. **Privacy Policy** -- which providers may see which code, per-stage evaluation
2. **Auth Policy** -- which subscriptions are authorized for which repos
3. **Budget Ceiling** -- per-task, per-session, per-day, per-month hard limits
4. **Evidence Floor** -- minimum verification by risk class and task family
5. **Independence Requirements** -- different-model or different-provider verification for high risk
6. **Risk Classification** -- invariant floor from file-path glob patterns

**Risk classification is an invariant floor:**
- `auth/`, `credentials/`, `secrets/`, `crypto/` patterns: minimum `High` risk
- `billing/`, `payments/`, `migrations/` patterns: minimum `High` risk
- `tests/`, `utils/`, `helpers/` patterns: minimum `Medium` risk
- `docs/`, `README`, `CHANGELOG` patterns: `Low` risk
- Learned classifiers can raise risk above the floor. They can never lower it below.

**Evidence floors by task and risk:**

| Task Family | Low Risk | Medium Risk | High Risk | Critical Risk |
|-------------|----------|-------------|-----------|---------------|
| BugFix | compile | compile + existing tests + repro test (optional) | compile + tests + repro + independent review | All + human review |
| Security | compile + tests + security scan + independent review (always) | Same | Same | Same + dual-brain |
| Refactor | compile | compile + existing tests | compile + tests + API compat + review | All + human review |
| Docs | link check (optional) | link check + example execution | Same + review | Same + human review |

**AbstentionBench finding (TACL 2025):** Reasoning-tuned models degrade abstention by 24% on average. This means Cortex cannot trust model self-reported confidence. The evidence floor exists because external objective verification is mandatory -- models do not reliably know their own limits.

#### 3b. Capacity Tracker

**Purpose:** Track subscription state, provider health, rate limits, and capacity reservations.

**Key type:** `ProviderSubscription` -- a rich representation of each available subscription including auth reference, plan details, model entitlements, sharing policy, and privacy policy.

**Model entitlements** track per-model capabilities: `supports_tools`, `supports_long_context`, `supports_images`, `supports_patch_output`, `max_context_tokens`, `max_output_tokens`, `cost_hint` (SubscriptionIncluded vs Metered), and `quality_tier` (Budget/Standard/Premium/Frontier).

**Capacity snapshots** capture live state: `availability` (Available/Degraded/RateLimited/Exhausted/AuthFailed/DisabledByPolicy), remaining capacity, cooldown timers, observed latency percentiles, recent error rate, and active reservation count.

**Circuit breakers** are configured, not learned:
- 5-minute sliding window
- 30% error rate threshold triggers `Open` state
- 60-second half-open period allows 1-2 test requests
- State machine: `Closed` -> `Open` (blocking all requests) -> `HalfOpen` (testing) -> `Closed`

**Fair-share allocation** with priority classes:
- `CriticalVerification` -- highest priority (evidence floor requirements)
- `EvidenceFloorRequired` -- required verification outranks optional dial expansion
- `HighDialInteractive` -> `NormalInteractive` -> `LowDialInteractive` -> `BackgroundExploration`
- Each team member gets a guaranteed minimum share with burst allowance
- Borrow-from-pool when individual share is insufficient

**Subscription pooling** -- the killer feature for small teams:
- A 10-person team with 2x Claude Max ($200) + 3x GPT Pro ($600) + 5x Gemini ($100) = $900/month
- Cortex pools these into a unified capacity pool with fair-share allocation
- Required verification gets priority over interactive convenience
- Interactive work gets priority over exploration
- No other tool does this

#### 3c. Dial Mapper

**Purpose:** Convert the 1-10 dial into a concrete resource envelope relative to the user's actual subscription pool.

The dial is both:
- A **constraint** on resource ceiling (hard limit on cost and parallelism)
- A **preference** on quality (within the ceiling, prefer better routes)
- A **verification-depth selector** (higher dial = deeper verification)

**Cost budget is relative to the subscription pool, not absolute dollars:**

| Dial | Subscription Units | Max Parallel | Verification Depth |
|------|-------------------|--------------|-------------------|
| 1 | 1.0 | 1 | Minimal |
| 2 | 1.5 | 1 | Basic lint/typecheck |
| 3 | 2.0 | 1 | Standard tests |
| 4 | 3.0 | 2 | Standard + review |
| 5 | 4.0 | 2 | Independent review |
| 6 | 5.5 | 3 | Cross-model verify |
| 7 | 7.0 | 4 | Multi-agent + delegation |
| 8 | 9.0 | 5 | Parallel candidates |
| 9 | 12.0 | 6 | Full fleet |
| 10 | 16.0 | 8 | Full fleet + counterfactuals |

Risk multiplier adjusts the budget: Low (1.0x), Medium (1.25x), High (1.75x), Critical (2.5x). A dial-3 task touching auth code (Critical risk) gets the same budget as a dial-5 task touching documentation (Low risk).

### Layer 4: Learned Route Scorer + Autonomy Gate

#### Route Templates

12+ pre-defined route templates. Humans design them. The learner selects among them.

| Template | Dial Range | Description |
|----------|-----------|-------------|
| SoloFast | 1-3 | Cheapest model, minimal verification |
| SoloCareful | 2-4 | Single model with lint/typecheck |
| Cascade | 2-4 | Try cheap first, escalate on failure |
| BestSingle | 3-6 | Best available single model |
| PlanThenExecute | 4-7 | Planner + implementer |
| ImplementThenReview | 4-8 | Generator + independent reviewer + refiner |
| TestFirstIndependent | 5-10 | Test writer (issue-only) + implementer + verifier |
| CrossModelVerify | 6-9 | Different-provider verification |
| ParallelCandidates | 7-10 | Parallel fleet + arbiter |
| HumanCheckpoint | 7-10 | Includes explicit human approval gate |
| FullCriticalPath | 8-10 | Planner + parallel + arbiter + verifier + review |
| DualBrainSynthesis | 9-10 | Cross-provider synthesis |

Each template has typed stages with roles (`PrimaryGenerator`, `Planner`, `Implementer`, `Reviewer`, `TestWriter`, `Verifier`, `Refiner`, `Arbiter`), per-stage input policies (`FullContext`, `IssueOnly`, `DiffOnly`, `PlanOnly`, `RedactedSummaryOnly`), and output contracts (`Plan`, `Patch`, `Review`, `TestPlan`, `TestPatch`, `Verdict`, `FinalAnswer`).

**Per-stage input policies enable per-stage privacy evaluation.** A reviewer stage with `DiffOnly` input can be sent to a provider that would be privacy-blocked if it saw the full codebase. This expands the usable provider pool without compromising privacy.

#### Route Scorer

**v1: UCB (Upper Confidence Bound).**
- Deterministic, explainable, sufficient for small arm space
- `ucb_score = mean_reward + exploration_constant * uncertainty`
- Beliefs are contextual: keyed by `(TaskFamily, RepoProfileBucket, RiskClass, ModelId, StrategyId)`
- Hierarchical beliefs: `global > tenant > repo > context` -- prevents misleading global learning

**v2: Thompson Sampling.**
- Normal distribution sampling with exploration temperature
- Extends naturally to multi-dimensional reward (correctness, usefulness, cost_efficiency, latency, user_preference)
- Sliding window handles non-stationarity (provider drift, model updates)
- Exploration temperature scales with dial level

**Exploration modes scale with dial:**
- Dial 1-3: `None` (no exploration, cheapest known-good route)
- Dial 4-5: `CheapShadowReview` (review by alternate model, no user cost)
- Dial 6-7: `ShadowPlanOnly` (alternate planner, compare plans)
- Dial 8-9: `ParallelCandidate` (run alternate route in parallel)
- Dial 10: `FullCounterfactual` (full alternate execution for comparison)

**Research basis:** ParetoBandit (arXiv:2604.00136) validates closed-loop budget-paced adaptive routing. CSCR (NeurIPS 2025 Spotlight) validates cost-spectrum contrastive embeddings for microsecond k-NN routing. Cascade Routing (ETH Zurich, arXiv:2410.10347) validates quality estimators as the critical ingredient. PILOT (EMNLP 2025) validates preference-prior initialization for cold-start.

#### Autonomy Gate

**Invariant thresholds per risk class:**

| Risk Class | Auto-proceed above | Suggest above | Block below |
|------------|-------------------|---------------|-------------|
| Low | 0.60 | 0.30 | 0.10 |
| Medium | 0.75 | 0.50 | 0.20 |
| High | 0.90 | 0.70 | 0.40 |
| Critical | 0.95 | 0.85 | 0.60 |

The learner does not adjust these thresholds. The learner produces higher-confidence outputs by selecting better routes, which naturally leads to more autonomous operation. This is a key architectural insight: autonomy is an emergent property of route quality, not a tunable parameter.

**Confidence scoring** is multi-dimensional: task understanding, repo context, tool feedback, test coverage, independent verification, user preference match -- minus penalties for risk, ambiguity, and stale context.

**Repo observability profile** sets a confidence ceiling. A repo with no tests, no CI, no typecheck has a ceiling of 0.25 -- Cortex cannot claim high confidence in a zero-observability environment regardless of model output quality.

### Layer 5: Evidence Graph + Attribution Engine + Belief Updater

#### Evidence Graph

Append-only, typed nodes and edges. History is never mutated.

**31 signal kinds** across 5 tiers:
- **Tier 1 (Hard objective):** `ExistingTestsPass/Fail`, `CompilePass/Fail`, `TypecheckPass/Fail`, `LintPass/Fail`, `BuildPass/Fail`, `SecurityScanPass/Fail`
- **Tier 2 (Independent verification):** `HumanReviewApprove/Reject`, `IndependentModelReviewPass/Fail`, `RuntimeSmokePass/Fail`
- **Tier 3 (Stability):** `Merged`, `Reverted`, `NoRevertAfterWindow`, `FollowupFixSameScope`, `ProductionIncidentLinked`
- **Tier 4 (Weak subjective):** `UserAccept/Reject`, `AgentSelfReport`, `GeneratedTestsPass/Fail`, `DocsLinkValid/Broken`, `BenchmarkImproved/Regressed`
- **Tier 5 (Cross-cutting contamination):** Contamination profile applied to all signals

**Each signal carries three dimensions:**
- `reward` -- how much this changes the belief about route quality
- `confidence` -- how much this signal can be trusted
- `contamination_penalty` -- multiplicative discount for potentially compromised signals

#### Contamination Tracking

Contamination is a first-class dimension, not an afterthought. Every evidence event carries a `ContaminationProfile`:

| Contamination Factor | Penalty |
|---------------------|---------|
| Same model as generator | +0.25 |
| Same provider as generator | +0.10 |
| Reviewer saw generated patch | +0.15 |
| Reviewer saw agent rationale | +0.10 |
| User confirmed without execution | +0.20 |
| Dirty workspace (uncommitted changes) | +0.20 |
| Truncated logs | +0.15 |
| Synthetic-only evaluation | +0.25 |
| **Total penalty capped at** | **0.90** |

A generated test passing against generated code (contamination: same_model + saw_generated_patch + synthetic_only = 0.65 penalty) is dramatically less trusted than a human-written regression test passing in CI (contamination: 0.0 penalty). This distinction is fundamental. Most routing systems treat all "tests passed" signals equally. Cortex does not.

#### Attribution Engine

**Role-based causal credit assignment.** When a pipeline has a planner, implementer, reviewer, and test writer, each gets credit proportional to their causal contribution to the outcome.

**Constraint:** Total causal weight per evidence event is capped at 1.0. Even for failures with joint responsibility, this prevents double-penalization.

**Revert cause classification** distinguishes signal quality:
- `FunctionalRegression` -- strong negative signal for generator
- `SecurityRegression` -- strong negative for generator AND reviewer
- `PerformanceRegression` -- moderate negative
- `ProductChange` -- not a quality signal (business decision)
- `MergeConflict` -- not a quality signal (timing issue)
- `FlakyTest` -- noise, not signal
- `StylePreference` -- weak preference, not quality

**Research basis:** SHARP (arXiv:2602.08335) validates Shapley-style credit in multi-agent systems. Causal Credit Assignment (arXiv:2602.09331) validates counterfactual reasoning for pipeline attribution. Computational note: exact Shapley is tractable for 3-5 agents in a typical pipeline; Monte Carlo approximation for larger swarms.

#### Belief Updater

**Three gates before updating beliefs:**
1. **Minimum signal diversity** -- at least 1 hard objective signal required
2. **Confidence floor per risk class** -- belief updates below threshold are deferred
3. **Signal freshness** -- decay factor for signals older than 24 hours

**Finalization windows:**
- Immediate (0-10s): compile, lint results
- Short (10s-2min): test suite results
- Medium (2-30min): CI pipeline results
- Long (30min-7d): PR merge/revert, production incidents

**Compensating updates:** A revert discovered 3 days after merge appends a compensating negative update. The original positive update is never deleted. Beliefs are derived state, recalculated from the immutable ledger.

#### Non-Selection Reason Tracking

A critical detail: when a candidate is not selected, the reason is tracked. If a model was not selected because capacity was unavailable (not because it was predicted to be worse), the learner does not update its belief about that model's quality. This prevents quota-induced belief corruption.

```
enum NonSelectionReason {
    LowerExpectedUtility,      // -> update belief
    CapacityUnavailable,       // -> do NOT update
    BudgetExceeded,            // -> do NOT update
    PrivacyBlocked,            // -> do NOT update
    AuthUnavailable,           // -> do NOT update
    UserProviderLock,          // -> do NOT update
    EvidenceFloorRequiresOtherRole,  // -> do NOT update
}
```

### Route Decision Transparency

Every routing decision produces a structured audit record plus a user-facing explanation. The audit separates constraints from preferences so that debugging, compliance, and user trust are all served.

**Bad explanation:** "Used Claude because it is best."

**Good explanation:** "Used Claude Sonnet as primary because it has the strongest prior for TypeScript bug fixes in this repo profile (skill score 0.92 from 147 observations). Used GPT as independent reviewer because the task touched auth code (file path `src/auth/session.ts` matches `auth/**` glob, classified as High risk) and policy requires independent-provider verification at High risk. Did not use Gemini because the team privacy policy blocks providers with unknown retention for this repository. Dial 6 allowed one reviewer but not a full parallel fleet. Budget remaining: 73% of session allocation."

The structured audit (`RouteDecisionAudit`) includes:
- All candidates considered with their UCB scores
- Why each non-selected candidate was rejected (with `NonSelectionReason`)
- Policy constraints that filtered candidates before scoring
- Capacity state at decision time
- Confidence score breakdown (all component weights)
- Autonomy decision and threshold comparison

This powers three use cases:
1. **User trust:** "I can see why Cortex picked this model and what alternatives existed."
2. **Debugging:** "The quality estimator was wrong about GPT's capability on this task family. Update belief."
3. **Compliance:** "Auditor can verify that privacy policy was enforced on every routing decision."

### Self-Healing Behavior

Self-healing is not "retry until it works." It is an evidence-driven recovery loop:

1. **Failed route creates evidence.** The failure mode is classified (compile error, test failure, timeout, rate limit, incoherent output). This becomes an `EvidenceEvent` in the append-only ledger.

2. **Evidence updates confidence.** The failing model-task pair's belief is updated. The contamination profile records that this was a direct failure observation (high reliability signal).

3. **Confidence may downgrade autonomy.** If the model-task pair confidence drops below the autonomy threshold, the next attempt requires user confirmation instead of proceeding silently.

4. **Scheduler may spawn recovery nodes.** For a failed implement node, the scheduler can:
   - Spawn a `Verify` node to diagnose what went wrong
   - Spawn an alternate `Implement` node routed to a different model
   - Spawn a `Refine` node that takes the failed output and the error message as context

5. **Repeated failure triggers circuit breaker.** If the same provider fails 30%+ in a 5-minute window, the circuit breaker opens. All routing shifts to other providers until half-open testing confirms recovery.

6. **Blocked work is bypassed.** If recovery blocks on one branch, the scheduler routes to sibling nodes that remain runnable.

7. **Stale assumptions are rechecked.** If a previously successful model-task pair fails, the belief updater checks whether the failure correlates with a provider update or drift event.

8. **Delayed negative evidence corrects past beliefs.** A revert discovered 3 days later creates a compensating update. The original positive evidence is never deleted -- the compensating update is appended, and the belief is recalculated from the full immutable history.

**The system does not blindly continue. It continues intelligently inside policy.**

### Feedback Loop Prevention

Four distinct feedback loops that could corrupt the learning system, with their mitigations:

**1. Winner starvation.** If Model A wins early, it gets all traffic, all evidence, and all future selections. Other models starve and their beliefs become stale.
- Mitigation: UCB exploration term ensures underexplored models get occasional traffic. Exploration temperature scales with dial level.

**2. Difficulty confounding.** If Model A handles easy tasks and Model B handles hard tasks, Model A appears better even if Model B is actually stronger per difficulty unit.
- Mitigation: Rich `TaskFeatures` normalize for difficulty. Beliefs are keyed by `(TaskFamily, RepoProfileBucket, RiskClass)`, not globally.

**3. Self-fulfilling verification.** If the verifier is the same model as the generator, it may confirm its own mistakes.
- Mitigation: `ContaminationProfile` tracks `same_model_as_generator` and `same_provider_as_generator`. Independence requirements at High/Critical risk mandate different-provider verification.

**4. Quota bias.** If a model is frequently unavailable (rate-limited), the learner may conclude it is bad, when it is simply absent.
- Mitigation: `NonSelectionReason::CapacityUnavailable` prevents belief updates on non-quality-related non-selections.

### Concrete Example Routes

**Solo user, one $20 sub, dial 1, low-risk docs fix:**
- Route: `SoloFast`. Single model, link check if available.
- Evidence: link valid (moderate positive), user accept (weak preference).
- Confidence: limited by observability. No claim beyond "docs checked."

**Solo user, one $20 sub, dial 10, medium bugfix:**
- Route: `BestSingle` or `ImplementThenReview` (if model variants available on same provider).
- Transparency: "Dial 10 used maximum available pool, but only one provider connected. Independent-provider review unavailable, so confidence is limited."

**Team, eight premium subs, dial 10, auth refactor:**
- Route: `FullCriticalPath`. Planner on strongest reasoning model. 2-3 parallel implementers across providers. Test writer sees issue only (`IssueOnly` input policy). Arbiter selects candidate. Independent verifier from unused provider. Security scan. Human approval gate.
- Evidence floor: cannot be reduced. If tests fail, no success claim.
- Delegation: each agent gets a Soma Delegation key with spend cap and scope narrowing.
- Learning: selected implementer gets credit, arbiter gets credit for correct selection, revert in 7 days retroactively penalizes generator + reviewer + arbiter via compensating updates.

**No-test repo, dial 5, feature request:**
- Route: `BestSingle` with build/typecheck. Generated smoke check if feasible. Optional independent review.
- Report: "Build passed. No existing tests were found. A generated smoke check was run. Confidence is limited by repo observability."
- Learning: positive update capped by observability ceiling (0.55). User acceptance is preference/usefulness only. Later follow-up fix strongly updates negative.

---

## 4. The Soma Integration Layer

This is the key synthesis -- the section that changes everything.

The dual-brain debate (GPT-5.5 vs Opus 4.7) assumed most of the trust, delegation, and payment infrastructure would need to be built from scratch. GPT's Round 1 proposed building a federated intelligence marketplace with trust scores, payment rails, and data verification. Opus's challenge estimated 15-20 engineers and 12-18 months to build it all.

**Both were wrong about the starting point.** Soma and ClawNet are production systems. The delegation infrastructure that GPT proposed as a future vision is already running with a metrics endpoint. The payment flow that Opus estimated at 3-4 months of engineering is already processing transactions. The data freshness verification that both treated as a design exercise has a full header spec and implementation pseudocode.

This does not mean the work is done. It means the work starts from a dramatically different baseline. Instead of "build from scratch," the question is "integrate existing production systems." The engineering estimate drops by roughly 40-60% for integration-dependent features.

This section maps existing Soma infrastructure to Cortex needs.

### 4a. Soma Delegation for Agent Authority

**The problem it solves:** When Cortex operates at dial 7+ and spawns multi-agent workflows (parallel implementers, independent reviewers, test writers), each agent needs bounded authority. Today, every multi-agent framework (CrewAI, AutoGen, MetaGPT, LangGraph) hands children the parent's full API key. This is the #1 unsolved multi-agent security problem per the Grantex 2026 State of Agent Security report.

**The solution -- already production:**

Every Cortex-spawned agent receives a Soma Delegation key with:

- **Spend cap** (`spend_cap_usd`): Maximum value this agent and all its descendants may consume. A search agent gets $2. An implementer gets $10. A reviewer gets $5. Total spend rolls up to ancestors.
- **Branch spend cap** (`branch_spend_cap_usd`): Per-immediate-child ceiling. Prevents any single grandchild from dominating a child's budget.
- **Scope narrowing** (`scope.endpoints`, `scope.methods`): A search agent's scope is `["*.read", "*.search"]` -- it cannot call edit endpoints. An implementer's scope includes edit but not deploy. A reviewer sees diffs but cannot modify. **child.scope must be a strict subset of parent.scope**, enforced at creation time and serving time.
- **Depth limits** (`depth`, `max_depth`): Prevents unbounded agent spawning. A planner at depth 1 with max_depth 2 can spawn implementers but implementers cannot spawn further agents.
- **Intent declaration** (`intent.declaration`, `intent.data_domain`): Signed statement of purpose. Providers can use this for pricing, rate-limiting, or refusal. A declared "research" agent may get different quotas than a declared "production" agent. Intent is advisory but signed -- misrepresentation is attributable.
- **TTL** (`expires_at`): Wall-clock expiry. Agents that outlive their expected lifetime automatically lose authority.
- **Cascade revoke**: Parent revocation kills the entire subtree via recursive BFS. If a planner goes haywire at 2am, revoking the planner instantly kills all its spawned implementers, reviewers, and test writers.

**Wire format -- already implemented:**
- Request: `Authorization: Bearer <key_id>`, optional `X-Soma-Delegation-Chain` and `X-Soma-Intent`
- Response: `X-Soma-Delegation-Chain` (masked key IDs), `X-Soma-Delegation-Depth`, `X-Soma-Delegation-Hops`, `X-Soma-Delegation-Root`, `X-Soma-Delegation-Intent`
- Error: `X-Soma-Delegation-Error` with codes: `DEPTH_EXCEEDED`, `SCOPE_VIOLATION`, `SPEND_CAP_EXCEEDED`, `BRANCH_CAP_EXCEEDED`, `REVOKED`, `EXPIRED`, `INTENT_REJECTED`
- HTTP status: 401 (unknown/revoked), 402 (spend cap exhausted -- standard x402), 403 (scope violation), 410 (expired)

**Cortex integration points:**

| Cortex Layer | Soma Delegation Integration |
|-------------|---------------------------|
| Layer 1: Intent Decomposer | Assigns risk class and scope requirements per work node |
| Layer 2: Scheduler | Tracks delegation key lifecycle alongside node state |
| Layer 3: Policy Gate | Enforces delegation constraints as invariants |
| Layer 4: Route Scorer | Factors delegation overhead into route cost estimates |
| Layer 5: Evidence Graph | Records delegation chain as provenance on every execution |

**Concrete Cortex-to-Delegation mapping:**

When Cortex decomposes "fix the auth bug and write tests" at dial 8, the delegation tree looks like:

```
Root (user session)
  depth=0, max_depth=3, spend_cap=$50, scope=*
  intent="Fix auth session timeout bug and write regression tests"
  |
  +-- Planner Agent
  |     depth=1, max_depth=1, spend_cap=$5, scope={read-only}
  |     intent="Analyze auth session code and produce fix plan"
  |     Branch cap: $2 (cannot spawn expensive children)
  |
  +-- Implementer Agent
  |     depth=1, max_depth=0, spend_cap=$15, scope={read+write, auth/**}
  |     intent="Implement fix per planner's specification"
  |     Cannot spawn children (max_depth=0)
  |
  +-- Test Writer Agent
  |     depth=1, max_depth=0, spend_cap=$10, scope={read+write, tests/**}
  |     intent="Write regression tests for auth session timeout"
  |     Input policy: IssueOnly (never sees the implementation patch)
  |     Cannot spawn children
  |
  +-- Reviewer Agent
        depth=1, max_depth=0, spend_cap=$8, scope={read-only}
        intent="Independent review of implementation and tests"
        Different provider than implementer (independence requirement)
        Cannot spawn children
```

Key properties enforced:
- The test writer NEVER sees the implementation patch (IssueOnly input policy + scope narrowing). This prevents contaminated verification.
- The reviewer is from a different provider than the implementer (independence requirement from evidence floor).
- Total spend across all agents cannot exceed $50 (root spend cap). Individual caps sum to $38, leaving $12 headroom for retries.
- If the implementer goes haywire and tries to edit files outside `auth/**`, the scope violation is caught and logged (`X-Soma-Delegation-Error: SCOPE_VIOLATION`).
- If the user cancels the session, cascade revoke kills all four agents instantly.

**Cascade revoke scenario:**

```
Timeline:
  t=0:  User starts "fix auth bug" at dial 8
  t=5s: Planner agent spawned (delegation key issued)
  t=8s: Planner produces plan
  t=10s: Implementer + Test Writer + Reviewer agents spawned
  t=15s: User realizes they need to fix a different bug first
  t=15s: User cancels session
  t=15s: Root delegation revoked
  t=15.001s: All four child agents' keys revoked (BFS cascade)
  t=15.002s: Any in-flight API calls return 401 Unauthorized
  t=15.003s: Delegation metrics updated (cascade count +1)
```

Total time from user cancel to all agents stopped: < 10ms. No orphaned agents. No runaway spend. No lingering permissions.

**Production status:**
- ClawNet endpoints: `POST /v1/economy/keys/delegate`, `GET .../delegated`, `GET .../chain`, `DELETE .../delegated/:childKey`
- Metrics: `GET /v1/stats/delegation` -- active chain count, depth distribution, fanout, 24h cascade-revoke count, scope violation rejection rate, intent distribution
- 23 unit tests covering backward compat, depth chains, cascade revoke, chain walk, scope enforcement, response headers
- Running since Q1 2026
- Database: `delegated_keys` table with columns for depth, max_depth, branch_spend_limit, intent_declaration, data_domain, scope_endpoints_glob, scope_methods_csv, revoked_at (Migration 149, shipped 2026-04-05)

**Comparison with prior art:**

| Feature | IETF draft-klrc | OAuth 2.0 | Capability Systems | **Soma Delegation** |
|---------|----------------|-----------|-------------------|-------------------|
| Scope narrowing | Partial | Yes (scopes) | Yes | **Yes (enforced at issue)** |
| Depth limits | No | No | Rare | **Yes** |
| Spend caps | No | No | No | **Yes** |
| Branch caps | No | No | No | **Yes** |
| Cascade revoke | No | No | Partial | **Yes** |
| Intent declaration | No | No | No | **Yes** |

Soma Delegation is the first standard with spend-bounded delegation + cascade revoke + intent declaration as first-class primitives. This is not a speculative feature. It is production code with a metrics dashboard.

### 4b. Soma Check for Data Verification

**The problem it solves:** When Cortex buys routing priors or data from external sources (v1.5+), it needs to know whether the data is fresh before paying for it. Standard HTTP caching semantics solve this, but with payment-aware extensions.

**The solution -- already specified and partially implemented:**

Soma Check piggybacks on RFC 9111 (HTTP Caching) conditional-request mechanics:

```
Agent sends:    GET /data  If-None-Match: "sha256-abc123..."
                X-Soma-Check: enabled

Server returns: 304 Not Modified (if hash matches -- cheap/free)
           or:  200 OK (if data changed -- full price)

Both include:   ETag, X-Soma-Hash, X-Soma-Freshness-Price,
                X-Soma-Freshness-Rail, X-Soma-Signer
```

**Cortex integration -- dial controls freshness tolerance:**

| Dial | Freshness Strategy | Payment |
|------|-------------------|---------|
| 1-3 | Accept cached data. Use `If-None-Match` aggressively. Prefer 304 responses. | Minimal. 304 responses are 10% of origin price. |
| 4-6 | Accept cached but periodically refresh. Use `X-Soma-Ttl` hints to decide when to re-validate. | Moderate. Balance freshness cost against data age. |
| 7-8 | Prefer fresh data. Shorter max-staleness tolerance. Verify freshness before high-impact decisions. | Higher. Pay for origin calls on important lookups. |
| 9-10 | Demand fresh. Always hit origin for high-risk decisions. Multiple independent sources. | Full price. Freshness is not optional at high dial on critical paths. |

**Security model:**
- Replay protection: server always computes current hash. Stale `If-None-Match` gets full origin response at full price.
- Signer verification (Tier 2+): `X-Soma-Signature` is Ed25519 over `(ETag + timestamp + price)`. Verifier checks against DID-resolved public key.
- Signature freshness: reject signatures older than 60 seconds.
- Hash computation: SHA-256 over JCS-canonicalized (RFC 8785) JSON body. Strong validator, 69 characters including quotes.

**Concrete Cortex-to-Check mapping:**

When Cortex needs provider health data to inform a routing decision:

```
Scenario: Cortex routing a Python web task at dial 6

Step 1: Check local cache for provider health
  Cache has: { "anthropic": { etag: "sha256-a1b2...", age: "47 minutes" } }
  Dial 6 max staleness for health data: 1 hour
  Decision: Cache is fresh enough. Use cached data. Cost: $0.

Step 2: 20 minutes later, another routing decision
  Cache age: 67 minutes (exceeds 1-hour threshold at dial 6)
  Decision: Validate freshness via Soma Check.

Step 3: Send conditional request
  GET /v1/providers/anthropic/health
  If-None-Match: "sha256-a1b2..."
  X-Soma-Check: enabled

Step 4a: If nothing changed (304 Not Modified)
  Response: 304, X-Soma-Freshness-Price: 1 (10% of full price)
  Cost: $0.001 (subscription tier, no x402)
  Action: Refresh cache TTL, reuse cached health data.

Step 4b: If data changed (200 OK)
  Response: 200, ETag: "sha256-c3d4...", X-Soma-Freshness-Price: 10
  Cost: $0.01 (full origin price)
  Action: Update cache with new data and new ETag.
  Important: Anthropic health changed -- this may affect routing decision.
```

**Cost comparison with vs without Soma Check:**

| Scenario (100 health checks/day) | Without Soma Check | With Soma Check | Savings |
|----------------------------------|-------------------|-----------------|---------|
| Health data changes 5x/day | 100 x $0.01 = $1.00 | 5 x $0.01 + 95 x $0.001 = $0.145 | 85% |
| Health data changes 20x/day | 100 x $0.01 = $1.00 | 20 x $0.01 + 80 x $0.001 = $0.28 | 72% |
| Health data changes 50x/day | 100 x $0.01 = $1.00 | 50 x $0.01 + 50 x $0.001 = $0.55 | 45% |

The savings compound across all data types (health, benchmarks, routing priors, incident alerts). For a team querying 500 data points per day, Soma Check can reduce data costs by 60-80%.

**Why this matters for Cortex:** x402 latency (50-200ms per transaction) means Cortex cannot do per-request data purchases in the routing hot path. Pre-fetch and cache with Soma Check validation is the only viable pattern. Soma Check makes this economically efficient by letting agents verify freshness without paying for a full origin call.

### 4c. Soma Pulse Tree for Evidence Provenance

**The problem it solves:** Cortex's Layer 5 Evidence Graph needs cryptographic provenance. Enterprise clients need verifiable proof of agent execution. The routing consensus mandates an append-only, never-mutate-history evidence system. Soma Pulse Tree provides the cryptographic backbone.

**The solution -- architecture spec ready to implement:**

The Soma Pulse Tree combines three proven cryptographic primitives into one universal structure:

1. **MMR (Merkle Mountain Range):** Append-only, O(log n) proofs, unbounded capacity. Every evidence event becomes a leaf.
2. **Namespace tags (inspired by Celestia's NMT):** Seven typed leaves -- actions, economic events, behavioral checkpoints, ZK proofs, wallet derivations, burner events, death certificates. Type-filtered queries work efficiently.
3. **Sum annotations (from Summa's MST):** Every internal node carries the cumulative `credit_delta` of all descendants. The root node's sum IS the agent's total economic activity -- no aggregation query needed.

**Leaf format:**
```
leaf_hash = H(position || type_tag || heartbeat_index || timestamp || payload_hash || credit_delta)
```

**Internal node format:**
```
node_hash = H(position || left_hash || right_hash || sum_credits)
```

**Seven event types in one tree:**

| Tag | Type | credit_delta | Example |
|-----|------|-------------|---------|
| 0x01 | Agent Action | cost of action | API call, LLM inference, tool use |
| 0x02 | Economic Event | amount | credit spend, deposit, bond post |
| 0x03 | Behavioral Checkpoint | 0 | periodic behavioral summary |
| 0x04 | ZK Proof | 0 | Nova folded instance or Groth16 proof |
| 0x05 | Wallet Derivation | 0 | new wallet created from Heart |
| 0x06 | Burner Agent Event | bond amount | creation, revocation, slashing |
| 0x07 | Death Certificate | remaining balance | final event, seals the tree |

**Cortex integration points:**

| Cortex Component | Pulse Tree Integration |
|-----------------|----------------------|
| Evidence Graph (Layer 5) | Every evidence event appends a type 0x01 leaf |
| Attribution Engine | Credit assignments tracked as type 0x02 leaves |
| Route Decision Audit | Each routing decision appends a provenance leaf |
| Self-Healing | Recovery events and compensating updates get leaves |
| Enterprise Compliance | One 32-byte root commits to everything. Cross-domain proofs are trivial. |

**Nova IVC -- continuous proof from birth:**

Every Cortex agent running in `nova` mode gets mathematically verifiable history:
- Each action: append leaf to Pulse Tree (< 0.1ms) + fold into Nova IVC instance (~50-100ms)
- On demand: compress entire history to Groth16 proof (~3-5 seconds)
- Result: **192 bytes, 5ms verification, proves ENTIRE chain regardless of length**
- One year, 100,000 actions: same 192 bytes, same 5ms verification

The individual cryptographic primitives exist (Nova, Groth16, MMR). The composition for agent lifecycle proofs is genuinely novel. No other protocol compresses arbitrary-length computation history into constant-size, constant-time proofs.

**Concrete Cortex-to-Pulse-Tree mapping:**

When Cortex runs a dial-8 auth refactor with 4 agents:

```
Pulse Tree for this execution session:

Leaf 1:  type=0x01 (Action)     "Intent decomposition: auth refactor -> 4 work nodes"
Leaf 2:  type=0x02 (Economic)   "Delegation key issued: planner, $5 cap"
Leaf 3:  type=0x02 (Economic)   "Delegation key issued: implementer, $15 cap"
Leaf 4:  type=0x02 (Economic)   "Delegation key issued: test writer, $10 cap"
Leaf 5:  type=0x02 (Economic)   "Delegation key issued: reviewer, $8 cap"
Leaf 6:  type=0x01 (Action)     "Planner: analyzed src/auth/session.ts, produced plan"
Leaf 7:  type=0x02 (Economic)   "Planner: $1.23 spent (Claude Haiku, 12K tokens)"
Leaf 8:  type=0x01 (Action)     "Implementer: modified 3 files per plan"
Leaf 9:  type=0x02 (Economic)   "Implementer: $4.67 spent (Claude Sonnet, 45K tokens)"
Leaf 10: type=0x01 (Action)     "Test writer: generated 5 regression tests (IssueOnly input)"
Leaf 11: type=0x02 (Economic)   "Test writer: $2.89 spent (GPT-5.4, 28K tokens)"
Leaf 12: type=0x01 (Action)     "Reviewer: approved implementation with 2 minor suggestions"
Leaf 13: type=0x02 (Economic)   "Reviewer: $3.15 spent (GPT-5.4, 31K tokens)"
Leaf 14: type=0x03 (Checkpoint) "Behavioral summary: 4 agents, all within scope, no violations"
Leaf 15: type=0x01 (Action)     "Evidence collected: 5 tests pass, compile pass, lint pass"
Leaf 16: type=0x01 (Action)     "Route decision audit: selected FullCriticalPath template"

Root sum_credits = $11.94 (total economic activity, provable from root)
Root hash = sha256-7f3a... (32 bytes commits to everything)
```

**Enterprise compliance query:**

An auditor asks: "Did the test writer see the implementation before writing tests?"

Answer (provable from tree):
1. Leaf 4 shows test writer's delegation key with scope `{read+write, tests/**}` and IssueOnly input policy
2. Leaf 10 shows test writer's action with `input_policy: IssueOnly`
3. Leaf 8 (implementer action) is at position 8. Leaf 10 (test writer action) is at position 10.
4. The test writer's delegation key does NOT include read access to implementation files
5. Cross-reference: two Merkle paths from one root prove the test writer's scope excluded implementation files

This is a 5-second audit on 32 bytes of root hash. Without Pulse Tree, this requires manual log inspection across multiple systems.

**Four proof layers, one tree:**

| Layer | What It Proves | How |
|-------|---------------|-----|
| Layer 0: Proof of Life | Agent exists and is actively computing | Monotonic heartbeat index, unfakeable sequential work counter |
| Layer 1: Proof of Conduct | Agent followed behavioral rules | Periodic checkpoint leaves with compliance rate |
| Layer 2: Proof of Provenance | Specific output from specific computation | Trace certificates with selective disclosure |
| Layer 3: Proof of Economy | Economic state matches computation history | Sum annotations at root, cross-domain payment-to-computation linking |

**Selective disclosure:**

The Pulse Tree supports proving specific claims without revealing the entire tree:
- "This agent spent less than $20" -- prove root sum < $20, no leaf content revealed
- "This agent called the auth API" -- prove inclusion of the specific type 0x01 leaf, other leaves hidden
- "Tests were written independently" -- prove test writer and implementer have different delegation keys with non-overlapping scopes
- "No scope violations occurred" -- prove checkpoint leaf (type 0x03) with compliance rate = 100%

Each proof is O(log n) Merkle path -- typically 10-20 hashes regardless of tree size.

### 4d. Trust Scores for Anti-Poisoning

**The problem it solves:** When Cortex buys routing priors from a federated marketplace (v1.5+), data providers need reputation. Without trust scores, sybil providers can poison the marketplace with fake data, steering 72% of purchases to malicious endpoints (per the Five Attacks paper's server selection attack finding).

**The solution -- Phase 5 vision, prerequisites identified:**

Soma trust scores create a quality signal before marketplace volume:

1. **Identity costs something.** Every agent needs a Heart with accumulated trust score. Trust cannot be farmed overnight.
2. **Bond-backed identity.** Credits at stake per agent and per burner. A data provider posting $100 in bonds has $100 at risk if their data is caught being misleading.
3. **Trust decay on ephemeral providers.** Fresh accounts lose trust at 10 points/hour by default. This prevents hit-and-run poisoning where a sybil provider publishes garbage data and disappears.
4. **Wallet derivation tied to Heart.** Cannot spin up anonymous data provider accounts without a parent identity paying bonds.
5. **Death certificates with succession.** Reputation persists. Clean shutdowns are provable. Rug-pulls leave forensic evidence.

**How this solves Opus's chicken-and-egg concern:**

Opus correctly identified that the federated marketplace has a bootstrapping problem: who provides data before there are enough Cortex instances? Trust scores provide a partial answer: even with few data providers, the system can distinguish between a provider with 6 months of verified trust history and $500 in bonds versus a fresh provider with no history and no bonds. This quality signal exists from day one without requiring marketplace volume.

**Sybil cost analysis:**

A data poisoner wanting 1,000 fake provider accounts would need to:
- Post bonds for every account (minimum $1,000 at stake)
- Each account has decaying trust (fresh accounts are untrusted)
- Every account traces cryptographically to parent identities
- Max 20 active burners per parent -- need 50 parent agents to get 1,000 accounts
- Each parent needs its own accumulated trust score
- Slashing: misbehavior detected on any account slashes parent's bond AND trust score
- Death certificates: shutting down to avoid slashing records final state permanently

**Net effect:** Sybil cost scales linearly with account count, trust cannot be farmed faster than organic accumulation, and every account traces back to a bonded identity.

**Prerequisites (honest assessment):**
- [ ] Trust scores validated under real API traffic (not just test seeds)
- [ ] Bond economics proven -- slashing actually deters, bonds are not just a cost of doing business
- [ ] Agent lifecycle stable for 3+ months in production
- [ ] Legal review of data marketplace regulatory requirements

---

## 5. The x402 Data Layer

This section incorporates Opus's reality check while acknowledging the existing infrastructure advantage.

### 5a. What's Real vs What's Aspirational

| Component | Status | Evidence |
|-----------|--------|----------|
| x402 protocol specification | **REAL** | Linux Foundation announced x402 Foundation (April 2, 2026). Founding members: Coinbase, Google, Microsoft, AWS, Stripe, Visa, Mastercard, Cloudflare, Shopify, Circle, Solana Foundation |
| x402 transaction volume | **REAL but fragile** | 165M+ total transactions, ~$600M annualized. BUT: 92% daily volume drop from Dec 2025 peaks (731K/day) to Feb 2026 (57K/day). Bot experimentation receded, organic usage not yet replacing it. |
| ClawNet x402 router | **REAL** | Production since Q1 2026. Full payment flow, delegation enforcement, metrics endpoints. Running at localhost:3402. |
| Soma Delegation | **REAL** | Production with 23 unit tests, public API surface, metrics dashboard. |
| Soma Check | **REAL (spec)** | Full header spec, client/server pseudocode, security analysis. Shadow mode telemetry-only implementation ready. |
| Soma Pulse Tree | **REAL (architecture)** | Full spec with build plan. TypeScript + Rust subprocess components specified. Not yet implemented. |
| Federated marketplace | **ASPIRATIONAL** | No implementation. Requires critical mass of Cortex instances. v2+ at earliest. |
| Network flywheel | **ASPIRATIONAL** | Requires marketplace + trust scores + privacy guarantees + sufficient volume. v2+ at earliest. |

### 5b. The Three-Tier Payment Architecture

Opus proposed, GPT accepted, and this is the definitive model:

**Free tier: Public data, zero payment.**
- Public routing benchmarks (RouterBench 405K+ outcomes, public eval results)
- Provider health pings (is Anthropic API up right now?)
- Community-contributed data with Creative Commons licensing
- HeyVera's own curated calibration runs (seeds the marketplace, solves cold-start)
- Purpose: bootstrapping supply. Makes HeyVera the initial intelligence provider, not a neutral marketplace operator. This is a data product with marketplace characteristics -- the distinction matters for positioning and fundraising.

**Subscription tier: Monthly allowance, standard billing.**
- Monthly subscription includes N premium data queries
- Standard API-key billing, no blockchain involvement
- Covers 80% of data marketplace transactions at lower latency and zero gas overhead
- This is where the $0.001 commodity signals live -- NOT on x402 (gas overhead would be 25%+ on sub-cent transactions)

**x402 tier: On-demand, trustless, cross-platform.**
- For non-subscribers or above-allowance usage
- For trustless transactions where buyer and seller have no prior relationship
- Minimum viable x402 transaction: ~$0.01-$0.05 (where gas overhead is <5% of value)
- Reserved for premium data: high-stakes evaluators ($0.25-$5), incident bundles, expert calibration
- Best suited for infrequent, higher-value transactions

**Why three tiers instead of x402-only:**

| Concern | x402-Only | Three-Tier |
|---------|-----------|-----------|
| Sub-$0.01 transactions | Uneconomical (25%+ gas overhead on Solana) | Subscription billing, zero overhead |
| Latency | 50-200ms per transaction (2 round trips + settlement) | 0ms for subscription tier, x402 only for premium |
| Hot-path routing lookups | Latency-prohibitive for real-time decisions | Cached locally, Soma Check validates freshness |
| Protocol risk | 100% dependent on x402 maturation | 80% on proven billing, 20% on x402 |

### 5c. Latency Reality

x402 adds latency at every step:
1. Server returns 402 instead of 200: +1 round trip
2. Client signs payment: +5-50ms (wallet operation)
3. Client retries with payment header: +1 round trip
4. Facilitator verifies: +10-50ms
5. Settlement: 400ms (Solana) to 5s (Stellar)

**Total: 50-200ms minimum** on top of the actual data request.

For context, Cursor's internal router adds 25ms. Adding x402 settlement to every routing decision would double or quadruple routing latency. This is why GPT's vision of "buy a single routing prior at request time" is latency-prohibitive for real-time routing decisions.

**The viable pattern: pre-fetch and cache with periodic refresh.**
- Cortex pre-fetches routing priors during idle time or session start
- Caches locally with TTL based on data type (health pings: 5min, benchmark data: 1 day, incident alerts: 1min)
- Uses Soma Check ETags to verify freshness without paying for full origin calls
- x402 payments happen asynchronously, not in the routing hot path

### 5d. Transaction Economics

| Network | Gas Cost | Settlement Time | Minimum Viable x402 Transaction |
|---------|----------|----------------|--------------------------------|
| Stellar | ~$0.00001 | ~5 sec | $0.001 (1% overhead) |
| Solana | ~$0.00025 | ~400ms | $0.005 (5% overhead) |
| Base L2 | ~$0.001 | ~2 sec | $0.02 (5% overhead) |
| Polygon | ~$0.01 | ~2 sec | $0.20 (5% overhead) |

**Facilitator overhead:** Coinbase's facilitator charges after a free tier. Exact fees not public, but any non-zero fee on sub-cent transactions is proportionally enormous.

**Comparison with existing routing pricing:** Not Diamond charges $10/10K routing recommendations ($0.001 each) via standard API billing, not x402. Their 10-100ms routing latency is already a customer concern. x402 would add more latency AND gas costs to achieve the same thing.

**Conclusion:** Sub-$0.01 transactions use subscription billing. x402 is reserved for $0.01+ transactions where gas overhead is under 5% and the trustless payment property provides real value.

### 5e. x402 Security Hardening

The Five Attacks paper (arXiv:2605.11781) reveals serious concerns:

| Attack | Severity | Impact | Required Mitigation |
|--------|----------|--------|-------------------|
| Settlement-Path Inconsistency | High | 5.18% revert-grant probability. Resource delivered but payment reverted. | Pre-grant atomic claims. Delayed resource delivery until settlement confirmed for high-value data. |
| Replay/Idempotency | Critical | 248 HTTP grants from single payment on tested endpoints. | Per-payment nonce tracking. Idempotency keys bound to payment signature. |
| Cache Leakage | High | 100% bypass via nginx without no-store headers. | Mandatory `Cache-Control: no-store` on x402-protected responses. CDN isolation. |
| Server Selection/Sybil | High | 71.8% selection rate for malicious servers via metadata manipulation. | Soma trust scores for data providers. Bond-backed identity. Trust decay on new providers. |
| PII Leakage | Medium | Payment metadata exposes browsing patterns. | Payment metadata redaction before facilitator submission. |

**Each mitigation is essentially a new subsystem.** This is not "add x402 support." This is "build a hardened payment gateway." ClawNet already handles payment routing, which reduces but does not eliminate this engineering effort.

### 5f. Cortex Insights (The Data Product, v1.5)

Instead of building a generic federated marketplace, Cortex ships a specific product first:

**What it sells:** Pre-computed routing recommendations for specific task shapes.

Example output:
```
Task shape: Python Django REST API, medium risk
Top 3 model configurations:
  1. Claude Sonnet 4.7 — 91% success rate, $0.03 median cost, 4.2s median latency
  2. GPT-5.4          — 88% success rate, $0.04 median cost, 3.8s median latency
  3. Gemini 2.5 Pro   — 85% success rate, $0.02 median cost, 5.1s median latency
Confidence: 0.87 (based on 2,847 observations, 14 contributing instances)
Last updated: 2 hours ago
```

**How it works:**
1. Cortex aggregates data from opt-in instances
2. Applies differential privacy with strict epsilon
3. Enforces minimum cohort thresholds (minimum K instances contributing)
4. Publishes curated insight packs, updated weekly or daily (not real-time)
5. Distributed via subscription tier initially

**Privacy constraints (honest assessment):**

Opus correctly identified a fundamental tension: privacy-preserving aggregates are either noisy enough to be private (less useful as routing intelligence) or accurate enough to be useful (potentially leaky).

The uncomfortable truth: for **rare task shapes** (e.g., Rust embedded systems with no_std constraints), k-anonymity fails because the cohort might be 1. These are precisely the task shapes where bought intelligence would be most valuable. Common task shapes (Python web CRUD) have enough public benchmarks that nobody needs to buy routing data.

**Mitigation:** Cortex Insights does not sell data for task shapes below the cohort threshold. Period. No exceptions. Some valuable data simply cannot be sold without privacy compromise. This is a constraint, not a bug.

**Migration path:**
- v1.5: Cortex Insights via subscription billing (standard API)
- v2.0: If demand validates the product, offer via ClawNet x402 for trustless cross-platform distribution
- v2.5+: If volume justifies, evolve toward federated marketplace model

### 5g. Competing Protocols Awareness

x402 is one of four competing agent payment protocols. Cortex should abstract over payment protocols, not bet exclusively on one.

| Protocol | Best For | Status | Cortex Relevance |
|----------|---------|--------|-----------------|
| x402 (Coinbase) | Per-request micropayments | 165M+ txns, Linux Foundation backing | Primary for data marketplace |
| MPP (Stripe + Tempo) | High-frequency streaming payments | New (March 2026) | Potential for session-based agent work |
| ACP (OpenAI + Stripe) | Agent checkout flows | Live in ChatGPT | Watch for enterprise adoption |
| AP2 (Google) | Authorization mandates | Authorization only, not payment | May complement Soma Delegation |

**Strategic position:** Follow Stripe's multi-protocol strategy. Abstract over payment protocols so ClawNet can route payments through the most appropriate protocol per transaction type. This mirrors how ClawNet already abstracts over provider APIs.

---

## 6. The Dial System

The dial is the single user-facing control that threads through the entire stack. It is simultaneously a constraint on resources, a preference on quality, and a verification depth selector. It never controls safety.

### Dial-to-Stack Mapping

| Dial | Model Selection | Parallelism | Verification | Data Spending | Agent Authority | Evidence Chain |
|------|----------------|-------------|--------------|--------------|----------------|----------------|
| **1** | Cheapest available | Single model | Compile/lint only | None. Cached data only. | None. Single agent. | Minimal. Local log only. |
| **2** | Cheapest with capability match | Single | + typecheck | None | None | Local log |
| **3** | Budget tier with context fit | Single | + existing tests | None | None | Local log |
| **4** | Standard tier | 2 parallel | + independent review (optional) | Free tier data only | None | Local log + audit trail |
| **5** | Best available single model | 2 parallel | + independent review (required for medium+) | Free tier + subscription queries | None | Audit trail |
| **6** | Best with cross-provider verify | 3 parallel | + cross-model verification | Subscription tier | None | Audit trail |
| **7** | Multi-model coordination | 4 parallel | + generated tests + security scan (if applicable) | Subscription + selective x402 | **Soma Delegation keys** with spend caps | Full evidence chain |
| **8** | Parallel candidates with arbiter | 5 parallel | Full verification suite | Subscription + x402 for premium | Delegation with scope narrowing | Full chain + Pulse Tree |
| **9** | Full fleet orchestration | 6 parallel | + human checkpoint gate | Full x402 budget | Deep delegation trees (depth 3+) | Full chain + Nova proofs |
| **10** | Everything available + counterfactuals | 8 parallel | + shadow counterfactual evaluation | Maximum x402 spend | Full delegation with audit | Full chain + Groth16 compression |

### Dial Interaction with Risk

The dial and risk class interact multiplicatively:

| Scenario | Effective Budget | Verification |
|----------|-----------------|--------------|
| Dial 1, Low risk docs | 1.0 units | Link check (optional) |
| Dial 1, Critical risk auth | 2.5 units (Critical multiplier) | Compile + tests + security scan + independent review (all required) |
| Dial 5, Low risk docs | 4.0 units | Link check + example execution |
| Dial 5, Critical risk auth | 10.0 units | Full verification suite, human review |
| Dial 10, Low risk docs | 16.0 units | Everything, including counterfactual comparison |
| Dial 10, Critical risk auth | 40.0 units | Full fleet + dual-brain + human gate + Soma delegation + evidence chain |

**The invariant:** A dial-1 task on critical auth code gets more verification than a dial-10 task on documentation. The evidence floor is determined by risk class, not dial level. The dial only adds optional investment above the floor.

### Dial and Soma Delegation

Below dial 7, Cortex operates as a single agent. No delegation keys, no agent trees, no cascade revoke. This keeps the system simple for casual use.

At dial 7+, Cortex transitions to multi-agent mode:

**Dial 7: Supervised multi-agent.**
- Delegation keys issued with conservative spend caps
- max_depth: 1 (children only, no grandchildren)
- Scope: narrow (search agents get read-only, implementers get edit on specific paths)
- Intent: declared and logged
- Cascade revoke: available but rarely needed

**Dial 8-9: Orchestrated agent trees.**
- Delegation keys with deeper trees (max_depth: 2-3)
- Branch spend caps prevent any subtree from dominating
- Scope narrowing enforced transitively
- Parallel candidate evaluation with arbiter agent
- Evidence chain via Pulse Tree

**Dial 10: Full fleet with cryptographic audit.**
- Full delegation trees with depth limits based on task complexity
- All agents get Pulse Tree leaves
- Nova IVC folding for continuous proof
- Groth16 compression available on demand
- Enterprise-grade audit trail: "prove that agent X performed action Y at time Z with budget W"

### Dial and Data Freshness

The dial controls Soma Check freshness tolerance:

| Dial | Max Staleness | Freshness Price Sensitivity | Pattern |
|------|--------------|---------------------------|---------|
| 1-3 | Accept anything cached | Do not pay for freshness | `If-None-Match` aggressively, prefer 304 |
| 4-6 | 1 hour for health data, 1 day for benchmarks | Pay for freshness if `X-Soma-Freshness-Price < threshold` | Periodic refresh on important data |
| 7-8 | 15 minutes for health, 4 hours for benchmarks | Pay for freshness on high-impact decisions | Validate before routing decisions |
| 9-10 | Real-time for health, 1 hour for benchmarks | Always pay for origin on critical paths | Multiple independent sources |

---

## 7. Competitive Positioning

### What Cortex Is Not

Cortex is **not** a replacement for Cursor, Copilot, or Claude Code. It is not an editor. It is not a completion engine. It is not a chat interface. Competing on developer experience against tools with millions of paying users and massive distribution advantages is a losing strategy.

### What Cortex Is

**Cortex is the routing intelligence layer that makes your AI coding tool smarter.**

The positioning is infrastructure, not end-user product:

- **Cursor plugin** that replaces Cursor's internal router with evidence-based routing
- **Copilot extension** that adds cross-provider model selection
- **Claude Code integration** that adds multi-provider routing and subscription pooling
- **Standalone CLI** for teams not locked into any specific editor
- **API/SDK** for tool builders who want routing intelligence without building it

This is the OpenRouter model ($50M ARR, 5.5% take-rate) applied to routing intelligence rather than just API proxying. OpenRouter proved that developers will pay for a routing layer. Cortex adds learning and evidence on top.

### Competitive Landscape (Honest Assessment)

| Player | What They Have | What They Lack | Cortex Differentiation |
|--------|---------------|---------------|----------------------|
| **Cursor** ($2B ARR) | Internal router ("auto-mode"), massive UX lead, 1M+ paid users | No evidence-based learning, no cross-provider routing, no subscription pooling | Cortex learns from outcomes; Cursor picks by tier |
| **Copilot** (~$1.5B ARR) | GitHub distribution, 4.7M paid users, enterprise deals | Single-provider (mostly GPT), no cascade routing | Cortex routes across all providers with circuit breakers |
| **Claude Code** (growing fast) | Satisfaction leader (46% most-loved), Opus/Sonnet/Haiku tiers | Single-provider, no external routing intelligence | Cortex adds multi-provider arbitrage |
| **Martian** ($1.3B valuation) | First commercial LLM router, enterprise contracts | SaaS router (external call), no evidence graph, no delegation | Cortex runs locally, learns from evidence, Soma-secured |
| **Not Diamond** | Routing API ($0.001/recommendation) | No learning loop, no evidence provenance, no multi-agent | Cortex's evidence graph improves over time |
| **OpenRouter** ($50M ARR) | API proxy with model selection, 5.5% take-rate | No intelligent routing, pure proxy | Cortex adds evidence-based selection on top |

### The Real Risk

Opus correctly identified: **by the time Cortex ships, every major AI coding tool will have 80% of its routing capability built in.** Cursor already has an internal router. Copilot already routes across models. Claude Code already has tier selection.

Cortex's differentiation must come from capabilities competitors cannot easily replicate:

1. **Evidence-based learning** -- requires months of outcome data collection. Cannot be added overnight.
2. **Subscription pooling** -- requires handling multiple provider auth flows. Competitors are single-provider.
3. **Soma Delegation** -- requires Soma infrastructure. No competitor has scoped agent authority.
4. **Cryptographic provenance** -- requires Pulse Tree. No competitor can prove agent execution history.
5. **Contamination-aware attribution** -- requires understanding signal quality. No competitor tracks whether the test writer saw the patch.

These five capabilities compound. A competitor building any one of them gets marginal value. Building all five creates a system that measurably improves over time in ways that UX polish cannot replicate.

### Why "Build Internal Routing" Is Not Enough

The likely competitor response is: "We will build our own routing." Here is why that is harder than it sounds:

**Cursor's internal router** selects models by tier (auto-mode picks a "cost-efficient model"). This is NOT evidence-based routing. It does not learn from outcomes. It does not track contamination. It does not enforce evidence floors. It does not pool subscriptions. Adding these capabilities requires:
- An append-only evidence store with contamination profiles
- A belief management system with hierarchical priors
- A policy gate with invariant risk floors
- A subscription registry with fair-share allocation
- A quality estimator for cascade triggering
- Integration testing of the full pipeline

This is 6-12 months of engineering for a team that is currently focused on UX innovation, not infrastructure. Every month spent on internal routing is a month not spent on the IDE experience that drives their $2B ARR.

**GitHub Copilot's routing** is single-provider (Microsoft/OpenAI). Adding cross-provider routing requires:
- Negotiating API agreements with Anthropic, Google, and other providers
- Building auth flows for each provider
- Handling different rate-limit and billing models
- Managing privacy policies per provider
- This conflicts with Microsoft's strategic interest in driving traffic to Azure OpenAI

**Claude Code's tier selection** (Opus/Sonnet/Haiku) is within a single provider. Cross-provider routing would require Anthropic to integrate competitor APIs -- a strategic contradiction.

**The structural advantage:** Cortex has no provider allegiance. It treats all providers as interchangeable capacity. This is architecturally impossible for a tool owned by a provider.

### Market Positioning

**Not competing for individual developers.** The $20/month individual market is dominated by Cursor and Copilot with massive distribution advantages. Cortex cannot win here on UX.

**Competing for teams and enterprises.** The value proposition for a 10-person team:
- Pool 8 subscriptions ($900/month) into unified capacity with fair-share allocation
- Route to the best model for each task shape based on evidence, not guesswork
- Enforce consistent verification standards across the team
- Get cryptographic proof of agent execution for compliance
- Save 20-40% on AI spend through intelligent routing (Martian claims 20-97%)

**Competing as infrastructure.** For tool builders:
- Routing intelligence SDK that any editor/IDE can integrate
- Evidence-based model selection without building a learning system
- Soma Delegation for safe multi-agent workflows
- Pulse Tree for compliance-grade audit trails

### Integration Architecture for Existing Tools

**Cursor Integration (Plugin Model):**

```
Cursor IDE
  |
  v
[Cursor Model Router]  <-- replaced by -->  [Cortex Route Scorer]
  |                                           |
  v                                           v
[Cursor LLM Call]      <-- augmented by -->  [Evidence Collection]
  |                                           |
  v                                           v
[User sees result]     <-- enhanced by -->   [Route Explanation]
```

The Cursor plugin intercepts model selection calls and routes them through Cortex. Cursor retains its UX, completion engine, and file management. Cortex replaces only the model selection logic and adds evidence collection. The user experience is invisible: Cursor appears to work the same way, but model selection is evidence-driven.

Technical requirements:
- Cursor Extension API access to model selection
- Cortex daemon running locally (Rust binary, <10MB memory)
- Evidence collector hooks into Cursor's test runner and terminal output
- Belief state persists in local SQLite database

**VS Code Extension (Standalone Model):**

```
VS Code + Continue / Cline / Aider
  |
  v
[Cortex Sidebar Panel]
  - Dial control (slider 1-10)
  - Active task status
  - Route explanation
  - Evidence summary
  - Provider health dashboard
  |
  v
[Cortex Background Service]
  - Listens for task submissions
  - Routes to providers via user's subscriptions
  - Collects evidence from terminal output
  - Updates beliefs continuously
```

The VS Code extension is a standalone panel that provides Cortex routing alongside any existing AI coding tool. It does not replace the user's existing tool -- it augments it with routing intelligence.

**CLI (Primary Interface for v1):**

```
cortex route "task description" --dial 5
cortex status                              # current beliefs, provider health
cortex explain <route-id>                  # why was this model chosen?
cortex evidence <task-id>                  # what evidence was collected?
cortex beliefs --task-family BugFix        # what has Cortex learned?
cortex pool add <subscription>             # add subscription to pool
cortex pool status                         # pool utilization
cortex audit --last 7d                     # audit trail for compliance
```

**API/SDK (for tool builders):**

```rust
// Rust SDK
use cortex::{Router, RoutingRequest, Dial, Evidence};

let router = Router::new(config)?;
let decision = router.route(RoutingRequest {
    goal: "fix the bug in auth/login.ts",
    repo_context: repo.context(),
    dial: Dial::new(5)?,
    user: current_user,
})?;

// decision contains: selected model, template, explanation, confidence
// After execution:
router.record_evidence(Evidence::TestsPass { count: 12 })?;
router.record_evidence(Evidence::CompilePass)?;
```

```typescript
// TypeScript SDK
import { CortexRouter } from '@cortex/sdk';

const router = new CortexRouter(config);
const decision = await router.route({
  goal: 'fix the bug in auth/login.ts',
  repoContext: await repo.context(),
  dial: 5,
});

// Record evidence after execution
await router.recordEvidence({ kind: 'TestsPass', count: 12 });
await router.recordEvidence({ kind: 'CompilePass' });
```

### GTM Strategy by Phase

**v0.1-v0.3 (Months 1-9): Developer Preview**
- Open-source Rust crate on crates.io
- CLI tool on Homebrew / cargo install
- GitHub repo with documentation and examples
- Target: 100 power users providing feedback
- Distribution: Hacker News launch, Rust community, AI coding tool subreddits
- Revenue: $0

**v1.0 (Months 10-12): Product Launch**
- CLI + VS Code extension + Cursor plugin (beta)
- Team features (subscription pooling, fair-share)
- Free for individuals, $20/user/month for teams
- Target: 500 individual users, 50 teams
- Distribution: Product Hunt, dev conferences, technical blog posts
- Revenue target: $10K/month

**v1.5 (Months 13-18): Data Product**
- Cortex Insights for routing intelligence
- Enterprise features (policy gates, audit trails)
- $50/month Insights subscription
- Target: 2,000 users, 200 teams, 20 enterprise pilots
- Distribution: Enterprise sales, partner integrations
- Revenue target: $50K/month

**v2.0 (Months 18+): Platform**
- Full marketplace with third-party intelligence providers
- Enterprise compliance suite (SOC 2, GDPR)
- Computation witness (Nova IVC)
- Target: 10,000+ users, marketplace GMV
- Distribution: Enterprise sales team, partner ecosystem
- Revenue target: $200K+/month

---

## 8. Build Sequence

### Guiding Principle

Start with the core learning loop. Prove it works locally. Then expand. Each phase validates the hypothesis before investing in the next layer. This is the lean startup approach applied to infrastructure.

### v0.1: Core Loop (Months 1-3)

**Goal:** A working routing engine that learns from outcomes. Single user, single provider, CLI interface. No x402, no marketplace, no federation.

**Deliverables:**

| Component | Description | Layer |
|-----------|-------------|-------|
| Route Scorer (UCB) | Contextual bandit with UCB scoring over task features | Layer 4 |
| Evidence Ledger | Append-only SQLite log of routing decisions and outcomes | Layer 5 |
| Policy Gate | Invariant constraints on risk, budget, and privacy | Layer 3 |
| Risk Classification | File-path glob patterns for invariant risk floors | Layer 3 |
| Circuit Breaker | Provider health state machine (Closed/Open/HalfOpen) | Layer 3 |
| 4 Route Templates | SoloFast, BestSingle, ImplementThenReview, TestFirstIndependent | Layer 4 |
| Dial Mapper | Basic 1-10 mapping to resource envelopes | Layer 3 |
| RepoObservabilityProfile | Confidence ceiling from test/CI/typecheck presence | Layer 3 |
| Core ID types | TaskId, RouteId, EvidenceId, etc. | All |
| CLI interface | `cortex route "task description" --dial 5` | UI |

**What this validates:**
- Does evidence-based routing actually improve model selection over time?
- Is the UCB learner stable with real-world evidence quality?
- Is contamination tracking operationally useful?
- Does the confidence ceiling accurately reflect repo observability?

**Engineering estimate:** 2-3 senior Rust engineers, 3 months.

### v0.2: Multi-Provider + Dial (Months 4-6)

**Goal:** Support multiple AI provider subscriptions with intelligent routing between them.

**Deliverables:**

| Component | Description | Layer |
|-----------|-------------|-------|
| Subscription Registry | Rich provider subscription tracking with auth refs | Layer 3 |
| Capacity Tracker | Live capacity snapshots, reservations, health monitoring | Layer 3 |
| Multi-provider routing | Route across Claude, GPT, Gemini with circuit breakers | Layer 4 |
| Intent Decomposition (basic) | Simple DAG decomposition for multi-step tasks | Layer 1 |
| Contamination Profile | Full 8-factor contamination tracking | Layer 5 |
| Credit Assignment | Role-based causal weights capped at 1.0 per event | Layer 5 |
| **Soma Delegation integration** | Issue delegation keys for spawned agents | Integration |
| Dial policy parameters | Full dial-to-envelope mapping including parallelism | Layer 3 |
| 8 Route Templates | Add Cascade, PlanThenExecute, CrossModelVerify, ParallelCandidates | Layer 4 |

**What this validates:**
- Does multi-provider routing reduce cost while maintaining quality?
- Does subscription pooling create measurable value for teams?
- Does Soma Delegation prevent agent budget overruns in practice?
- Is the intent decomposition useful for multi-step tasks?

**Engineering estimate:** 3-4 senior Rust engineers, 3 months.

### v0.3: Intelligence + Teams (Months 7-9)

**Goal:** Full 5-layer architecture with team support and cascade routing.

**Deliverables:**

| Component | Description | Layer |
|-----------|-------------|-------|
| Cascade routing | Quality estimators trigger escalation from cheap to expensive models | Layer 4 |
| Team subscription pooling | Fair-share allocation with priority classes | Layer 3 |
| Scoped blocking | Continue sibling nodes while blocked nodes wait | Layer 2 |
| Schedule-around | Route ready work while awaiting user input | Layer 2 |
| Confidence-based autonomy | Invariant thresholds per risk class | Layer 4 |
| Hierarchical beliefs | Global > tenant > repo > context | Layer 5 |
| **Soma Check integration** | ETag-based freshness verification for external data | Integration |
| Non-selection reason tracking | Prevent quota-induced belief corruption | Layer 5 |
| Route decision explanations | Structured audit + user-facing natural language | Layer 4 |
| Exploration modes | Dial-scaled exploration from None to FullCounterfactual | Layer 4 |

**What this validates:**
- Do quality estimators actually improve cascade routing decisions?
- Does scoped blocking help multi-step workflows complete faster?
- Does confidence-based autonomy reduce unnecessary user interruptions?
- Does Soma Check reduce data freshness costs?

**Engineering estimate:** 4-5 engineers (Rust + TypeScript), 3 months.

### v1.0: Production (Months 10-12)

**Goal:** Production-ready system with full 5-layer architecture, explainable routing, and self-healing.

**Deliverables:**

| Component | Description | Layer |
|-----------|-------------|-------|
| Full IntentGraph decomposition | All IntentShape types, IterationSpec, complex DAGs | Layer 1 |
| Full task features | Difficulty normalization with language, framework, repo size | Layer 4 |
| Drift detection | Formal statistical drift detection, not just failure-count heuristics | Layer 5 |
| Self-healing | Failed routes create evidence, spawn recovery nodes, reroute | All |
| Cortex Insights data product | Curated routing recommendations from opt-in telemetry | Data |
| **Soma Pulse Tree integration** | Evidence provenance via cryptographic proof structure | Integration |
| Topaz-inspired explanations | Skill-based model profiles + explainable routing decisions | Layer 4 |
| Cold start | Global priors + preference-prior initialization (PILOT) | Layer 4 |
| Finalization windows | Delayed evidence collection (CI, merge, revert, incidents) | Layer 5 |
| 12+ Route Templates | Full template set including DualBrainSynthesis | Layer 4 |
| Editor integrations | Cursor plugin, VS Code extension, CLI improvements | UI |

**What this validates:**
- Is the full system stable under production workloads?
- Do users actually use dials above 5?
- Is Cortex Insights data product viable?
- Do editor integrations drive adoption?

**Engineering estimate:** 5-7 engineers (Rust + TypeScript + Frontend), 3 months.

### v1.5: Marketplace Foundation (Months 13-18)

**Goal:** Cortex Insights available as a paid data product. First revenue from routing intelligence.

**Deliverables:**

| Component | Description |
|-----------|-------------|
| Cortex Insights via ClawNet x402 | Premium routing recommendations purchasable via x402 |
| Buy-side intelligence | Cold-start priors, provider health consensus, benchmark deltas |
| Sell-side intelligence | Anonymized aggregate evidence (with privacy guarantees) |
| Trust scores for data providers | Soma trust scores for data provider reputation |
| Differential privacy pipeline | Strict epsilon, minimum cohort thresholds, policy-filtered aggregates |
| x402 security hardening | Nonce tracking, idempotency, cache isolation, receipt validation |
| Subscription tier for Insights | Monthly allowance of premium queries via standard billing |

**Revenue model:**
- Subscription: $X/month for N premium routing queries (standard billing)
- x402: on-demand premium data for non-subscribers ($0.01-$5 per query depending on value)
- Enterprise: private federation with dedicated data pipelines

### v2.0: Full Vision (Months 18-24)

**Goal:** Advanced learning, full marketplace, enterprise compliance.

**Deliverables:**

| Component | Description | Research Basis |
|-----------|-------------|---------------|
| Thompson sampling | Replace UCB with Thompson sampling + exploration temperature | Sliding-Window TS literature |
| Rich features | Multi-dimensional reward vector: correctness, usefulness, cost_efficiency, latency, user_preference | ParetoBandit |
| Shapley credit assignment | Formal credit attribution in multi-agent pipelines. Monte Carlo approximation for >5 agents | SHARP, Causal Credit |
| Template evolution | EvoAgentX-inspired workflow mutation and selection. Evolve templates per task family, keep winners | EvoAgentX (EMNLP 2025) |
| Full federated marketplace | Peer-to-peer routing intelligence exchange with Soma trust scores | x402 ecosystem |
| Computation witness | Nova IVC for enterprise-grade agent execution proofs. 192 bytes, 5ms verify | Nova, Sonobe |
| Conformal prediction gates | Mathematically guaranteed confidence bounds. Distribution-free coverage guarantees | TECP, Conformal Prediction Survey |
| Restless bandit formulation | Models that account for provider evolution when not queried. SW-Whittle indices | SW-Whittle (arXiv:2506.18186) |
| Cross-workflow optimization | Statistical multiplexing of model capacity across simultaneous workflows | Cross-Layer Optimization |
| Enterprise compliance suite | SOC 2, GDPR, audit logs, SSO, dedicated account management | Enterprise requirements |
| Drift detection (formal) | Catoni-style change-point detection for heavy-tailed distributions | Catoni bandits |
| Multi-round routing | Router-R1-style interleaved think/route for ambiguous tasks | Router-R1 (NeurIPS 2025) |
| Domain-aware query tagging | Unsupervised fine-tuning of query embeddings for routing | MixLLM |
| Milestone library | Retrieval-augmented planning from past successful executions | HiPlan |

**Engineering estimate for full vision:** 15-20 engineers across Rust core, TypeScript integration, frontend, DevOps, privacy/compliance, and sales/CS. This is not a side project. This is a funded company.

### Build Sequence Visualization

```
Month:  1   2   3   4   5   6   7   8   9   10  11  12  13  14  15  16  17  18+
        |---v0.1---|---v0.2---|---v0.3---|----v1.0----|-------v1.5-------|--v2.0-->
        Core Loop   Multi-Prov Intelligence  Production   Marketplace    Full
        UCB+Evid    +Dial+Dlg +Teams+Cas  Full 5-Layer  Insights+x402   Vision

Engineers:
v0.1:   [Rust][Rust][--]                                    2-3 engineers
v0.2:         [Rust][Rust][Rust][TS]                        3-4 engineers
v0.3:               [Rust][Rust][Rust][TS][TS]              4-5 engineers
v1.0:                     [Rust][Rust][Rust][TS][TS][FE]    5-7 engineers
v1.5:                           [Rust][TS][TS][Priv][FE]    5-8 engineers
v2.0:                                 [Full team 15-20]     15-20 engineers

Key integration milestones:
  Month 4:  Soma Delegation integration (delegation keys for agents)
  Month 8:  Soma Check integration (data freshness verification)
  Month 11: Soma Pulse Tree integration (evidence provenance)
  Month 14: ClawNet x402 for Cortex Insights distribution
  Month 18: Full Soma trust scores for marketplace providers
```

### What Gets Cut If Resources Are Constrained

If the team stays at 3-5 engineers instead of scaling to 15-20:

**Core path (must ship):**
- Route Scorer (UCB) + Evidence Ledger + Policy Gate = v0.1
- Multi-provider routing + Dial Mapper + Basic Delegation = v0.2
- Cascade routing + Team pooling + Confidence autonomy = v0.3
- CLI + basic editor integration = v1.0

**Deferred (ship when team grows):**
- Cortex Insights data product -> v1.5 becomes v2.0
- Federated marketplace -> moves to v3.0 or later
- Nova IVC / Groth16 compression -> becomes a Soma-team deliverable, not Cortex-team
- Enterprise compliance suite -> requires dedicated compliance engineer
- Template evolution -> nice-to-have, not critical for product-market fit
- Cross-workflow optimization -> only matters at scale

**Never cut (invariants regardless of team size):**
- Evidence floors per risk class
- Contamination tracking on all signals
- Circuit breakers with configured thresholds
- Privacy enforcement per-stage
- Append-only evidence ledger
- Non-selection reason tracking

---

## 9. The HeyVera Platform Map

```
+-----------------------------------------------------------------------+
|                           HeyVera Platform                            |
|                                                                       |
|  +------------------+        +------------------+                     |
|  |   Soma (Heart)   |        |  Cortex (Brain)  |                     |
|  |                  |        |                  |                     |
|  | Identity         |<------>| Planning         |                     |
|  | Trust Scores     |        | Routing          |                     |
|  | Delegation       |        | Scheduling       |                     |
|  | Pulse Tree       |        | Verification     |                     |
|  | Death Certs      |        | Learning         |                     |
|  | Bond Economics   |        | Evidence Graph   |                     |
|  +--------+---------+        +--------+---------+                     |
|           |                           |                               |
|           +-------------+-------------+                               |
|                         |                                             |
|              +----------+----------+                                  |
|              | ClawNet (Nervous    |                                  |
|              | System)             |                                  |
|              |                     |                                  |
|              | x402 Payment        |                                  |
|              | Delegation Enforce  |                                  |
|              | Data Marketplace    |                                  |
|              | Provider Proxy      |                                  |
|              +----------+----------+                                  |
|                         |                                             |
|           +-------------+-------------+                               |
|           |                           |                               |
|  +--------+---------+        +--------+---------+                     |
|  | Social (Limb)    |        | Marketplace      |                     |
|  |                  |        | (Limb)           |                     |
|  | Reputation       |        | Paid Capabilities|                     |
|  | Community        |        | Data Products    |                     |
|  | Human Context    |        | Agent Services   |                     |
|  | Demand Signal    |        | Cortex Insights  |                     |
|  +------------------+        +------------------+                     |
+-----------------------------------------------------------------------+
```

### Responsibility Boundaries

**Soma owns:**
- Protocol semantics for identity, trust, and delegation
- Cryptographic proof structures (Pulse Tree, Nova IVC, Groth16)
- Credential truth and verified execution trust
- Agent lifecycle (birth -> wallets -> burners -> death certificates)
- Bond economics and slashing

**Cortex owns:**
- Planning and intent decomposition
- Routing intelligence and model selection
- Scheduling and scoped blocking
- Verification strategy and evidence floors
- Learning and belief management
- Budget tracking and subscription pooling

**ClawNet owns:**
- x402 payment flow execution
- Delegation key enforcement at serving time
- Data marketplace transaction processing
- Provider API proxying
- Metrics and billing

**Cortex consumes Soma services but does not own Soma semantics.** Cortex requests delegation keys from Soma but does not define what delegation means. Cortex writes evidence to the Pulse Tree but does not own the tree structure. Cortex checks trust scores but does not compute them. Clean boundaries prevent scope creep.

### Cross-System Data Flows

```
User Goal: "Fix the auth session timeout bug"
                            |
                            v
+------ Cortex Brain -----------------------------------------------+
|                                                                    |
|  1. Intent Decomposer: goal -> IntentGraph (4 work nodes)         |
|  2. Policy Gate: classify risk (auth/** -> Critical)              |
|  3. Dial Mapper: dial 8 + Critical -> 22.5 subscription units     |
|  4. Capacity Tracker: check 3 provider subscriptions              |
|  5. Route Scorer: UCB selects FullCriticalPath template           |
|  6. Autonomy Gate: Critical risk -> RequireExplicitApproval       |
|                                                                    |
|  [User approves plan]                                              |
|                                                                    |
+------ Soma Heart --------------------------------------------------+
|                                                                    |
|  7. Issue delegation keys for 4 agents (via ClawNet API)          |
|     - Planner: $5 cap, read-only, depth 1, max_depth 1           |
|     - Implementer: $15 cap, auth/** write, depth 1, max_depth 0  |
|     - Test Writer: $10 cap, tests/** write, depth 1, max_depth 0 |
|     - Reviewer: $8 cap, read-only, depth 1, max_depth 0          |
|  8. Pulse Tree: append delegation event leaves (type 0x02)        |
|                                                                    |
+------ ClawNet Router ----------------------------------------------+
|                                                                    |
|  9. Proxy planner's API calls (enforce scope: read-only)          |
|  10. Proxy implementer's API calls (enforce scope: auth/**)       |
|  11. Proxy test writer's API calls (enforce scope: tests/**)      |
|  12. Track spend per delegation key (roll-up to root)             |
|  13. Attach X-Soma-Delegation-* response headers                  |
|                                                                    |
+------ Workers (User Container) -----------------------------------+
|                                                                    |
|  14. Execute planner (Claude Haiku): analyze code, produce plan   |
|  15. Execute implementer (Claude Sonnet): modify 3 files          |
|  16. Execute test writer (GPT-5.4): write 5 regression tests      |
|  17. Execute reviewer (GPT-5.4): review implementation            |
|  18. Run tests locally, collect compile/lint/test results          |
|                                                                    |
+------ Back to Cortex Brain ---------------------------------------+
|                                                                    |
|  19. Evidence Collection: compile pass, 5 tests pass, lint pass   |
|  20. Contamination Assessment:                                     |
|      - Test writer saw IssueOnly (not patch): low contamination   |
|      - Reviewer is different provider: low contamination          |
|      - Tests are generated (not human-written): moderate contam.  |
|  21. Attribution: credit planner (plan quality), implementer      |
|      (code quality), test writer (test coverage), reviewer        |
|      (review thoroughness). Total credit <= 1.0 per event.        |
|  22. Belief Update: update beliefs for Claude Sonnet on           |
|      TypeScript auth bug fixes in this repo profile bucket.       |
|                                                                    |
+------ Soma Heart --------------------------------------------------+
|                                                                    |
|  23. Pulse Tree: append evidence leaves (type 0x01)               |
|  24. Pulse Tree: append behavioral checkpoint (type 0x03)         |
|  25. Root hash updated: 32 bytes commits to everything            |
|  26. [Optional] Nova IVC fold: continuous proof extended           |
|                                                                    |
+--------------------------------------------------------------------+
```

### Revenue Model

The revenue model evolves with the build phases:

**v1.0: Free + Open Source Core**
- Core routing engine is open source (Rust crate)
- Builds community, establishes standard, generates evidence data
- Revenue: $0 (investment phase)

**v1.0+: Team Subscriptions**
- Subscription pooling, team fair-share, enterprise policy gates
- $20/user/month for teams (comparable to Cursor Business at $40/user/month)
- Revenue target: 500 teams x 5 users x $20 = $50K/month by month 15

**v1.5: Cortex Insights Data Product**
- Curated routing recommendations via subscription + x402
- $50/month subscription includes 1,000 premium queries
- Additional queries at $0.01-$0.05 each (subscription billing)
- x402 tier for non-subscribers at $0.02-$5.00 per query
- Revenue target: $20-50K/month by month 18

**v2.0: Marketplace Take-Rate**
- 5% take-rate on marketplace transactions (aligned with OpenRouter's 5.5%)
- Third-party intelligence providers sell through ClawNet
- Revenue scales with marketplace GMV

**v2.0+: Enterprise**
- Private federation, dedicated data pipelines, compliance suite
- $500-2000/user/month for regulated industries
- SOC 2, GDPR, SSO, audit logs, SLA
- Multi-year contracts with dedicated account management

---

## 10. Risk Analysis

### Risk 1: Scope Creep (10 Subsystems = 10 Products)

**Severity:** Critical
**Probability:** High

Cortex as described is simultaneously an LLM router, an intent decomposition engine, a multi-agent scheduler, a quality verification system, an evidence/provenance database, a federated data marketplace, an x402 payment gateway, a subscription pooling platform, a risk classification system, and a self-calibrating ML system.

Each of these is a product. Together, they are a platform. The risk of building all ten simultaneously is that none reaches production quality. The risk of building them sequentially is that the later components (marketplace, x402) never get built because the earlier components consume all resources.

**Mitigation:**
- The build sequence (Section 8) is deliberately phased. v0.1 is three subsystems (Route Scorer, Evidence Ledger, Policy Gate). Each phase validates before expanding.
- Each phase has explicit "what this validates" criteria. If a hypothesis fails, the subsequent phase is redesigned.
- The Soma integration (delegation, check, pulse tree) is additive. Cortex v0.1-v0.3 work without any Soma infrastructure. Soma integration adds security and provenance, not core functionality.

### Risk 2: x402 Protocol Fragility

**Severity:** High
**Probability:** Medium

x402 daily transaction volume dropped 92% from December 2025 peaks. The protocol faces competition from MPP (Stripe), ACP (OpenAI), and AP2 (Google). A Coinbase facilitator outage would halt all x402 payments unless alternatives exist.

**Mitigation:**
- Three-tier payment architecture (Section 5b) puts 80% of transactions on proven subscription billing. x402 is reserved for high-value trustless transactions.
- ClawNet already abstracts over payment methods. Adding MPP or ACP support is an integration task, not an architecture change.
- x402 protocol risk is v1.5+ risk, not v1.0 risk. By the time Cortex needs x402 in production, the protocol landscape will be clearer.
- If x402 fails entirely, Cortex Insights ships as a standard SaaS data product. The routing intelligence has value independent of payment protocol.

### Risk 3: Privacy Guarantees for Rare Task Shapes

**Severity:** High
**Probability:** High

For rare task shapes (Rust embedded no_std, niche framework combinations), k-anonymity fails because the cohort might be 1. Differential privacy with strict epsilon degrades data utility. This is a fundamental tension, not an engineering problem.

**Mitigation:**
- Cortex Insights does not sell data for task shapes below the cohort threshold. No exceptions.
- Common task shapes (Python web, JavaScript React, TypeScript Node) have sufficient volume for privacy-safe aggregation. These are the 80% of queries.
- Rare task shapes are served by cold-start priors from public benchmarks, not marketplace data.
- Transparency: clearly label confidence intervals, cohort sizes, and provenance on all sold data.

### Risk 4: Chicken-and-Egg for Marketplace

**Severity:** Medium
**Probability:** High (for federated marketplace)

Who provides data before there are enough Cortex instances? Two-thirds of failed marketplaces die on the supply side.

**Mitigation:**
- HeyVera seeds the marketplace with its own curated benchmarks (RouterBench data, public eval results, in-house calibration runs). This makes HeyVera the initial intelligence provider, not a neutral marketplace operator.
- Free tier data solves cold-start for buyers: new Cortex instances get useful routing intelligence immediately.
- Marketplace is v1.5+, not v1.0. By the time marketplace launches, v1.0 has generated months of evidence data from production users.
- If the marketplace never achieves network effects, Cortex Insights remains a viable centralized data product (the Gartner/Forrester model, not the eBay model).

### Risk 5: Team Size and Funding

**Severity:** Critical
**Probability:** Depends on funding trajectory

The full vision requires 15-20 engineers for 12-18 months to reach full production. This includes:
- Core routing engine (Layers 1-4): 3-4 senior Rust engineers
- Evidence graph and attribution (Layer 5): 2-3 engineers
- x402 integration + hardening: 2 engineers
- Marketplace + privacy: 3-4 engineers
- UX/frontend: 2-3 engineers
- DevOps/infra: 1-2 engineers
- Compliance: 1-2 engineers

**Mitigation:**
- v0.1 is achievable with 2-3 engineers. This proves the core hypothesis before scaling the team.
- Existing infrastructure (ClawNet, Soma) reduces build effort for integration layers.
- Each phase is fundable independently. v0.1 proves technology. v0.2 proves multi-provider value. v1.0 proves product-market fit. Each milestone supports the next funding round.

### Risk 6: Competitor Response

**Severity:** High
**Probability:** High

Every major AI coding tool is building internal routing. Cursor already has "auto-mode." Copilot routes across models. By the time Cortex ships v1.0, competitors will have 80% of basic routing capability built in.

**Mitigation:**
- Cortex's differentiation comes from capabilities that take months/years to build and cannot be replicated by adding a model selection dropdown:
  - Evidence-based learning requires months of outcome data
  - Subscription pooling requires multi-provider auth infrastructure
  - Soma Delegation requires cryptographic identity infrastructure
  - Contamination-aware attribution requires understanding signal quality
- Position as infrastructure, not competitor. Cursor building internal routing is an opportunity: sell them Cortex as a better routing engine.
- Speed matters: ship v0.1 fast, get evidence data flowing, and compound the learning advantage.

### Risk 7: Data Moat Weakness

**Severity:** Medium
**Probability:** Medium

Andreessen Horowitz's "The Empty Promise of Data Moats" argues that data scale effects are not network effects, additional data yields diminishing returns, and data becomes commoditized.

**Mitigation:**
- The moat is not data volume alone. It is the combination of:
  - Local evidence quality (contamination-aware, causal attribution)
  - Soma-verified trust (cryptographic provenance, bond-backed identity)
  - Subscription pooling (structural advantage, not data advantage)
- For common task shapes, the moat is weak (GPT correctly identified this). For specialized domains, the moat is stronger.
- The honest position: Cortex's moat is medium-depth. The real defensibility is platform-level: the combination of routing + trust + delegation + pooling + provenance is hard to replicate, even if any single piece is not.

### Risk 8: Regulatory Complexity

**Severity:** Medium
**Probability:** Medium (increases with marketplace launch)

x402 payments involve data brokerage law, privacy law (GDPR, CCPA), export controls for security intelligence, financial compliance (stablecoin regulation via GENIUS Act), tax/accounting for micropayments, sanctions/KYT, and enterprise procurement requirements.

**Mitigation:**
- v1.0 has zero regulatory exposure: local-only, no payments, no data selling.
- Subscription tier (v1.5) uses standard SaaS billing: well-understood regulatory landscape.
- x402 tier adds complexity but benefits from Linux Foundation standardization and Coinbase's compliance infrastructure.
- Enterprise tier requires SOC 2, GDPR, SSO, audit logs -- standard enterprise requirements, not novel regulatory challenges.
- Budget for 1-2 compliance engineers starting at v1.5.

### Risk 9: Evidence Quality Bootstrap

**Severity:** Medium
**Probability:** High (early usage)

In the first weeks of deployment, the evidence graph is sparse. UCB with insufficient observations produces noisy routing decisions. Users may experience worse routing than a simple "always use the best model" strategy during the cold-start period.

**Mitigation:**
- PILOT-style preference-prior initialization from public benchmarks (RouterBench 405K+ observations, Chatbot Arena data). The router starts with informed priors, not uniform.
- Progressive user messaging: "Cortex is learning your repository's patterns. In the first 20 tasks, routing may not yet reflect local evidence."
- Statistical significance thresholds per task family: do not claim learned routing until minimum 5 observations per (TaskFamily, RiskClass, ModelId) bucket.
- Confidence ceiling from `RepoObservabilityProfile` prevents overclaiming even with good priors.
- Free-tier Cortex Insights (v1.5) provides curated cold-start data from the broader Cortex user base.

### Risk 10: User Comprehension

**Severity:** Medium
**Probability:** Medium

The full Cortex system has significant conceptual overhead: 5 layers, 12+ route templates, 31 signal kinds, 4 risk classes, 10 dial levels, contamination profiles, confidence bands, autonomy thresholds. Enterprise architects can absorb this. Individual developers may find it overwhelming.

**Mitigation:**
- The dial is the ONLY user-facing control. Everything else is hidden behind intelligent defaults.
- Default profile ("auto") handles routing, risk classification, and verification depth without configuration.
- The system explains its decisions in natural language, not in internal type names.
- Progressive disclosure: casual users see "Cortex used Claude for this task." Power users can expand to see the full routing audit. Enterprise admins can configure policy gates.
- Documentation targets three audiences: (1) "Just works" guide for individual users (1 page), (2) "How it works" guide for team leads (10 pages), (3) Full architecture reference for platform engineers (this document).

### Risk Summary Matrix

| Risk | Severity | Probability | Phase Impact | Mitigation Quality |
|------|----------|-------------|-------------|-------------------|
| Scope creep | Critical | High | All phases | Good (phased build, explicit validation criteria) |
| x402 fragility | High | Medium | v1.5+ | Good (three-tier architecture, protocol abstraction) |
| Privacy for rare tasks | High | High | v1.5+ | Moderate (hard constraint, some data unsellable) |
| Marketplace chicken-and-egg | Medium | High | v1.5+ | Good (HeyVera seeds supply, data product first) |
| Team size/funding | Critical | Variable | All phases | Good (phased funding, incremental team growth) |
| Competitor response | High | High | v1.0+ | Moderate (infrastructure moat, but competitors have distribution) |
| Data moat weakness | Medium | Medium | v2.0+ | Moderate (platform moat, not data moat alone) |
| Regulatory complexity | Medium | Medium | v1.5+ | Good (v1.0 has zero exposure, standard compliance path) |
| Evidence quality bootstrap | Medium | High | v0.1 | Good (public priors, progressive messaging) |
| User comprehension | Medium | Medium | v1.0+ | Good (dial-only interface, progressive disclosure) |

---

## 11. The 10 Things That Make Cortex + Soma + ClawNet Unprecedented

These are ordered by buildability and grounded in either existing production infrastructure or research evidence. Each item must be: (a) buildable with existing infrastructure, (b) differentiated from what competitors can replicate, and (c) supported by research or production evidence.

### 1. Evidence-based routing that improves with every execution.

Not "pick the cheapest model" (OpenRouter) or "classify the query" (Martian/Not Diamond). A closed-loop system where every execution outcome -- compile results, test passes, CI status, user edits, reverts, production incidents -- updates routing beliefs through a contamination-aware attribution pipeline. This is the core differentiator and the only one that matters for v1.

**Why competitors cannot easily replicate:** Requires months of evidence collection, contamination tracking infrastructure, and belief management. Adding a model dropdown to Cursor does not create this.

**Research basis:** ParetoBandit validates closed-loop budget-paced routing. RouterBench demonstrates that no single model is optimal across all task shapes. PILOT validates preference-prior warm start. Cascade Routing validates quality estimators as the critical ingredient.

### 2. Cascade routing with contamination-aware quality estimators.

Start cheap, evaluate the result, escalate only when the quality estimator says so -- not when the model self-reports low confidence (AbstentionBench shows reasoning models degrade abstention by 24%). External quality estimation based on objective signals (compile, typecheck, test) outperforms model self-assessment.

**Why this is differentiated:** Cursor's "auto-mode" picks a model upfront. Cortex tries the cheapest model first, evaluates the result against objective quality signals, and escalates only when evidence warrants it. This consistently saves 20-60% versus always-use-best-model strategies (Cascade Routing paper: >4% absolute performance improvement, ~80% relative improvement over naive baseline).

**Research basis:** Cascade Routing (ETH Zurich), AbstentionBench (TACL 2025), CSCR (NeurIPS 2025 Spotlight).

### 3. Invariant risk floors that the learner cannot override.

Auth/payment/secrets changes require full verification regardless of dial setting, budget pressure, or learned beliefs. The evidence floor is a safety property, not an optimization target. This is what separates Cortex from "move fast and break things" AI tools.

**Why this is differentiated:** No existing routing system has policy-enforced verification floors that the learning algorithm cannot lower. Every competitor's routing is purely an optimization problem. Cortex's routing is a constrained optimization problem where the constraints are invariant.

**Existing infrastructure:** File-path glob patterns for risk classification are simple to implement and operationally clear. `auth/**` is always at least High risk.

### 4. Subscription pooling across providers with fair-share allocation.

Turn fragmented $20-200/month individual subscriptions into team-level compute pools with priority-class allocation. Required verification gets priority over optional dial expansion. Interactive work gets priority over exploration.

**Why this is differentiated:** Nobody else does this. Every AI coding tool is single-provider. A team with Claude Max + GPT Pro + Gemini subscriptions currently switches between tools manually. Cortex pools them into a unified capacity with intelligent routing.

**Why it is buildable:** The subscription registry and fair-share allocator are well-understood systems engineering. Redis-backed token buckets with variable-cost reservations handle the rate-limiting. The novel part is the integration with the routing learner.

### 5. Soma Delegation for scoped, bounded, revocable agent authority.

When Cortex spawns multi-agent workflows, each agent gets a Soma Delegation key with spend caps, scope narrowing, depth limits, cascade revoke, and intent declaration. No other protocol provides this. This is the single most-cited unsolved pain in multi-agent literature (Grantex 2026).

**Why this is unprecedented:** Comparison table in Section 4a shows no existing system (IETF draft-klrc, OAuth 2.0, capability-based systems) provides spend-bounded delegation + cascade revoke + intent declaration together.

**Existing infrastructure:** Production since Q1 2026 in ClawNet. 23 unit tests. Public API surface. Metrics dashboard. This is not a spec -- it is running code.

### 6. Cryptographic provenance via Soma Pulse Tree.

Every routing decision, model output, verification step, and economic transaction gets a Merkle proof in one universal tree. Enterprise clients get verifiable proof of agent execution compressed into 192 bytes (Nova IVC + Groth16). One year, 100,000 actions, same 192 bytes, same 5ms verification.

**Why this is unprecedented:** No other agent system provides cryptographic proof of execution history. The individual primitives exist (Nova, Groth16, MMR). The composition for agent lifecycle proofs is genuinely novel.

**Research basis:** Nova IVC (Microsoft), Sonobe (PSE), Celestia NMT, Summa MST. Competitive moat analysis shows no competitor has universal lifecycle trees, Nova IVC from birth, or economic sum proofs in identity trees.

### 7. Objective evidence dominates model self-report and user vibes.

Compile results, test outcomes, CI status, reverts, and production incidents carry more weight than model self-confidence or user thumbs-up. The 5-tier signal taxonomy with 31 signal kinds ensures that evidence quality is tracked, not just evidence existence.

**Why this is differentiated:** Most routing systems learn from user thumbs-up/thumbs-down. Cortex learns from objective outcomes weighted by contamination profile. A generated test passing against generated code (0.65 contamination penalty) is dramatically less trusted than a human-written regression test passing in CI (0.0 penalty).

**Research basis:** AbstentionBench proves models cannot reliably self-assess. Generalized Correctness Models paper shows historical correctness patterns beat model self-introspection.

### 8. Multi-provider resilience and arbitrage with circuit breakers.

When Claude is rate-limited, automatically route to GPT or Gemini. When GPT's quality degrades on a task type, reroute to Claude. Circuit breakers (configured thresholds, not learned) prevent cascading failures. Provider drift detection via formal statistical methods (not just error counting).

**Why this is differentiated:** Single-provider tools have zero resilience. When Anthropic has an outage, Claude Code users wait. Cortex users transparently route to the next-best provider.

**Research basis:** Condorcet's jury theorem analytically justifies multi-provider diversity. dLinUCB validates dual detection (fast change-point for outages + slow sliding window for drift).

### 9. Explainable routing decisions with Topaz-inspired skill profiles.

Every routing decision produces a human-readable trace: "Selected Claude Sonnet because this is a Python web task (skill score 0.92), budget is sufficient (73% remaining), and the quality estimator predicts 0.87 success probability. Alternative: GPT-4.1 (0.84 predicted, 40% cheaper)." Not post-hoc rationalization -- inherently interpretable routing.

**Why this is differentiated:** No competitor explains why it chose a specific model. Cursor's auto-mode is a black box. Cortex's routing is auditable by design.

**Research basis:** Topaz (arXiv:2604.03527) validates inherently interpretable routing with skill-based model profiles.

### 10. Intent-aware scheduling with scoped blocking and route-around.

When a node blocks on user input, sibling nodes continue executing. When a dependency fails, only dependent nodes are blocked -- not the entire workflow. This is the scheduler intelligence that makes multi-step coding workflows actually complete instead of stalling at the first question.

**Why this is differentiated:** Most multi-agent systems either stall entirely on any blocker or proceed recklessly. Scoped blocking is the middle ground that preserves causal integrity while maximizing throughput.

**Research basis:** GoalAct validates continuously-updating plans with hierarchical execution. DART-LLM validates DAG dependencies for multi-actor execution (do not parallelize unless edits are disjoint). Microsoft's Agent Framework validates graph-based workflow with typed dependency edges.

### What GPT Proposed That Did Not Make This List (And Why)

GPT-5.5's original list included three items that Opus challenged and this synthesis removed:

**"Cold-start via paid federated intelligence" (GPT #7, removed).**
Cold-start should be solved via curated public benchmarks (RouterBench 405K+ observations), preference priors (PILOT paper), and HeyVera's own calibration data. Requiring a marketplace that does not yet exist for cold-start creates a circular dependency. Cold-start priors should be free, not paid. The marketplace matters for rare task shapes and premium intelligence, not for basic cold-start.

**"x402-native agents that buy data at moment of uncertainty" (GPT #8, removed).**
The latency analysis (Section 5c) shows x402 adds 50-200ms per transaction. For routing decisions that need to happen in <25ms (Cursor's benchmark), per-request x402 purchases are latency-prohibitive. Pre-fetched and cached data with Soma Check validation is the viable pattern. The "buy at moment of uncertainty" vision is aspirational but operationally impractical for real-time routing.

**"Cortex as both consumer and seller of routing evidence" (GPT #9, demoted).**
The privacy challenges (rare task shape k-anonymity failure), chicken-and-egg problems (who sells to the first 100 instances?), and regulatory complexity (data brokerage law, GDPR) make this a v2+ feature. It is real but not a launch differentiator. Cortex Insights as a curated, centralized data product ships first. Federated marketplace comes later if demand validates the model.

### What Makes the Final List Different from Either Individual List

GPT-5.5's list was aspirational: it assumed everything could be built and the market would adopt it. Some items required infrastructure that does not exist (federated marketplace) or violated physical constraints (per-request x402 in the routing hot path).

Opus 4.7's list was conservative: it correctly identified what is buildable but underweighted the Soma infrastructure advantage. Opus assumed Soma would need to be built from scratch, when in fact key primitives are already production.

This synthesis keeps GPT's ambition for items grounded in existing infrastructure (evidence-based routing on production evidence systems, Soma Delegation for agent authority using production ClawNet, Pulse Tree for provenance using specified architecture). It keeps Opus's discipline for items that depend on unbuilt infrastructure (marketplace, federated intelligence, per-request x402).

The result: a list where every item is either already in production code or achievable within the v1.0 timeline with the specified team size.

---

## 12. Research Foundation

This section catalogs the 70+ papers that inform Cortex's design, organized by topic. Full analysis is in `.dualbrain/routing-research-deep.md` (Opus's 40+ papers) and `.dualbrain/routing-research-gpt55-deep.md` (GPT's 40+ papers). Only the most design-critical papers are listed here.

### LLM Routing (Post-RouteLLM Generation)

| Paper | Year | Key Insight | Cortex Impact |
|-------|------|-------------|---------------|
| [ParetoBandit](https://arxiv.org/abs/2604.00136) | 2026 | Budget-paced adaptive routing via primal-dual control. Mean per-request cost never exceeds budget by >0.4%. | **CRITICAL.** Closed-loop budget pacer replaces static budget windows. Hot-swap registry solves provider onboarding. |
| [CSCR](https://arxiv.org/abs/2508.12491) | 2025 | Cost-spectrum contrastive routing via FAISS k-NN. Microsecond routing latency. No retraining on pool change. | **CRITICAL for Rust implementation.** k-NN routing in Rust with HNSW index. Generalizes to unseen models. |
| [Cascade Routing](https://arxiv.org/abs/2410.10347) | 2024 | Quality estimators are THE critical factor. >4% absolute improvement over routing or cascading alone. | **CRITICAL.** Validates cascade approach. Quality estimators are P0 implementation priority. |
| [PILOT](https://arxiv.org/abs/2508.21141) | 2025 | Preference-prior initialization for LinUCB. Shared query-model embedding space. | **HIGH.** Dramatically reduces cold-start problem via warm initialization. |
| [MixLLM](https://arxiv.org/abs/2502.18482) | 2025 | Domain-aware query tagging via unsupervised fine-tuning. 97.25% of GPT-4 quality at 24.18% cost. | **HIGH.** Domain tags should feed intent detection. |
| [BEST-Route](https://arxiv.org/abs/2506.22716) | 2025 | Route over both model selection AND sampling strategy. Up to 60% cost reduction. | **HIGH.** Challenges single-response assumption. Add sample_count to routing. |
| [Route-to-Reason](https://arxiv.org/abs/2505.19435) | 2025 | Route across model AND reasoning strategy simultaneously. | **HIGH.** Expand routing from model selection to strategy selection. |
| [Router-R1](https://arxiv.org/abs/2506.09033) | 2025 | RL-based router with interleaved think/route. Generalizes to unseen models via descriptors. | **HIGH.** Validates "think before acting" principle. |
| [Topaz](https://arxiv.org/abs/2604.03527) | 2026 | Inherently interpretable routing via skill-based model profiles. | **CRITICAL.** Every routing decision must produce human-readable explanation. |
| [RouterArena](https://arxiv.org/abs/2510.00202) | 2025 | Benchmark platform: no single router is universally optimal. | **HIGH for validation.** Benchmark Cortex against RouterArena. |
| [Survey: Dynamic Routing](https://arxiv.org/abs/2603.04445) | 2026 | Comprehensive survey of routing and cascading landscape. | Reference document for design decisions. |

### Confidence Calibration

| Paper | Year | Key Insight | Cortex Impact |
|-------|------|-------------|---------------|
| [AbstentionBench](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00754/131566/) | 2025 | Reasoning fine-tuning degrades abstention by 24%. Models cannot reliably know their limits. | **CRITICAL.** External quality estimation is mandatory. Cannot trust model self-confidence. |
| [Conformal Prediction Survey](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00715/125278/) | 2025 | Distribution-free coverage guarantees. Prediction set size correlates with accuracy. | **CRITICAL.** Mathematical confidence bounds replace heuristic scores. |
| [Uncertainty Propagation](https://arxiv.org/abs/2604.23505) | 2026 | Uncertainty compounds through multi-step LLM pipelines. | **HIGH.** Track and compound uncertainty through pipeline stages. |
| [ToKUR](https://arxiv.org/abs/2505.11737) | 2025 | Token-level entropy reliably indicates hallucinations. | **HIGH.** Cheap real-time confidence signal when logprobs available. |

### Credit Assignment

| Paper | Year | Key Insight | Cortex Impact |
|-------|------|-------------|---------------|
| [SHARP](https://arxiv.org/abs/2602.08335) | 2026 | Tripartite Shapley credit: global accuracy + marginal credit + tool process rewards. | **HIGH.** Maps directly to search/execute/think tier credit. |
| [Causal Credit](https://arxiv.org/abs/2602.09331) | 2026 | Counterfactual reasoning isolates causal contributions. | **HIGH.** "What would have happened without this step?" |
| [Contextual Counterfactual](https://arxiv.org/abs/2603.06859) | 2026 | Compare similar task contexts, not global averages. | **HIGH.** Challenges naive win-rate leaderboards. |

### Non-Stationary Bandits

| Paper | Year | Key Insight | Cortex Impact |
|-------|------|-------------|---------------|
| [Catoni Change-Point](https://arxiv.org/abs/2505.20051) | 2025 | Heavy-tailed reward distributions need robust estimation. | **HIGH.** LLM quality has heavy-tailed distributions. |
| [SW-Whittle](https://arxiv.org/abs/2506.18186) | 2025 | Restless bandits for resources that evolve when not pulled. | **MEDIUM-HIGH.** Models change even when not queried. |
| Sliding-Window Thompson Sampling | 2025 | Handles both abrupt changes and smooth drift. | **HIGH.** v2 routing algorithm. |

### Intent Decomposition

| Paper | Year | Key Insight | Cortex Impact |
|-------|------|-------------|---------------|
| [GoalAct](https://arxiv.org/abs/2504.16563) | 2025 | Continuously-updating global plan + hierarchical skill execution. Best Paper NCIIP 2025. | **HIGH.** Agent templates ARE skills. Ship Captain should re-plan after each step. |
| [HiPlan](https://arxiv.org/abs/2508.19076) | 2025 | Dual-granularity guidance: global milestones + local stepwise hints. | **HIGH.** Milestone library from past successful executions. |
| [HTN + LLM Heuristics](https://arxiv.org/abs/2605.07707) | 2026 | Classical planning + LLM domain heuristics. Failure-mode-specific guidance. | **MEDIUM-HIGH.** Structured decomposition with adaptive refinement. |

### Evidence Provenance

| Paper | Year | Key Insight | Cortex Impact |
|-------|------|-------------|---------------|
| [PROV-AGENT](https://arxiv.org/abs/2508.02866) | 2025 | W3C PROV extensions for agent decisions and outcomes. | **HIGH.** Log every routing decision as provenance. |
| [Audit Trails for LLMs](https://arxiv.org/abs/2601.20727) | 2026 | Tamper-evident lifecycle ledger. | **HIGH.** Supports replay and "why did we route this?" queries. |

### Self-Healing and Drift Detection

| Paper | Year | Key Insight | Cortex Impact |
|-------|------|-------------|---------------|
| [Adaptive Monitoring for Agentic AI](https://arxiv.org/abs/2509.00115) | 2025 | EWMA thresholds + joint anomaly detection. | **HIGH.** Rolling baselines for success rate, latency, cost, retries. |
| [QSAF: Cognitive Degradation](https://arxiv.org/abs/2507.15330) | 2025 | Agent degradation as runtime vulnerability class. | **HIGH.** Circuit breakers for looping, stale assumptions, excessive retries. |
| [RouteNLP](https://arxiv.org/abs/2604.23577) | 2026 | Conformal cascade thresholds + failure clustering + retraining. | **HIGH.** Store failed attempts, cluster them, calibrate cheaper specialists. |

### Multi-Agent Orchestration

| Paper | Year | Key Insight | Cortex Impact |
|-------|------|-------------|---------------|
| [MasRouter](https://aclanthology.org/anthology-files/pdf/acl/2025.acl-long.757.pdf) | 2025 | Multi-agent routing includes topology, count, role, per-agent model choice. | **HIGH.** Route over (model, strategy, topology). |
| [DART-LLM](https://huggingface.co/papers/2411.09022) | 2024 | DAG dependencies: do not parallelize unless edits are disjoint. | **HIGH.** Challenges blind parallelism. |
| Production Statistics | 2026 | 72% of enterprise AI involves multi-agent; 95% fail to reach production. | Architecture quality is massive differentiator. |

### x402 Protocol and Security

| Paper | Year | Key Insight | Cortex Impact |
|-------|------|-------------|---------------|
| [Five Attacks on x402](https://arxiv.org/abs/2605.11781) | 2026 | Settlement inconsistency (5.18%), replay (248 grants/payment), cache bypass (100%), Sybil (71.8%). | **CRITICAL.** Each mitigation is a subsystem. Not "add x402 support" but "build hardened payment gateway." |
| [Hardening x402](https://arxiv.org/abs/2604.11430) | 2026 | PII-safe agentic payments with metadata redaction. | **HIGH.** Payment metadata must be filtered before facilitator. |
| [A402](https://arxiv.org/abs/2603.01179) | 2026 | Binding payments to service execution for atomicity. | **HIGH.** Solve paid-but-denied and unpaid-service outcomes. |

### Novel Approaches

| Paper | Year | Key Insight | Cortex Impact |
|-------|------|-------------|---------------|
| [EvoAgentX](https://aclanthology.org/anthology-files/pdf/emnlp/2025.emnlp-demos.47.pdf) | 2025 | Evolve agentic workflows themselves. | **v2+.** Let Cortex mutate workflow graphs and keep winners. |
| [AlphaEvolve](https://arxiv.org/abs/2506.13131) | 2025 | Evolutionary loops improve code using LLM mutation + evaluators. | **v2+.** Evolutionary search for hard coding tasks. |
| [Expert Orchestration via Jury Theorems](various) | 2025 | Condorcet's theorem: ensemble routing analytically outperforms monoliths given diversity. | **Theoretical validation.** Multi-provider diversity is mathematically justified. |

### Market and Competitive Intelligence

| Source | Key Data Point |
|--------|---------------|
| [Cursor Statistics](https://www.getpanto.ai/blog/cursor-ai-statistics) | $2B ARR, $29.3B valuation, 1M+ paid users |
| [Claude Code Survey](https://uvik.net/blog/claude-code-vs-cursor-vs-copilot-vs-codex-2026/) | 46% most-loved, 18% adoption |
| [OpenRouter Revenue](https://sacra.com/c/openrouter/) | $50M ARR, 5.5% take-rate |
| [Martian Valuation](https://medium.com/@sarawgiapoorvwork347/martian-the-san-francisco-based-startup-that-invented-the-first-llm-router-is-reportedly-nearing-4211dd768296) | $1.3B, enterprise contracts via Accenture |
| [AI Coding Market](https://www.ideaplan.io/blog/ai-coding-assistant-market-share-2026) | $12.8B in 2026, 27% CAGR |
| [Data Moats](https://a16z.com/the-empty-promise-of-data-moats/) | Data scale effects are not network effects |
| [IDC Multi-Model Projection](various) | 70% of top AI enterprises will use dynamic routing by 2028 |
| [Grantex Agent Security 2026](referenced) | Delegation is #1 unsolved multi-agent security problem |

### Federated Learning and Privacy

| Paper | Year | Key Insight | Cortex Impact |
|-------|------|-------------|---------------|
| [Gradient Inversion Attacks Survey](https://github.com/Pengxin-Guo/Awesome-Gradient-Inversion-Attacks) | 2026 | Verified gradient inversion attacks (VGIA) provide certificates of correctness for reconstructed samples. Even aggregates leak. | **HIGH.** Cortex must sell coarse, policy-filtered evidence products, not model updates. |
| [Federated Learning Gradient Leakage](https://arxiv.org/abs/2503.11514) | 2025 | Composition attacks: if only one instance matches a task shape, k-anonymity is meaningless. | **CRITICAL constraint.** Minimum cohort threshold is mandatory. Some data is unsellable. |
| [Differential Privacy Reversal](https://medium.com/@instatunnel/it-162aee1dbfe5) | 2025 | LLM feedback can reverse differential privacy protections in some settings. | **HIGH.** Strict epsilon values required. Privacy-utility tradeoff is real. |
| [Privacy-Preserving Analytics](https://dl.acm.org/doi/10.1145/3629527.3652276) | 2024 | Techniques for sharing analytics metrics without exposing individual records. | **MEDIUM-HIGH.** Applicable to Cortex Insights aggregation pipeline. |

### Subscription Rate Limiting

| Source | Key Insight | Cortex Impact |
|--------|-------------|---------------|
| [Redis Rate Limiting](https://redis.io/tutorials/howtos/ratelimiting/) | Sliding window, token bucket, leaky bucket each fit different needs. | Use token buckets per provider, subscription, org, model, and task class. |
| [Novu Variable-Cost Token Bucket](https://docs.novu.co/api-reference/rate-limiting) | Different operations can consume different token costs. | Charge routing decisions by expected tokens, model tier, and retry risk. |
| [Centrifugo Distributed Rate Limit](https://centrifugal.dev/docs/pro/distributed_rate_limit) | Millisecond-precision distributed token buckets. | Route only to providers with available capacity; queue or cascade otherwise. |

### Additional Research Context

**Multi-agent failure rates.** 72% of enterprise AI projects now involve multi-agent architectures (up from 23% in 2024). But 95% fail to reach production due to architecture, governance, and integration gaps. This means robust architecture is a massive differentiator -- and the 95% failure rate validates Cortex's emphasis on typed contracts, scoped blocking, evidence floors, and Soma Delegation.

**The routing market is real.** Martian approaching $1.3B valuation with Accenture integration. Not Diamond growing at $0.001/recommendation. OpenRouter at $50M ARR. IDC projects 70% of top AI enterprises using dynamic routing by 2028. The question is not "is routing valuable?" but "which routing architecture wins?"

**AbstentionBench is the most important single finding.** If reasoning-tuned models degrade abstention by 24%, every routing system that relies on model self-confidence is building on sand. This is why Cortex uses external quality estimation (compile results, test outcomes, CI status) rather than asking the model "how confident are you?" The evidence floor exists because we cannot trust models to know their own limits.

**The cascade routing insight is operationally transformative.** The ETH Zurich paper shows cascade routing (try cheap first, evaluate, escalate if needed) consistently outperforms both pure routing (pick one model) and pure cascading (always escalate on any uncertainty) by >4% absolute, ~80% relative improvement. Quality estimators are the critical ingredient. Cortex's cascade route template directly implements this finding.

**ParetoBandit is the closest existing system to Cortex's route scorer.** Its closed-loop primal-dual budget pacer is strictly superior to static budget windows. Its hot-swap model registry solves provider onboarding. Its geometric forgetting handles non-stationarity. Cortex should study this implementation closely and adopt its budget control mechanism for v0.2.

**Jury theorem validation of multi-provider diversity.** Condorcet's jury theorem mathematically proves that routing to diverse specialists outperforms a single generalist, given sufficient diversity. This is not an intuition -- it is a theorem. Cortex's dual-brain architecture (Claude + GPT) and multi-provider routing are analytically justified.

---

## Appendix A: Key Algorithms

### v1 Route Selection Pipeline (Pseudocode)

```
function route(request: RoutingRequest) -> RouteDecision:
    // Layer 1: Decompose intent
    intent_graph = decompose(request.goal, request.repo_context)
    
    // Layer 2: Find ready nodes
    ready_nodes = scheduler.find_ready(intent_graph)
    
    for node in ready_nodes:
        // Layer 3a: Invariant Policy Gate
        risk = classify_risk(node.files, node.task_family)
        risk = max(risk, invariant_floor(node.files))  // floor NEVER lowers
        evidence_floor = get_evidence_floor(risk, node.task_family)
        privacy_filter = get_privacy_policy(request.repo, request.team)
        budget_check = check_budget(request.dial, risk, request.pool)
        
        if budget_check.exceeded:
            return RouteDecision::BudgetExceeded
        
        // Layer 3b: Capacity Tracker
        capacity = snapshot_capacity(request.subscriptions)
        healthy = filter_circuit_breakers(capacity)
        available = filter_privacy(healthy, privacy_filter, node.stage_input_policy)
        
        // Layer 3c: Dial Mapper
        envelope = dial_to_envelope(request.dial, risk, request.pool)
        
        // Layer 4a: Template Selection
        eligible_templates = templates.filter(|t|
            t.min_dial <= request.dial &&
            t.max_dial >= request.dial &&
            t.supported_task_families.contains(node.task_family) &&
            can_satisfy_evidence_floor(t, evidence_floor, available)
        )
        
        // Layer 4b: UCB Scoring
        candidates = []
        for template in eligible_templates:
            for model_assignment in instantiate(template, available):
                // Check independence requirements
                if risk >= High && !independence_satisfied(model_assignment):
                    continue
                
                // Score via UCB
                key = RouteBeliefKey {
                    task_family: node.task_family,
                    repo_profile: request.repo.profile_bucket(),
                    risk_class: risk,
                    model_id: model_assignment.primary_model,
                    strategy_id: template.id,
                }
                belief = belief_store.current_belief(key)
                score = ucb_score(
                    belief.mean_reward,
                    belief.uncertainty,
                    exploration_temperature(request.dial)
                )
                candidates.push((model_assignment, score, template))
        
        // Select best candidate
        candidates.sort_by(|a, b| b.score.cmp(a.score))
        selected = candidates[0]
        
        // Layer 4c: Autonomy Gate
        confidence = compute_confidence(node, selected, request.repo)
        autonomy = autonomy_gate(confidence, risk)
        
        match autonomy.policy:
            ProceedAutonomously => execute(selected)
            ProceedAndFlag => execute(selected); flag_user(node)
            AskBeforeProceeding => ask_user(node, selected, autonomy.rationale)
            RequireExplicitApproval => require_approval(node, selected)
            Forbidden => block(node, autonomy.rationale)
        
        // Record decision audit
        audit = RouteDecisionAudit {
            selected,
            alternatives: candidates[1..],
            policy_filters_applied: [risk, privacy_filter, budget_check],
            capacity_at_decision: capacity,
            confidence_breakdown: confidence.weights,
            autonomy_decision: autonomy,
        }
        
        // Layer 5: Execute and collect evidence
        outcome = execute_route(selected, node)
        events = collect_evidence(outcome, finalization_windows)
        
        for event in events:
            // Attribution with contamination
            contamination = compute_contamination(event, selected)
            credit = assign_credit(event, selected.roles, contamination)
            // credit.total_weight <= 1.0 (invariant)
            
            update = AttributionUpdate {
                task_id: node.id,
                attempt_id: outcome.attempt_id,
                route_id: selected.route_id,
                model_id: selected.model,
                event_id: event.id,
                reward_delta: credit.reward * (1.0 - contamination.penalty()),
                confidence_delta: credit.confidence,
            }
            
            // Three gates before updating belief
            if !minimum_signal_diversity(events): defer
            if !confidence_floor(risk): defer
            if !signal_freshness(event): decay
            
            belief_store.append_update(update)
```

### Confidence Ceiling Computation

```
function compute_confidence_ceiling(repo: RepoObservabilityProfile) -> f64:
    ceiling = 0.25  // base: no observability
    if repo.has_compile_step:  ceiling += 0.15
    if repo.has_typecheck:     ceiling += 0.15
    if repo.has_build:         ceiling += 0.15
    if repo.has_tests:         ceiling += 0.25
    if repo.has_ci:            ceiling += 0.10
    if repo.has_runtime_smoke: ceiling += 0.10
    return clamp(ceiling, 0.25, 0.95)

// Examples:
// No tests, no CI, no typecheck:        ceiling = 0.25
// TypeScript with tests:                ceiling = 0.25 + 0.15 + 0.25 = 0.65
// Rust with tests + CI + build:         ceiling = 0.25 + 0.15 + 0.15 + 0.15 + 0.25 + 0.10 = 0.95 (capped)
// Python with no tests but has lint:    ceiling = 0.25 (lint not included in ceiling)
```

### Cost Budget from Dial

```
function cost_budget(dial: u8, risk: RiskClass, pool: PoolSummary) -> CostBudget:
    base_units = match dial:
        1 => 1.0,   2 => 1.5,  3 => 2.0,   4 => 3.0,
        5 => 4.0,   6 => 5.5,  7 => 7.0,   8 => 9.0,
        9 => 12.0, 10 => 16.0
    
    risk_multiplier = match risk:
        Low      => 1.0,
        Medium   => 1.25,
        High     => 1.75,
        Critical => 2.5
    
    return CostBudget {
        max_subscription_units: base_units * risk_multiplier,
        max_premium_calls: pool.premium_model_count,
    }

// Examples:
// Dial 3, Low risk:      2.0 * 1.0  =  2.0 units
// Dial 5, Medium risk:   4.0 * 1.25 =  5.0 units
// Dial 8, High risk:     9.0 * 1.75 = 15.75 units
// Dial 10, Critical:    16.0 * 2.5  = 40.0 units
```

### Default Signal Weights (v1)

```
Signal                              Reward    Confidence  Contamination
ExistingTestsPass                   +0.80     0.90        0.00
ExistingTestsFail                   -1.00     0.95        0.00
ReproTestBeforeFailsAfterPasses     +1.00     0.95        0.10
CompilePass                         +0.40     0.85        0.00
CompileFail                         -0.80     0.95        0.00
TypecheckPass                       +0.35     0.80        0.00
TypecheckFail                       -0.70     0.90        0.00
LintPass                            +0.15     0.60        0.00
LintFail                            -0.30     0.70        0.00
BuildPass                           +0.50     0.85        0.00
BuildFail                           -0.90     0.95        0.00
RuntimeSmokePass                    +0.60     0.80        0.05
RuntimeSmokeFail                    -0.85     0.90        0.05
SecurityScanPass                    +0.55     0.75        0.00
SecurityScanFail                    -0.95     0.90        0.00
HumanReviewApprove                  +0.45     0.70        0.00
HumanReviewReject                   -0.60     0.80        0.00
IndependentModelReviewPass          +0.55     0.75        0.15
IndependentModelReviewFail          -0.65     0.80        0.15
UserAccept                          +0.12     0.25        0.10
UserReject                          -0.15     0.30        0.10
Merged                              +0.30     0.50        0.00
Reverted                            -1.20     0.90        0.00
FollowupFixSameScope                -0.40     0.60        0.00
NoRevertAfterWindow                 +0.20     0.40        0.00
ProductionIncidentLinked            -1.50     0.95        0.00
AgentSelfReport                     +0.05     0.10        0.30
GeneratedTestsPass                  +0.30     0.50        0.25
GeneratedTestsFail                  -0.50     0.60        0.25
DocsLinkValid                       +0.10     0.40        0.00
DocsLinkBroken                      -0.15     0.50        0.00
BenchmarkImproved                   +0.35     0.65        0.10
BenchmarkRegressed                  -0.45     0.70        0.10
```

Note: `AgentSelfReport` has the lowest reward (+0.05) and highest contamination (0.30) of any positive signal. This reflects the AbstentionBench finding that model self-assessment degrades with reasoning fine-tuning. User accept (+0.12, 0.25 confidence) is intentionally weak -- it captures preference, not quality. `ProductionIncidentLinked` (-1.50) is the strongest negative signal because production incidents have the highest downstream cost.

## Appendix B: Glossary

| Term | Definition |
|------|-----------|
| **Cortex** | The 5-layer routing intelligence engine |
| **Soma** | The identity, trust, delegation, and cryptographic proof system (Heart) |
| **ClawNet** | The x402 payment router and data marketplace infrastructure |
| **HeyVera** | The parent platform (Soma + Cortex + Social + Marketplace) |
| **Dial** | 1-10 user control for resource investment |
| **Evidence Floor** | Minimum verification required by risk class (invariant, not learnable) |
| **Route Template** | Pre-defined execution strategy (e.g., SoloFast, ImplementThenReview) |
| **IntentGraph** | DAG of typed work nodes decomposed from user goal |
| **Pulse Tree** | MMR + namespace tags + sum annotations for universal proof structure |
| **Delegation Key** | Scoped credential with spend cap, depth limit, intent, and cascade revoke |
| **UCB** | Upper Confidence Bound (v1 route scoring algorithm) |
| **Thompson Sampling** | Bayesian exploration-exploitation algorithm (v2 route scoring) |
| **Contamination** | Degree to which an evidence signal is compromised by shared context |
| **Circuit Breaker** | Provider health state machine (Closed/Open/HalfOpen) |
| **Soma Check** | ETag-based data freshness verification over HTTP |
| **Nova IVC** | Incremental Verifiable Computation (continuous proof from birth) |
| **Groth16** | SNARK proof system; compresses Nova state to 192 bytes |

## Appendix C: Key Design Decisions Log

| # | Decision | Source | Rationale |
|---|----------|--------|-----------|
| 1 | UCB for v1, Thompson for v2 | GPT-5.5 wins | "Simple learner on clean evidence beats sophisticated learner on garbage" |
| 2 | 31 signal kinds, not 11 | GPT-5.5 wins | Different signals need different weights |
| 3 | 3D signal weights (reward, confidence, contamination) | GPT-5.5 wins | Single weight conflates distinct concepts |
| 4 | Causal credit capped at 1.0/event | Opus correction | Prevents double-penalization |
| 5 | Circuit breaker thresholds configured, not learned | Opus holds | Learning creates meta-learning problems |
| 6 | 10+ route templates, not 4 | Opus wins | Real scenarios need Cascade, DualBrain, explore-then-implement |
| 7 | Subscription-unit-relative dial, not absolute dollars | GPT-5.5 wins | Must scale with actual user capacity |
| 8 | Per-stage privacy evaluation | GPT-5.5 wins | Expands provider pool without compromising privacy |
| 9 | Three-tier payment architecture | Opus proposal | 80% on subscription billing, 20% on x402 |
| 10 | Evidence marketplace as product first, protocol second | Opus proposal | Cortex Insights ships before marketplace |
| 11 | One Pulse Tree, not multiple | Soma design | Cross-domain proofs trivial, one root = entire state |
| 12 | Nova IVC from day one, not as upgrade | Soma design | Agents born with verifiable history are more valuable |
| 13 | Confidence ceiling by repo observability | Opus v1 design | Cannot claim high confidence in zero-test repos |
| 14 | Non-selection reason tracking | GPT-5.5 wins | Prevents quota-induced belief corruption |
| 15 | Compensating updates, never mutate history | GPT-5.5 wins | Append-only with compensating entries is architecturally cleaner |

## Appendix D: Reference Documents

| Document | Location | Contents |
|----------|----------|----------|
| Routing Intelligence Consensus | `.dualbrain/routing-intelligence-consensus.md` | 1686 lines. Full Rust types, 45 conflict resolutions, build sequence. |
| GPT-5.5 Big Picture | `.dualbrain/bigpicture-gpt55-round1.md` | x402 marketplace vision, 5-layer architecture, 10 unprecedented things. |
| Opus Challenge | `.dualbrain/bigpicture-opus-challenge.md` | Scope narrowing, x402 reality check, competitive positioning, build order. |
| Opus Research (Deep) | `.dualbrain/routing-research-deep.md` | 40+ papers: routing, bandits, confidence, credit, intent, evidence. |
| GPT Research (Deep) | `.dualbrain/routing-research-gpt55-deep.md` | 40+ papers: routing, orchestration, self-healing, bandits, provenance. |
| Soma Delegation Spec | `internal/active/soma-delegation-spec.md` | Full v0.1 spec with JSON structure, semantics, wire format, examples. |
| x402 Delegation Issue | `internal/active/x402-delegation-issue.md` | RFC draft for x402 extension. Production since Q1 2026. |
| Soma Check Header Spec | `internal/active/soma-check-header-spec.md` | HTTP header contract, security analysis, implementation pseudocode. |
| Soma Computation Witness | `internal/active/soma-computation-witness.md` | Pulse Tree architecture, Nova IVC pipeline, build plan. |
| Phase 5 Vision | `internal/backlog/phase5-soma-verified-economy.md` | Anti-Sybil trading platform, computation witness, trust economics. |
| Team Architecture Consensus | `.dualbrain/team-architecture-consensus.md` | Concurrent goal arbitration, lease model, conflict detection. |

## Appendix E: Expanded Dial Scenarios

This appendix provides detailed walkthroughs of how the full Cortex stack handles realistic scenarios at different dial levels, demonstrating the interaction between all layers.

### Scenario 1: Solo Developer, Dial 1, Documentation Fix

```
User: "Fix the broken link in README.md"
Dial: 1
Subscriptions: 1x Claude Pro ($20/month)
```

**Layer 1 (Intent Decomposer):**
- IntentShape: `SingleTask`
- 1 work node: `Implement` (kind: `Document`)
- No dependencies, no iteration
- Risk classification: `Low` (docs path)

**Layer 2 (Scheduler):**
- 1 ready node, nothing blocked
- Trivial scheduling

**Layer 3 (Policy Gate + Capacity + Dial):**
- Policy: `Low` risk, evidence floor: link check (optional)
- Capacity: 1 subscription, 1 model available (Claude Sonnet)
- Dial 1 envelope: 1.0 subscription units, 1 parallel, minimal verification

**Layer 4 (Route Scorer + Autonomy):**
- Template: `SoloFast` (only eligible at dial 1)
- UCB score: irrelevant (only 1 candidate)
- Confidence: 0.25 ceiling (README has no tests, no CI, no compile)
- Autonomy: `ProceedAutonomously` (Low risk, even low confidence is above 0.10 block threshold)

**Execution:**
- Claude Sonnet fixes the link
- Evidence: link check (if URL is accessible)
- No Soma Delegation (below dial 7)
- No Pulse Tree (not configured)

**Learning:**
- Weak positive signal: `DocsLinkValid` (+0.10 reward, 0.40 confidence)
- Belief update: minimal, capped by observability ceiling (0.25)

**Total cost:** ~$0.01 (one small API call)
**Total time:** ~5 seconds

### Scenario 2: Solo Developer, Dial 5, Python Bug Fix

```
User: "Fix the database connection pool exhaustion in src/db/pool.py"
Dial: 5
Subscriptions: 1x Claude Pro ($20/month)
Repo: Python Django, has tests, has CI
```

**Layer 1 (Intent Decomposer):**
- IntentShape: `SingleTask`
- 3 work nodes: `InspectCode` -> `Implement` -> `Test`
- FeedsInto edges (sequential)
- Risk classification: `Medium` (database code, not auth/payments)

**Layer 2 (Scheduler):**
- `InspectCode` is ready. `Implement` and `Test` are pending (dependency).
- After `InspectCode` completes: `Implement` becomes ready.
- After `Implement` completes: `Test` becomes ready.

**Layer 3 (Policy Gate + Capacity + Dial):**
- Policy: `Medium` risk, evidence floor: compile + existing tests + repro test (optional)
- Capacity: 1 subscription, Claude Sonnet available
- Dial 5 envelope: 4.0 * 1.25 (Medium multiplier) = 5.0 subscription units

**Layer 4 (Route Scorer + Autonomy):**
- Eligible templates: `SoloFast`, `SoloCareful`, `Cascade`, `BestSingle`
- UCB selects `BestSingle` (strongest prior for Python bug fixes at Medium risk)
- Confidence: 0.65 (repo has tests + CI: ceiling = 0.75)
- Autonomy: `ProceedAndFlag` (Medium risk, confidence 0.65 > 0.50 suggest threshold)

**Execution:**
- Claude Sonnet inspects, implements, runs tests
- 8/8 existing tests pass
- New repro test (optional): generated and passes
- CI pipeline triggered (async evidence collection)

**Evidence collected:**
- `ExistingTestsPass`: +0.80 reward, 0.90 confidence, 0.00 contamination
- `CompilePass`: +0.40 reward, 0.85 confidence, 0.00 contamination
- `GeneratedTestsPass`: +0.30 reward, 0.50 confidence, 0.25 contamination (generated by same model)

**Learning:**
- Strong positive update for Claude Sonnet on Python/Django bug fixes
- Contamination discount on generated test (same_model penalty: 0.25)
- Belief update passes all 3 gates (has hard signal, confidence > floor, signal fresh)

**Total cost:** ~$0.15 (medium API calls with test execution)
**Total time:** ~30 seconds

### Scenario 3: Team, Dial 8, Auth Refactor with Delegation

```
User: "Refactor the OAuth2 flow to support PKCE"
Dial: 8
Subscriptions: Claude Max ($100) + GPT Pro ($200) + Gemini Advanced ($22)
Team: 5 engineers, fair-share allocation
Repo: TypeScript, full test suite, CI/CD, security scanning
```

**Layer 1 (Intent Decomposer):**
- IntentShape: `MultiPhaseBuild`
- 6 work nodes:
  1. `Research` (understand current OAuth2 flow)
  2. `Plan` (design PKCE integration)
  3. `Implement` (modify OAuth2 handlers)
  4. `Test` (write PKCE-specific tests)
  5. `Review` (independent security review)
  6. `Verify` (run full security scan)
- Edges: Research -> Plan -> (Implement | Test in parallel) -> Review -> Verify
- Risk: `Critical` (auth code, invariant floor from `auth/**` glob)

**Layer 2 (Scheduler):**
- `Research` is ready immediately
- After Research: `Plan` becomes ready
- After Plan: `Implement` and `Test` become ready simultaneously (parallel)
- After both complete: `Review` becomes ready
- After Review: `Verify` becomes ready

**Layer 3 (Policy Gate + Capacity + Dial):**
- Policy: `Critical` risk, evidence floor: compile + existing tests + repro test + security scan + independent review + human review (ALL required)
- Independence requirement: reviewer must be different provider than implementer
- Capacity: 3 subscriptions, 6 models available
- Dial 8 envelope: 9.0 * 2.5 (Critical multiplier) = 22.5 subscription units, 5 parallel
- Fair-share: this user has used 40% of their daily allocation, 60% remaining

**Layer 4 (Route Scorer + Autonomy):**
- Eligible templates: `ImplementThenReview`, `TestFirstIndependent`, `CrossModelVerify`, `ParallelCandidates`, `FullCriticalPath`
- UCB selects `FullCriticalPath` (strongest prior for Critical-risk auth work with sufficient capacity)
- Research: Claude Haiku (cheap, read-only, strong prior for code analysis)
- Plan: Claude Opus (reasoning-tier model for architecture decisions)
- Implement: Claude Sonnet (strongest prior for TypeScript)
- Test: GPT-5.4 (different provider, IssueOnly input policy -- never sees implementation)
- Review: GPT-5.4 (different provider than implementer, DiffOnly input policy)
- Verify: Gemini (third provider, security scan integration)
- Confidence: 0.85 (full test suite + CI + security scanning: ceiling = 0.95)
- Autonomy: `RequireExplicitApproval` (Critical risk, even at 0.85 confidence)

**Soma Delegation (dial >= 7):**

```
Root (user session)
  depth=0, max_depth=3, spend_cap=$50
  |
  +-- Research Agent
  |     depth=1, max_depth=0, spend_cap=$3, scope={read-only}
  |     intent="Analyze current OAuth2 flow for PKCE migration"
  |     Model: Claude Haiku
  |
  +-- Planner Agent
  |     depth=1, max_depth=0, spend_cap=$8, scope={read-only}
  |     intent="Design PKCE integration plan"
  |     Model: Claude Opus
  |
  +-- Implementer Agent
  |     depth=1, max_depth=0, spend_cap=$15, scope={read+write, src/auth/**}
  |     intent="Implement PKCE flow modifications"
  |     Model: Claude Sonnet
  |
  +-- Test Writer Agent
  |     depth=1, max_depth=0, spend_cap=$10, scope={read+write, tests/auth/**}
  |     intent="Write PKCE-specific regression tests"
  |     Input: IssueOnly (never sees implementation)
  |     Model: GPT-5.4
  |
  +-- Reviewer Agent
  |     depth=1, max_depth=0, spend_cap=$8, scope={read-only}
  |     intent="Security-focused independent review of PKCE implementation"
  |     Input: DiffOnly
  |     Model: GPT-5.4
  |
  +-- Verifier Agent
        depth=1, max_depth=0, spend_cap=$5, scope={read-only, security-scan}
        intent="Run security scan on modified auth code"
        Model: Gemini
```

**Execution timeline:**

```
t=0s:    User submits goal. Cortex decomposes into 6 nodes.
t=0.5s:  Cortex presents plan. Requires explicit approval (Critical risk).
t=5s:    User approves.
t=5.1s:  6 delegation keys issued via ClawNet.
t=5.2s:  Research agent starts (Claude Haiku).
t=12s:   Research completes. Plan agent starts (Claude Opus).
t=35s:   Plan completes. Implement + Test agents start in parallel.
t=45s:   Test writer produces 7 PKCE tests (GPT-5.4, IssueOnly).
t=60s:   Implementer produces changes to 5 files (Claude Sonnet).
t=61s:   Both parallel nodes complete. Reviewer starts (GPT-5.4).
t=80s:   Reviewer approves with 1 critical note and 3 suggestions.
t=81s:   Implementer gets refinement sub-task for critical note.
t=95s:   Refinement complete. Verifier starts (Gemini security scan).
t=110s:  Security scan passes. All evidence collected.
t=111s:  Cortex presents final result with evidence summary.

Evidence:
  - TypeScript compiles: PASS
  - 34/34 existing tests: PASS
  - 7/7 new PKCE tests: PASS
  - Security scan: PASS (0 high/critical findings)
  - Independent review (GPT-5.4): APPROVED (1 critical addressed)
  - Confidence: 0.89

Human review required: YES (Critical risk, evidence floor mandates)
```

**Pulse Tree (17 leaves, 1 root):**
- 6 delegation event leaves (type 0x02)
- 6 agent action leaves (type 0x01)
- 4 evidence event leaves (type 0x01)
- 1 behavioral checkpoint (type 0x03)
- Root sum_credits = $28.47
- Root hash: 32 bytes, provable evidence of entire execution

**Total cost:** ~$28.47 across 3 providers
**Total time:** ~2 minutes
**Evidence strength:** High (4 independent verification layers, 3 providers, Critical-risk floor satisfied)

### Scenario 4: No-Test Repo, Dial 3, Quick Feature

```
User: "Add a dark mode toggle to the settings page"
Dial: 3
Subscriptions: 1x Gemini Advanced ($22/month)
Repo: React app, no tests, no CI, has build step
```

**Layer 1:** IntentShape: `SingleTask`. 1 work node: `Implement`.
**Layer 2:** 1 ready node.
**Layer 3:** Risk: `Low`. Evidence floor: compile (optional). Capacity: 1 model.
**Dial 3 envelope:** 2.0 subscription units.

**Layer 4:**
- Template: `SoloCareful` (dial 3, includes lint/typecheck)
- Confidence ceiling: 0.40 (has build but no tests, no CI)
- Autonomy: `ProceedAndFlag` (Low risk, confidence 0.40 > 0.30 suggest threshold)

**Execution:**
- Gemini adds dark mode toggle
- Build passes
- No tests to run

**Evidence:**
- `BuildPass`: +0.50 reward, 0.85 confidence
- No test signals at all

**Final report:** "Build passed. No existing tests were found. Confidence is limited by repo observability (ceiling: 0.40). Consider adding tests to improve routing quality."

**Learning:** Positive update capped at 0.40 by observability ceiling. Cortex cannot claim high confidence in a no-test repo regardless of model output quality. If the user later reports a follow-up fix for a bug introduced by this change, the `FollowupFixSameScope` signal (-0.40) will override the initial positive signal.

### Scenario 5: Failure and Self-Healing

```
User: "Add rate limiting to the API endpoints"
Dial: 6
Provider: Claude Sonnet (primary), GPT-5.4 (backup)
Repo: Python FastAPI, has tests + CI
```

**Initial routing:** Claude Sonnet selected via UCB (strongest prior for Python web tasks).

**Failure sequence:**

```
t=0s:    Claude Sonnet implements rate limiting middleware.
t=15s:   Tests run. 3/12 existing tests fail.
         Evidence: ExistingTestsFail (-1.00 reward, 0.95 confidence)

t=15.1s: Self-healing triggered:
         1. Evidence event appended to ledger.
         2. Claude Sonnet belief for Python/FastAPI/Medium-risk updated negatively.
         3. Confidence drops from 0.72 to 0.58.
         4. Scheduler spawns Verify node: "Diagnose test failures."

t=16s:   Verify node analyzes failures. Root cause: middleware conflicts with existing CORS setup.
         
t=17s:   Scheduler spawns alternate Implement node.
         Route scorer re-evaluates: Claude Sonnet's updated belief is now lower.
         UCB selects GPT-5.4 for retry (higher uncertainty = higher exploration bonus).

t=30s:   GPT-5.4 implements rate limiting with CORS-compatible approach.
         
t=45s:   Tests run. 12/12 existing tests pass.
         Evidence: ExistingTestsPass (+0.80 reward, 0.90 confidence)

t=46s:   Belief updates:
         - Claude Sonnet on Python/FastAPI/Medium: confirmed negative (failure was real)
         - GPT-5.4 on Python/FastAPI/Medium: positive update (handled CORS interaction)
         
t=47s:   Final report: "Initial attempt with Claude Sonnet failed (CORS conflict). 
         Rerouted to GPT-5.4 which succeeded. 12/12 tests pass. 
         Confidence: 0.67. Claude Sonnet belief adjusted for Python middleware tasks."
```

**What the evidence graph captures:**

```
Event 1: CompilePass (Claude Sonnet attempt 1)
  -> CreditAssignment: Claude Sonnet, PrimaryGenerator, causal_weight=0.8
  -> Reward: +0.40

Event 2: ExistingTestsFail (Claude Sonnet attempt 1)
  -> CreditAssignment: Claude Sonnet, PrimaryGenerator, causal_weight=0.9
  -> Reward: -1.00
  -> RevertCause: FunctionalRegression (strong negative for model quality)

Event 3: CompilePass (GPT-5.4 attempt 2)
  -> CreditAssignment: GPT-5.4, PrimaryGenerator, causal_weight=0.8
  -> Reward: +0.40

Event 4: ExistingTestsPass (GPT-5.4 attempt 2)
  -> CreditAssignment: GPT-5.4, PrimaryGenerator, causal_weight=0.8
  -> Reward: +0.80

Net belief change:
  - Claude Sonnet (Python/FastAPI/Medium): mean_reward drops by ~0.6
  - GPT-5.4 (Python/FastAPI/Medium): mean_reward rises by ~0.5
  - Next time: GPT-5.4 will be preferred for similar Python middleware tasks
```

**Key insight:** The system did not just retry. It rerouted to a different model based on evidence, captured why the failure happened, and updated beliefs so that future routing is better. This is the closed-loop learning that distinguishes Cortex from "retry 3 times then fail."

## Appendix F: Economic Projections

### Cost Savings from Intelligent Routing

Based on cascade routing research (>4% absolute improvement, ~80% relative improvement over naive baseline) and ParetoBandit results (mean per-request cost never exceeds budget by >0.4%):

| Team Configuration | Naive Routing (always best model) | Cortex Routing (cascade + evidence) | Monthly Savings |
|-------------------|----------------------------------|-------------------------------------|----------------|
| Solo, $20/mo Claude Pro | $20/mo (single provider, no routing needed) | $16-18/mo (cascade avoids unnecessary Opus calls) | $2-4/mo (10-20%) |
| Solo, $120/mo (Claude + GPT) | $120/mo (manual switching, suboptimal) | $72-96/mo (evidence-based selection + cascade) | $24-48/mo (20-40%) |
| Team of 5, $500/mo pooled | $500/mo (no pooling, individual waste) | $325-400/mo (pooling + routing + cascade) | $100-175/mo (20-35%) |
| Team of 10, $1600/mo pooled | $1600/mo (significant individual waste) | $960-1200/mo (full pooling + evidence routing) | $400-640/mo (25-40%) |

**Where the savings come from:**

1. **Cascade routing (15-25% savings):** Most tasks (70-80%) can be handled by cheaper models. Quality estimators identify which tasks need escalation. Only 20-30% of tasks actually require frontier models.

2. **Subscription pooling (5-15% savings):** Individual subscriptions are partially wasted (unused capacity at night, weekends, low-activity periods). Pooling allows one team member's slack to serve another's peak demand.

3. **Evidence-based model selection (5-10% savings):** The learner identifies which model handles which task shape best. Instead of always defaulting to the most expensive model, Cortex routes to the model with the best evidence-backed success rate for the specific task shape.

4. **Reduced retries and rework (5-10% savings):** Better initial routing means fewer failed attempts, fewer retries, and less rework. The self-healing system catches failures early before they consume significant budget.

### Cortex Insights Revenue Potential

Based on Not Diamond pricing ($0.001/recommendation) and OpenRouter revenue ($50M ARR at 5.5% take-rate):

| Metric | Conservative | Moderate | Optimistic |
|--------|-------------|----------|-----------|
| Active Cortex instances (month 18) | 500 | 2,000 | 10,000 |
| Opt-in telemetry rate | 30% | 50% | 70% |
| Contributing instances | 150 | 1,000 | 7,000 |
| Task shapes with sufficient cohort | 20 | 100 | 500 |
| Premium queries/month (subscriber) | 500 | 1,000 | 5,000 |
| Subscription revenue/month | $5K | $50K | $500K |
| x402 revenue/month | $500 | $10K | $100K |
| **Total data product revenue** | **$5.5K/mo** | **$60K/mo** | **$600K/mo** |

These projections are deliberately conservative on the low end. The routing intelligence market is validated by Martian ($1.3B valuation), Not Diamond (growing), and OpenRouter ($50M ARR). Cortex's differentiation is evidence-based intelligence rather than static benchmarks.

### Subscription Pooling Economics

The subscription pooling feature deserves detailed economic analysis because it is a unique structural advantage:

**Current state (without pooling):**

A 10-person backend team has:
- 3 developers with Claude Max ($100/month each = $300)
- 4 developers with GPT Pro ($200/month each = $800)
- 2 developers with Gemini Advanced ($22/month each = $44)
- 1 developer with Cursor Pro ($20/month = $20)
- **Total team spend: $1,164/month**

Utilization pattern (typical):
- Each developer uses their subscription ~40% of working hours
- Evening/weekend hours: 0% utilization
- Provider-specific tasks: developer with GPT subscription needs Claude for a task, switches manually or does not switch
- Overlap: 2 developers need frontier model simultaneously during code review

**Waste analysis:**
- 60% idle time on individual subscriptions = ~$698/month wasted capacity
- Provider mismatch (wrong model for task): estimated 15% quality loss, 10% cost increase
- No cross-provider resilience: when Claude is down, 3 developers are blocked

**With Cortex pooling:**

Same team registers all subscriptions in Cortex:
- Total pool: $1,164/month in subscription capacity
- Fair-share: each member gets 10% guaranteed, with burst allowance
- Priority: evidence floor requirements get capacity before exploration
- Routing: Cortex selects best model for each task shape regardless of which individual holds the subscription

**Benefits:**
- Idle capacity is redistributed: developer A's unused Claude capacity serves developer B's task
- Provider mismatch eliminated: Cortex routes to the best model, not the subscription the developer happens to own
- Cross-provider resilience: Claude outage -> automatic GPT fallback for all team members
- Fair-share prevents abuse: no single developer can consume all pooled capacity
- Priority ensures safety: security review gets Claude Opus even if the pool is busy

**Estimated savings:** $300-450/month (25-40% of team spend) from:
- Eliminated idle time waste: $200-300/month
- Better model selection: $50-100/month (fewer retries, fewer wrong-model tasks)
- Reduced provider switching friction: $50-100/month (developer time saved)

**Why competitors cannot replicate:** Subscription pooling requires:
1. Multi-provider auth integration (OAuth flows for Claude, GPT, Gemini, etc.)
2. Fair-share allocation algorithm with priority classes
3. Real-time capacity tracking across all providers
4. Evidence-based routing to justify which model gets which task

Cursor is single-provider (cannot pool). Copilot is Microsoft-only (cannot pool). Claude Code is Anthropic-only (cannot pool). The structural advantage is that Cortex has no provider allegiance.

## Appendix G: Frequently Asked Questions

**Q: How does Cortex handle privacy when routing code to multiple providers?**

A: Three mechanisms work together:
1. **Provider Privacy Policy** -- each subscription has explicit rules: `allow_raw_code`, `allow_secret_redacted_code`, `allow_training_by_provider`, `data_retention` class, and `allowed_regions`. Cortex never sends code to a provider that violates these rules.
2. **Per-Stage Input Policy** -- different stages of a route template get different context levels. A reviewer using `DiffOnly` policy sees the diff but not the full codebase. A test writer using `IssueOnly` sees the bug description but not the implementation.
3. **Secret Redaction** -- configurable patterns for API keys, passwords, and credentials. Redacted before any provider call.

Workers execute in user containers. Raw code never leaves the user's machine. Only the prompts and context sent to providers leave the local environment, and these are filtered by the privacy policy.

**Q: What happens if all my providers are down simultaneously?**

A: Cortex degrades gracefully:
1. Circuit breakers on all providers transition to `Open`.
2. Scheduler marks all work nodes as `Blocked` with `CapacityUnavailable`.
3. Cortex notifies the user: "All providers are currently unavailable. Work queued."
4. Half-open testing begins after 60 seconds on each provider.
5. As providers recover, work resumes with the first available provider.
6. The belief system does NOT penalize models for downtime (non-selection reason tracking).

**Q: Can I use Cortex with only one provider?**

A: Yes. Single-provider Cortex still provides:
- Evidence-based model selection within that provider's model family (e.g., Haiku/Sonnet/Opus)
- Cascade routing (try cheap first, escalate if quality estimator says so)
- Evidence collection and contamination tracking
- Risk classification and evidence floors
- Confidence-based autonomy

The full value requires 2+ providers (cross-provider routing, independent verification, resilience), but single-provider usage is a valid starting point.

**Q: How does Cortex learn without sending my code to HeyVera?**

A: Cortex learns entirely locally by default. The evidence graph and belief store are local SQLite databases. Learning happens from objective signals (compile results, test outcomes, CI status) observed on your machine.

Opt-in telemetry (for Cortex Insights) shares only:
- Task shape classification (e.g., "Python Django BugFix Medium risk")
- Model selected and outcome (e.g., "Claude Sonnet, tests passed")
- Aggregated statistics (success rate, median cost, median latency)

It never shares: source code, prompts, file paths, repo names, exact patches, stack traces, secrets, or any content that could identify your project.

**Q: What if the routing learner makes a bad decision?**

A: The system is designed for this:
1. The learner can never violate evidence floors (invariant constraint).
2. Bad decisions create evidence (test failures, compile errors) that update beliefs.
3. Self-healing spawns recovery nodes and reroutes to alternate models.
4. The autonomy gate asks for confirmation on high-risk or low-confidence decisions.
5. Worst case: a bad route wastes one API call. The evidence from that failure improves future routing.

The system cannot make a catastrophically bad decision because the policy gate filters candidates before the learner sees them. Auth code always gets full verification regardless of what the learner thinks.

**Q: How does Cortex compare to just using "auto mode" in Cursor?**

A: Cursor's auto mode selects a "cost-efficient model" based on Cursor's internal heuristics. It does not:
- Learn from your specific outcomes
- Track contamination on evidence signals
- Enforce risk-based evidence floors
- Route across providers (Cursor is primarily one provider)
- Pool subscriptions across team members
- Provide cryptographic proof of agent execution
- Support scoped multi-agent delegation

Cortex's routing improves with every task you run. Cursor's routing is static (updated only when Cursor pushes a new version). Over months of use, the gap between Cortex's evidence-based routing and Cursor's static routing grows wider.

---

*This document represents the definitive synthesis of all dual-brain debate rounds, research surveys, and production infrastructure audit conducted on May 19, 2026. It is intended to be the canonical reference for Cortex architecture decisions going forward. All prior vision documents are superseded by this one.*

*Authored by dual-brain consensus: GPT-5.5 provided the aspirational vision and detailed type designs; Opus 4.7 provided the grounded reality checks, scope discipline, and competitive analysis; the synthesis was performed by Opus 4.6 with access to all source materials and production infrastructure documentation.*

## Appendix H: Conflict Resolution Scorecard (from Routing Consensus)

The routing intelligence consensus was built from 45 specific design conflicts between GPT-5.5 and Opus 4.7. The resolution pattern reveals how the two perspectives complemented each other:

| Category | Opus Wins | GPT Wins | Merged | Aligned | New (Both) |
|----------|-----------|----------|--------|---------|------------|
| Signal taxonomy | 0 | 3 | 1 | 0 | 0 |
| Evidence graph | 0 | 4 | 1 | 0 | 0 |
| Route templates | 1 | 3 | 0 | 0 | 0 |
| Scoring algorithms | 0 | 4 | 1 | 0 | 0 |
| Risk classification | 0 | 1 | 1 | 0 | 0 |
| Dial mapping | 0 | 2 | 1 | 0 | 0 |
| Capacity / subscriptions | 0 | 4 | 0 | 0 | 0 |
| Cold start / exploration | 0 | 2 | 1 | 0 | 0 |
| Policy / invariants | 2 | 0 | 0 | 2 | 0 |
| Feedback loops | 0 | 1 | 0 | 0 | 0 |
| New architecture concepts | 0 | 0 | 0 | 0 | 5 |
| **Total** | **3** | **27** | **8** | **2** | **5** |

GPT-5.5 produced substantially more thorough and better-reasoned designs across most categories. Opus's key contributions were in safety-critical areas: template count (10+ vs 4, because real scenarios need more diversity), circuit breaker thresholds as configured policy (not learned, to avoid meta-learning problems), causal weight cap at 1.0 (prevents double-penalization), and the confidence ceiling model for v1 (prevents overclaiming in low-observability repos).

The five new concepts that neither initially proposed but emerged from the debate:
1. **IntentGraph** with typed decomposition, iteration specs, and dependency edges
2. **IntentScheduler** with scoped blocking and route-around
3. **AutonomyPolicy** as invariant thresholds per risk class
4. **Confidence-based autonomy** as an emergent property of route quality
5. **Route-around-blocks** for scheduler throughput

This pattern -- one provider excels at depth and detail, the other at safety and constraints -- validates the dual-brain methodology itself. Neither perspective alone would have produced this architecture.

## Appendix I: What This Document Does NOT Cover

For scope clarity, the following topics are deliberately excluded from this vision document:

1. **Detailed Rust type definitions.** The full 1686-line type system is in `.dualbrain/routing-intelligence-consensus.md`. This document summarizes the types but does not reproduce them.

2. **Team architecture (concurrent goal arbitration).** How multiple developers work simultaneously on the same repo is covered in `.dualbrain/team-architecture-consensus.md`. This includes lease models, conflict detection, supersession, and goal status state machines.

3. **Token economics ($CLAWNET).** Token architecture, burn mechanics, staking, and token-gated features are separate from the Cortex routing architecture. These are covered in internal token architecture documents.

4. **Social limb architecture.** Community features, reputation systems, and human context integration are part of the broader HeyVera platform but not part of Cortex.

5. **On-chain verification details.** Specific EVM/Solana smart contract designs for Groth16 verification are Soma implementation details, not Cortex architecture.

6. **Detailed privacy engineering.** The specific differential privacy mechanisms, epsilon values, and aggregation algorithms for Cortex Insights require a dedicated privacy engineering document.

7. **Regulatory compliance playbook.** SOC 2 preparation, GDPR data processing agreements, and financial compliance for x402 payments require dedicated legal and compliance analysis.

8. **Hiring plan and organizational structure.** The team size estimates are in this document, but the specific roles, reporting structure, and hiring sequence are operational decisions not architectural ones.
