# Cortex Vision: Adversarial Stress Test (Battle Test Round 1)

**Agent:** Opus 4.7
**Date:** May 19, 2026
**Role:** Adversarial stress tester — find every weakness

---

## 1. Technical Feasibility

**What exists today:** 11,337 lines of Rust across 47 files in three crates (`core`, `engine`, `api`). The scorer is a 70-line function that picks the provider with the lowest pressure value -- no UCB, no bandit, no evidence feedback, no contamination tracking. The decomposer splits on text markers. The evaluator has hardcoded weight profiles. The `history_success_rate` parameter is literally always `None`. Chat works. Auth is partially wired (Clerk integration exists but no billing gate). There is one TODO in the entire codebase.

**The gap between reality and vision:** The vision document describes 5 layers, 31 signal kinds, 12 route templates, 8-factor contamination tracking, hierarchical beliefs, Thompson sampling, Nova IVC proofs, Shapley credit assignment, and a federated data marketplace. The actual code has a pressure-based scorer and a text-splitting decomposer. The ratio of vision-to-implementation is roughly 50:1 by complexity.

**What is realistic:**

- **6 months (2 engineers):** UCB scorer with SQLite evidence ledger, basic contamination flag (not 8-factor), 4 route templates, file-path risk classification, circuit breaker, CLI that routes between 2 providers. This is v0.1 with reduced scope. No teams, no delegation, no Pulse Tree, no marketplace.
- **18 months (4 engineers):** Add multi-provider with capacity tracking, basic subscription pooling (2-3 subs), cascade routing, intent decomposition for simple DAGs, confidence-based autonomy gates, VS Code extension. This gets to a usable v0.3.
- **3 years (8+ engineers):** Mature evidence graph, hierarchical beliefs, team features, editor integrations, maybe Cortex Insights if there is enough data. The marketplace, Nova IVC, and federated intelligence remain aspirational.

**What breaks first:** The intent decomposer. Turning "fix the auth bug and write tests" into a correct typed DAG with proper dependency edges requires an LLM call that is itself expensive, slow, and unreliable. The vision assumes decomposition is a solved problem. It is not. Bad decomposition poisons everything downstream -- the scheduler, the routing, the evidence attribution. A wrong DAG that routes a search agent when it should route an execute agent wastes the user's subscription tokens and creates misleading evidence.

## 2. The "Emerging Intelligence" Claim

**What it actually means technically:** A contextual bandit accumulates observations keyed by (TaskFamily, RepoProfileBucket, RiskClass, ModelId, StrategyId). Over time, UCB exploration decreases and exploitation increases. The system converges on which model-template pair works best for which task shape in which repo context.

**This is real but mundane.** It is a multi-armed bandit. Every recommendation system on the internet uses this. Calling it "emerging intelligence" is marketing language for "we log outcomes and update weights." It is correct to say the system improves with data. It is misleading to compare it to a "cerebral cortex" or claim it develops "consciousness of its own performance."

**Cold start numbers:** UCB with 5 task families, 3 risk classes, 4 models, and 4 templates creates a 240-arm space. At a minimum of 20 observations per arm for stable estimates, that is 4,800 tasks before the learner has meaningful coverage. A solo developer running 10 tasks per day needs 480 days -- over 16 months -- to populate the belief space. A 10-person team running 100 tasks per day needs 48 days. The cold start problem is severe for individuals and manageable for teams, but the vision targets individuals first.

**The honest assessment:** For the first 3-6 months of individual use, Cortex's "learning" will be indistinguishable from random. The system will need strong global priors (seeded from public benchmarks) to provide any value during cold start. The PILOT preference-prior initialization cited in the vision is the right approach, but implementing it correctly is itself a research problem.

**What makes it NOT a self-improving cognitive system:** The learner does not modify its own architecture, discover new task families, create new route templates, or develop novel strategies. It adjusts weights within a fixed schema. This is optimization, not cognition. The paradigm-vision document's claims about "dream states" and "predictive pre-computation" are speculative features that require the team to solve problems that Google Brain-scale teams have not solved.

## 3. Three-Mode Architecture

**The conflict:** Sovereign mode means Cortex owns the full pipeline. Delegated Agent mode means Cortex is subordinate to an external orchestrator. Skill mode means Cortex is one tool among many. These are three fundamentally different trust models:

- In Sovereign mode, Cortex manages the user's subscriptions directly.
- In Delegated mode, Cortex receives delegation keys from outside -- but the 5-layer architecture assumes Cortex IS the policy gate. Who controls policy when Cortex is delegated?
- In Skill mode, "Hey data, use Cortex to code my project" means HeyData owns the intent decomposition. But Cortex's Layer 1 IS intent decomposition. Does Cortex re-decompose what HeyData already decomposed?

**Abstraction leaks:**

1. **Evidence ownership:** In Sovereign mode, evidence belongs to the user's local ledger. In Skill mode, does evidence belong to HeyData's context or Cortex's? If both, you have consistency problems. If one, the other loses learning capability.
2. **Dial semantics:** In Sovereign mode, the user controls the dial. In Delegated mode, the external orchestrator sets the resource envelope. The dial becomes a mapping layer on top of someone else's constraints, not a direct control.
3. **Subscription routing:** In Skill mode, whose subscriptions does Cortex route through? The HeyData user's? Cortex's pool? This changes the entire capacity tracker.

**Prediction:** The team will build Sovereign mode. The other two will be API compatibility layers bolted on later, not first-class modes. They will work for simple cases and break for complex ones (multi-agent, high-dial, cross-provider).

## 4. Competitive Moat Durability

**How long does the advantage last if Cursor decides to add learning-based routing?** Six months. Cursor has 10x the engineering team, 100x the user base generating evidence data, and existing IDE integration. Their cold start problem is solved on day one because they already have millions of completions with outcome signals (acceptance rate, undo rate, test pass rate after edit).

**The data moat is empty.** The a16z "Empty Promise of Data Moats" analysis applies directly. Cortex's evidence graph is valuable only if it accumulates faster than competitors can build their own. Cursor processes millions of coding tasks per day. Cortex will process hundreds or thousands. The per-user learning (my repo, my patterns) is defensible but low-value because it does not transfer. The aggregate learning (which model is best for Python Django bug fixes) is high-value but exactly what Cursor could build in a quarter with their existing telemetry.

**What IS defensible (honestly):**

1. **Cross-provider routing.** Cursor will never route to Anthropic. Copilot will never route to Google. Provider-owned tools have structural conflicts of interest. Cortex's independence is real and valuable for the small but real market of teams that want multi-provider arbitrage.
2. **Soma Delegation.** No competitor has scoped agent authority. But no competitor needs it yet because they do not run multi-agent pipelines with spend caps. By the time multi-agent is standard (12-18 months), someone will have built something equivalent.
3. **Subscription pooling.** Genuinely novel. Teams paying for multiple provider subscriptions want unified capacity management. This is a feature, not a moat.

**Honest moat lifespan:** 12-18 months for cross-provider routing. 6-12 months for everything else. This is a window, not a wall.

## 5. Revenue Model Viability

**The core problem:** Users bring their own subscriptions. Cortex does not charge per-token, per-request, or per-seat for the routing itself (v0.1-v0.3 are free). Revenue comes from:

1. **Team subscriptions ($20/user/month):** Target of 500 teams x 5 users x $20 = $50K/month by month 15. This requires selling to teams, which requires a sales motion, which requires people who are not writing Rust code. With 2-4 engineers, who is selling?
2. **Cortex Insights ($50/month):** Requires enough opt-in users generating enough evidence to produce statistically meaningful routing recommendations. The privacy constraints correctly identified in the vision document mean rare task shapes (the most valuable ones) cannot be sold. Common task shapes have free benchmarks.
3. **x402 marketplace take-rate (5%):** Requires a marketplace. Requires providers. Requires volume. This is year 2+ at best.

**Revenue reality check:** $50K/month by month 15 requires 2,500 paying team users. To get 2,500 paying users you need roughly 25,000 free users (10% conversion). To get 25,000 free users of a CLI tool for AI-assisted development, you need either massive organic virality or paid acquisition. With no marketing budget and no dedicated sales team, this is extremely optimistic.

**The HeyData skill revenue:** If HeyData achieves meaningful scale and Cortex is a skill within it, revenue comes from HeyData user invocations. This is real but entirely contingent on HeyData's success, which is itself unproven.

**Burn rate vs. revenue timeline:** 2-4 engineers at market rates cost $80K-$200K/month. Revenue reaches $50K/month at month 15 in the optimistic scenario. That is $1.2M-$3M burned before breakeven. Where does this money come from?

## 6. Soma/ClawNet Dependency Risk

**The dependency is structural, not optional.** Cortex's competitive narrative is built on Soma Delegation, Soma Pulse Tree, Soma Check, and ClawNet x402. Remove these and Cortex is "yet another model router" -- a market that OpenRouter, Martian, and Not Diamond already occupy.

**Specific risks:**

1. **Soma is a protocol, not a product.** The delegation endpoints exist with 23 unit tests. But unit tests are not production load. How many concurrent delegation chains can the system handle? What happens at 1,000 active agents with cascade revoke? Nobody knows because it has not been tested at scale.
2. **ClawNet x402 volume dropped 92%.** From 731K/day to 57K/day. The vision acknowledges this but treats it as "bot experimentation receded." The alternative interpretation: x402 is not finding product-market fit for organic use cases.
3. **Pulse Tree is architecture, not code.** The spec exists. The implementation does not. The spec calls for Nova IVC folding at ~50-100ms per action. In a high-dial multi-agent pipeline with 16 leaves, that is 1.6 seconds of proof overhead per run. For a tool competing on speed, this is significant.

**What happens if Soma development stalls:** Cortex loses its primary differentiator narrative. The evidence-based routing still works. The subscription pooling still works. But the "cryptographic proof of agent execution" story -- the part that justifies enterprise pricing -- disappears. Cortex becomes a well-engineered open-source routing library competing against tools with 1,000x more distribution.

## 7. The Hardest Questions

**Q1: Does evidence-based routing actually produce measurably better outcomes than static tier selection?**
Honest answer: Probably yes, but the margin may be 5-15%, not 50%. Most coding tasks are straightforward enough that the "right" model is obvious (use the strongest available model). Evidence-based routing adds the most value for edge cases -- tasks where the cheaper model would have sufficed, or where the expensive model actually fails more often. These edge cases exist but are a minority of tasks.

**Q2: Will any significant number of users opt in to anonymized telemetry for Cortex Insights?**
Honest answer: Probably not enough. Developer tools have notoriously low opt-in rates for telemetry (typically 5-15%). Developers working on proprietary code are especially reluctant. The minimum cohort thresholds for privacy mean most task shapes will have insufficient data. Cortex Insights is likely a niche product, not a revenue engine.

**Q3: Is the 1-10 dial UX actually good, or is it a complexity dump?**
Honest answer: It is a complexity dump. Most users will set it to 5 and never change it. The dial maps to 6 different subsystems (model selection, parallelism, verification, data spending, agent authority, evidence chain). No user will internalize this mapping. The useful abstraction is "fast/cheap" vs "thorough/expensive" -- a binary toggle, not a 10-point dial.

**Q4: Can subscription routing survive provider policy changes?**
Honest answer: This is an existential risk. Anthropic and OpenAI's terms of service could change tomorrow to prohibit third-party orchestration of their CLI tools. The vision mentions "ToS compliance assumed for personal single-user use; team pooling and shared subscriptions require provider policy verification before shipping." This verification has not happened. If providers block third-party orchestration, Cortex's execution model breaks entirely.

**Q5: Is the team building a product or a research platform?**
Honest answer: Right now, a research platform. The vision document references 70+ research papers, cites 15+ academic frameworks, and describes systems that would be significant contributions to the ML literature if they worked. The actual product -- routing between two providers based on pressure -- could be built in a weekend. The gap between the research ambition and the product reality is where the team's time is going.

## 8. What Should Be Cut (3 Months, 2 Engineers)

**Keep:**
- Pressure-based scorer with SQLite outcome logging (already built)
- File-path risk classification (already built in engine)
- Circuit breaker (straightforward)
- 3 route templates: SoloFast, BestSingle, ImplementThenReview
- CLI that routes between Claude and GPT
- Basic intent classification (single vs multi-step, no DAG)
- Provider health checks

**Cut everything else:**
- The entire Soma integration (Delegation, Pulse Tree, Check)
- x402 / ClawNet / marketplace / Cortex Insights
- The dial system (replace with simple: fast/balanced/thorough)
- Thompson sampling, Shapley credit, contamination tracking
- Team features, subscription pooling
- All editor integrations (CLI only)
- Nova IVC, Groth16, cryptographic proofs
- Three operating modes (Sovereign only)
- HeyData skill mode, OpenClaw delegated mode
- Federated anything

**What you ship:** A CLI tool that routes coding tasks between Claude and GPT, picks the provider with better recent success rates, runs tests after edits, and logs outcomes. If that tool makes developers measurably more productive, you have a product. If it does not, no amount of Soma Delegation or Nova IVC will save it.

## 9. Where the Vision Is Actually Strong

1. **The contamination insight is genuinely novel.** Tracking that a generated test passing against generated code is less trustworthy than a human-written test is correct, important, and absent from every competitor. This is a real intellectual contribution. Even if the 8-factor penalty table needs tuning, the concept is right.

2. **Non-selection reason tracking prevents a real failure mode.** Distinguishing "we did not pick this model because it scored low" from "we did not pick it because it was rate-limited" prevents the classic bandit trap of starving temporarily unavailable arms. This is a small detail that shows genuine systems thinking.

3. **Cross-provider routing independence is structurally defensible.** Cursor/Copilot/Claude Code will never offer this because they are owned by providers. This is a genuine market position for the team segment.

4. **The evidence floor concept is sound.** Risk class determining minimum verification regardless of user preferences is the right safety architecture. The separation of "evidence floors are invariant" from "the dial controls optional investment above the floor" is clean.

5. **The vision document itself is exceptionally well-reasoned.** The dual-brain debate process produced a document that correctly identifies its own risks, honestly assesses gaps, and proposes concrete mitigations. This level of self-awareness is rare in vision documents and suggests the team can make hard trade-off decisions when needed.

## 10. Revised Honest Assessment

**Probability that the full system (as described in the vision) ships:** 5-10%. The vision describes a product that requires 15-20 engineers, 24+ months, and several unsolved research problems (federated privacy-preserving intelligence aggregation, Nova IVC integration, enterprise compliance). With 2-4 engineers and no external funding, this is a research manifesto, not a product plan.

**Probability that a useful product (cut scope per section 8) ships:** 50-60%. A CLI tool that intelligently routes between Claude and GPT, learns from outcomes, and saves developer time is buildable by 2 engineers in 3-6 months. Whether it finds users depends on distribution, which depends on the team's ability to market a developer tool.

**Probability of finding 2,500 paying team users by month 15:** 10-15%. This requires sales motion, marketing, and product-market fit validation that has not started.

**Probability of becoming a sustainable business ($50K+/month revenue):** 15-20% within 3 years. The path is: ship a useful free tool, build community, identify which paying feature teams actually want, then sell that specific feature. Subscription pooling is the most likely revenue driver because it saves teams concrete dollars.

**Most likely failure mode:** The team spends 12-18 months building toward the full vision (evidence graphs, contamination tracking, Soma integration, marketplace infrastructure) and ships a technically impressive system that no one uses because it solves a problem most developers do not know they have. The routing improvement over "just use Claude" is real but small (10-20%). The activation energy to install Cortex, connect subscriptions, and learn the dial system exceeds the marginal benefit for most developers.

**Second most likely failure mode:** Provider policy changes. Anthropic or OpenAI explicitly prohibits third-party CLI orchestration of their consumer subscriptions. Cortex's execution model requires headless CLI sessions using the user's authenticated tooling. If providers lock this down, the entire execution layer needs to be rebuilt around direct API integration with API keys, which changes the cost model entirely and kills the "two $20 subscriptions beat one $100" value proposition.

**The survivable path:** Ship the cut-scope product (section 8). Get 100 power users. Listen to what they actually want. Build that. Forget the marketplace, the proofs, the emerging intelligence narrative, and the three operating modes until the core product has paying customers. The vision is a compass, not a roadmap. Use it for direction, not for sprint planning.
