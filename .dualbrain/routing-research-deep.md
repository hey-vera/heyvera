# Cortex Routing Intelligence: Deep Research (May 2026)

> Extensive survey of 2024-2026 advances in LLM routing, multi-agent scheduling, confidence calibration, non-stationary bandits, credit assignment, self-calibrating systems, intent decomposition, evidence provenance, cost-quality Pareto optimization, and novel approaches.

**Scope:** Techniques we did NOT already know about (beyond FrugalGPT, RouteLLM, Netflix bandits, Vowpal Wabbit, Google SRE canarying).

---

## 1. Latest LLM Routing Papers (Post-RouteLLM)

### 1.1 ParetoBandit: Budget-Paced Adaptive Routing for Non-Stationary LLM Serving
- **Paper:** [arXiv:2604.00136](https://arxiv.org/abs/2604.00136) (April 2026)
- **What:** First router to simultaneously enforce dollar-denominated budgets, adapt online to provider shifts, and onboard new models at runtime.
- **Key insight:** An online primal-dual budget pacer enforces a per-request cost ceiling over an open-ended stream, replacing offline penalty tuning with closed-loop control. Geometric forgetting on sufficient statistics enables rapid adaptation to price/quality shifts while bootstrapping from offline priors. A hot-swap registry lets operators add/remove models at runtime with a brief forced-exploration phase.
- **Performance:** Mean per-request cost never exceeds budget by >0.4% across 7 budget ceilings. Detects and reroutes around silent quality regressions within budget.
- **Cortex relevance:** **CRITICAL.** This is almost exactly what Cortex needs. The primal-dual budget pacer maps directly to our subscription budget tracking. The hot-swap registry solves our provider onboarding problem. Geometric forgetting handles the non-stationarity we worried about. We should study this implementation closely.
- **Validates:** Our budget-balancer concept. **Challenges:** Our current approach of static budget windows -- ParetoBandit's closed-loop control is strictly superior.

### 1.2 PILOT: Preference-Prior Informed LinUCB for Adaptive Routing
- **Paper:** [arXiv:2508.21141](https://arxiv.org/abs/2508.21141) (EMNLP 2025 Findings)
- **What:** Contextual bandit for LLM routing that initializes from offline human preference data then refines online.
- **Key insight:** Creates a shared embedding space for queries AND models, pretrained on human preference data (like Chatbot Arena). Uses LinUCB-style upper confidence bounds with a "preference prior" over the reward model. Includes an online multi-choice knapsack policy for budget-aware selection.
- **Cortex relevance:** **HIGH.** The shared query-model embedding space is powerful -- it means the router understands both the query difficulty AND each model's strengths in the same representation. The preference prior gives us a warm start instead of cold-starting the bandit.
- **Validates:** Our bandit-based routing. **Extends:** We weren't planning to use preference priors for initialization -- this could dramatically reduce Cortex's cold-start problem.

### 1.3 MixLLM: Dynamic Routing in Mixed LLMs
- **Paper:** [arXiv:2502.18482](https://arxiv.org/abs/2502.18482) (NAACL 2025)
- **What:** Contextual bandit framework with policy gradient methods for query-LLM assignment.
- **Key insight:** Enhances query embeddings with domain-aware tags through unsupervised fine-tuning, enabling more accurate predictions of LLM-specific response quality and cost. Achieves 97.25% of GPT-4's quality at 24.18% of the cost.
- **Cortex relevance:** **HIGH.** Domain-aware tagging is something we should incorporate into our intent detection. The unsupervised fine-tuning of query embeddings means we don't need labeled routing data.

### 1.4 BEST-Route: Adaptive LLM Routing with Test-Time Optimal Compute
- **Paper:** [arXiv:2506.22716](https://arxiv.org/abs/2506.22716) (June 2025)
- **What:** Routes based on BOTH model selection AND number of responses to sample (test-time compute budget).
- **Key insight:** Query difficulty determines not just which model, but how many samples to draw from it. This jointly optimizes model choice + sampling budget. Reduces costs up to 60% with <1% performance drop.
- **Cortex relevance:** **HIGH.** We currently only route to a single model. BEST-Route suggests we should also control the sampling strategy -- for hard queries, multiple samples from a weaker model can beat a single shot from a stronger one.
- **Challenges:** Our single-response assumption. We should add a `sample_count` parameter to routing decisions.

### 1.5 Route-to-Reason: Adaptive Routing for LLM and Reasoning Strategy Selection
- **Paper:** [arXiv:2505.19435](https://arxiv.org/abs/2505.19435) (May 2025)
- **What:** Unified framework that dynamically allocates both language models AND reasoning strategies (CoT, ToT, etc.) under budget constraints.
- **Key insight:** Routes across two dimensions simultaneously: which model and which reasoning strategy. Learns compressed representations of both.
- **Cortex relevance:** **HIGH.** Our current routing only selects models. This suggests routing should also select the cognitive strategy (e.g., direct answer vs. chain-of-thought vs. multi-step reasoning).

### 1.6 Cascade Routing: A Unified Approach
- **Paper:** [arXiv:2410.10347](https://arxiv.org/abs/2410.10347) (October 2024, ETH Zurich)
- **What:** Unifies routing (choose one model) and cascading (try cheap first, escalate) into a single optimal strategy.
- **Key insight:** Good quality estimators are THE critical factor for model selection success. Cascade routing consistently improves performance by >4% over either routing or cascading alone (~80% relative improvement over naive baseline on RouterBench).
- **Cortex relevance:** **CRITICAL.** We should implement cascade routing, not just routing. Start with the cheapest model, evaluate the response quality, escalate only when needed. This aligns with our tier system (Haiku -> Sonnet -> Opus) but formalizes it.
- **Validates:** Our tier escalation concept. **Extends:** We need quality estimators as a first-class component.

### 1.7 Router-R1: Multi-Round Routing via Reinforcement Learning
- **Paper:** [arXiv:2506.09033](https://arxiv.org/abs/2506.09033) (NeurIPS 2025)
- **What:** RL-based router that can invoke multiple models sequentially, interleaving "think" and "route" actions.
- **Key insight:** The router itself is an LLM that uses reasoning to decide routing. It interleaves internal deliberation ("think") with dynamic model invocation ("route"), integrating each response into its evolving context. Generalizes to unseen models using only simple descriptors (pricing, latency, example performance).
- **Cortex relevance:** **HIGH.** The "think then route" pattern is exactly what our HEAD brain does. The generalization via simple descriptors means we don't need to retrain when adding new providers. The multi-round routing (ask model A, evaluate, then maybe ask model B) is more sophisticated than our current single-shot routing.
- **Validates:** Our HEAD constitution's "think before acting" principle.

### 1.8 xRouter: Cost-Aware LLM Orchestration via RL (Salesforce)
- **Paper:** [arXiv:2510.08439](https://arxiv.org/abs/2510.08439) (October 2025)
- **What:** Tool-calling-based router trained end-to-end with RL using cost-aware rewards.
- **Key insight:** The router can either answer directly OR invoke external models via tool calls. Trained with DAPO (Distributional Advantage Policy Optimization). Perturbing prices and model pools during training improves robustness to changing provider catalogs.
- **Cortex relevance:** **MEDIUM-HIGH.** The tool-calling interface is interesting -- the router is itself an agent. The price perturbation during training is a clever way to make the router robust to the exact non-stationarity problem we face. However, requires a separate training pipeline.

### 1.9 DiSRouter: Distributed Self-Routing
- **Paper:** [arXiv:2510.19208](https://arxiv.org/abs/2510.19208) (October 2025)
- **What:** Each LLM independently decides whether to answer or route to another model based on self-awareness.
- **Key insight:** Replaces centralized routing with distributed self-assessment. Uses a two-stage Self-Awareness Training pipeline (SFT + RL) to teach each model when it should and shouldn't answer. The distributed design eliminates the single-point-of-failure router.
- **Cortex relevance:** **MEDIUM.** Interesting architectural alternative. We could add self-awareness signals from each model as an input to our centralized router rather than going fully distributed. The self-awareness training concept could help us train models to report their own confidence.
- **Challenges:** Our centralized HEAD architecture. But we can incorporate the insight without going fully distributed.

### 1.10 Cost-Spectrum Contrastive Routing (CSCR)
- **Paper:** [arXiv:2508.12491](https://arxiv.org/abs/2508.12491) (NeurIPS 2025 Spotlight)
- **What:** Maps prompts and models into a shared embedding space using contrastive learning with cost-aware objectives.
- **Key insight:** Cost-Spectrum InfoNCE selects correct positives within adaptive cost bands, temperature-scales each band separately, and down-weights negatives proportionally to cost. At inference, routing reduces to a single k-NN lookup via FAISS index -- microsecond latency, no retraining when model pool changes.
- **Cortex relevance:** **CRITICAL for Rust implementation.** The FAISS k-NN lookup is extremely fast and could be implemented in Rust with our own vector similarity. The "no retraining on pool change" property is exactly what we need for hot-swapping providers. Microsecond routing latency is ideal.
- **Validates:** Our embedding-based approach. **Extends:** We need cost-aware contrastive training for our embeddings.

### 1.11 RouterArena: Benchmark for LLM Routers
- **Paper:** [arXiv:2510.00202](https://arxiv.org/abs/2510.00202) (September 2025)
- **What:** First comprehensive benchmark platform for comparing LLM routers.
- **Key finding:** Evaluation of 12 routers reveals NO single router is universally optimal -- significant accuracy-cost tradeoffs exist. Includes difficulty levels, domain coverage, and automated leaderboard.
- **Cortex relevance:** **HIGH for validation.** We should benchmark Cortex against RouterArena to compare with existing solutions. The finding that no router is universally optimal suggests meta-routing (routing the router) could be valuable.

### 1.12 Survey: Dynamic Model Routing and Cascading
- **Paper:** [arXiv:2603.04445](https://arxiv.org/abs/2603.04445) (March 2026)
- **What:** Comprehensive survey of the entire routing and cascading landscape.
- **Cortex relevance:** Essential reference document for our design decisions.

---

## 2. Multi-Agent Scheduling

### 2.1 OpenAI Agents SDK (March 2025)
- **What:** Production successor to the experimental Swarm framework. Core primitives: Handoffs (agent-to-agent transfer), Guardrails (input/output validation), Tracing (end-to-end observability).
- **Key insight:** Two elegant primitives -- "routines" (instructions + tools) and "handoffs" (explicit transfer of control with context). Each agent is defined with instructions, model reference, tools, and handoff targets.
- **Cortex relevance:** **HIGH.** Our agent dispatch system should implement explicit handoff semantics. The guardrails pattern maps to our quality gates. The tracing pattern is what we need for decision audit trails.
- **Validates:** Our typed contract approach (objective, scope, acceptance criteria).

### 2.2 Microsoft Agent Framework (AutoGen -> Agent Framework)
- **What:** Microsoft merged AutoGen with Semantic Kernel into a unified Agent Framework (October 2025). Introduces graph-based workflow model with DiGraphBuilder and GraphFlow.
- **Key insight:** Shift from conversational GroupChat model to explicit dependency-based DAG orchestration. Developers define edges (handoff logic) with conditions between agents.
- **Cortex relevance:** **MEDIUM-HIGH.** The DAG-based task scheduling with dependency graphs aligns with our Ship Captain's task decomposition. We should model task dependencies as a DAG rather than a linear chain.

### 2.3 LangGraph State Machines
- **What:** DAG-based orchestration where nodes = agents/functions, edges = data flow. Uses reducer-driven state schemas via TypedDict.
- **Key insight:** Centralized StateGraph maintains context, enabling parallel execution and conditional branching. Battle-tested at Uber, LinkedIn, Klarna.
- **Cortex relevance:** **MEDIUM.** The state machine pattern is solid but we're building in Rust, not Python. The key architectural lesson: explicit state management with typed reducers prevents data loss in multi-agent systems.

### 2.4 Production Statistics
- 72% of enterprise AI projects now involve multi-agent architectures (up from 23% in 2024).
- 95% fail to reach production due to architecture, governance, and integration gaps.
- **Cortex relevance:** The 95% failure rate means robust architecture is a massive differentiator.

---

## 3. Confidence Calibration for LLMs

### 3.1 Conformal Prediction for LLMs
- **Survey:** [TACL 2025](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00715/125278/) - comprehensive survey
- **What:** Distribution-free coverage guarantees for prediction sets. Prediction set size strongly correlates with accuracy.
- **Key techniques:**
  - **TECP (Token-Entropy Conformal Prediction):** Reliable coverage and compact prediction sets for open-ended QA across multiple LLMs.
  - **Geometry-Calibrated Conformal Abstention:** [arXiv:2604.27914](https://arxiv.org/abs/2604.27914) - calibrated abstention using geometric properties of embedding spaces.
  - **SCOPE:** Selective conformal prediction for pairwise LLM judging with error rate guarantees.
- **Cortex relevance:** **CRITICAL.** Conformal prediction gives us mathematically guaranteed confidence bounds -- we can say "with 95% probability, the response quality is above threshold X" rather than heuristic confidence scores. This should drive our escalation decisions.
- **Extends:** Our current confidence scoring is ad-hoc. Conformal prediction provides formal guarantees.

### 3.2 SelectLLM: Calibrated Selective Prediction
- **Paper:** [OpenReview](https://openreview.net/forum?id=JJPAy8mvrQ)
- **What:** Integrates selective prediction into finetuning to optimize performance over the covered domain.
- **Key insight:** Rather than calibrating confidence post-hoc, build it into the training objective. The model learns when to abstain as part of its core training.
- **Cortex relevance:** **HIGH.** If we can get models that natively know when to abstain, our routing quality estimators become much more reliable.

### 3.3 AbstentionBench: LLM Abstention is Unsolved
- **Paper:** [TACL 2025](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00754/131566/)
- **What:** Large-scale benchmark evaluating 20 frontier LLMs on abstention across 20 datasets.
- **Key finding:** Abstention is an unsolved problem. **Reasoning fine-tuning degrades abstention by 24% on average**, even for math/science domains where reasoning models are explicitly trained.
- **Cortex relevance:** **CRITICAL insight.** This means we CANNOT trust reasoning models to know their limits. Our router must maintain its own confidence estimates independent of model self-reports. External quality estimation is essential.
- **Challenges:** Any design relying on model self-reported confidence.

### 3.4 Token-Level Entropy as Confidence Signal
- **Papers:** ToKUR ([arXiv:2505.11737](https://arxiv.org/abs/2505.11737)), "Think Just Enough" ([arXiv:2510.08146](https://arxiv.org/abs/2510.08146))
- **What:** Shannon entropy from top-k token logprobs as uncertainty measure. Token-level uncertainty reliably indicates hallucinations.
- **Key insight:** Token-level entropy drives cascade escalation: small models handle low-entropy (confident) generations, escalating high-entropy sequences to larger models. AdaDec uses pause-then-rerank when entropy spikes.
- **Cortex relevance:** **HIGH.** When we have access to logprobs (e.g., from open-source models or APIs that expose them), token entropy is a cheap, real-time confidence signal. We should use it as an input to our routing decisions, especially for cascade triggers.

### 3.5 Uncertainty Propagation in Multi-Component LLM Systems
- **Paper:** [arXiv:2604.23505](https://arxiv.org/abs/2604.23505) (April 2026)
- **What:** How uncertainty compounds through multi-step LLM pipelines.
- **Cortex relevance:** **HIGH.** When our pipeline chains multiple models (search -> execute -> verify), uncertainty from each stage propagates. We need to track and compound uncertainty through the pipeline, not just at individual model outputs.

---

## 4. Non-Stationary Bandits

### 4.1 Catoni-Style Change Point Detection for Heavy-Tailed Bandits
- **Paper:** [arXiv:2505.20051](https://arxiv.org/abs/2505.20051) (May 2025)
- **What:** Change-point detection strategy tailored for heavy-tailed reward distributions (which LLM quality scores definitely are).
- **Key insight:** Combines Catoni's M-estimator (robust to outliers) with change-point detection for bandits. Provides regret bounds even when reward distributions have heavy tails.
- **Cortex relevance:** **HIGH.** LLM response quality has heavy-tailed distributions (most responses are fine, occasional catastrophic failures). Standard change-point detection assumes Gaussian distributions and will miss quality degradation. Catoni-style estimation is more robust.

### 4.2 Sliding-Window Thompson Sampling
- **Key insight:** Thompson Sampling with sliding window handles both abrupt changes (model update) and smooth drift (gradual degradation). Gap-dependent rates reveal optimistic regimes of non-stationarity.
- **Cortex relevance:** **HIGH.** We should use sliding-window Thompson Sampling rather than fixed UCB bounds. TS naturally balances exploration/exploitation and the sliding window handles non-stationarity.

### 4.3 dLinUCB: Change-Point Detection for Contextual Bandits
- **What:** Maintains multiple "slave" models for hypothesized stationary segments. Master process detects abrupt changes via residuals/confidence bounds.
- **Key insight:** The master-slave architecture: master detects when things change, slaves learn within stationary periods. This naturally handles model updates (change point) vs. gradual drift (sliding window).
- **Cortex relevance:** **HIGH.** We should implement dual detection: fast change-point detection for provider outages/updates + slow sliding window for gradual quality drift.

### 4.4 SW-Whittle: Online Whittle Indices for Non-Stationary Restless Bandits
- **Paper:** [arXiv:2506.18186](https://arxiv.org/abs/2506.18186) (June 2025)
- **What:** Sliding-Window Online Whittle policy for resource allocation under unknown, time-varying dynamics.
- **Key insight:** Whittle indices provide near-optimal resource allocation for restless bandits (where arms evolve even when not pulled -- like models that degrade even when not queried). The sliding window makes it adaptive.
- **Cortex relevance:** **MEDIUM-HIGH.** Restless bandits are a better model than standard MAB for LLM routing because models change even when we're not using them (provider updates, training data changes). Whittle indices could replace or augment our current routing scores.
- **Challenges:** Computational complexity of Whittle index computation. May need approximations for real-time routing.

---

## 5. Causal Credit Assignment in Multi-Step Pipelines

### 5.1 SHARP: Shapley Credit-Based Optimization for Multi-Agent Systems
- **Paper:** [arXiv:2602.08335](https://arxiv.org/abs/2602.08335) (February 2026)
- **What:** Tripartite reward system: global accuracy + marginal Shapley credit + tool process rewards.
- **Key insight:** Isolates each agent's contribution via Shapley values, addressing the fundamental challenge of "who deserves credit" in collaborative systems.
- **Cortex relevance:** **HIGH.** When a search agent finds relevant context, an execute agent writes code, and a verify agent checks it, we need to know which agent contributed most to success/failure. SHARP's tripartite reward structure maps directly to our search/execute/think tiers.

### 5.2 SCAR: Shapley Credit Assignment Rewards
- **What:** Treats the reasoning chain as a coalitional game where each segment is a "player."
- **Key insight:** Each segment of a reasoning chain gets credit proportional to its marginal contribution. This enables fine-grained reward assignment within a single model's output.
- **Cortex relevance:** **MEDIUM.** More relevant for model training than routing, but the concept applies to pipeline attribution.

### 5.3 Beyond Uniform Credit: Causal Credit Assignment
- **Paper:** [arXiv:2602.09331](https://arxiv.org/abs/2602.09331) (February 2026)
- **What:** Restricts credit assignment to causally relevant actions using counterfactual reasoning.
- **Key insight:** Not all steps in a pipeline equally cause the outcome. Counterfactual analysis asks "what would have happened without this step?" to isolate causal contributions.
- **Cortex relevance:** **HIGH.** For our pipeline (detect -> decide -> dispatch -> verify), counterfactual credit tells us which stage caused a failure. If removing the search step still produces the same result, the search agent gets zero credit.

### 5.4 Computational Reality
- **Challenge:** Shapley value computation grows factorially with number of agents.
- **Mitigation:** Owen value approximations, Monte Carlo sampling, or segmentation-based approaches.
- **Cortex relevance:** We'll need approximations. For 3-5 agents in a typical pipeline, exact Shapley is tractable. For larger swarms, use Monte Carlo sampling.

---

## 6. Self-Calibrating Systems

### 6.1 Evidently AI + Online Drift Detection
- **What:** Open-source drift detection with pre-built tests for data drift, concept drift, and prediction drift. Real-time reports comparing current data windows against reference datasets.
- **Key insight:** Statistical hypothesis testing and distance metrics (KS test, PSI, Wasserstein distance) on feature distributions detect when the input landscape shifts.
- **Cortex relevance:** **HIGH.** We should monitor the distribution of incoming queries and model responses. If query difficulty distribution shifts (e.g., more complex queries over time), our routing parameters may need recalibration.

### 6.2 Streaming Drift Detection (River, Flink ML)
- **What:** Online learning with incremental model updates as data distributions shift, without full retraining.
- **Key insight:** For streaming systems, batch retraining is too slow. Models should incrementally update as distributions shift. River and Flink ML provide operators for this.
- **Cortex relevance:** **HIGH.** Our routing model should incrementally update, not retrain from scratch. This aligns with our bandit approach (bandits naturally update incrementally).

### 6.3 Model Quality Monitoring Architecture
- **Key decision:** Real-time vs. periodic batch monitoring. Real-time for high-risk, batch for routine.
- **Key challenge:** Monitoring systems detect drift but lack integration with retraining/adaptation workflows. Most operate in silos.
- **Cortex relevance:** **HIGH.** We should build drift detection INTO the routing pipeline, not as a separate monitoring system. The router should automatically recalibrate when it detects drift, not just alert a human.
- **Validates:** Our adaptive routing concept in auto mode. **Extends:** We need formal drift detection, not just failure-count heuristics.

---

## 7. Intent Decomposition

### 7.1 HiPlan: Hierarchical Planning with Adaptive Global-Local Guidance
- **Paper:** [arXiv:2508.19076](https://arxiv.org/abs/2508.19076) (August 2025)
- **What:** Combines global milestone guides (coarse strategy) with local stepwise hints (fine-grained guidance), leveraging a retrieval-augmented milestone library built from expert trajectories.
- **Key insight:** Dual-granularity guidance: global milestones prevent drift, local hints provide actionable next steps. The milestone library is built from past successful trajectories, so the system gets better over time.
- **Cortex relevance:** **HIGH.** Our Ship Captain should maintain a milestone library from past successful executions. For new tasks, retrieve similar past milestones as planning guidance.

### 7.2 GoalAct: Global Planning with Hierarchical Execution
- **Paper:** [arXiv:2504.16563](https://arxiv.org/abs/2504.16563) (NCIIP 2025 Best Paper)
- **What:** Continuously updated global planning + hierarchical execution (high-level skills like searching, coding, writing).
- **Key insight:** Decompose execution into skill categories, reducing planning complexity. The global plan updates continuously as new information arrives.
- **Cortex relevance:** **HIGH.** Our agent templates (explorer, fixer, reviewer, tester) ARE skills. GoalAct's continuously-updating global plan is what our Ship Captain should do -- re-plan after each step completes.
- **Validates:** Our agent template approach and Ship Captain's iterative execution.

### 7.3 HTN Planning with LLM-Generated Heuristics
- **Paper:** [arXiv:2605.07707](https://arxiv.org/abs/2605.07707) (May 2026)
- **What:** Classical HTN planners augmented with LLM-generated heuristics. Iterative refinement uses empirical results and auto-generated guidance keyed to failure modes.
- **Key insight:** Hybrid classical+LLM planning: the HTN planner ensures logical soundness while the LLM provides domain-specific heuristics. When plans fail, the system generates guidance specific to the observed failure mode.
- **Cortex relevance:** **MEDIUM-HIGH.** We could implement a lightweight HTN planner in Rust for task decomposition, using LLM calls only for domain-specific heuristic generation. This gives us structured decomposition with adaptive refinement.

### 7.4 TMS: Thought Management System
- **What:** Hierarchical goal decomposition with self-critique modules that iteratively evaluate progress and refine decisions.
- **Key insight:** The self-critique loop: decompose -> execute step -> critique result -> refine remaining plan. This continuous refinement catches errors early.
- **Cortex relevance:** **HIGH.** Maps directly to our Ship Captain's self-healing mechanism. The self-critique module is our quality gate, and the refinement loop is our retry logic.

---

## 8. Evidence Provenance in AI

### 8.1 Topaz: Explainable Model Routing for Agentic Workflows
- **Paper:** [arXiv:2604.03527](https://arxiv.org/abs/2604.03527) (April 2026)
- **What:** Replaces silent model assignments with an inherently interpretable router using skill-based profiling, traceable routing algorithms, and natural-language explanations.
- **Key insight:** Routing decisions should be INHERENTLY interpretable, not explained post-hoc. Topaz uses skill-based model profiles (each model has a skill vector) and the routing algorithm produces a trace that can be translated to natural language: "Selected Model X because the query requires [skill] and X scores 0.92 on [skill] while being 3x cheaper than Y."
- **Cortex relevance:** **CRITICAL.** We should build skill-based model profiles into Cortex. Every routing decision should produce a human-readable explanation. This is essential for debugging, trust, and compliance.
- **Validates:** Our decision logging approach. **Extends:** We need structured skill profiles, not just model names.

### 8.2 Enterprise Audit Trail Architecture
- **Key components:** Decision events, context (prompt/policy versions), human overrides, secure evidence storage.
- **Key statistic:** Firms with robust audit architectures report 40-60% faster regulatory response cycles.
- **Cortex relevance:** **MEDIUM-HIGH.** Our decisions.jsonl is a primitive audit trail. We need: (1) structured decision events with full context, (2) immutable append-only storage, (3) query capability for "why was model X chosen for query Y?"

### 8.3 Cell-Level Lineage
- **What:** Track provenance at the individual data element level, not just pipeline level.
- **Cortex relevance:** **MEDIUM.** For each token/response, we should be able to trace: which model produced it, what prompt it received, what context was available, and what alternatives were considered.

---

## 9. Cost-Quality Pareto Optimization

### 9.1 CSCR (Cost-Spectrum Contrastive Routing) -- Details
- See Section 1.10 above. NeurIPS 2025 Spotlight.
- **Pareto-specific insight:** The Cost-Spectrum InfoNCE objective explicitly targets the accuracy-cost Pareto frontier. Adaptive cost bands mean the router learns different tradeoff strategies at different price points.
- **Performance:** Up to 25% higher accuracy-cost efficiency. Generalizes to unseen models and OOD prompts.
- **Implementation note:** FAISS k-NN lookup for microsecond routing. [GitHub](https://github.com/rezashkv/cscr)

### 9.2 LLMRec: Recommendation-Style Model Routing
- **What:** Treats model selection like a recommendation problem with a cost-budget-based Pareto metric.
- **Key insight:** Framing routing as recommendation (collaborative filtering over query-model interactions) enables leveraging decades of RecSys research. Achieves >38% average cost reduction while maintaining accuracy.
- **Cortex relevance:** **MEDIUM-HIGH.** Collaborative filtering could work well for routing: "users with similar queries found Model X best." We could maintain a query-model interaction matrix and use matrix factorization for routing.

### 9.3 Cross-Attention Routing: One Head, Many Models
- **Paper:** [arXiv:2509.09782](https://arxiv.org/abs/2509.09782) (September 2025)
- **What:** Single cross-attention head that attends over model descriptions to produce routing decisions.
- **Key insight:** The router learns to attend to model-specific properties (cost, latency, capability descriptions) via cross-attention, making it naturally extensible to new models without retraining.
- **Cortex relevance:** **MEDIUM.** Interesting attention-based alternative to our embedding approach. The cross-attention over model descriptions is elegant but may be over-engineered for our use case.

### 9.4 Front-Door Routing with Small Language Models
- **Paper:** [arXiv:2604.02367](https://arxiv.org/abs/2604.02367) (April 2026)
- **What:** Evaluates small LMs as front-door routers with synthetic traffic experiments.
- **Key insight:** A small, cheap model can serve as an effective difficulty classifier / router, dramatically reducing cost by only escalating to expensive models when needed.
- **Cortex relevance:** **HIGH.** We could use a small local model (or even a rule-based system) as a fast front-door classifier, only calling the LLM-based router for ambiguous cases. This is a two-level routing cascade.

---

## 10. Novel / Surprising Approaches

### 10.1 Prompt-Specific Preference Routing
- **What:** Trains an LLM to output Bradley-Terry coefficient vectors predicting human preference votes for each prompt.
- **Key insight:** Rather than routing based on benchmarks, route based on predicted human preference. Each prompt gets its own preference distribution over models.
- **Cortex relevance:** **HIGH.** This is a fundamentally different signal than accuracy -- it captures what humans actually prefer, which includes factors like style, verbosity, and helpfulness that benchmarks miss.

### 10.2 Expert Orchestration via Jury Theorems
- **What:** Applies Condorcet's jury theorem to prove ensemble/multi-model routing analytically outperforms monoliths.
- **Key insight:** Mathematical proof that routing to specialists beats a single generalist, given sufficient diversity in the model pool. This provides theoretical backing for our multi-provider architecture.
- **Cortex relevance:** **HIGH theoretical validation.** Our dual-brain architecture (Claude + GPT) is analytically justified by jury theorems -- diverse providers reduce correlated errors.

### 10.3 Learning to Route from Bandit Feedback (Online, No Labels)
- **Paper:** [arXiv:2510.07429](https://arxiv.org/abs/2510.07429) (October 2025)
- **What:** Routes LLMs using only bandit feedback (was the response good/bad?) without requiring response labels from all models.
- **Key insight:** You don't need to query all models to learn routing -- partial feedback (bandit setting) is sufficient. This is much cheaper than supervised approaches that need labels from every model.
- **Cortex relevance:** **CRITICAL.** This is exactly our production setting -- we only see the reward for the model we actually chose. The bandit formulation is correct for our use case, not supervised learning.
- **Validates:** Our entire bandit-based design philosophy.

### 10.4 Cross-Layer Optimization for Multi-Workflow Systems
- **What:** Exposes internal workflow/task graphs for global visibility, co-location, joint multi-workflow scheduling, and statistical multiplexing.
- **Key insight:** When running multiple workflows simultaneously, optimizing each independently is suboptimal. Cross-layer optimization considers all workflows jointly, enabling resource sharing and reducing redundant computation.
- **Cortex relevance:** **MEDIUM-HIGH.** When multiple users or tasks are being processed simultaneously, Cortex should consider the global workload, not just individual requests. Statistical multiplexing of model capacity across workflows reduces cost.

### 10.5 Self-Awareness Training for LLMs
- **From DiSRouter.** Two-stage pipeline: SFT teaches the model factual self-knowledge, RL refines calibration.
- **Key insight:** LLMs can be trained to accurately assess their own competence on specific query types. Self-awareness outperforms external BERT-based classifiers.
- **Cortex relevance:** **MEDIUM.** If model providers start publishing self-awareness capabilities, we can use them as routing signals. Until then, we need external estimation.

### 10.6 Market Context: Martian at $1.3B Valuation
- Martian (first commercial LLM router) approaching $1.3B valuation. Accenture invested and is integrating Martian into enterprise services. Cuts costs 20-97% while often beating GPT-4 on benchmarks.
- **Cortex relevance:** **Market validation.** LLM routing is now a billion-dollar category. Our approach of building routing into the application layer (Cortex) rather than as a separate service is differentiated from Martian/Not Diamond's SaaS approach.
- By 2028, IDC projects 70% of top AI-driven enterprises will use multi-model architectures with dynamic routing.

---

## Synthesis: What This Means for Cortex

### Design Validations
1. **Bandit-based routing is correct.** Multiple papers (MixLLM, PILOT, ParetoBandit) confirm contextual bandits as the right framework.
2. **Tier escalation is correct.** Cascade routing formalizes what we're already doing.
3. **Dual-provider diversity is analytically justified** by jury theorems.
4. **HEAD constitution's "think before acting" is validated** by Router-R1's interleaved think/route pattern.
5. **Agent templates map to GoalAct's skill decomposition.**

### Design Challenges / Required Changes
1. **Quality estimators are THE critical component** (cascade routing paper). We need dedicated quality estimation, not ad-hoc heuristics.
2. **Reasoning models degrade abstention by 24%.** We CANNOT trust model self-reported confidence. External estimation is mandatory.
3. **Static budget windows are inferior** to ParetoBandit's closed-loop primal-dual control.
4. **Single-model routing is limiting.** BEST-Route shows routing should also control sampling strategy. Router-R1 shows multi-round routing outperforms single-shot.
5. **We need formal drift detection,** not just failure-count heuristics. Conformal prediction gives mathematical guarantees.
6. **Shapley credit assignment is needed** for pipeline attribution but requires approximation for real-time use.

### Priority Implementation Order for Cortex

| Priority | Component | Source | Effort |
|----------|-----------|--------|--------|
| P0 | Quality estimators (cascade routing trigger) | Cascade Routing, CSCR | Medium |
| P0 | Closed-loop budget pacer (primal-dual) | ParetoBandit | Medium |
| P0 | Conformal prediction for confidence bounds | TECP, Survey | High |
| P1 | Cost-spectrum contrastive embeddings (k-NN routing) | CSCR | High |
| P1 | Preference-prior warm start (cold-start fix) | PILOT | Medium |
| P1 | Sliding-window Thompson Sampling (non-stationarity) | SW-TS literature | Medium |
| P1 | Skill-based model profiles + explainable routing | Topaz | Medium |
| P2 | Multi-round routing (think-then-route) | Router-R1 | High |
| P2 | Change-point detection (Catoni-style for heavy tails) | Catoni bandits | Medium |
| P2 | Shapley credit assignment (pipeline attribution) | SHARP | High |
| P2 | Milestone library for planning (retrieval-augmented) | HiPlan | Medium |
| P3 | Domain-aware query tagging (unsupervised) | MixLLM | Medium |
| P3 | Cross-workflow statistical multiplexing | Cross-layer opt | High |
| P3 | Hot-swap model registry with forced exploration | ParetoBandit | Low |

### Novel Competitive Advantages for Cortex
1. **Rust-native k-NN routing** at microsecond latency (CSCR approach in Rust with our own HNSW index).
2. **Conformal prediction gates** -- mathematically guaranteed confidence rather than heuristic scores.
3. **Causal credit assignment** -- know exactly which pipeline stage caused success/failure.
4. **Restless bandit formulation** -- models that account for provider evolution even when not queried.
5. **Cascade routing with quality estimators** -- unified routing + escalation strategy.
6. **Self-calibrating drift detection** built into the routing loop, not a separate monitoring system.

---

## Key Papers Reference List

| Paper | Year | Area | Relevance |
|-------|------|------|-----------|
| [ParetoBandit](https://arxiv.org/abs/2604.00136) | 2026 | Routing + Bandits | Critical |
| [CSCR](https://arxiv.org/abs/2508.12491) | 2025 | Cost-Quality Pareto | Critical |
| [Cascade Routing](https://arxiv.org/abs/2410.10347) | 2024 | Routing + Cascading | Critical |
| [Topaz](https://arxiv.org/abs/2604.03527) | 2026 | Explainable Routing | Critical |
| [AbstentionBench](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00754/131566/) | 2025 | Confidence Calibration | Critical |
| [PILOT](https://arxiv.org/abs/2508.21141) | 2025 | Bandit Routing | High |
| [Router-R1](https://arxiv.org/abs/2506.09033) | 2025 | RL Routing | High |
| [MixLLM](https://arxiv.org/abs/2502.18482) | 2025 | Bandit Routing | High |
| [BEST-Route](https://arxiv.org/abs/2506.22716) | 2025 | Adaptive Routing | High |
| [Route-to-Reason](https://arxiv.org/abs/2505.19435) | 2025 | Routing + Reasoning | High |
| [xRouter](https://arxiv.org/abs/2510.08439) | 2025 | RL Routing | High |
| [DiSRouter](https://arxiv.org/abs/2510.19208) | 2025 | Distributed Routing | Medium-High |
| [SHARP](https://arxiv.org/abs/2602.08335) | 2026 | Credit Assignment | High |
| [HiPlan](https://arxiv.org/abs/2508.19076) | 2025 | Planning | High |
| [GoalAct](https://arxiv.org/abs/2504.16563) | 2025 | Planning | High |
| [RouterArena](https://arxiv.org/abs/2510.00202) | 2025 | Benchmarking | High |
| [Survey: Dynamic Routing](https://arxiv.org/abs/2603.04445) | 2026 | Survey | Reference |
| [Catoni Change-Point](https://arxiv.org/abs/2505.20051) | 2025 | Non-Stationary Bandits | High |
| [SW-Whittle](https://arxiv.org/abs/2506.18186) | 2025 | Restless Bandits | Medium-High |
| [Conformal Prediction Survey](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00715/125278/) | 2025 | Confidence | High |
| [ToKUR](https://arxiv.org/abs/2505.11737) | 2025 | Token Uncertainty | High |
| [Uncertainty Propagation](https://arxiv.org/abs/2604.23505) | 2026 | Multi-Step Uncertainty | High |

---

*Research compiled May 19, 2026. Sources verified via arXiv, ACL Anthology, OpenReview, NeurIPS proceedings, and industry publications.*
