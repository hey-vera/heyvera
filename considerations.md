# ClawNet — Future Considerations

> Ideas evaluated but deferred. Not on the roadmap — revisit when there's user demand or market shift.

---

## Full Knowledge Graph Layer

**What:** Continuously ingest data from all 163 endpoints, normalize into a persistent graph DB (e.g., Neo4j or SQLite FTS5 + JSON), expose `POST /v1/graph/query` for agents to traverse relationships.

**Why deferred:**
- ClawNet's domain is fast-changing data (crypto prices stale in 60s, social sentiment in minutes). Knowledge graphs excel at slowly-changing data (company profiles, documentation, product catalogs).
- Massive infrastructure cost — continuous ingestion across 163 endpoints = thousands of API calls/hour just to keep the graph fresh, with no revenue attached.
- Zero users currently. Building a graph before knowing what data agents actually want = guessing.
- The Context Layer (implemented) provides 80% of the value at 5% of the cost by caching per-agent query results.

**Revisit when:** Agents start making repeated cross-source queries (e.g., "show me all tokens where social sentiment is rising AND whale activity is increasing AND DeFi yield is above 10%"). That pattern = graph query, not orchestration.

**Migration path:** Context Layer entries are already structured (category, TTL, key-value). A future graph layer could ingest context entries as nodes, with edges inferred from co-occurring queries within the same agent namespace.

---

## Hierarchical Agent Spawning (coreDATA-style)

**What:** Allow skills to spawn sub-agents that invoke other skills recursively, building agent trees with budget propagation.

**Why deferred:**
- `recursive` and `self_checking` skill classes cover 90% of multi-pass use cases without the complexity of agent trees.
- Budget propagation across agent trees is a nightmare for atomicity — partial failures at depth 3+ require cascading refunds.
- Swarm system already handles multi-skill decomposition with LLM planning.

**Revisit when:** Users build complex workflows that need conditional branching mid-execution (not just parallel + sequential).

---

## Persistent Long-Running Agents

**What:** Agents that maintain state across multiple requests over hours/days (e.g., "monitor SOL price and alert me when it drops below $100").

**Why deferred:**
- Requires WebSocket/SSE connections held open for hours — SQLite WAL on a single VPS can't handle thousands of persistent connections.
- Monitoring use case better served by webhooks (already have webhook retry with backoff on tasks).
- State management across server restarts is complex.

**Revisit when:** VPS scales to multiple instances, or when agents explicitly request persistent monitoring (not just one-shot queries).

---

## Multi-Model Agent Routing

**What:** Different LLM models per query complexity — route simple queries to Haiku, complex ones to Opus, code queries to specialized models.

**Why deferred:**
- Already have two-tier LLM strategy (fast for intent, smart for synthesis).
- LLM proxy (`/v1/llm/chat`) already supports 23 models — agents can choose.
- Auto-routing adds latency (need to classify query complexity before routing).

**Revisit when:** Cost analysis shows significant savings from routing optimization (need usage data first).

---

## On-Chain Skill Registry (Solana Program)

**What:** Publish skill metadata to Solana, enabling trustless discovery and cross-platform skill invocation.

**Why deferred:**
- Gas costs for every skill publish/update.
- Discovery Trinity already has on-chain weight (15%, currently mock). Real implementation needs a deployed Solana program.
- No other agent platform reads on-chain skill registries yet — no network effect.

**Revisit when:** Multiple agent platforms exist and interop becomes a competitive advantage.

---

## Video/Media Production Skills

**What:** Skills that generate or process video, images, audio (like coreDATA's video production).

**Why deferred:**
- Massive compute requirements (GPU instances), doesn't fit single-VPS architecture.
- Credit pricing model doesn't map well (a 2-minute video render = $2-5 in GPU costs vs. 3-credit API call).
- Not aligned with ClawNet's core value prop (API orchestration for data, not media).

**Revisit when:** GPU-as-a-service APIs (Replicate, Modal) mature enough to be treated as just another endpoint in the registry.

---

## Governance Quorum Minimum

**What:** Require N active voters (or N% of active users in the past 30 days) for a proposal to be considered valid. Currently, a proposal with 1 vote FOR and 0 against auto-passes if it closes.

**Why deferred:**
- Current user count is too small to set a meaningful threshold. Any number would be arbitrary.
- Risk is low — governance proposals are advisory only (no automated execution path). EXECUTED status requires manual admin action.

**Revisit when:** Active user base reaches 500+. At that point, a quorum of 5-10% (25-50 voters) becomes achievable and meaningful.

---

## Proposal Bond (Lock Credits, Not Spend)

**What:** Lock 100 credits as a bond when creating a proposal. Credits are released when the proposal closes (CLOSED or EXECUTED). This prevents spam without permanently costing proposers anything.

**Why deferred:**
- The current balance-check-only approach (100 credits required but not deducted) allows one key with 100+ credits to spam unlimited proposals. The IP rate limiter (60/min) provides some protection.
- At current user scale, proposal spam hasn't occurred. Implementing locking adds DB complexity (locked_credits column on api_keys, lock/unlock transaction logic).

**Revisit when:** Governance spam actually occurs, or when the platform has 1000+ users and governance carries real weight.

---

## FLAGGED Skill Appeal Mechanism

**What:** A self-service endpoint where skill owners can contest a FLAGGED status — submit appeal text, notify admin, and pause the flag pending review.

**Why deferred:**
- At current scale, admin can manually clear FLAGGED status via `updateSkillSecurityStatus()` when contacted. No automation needed yet.
- False-positive rate is low (VERIFIED skills are immune; most flagging is legitimate).

**Revisit when:** There are 100+ published third-party skills and false-positive flags are causing measurable creator churn.

---

## Structured Report Categories

**What:** Replace free-text report reasons with enum categories: `security`, `spam`, `copyright`, `quality`, `misleading`. Enables faster admin triage and automated routing (e.g., security reports get Telegram alert, copyright reports get legal review queue).

**Why deferred:**
- Free text is sufficient for manual review at current scale.
- Categories require frontend changes + migration of existing report rows.

**Revisit when:** Report volume exceeds 20/week and admin triage time becomes a bottleneck.
