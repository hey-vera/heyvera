I’ll ground this in current papers and primary sources, then separate what can be built now in Rust from what is still research-grade. I’ll focus the search on 2024-2026 FL/DP/secure aggregation/poisoning/unlearning work and implementation availability.
I searched current sources through May 19, 2026. Bottom line: VeraAI v1 should not try to federated-train LLMs. It should federated-learn small routing/context policies from signed receipts, with secure aggregation, user-level DP, poisoning filters, and checkpointed retraining.

**1. FL In Rust**
There is no mature Rust-native equivalent of Flower/TFF/FedML. Flower is still Python-first, with mobile/native SDKs “coming soon” including C++ docs, not Rust [Flower docs](https://flower.ai/docs/). Rust has ML building blocks: Burn is a Rust deep learning framework [Burn docs](https://docs.rs/burn), Candle is Hugging Face’s Rust ML framework [Candle GitHub](https://github.com/huggingface/candle), OpenDP has a Rust core [OpenDP GitHub](https://github.com/opendp/opendp). A crate called `rustfl` exists but should be treated as experimental until audited [Lib.rs rustfl](https://lib.rs/crates/rustfl).

Minimal viable FL for VeraAI:

- Model: small contextual bandit/logistic model, not neural FL.
- Local node stores examples: `task_type, repo_lang, error_class, context_bundle_features, chosen_model, outcome`.
- Node computes clipped sufficient statistics or gradients.
- Server aggregates only sums/counts under SecAgg + DP.
- Global policy update is deterministic Rust: ridge/logistic regression or Thompson sampling posterior update.

Model architecture:

- `routing_policy`: contextual Thompson sampling or LinUCB over arms `{model, context_recipe, tool_plan}`.
- `context_policy`: multi-label classifier predicting which context artifacts to include.
- Reward: success, eval score, latency, cost, retry count, human correction, rollback.
- Use linear/logistic models first. Neural model is RESEARCH NEEDED after >100k high-quality labeled receipts.

Nodes before FL has value:

- 10 nodes: useful only for protocol testing and cross-node sanity checks.
- 50-100 nodes: first useful aggregate patterns if each has hundreds of receipts.
- 1,000+ nodes: real federated advantage.
- 10,000 nodes: meaningful moat if consented data quality is high.

**2. DP Parameters**
Recommendation for VeraAI v1:

- Use user/node-level DP, not record-only DP.
- Start with central/distributed DP via secure aggregation, not local DP. Local DP costs too much utility.
- Target `epsilon = 2-4` per 30-day learning window, `delta <= 1 / N^1.5` or lower.
- Hard cap annual composed budget around `epsilon = 8-12` for metrics/receipts tiers.
- Raw donation should be separate consent, separate budget, and not mixed into default training.

Mechanism:

- Use clipped updates + distributed discrete Gaussian where secure aggregation is active. Kairouz, Liu, and Steinke show discrete Gaussian with SecAgg can approximate central DP accuracy with low precision [PMLR 2021](https://proceedings.mlr.press/v139/kairouz21a.html).
- Track composition with Rényi DP or zCDP internally, convert to `(epsilon, delta)` for user-facing disclosures. RDP is standard for sampled Gaussian composition [Mironov et al. SGM/RDP](https://arxiv.org/abs/1908.10530).
- TFF’s distributed DP secure aggregator uses discrete noising, compression, adaptive clipping, and SecAgg [TFF ddp_secure_aggregator](https://www.tensorflow.org/federated/api_docs/python/tff/learning/ddp_secure_aggregator).

Recent DP-FL work still points toward adaptive clipping/compression, but much is research-grade: adaptive local DP, sparsification, and communication-efficient DP-FL appear in 2024-2026 literature [FedAPCA 2024](https://www.sciencedirect.com/science/article/abs/pii/S1389128624006546), [AdaS-FLDP 2025](https://link.springer.com/article/10.1007/s11227-025-07593-0), [Fed-DPRoC 2025](https://arxiv.org/abs/2508.12978), [DDP-SA 2026](https://arxiv.org/abs/2604.07125). Treat these as RESEARCH NEEDED.

Apple/Google comparison: Apple documents local DP mechanisms and per-donation budgets [Apple DP overview](https://www.apple.com/privacy/docs/Differential_Privacy_Overview.pdf); RAPPOR is Google’s classic local-DP telemetry system [Google RAPPOR](https://research.google/pubs/pub42852). Do not copy consumer telemetry epsilon norms blindly. VeraAI’s receipts are higher sensitivity than emoji or Chrome string telemetry.

**3. Secure Aggregation**
For 10-100 nodes, simplest practical protocol:

- Round 0: coordinator selects cohort and threshold.
- Round 1: pairwise X25519 key agreement among participants.
- Round 2: each client sends masked quantized vector.
- Round 3: if dropouts occur, surviving clients reveal mask shares needed to remove dropped clients’ masks.
- Server learns only aggregate sum if threshold is met.

Use Bonawitz-style SecAgg as the baseline. It was designed for high-dimensional FL updates and dropout robustness [Bonawitz et al. 2017](https://eprint.iacr.org/2017/281). The arXiv version notes tolerance up to roughly one-third dropout [arXiv](https://arxiv.org/abs/1611.04482).

For VeraAI v1, 10-100 nodes can use a simpler threshold pairwise-mask protocol with Shamir shares. Rust implementation status: no widely trusted, drop-in Rust SecAgg library found. Implementing this is feasible but security-sensitive. RESEARCH NEEDED before production: external crypto review.

Dropouts:

- If live clients fall below threshold, abort the round.
- Never publish partial aggregates below `k` anonymity threshold.
- Keep cohort size >30 for learning rounds; for 10-node dev cohorts, mark privacy as test-only.

**4. Cold Start**
Deterministic baseline should win at first. Learned routing beats it only after enough comparable outcome data exists.

Practical timeline:

- Week 1: deterministic rules + manual context recipes win. Use bandit only for logging and shadow scoring.
- Month 1: with ~1,000-5,000 routing decisions, per-task Thompson sampling can start improving provider choice for common task classes.
- Month 6: with 50,000-500,000 receipts across many nodes, context-preparation policies should beat static recipes for common domains.

Theory: Thompson sampling has sublinear regret. Linear contextual Thompson sampling has regret bounds on the order of `~O(d sqrt(T))` or related variants depending on assumptions [Agrawal & Goyal 2013](https://proceedings.mlr.press/v28/agrawal13.html), and newer contextual TS analyses retain similar square-root behavior under noisy contexts [Entropy 2024](https://www.mdpi.com/1099-4300/26/7/606). Translation: feature dimension matters. Keep v1 feature vectors small, maybe 50-200 dimensions.

**5. Context Quality As Target**
Represent a “context preparation pattern” as an arm, not just metadata.

Example arm:

```text
task=rust_auth_bug
recipe={include: middleware, failing_test, error_log, auth_config, recent_diff}
model=haiku
tool_plan={rg_auth_paths, run_targeted_test}
```

Learnable features:

- Task: language, framework, subsystem, risk class.
- Failure: compiler/test/runtime/security/billing/auth.
- Context bundle: files included, log types, diff size, test names, docs included.
- Context quality metrics: relevance, recency, token density, duplication, missing artifact flags.
- Outcome: success, retries, eval receipt, human edit distance, time, cost.

ML approach:

- v1: contextual bandit over `(context_recipe, model)` pairs.
- v1.5: two-stage model: first predict context recipe, then choose model.
- v2: slate bandit for selecting individual context artifacts under token budget.
- v3: sequence policy for context-building steps. RESEARCH NEEDED.

This aligns with emerging “context engineering” research, which frames context as an optimized information payload rather than prompt text [Context Engineering Survey 2025](https://arxiv.org/abs/2507.13334). RAG evaluation work also supports measuring context relevance/faithfulness explicitly [RAG evaluation survey 2024](https://huggingface.co/papers/2405.07437), [RAGAS 2024](https://aclanthology.org/2024.eacl-demo.16.pdf).

**6. Poisoning Defense**
For Rust v1 without heavy ML deps:

- Clip every update.
- Reject malformed/outlier updates by norm, cosine direction, and historical drift.
- Use coordinate-wise median or trimmed mean when not using SecAgg.
- Under SecAgg, robust aggregation is harder because individual updates are hidden. Use cohort-level anomaly checks and reputation-weighted cohort selection.
- Use Soma reputation only as a prior for cohort selection and weighting eligibility, not as proof of truth.

Krum is simple but less reliable under non-IID data and adaptive attacks. FoolsGold helps against sybil-like similar gradients but needs per-client update visibility. FLTrust works well when you have a trusted reference dataset/update, but that central trust anchor may conflict with VeraAI sovereignty. Recent surveys and comparisons show no universal winner [Comparative poisoning defense study 2024](https://www.mdpi.com/2076-3417/14/22/10706), [FL anomaly defense review 2024](https://link.springer.com/article/10.1007/s10462-024-10796-1), [TPAMI attack survey 2024](https://pubmed.ncbi.nlm.nih.gov/37812561/). FLTrust-style methods remain attractive when a small public/canonical eval set exists [FLTrust paper](https://www.ndss-symposium.org/wp-content/uploads/2021-434-paper.pdf).

Recommendation: v1 uses robust stats + reputation-gated cohorts + canary evals. Strong poisoning resistance with SecAgg is RESEARCH NEEDED.

**7. Legal / Erasure**
Not legal advice, but privacy engineering stance:

- Do not train default models on raw prompts.
- Store consent ledger, receipt IDs, cohort IDs, model checkpoint lineage, and privacy budget ledger.
- Make all v1 learning checkpoint-retrainable.
- If a user revokes consent, exclude their future data immediately and retrain affected small models from checkpoints on the next scheduled window.

Machine unlearning is not settled. 2024-2026 surveys still frame full retraining as the gold standard or reference behavior, with post-hoc unlearning requiring careful validation [Machine Unlearning Comprehensive Survey 2024](https://arxiv.org/abs/2405.07406), [Stanford unlearning overview 2024](https://ai.stanford.edu/~kzliu/blog/unlearning/), [Machine Unlearning taxonomy 2026](https://www.mdpi.com/1999-5903/18/3/174). Federated unlearning exists but is still complex because the server lacks raw client data [Efficient federated unlearning 2024](https://link.springer.com/article/10.1007/s10994-024-06685-x), [Federated unlearning with RL 2025](https://www.sciencedirect.com/science/article/pii/S2214212625002017).

For VeraAI: small policy models make erasure feasible. Keep rolling checkpoints and event-sourced receipts. Avoid foundation-model fine-tuning until legal/unlearning posture is mature.

**Concrete V1**
Build this first:

- `ObservationEnvelope`: signed metadata, no raw prompt by default.
- `EvaluationReceipt`: signed outcome/eval.
- `ContextRecipe`: typed artifact-selection policy.
- `FederatedRound`: cohort, threshold, DP budget, aggregate hash.
- ML: linear contextual Thompson sampling.
- Privacy: SecAgg + clipped distributed Gaussian + RDP accountant.
- Security: cohort k-threshold, clipping, reputation gates, canary evals.
- Erasure: checkpointed retraining, no irreversible raw-data model training.

Aspirational items: decentralized foundation-model learning, ZK-verified FL, poisoning-proof SecAgg, production-grade federated unlearning. All are RESEARCH NEEDED.
