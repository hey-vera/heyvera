# Verified Intelligence Engine (VIE) — Scoring Algorithm Specification

**Version:** 1.0
**Date:** 2026-03-18
**Status:** DESIGN — not yet implemented
**Author:** ClawNet Engineering

---

## 1. Overview

The Verified Intelligence Engine (VIE) aggregates data from 5 independent sources, normalizes signals into a common intermediate representation, computes 5 category scores, and produces a composite trust score (0-100) with risk level, confidence metric, and human/agent-readable verdict.

The VIE is exposed as a ClawNet skill (type: `composite`) with three billing tiers. It consumes existing API registry endpoints for its data sources.

---

## 2. Data Source Mapping

Each of the 5 scoring categories maps to one or more existing API registry endpoints. Sources are fetched in parallel with a per-source timeout of 5 seconds.

| Category | Primary Source | Fallback Source | Registry ID(s) |
|---|---|---|---|
| Contract Safety | Rug Munch Risk Score | BlackSwan Risk Intelligence | `rugmunch-risk`, `rugmunch-honeypot`, `blackswan-risk` |
| Holder Distribution | Rug Munch Holder Analysis | Einstein Whale Tracking | `rugmunch-holder-analysis`, `einstein-whales` |
| Historical Pattern | Apollo OSINT | Moltalyzer Token Intelligence | `apollo-osint`, `moltalyzer-token-intel` |
| Social Signal | ClawAPIs X/Twitter Mentions | twit.sh X Search | `claw-twitter-mentions`, `twitsh-search` |
| On-Chain Activity | Einstein DEX Analytics | ClawAPIs Token Price + Token Holders | `einstein-dex`, `claw-token-price`, `claw-token-holders` |

When a primary source fails or times out, the engine falls back to the secondary source. If both fail, that category is scored as `null` (not 0) and confidence is penalized.

---

## 3. Signal Normalization

Every data point from every source is converted into a **NormalizedSignal** before scoring:

```
NormalizedSignal {
  signal_name: string        // Machine-readable identifier, e.g. "mint_authority_revoked"
  value: number              // Normalized 0.0-1.0 (where 1.0 = maximally favorable)
  weight: number             // Relative importance within its category (0.0-1.0, must sum to 1.0 per category)
  direction: "positive" | "negative" | "neutral"
  raw_data: unknown          // Original value from source (for audit/explanation)
  source_id: string          // API registry endpoint ID that produced this signal
  fetched_at: string         // ISO 8601 timestamp of data retrieval
}
```

### Normalization Rules

**Numeric ranges** are linearly interpolated to 0.0-1.0:
- Percentages (e.g., top 10 holder %): `value = 1.0 - (pct / 100)` (lower concentration = higher value)
- Durations (e.g., token age): clamped to a defined range, then `value = clamp(days / max_days, 0, 1)`
- Counts (e.g., unique holders): logarithmic scale `value = clamp(log10(count) / log10(target), 0, 1)`

**Boolean flags** map to 0.0 or 1.0:
- `mint_authority_revoked = true` -> `value = 1.0, direction = "positive"`
- `is_honeypot = true` -> `value = 0.0, direction = "negative"`

**Categorical values** use a lookup table:
- `risk_level = "low"` -> 0.9, `"medium"` -> 0.5, `"high"` -> 0.15, `"critical"` -> 0.0

**Missing/null signals** are excluded from scoring (weight redistributed proportionally among present signals within the same category).

---

## 4. Scoring Factors

### 4a. Contract Safety (composite weight: 0.25)

Evaluates the smart contract's inherent risk profile.

**Input signals and weights within category:**

| Signal | Source Field | Weight | Scoring |
|---|---|---|---|
| source_verified | `rugmunch-risk` -> flags | 0.20 | Verified source code: 1.0; unverified: 0.0 |
| no_proxy | `rugmunch-risk` -> flags | 0.15 | No proxy pattern: 1.0; proxy detected: 0.0 |
| mint_revoked | `rugmunch-risk` -> flags | 0.20 | Mint authority revoked: 1.0; active: 0.0 |
| no_freeze | `rugmunch-risk` -> flags | 0.15 | No freeze authority: 1.0; freeze active: 0.0 |
| token_age | Token metadata -> created_at | 0.15 | >180d: 1.0, >30d: 0.5, >7d: 0.25, <7d: 0.1 |
| honeypot_check | `rugmunch-honeypot` -> isHoneypot | 0.15 | Not honeypot: 1.0; honeypot: 0.0 |

**Category score formula:**
```
raw_score = sum(signal.value * signal.weight) * 100
```

**Red flag overrides (applied after raw_score):**
- If `mint_revoked.value == 0.0` (mint authority active): `category_score = min(category_score, 40)`
- If `no_proxy.value == 0.0` (proxy detected): `category_score = min(category_score, 50)`
- If `honeypot_check.value == 0.0`: `category_score = 0` (immediate zero)

**Final category_score:** integer 0-100 after overrides.

---

### 4b. Holder Distribution (composite weight: 0.20)

Evaluates concentration risk and liquidity lock status.

**Input signals and weights within category:**

| Signal | Source Field | Weight | Scoring |
|---|---|---|---|
| top10_concentration | `rugmunch-holder-analysis` -> top10Pct | 0.30 | <20%: 1.0, <40%: 0.7, <60%: 0.4, >=60%: 0.2 |
| lp_locked | DEX/liquidity data -> locked flag | 0.25 | Locked: 1.0; not locked: 0.0 |
| lock_duration | DEX/liquidity data -> lock expiry | 0.20 | >1yr: 1.0, >6mo: 0.67, >3mo: 0.33, <3mo: 0.1 |
| unique_holders | `rugmunch-holder-analysis` -> holderCount | 0.15 | log scale: log10(count)/log10(100000), clamped 0-1 |
| sybil_risk | `rugmunch-holder-analysis` -> sybilRisk | 0.10 | low: 1.0, medium: 0.5, high: 0.1 |

**Red flag overrides:**
- If `lp_locked.value == 0.0` (LP not locked): `category_score = min(category_score, 30)`
- If `top10_concentration` raw percentage > 80%: `category_score = min(category_score, 15)`

---

### 4c. Historical Pattern (composite weight: 0.25)

Evaluates the deployer's track record and pattern similarity to known rugs.

**Input signals and weights within category:**

| Signal | Source Field | Weight | Scoring |
|---|---|---|---|
| deployer_history | `apollo-osint` -> riskFlags | 0.40 | No rug associations: 1.0; linked to past rug: 0.0 |
| interaction_count | `apollo-osint` -> onChainActivity | 0.20 | >1000 successful: 1.0, >100: 0.7, >10: 0.4, <10: 0.2 |
| rekt_match | `moltalyzer-token-intel` / De.Fi REKT DB | 0.20 | No matches: 1.0; pattern match: 0.0-0.3 based on similarity |
| pattern_similarity | Computed from holder+age+liquidity profile | 0.20 | Euclidean distance from known rug cluster centroids, inverted and normalized |

**Pattern similarity computation:**
1. Build a feature vector: `[top10_holder_pct, token_age_days, liquidity_usd, holder_count, volume_trend]`
2. Normalize each dimension to 0-1 using historical min/max from known tokens
3. Compute Euclidean distance to each known rug-pull cluster centroid (maintained as a static lookup, updated monthly)
4. `similarity = 1.0 - min_distance` (clamped to 0-1)
5. If similarity > 0.85 -> signal value = 0.1 (strong rug pattern match)
6. If similarity 0.6-0.85 -> signal value = 0.4 (moderate match)
7. If similarity < 0.6 -> signal value = 1.0 (no match)

**Critical override:**
- If `deployer_history.value == 0.0` (deployer linked to past rug): `category_score = 0` (immediate zero, no exceptions)

---

### 4d. Social Signal (composite weight: 0.15)

Evaluates social media presence quality and authenticity.

**Input signals and weights within category:**

| Signal | Source Field | Weight | Scoring |
|---|---|---|---|
| mention_volume | `claw-twitter-mentions` -> mentionCount | 0.15 | log10(count)/log10(10000), clamped 0-1. Zero mentions: 0.5 (neutral) |
| bot_percentage | Derived from account age + pattern analysis | 0.25 | <10% bots: 1.0, <30%: 0.7, <50%: 0.4, >=50%: 0.0 |
| sentiment_score | `claw-twitter-mentions` -> sentimentScore | 0.20 | Direct passthrough if 0-1; rescale from [-1,1] to [0,1] if needed |
| account_quality | Avg account age of top mentioners | 0.15 | Avg age >1yr: 1.0, >6mo: 0.7, >1mo: 0.4, <1mo: 0.2 |
| engagement_auth | Engagement-to-follower ratio analysis | 0.10 | Healthy ratio (0.01-0.05): 1.0; suspicious (>0.2 or <0.001): 0.3 |
| verified_project | Project has verified X account | 0.15 | Verified: 1.0; not verified: 0.5; no account: 0.5 |

**Special rules:**
- If no social presence at all (zero mentions, no project account): `category_score = 50` (neutral -- absence of social is not evidence of fraud)
- If `bot_percentage.value == 0.0` (>50% bot mentions): `category_score = min(category_score, 30)`

**Bot detection heuristic** (computed locally, not from an external source):
1. From the top 50 mentioning accounts, extract: account_age_days, follower_count, tweet_count, bio_length
2. Flag as likely bot if: account_age < 30 days AND follower_count < 50 AND tweet_count < 20
3. `bot_percentage = flagged_count / total_accounts_analyzed`

---

### 4e. On-Chain Activity (composite weight: 0.15)

Evaluates trading health and organic activity patterns.

**Input signals and weights within category:**

| Signal | Source Field | Weight | Scoring |
|---|---|---|---|
| daily_active_wallets | Derived from on-chain tx data | 0.25 | log10(DAW)/log10(10000), clamped 0-1 |
| volume_trend | `einstein-dex` -> volume24h (compared to 7d avg) | 0.20 | Stable/growing (0.8x-2x of avg): 1.0; declining (<0.5x): 0.5; spike (>5x): 0.3 |
| liquidity_depth | `einstein-dex` -> liquidity | 0.20 | >$1M: 1.0, >$100K: 0.7, >$10K: 0.4, <$10K: 0.2 |
| buy_sell_ratio | Derived from DEX swap data | 0.20 | 0.8-1.2: 1.0 (healthy); 0.5-0.8 or 1.2-2.0: 0.6; <0.5 or >2.0: 0.3 |
| volume_spike_no_news | Cross-ref volume spike with news/social | 0.15 | No spike: 1.0; spike with news: 0.8; spike without news: 0.3 (manipulation signal) |

**Volume spike detection:**
1. Compute `spike_ratio = volume_24h / volume_7d_avg`
2. If `spike_ratio > 5.0`:
   - Check if `claw-twitter-mentions` mentionCount also spiked (>3x normal) OR news endpoints returned relevant items
   - If yes: organic spike, `volume_spike_no_news.value = 0.8`
   - If no: suspicious spike, `volume_spike_no_news.value = 0.3`
3. If `spike_ratio <= 5.0`: `volume_spike_no_news.value = 1.0`

---

## 5. Composite Score Calculation

### 5a. Base Calculation

```
composite_raw = (contract_safety * 0.25) +
                (holder_distribution * 0.20) +
                (historical_pattern * 0.25) +
                (social_signal * 0.15) +
                (on_chain_activity * 0.15)
```

Where each factor score is an integer 0-100 after category-level overrides.

If a category returned `null` (both primary and fallback sources failed), redistribute its weight proportionally among the remaining categories. Example: if social_signal is null, the remaining 4 categories share 0.85 of weight, each scaled by `original_weight / 0.85`.

### 5b. Override Rules (applied in order, first match wins)

These are hard caps that cannot be overridden by high scores in other categories:

| Condition | Override | Rationale |
|---|---|---|
| Any factor scores exactly 0 (critical flag) | `composite = min(composite_raw, 25)` | A single critical red flag (e.g., deployer rug history) caps the entire score |
| `contract_safety < 30` | `composite = min(composite_raw, 40)` | Unsafe contract cannot be compensated by good social/activity |
| `holder_distribution < 20` | `composite = min(composite_raw, 35)` | Extreme concentration is a structural risk |
| `honeypot_check == true` | `composite = 0` | Hard zero -- token cannot be sold |

### 5c. Final Score

```
trust_score = round(composite)  // Integer 0-100
```

Use `round6()` for all intermediate math, then round to nearest integer for the final output.

---

## 6. Confidence Scoring

Confidence is a float from 0.0 to 1.0 representing how much we trust the trust_score itself.

### 6a. Base Confidence (data completeness)

Each of the 5 source categories that successfully returns data contributes 0.2 to the base confidence:
```
base_confidence = successful_source_count * 0.2
```
- 5/5 sources -> 1.0
- 4/5 sources -> 0.8
- 3/5 sources -> 0.6

### 6b. Penalties

| Condition | Penalty |
|---|---|
| Source data older than 1 hour | -0.10 per stale source |
| Source failed or timed out | -0.15 per failed source (note: already excluded from base, so this stacks) |
| Source returned partial data (< 50% of expected fields) | -0.05 per partial source |

### 6c. Bonuses

| Condition | Bonus |
|---|---|
| 2+ sources agree on the same risk signal (e.g., both Rug Munch and Apollo flag mint authority) | +0.05 per corroborated signal (max +0.15 total) |
| All 5 categories scored in the same risk band (all HIGH, all LOW, etc.) | +0.05 (score consistency) |

### 6d. Final Confidence

```
confidence = clamp(base_confidence + penalties + bonuses, 0.0, 1.0)
```

Round to 2 decimal places for output.

---

## 7. Risk Level Mapping

| Trust Score | Risk Level | Confidence Gate |
|---|---|---|
| 80-100 | VERIFIED | Only if `confidence >= 0.8`. If confidence < 0.8, downgrade to LOW |
| 60-79 | LOW | None |
| 40-59 | MEDIUM | None |
| 20-39 | HIGH | None |
| 0-19 | CRITICAL | None |

**Multi-factor override:** If 3 or more of the 5 category scores are below 40, force `risk_level = "CRITICAL"` regardless of the composite score. This catches cases where the weighted average masks broad weakness.

---

## 8. Recommendation Mapping

| Risk Level | Recommendation | Description |
|---|---|---|
| VERIFIED | PROCEED | Token has passed all checks with high confidence. Low risk for agent interaction. |
| LOW | PROCEED | Generally safe. Minor concerns may exist but no critical flags. |
| MEDIUM | CAUTION | Mixed signals. Review the factor breakdown before proceeding. Agents should apply position limits. |
| HIGH | AVOID | Multiple risk factors detected. Agents should not allocate funds without human override. |
| CRITICAL | BLOCK | Critical risk detected. Agents MUST NOT interact. If this is a skill invocation, return 403. |

---

## 9. Tiered Response Design

Three response tiers, billed via ClawNet's standard credit system using `round6()` and `creditCostForEndpoint()`.

### 9a. Quick Tier (0.5 credits)

Target latency: < 2 seconds. Serves from cache when available (cache TTL: 300s for Quick).

```json
{
  "trust_score": 72,
  "risk_level": "LOW",
  "recommendation": "PROCEED",
  "token": "So11111111111111111111111111111111111111112",
  "chain": "solana",
  "cached": true,
  "data_age_seconds": 145
}
```

**Implementation:** Check cache first. If cache miss, run all 5 source fetches in parallel but only compute the composite score -- skip explanation generation. Cache the full internal result (all 5 categories) so that a subsequent Standard/Deep request can reuse the data without re-fetching.

### 9b. Standard Tier (1.5 credits)

Target latency: < 5 seconds. Cache TTL: 300s.

```json
{
  "trust_score": 72,
  "risk_level": "LOW",
  "recommendation": "PROCEED",
  "confidence": 0.85,
  "token": "So11111111111111111111111111111111111111112",
  "chain": "solana",
  "factors": {
    "contract_safety": {
      "score": 85,
      "weight": 0.25,
      "signals": [
        { "name": "source_verified", "value": 1.0, "direction": "positive" },
        { "name": "mint_revoked", "value": 1.0, "direction": "positive" },
        { "name": "no_proxy", "value": 1.0, "direction": "positive" },
        { "name": "no_freeze", "value": 1.0, "direction": "positive" },
        { "name": "token_age", "value": 0.5, "direction": "positive" },
        { "name": "honeypot_check", "value": 1.0, "direction": "positive" }
      ],
      "overrides_applied": []
    },
    "holder_distribution": {
      "score": 65,
      "weight": 0.20,
      "signals": ["..."],
      "overrides_applied": []
    },
    "historical_pattern": {
      "score": 80,
      "weight": 0.25,
      "signals": ["..."],
      "overrides_applied": []
    },
    "social_signal": {
      "score": 55,
      "weight": 0.15,
      "signals": ["..."],
      "overrides_applied": []
    },
    "on_chain_activity": {
      "score": 60,
      "weight": 0.15,
      "signals": ["..."],
      "overrides_applied": []
    }
  },
  "overrides_applied": [],
  "data_age_seconds": 12,
  "sources_used": ["rugmunch-risk", "rugmunch-honeypot", "rugmunch-holder-analysis", "apollo-osint", "claw-twitter-mentions", "einstein-dex"],
  "sources_failed": []
}
```

### 9c. Deep Tier (3.0 credits)

Target latency: < 10 seconds. Cache TTL: 60s (shorter because the LLM explanation should reflect current conditions).

Includes everything from Standard, plus:

```json
{
  "...standard_fields": "...",
  "explanation": "This token shows strong contract fundamentals: verified source code with revoked mint authority and no proxy pattern. The primary concern is moderate holder concentration — the top 10 wallets control 38% of supply, though LP is locked for 8 months which mitigates immediate rug risk. The deployer wallet has a clean history with 2,400+ successful interactions across 3 other tokens. Social presence is moderate with organic engagement patterns. On-chain activity shows healthy trading with a balanced buy/sell ratio of 1.05.",
  "evidence_chain": [
    {
      "claim": "Mint authority revoked",
      "source": "rugmunch-risk",
      "raw_value": { "mintAuthority": null, "mintAuthorityRevoked": true },
      "verified_at": "2026-03-18T14:23:01Z"
    },
    {
      "claim": "Top 10 holders control 38% of supply",
      "source": "rugmunch-holder-analysis",
      "raw_value": { "top10Pct": 38.2, "holderCount": 4521 },
      "verified_at": "2026-03-18T14:23:01Z"
    }
  ],
  "pattern_matches": [
    {
      "pattern_name": "slow_rug_concentration",
      "similarity": 0.42,
      "description": "Moderate similarity to tokens that experienced gradual insider selling over 2-4 weeks",
      "mitigating_factors": ["LP locked 8 months", "High holder count", "Clean deployer history"]
    }
  ],
  "historical_comparisons": [
    {
      "token": "BONK",
      "similarity_score": 0.71,
      "outcome": "legitimate",
      "note": "Similar holder distribution and growth pattern at comparable market cap stage"
    }
  ]
}
```

**LLM explanation generation:**
- Use the platform LLM (Anthropic Claude via `LLM_PROVIDER`) with a structured prompt
- Input: all 5 category scores, all individual signal values, any overrides applied
- System prompt instructs the LLM to produce a 2-4 sentence plain-English summary explaining the score, highlighting the strongest positive and negative signals, and flagging any active overrides
- Temperature: 0.2 (deterministic, factual tone)
- Max tokens: 300
- The LLM cost is absorbed into the 3.0 credit tier price (estimated ~$0.001 per explanation at Claude Haiku rates)

---

## 10. Caching Strategy

Integrates with ClawNet's existing Smart Cache v2 (L1 memory + L2 Redis).

| Tier | Cache TTL | Cache Key Pattern | Cache Credit Cost |
|---|---|---|---|
| Quick | 300s (5 min) | `vie:quick:{chain}:{address}` | `cacheCreditCost(0.5)` = 0.1 credits |
| Standard | 300s (5 min) | `vie:standard:{chain}:{address}` | `cacheCreditCost(1.5)` = 0.15 credits |
| Deep | 60s (1 min) | `vie:deep:{chain}:{address}` | `cacheCreditCost(3.0)` = 0.3 credits |

**Cache warming:** A Quick tier request warms the internal data cache (all 5 source responses). A subsequent Standard request within TTL reuses the source data and only computes the expanded response format -- no re-fetching.

**Cache key normalization:** Address is lowercased; chain is normalized via existing semantic key normalization (SOL/sol/solana all resolve to "solana").

---

## 11. Billing Integration

VIE is billed as a standard skill invocation through the existing credit pipeline.

```
Billing flow:
1. checkApiKey() authenticates the caller
2. Pre-flight budget check: deductCredit(keyInfo.ownerId, tierCost) with WHERE credits >= amount guard
3. If delegated key: trackDelegatedSpend(childKeyId, tierCost) at the billing site
4. x402 surcharges for upstream API calls: x402SurchargeCredits(totalApiCost) credited to clawhub-treasury
5. Revenue split: 85% to VIE skill creator (clawhub-official) / 15% to treasury
   Since clawhub-official IS the platform, effectively 100% platform revenue
6. All math uses round6()
```

**Estimated upstream API cost per invocation:**

| Source | Endpoint Cost | Notes |
|---|---|---|
| rugmunch-risk | $0.003 | Primary contract data |
| rugmunch-honeypot | $0.002 | Honeypot simulation |
| rugmunch-holder-analysis | $0.003 | Holder distribution |
| apollo-osint | $0.005 | Deployer history |
| claw-twitter-mentions | $0.001 | Social signals |
| einstein-dex | $0.003 | On-chain activity |
| **Total** | **$0.017** | **~25.5 credits at 1500x markup** |

The tier pricing (0.5 / 1.5 / 3.0 credits) is value-based, not cost-based. The upstream API costs are borne by the platform hot wallet via x402 and recovered through the x402 surcharge mechanism. The credit tier price represents the user-facing value.

**Important:** The Quick tier (0.5 credits) is below the upstream cost (~25.5 credits). This is sustainable only because Quick requests are expected to be >80% cache hits. If cache hit rate drops below 60%, the Quick tier price should be revisited. Monitor via audit logs.

**Revised pricing consideration:** If upstream costs prove prohibitive for the Quick tier, an alternative approach is to set Quick = 2.0 credits, Standard = 5.0 credits, Deep = 10.0 credits. The final pricing should be validated against actual cache hit rates in production.

---

## 12. Error Handling

| Scenario | Behavior |
|---|---|
| 1-2 sources fail | Score with available data, reduce confidence, include `sources_failed` in response |
| 3+ sources fail | Return 503 with `code: "VIE_INSUFFICIENT_DATA"`, refund credits |
| All sources fail | Return 503 with `code: "VIE_DATA_UNAVAILABLE"`, refund credits |
| Token not found on chain | Return 404 with `code: "TOKEN_NOT_FOUND"` |
| Unsupported chain | Return 400 with `code: "CHAIN_NOT_SUPPORTED"` |
| Source returns invalid/unexpected schema | Treat as source failure, log to audit with `entityType: "vie"` |
| LLM explanation fails (Deep tier) | Return Standard tier response + `"explanation": null` with a note, do NOT refund the Deep tier difference |

Credits are refunded via `topUpCredits()` on 503 errors. Partial failures (1-2 sources) are not refunded since a score is still produced.

---

## 13. API Contract

### Request

```
POST /v1/intelligence/verify
Headers: X-API-Key: cn-...
Body: {
  "address": "So11111111111111111111111111111111111111112",
  "chain": "solana",                    // "solana" | "ethereum" | "base"
  "tier": "standard"                     // "quick" | "standard" | "deep"
}
```

### Response (Standard tier shown)

```
200 OK
{
  "trust_score": 72,
  "risk_level": "LOW",
  "recommendation": "PROCEED",
  "confidence": 0.85,
  "token": { "address": "...", "chain": "solana", "symbol": "SOL", "name": "Solana" },
  "factors": { ... },                   // See Section 9b
  "overrides_applied": [],
  "data_age_seconds": 12,
  "sources_used": [...],
  "sources_failed": [],
  "tier": "standard",
  "credits_charged": 1.5,
  "cached": false
}
```

### Error Response

```
503 Service Unavailable
{
  "error": "Insufficient data sources available to produce a reliable score",
  "code": "VIE_INSUFFICIENT_DATA",
  "sources_failed": ["rugmunch-risk", "rugmunch-honeypot", "apollo-osint"],
  "credits_refunded": 1.5
}
```

---

## 14. Implementation Checklist

Files to create or modify:

| File | Action |
|---|---|
| `src/core/vie-scorer.ts` | NEW -- scoring engine (normalization, 5 category scorers, composite calculation, confidence, risk mapping) |
| `src/core/vie-sources.ts` | NEW -- data source fetching, parallel execution, timeout handling, fallback logic |
| `src/core/vie-patterns.ts` | NEW -- rug pattern cluster centroids, pattern similarity computation |
| `src/routes/intelligence.ts` | NEW -- `POST /v1/intelligence/verify` route |
| `src/index.ts` | MODIFY -- mount intelligence router |
| `src/db/connection.ts` | MODIFY -- add migration for `vie_results` cache table (optional, for analytics) |
| `src/config/api-registry.ts` | MODIFY -- add VIE as a registered endpoint (3 tiers) |
| `tests/unit/vie.test.ts` | NEW -- unit tests for scoring math, overrides, confidence, edge cases |

### Key Implementation Notes

1. All credit math MUST use `round6()` from `src/core/credits.ts`
2. API key masking in logs MUST use `maskApiKey()` from `src/utils/mask.ts`
3. DB access MUST use `getDb()` from `src/db/connection.ts`, never store the reference
4. Error responses MUST include `code` field with `SNAKE_CASE` format
5. Audit logging via `logAudit({ entityType: 'vie', entityId: address, action: 'score', data: { tier, trust_score, risk_level } })`
6. Delegated key billing: resolve child->parent, `deductCredit(parent)` then `trackDelegatedSpend(child)` per standard pattern
7. The pattern centroids in `vie-patterns.ts` should be a static array that can be updated without a migration -- just a code deployment

---

## 15. Test Cases

### Scoring Math

| Test | Input | Expected |
|---|---|---|
| Perfect token | All signals 1.0 across all categories | trust_score = 100, risk_level = VERIFIED (if confidence >= 0.8) |
| Deployer rug history | historical_pattern.deployer_history = 0.0 | historical_pattern score = 0, composite capped at 25 |
| Active mint + everything else perfect | mint_revoked = 0.0 | contract_safety capped at 40, composite capped at 40 |
| Honeypot detected | honeypot_check = 0.0 | contract_safety = 0, composite = 0, risk = CRITICAL |
| 3 factors below 40 | contract=35, holders=30, history=38, social=80, activity=75 | risk_level = CRITICAL regardless of composite |
| No social presence | All social signals null/zero | social_signal = 50 (neutral), not 0 |
| High score but low confidence | trust_score = 85, confidence = 0.6 | risk_level = LOW (downgraded from VERIFIED) |

### Confidence

| Test | Input | Expected |
|---|---|---|
| All sources fresh | 5/5 sources, all < 1hr old | confidence base = 1.0 |
| One source stale | 5/5 sources, 1 older than 1hr | confidence = 1.0 - 0.10 = 0.90 |
| Two sources failed | 3/5 sources returned | confidence = 0.6 - 0.30 = 0.30 |
| Corroboration bonus | 2 sources agree on mint revoked | confidence += 0.05 |

### Edge Cases

| Test | Scenario | Expected |
|---|---|---|
| Unknown token | Address not found on chain | 404, TOKEN_NOT_FOUND |
| Timeout cascade | 4/5 sources timeout at 5s | 503, VIE_INSUFFICIENT_DATA, credits refunded |
| Cache hit on Quick | Same token requested within 300s | Cached response, cache credit cost (0.1cr) |
| Weight redistribution | social_signal source fails | Remaining 4 categories share 0.85 weight proportionally |
| Zero division guard | Only 1 source succeeds | Weight = 1.0 for that category, confidence very low |

---

## 16. Future Extensions (out of scope for v1)

- **Historical trending:** Store VIE scores over time, expose `GET /v1/intelligence/history/{address}` to show trust trajectory
- **Webhook alerts:** Notify agents when a previously-VERIFIED token drops below MEDIUM
- **Cross-chain correlation:** Compare deployer wallets across chains using Apollo OSINT bridge data
- **Community validation:** Let validators (existing validator system) upvote/downvote VIE scores, feeding back into confidence
- **Composite skill integration:** Expose VIE as a dependency in composite skills so agents can gate actions on trust_score thresholds
- **Custom weight profiles:** Let agents configure their own category weights (e.g., DeFi agents might weight liquidity higher)
