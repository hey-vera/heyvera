# ClawNet — Future Considerations

> Ideas evaluated but deferred. Not on the roadmap — revisit when there's user demand or market shift.
> Last updated: 2026-03-14.

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

---

## Audit Trail Request Correlation

**What:** Add a `request_id` / `orchestration_id` field to `CREDIT_DEDUCT` and `CREDIT_TOPUP` audit log entries so financial records can be directly correlated to the specific orchestration or task that caused each deduction — without relying on api_key + approximate timestamp matching.

**Why deferred:**
- Currently `deductCredit(key, amount)` is called from 10+ call sites (api.ts, batch.ts, tasks.ts, marketplace.ts, etc.). Threading a `requestId` through all of them requires a signature change across all callers and tests.
- Current correlation is feasible: `orchestrations` table has `api_key`, `total` (credits charged), `timestamp`. `audit_log` has `api_key` (entityId), `amount`, `timestamp`. Timestamp ± 1 second uniquely identifies most operations.
- No financial dispute has required sub-second audit resolution at current scale.

**Revisit when:** A financial dispute arises that can't be resolved by timestamp correlation, or when credit volume is high enough that two deductions for the same key within the same second becomes common.

---

## API Key Scoping & Expiry

**What:** Allow API keys to have optional expiry dates and permission scopes (e.g., read-only, specific-skills-only, spend cap). Rotation alerts when a key hasn't been rotated in 90+ days.

**Why deferred:**
- Current threat model: keys are 48-char cryptographically random hex. Brute force infeasible. Primary risk is key leak (phishing, env file exposure), not guessing.
- Scoping adds significant complexity: per-key permission checks in every middleware, scope validation in every endpoint, UI for scope configuration.
- No enterprise customers requesting scoped keys yet.

**Revisit when:** Enterprise customers request SSO/key scoping, or when the first key leak incident occurs.

---

## GDPR Data Export (Right to Portability)

**What:** `GET /v1/auth/export` endpoint that returns all user data in a machine-readable JSON format: credit balance, transaction history, tasks, skills created, orchestrations, ratings given.

**Why deferred:**
- Requires significant engineering: joining across 8+ tables, streaming large result sets, rate-limiting to prevent abuse.
- GDPR right to portability applies to data "provided by the data subject" — transaction history qualifies; orchestration queries qualify. Most data is user-generated.
- No user has requested data export yet.

**Revisit when:** First user data export request arrives, or when preparing for GDPR compliance audit.

---

## Terms of Service & Privacy Policy Pages

**Status: IMPLEMENTED** — `site/terms.html` and `site/privacy.html` now exist with matching dark design system.

---

## x402 Discovery Protocol Compliance

**What:** Implement the formal x402 discovery/manifest standard once published.

**Why deferred:**
- The spec isn't finalized yet. `GET /x402` already returns provider metadata, skill listings, and payment configuration.
- Building against an unstable spec risks rework.

**Revisit when:** x402 publishes a formal manifest/discovery standard.

---

## Per-Skill x402 Pricing (Agent vs Human Rates)

**What:** Different USDC prices for x402 calls vs credit-based calls per skill. Enables creators to set agent-friendly pricing.

**Why deferred:**
- Adds schema + routing complexity for no current demand.
- Nobody is asking for differentiated agent vs human prices yet.
- Current unified rate (`X402_USDC_PER_CREDIT=0.001`) is simple and fair.

**Revisit when:** x402 volume reaches 100+ calls/day and creators request price differentiation.

---

## x402 Subscription / Prepaid Model

**What:** Agents pre-purchase a block of x402 calls at a discount, avoiding per-call payment overhead.

**Why deferred:**
- Premature optimization. Need actual high-frequency agents first.
- Per-call x402 works fine for current volume.

**Revisit when:** An agent makes 50+ x402 calls/day and the per-call overhead becomes a friction point.

---

## Own Facilitator Node

**What:** Run a self-hosted x402 facilitator instead of relying on x402.org.

**Why deferred:**
- Heavy infrastructure — requires running a payment verification service.
- Facilitator fallback (primary + 2 backups) already implemented.
- Only matters if x402.org has reliability issues.

**Revisit when:** x402.org uptime drops below 99.5% or facilitator response time exceeds 2 seconds consistently.

---

## Cross-Chain x402 (Solana Provider Mode)

**What:** Serve x402 skills accepting SOL/USDC on Solana (not just Base/EVM).

**Why deferred:**
- x402 Solana provider mode isn't mature in the SDK.
- Solana receiving infrastructure already exists for credit purchases — but x402 payment verification on Solana needs SDK support.

**Revisit when:** `@x402/solana` SDK package is published and stable.

---

## MCP + x402 Payment Bridge

**What:** MCP tool calls that auto-pay via x402 — agent calls a skill through MCP and payment happens transparently.

**Why deferred:**
- `@clawnet/mcp` package is built but unpublished. Ship basic MCP first.
- Payment bridge adds significant complexity (wallet integration in MCP protocol).
- MCP spec doesn't have a native payment primitive yet.

**Revisit when:** MCP package is published, has 50+ installs, and users request payment integration.

---

## Data Marketplace Standard / Schema

**What:** Publish a formal schema for data skill outputs — standard field names, types, update frequencies — so agents can consume any data skill without reading docs.

**Why deferred:**
- Standards play needs ecosystem traction. Need 50+ data skills before a "standard" matters to anyone.
- `sample_output_json` already serves as an informal contract per skill.

**Revisit when:** 50+ third-party data skills exist and inconsistent output formats become a developer pain point.

---

## Agent Economy v2 — Deferred Items (2026-03-14)

> From the ChatGPT agentic economy analysis. These are real needs for a mature agent economy but depend on ecosystem maturity (agent wallets, protocol standards, adoption volume).

### Negotiation Primitives
- Quote request/accept/reject flows, deadline negotiation, fixed vs dynamic pricing, priority fees
- **Why wait:** No agents are negotiating yet. Fixed pricing works until volume justifies complexity.
- **Revisit when:** 100+ active agent buyers/week and creators request dynamic pricing.

### Validator / Referee Roles
- Neutral third-party result verification, schema validation of outputs, benchmark-based quality checks
- **Why wait:** Requires a trust ecosystem with multiple validators. Platform-native validation sufficient early on.
- **Revisit when:** Composite skill chains make dispute resolution ambiguous.

### Capability Taxonomy / Canonical Task Ontology
- Standardized task classes (summarize, classify, rank, monitor, extract, verify, enrich, trade, route, notify)
- **Why wait:** Organic taxonomy emerges from actual skill creation patterns. Premature standardization constrains innovation.
- **Revisit when:** 100+ skills exist and inconsistent categorization hurts discovery.

### Portable Agent Identity & Reputation
- Cross-platform identity mapping, exportable reputation scores, federated trust protocols
- **Why wait:** No interop standards exist. Platform-local identity (Clerk + API keys) is sufficient.
- **Revisit when:** Multiple agent platforms exist and cross-platform trust becomes competitive advantage.

### Legal / Compliance Framing
- Policy controls for autonomous purchasing, accounting export, spend approval tiers, tax classification
- **Why wait:** Enterprise feature. Build when first enterprise customer asks.
- **Revisit when:** Enterprise onboarding requests or regulatory pressure.

### Advanced Abuse Prevention (Post-Subcontracting)
- Wash-volume detection, reputation farming detection, synthetic demand rings, self-dealing detection
- **Why wait:** Current atomic model doesn't need these. Build alongside subcontracting monitoring.
- **Revisit when:** Subcontracting is live and transaction volume justifies abuse analytics.

### Full Auction/Market Mechanics
- Dynamic pricing based on demand, bidding for priority execution, supply/demand signaling
- **Why wait:** Requires significant volume to justify. Fixed pricing works for early market.
- **Revisit when:** 1000+ daily skill invocations and price sensitivity emerges.

### Marketing Bot (ClawNet X Agent)
- Cron-based bot dogfooding ClawNet API, posts 2-3x/day with live skill data
- Footer: "Live data via claw-net.org API", each post = product demo
- Cost: ~$5-15/month (API) + $100/month (X API Basic tier)
- **Why wait:** Not blocked, separate scope. Can build anytime as a standalone script.
- **Revisit when:** Ready to invest $100/month in X API access for marketing.
