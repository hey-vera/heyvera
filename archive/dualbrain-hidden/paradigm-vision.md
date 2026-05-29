# Cortex Paradigm Vision — Beyond the Engine

> From car engine to rocket ship to UFO.
> Synthesized from: deep codebase analysis, 3 paradigm audits, architecture review, vision alignment.

---

## I. THE THESIS

Cortex today is a well-built engine. It routes tasks, manages leases, retries failures, tracks costs. But it's reactive — it waits for instructions, executes them, reports results. The paradigm shift is making Cortex **proactive, self-improving, and collaborative**. Not just an orchestrator, but an intelligence that learns from every execution, predicts what's needed, and coordinates agents that talk to each other — not just to the Brain.

The metaphor: Cortex is named after the cerebral cortex. Right now it's a reflex arc — stimulus in, response out. The vision is a full cortex: memory, attention, prediction, learning, and consciousness of its own performance.

---

## II. THE FIVE PARADIGM SHIFTS

### Paradigm 1: The Learning Brain (Self-Improving Evaluator)

**Current state:** The evaluator (`crates/core/src/evaluator.rs`) is a pure function with hardcoded weights. `BALANCED_WEIGHTS`, `COST_SAVER_WEIGHTS`, etc. are compile-time constants. The `AutoMode` state machine transitions on crude thresholds ("is pressure above 0.82?"). The `reliability_bonus` function uses a flat success rate with a 20-sample minimum. It's a calculator, not a brain.

**The shift:** Every routing decision becomes a learning opportunity.

**Concrete changes:**

1. **Bayesian Provider Profiles.** Replace static success rates with per-user, per-provider, per-task-type posterior distributions. The system already records decisions in the `decisions` table and outcomes in the `outcomes` table (db.rs lines 169-205) — but this data is **never fed back into scoring**. A Thompson sampling approach would let the system explore less-used providers while exploiting known-good ones.

   Example: "Claude succeeded on 94% of Execute tasks touching auth/ files in 48 hours, but failed 3/4 Heal tasks → increase Execute score, decrease Heal score for Claude on auth/ paths."

2. **Contextual Bandits for Weight Selection.** Instead of 4 hardcoded weight profiles, learn the optimal weight vector per context. Context is already available: intent type, risk level, time of day, recent failure rate, provider pressure. A lightweight linear bandit (no GPU) adjusts weights in real-time. The `weights_for` function (line 180) is a 4-way switch; it becomes a dot product of a learned feature vector.

3. **Predictive Failure from History.** `classify_file_risk` (line 599) uses substring matching — "auth/" means critical. But we have actual historical outcome data per file path. A step touching `src/billing/stripe.rs` that failed 3 times this week should auto-escalate, independent of the filename heuristic. The `classify_risk` function (line 645) takes `history_success_rate` but it's **always `None`** — the data exists in DB but is never queried. This is a missed connection.

4. **Decision Replay and A/B Testing.** Event-source all routing decisions. Periodically replay historical decisions with new weights to measure counterfactual performance. "If we had used the learned weights last week, 12% fewer failures would have occurred." This validates the learning system without risking production traffic.

**Why this is the keystone:** Zero schema changes. One SQL query replacement. Enables the chain: Quality Profiles → Adaptive Routing → Smart Defaults → Predictive Scaling. Everything else gets better when routing gets smarter.

**Effort:** ~1 week for core, ~2 weeks for full feedback loop.

---

### Paradigm 2: Self-Modifying Execution Graphs

**Current state:** The DAG is created once at goal decomposition time (`crates/engine/src/decomposer.rs`) and executed rigidly. The only modification is heal chain insertion (`captain.rs:plan_heal`, line 431). The decomposer splits on text markers ("and then" / "also") and infers dependencies from intent type. No feedback from execution results into the plan.

**The shift:** DAGs that evolve during execution based on what agents discover.

**Concrete changes:**

1. **Reflection Steps.** When a Search step completes, its output should be able to modify downstream steps or spawn new ones. Example: "explore auth bugs" → Search finds 3 distinct issues → system forks the DAG into 3 parallel Execute steps, each with a tailored objective. The protocol already has `StepOutput.structured` (protocol.rs line 128) as a `serde_json::Value` — but it's **always `Null`** (executor.rs line 326). This field is the hook for step-to-step semantic communication.

2. **Worker-Proposed Steps.** Workers currently only report StepCompleted or StepFailed. But what if a worker, mid-execution, could propose: "I found that fixing module A requires updating the dependency in module B first"? A new `WorkerMessage::ProposedStep` variant → Brain validates → inserts into DAG with proper edges → dispatches. This turns rigid plan-then-execute into collaborative planning where the AI agents contribute to the plan.

3. **Speculative Execution.** The scheduler waits for all `SuccessRequired` dependencies before dispatching (db.rs `find_ready_steps`). But many Search steps are exploratory — their results inform but don't block. Speculatively dispatch downstream Execute steps before Search completes, cancel or adjust if Search results change the plan. `CancelStep` message already exists; it just needs a trigger.

4. **DAG Templates from History.** Over time, the system sees that "fix bug in X" always decomposes into Search → Execute → Test. Successful decomposition patterns become templates. New goals get matched against templates before falling back to the general decomposer. The templates are learned, not hardcoded.

**Why this is transformative:** Current Cortex plans like a human with a checklist. This makes it plan like a human with a whiteboard — adjusting the plan as new information arrives.

**Effort:** ~2-3 weeks. Core changes in protocol.rs, captain.rs, decomposer.rs.

---

### Paradigm 3: Shared Working Memory (Agent Collaboration)

**Current state:** Steps are isolated. Each gets a `StepContext` (protocol.rs lines 144-157) — a one-shot payload with predecessor summaries. No real-time information sharing between concurrent steps. If Step A and Step B run in parallel and Step A discovers something relevant to Step B, there's no channel for that.

**The shift:** Agents that coordinate through shared state, like neurons firing in a cortex.

**Concrete changes:**

1. **Per-Run Working Memory (KV Store).** A shared key-value store scoped to each run. Steps can `ReadMemory(key)` and `WriteMemory(key, value)`. Three new `BrainMessage` variants, one new DB table (`run_memory: run_id, key, value, written_by_step, timestamp`). Foundation for everything below.

2. **Bulletin Board Pattern.** Instead of explicit step-to-step dependencies, agents publish discoveries to a shared board. An Execute step publishes "file_structure: {auth uses middleware pattern}" → a concurrent Test step reads this and adjusts its strategy. No explicit wiring needed. This is stigmergy — indirect coordination, like ants leaving pheromone trails.

3. **Bidirectional Context Streaming.** A new `BrainMessage::ContextUpdate` pushes incremental context to running steps. If Step A discovers something relevant to Step B mid-flight, the Brain can push that context to Step B's worker without restarting it. This requires the executor to support mid-execution context injection — the Claude CLI already handles conversation continuation.

4. **Conflict Detection via Intent Locks.** When two Execute steps touch overlapping files in parallel worktrees, merge conflicts are likely. Workers exchange "lock intents" — "I am about to modify src/auth/middleware.rs" — and the Brain sequences or delays conflicting steps. Advisory, not blocking. Like database advisory locks.

**Why this is the differentiator:** No other coding agent orchestrator has agents that coordinate in real-time through shared memory. They all use isolated, sequential execution. This is what makes multi-step runs feel intelligent instead of mechanical.

**Effort:** ~2 weeks. Clean addition, doesn't touch existing step execution.

---

### Paradigm 4: Fleet Intelligence (Worker Ecosystem)

**Current state:** Workers are passive recipients. `find_worker_for_user` (scheduler.rs) picks any available worker. Workers report only StepCompleted/StepFailed. The Brain has no model of worker capabilities, load, or specialization.

**The shift:** Workers become an intelligent fleet — bidding on work, advertising capabilities, migrating tasks, and reporting rich telemetry.

**Concrete changes:**

1. **Capability Advertising and Bid-Based Dispatch.** Instead of push dispatch, the Brain broadcasts step availability. Workers bid based on position: a worker that has the repo cached, a warm Claude session with relevant context, or lower latency to git remotes bids higher. The `RepoInfo` sent at registration (protocol.rs lines 109-114) — path, remote_url, branch, head_commit — becomes a live capability signal rather than dead metadata.

2. **Worker Fleet Topology.** If a user has 3 workers (desktop with GPU, cloud VM, laptop on battery), the Brain should know their capabilities. Workers periodically report system metrics (CPU load, disk I/O, network latency). The `Heartbeat` message (protocol.rs line 96) already reports `active_steps`; extend it with system load. "Any worker" dispatch becomes "best worker" dispatch.

3. **Checkpoint-Based Task Migration.** When a worker disconnects mid-step (current: 60s grace period, then orphan and restart from scratch), checkpointed state lets another worker resume. The executor already captures `collected_output` (executor.rs line 178) and `files_changed` (executor.rs line 152) — checkpoint these to the Brain periodically. 8 minutes into a 10-minute task shouldn't mean 8 minutes lost.

4. **Direct API Integration (Long-term).** Move from CLI wrapping to direct Anthropic/OpenAI SDK calls. Enables: (a) shared prompt caches across steps — massive cost savings for steps touching the same codebase; (b) structured tool validation — executor blocks unauthorized tool calls instead of trusting CLI; (c) conversation threading — Heal steps continue the failed step's conversation instead of starting fresh; (d) sub-second cost tracking instead of waiting for completion.

**Why this matters:** Workers are currently interchangeable commodities. This makes them specialized, self-aware agents in a fleet — the difference between a taxi dispatch and an autonomous ride-share network.

**Effort:** Bid-based dispatch ~1 week, fleet topology ~1 week, checkpointing ~2 weeks, direct API ~4 weeks.

---

### Paradigm 5: The Autonomous Cortex (Watch, Learn, Act)

**Current state:** Cortex waits for user input. No proactive behavior. No learning across runs. No project intelligence.

**The shift:** Cortex becomes an autonomous intelligence that watches projects, learns patterns, predicts needs, and acts without being asked.

**Concrete changes:**

1. **Watch & Respond (GitHub Webhooks).** GitHub events trigger runs automatically. PR opened → review run. Issue labeled `cortex` → investigation run. Push to main → regression check. The scheduler already handles goals → steps → dispatch; webhooks just provide a new goal source. This is the "wow" moment — users stop manually creating runs.

2. **Project Intelligence.** Per-repo context model built from git history, file patterns, test coverage, and past run outcomes. "This repo has 3 hot spots that cause 80% of failures." "Tests in this repo take 4 minutes on average." "The auth module was last modified 2 days ago and has a 60% success rate for automated fixes." This context feeds into the evaluator's scoring.

3. **Dream State (Offline Consolidation).** When idle, Cortex analyzes past runs: which decomposition strategies produced successful runs, which routing decisions led to best outcomes, which file paths are associated with failures. Updates learned parameters. Pre-computes likely workflows for known projects. Like the brain consolidating memories during sleep.

4. **Predictive Pre-computation.** Based on project patterns and git activity, predict what the user will ask next. User pushes code → Cortex pre-runs tests in the background. PR has merge conflicts → Cortex pre-analyzes resolution options. The user arrives to find the work already done.

5. **Interactive Mission Control.** Mission Control (mission_control.rs) is currently read-only events. Make it bidirectional: pause a run, reprioritize steps, approve/reject proposals, override routing decisions. `TaskStatus` already has `AwaitingApproval`, `Approved`, `Rejected` (task.rs lines 47-49) — they're never used. For critical-risk steps, present the routing decision and wait for human approval. This is the "human-in-the-loop" that the HEAD Constitution demands but has no mechanism to enforce.

**Why this is the endgame:** This is where Cortex stops being a tool and becomes a teammate. It watches your project, learns your patterns, and acts on your behalf — with guardrails.

**Effort:** Watch & Respond ~2-3 weeks, Project Intelligence ~2-3 weeks, Dream State ~1 week (builds on Learning Brain), Predictive ~2 weeks, Interactive MC ~1 week.

---

## III. THE NEUROSCIENCE ARCHITECTURE

Cortex is named after the brain. Make the metaphor real.

### Memory System (4 Tiers)

| Tier | Brain Analog | Cortex Implementation | Lifetime |
|------|-------------|----------------------|----------|
| **Working Memory** | Prefrontal cortex | Per-run KV store (Shared Working Memory) | Single run |
| **Episodic Memory** | Hippocampus | Run outcomes, step results, failure patterns | 30 days rolling |
| **Semantic Memory** | Temporal lobe | Learned provider profiles, project patterns, decomposition templates | Permanent, updated |
| **Procedural Memory** | Cerebellum | Learned routing weights, scoring parameters | Permanent, trained |

### Attention System

- **Selective Attention:** Focus resources on the highest-risk, highest-impact steps. Don't give equal weight to a docs update and an auth migration.
- **Divided Attention:** Monitor multiple concurrent runs, but with different attention levels based on risk.
- **Sustained Attention:** Long-running tasks get periodic health checks, not just a timeout.

### Prediction Engine (Active Inference)

The brain doesn't just react — it predicts and acts to minimize prediction error. Cortex should:
- Predict step duration from historical data → flag steps running 2x longer than expected
- Predict failure probability from file paths + provider + time of day → pre-allocate heal capacity
- Predict user intent from project context → suggest runs before being asked

### Plasticity

The system rewires itself based on experience:
- Routing weights adapt like synaptic weights (Paradigm 1)
- DAG templates evolve from successful patterns (Paradigm 2)
- Worker selection improves from bid outcomes (Paradigm 4)
- Risk classification updates from actual failure rates (Paradigm 1)

---

## IV. THE ARCHITECTURE AT SCALE

### From SQLite to Event-Sourced State

**Current:** Single SQLite file behind a `Mutex<Connection>`. Every operation acquires the global lock. Fine for single-user.

**Scale architecture:**
1. **Event sourcing.** Instead of `UPDATE steps SET status = 'succeeded'`, store: `StepCompleted { step_id, worker_id, timestamp, output }`. Current state derived by replaying events. Perfect auditability, time-travel debugging, natural feedback loops.
2. **Per-user SQLite sharding.** Each user gets their own WAL-mode SQLite file. Eliminates cross-user lock contention. Admin queries aggregate across files (infrequent). Per-user operations become lock-free relative to other users.
3. **Materialized pressure views.** `pressure_for_user` (db.rs line 984) currently scans ALL usage events with exponential decay. At scale: maintain a running weighted sum updated on each `record_usage` call. O(1) instead of O(n).

### Protocol Evolution

**Current:** Strictly hierarchical — Brain sends ExecuteStep, Worker reports results.

**Future protocol layers:**
1. **Negotiation layer:** Workers bid on steps, Brain selects best bidder
2. **Coordination layer:** Workers exchange lock intents, share discoveries
3. **Proposal layer:** Workers suggest new steps, Brain validates and inserts
4. **Telemetry layer:** Workers stream system metrics, context cache status

### The Missing Meta-Loop

The deepest paradigm shift isn't in any one subsystem — it's **closing the loop between execution and planning**.

Currently, Cortex is a pipeline: Goal → Decomposer → DAG → Scheduler → Workers → Results. Each stage runs once (except heal retries). The system does not learn from the pipeline's own execution.

The data already exists: `decisions`, `outcomes`, `score_evidence`, `usage_events`, `step_attempts`. Nobody reads it back. `provider_reliability` (db.rs line 1030) aggregates outcomes but only for provider-level success rates. No one queries "what is the success rate of Heal steps that follow Test failures in auth/ files?"

**Agent consciousness** means: the Cortex Brain maintains a model of its own effectiveness, updates it after every run, and adjusts behavior accordingly. The evaluator's weights become learned. The decomposer's splitting heuristics become learned. The scheduler's concurrency limits become learned. The system evolves from a tool into an organism.

---

## V. BUILD SEQUENCE

### Phase 0: Foundation (Week 1-2)
- [ ] Provider Quality Profiles — feed outcomes back into evaluator scoring
- [ ] Wire `history_success_rate` into `classify_risk` (currently always `None`)
- [ ] Add `StepOutput.structured` population in executor

### Phase 1: Memory & Collaboration (Week 2-4)
- [ ] Per-run working memory (KV store, 3 new BrainMessage variants)
- [ ] Bulletin board read/write in executor
- [ ] Bidirectional context streaming (ContextUpdate message)

### Phase 2: Self-Modifying DAGs (Week 4-6)
- [ ] Reflection steps (Search output forks downstream)
- [ ] Worker step proposals (ProposedStep message)
- [ ] DAG template learning from successful decompositions

### Phase 3: Fleet Intelligence (Week 6-8)
- [ ] Extended Heartbeat with system metrics
- [ ] Bid-based dispatch
- [ ] Checkpoint-based task migration

### Phase 4: Autonomous Operations (Week 8-12)
- [ ] GitHub webhook integration (Watch & Respond)
- [ ] Project Intelligence (per-repo context model)
- [ ] Interactive Mission Control (bidirectional)
- [ ] Dream State (offline consolidation)

### Phase 5: Full Cortex (Week 12+)
- [ ] Predictive pre-computation
- [ ] Contextual bandit weight learning
- [ ] Event-sourced state store
- [ ] Direct API integration (replacing CLI wrapping)

---

## VI. THE COMPETITIVE MOAT

What makes this defensible:

1. **Multi-provider orchestration.** Everyone else is single-provider. Cortex is the brain that makes multiple providers work together.
2. **Learning from execution.** Static routing is a commodity. Learning routing is a moat that deepens with every run.
3. **Agent collaboration.** Isolated agents are table stakes. Coordinating agents through shared memory is a fundamental capability gap.
4. **User-owned execution.** No API keys, subscription-only auth. Users keep their environments, Cortex adds intelligence. No vendor lock-in to a compute platform.
5. **The HeyVera flywheel.** Every Cortex run feeds Soma (reputation) and VeraAI (intelligence). The platform gets smarter as it's used.

---

## VII. THE "UFO" IDEAS

These are the shots that, if they land, put Cortex in a category of its own:

1. **Self-writing orchestrator.** Cortex uses itself to improve itself. The Dream State identifies routing inefficiencies → creates a goal → decomposes into steps → agents modify the evaluator code → tests verify → auto-deployed. Recursive self-improvement, bounded by the test suite.

2. **Agent marketplace with x402 settlement.** Third-party agents register capabilities. Users post goals. Agents bid. x402 micropayments settle per-step. Cortex becomes the exchange, not just the orchestrator.

3. **Collective intelligence emergence.** 1000 Cortex instances across 1000 users, each learning independently. Federated learning aggregates insights without sharing code: "Claude is 40% better at auth tasks between 2-6 PM UTC" — statistical patterns, not user data. The fleet gets smarter than any individual instance.

4. **Conversational DAGs.** Instead of decomposing upfront, the system has a conversation with the user. "I see 3 issues in the auth module. Want me to fix all 3, or focus on the critical one?" Each response modifies the DAG in real-time. The plan is a dialogue, not a monologue.

5. **Predictive developer experience.** Cortex notices you pushed to a feature branch. It pre-runs tests, pre-generates a review, pre-drafts the PR description, pre-identifies conflicts with other branches. When you open the PR page, everything is already there. Zero wait time for common workflows.
