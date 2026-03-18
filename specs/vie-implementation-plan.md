# Verified Intelligence Engine (VIE) — Implementation Plan

**Version:** 1.0
**Date:** 2026-03-18
**Status:** APPROVED — ready to build
**Companion doc:** `specs/vie-scoring-algorithm.md` (scoring math + test cases)

---

## 1. What We're Building

A first-party composite data skill that answers: **"Is this token/wallet/contract safe and why?"**

It cross-references 4-5 data sources in parallel, scores them across 5 categories, and (for the Deep tier) uses an LLM to synthesize an explained verdict with evidence chains.

**This is ClawNet's first official marketplace listing** — the flagship that shows developers what data skills can do.

---

## 2. Architecture Overview

```
Agent Request
    │
    ├── Tier: Quick (0.5cr) ──→ Cache lookup ──→ Score + risk level + recommendation
    │
    ├── Tier: Standard (1.5cr) ──→ 5 parallel data fetches ──→ Scoring engine ──→ Full factor breakdown
    │
    └── Tier: Deep (3.0cr) ──→ 5 parallel data fetches ──→ Scoring engine ──→ LLM synthesis ──→ Explained verdict
```

### Data Flow

```
POST /v1/skills/vie-token-report/invoke
  │
  ├─── Group 0 (parallel) ─────────────────────────────────────────
  │    ├── rugmunch-risk          → contract_safety signals
  │    ├── rugmunch-holder-analysis → holder_distribution signals
  │    ├── claw-x-mentions        → social_signal signals
  │    ├── dexscreener-token      → onchain_activity signals
  │    └── apollo-osint           → historical_pattern signals
  │
  ├─── Scoring Engine ──────────────────────────────────────────────
  │    ├── Normalize signals (0-1 scale)
  │    ├── Score 5 categories (weighted sum)
  │    ├── Apply override rules (critical flags)
  │    ├── Calculate composite (weighted average)
  │    ├── Calculate confidence (data completeness)
  │    └── Map to risk_level + recommendation
  │
  └─── LLM Synthesis (Deep tier only) ─────────────────────────────
       ├── Prompt: "Given these 5 factor scores and raw evidence..."
       ├── Model: claude-haiku-4-5 (fast, cheap) or claude-sonnet-4-6 (deep)
       └── Output: natural language explanation + evidence chain
```

---

## 3. Files to Create

| File | Purpose | Lines (est) |
|---|---|---|
| `src/core/vie-engine.ts` | Scoring engine: normalize, score, composite, confidence | ~300 |
| `src/core/vie-sources.ts` | Data source fetchers with fallbacks | ~200 |
| `src/core/vie-synthesis.ts` | LLM prompt + response parsing | ~100 |
| `src/routes/vie.ts` | HTTP route: `POST /v1/vie/report` | ~150 |
| `tests/unit/vie.test.ts` | Unit tests for scoring math | ~200 |

### Files to Modify

| File | Change |
|---|---|
| `src/index.ts` | Import + mount `vieRouter` |
| `src/db/connection.ts` | Migration: `vie_reports` table for historical pattern tracking |
| `site/docs.html` | Add VIE section to docs |
| `site/marketplace.html` | Featured skill card |

---

## 4. Data Sources — Exact Endpoints

### Group 0 (all parallel, ~2-3s total)

| Category | Primary Endpoint | Cost | Fallback | Cost |
|---|---|---|---|---|
| Contract Safety | `rugmunch-risk` | 0.002cr | `claw-token-risk` | 0.003cr |
| Holder Distribution | `rugmunch-holder-analysis` | 0.004cr | `claw-token-holders` | 0.002cr |
| Historical Pattern | `apollo-osint` | 0.004cr | `moltalyzer-token-intel` | 0.003cr |
| Social Signal | `claw-x-mentions` | 0.002cr | `twitsh-search` | 0.001cr |
| On-Chain Activity | `dexscreener-token` | ~0cr | `claw-token-price` | 0.001cr |

**Total upstream cost (primaries):** ~0.012 credits
**Total upstream cost (all fallbacks):** ~0.010 credits
**With LLM synthesis (Haiku):** +0.02-0.05 credits
**With LLM synthesis (Sonnet):** +0.05-0.15 credits

---

## 5. Scoring Engine — Summary

Full spec in `specs/vie-scoring-algorithm.md`. Key points:

### 5 Categories (weights)

| Category | Weight | Key Signals |
|---|---|---|
| Contract Safety | 25% | Verified source, proxy pattern, mint/freeze authority, age |
| Holder Distribution | 20% | Top-10 concentration, LP lock status/duration, unique holders |
| Historical Pattern | 25% | Deployer wallet history, similar rug patterns, incident records |
| Social Signal | 15% | Mention count, bot %, sentiment, account age authenticity |
| On-Chain Activity | 15% | DAW trend, volume, buy/sell ratio, liquidity depth |

### Override Rules (in order of precedence)

1. **Honeypot detected** → score = 0, risk = CRITICAL, rec = BLOCK
2. **Any factor = 0** (e.g., deployer linked to rug) → max composite = 25
3. **Contract safety < 30** → max composite = 40
4. **Holder concentration > 80%** → max composite = 35
5. **3+ factors below 40** → risk = CRITICAL regardless of composite

### Risk Levels

| Score | Risk Level | Recommendation | Confidence Gate |
|---|---|---|---|
| 80-100 | VERIFIED | PROCEED | Only if confidence ≥ 0.8 |
| 60-79 | LOW | PROCEED | — |
| 40-59 | MEDIUM | CAUTION | — |
| 20-39 | HIGH | AVOID | — |
| 0-19 | CRITICAL | BLOCK | — |

---

## 6. Tiered Response Schema

### Quick Tier (0.5 credits)

Cache-first. Returns cached score if available (TTL: 1 hour). If no cache, runs full scoring but returns minimal response.

```json
{
  "target": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "target_type": "token",
  "chain": "solana",
  "trust_score": 87,
  "risk_level": "LOW",
  "recommendation": "PROCEED",
  "confidence": 0.92,
  "cached": true,
  "data_age_seconds": 1847,
  "tier": "quick"
}
```

### Standard Tier (1.5 credits)

Always fetches fresh data. Returns full factor breakdown.

```json
{
  "target": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "target_type": "token",
  "chain": "solana",
  "trust_score": 87,
  "risk_level": "LOW",
  "recommendation": "PROCEED",
  "confidence": 0.92,
  "factors": {
    "contract_safety": {
      "score": 91,
      "signals": {
        "verified_source": true,
        "proxy_pattern": false,
        "mint_authority_revoked": true,
        "freeze_authority": false,
        "contract_age_days": 847
      }
    },
    "holder_distribution": {
      "score": 78,
      "signals": {
        "top10_concentration_pct": 34.2,
        "liquidity_locked": true,
        "lock_duration_days": 365,
        "unique_holders": 24891
      }
    },
    "historical_pattern": {
      "score": 89,
      "signals": {
        "deployer_past_rugs": 0,
        "similar_pattern_matches": 0,
        "successful_interactions": 14502,
        "incident_count": 0
      }
    },
    "social_signal": {
      "score": 82,
      "signals": {
        "mention_count_24h": 1243,
        "bot_percentage": 12,
        "sentiment_score": 0.72,
        "organic_growth": true
      }
    },
    "onchain_activity": {
      "score": 88,
      "signals": {
        "daily_active_wallets_trend": "growing",
        "volume_24h_usd": 1200000,
        "buy_sell_ratio": 1.05,
        "liquidity_depth_usd": 450000
      }
    }
  },
  "cached": false,
  "data_age_seconds": 0,
  "tier": "standard"
}
```

### Deep Tier (3.0 credits)

Everything in Standard + LLM synthesis with natural language explanation and evidence chain.

```json
{
  "...all standard fields...": "...",
  "explanation": "This token presents low risk based on cross-referencing 5 independent data sources. The contract is verified with mint authority revoked and no proxy patterns — standard safety markers. Holder distribution shows moderate concentration (34.2% in top 10) but LP is locked for 365 days, which mitigates dump risk. The deployer wallet has a clean history with no links to previous exploits. Social sentiment is positive (0.72) with only 12% bot activity, suggesting organic community growth. On-chain metrics are healthy: growing daily active wallets, balanced buy/sell ratio (1.05), and $450K liquidity depth.",
  "evidence": [
    { "source": "rugmunch-risk", "finding": "Contract verified, no honeypot, mint revoked", "direction": "positive" },
    { "source": "rugmunch-holder-analysis", "finding": "Top 10 hold 34.2%, LP locked 365 days", "direction": "positive" },
    { "source": "apollo-osint", "finding": "Deployer clean, 14,502 successful interactions, 0 incidents", "direction": "positive" },
    { "source": "claw-x-mentions", "finding": "1,243 mentions, 72% positive sentiment, 12% bot activity", "direction": "positive" },
    { "source": "dexscreener-token", "finding": "$1.2M 24h volume, $450K liquidity, balanced buy/sell", "direction": "positive" }
  ],
  "comparable_tokens": [
    { "symbol": "USDC", "trust_score": 98, "similarity": "verified contract, high liquidity" },
    { "symbol": "BONK", "trust_score": 71, "similarity": "meme token, higher concentration but established" }
  ],
  "tier": "deep"
}
```

---

## 7. LLM Synthesis Prompt

For the Deep tier, the scoring engine output is passed to the LLM:

```
System: You are a crypto security analyst. Given structured data from 5 independent verification sources, produce a concise trust assessment.

Rules:
- Lead with the verdict (safe/risky/avoid) in the first sentence
- Reference specific data points with numbers
- Flag any contradictions between sources
- Note the single biggest risk factor even if the overall score is high
- Keep it under 150 words
- Do NOT hallucinate data — only reference what is provided

User: Produce a trust assessment for token {symbol} ({address}) based on these verified data sources:

Contract Safety (score: {score}/100):
{raw signals}

Holder Distribution (score: {score}/100):
{raw signals}

Historical Pattern (score: {score}/100):
{raw signals}

Social Signal (score: {score}/100):
{raw signals}

On-Chain Activity (score: {score}/100):
{raw signals}

Composite trust score: {trust_score}/100
Risk level: {risk_level}
Confidence: {confidence}
```

**Model selection:**
- Default: `claude-haiku-4-5` (~0.02-0.05cr, <1s latency)
- Premium: `claude-sonnet-4-6` (~0.05-0.15cr, <3s latency) — for scores in the ambiguous 35-65 range where nuanced analysis matters most

---

## 8. Caching Strategy

| Tier | Cache Behavior | TTL |
|---|---|---|
| Quick | Cache-first. Return cached score if <1hr old. Only fetch if no cache. | 3600s |
| Standard | Always fetch fresh. Cache result for Quick tier consumers. | 3600s (stored) |
| Deep | Always fetch fresh + LLM synthesis. Cache result for Quick/Standard. | 3600s (stored) |

**Cache key:** `vie:{chain}:{target_type}:{target_address}`
**Storage:** L1 memory (10K LFU) + L2 Redis (gzip >1KB)
**Benefit:** A Deep tier call (3cr) populates the cache that Quick tier calls (0.5cr) use for the next hour. First call subsidizes subsequent calls.

---

## 9. Historical Pattern Database

### Migration (v71)

```sql
CREATE TABLE IF NOT EXISTS vie_reports (
  id TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT 'token',
  chain TEXT NOT NULL DEFAULT 'solana',
  trust_score INTEGER NOT NULL,
  risk_level TEXT NOT NULL,
  confidence REAL NOT NULL,
  factors_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- Outcome tracking (filled later via webhook or manual)
  outcome TEXT,           -- 'safe' | 'rugged' | 'exploited' | 'unknown'
  outcome_at TEXT,
  outcome_notes TEXT
);

CREATE INDEX idx_vie_target ON vie_reports(target, chain);
CREATE INDEX idx_vie_score ON vie_reports(trust_score);
CREATE INDEX idx_vie_outcome ON vie_reports(outcome) WHERE outcome IS NOT NULL;
```

**Purpose:** Every VIE report is logged. When a token later rugs or is confirmed safe, the outcome is recorded. This builds the proprietary pattern database that improves scoring over time.

---

## 10. Route Design

### `POST /v1/vie/report`

**Auth:** `X-API-Key` (standard) or x402 payment

**Body:**
```json
{
  "target": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "target_type": "token",
  "chain": "solana",
  "tier": "standard"
}
```

**Validation (Zod):**
```typescript
const VieRequestSchema = z.object({
  target: z.string().min(1).max(100),
  target_type: z.enum(['token', 'wallet', 'contract']).default('token'),
  chain: z.enum(['solana', 'ethereum', 'base']).default('solana'),
  tier: z.enum(['quick', 'standard', 'deep']).default('standard'),
});
```

**Also register as a skill** so it appears in the marketplace:
- `POST /v1/skills/vie-token-report/invoke` — invocable like any other skill
- `POST /v1/skills/vie-token-report/query` — data skill query interface

---

## 11. Billing

| Tier | User Pays | Upstream Cost | LLM Cost | ClawNet Margin |
|---|---|---|---|---|
| Quick | 0.5 cr | 0 (cache) or 0.012 | 0 | 96-100% |
| Standard | 1.5 cr | 0.012 | 0 | 99.2% |
| Deep | 3.0 cr | 0.012 | 0.02-0.15 | 94-99% |

Revenue split: 85% to `clawhub-official` (ClawNet's key), 15% to treasury. Since this is a first-party skill, both go to ClawNet.

---

## 12. Implementation Order

### Phase 1: Core Engine (~2 days)

1. Create `src/core/vie-sources.ts`
   - `fetchContractSafety(target, chain)` — calls rugmunch-risk + fallback
   - `fetchHolderDistribution(target, chain)` — calls rugmunch-holder-analysis + fallback
   - `fetchHistoricalPattern(target, chain)` — calls apollo-osint + fallback
   - `fetchSocialSignal(target, chain)` — calls claw-x-mentions + fallback
   - `fetchOnChainActivity(target, chain)` — calls dexscreener-token + fallback
   - Each returns `NormalizedSignal[]`

2. Create `src/core/vie-engine.ts`
   - `normalizeSignals(raw)` → `NormalizedSignal[]`
   - `scoreCategory(signals, weights)` → `CategoryScore`
   - `computeComposite(categories)` → `{ trust_score, risk_level, recommendation, confidence }`
   - `applyOverrides(composite, categories)` → final scores with override rules

3. Create `tests/unit/vie.test.ts`
   - 14 test cases from scoring spec
   - Mock data sources, test scoring math

### Phase 2: Route + Caching (~1 day)

4. Create `src/routes/vie.ts`
   - `POST /v1/vie/report` — validates input, checks tier, runs engine, bills credits
   - Cache integration (check L1/L2 for Quick, store for all tiers)
   - Audit logging via `logAudit()`

5. Update `src/index.ts` — mount vieRouter
6. Update `src/db/connection.ts` — migration v71 for vie_reports table

### Phase 3: LLM Synthesis (~1 day)

7. Create `src/core/vie-synthesis.ts`
   - `synthesizeVerdict(scores, rawData, target)` → `{ explanation, evidence, comparable_tokens }`
   - Model selection: Haiku default, Sonnet for ambiguous (35-65) scores
   - Prompt template from Section 7

### Phase 4: Marketplace Registration (~0.5 day)

8. Register VIE as a skill in seed-skills.ts
   - skill_type: 'data' (not composite — we want custom routing)
   - category: 'security'
   - tags: ['trust', 'verification', 'risk', 'rug-detection']
   - credit_cost: 1.5 (standard tier default)
   - SLA: { guaranteed_uptime: 99, max_latency_ms: 5000, min_success_rate: 95 }

9. Update docs.html — add VIE section
10. Update marketplace.html — featured skill card

---

## 13. x402 Support

VIE should be available via x402 (keyless access) from day one:

- `POST /x402/skills/vie-token-report` — pay with USDC on Base
- Standard tier by default
- Test mode: `POST /x402/test/skills/vie-token-report` — 5 calls/hour/IP

---

## 14. Future Enhancements (not in v1)

- **Wallet analysis** (target_type: 'wallet') — transaction history, counterparty risk
- **Contract deep audit** (target_type: 'contract') — bytecode analysis, admin key detection
- **Cross-chain** — Ethereum and Base support via additional data sources
- **Outcome feedback loop** — automated rug detection that backfills vie_reports.outcome
- **Composite embedding** — other marketplace skills can call VIE as a dependency
- **Bulk endpoint** — `POST /v1/vie/batch` for checking multiple targets

---

## 15. Success Metrics

| Metric | Target (Month 1) | Target (Month 6) |
|---|---|---|
| Daily queries | 500 | 10,000 |
| Unique agents | 50 | 500 |
| Cache hit rate | 60% | 85% |
| Avg latency (Standard) | <3s | <2s |
| Pattern database size | 5,000 reports | 100,000 reports |
| Revenue (daily) | 250 credits | 5,000 credits |

---

*This plan is implementation-ready. Phase 1 can begin immediately.*
