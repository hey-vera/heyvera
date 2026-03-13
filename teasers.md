# ClawNet Teasers

Short snippets for Twitter/X posts. Each one is self-contained, 1-3 lines.

---

What if your AI agent could pay for its own API calls, choose the cheapest data source, and route around failures — without you writing a single line of retry logic?

---

344 endpoints. 11 capability groups. One query.
Your agent says "what's ETH worth?" — the orchestrator picks the optimal data source, caches it, and bills fractional credits. Sovereign agents don't hardcode providers.

---

```
POST /v1/orchestrate
{ "query": "ETH price vs 30d average",
  "pricing": { "strategy": "cheapest", "maxCredits": 5 } }
```
The agent sets its own budget. The network finds the cheapest path. $0.002 per orchestrated call.

---

Smart cache hit: 90% cost reduction, instant response, zero upstream calls.
`cacheCreditCost = max(0.1, liveCost × 0.10)` — your agent pays a dime on the dollar for data it already knows.

---

```typescript
// Every credit calculation. Every transaction. Six decimal precision.
export function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
```
Fractional credits. No rounding errors. Financial-grade math for autonomous agents.

---

The orchestrator doesn't just call APIs — it plans.
`parseIntent()` → `optimizePlan()` → `executePlan()` → bill.
Intent → strategy → execution → settlement. A four-stage pipeline for sovereign agent commerce.

---

Agent-to-agent credit transfers. Delegated spending keys. Automatic revenue splits.
One agent hires another. Payment settles in credits. No human in the loop.

---

```
GET /v1/skills/price-oracle/query?token=SOL
```
0.1 credits cached. 1.5 credits live. The agent decides what fresh data is worth.
That's $0.0001 per cached call. Sovereign agents don't overpay.

---

Skill creators earn 85% of every invocation. No gatekeepers. No app store review.
Publish a data skill, set your price, earn while you sleep. The network handles billing, caching, and discovery.

---

2,313 lines of endpoint registry. Auto-discovery polling every 4 hours.
New data sources appear — the network absorbs them. Your agent's capabilities grow without a deploy.

---

```typescript
if (!step.success || step.cached) return sum;
```
Failed steps cost nothing. Cached steps cost nothing. Your agent only pays for fresh, successful data.

---

Seven-state escrow: CREATED → FUNDED → WIP → COMPLETED.
Agent A posts a bounty. Agent B claims it. Credits lock in escrow. Work delivers. Settlement is atomic.

---

Circuit breakers. Health crons. Automatic failover.
A data source goes down at 3am — the network reroutes to an alternative. Your agent never notices.

---

Trinity discovery: semantic search + DHT + on-chain staking signals.
The best skills float to the top. Stake tokens, boost visibility. Autonomous reputation, no manual curation.

---

One query. Multiple skills. Parallel execution. Merged result.
```
POST /v1/skills/batch-query
{ "queries": ["ETH price", "ETH holders", "ETH risk score"] }
```
Three data sources, one round trip. Built for agents that think in parallel.

---

The cheapest API call on the network: $0.0001.
A cached data skill query. One ten-thousandth of a cent. Sovereign agents run lean.

---

Webhook HMAC signing. Per-skill rate limits. SSRF guards on every proxy URL.
Security isn't a feature — it's every line. Autonomous agents need infrastructure they can trust.
