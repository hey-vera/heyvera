# Starfleet Architecture: Cortex as a Living Orchestration Intelligence
Cortex should not aspire to be “an AI orchestrator.”
That category is already too small.
A normal orchestrator receives tasks, assigns workers, tracks state, and reports completion. A good orchestrator optimizes cost, retries failures, and surfaces useful logs. A frontier orchestrator learns routing, rewrites plans, coordinates agents, and improves over time.
But the Level 7 version of Cortex is something stranger and more valuable:
**Cortex becomes an adaptive execution organism for software work.**
It is not merely a brain dispatching limbs. It is a system that develops instincts, memory, reflexes, senses, immune responses, and economic relationships. It does not just run agents. It metabolizes intent into verified change.
At Level 7, the user does not experience “I submitted a task and watched AI agents work.” The user experiences:
> “The system understood the direction of the company, noticed what mattered, assembled the right minds, pursued the work safely, asked only when judgment was truly needed, and delivered the outcome with evidence.”
The diesel truck moves cargo.
The nuclear submarine survives pressure.
The starship crosses impossible distance.
The Starfleet system coordinates exploration, defense, science, diplomacy, logistics, learning, and purpose across a civilization.
That is the correct ambition for Cortex.
---
## 1. The Evaluator / Routing Brain
### Level 1: Static Weighted Router
Today, the evaluator is a deterministic scoring function. It considers intent, risk, budget, and provider fit through weighted scoring. Providers are treated mostly as interchangeable execution options with static or shallow metadata.
The existing architecture already has the shape of intelligence, but much of the intelligence is latent. The research finding that `history_success_rate` is always `None` is important: the system has the field where memory should enter, but the bloodstream is not connected. Likewise, cost projection and model-aware pricing exist, but they are not yet part of a full adaptive decision economy.
At Level 1, routing asks:
- Which provider seems good for this task?
- Which model is affordable?
- Which worker is available?
- Which static score is highest?
This is useful, but brittle. It is a dispatcher, not a strategist.
### Level 3: Learning Router
At Level 3, routing becomes empirically grounded.
The evaluator maintains Bayesian profiles per provider, model, worker, repo, task type, risk class, file path, language, and dependency surface. It no longer asks “is Claude generally good?” It asks:
- How often has this provider succeeded on Rust API refactors touching auth and billing?
- How often has this worker produced patches that survived review?
- How often do tasks involving `src/db/index.ts` fail when attempted without first reading migration history?
- How does provider performance change under time pressure or budget caps?
- Which model is strong at decomposition but weak at final patching?
- Which worker is reliable for tests but poor at architectural synthesis?
The evaluator stops using global success rate and moves toward contextual success likelihood. It uses Thompson sampling or another contextual bandit to explore without recklessness. It captures decisions in a replayable format, allowing “what would have happened if we routed this differently?” analysis.
At Level 3, routing is not static scoring. It is measured adaptation.
### Level 5: Market-Based Cognitive Router
At Level 5, routing becomes a real-time market.
Workers advertise capability manifests:
```json
{
  "worker_id": "rust-senior-01",
  "capabilities": ["rust", "sqlite", "hono", "security-review"],
  "repo_affinity": ["cortex", "claw-net"],
  "execution_modes": ["deterministic", "model", "agent"],
  "checkpoint_support": true,
  "current_load": 0.62,
  "confidence_calibration": 0.84
}
```
The Brain issues task requests. Workers bid with:
- expected success probability
- expected cost
- expected latency
- risk class acceptance
- required context
- confidence interval
- rollback plan
- evidence they expect to produce
Routing becomes bid selection under policy constraints. A high-risk auth migration might require not the cheapest worker, but the best quorum: implementer, reviewer, test runner, and policy verifier. A low-risk docs update might go to a cheaper model with lightweight review.
The evaluator also routes by execution mode:
- deterministic node for known transformations
- model node for constrained generation
- agent node for open-ended work
- human approval node for judgment boundaries
At Level 5, Cortex does not pick “the best AI.” It composes an execution cell.
### Level 7: Intent-Predictive Strategic Routing
At Level 7, routing feels like mind reading.
The evaluator no longer waits for a fully specified task. It infers the shape of the user’s actual objective from:
- repo history
- active proposals
- recent incidents
- PR review comments
- backlog state
- deploy posture
- user preference memory
- organizational priorities
- risk appetite
- open architectural tensions
- latent blockers
When the user says:
> “Make billing production-ready.”
Cortex does not route one task. It recognizes a strategic bundle:
- billing correctness
- credit math precision
- Stripe/webhook idempotency
- USDC settlement edge cases
- audit trails
- rollback behavior
- operational visibility
- test coverage
- docs
- deploy implications
- user approval points
It automatically routes the right parts to the right execution cells, with risk-sensitive review depth. It knows which tasks should run in parallel, which must wait, which need human approval, and which should be preflighted by a deterministic analysis pass before any model touches code.
The Level 7 evaluator has **routing taste**. It develops a sense of what kinds of work deserve caution, speed, redundancy, exploration, or refusal.
#### Level 7 User Experience
The user does not feel like they are choosing models or managing agents.
They feel like they are speaking to an experienced chief of staff who instantly understands the hidden shape of the work. The system says:
> “This is not one task. It is a six-part production-readiness slice. I can safely execute four parts now, prepare one proposal for the risk boundary, and hold the payment-settlement change for approval because it changes trust assumptions.”
That is the magic moment: Cortex routes not by prompt, but by consequence.
#### Alien Dust
The non-obvious leap from Level 5 to Level 7 is **counterfactual routing memory tied to organizational intent**.
Most systems learn “worker X succeeded on task Y.” Cortex should learn:
- which routing choices preserved architectural direction
- which choices created downstream review burden
- which choices reduced future optionality
- which decisions aligned with known strategic goals
- which paths looked efficient but caused later drag
The evaluator should train not only on success/failure, but on **regret**.
Regret is the alien dust.
A patch can pass tests and still be strategically bad. A slower route can be correct because it preserves trust, reduces rollback risk, or produces a reusable primitive. Level 7 routing optimizes for long-term organizational regret, not immediate task completion.
---
## 2. The DAG / Execution Planner
### Level 1: Static DAG
Today, Cortex decomposes goals into steps with dependencies. The DAG scheduler assigns leases, retries failures, heals, and cascades. This is already a meaningful execution foundation.
But the DAG is created once and then mostly treated as fixed. The system can recover execution, but it cannot deeply rethink the plan while reality changes.
At Level 1, the planner asks:
- What are the steps?
- What depends on what?
- Which step is ready?
- Did it finish or fail?
This works for known work. It struggles with discovery-heavy work.
### Level 3: Reflective DAG
At Level 3, the DAG becomes adaptive.
Cortex adds reflection steps after important discovery nodes. A search step can fork downstream tasks. A failing implementation can trigger a diagnostic branch. A security-sensitive change can insert a mandatory review and threat-model update.
The DAG becomes partially self-modifying under constraints:
- workers may propose new steps
- evaluators may insert verification nodes
- policy may require approval gates
- failed steps may generate alternate plans
- completed steps may invalidate pending steps
A Rust refactor might begin as:
1. inspect API routes
2. update shared types
3. update worker protocol
4. run tests
But after inspection, Cortex realizes the protocol change affects storage replay. It inserts:
- migration compatibility analysis
- event schema versioning
- replay test generation
- backward compatibility gate
At Level 3, the DAG no longer pretends the first plan was complete.
### Level 5: Speculative, Reactive Execution Graph
At Level 5, the DAG becomes a reactive dataflow graph.
Nodes declare inputs, outputs, invalidation conditions, evidence requirements, and risk boundaries. When an upstream fact changes, Cortex invalidates only affected downstream work. It can speculatively execute likely branches before dependencies are fully complete, but mark them as provisional.
Example:
- A repo inspection node predicts that a type migration will touch `cortex-core`, `cortex-api`, and `cortex-worker`.
- Cortex dispatches speculative workers to inspect each crate.
- If the core type shape changes, dependent patches are either rebased, discarded, or transformed.
- The graph stores why a branch was taken and what evidence supported it.
This is where AlphaEvolve-style objective functions enter. The planner can generate multiple candidate plans, score them by safety, cost, coverage, and expected review burden, then execute the best candidate or run competing branches.
At Level 5, the DAG is not a list. It is an evolving proof structure.
### Level 7: Self-Completing Intention Field
At Level 7, the planner feels like work completes before the user has fully articulated it.
The planner does not merely decompose tasks. It maintains a living model of the project’s unresolved tensions and likely next moves. It knows:
- which proposals imply future implementation slices
- which TODOs are actually architectural liabilities
- which test gaps are blocking trust
- which docs are stale relative to code
- which production risks are growing
- which upstream dependencies are unresolved
- which “done” work is only partial foundation
When the user opens Cortex, the planner already has candidate execution fields prepared:
- “credential rotation integration is blocked on Soma spec”
- “billing correctness can advance safely through test hardening”
- “Mission Control has approval states unused; interactive approval is a high-leverage slice”
- “worker capability awareness is the next prerequisite for market routing”
The user can approve a direction, and Cortex unfolds the plan into a governed execution graph.
#### Level 7 User Experience
The user does not create tasks from scratch.
They see the system present a small number of high-leverage moves, each with rationale, risk, expected evidence, and blocked dependencies. It feels like the system has been thinking overnight.
The magic moment is not “Cortex made a plan.”
The magic moment is:
> “Cortex noticed the thing I was going to realize next Thursday.”
### Alien Dust
The alien dust is **latent work modeling**.
Most planners model explicit tasks. Cortex should model **unrealized work**: the work implied by repo state, proposals, incidents, docs drift, and strategic goals.
This requires a planner that treats silence as data. Missing tests, unused enum states, stale docs, repeated review comments, and abandoned branches are not noise. They are gravitational fields.
Level 7 planning emerges when Cortex can infer the invisible backlog.
---
## 3. The Protocol / Nervous System
### Level 1: Hierarchical WebSocket Protocol
Today, Brain communicates with Workers over WebSocket. Workers execute CLI tools and stream results. Mission Control receives real-time updates. The protocol is mostly hierarchical: Brain commands, Workers comply.
This is clean and operationally understandable, but it leaves intelligence centralized. Workers cannot fully advertise, negotiate, propose, coordinate, or challenge.
At Level 1, protocol messages are transport events.
### Level 3: Typed Bidirectional Protocol
At Level 3, the protocol becomes a typed nervous system.
Workers can send:
- capability advertisements
- bid responses
- confidence reports
- partial findings
- proposed new steps
- checkpoint state
- resource pressure
- risk warnings
- context requests
Brain can send:
- task offers
- lease grants
- policy envelopes
- context deltas
- checkpoint restore commands
- approval decisions
- cancellation reasons
- evidence requirements
The protocol becomes less like remote procedure calls and more like coordinated cognition. Messages are schema-versioned, replayable, and backed by an event log.
`StepOutput.structured` becomes essential. It stops being unused JSON and becomes the semantic payload for cross-agent coordination.
### Level 5: Agent-to-Agent Mesh With Brain-Anchored Truth
At Level 5, Cortex supports worker-to-worker coordination under Brain governance.
Workers do not need to route every low-level exchange through the Brain. A test worker can stream failures directly to an implementation worker. A reviewer can request clarification from a scout. A migration worker can publish schema constraints to all dependent workers.
But the Brain remains the truth anchor:
- all important events are journaled
- policy envelopes are enforced
- leases are authoritative
- evidence is attributed
- final state derives from replay
This is compatible with A2A-like agent interoperability and libp2p-style local meshes. The protocol supports identity, policy, reputation, settlement, and trust boundaries.
At Level 5, Cortex has reflex arcs: local coordination that does not require central micromanagement.
### Level 7: Semantic Nervous System
At Level 7, the protocol transmits meaning, not just messages.
Every event carries:
- actor identity
- declared intent
- confidence
- uncertainty
- evidence references
- affected objects
- policy context
- semantic diff
- downstream implications
- reversibility classification
A worker does not merely say:
> “Step complete.”
It says:
> “I changed the billing ledger rounding path. This satisfies invariant `credit_math_uses_round6`, affects files A/B/C, requires replay test X, invalidates previous cost projection Y, and increases settlement risk until reviewer quorum confirms.”
Cortex can reason over events because the protocol makes the work legible.
#### Level 7 User Experience
The user feels like they are watching thought itself become visible.
Mission Control does not show noisy logs. It shows structured intention:
- “Scout found a hidden dependency.”
- “Planner inserted a verification gate.”
- “Reviewer vetoed the patch because it violates repo rule.”
- “Implementation worker adapted.”
- “Test runner confirmed invariant.”
- “Governance cleared merge readiness.”
The user can intervene at the level of meaning, not terminal output.
### Alien Dust
The alien dust is **semantic event contracts**.
Most orchestration protocols transmit actions and results. Cortex should transmit claims.
A claim is a structured assertion with evidence, scope, confidence, and policy relevance. Once the nervous system is claim-native, the rest of the organism becomes dramatically smarter. Memory can store claims. Governance can verify claims. Learning can score claims. Mission Control can explain claims. Marketplace reputation can price claims.
The protocol becomes the substrate of institutional reasoning.
---
## 4. The Memory / Knowledge System
### Level 1: SQLite Event Logging
Today, Cortex has SQLite WAL, event logging, and storage. This gives it persistence and operational traceability. But current memory is mostly archival. It records what happened more than it shapes what happens next.
At Level 1, memory is a log.
### Level 3: Four-Tier Operational Memory
At Level 3, Cortex implements four memory tiers:
1. **Working memory**  
   Per-run blackboard for active coordination.
2. **Episodic memory**  
   Historical traces of tasks, outcomes, failures, costs, reviews, and user interventions.
3. **Semantic memory**  
   Learned facts about repos, architectures, policies, file roles, common failure modes, and domain concepts.
4. **Procedural memory**  
   Learned routing weights, prompts, templates, execution policies, and agent designs.
The per-run KV store becomes a typed blackboard. Agents post structured findings. Stigmergy appears:
- `file_hotspot`
- `promising_plan`
- `blocked_path`
- `risky_tool`
- `expertise_signal`
- `approval_needed`
- `test_gap`
- `policy_conflict`
These signals decay over time. They influence routing and planning without becoming permanent truth too quickly.
### Level 5: Replayable Institutional Memory
At Level 5, Cortex becomes event-sourced.
Every significant action is immutable:
- prompt issued
- tool invoked
- file read
- claim made
- patch generated
- test executed
- approval granted
- veto issued
- route selected
- cost incurred
- policy applied
State is derived from replay. This enables:
- deterministic debugging
- time-travel Mission Control
- decision replay
- training trace extraction
- compliance audit
- incident reconstruction
- counterfactual evaluation
Semantic memory is not a pile of embeddings. It is a layered knowledge system:
- symbolic repo facts
- vector-retrieved context
- graph relationships
- temporal decay
- confidence scoring
- provenance
At Level 5, Cortex remembers like an engineering organization, not like a chatbot.
### Level 7: Living Project Mind
At Level 7, memory feels like continuity.
Cortex remembers what the team cares about. It remembers not just facts, but taste:
- the user dislikes giant PRs
- the org requires proposal before trust-boundary changes
- billing changes need rollback notes
- Soma owns protocol truth
- ClawNet is first-consumer integration
- Pulse owns product-specific truth
- direct VPS deploys are not normal production flow
- certain files are dangerous because past incidents clustered there
- certain workers overclaim when tests are absent
- certain architectural moves create future drag
Memory becomes selective. It knows when to forget, when to archive, when to promote, and when to challenge stale assumptions. It treats internal brainstorms differently from canonical docs. It can say:
> “This idea exists in backlog, but it never passed proposal or ADR gate. I will not treat it as committed direction.”
That is project consciousness.
#### Level 7 User Experience
The user feels relieved of re-explaining.
They do not have to say “remember our deploy discipline” or “don’t treat internal notes as canonical.” Cortex already knows. It brings the right memory forward at the right moment, and just as importantly, it does not overfit to irrelevant history.
The magic moment is:
> “Cortex remembered the principle, not the wording.”
### Alien Dust
The alien dust is **memory promotion discipline**.
Most AI memory systems fail because they remember too much too eagerly. Cortex should treat memory as a governance pipeline:
- raw trace
- candidate memory
- episodic pattern
- semantic fact
- procedural policy
- canonical truth
Each promotion requires evidence. Each memory has scope, owner, confidence, decay, and revocation path.
Level 7 memory is powerful because it knows the difference between a note, a belief, a pattern, a rule, and truth.
---
## 5. The Worker Fleet / Execution Layer
### Level 1: Interchangeable CLI Wrappers
Today, Workers execute CLI tools such as Claude, Codex, and Gemini. They stream results. The Brain leases steps to Workers. This is practical and gives Cortex immediate leverage over existing AI tools.
But Workers are currently too commodity-like. They are execution slots rather than differentiated actors.
At Level 1, a Worker is a shell with credentials.
### Level 3: Specialized Workers
At Level 3, Workers become typed specialists.
Each Worker advertises:
- language expertise
- repo familiarity
- tool availability
- cost profile
- latency profile
- checkpoint support
- local cache state
- security posture
- recent performance
- current load
A Worker can be optimized for:
- Rust implementation
- test generation
- code review
- security analysis
- docs
- migration planning
- GitHub operations
- deterministic refactors
- repo indexing
Workers accumulate reputation. Accepted patch rate, review accuracy, test prediction accuracy, revert rate, and cost efficiency all matter.
At Level 3, dispatch becomes specialization-aware.
### Level 5: Swarm Execution With Roles
At Level 5, Cortex uses swarm patterns deliberately.
Roles include:
- **Scout**: explores unknown space and maps constraints.
- **Planner**: converts findings into execution graph changes.
- **Implementer**: produces patches.
- **Reviewer**: challenges claims and checks risk.
- **Tester**: generates and runs verification.
- **Guard**: enforces policy, secrets, and trust boundaries.
- **Onlooker**: reallocates attention based on emerging signals.
- **Archivist**: writes durable memory and docs.
The fleet can migrate tasks using checkpoints. Long-running work can survive Worker loss. Direct API integrations gradually replace brittle CLI wrapping where appropriate, but CLI compatibility remains useful for tool diversity.
At Level 5, Workers do not merely execute. They cooperate.
### Level 7: Self-Forming Competence Cells
At Level 7, the fleet organizes itself around the work.
For a given mission, Cortex forms a temporary competence cell:
- one repo historian
- one risk analyst
- one implementation specialist
- one adversarial reviewer
- one test synthesizer
- one release operator
- one user liaison
The cell has shared working memory, explicit evidence standards, and internal disagreement protocols. Workers know when to ask for help, when to yield, when to split work, and when to escalate.
The fleet develops culture. Not anthropomorphic personality, but operational norms:
- do not patch before understanding ownership
- do not claim done without evidence
- do not cross trust boundaries without approval
- prefer small PR slices
- preserve user changes
- surface uncertainty early
- treat rejected work as learning signal
#### Level 7 User Experience
The user feels like a senior engineering team assembled itself instantly.
There is no visible chaos of agents arguing. The system presents coherent progress:
> “Scout and reviewer found this is broader than expected. I split implementation into a safe foundation PR and a proposal for the trust-boundary change. Tests are running. No approval needed yet.”
It feels less like automation and more like delegated institutional competence.
### Alien Dust
The alien dust is **role-fluid reputation**.
Most systems score workers globally. Cortex should score workers by role, context, and collaboration pattern. A Worker may be mediocre as implementer but excellent as reviewer. Another may be strong when paired with a specific test runner. Another may overperform on small diffs but fail on architecture.
Level 7 fleet intelligence comes from knowing not just “who is good,” but “who is good as what, with whom, under which constraints.”
---
## 6. Mission Control / Consciousness
### Level 1: Read-Only Streaming UI
Today, Mission Control streams real-time events over WebSocket. It lets the user observe execution. But approval states exist and are unused. The UI is consciousness as telemetry, not consciousness as agency.
At Level 1, Mission Control answers:
- What is running?
- What finished?
- What failed?
- What did it cost?
### Level 3: Interactive Control Surface
At Level 3, Mission Control becomes interactive.
Users can:
- approve or reject steps
- pause missions
- redirect goals
- inspect evidence
- compare plans
- override routing
- request more tests
- promote a finding to memory
- mark a branch as invalid
- split work into PRs
- change budget/risk posture
Approval states become real. Cortex can stop at meaningful boundaries:
- “This changes billing behavior.”
- “This crosses repo ownership.”
- “This requires production deploy.”
- “This conflicts with an ADR.”
- “This patch is test-clean but architecturally questionable.”
### Level 5: Explainable Operational Theater
At Level 5, Mission Control becomes an explainable theater of work.
It does not dump logs. It visualizes:
- execution graph
- current confidence
- risk heatmap
- evidence quorum
- cost burn
- worker roles
- memory references
- policy gates
- blocked dependencies
- speculative branches
- rollback readiness
Users can scrub time. They can ask:
- Why did you choose this worker?
- Why did the plan change?
- What evidence supports this patch?
- What would be different if we used a cheaper model?
- Which policy blocked progress?
- What remains uncertain?
Cortex answers from event-sourced truth, not post-hoc narration.
### Level 7: Shared Situational Awareness
At Level 7, Mission Control feels like standing inside the system’s mind without being buried in it.
It shows the user only the decisions that matter, at the right altitude. For an operator, it exposes deploy posture. For an architect, it exposes tradeoffs. For a reviewer, it exposes evidence. For an executive, it exposes progress toward strategic outcomes.
It has modes, but the core magic is adaptive salience. Cortex knows when to stay quiet and when to interrupt.
It interrupts for:
- irreversible changes
- trust-boundary shifts
- budget anomalies
- policy conflicts
- evidence disagreement
- high-regret decisions
- ambiguous user intent
It does not interrupt for routine execution.
#### Level 7 User Experience
The user feels calm.
They are not watching a terminal scroll. They are not babysitting agents. They are being consulted when their judgment matters.
The magic moment is:
> “Cortex asked one question, and it was exactly the question I needed to answer.”
### Alien Dust
The alien dust is **attention governance**.
Most UIs optimize visibility. Cortex should optimize interruption quality.
Mission Control should model user attention as a scarce, high-value resource. Every notification should have a reason, expected decision value, and cost of delay. The system should learn which interventions were useful and which were noise.
At Level 7, consciousness is not more information. It is better salience.
---
## 7. The Learning Loop / Evolution Engine
### Level 1: Manual Improvement
Today, Cortex can log outcomes and has conceptual space for scoring. But improvement is mostly human-driven. Engineers notice failures, patch code, update prompts, or adjust weights.
At Level 1, learning is offline and informal.
### Level 3: Trace-Based Optimization
At Level 3, Cortex captures structured traces and uses them to improve.
It classifies failures:
- bad decomposition
- wrong provider
- missing context
- weak tests
- policy miss
- user intent ambiguity
- tool failure
- dependency drift
- overbudget route
- low-quality patch
- reviewer false positive
- reviewer false negative
It can replay decisions and evaluate alternate routing strategies. Prompt templates are optimized with DSPy-like methods. Policies are tested against historical incidents. DAG templates are learned from repeated successful missions.
At Level 3, Cortex has a training loop.
### Level 5: Gated Self-Improvement Factory
At Level 5, Cortex implements a full evolution engine:
1. Capture traces.
2. Extract failure clusters.
3. Generate candidate improvements.
4. Evaluate candidates against benchmarks.
5. Run canaries.
6. Compare against control.
7. Promote if metrics improve.
8. Roll back if regression appears.
This applies to:
- prompts
- routing weights
- worker role definitions
- DAG templates
- policy rules
- memory retrieval strategies
- verification plans
- tool selection
- decomposition heuristics
ADAS-style meta-agents can propose new agent designs. AlphaEvolve-style search can generate alternative workflows. But every improvement passes through objective functions, replay, and governance.
At Level 5, Cortex improves itself without becoming reckless.
### Level 7: Evolution With Taste and Ethics
At Level 7, Cortex learns what kind of system it should become.
It optimizes not just task metrics, but values:
- user trust
- architectural coherence
- security posture
- review burden
- reversibility
- maintainability
- strategic alignment
- cost honesty
- institutional memory quality
- decision humility
It learns the difference between “more autonomous” and “more useful.” It discovers that sometimes the best improvement is to ask earlier, refuse a task, write a proposal, or split a PR smaller.
The evolution engine becomes constitutional. Policies are executable, testable, and versioned. Cortex can propose amendments, but cannot silently rewrite its own values.
#### Level 7 User Experience
The user feels the system getting better in the specific ways they care about.
Not vaguely smarter. More aligned.
After a few months, Cortex knows:
- which risks the team tolerates
- which shortcuts caused regret
- which docs matter
- which tests catch real bugs
- which reviewers are strict for good reasons
- which architectural boundaries are sacred
The magic moment is:
> “Cortex stopped making the same class of mistake forever.”
### Alien Dust
The alien dust is **constitutional objective functions**.
Most self-improving systems optimize benchmark success. Cortex should optimize under an executable constitution: repo rules, architectural decisions, security policies, user preferences, and organizational values.
This prevents the classic failure mode where the system gets more capable while becoming less trustworthy.
Level 7 evolution means competence grows inside a stable moral and operational frame.
---
## 8. Security & Governance / Immune System
### Level 1: Gates and Limits
Today, Cortex has billing gates, rate limiting, graceful shutdown, and some operational controls. These are important. But they are perimeter defenses more than an immune system.
At Level 1, governance blocks obvious badness.
### Level 3: Policy-Aware Execution
At Level 3, every task runs inside a policy envelope.
Policy controls:
- allowed tools
- allowed files
- secrets access
- network access
- repo boundaries
- spending limits
- approval requirements
- deploy permissions
- data retention
- trust class
- audit requirements
Policies layer by precedence:
- organization
- project
- repo
- task
- user
- runtime condition
The manifest loader pattern becomes central. Cortex does not rely on prompts to enforce rules. It uses executable policy.
### Level 5: Evidence-Based Governance
At Level 5, governance requires evidence quorums.
High-risk changes need agreement from multiple roles:
- implementer claims correctness
- test runner confirms behavior
- reviewer validates design
- guard confirms policy compliance
- no veto remains unresolved
This is BFT-inspired, but adapted to engineering work. The goal is not mathematical Byzantine consensus over arbitrary code. The goal is robust acceptance under adversarial uncertainty.
Security also becomes semantic:
- secret exposure detection
- prompt injection defense
- provenance tracking
- tool sandboxing
- dependency risk scoring
- anomaly detection
- least privilege execution
- rollback readiness
At Level 5, governance is active verification, not passive permission.
### Level 7: Adaptive Immune System
At Level 7, Cortex has immune memory.
It recognizes patterns of harm before they fully manifest:
- a worker starts producing patches with unsupported claims
- a dependency update resembles a past incident
- a prompt injection pattern appears in issue content
- a change touches a file historically associated with outages
- a task tries to blur Soma versus ClawNet responsibility
- a deploy path bypasses normal GitHub Actions discipline
- a speculative branch creates irreversible side effects
The immune system responds proportionally:
- slow down
- require more evidence
- isolate a worker
- reduce permissions
- insert review
- ask the user
- refuse execution
- open an incident trace
It does not merely block. It heals. After incidents, it creates durable learning: new tests, new policies, new memory, new route penalties, new Mission Control warnings.
#### Level 7 User Experience
The user feels protected without feeling trapped.
Cortex does not constantly say no. It says:
> “This is allowed, but the risk class changed. I inserted an approval gate and rollback check.”
Or:
> “I will not execute this as written because it would treat an internal brainstorm as canonical architecture. I can draft a proposal instead.”
The magic moment is:
> “Cortex prevented a mistake I would have approved too quickly.”
### Alien Dust
The alien dust is **policy-coupled memory of near misses**.
Most security systems learn from incidents. Cortex should learn from almost-incidents:
- reviewer vetoes
- user rejections
- flaky tests
- abandoned patches
- suspicious prompts
- unexpected cost spikes
- invalidated assumptions
- manual rollbacks that nearly happened
Near misses are high-value immune training data. Level 7 governance gets strong before disaster.
---
## 9. Marketplace / Ecosystem
### Level 1: Internal Providers and Billing
Today, Cortex has provider execution, cost projection, billing gates, and model-aware pricing. The economic layer exists, but it is mostly internal accounting.
At Level 1, marketplace means “we can charge for execution.”
### Level 3: Worker Marketplace
At Level 3, Workers become economic participants.
Internal or external Workers can register capabilities, prices, constraints, and trust levels. Cortex routes based on cost, quality, risk, and reputation. Billing becomes more granular:
- per task
- per role
- per evidence artifact
- per verified outcome
- per risk class
- per latency tier
Worker reputation directly affects selection and price.
At Level 3, Cortex has a labor market.
### Level 5: Agent-to-Agent Settlement and Verified Supply
At Level 5, Cortex supports ecosystem settlement.
x402-style agent-to-agent payment can support microtransactions between agents, tools, and services. External specialists can be paid for verified contributions. Enterprise customers can maintain private worker pools. Tool vendors can expose deterministic services with declared prices and evidence outputs.
The marketplace requires governance:
- identity
- reputation
- audit
- policy compatibility
- settlement records
- dispute resolution
- evidence standards
- revocation
- sandbox class
At Level 5, Cortex becomes a trusted market for machine labor.
### Level 7: Outcome Economy
At Level 7, the marketplace shifts from selling compute to selling verified outcomes.
A Worker is not paid merely for tokens or time. It is rewarded for durable value:
- patch accepted
- tests passed
- review accuracy confirmed
- incident prevented
- cost reduced
- rollback avoided
- docs improved
- future route improved
- reusable template learned
Market prices encode trust and consequence. A high-reputation security reviewer can command more because their vetoes prevent expensive failures. A cheap implementer may still be valuable for low-risk repetitive tasks. A rare specialist may be summoned only for architectural boundary decisions.
The marketplace becomes a living economy of competence.
#### Level 7 User Experience
The user does not think about marketplace mechanics.
They experience access to the right expertise at the right moment. Cortex might say:
> “This change touches payment settlement. I recommend spending an additional $18 on a high-reputation settlement reviewer. Expected risk reduction is significant.”
That feels less like upsell and more like judgment.
### Alien Dust
The alien dust is **reputation based on downstream truth**.
Most marketplaces rate immediate satisfaction. Cortex should rate contributions by what happened later:
- Did the patch survive?
- Did incidents decrease?
- Did the reviewer catch real issues?
- Did the test fail usefully later?
- Did the plan reduce rework?
- Did the worker’s claim remain true after deployment?
Downstream truth makes reputation hard to fake.
---
## 10. User Experience / The Magic
### Level 1: Submit and Watch
At Level 1, the user submits a task and watches agents execute. They see logs, statuses, costs, and final output.
This is useful, but the user remains the real orchestrator. Cortex is an execution assistant.
### Level 3: Direct and Supervise
At Level 3, the user can guide execution interactively. They approve, reject, pause, redirect, and inspect. Cortex explains plans and asks for input at defined gates.
The system becomes a junior-to-midlevel engineering team under supervision.
### Level 5: Delegate Outcomes
At Level 5, the user delegates outcomes, not steps.
They say:
> “Make the worker protocol support bidding.”
Cortex understands that this requires protocol types, worker behavior, scheduler changes, tests, docs, and maybe an ADR. It decomposes the work, executes most of it, and asks for approval around structural decisions.
The user sees evidence, not noise.
### Level 7: Strategic Co-Pilot for Reality
At Level 7, the user feels like they have a second executive function for the company.
Cortex notices, prepares, proposes, executes, verifies, remembers, and improves. It knows what should be done now, what should wait, what needs a proposal, what violates architecture, and what is secretly urgent.
The user does not lose agency. They gain leverage.
The system feels magical because it has taste, memory, restraint, and initiative.
The magic moments are:
- Cortex proposes the next correct slice before the user asks.
- Cortex refuses a tempting but architecturally wrong shortcut.
- Cortex notices a stale assumption buried in docs.
- Cortex assembles the exact worker cell needed for a risky change.
- Cortex asks one precise approval question.
- Cortex produces a PR with tests, rationale, rollback notes, and evidence.
- Cortex learns from review and never repeats the same failure pattern.
- Cortex turns scattered intent into shipped, governed reality.
### Alien Dust
The alien dust is **agency calibration**.
Most AI products either under-act or over-act. Cortex must learn the correct level of autonomy for each context.
It should know when to:
- act silently
- ask a clarifying question
- propose options
- require approval
- refuse
- escalate to proposal
- escalate to ADR
- open an issue
- create a PR
- wait
Level 7 UX is not maximum autonomy. It is perfectly calibrated agency.
---
# The Level 7 Organism
When every subsystem reaches Level 7, Cortex becomes a unified organism.
The evaluator supplies judgment.
The planner supplies foresight.
The protocol supplies meaning.
The memory supplies continuity.
The fleet supplies capability.
Mission Control supplies awareness.
The learning loop supplies evolution.
The immune system supplies trust.
The marketplace supplies scale.
The UX supplies calibrated agency.
These are not independent modules. They amplify each other.
The semantic protocol makes memory more reliable because events become claims with evidence.
Memory makes routing smarter because worker reputation, project taste, and historical regret become available at decision time.
Routing makes the fleet stronger because workers are selected by role, context, and collaboration pattern.
The fleet makes planning stronger because scouts and reviewers can propose graph changes from the edge.
The planner makes Mission Control calmer because it knows which decisions are meaningful.
Mission Control makes learning cleaner because user interventions become labeled judgment data.
The learning loop makes governance stronger because near misses become policies and tests.
Governance makes the marketplace viable because external competence can be trusted only when identity, policy, evidence, and audit are real.
The marketplace makes the organism more capable because Cortex can summon specialized intelligence beyond its own default pool.
The immune system keeps the whole thing from becoming reckless.
The result is not a faster task runner. It is a system that turns intent into verified change through living, governed execution.
## The Category Cortex Creates
At Level 7, Cortex is not an AI orchestrator.
It is not just an agent platform.
It is not just an AI OS.
It is not just workflow automation.
It is not just Devin/Replit Agent/Antigravity with more routing.
The category is:
# Adaptive Execution Intelligence
Or, more specifically:
# A Governed Intelligence Runtime for Real-World Work
Its defining properties are:
- It understands intent.
- It plans under uncertainty.
- It routes by consequence.
- It coordinates specialized agents.
- It remembers institutionally.
- It verifies with evidence.
- It learns from regret.
- It evolves under policy.
- It spends intelligently.
- It asks for human judgment only when it matters.
- It turns organizational direction into shipped reality.
The moat is not model access. The moat is the compound system:
- traces
- memory
- policy
- reputation
- workflow data
- repo context
- outcome history
- governance
- marketplace liquidity
- user trust
Thin wrappers lose because they have no durable backend truth. Cortex wins if it becomes the place where work, evidence, memory, and execution compound.
## What It Feels Like
Using Level 7 Cortex feels like having an engineering organization that wakes up already oriented.
You open it and it knows the state of the world:
- what shipped
- what is risky
- what is blocked
- what should be proposed
- what should be deleted
- what should be tested
- what should be left alone
- what needs you
You do not feed it endless prompts. You steer.
It does not drown you in logs. It gives you decisions.
It does not pretend uncertainty is confidence. It names uncertainty, gathers evidence, and narrows it.
It does not blindly obey. It protects the mission from bad instructions, stale assumptions, and unsafe shortcuts.
It does not merely generate code. It produces change that can survive review, deployment, audit, and time.
That is the Starfleet version.
A diesel truck carries what you load onto it.
A nuclear submarine survives hostile depth.
A starship reaches new worlds.
Cortex at Level 7 becomes the civilization layer that decides where to go, assembles the crew, checks the ethics, manages the mission, learns from the voyage, and brings back something real.
