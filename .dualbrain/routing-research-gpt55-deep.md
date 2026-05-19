I searched broadly across papers, framework docs, production writeups, and recent preprints. The main pattern: Cortex should be less like a static “prompt classifier -> model” router and more like a closed-loop control system with typed task decomposition, online learning, calibrated escalation, provenance, and budget/rate-limit constraints in the same decision loop.

**1. Latest LLM Routing Papers**
| Source | Key Insight | Cortex Application | Design Impact |
|---|---|---|---|
| [BEST-Route: Adaptive LLM Routing with Test-Time Optimal Compute](https://www.microsoft.com/en-us/research/publication/best-route-adaptive-llm-routing-with-test-time-optimal-compute/) | Instead of choosing one cheap or expensive model, generate multiple cheap-model candidates and select the best when that beats one frontier call. | For coding tasks, Cortex could try `N` cheap attempts plus verifier before escalating to Claude/GPT/Gemini top tier. | Challenges one-call routing; validates compute-as-a-variable routing. |
| [A Unified Approach to Routing and Cascading for LLMs](https://huggingface.co/papers/2410.10347) | Routing and cascading are complementary; quality estimators are the critical ingredient. | Cortex should model “which model first” and “when to escalate” jointly, not as separate heuristics. | Strongly validates cascade routing. |
| [Universal Model Routing for Efficient LLM Inference](https://huggingface.co/papers/2502.08773) | Routers should generalize to new, unseen models at test time. | Cortex should onboard new provider models with metadata, probes, embeddings, and forced exploration rather than retraining from scratch. | Challenges fixed model pools. |
| [Route to Reason: Adaptive Routing for LLM and Reasoning Strategy Selection](https://huggingface.co/papers/2505.19435) | Route across both model and reasoning strategy. | Coding jobs should choose model plus strategy: direct patch, planning first, test-first, multi-agent review, etc. | Expands Cortex from model router to strategy router. |
| [RouteNLP: Closed-Loop LLM Routing with Conformal Cascading and Distillation Co-Optimization](https://arxiv.org/abs/2604.23577) | Difficulty-aware routing, conformal cascade thresholds, and retraining from escalation failures. | Store failed cheap-model attempts, cluster them, and use them to calibrate or fine-tune cheaper specialists. | Validates self-calibration, but challenges any design without failure clustering. |

**2. Multi-Agent Orchestration**
| Source | Key Insight | Cortex Application | Design Impact |
|---|---|---|---|
| [LangGraph](https://www.langchain.com/langgraph) | Production agent systems emphasize explicit state, control flow, debugging, and multi-actor workflows. | Cortex should keep orchestration deterministic where possible: graph nodes, typed transitions, replayable state. | Validates graph/runtime approach over free-form agent chat. |
| [MasRouter: Learning to Route LLMs for Multi-Agent System](https://aclanthology.org/anthology-files/pdf/acl/2025.acl-long.757.pdf) | Multi-agent routing includes collaboration topology, agent count, role allocation, and per-agent LLM choice. | Cortex should decide whether a coding task needs solo agent, planner+executor, reviewer, test fixer, or parallel specialists. | Challenges simple provider selection. |
| [Gradientsys: A Multi-Agent LLM Scheduler with ReAct Orchestration](https://huggingface.co/papers/2507.06520) | Scheduling agents with typed context improves task success and latency. | Add scheduler-level decisions: queue priority, parallelism, tool permissions, and provider allocation. | Validates treating orchestration as scheduling. |
| [HALO](https://huggingface.co/papers/2505.13516) | Hierarchical planning, role design, and MCTS search improve expert tasks. | For hard coding tasks, Cortex can search over decomposition/workflow candidates before spending frontier tokens. | Challenges static workflows. |

**3. Reward Attribution And Causal Inference**
| Source | Key Insight | Cortex Application | Design Impact |
|---|---|---|---|
| [Asynchronous Credit Assignment for MARL](https://arxiv.org/abs/2408.03692) | Real systems act asynchronously; credit assignment must account for dependencies between staggered actions. | Cortex traces should assign reward to model call, tool call, retry, review, and escalation decisions separately. | Challenges end-to-end-only scoring. |
| [MACCA: Offline MARL with Causal Credit Assignment](https://openreview.net/forum?id=q4j90OcaEI) | Offline logs can support causal credit assignment when live experimentation is risky. | Use historical Cortex traces to estimate “what if we had escalated earlier?” or “what if Gemini handled test repair?” | Validates offline replay and counterfactual eval. |
| [Shapley Counterfactual Credits for MARL](https://arxiv.org/abs/2106.00285) | Shapley-style marginal contribution handles teams of agents. | Attribute success among planner, coder, reviewer, and test-runner agents without over-crediting the final responder. | Useful for self-calibration metrics. |
| [Contextual Counterfactual Credit Assignment for Multi-Agent RL in LLM Collaboration](https://arxiv.org/abs/2603.06859) | LLM collaboration needs contextual counterfactual attribution. | Cortex should compare similar task contexts, not global averages, when learning provider strengths. | Challenges naive win-rate leaderboards. |

**4. Confidence Calibration And Human Input**
| Source | Key Insight | Cortex Application | Design Impact |
|---|---|---|---|
| [Generalized Correctness Models](https://huggingface.co/papers/2509.24988) | Historical correctness patterns beat model self-introspection for confidence. | Train a Cortex correctness predictor on past coding outcomes, tests, review results, and user acceptances. | Challenges “ask the model how confident it is.” |
| [Unsupervised Confidence Calibration for Reasoning LLMs](https://arxiv.org/abs/2604.19444) | Offline self-consistency can train lightweight deployment-time confidence predictors. | Use sampled historical tasks to build cheap confidence heads for routing and escalation. | Validates low-latency confidence estimation. |
| [Calibrating LLMs with Sample Consistency](https://ojs.aaai.org/index.php/AAAI/article/view/34120) | Multiple samples improve calibration but cost more. | Use sampling only at decision boundaries: risky code edits, failing tests, high-value tasks. | Validates selective sampling. |
| [When Can We Trust LLM Graders?](https://arxiv.org/abs/2603.29559) | High-confidence automated judging, low-confidence human review. | Human-in-loop should be thresholded by calibrated uncertainty, not by task size alone. | Validates selective automation. |

**5. Self-Healing And Adaptive Systems**
| Source | Key Insight | Cortex Application | Design Impact |
|---|---|---|---|
| [AWS: Detecting drift in production GenAI apps](https://docs.aws.amazon.com/fr_fr/prescriptive-guidance/latest/gen-ai-lifecycle-operational-excellence/prod-monitoring-drift.html) | Track prompt embedding drift and concept drift separately. | Cortex should monitor task mix drift and outcome drift per provider/model. | Validates drift dashboards. |
| [Adaptive Monitoring and Real-World Evaluation of Agentic AI Systems](https://arxiv.org/abs/2509.00115) | EWMA thresholds plus joint anomaly detection reduce detection latency and false positives. | Use rolling baselines for success rate, latency, cost, retries, test failures, and user correction rate. | Challenges static alert thresholds. |
| [QSAF: Cognitive Degradation in Agentic AI](https://arxiv.org/abs/2507.15330) | Agent degradation is a runtime vulnerability class. | Add circuit breakers for looping, stale assumptions, excessive retries, and degraded provider behavior. | Validates self-healing controls. |
| [DriftDune](https://driftdune.ai/) | Semantic diffs of LLM outputs catch silent provider/prompt drift. | Maintain canary coding tasks per model/provider and compare output behavior over time. | Validates canary evals before rollout. |

**6. Intent Decomposition**
| Source | Key Insight | Cortex Application | Design Impact |
|---|---|---|---|
| [TDAG](https://www.sciencedirect.com/science/article/pii/S0893608025000796) | Dynamic task decomposition and agent generation adapt to complex tasks. | Cortex can generate task-specific agents only when decomposition predicts payoff. | Challenges fixed agent roster. |
| [DELTA](https://delta-llm.github.io/) | LLM decomposition plus formal planning language improves long-horizon planning. | Represent coding work as dependency DAG: inspect, edit, test, fix, review. | Validates explicit plan structures. |
| [ReAcTree](https://arxiv.org/abs/2511.02424) | Dynamic agent trees help long-horizon tasks. | Use tree-shaped execution for complex refactors: parent planner, child implementers, verifier. | Validates hierarchical routing. |
| [DART-LLM](https://huggingface.co/papers/2411.09022) | DAG dependencies matter for multi-actor execution. | Do not parallelize coding agents unless dependency graph says edits are disjoint. | Challenges blind parallelism. |

**7. Evidence Graphs And Provenance**
| Source | Key Insight | Cortex Application | Design Impact |
|---|---|---|---|
| [PROV-AGENT](https://arxiv.org/abs/2508.02866) | Extends W3C PROV for agent prompts, responses, decisions, and downstream outcomes. | Cortex should log every routing decision as provenance: task features, candidates, selected model, confidence, budget state, result. | Strongly validates evidence graph design. |
| [Audit Trails for Accountability in LLMs](https://arxiv.org/abs/2601.20727) | Tamper-evident lifecycle ledger connects models, data, evals, deployments, approvals. | Cortex should support replay and “why did we route this to Claude?” queries. | Challenges opaque router updates. |
| [GE-Chat](https://www.ijcai.org/proceedings/2025/1256) | Graph-enhanced RAG improves evidence-based responses. | For coding, connect claims to files, tests, logs, docs, and model decisions. | Validates evidence-backed execution. |
| [BAXDT](https://www.sciencedirect.com/science/article/abs/pii/S0950705125014418) | Decision traces can combine model output, explanation, context, and validation. | Store routing explanations as structured traces, not free-text logs only. | Validates audit-grade traces. |

**8. Bandit Algorithms For Model Routing**
| Source | Key Insight | Cortex Application | Design Impact |
|---|---|---|---|
| [Adaptive LLM Routing under Budget Constraints](https://arxiv.org/abs/2508.21141) | Contextual bandit with shared query/model embeddings and knapsack budget policy. | Cortex should use LinUCB/Thompson-style online learning seeded by offline evals. | Strongly validates self-calibration. |
| [Online Multi-LLM Selection via Contextual Bandits](https://arxiv.org/abs/2506.17670) | Handles multi-step query refinement and unstructured prompt evolution. | Useful for coding sessions where task context changes after inspection or test failures. | Challenges one-shot routing. |
| [LLM Routing with Dueling Feedback](https://papers.cool/arxiv/2510.00841) | Pairwise preference feedback can train routers without absolute labels. | Compare two candidate strategies on shadow tasks or eval suites. | Validates pairwise evaluation. |
| [ParetoBandit](https://arxiv.org/abs/2604.00136) | Budget-paced contextual bandits adapt to non-stationary price/quality shifts. | Cortex should enforce dollar/token budgets in the learning loop, not after routing. | Challenges budget-as-monitor-only. |

**9. Subscription-Based Rate Limiting**
| Source | Key Insight | Cortex Application | Design Impact |
|---|---|---|---|
| [Redis rate limiting guide](https://redis.io/tutorials/howtos/ratelimiting/) | Sliding window, token bucket, leaky bucket each fit different needs; Lua keeps updates atomic. | Use Redis-backed token buckets per provider, subscription, org, model, and task class. | Validates Redis L2 control plane. |
| [Redis token bucket docs](https://redis.io/docs/latest/develop/use-cases/rate-limiter/nodejs/) | Shared global/per-user keys support distributed quotas. | Cortex can pool subscriptions while preventing one tenant/task class from consuming all quota. | Validates hierarchical keys. |
| [Centrifugo distributed rate limit API](https://centrifugal.dev/docs/pro/distributed_rate_limit) | Millisecond-precision distributed token buckets can be parameterized per request. | Route only to providers with available near-term capacity; otherwise queue, downgrade, or cascade. | Challenges retry-only handling. |
| [Novu variable-cost token bucket](https://docs.novu.co/api-reference/rate-limiting) | Different operations can consume different token costs. | Charge routing decisions by expected tokens, model tier, parallelism, and retry risk. | Important for pooled API subscriptions. |

**10. Novel Approaches**
| Source | Key Insight | Cortex Application | Design Impact |
|---|---|---|---|
| [Router-R1](https://arxiv.org/abs/2506.09033) | The router itself is an LLM trained with RL to think, call models, aggregate, and route again. | Cortex could reserve an LLM-router for ambiguous/high-value tasks, while cheap deterministic routers handle normal cases. | Challenges purely classifier-based routing. |
| [AlphaEvolve](https://arxiv.org/abs/2506.13131) | Evolutionary loops improve code/algorithms using LLM mutation plus evaluators. | Use evolutionary search for hard coding tasks with strong tests or benchmarks. | Validates evaluator-driven self-improvement. |
| [CodeEvolve](https://arxiv.org/abs/2510.14150) | Open-source evolutionary coding agent with modular LLM orchestration. | Cortex could evolve prompts, repair strategies, or provider policies against internal benchmarks. | Challenges manually tuned prompts. |
| [EvoAgentX](https://aclanthology.org/anthology-files/pdf/emnlp/2025.emnlp-demos.47.pdf) | Evolves agentic workflows themselves. | Let Cortex mutate workflow graphs and keep winners by task family. | Big edge if safely sandboxed. |
| [ORCH: EMA-guided deterministic orchestration](https://pmc.ncbi.nlm.nih.gov/articles/PMC12907423/) | Lightweight moving-average routing can be reproducible and practical. | Pair Cortex’s bandit learner with deterministic fallback policies for auditability. | Validates simple baselines alongside ML routing. |

**Most Actionable Cortex Upgrades**

1. Build a `routing_decision` ledger: task embedding, repo/task features, candidate models, rate-limit state, confidence, selected strategy, outcome, cost, latency, tests, user feedback.
2. Use contextual bandits seeded by offline evals, with forced exploration for new models and decay for provider drift.
3. Route over `(model, strategy, topology)`, not just provider: solo, cascade, multi-sample cheap, planner+executor, parallel specialists, reviewer.
4. Add calibrated escalation: cheap model first only when correctness predictor says risk is acceptable; use conformal or historical calibration.
5. Add provider canaries and drift detection: fixed coding tasks, semantic diffs, rolling EWMA anomalies.
6. Treat rate limits as first-class routing inputs: Redis token buckets, variable-cost reservations, queue/downgrade decisions.
7. Use evidence graphs to make self-calibration auditable and debuggable. The router cannot improve reliably if it cannot reconstruct why it chose an arm and what actually caused the outcome.
tokens used
