# Agent Checkpoint — Technical Specification

**Version:** 1.0
**Date:** 2026-03-18
**Status:** Design Complete — Ready for Implementation

---

## Executive Summary

Agent Checkpoint is a single API endpoint that every autonomous agent calls before every decision. One call, four checks, one verdict. It is the pre-flight layer between an agent's intent and its action.

**Endpoint:** `POST /v1/checkpoint`
**Route file:** `src/routes/checkpoint.ts`
**Core engine:** `src/core/checkpoint-engine.ts`
**Persistent store:** `checkpoint_memory` table (new migration)

---

## 1. THE VERIFY STEP — "Is this data accurate?"

### Decision: Option C — Hybrid (structured claims fast path + raw data LLM path)

**Why:** Structured claims cover 90% of agent use cases (price checks, balance verification, metric validation) at near-zero LLM cost. Raw data parsing via LLM handles the long tail (unstructured reports, multi-claim paragraphs) but costs more and is gated behind Standard/Deep tiers. This gives agents a choice: cheap and fast when they know what to verify, thorough when they do not.

### Input Format

```typescript
interface VerifyInput {
  // Structured path — fast, cheap, deterministic
  claims?: Array<{
    type: 'price' | 'volume' | 'balance' | 'holders' | 'market_cap' | 'liquidity' | 'metadata' | 'custom';
    subject: string;          // "SOL", "0x1234...", "BTC/USD"
    value: string | number;   // "142.50", 1500000, "Raydium"
    unit?: string;            // "USD", "SOL", "count"
    source?: string;          // Where the agent got this data
    tolerance?: number;       // Override default tolerance (0.05 = 5%)
  }>;

  // Raw path — LLM-parsed, Standard/Deep only
  raw?: string;               // "SOL is at $142, volume is 2B, and whale wallets hold 40%"
}
```

### Verification Engine (`verifyClaimsEngine()`)

**Structured claims processing:**

1. Map each claim type to verification sources using an extended version of `cross-verify.ts`'s `VERIFICATION_SOURCES` registry. The current registry covers `token-price` and `token-metadata`. Checkpoint extends it to cover all claim types:

```typescript
const CLAIM_VERIFIERS: Record<string, ClaimVerifier> = {
  price:      { endpoints: ['claw-token-price', 'coingecko-price', 'dexscreener-token'], field: 'priceUsd', tolerance: 0.05 },
  volume:     { endpoints: ['claw-token-price', 'dexscreener-token'],                    field: 'volume24h', tolerance: 0.15 },
  balance:    { endpoints: ['claw-wallet-balance'],                                       field: 'balance',   tolerance: 0.01 },
  holders:    { endpoints: ['claw-token-holders', 'rugmunch-holder-analysis'],            field: 'totalHolders', tolerance: 0.10 },
  market_cap: { endpoints: ['coingecko-price', 'claw-token-price'],                       field: 'marketCap', tolerance: 0.10 },
  liquidity:  { endpoints: ['dexscreener-token'],                                         field: 'liquidity', tolerance: 0.10 },
  metadata:   { endpoints: ['claw-token-metadata'],                                       field: null,        tolerance: 0,    type: 'exact' },
};
```

2. For each claim, fetch from up to 3 sources in parallel (using existing `clawApiCall()` from `providers/clawapis.ts`). Cache results aggressively (same cache keys as VIE/Context Engine so data is shared).

3. Resolve verdict per claim:

```typescript
type ClaimVerdict = 'verified' | 'disputed' | 'unverifiable' | 'stale';
```

**Resolution logic:**
- **2+ sources agree within tolerance** -> `verified`
- **Sources disagree beyond tolerance** -> `disputed` (response includes all source values + deviation)
- **No sources available for claim type** -> `unverifiable` (response says why: "No endpoint available for this claim type")
- **Sources return data but it is >5 minutes old** -> `stale` (verified but with staleness warning)

**Contradiction handling:** Weighted majority. Sources get reliability weights from the endpoint health system (`src/core/endpoint-health-cron.ts` success rates). If source A (95% uptime, weight 0.95) says $142 and source B (80% uptime, weight 0.80) says $138 and source C (92% uptime, weight 0.92) says $142, the weighted majority says $142 and source B is flagged as the outlier. The response always includes all source values so the agent can make its own judgment.

**Raw data processing (Standard/Deep only):**
- LLM call (Haiku) with system prompt: "Extract verifiable factual claims from this text. Return JSON array of {type, subject, value, unit}. Only extract claims that can be checked against market data. Skip opinions, predictions, and subjective assessments."
- Extracted claims are then fed through the same structured pipeline above.
- The LLM extraction step adds ~$0.00005 cost per call.

**Unverifiable data handling:** Checkpoint returns `unverifiable` with a `reason` field. It never silently skips claims. The agent sees exactly which claims could not be checked and why: "No cross-reference endpoint exists for sentiment scores" or "Predictions cannot be verified against current data."

### Verify Output

```typescript
interface VerifyResult {
  overall: 'verified' | 'disputed' | 'partial' | 'unverifiable';
  claims: Array<{
    claim: string;                  // Human-readable: "SOL price = $142.50"
    verdict: ClaimVerdict;
    sources: Array<{
      name: string;
      value: string | number;
      fetched_at: string;
      reliability: number;          // 0-1 from endpoint health
    }>;
    deviation_pct?: number;         // Max deviation across sources
    warning?: string;
  }>;
  verified_count: number;
  disputed_count: number;
  unverifiable_count: number;
}
```

`overall` logic: all verified -> `verified`. Any disputed -> `disputed`. Mix of verified + unverifiable -> `partial`. All unverifiable -> `unverifiable`.

---

## 2. THE ASSESS STEP — "Is my reasoning sound?"

### Decision: Option C (rules-based premise verification) always, plus Option A (LLM logical evaluation) on Deep tier

**Why:** Option C is cheap, reliable, and actually useful. When an agent says "I want to buy SOL because volume is up 300%", the most valuable check is whether volume actually IS up 300%. That ties directly into the Verify step and costs nothing extra. Option A (LLM evaluation) adds real value for complex multi-step reasoning chains, but it introduces LLM hallucination risk. Gating it behind Deep tier means agents pay for the risk and only use it when they need it. Option B (historical pattern matching) has a cold start problem and requires massive data before it becomes useful. It is a future enhancement, not a launch feature.

### Input Format

```typescript
interface AssessInput {
  premises: Array<{
    claim: string;          // "SOL volume is up 300% in 24h"
    source?: string;        // Where this data came from
  }>;
  conclusion: string;       // "Therefore I should buy SOL"
  action?: string;          // "swap 100 USDC -> SOL" (ties to preflight)
  context?: string;         // Additional context the agent wants considered
}
```

### Assessment Engine (`assessReasoningEngine()`)

**Rules-based layer (all tiers):**

1. **Premise verification:** Each premise is converted to a structured claim and run through the Verify step. "SOL volume is up 300%" becomes `{ type: 'volume', subject: 'SOL', direction: 'up', magnitude: 300 }`. Uses the same LLM extraction as raw verify (Haiku, ~$0.00005).

2. **Premise-conclusion coherence check:** A lookup table of known reasoning patterns:

```typescript
const REASONING_PATTERNS: Record<string, ReasoningCheck> = {
  'buy_on_volume':    { requires: ['volume_up'], warns: ['check_if_pump_and_dump', 'check_liquidity'] },
  'sell_on_whale':    { requires: ['whale_sold'], warns: ['check_if_rebalancing', 'check_whale_identity'] },
  'buy_on_price_dip': { requires: ['price_down'], warns: ['check_if_trend_reversal', 'check_fundamentals'] },
  'sell_on_holders':  { requires: ['holders_decreasing'], warns: ['check_timeframe', 'check_if_consolidation'] },
};
```

3. **Missing factor detection:** For each matched pattern, Checkpoint flags things the agent did NOT consider. If the agent says "buy because volume up" but did not mention liquidity, holder distribution, or contract safety, those become `missing_factors` in the response.

4. **Contradiction detection:** If any premise was `disputed` in the Verify step, the assessment flags it: "Your reasoning is based on a disputed premise."

**LLM evaluation layer (Deep tier only):**

System prompt to Haiku (or Sonnet for complex chains):
```
You are a reasoning auditor. Given the premises and conclusion below, identify:
1. Logical fallacies (confirmation bias, recency bias, survivorship bias, etc.)
2. Missing considerations the agent should have evaluated
3. Whether the conclusion follows from the premises
4. A confidence score (0-100) in the reasoning quality

Be specific. Do not say "be careful." Say exactly what is wrong or missing.
Respond in JSON: { "fallacies": [...], "missing": [...], "follows": bool, "confidence": number, "explanation": string }
```

### Assess Output

```typescript
interface AssessResult {
  reasoning_score: number;          // 0-100
  verdict: 'sound' | 'weak' | 'flawed' | 'unsupported';
  premises_verified: number;        // How many premises passed Verify
  premises_disputed: number;
  premises_unverifiable: number;
  missing_factors: string[];        // Things the agent did not consider
  warnings: string[];               // Specific risks flagged by pattern matching
  contradictions: string[];         // Premises that conflict with verified data
  llm_analysis?: {                  // Deep tier only
    fallacies: string[];
    missing_considerations: string[];
    conclusion_follows: boolean;
    confidence: number;
    explanation: string;
  };
}
```

**Scoring:** `reasoning_score` = weighted average of:
- Premise verification rate (40%): `verified / total * 100`
- Pattern match completeness (30%): `1 - (missing_factors / total_expected)`
- Contradiction penalty (30%): `-25 per contradiction`

**Verdict thresholds:** >=75 `sound`, >=50 `weak`, >=25 `flawed`, <25 `unsupported`.

---

## 3. THE PREFLIGHT STEP — "Will this action succeed?"

### Decision: Action-type registry with domain-specific checks. Preflight is optional; Checkpoint runs it only when `preflight` is present in the request.

**Why:** Preflight is inherently action-specific. A swap needs liquidity/slippage checks. An API call needs health/rate-limit checks. A skill invocation needs budget checks. Rather than building one generic preflight, we build a registry of action handlers that cover the known action types. Unknown action types get a generic cost/health check.

### Input Format

```typescript
interface PreflightInput {
  action: string;            // 'swap' | 'transfer' | 'stake' | 'invoke_skill' | 'api_call' | 'custom'
  params: Record<string, unknown>;  // Action-specific parameters
  budget?: {
    max_credits?: number;
    max_usd?: number;
  };
}
```

### Preflight Engine (`preflightCheckEngine()`)

**Action handlers registry:**

```typescript
const ACTION_HANDLERS: Record<string, PreflightHandler> = {

  swap: async (params) => {
    // 1. Check liquidity depth via dexscreener-token
    // 2. Estimate slippage based on amount vs liquidity
    // 3. Check gas costs via Solana RPC
    // 4. Check contract safety via VIE (re-use cached scores)
    // 5. Check if amount is economically rational (gas < 5% of trade)
    return { checks: [...], viable: bool, warnings: [...] };
  },

  transfer: async (params) => {
    // 1. Validate destination address format
    // 2. Check if destination is a known scam address (VIE data)
    // 3. Check gas costs
    // 4. Check sender balance sufficient
    return { checks: [...], viable: bool, warnings: [...] };
  },

  stake: async (params) => {
    // 1. Check validator/protocol safety
    // 2. Check current APY vs historical average
    // 3. Check lock period vs agent's time horizon
    return { checks: [...], viable: bool, warnings: [...] };
  },

  invoke_skill: async (params) => {
    // 1. Check skill health status (from skill_health_cron data)
    // 2. Check skill's success_rate and avg_latency
    // 3. Check if cost fits within agent's budget
    // 4. Check rate limits (will this hit per-skill rate limit?)
    return { checks: [...], viable: bool, warnings: [...] };
  },

  api_call: async (params) => {
    // 1. Check endpoint health from endpoint-health-cron
    // 2. Check cost vs budget
    // 3. Check if endpoint is in circuit breaker OPEN state
    return { checks: [...], viable: bool, warnings: [...] };
  },
};
```

**Unknown/custom actions:** Get a generic check: budget validation + any referenced endpoints' health. Returns `viable: true` with a warning: "No domain-specific checks available for this action type."

### Preflight Output

```typescript
interface PreflightResult {
  viable: boolean;
  risk_level: 'CLEAR' | 'CAUTION' | 'WARNING' | 'BLOCK';
  checks: Array<{
    check: string;              // "liquidity_depth", "gas_cost", "contract_safety"
    passed: boolean;
    value?: string | number;    // "Liquidity: $2.1M", "Gas: 0.00025 SOL"
    threshold?: string;         // "Minimum: $100K liquidity"
    warning?: string;
  }>;
  estimated_cost?: {
    credits: number;
    usd: number;
  };
  blockers: string[];           // Hard stops: "Insufficient liquidity", "Scam address detected"
  suggestions: string[];        // "Consider splitting into 2 trades to reduce slippage"
}
```

`viable` is `false` if ANY check is a blocker. `risk_level` is derived: no warnings = `CLEAR`, warnings only = `CAUTION`, failed non-blocker checks = `WARNING`, any blocker = `BLOCK`.

---

## 4. THE MEMORY STEP — "What should I remember?"

### Decision: Option C — Checkpoint's own persistent store in SQLite (`checkpoint_memory` table)

**Why:** Sessions have a 50KB limit and are designed for general agent state, not structured checkpoint history. Tying checkpoint memory to sessions would pollute the agent's state with audit data and hit the size limit quickly. A dedicated table gives us: unlimited history (pruned by retention policy, not hard cap), queryable structured data (SQL vs JSON blob), cross-session continuity (the agent's checkpoint history survives session resets), and pattern detection across time (required for the behavioral insights feature).

### Database Schema (new migration)

```sql
CREATE TABLE checkpoint_memory (
  id TEXT PRIMARY KEY,
  api_key TEXT NOT NULL,
  session_id TEXT,                    -- Optional link to agent session
  created_at TEXT DEFAULT (datetime('now')),

  -- What was checked
  request_hash TEXT NOT NULL,         -- SHA-256 of normalized request (dedup)
  subject TEXT,                       -- Primary entity: "SOL", "0x1234..."
  action_type TEXT,                   -- "swap", "transfer", "hold", null

  -- Verdicts (denormalized for fast queries)
  overall_verdict TEXT NOT NULL,      -- "PROCEED", "CAUTION", "HOLD", "BLOCK"
  verify_overall TEXT,                -- "verified", "disputed", "partial", null
  assess_score INTEGER,              -- 0-100, null if not assessed
  preflight_viable INTEGER,          -- 0 or 1, null if no preflight
  confidence REAL NOT NULL,          -- 0.0-1.0

  -- Compressed detail
  detail_json TEXT NOT NULL,          -- Full checkpoint response (gzipped if >4KB)

  -- Outcome tracking (agent reports back what happened)
  outcome TEXT,                       -- "success", "failure", "abandoned", null
  outcome_data TEXT,                  -- Agent-reported result JSON
  outcome_at TEXT                     -- When outcome was reported
);

CREATE INDEX idx_checkpoint_mem_key ON checkpoint_memory(api_key, created_at DESC);
CREATE INDEX idx_checkpoint_mem_subject ON checkpoint_memory(api_key, subject);
CREATE INDEX idx_checkpoint_mem_hash ON checkpoint_memory(request_hash);
```

### Memory Engine (`checkpointMemoryEngine()`)

**Automatic behavior (every checkpoint call):**
1. Compute `request_hash` = SHA-256 of normalized `{ verify, assess, preflight }` input.
2. Check if identical request was made in the last N minutes (configurable, default 5). If so, return cached result with `from_memory: true` flag. No charge.
3. After checkpoint completes, write a row to `checkpoint_memory`.
4. If `session_id` is provided and the session exists, append a summary to the session state under a `_checkpoint_history` key (last 10 entries only, to respect 50KB limit).

**Query capabilities (separate endpoint: `GET /v1/checkpoint/memory`):**

```typescript
// "Have I seen this token before?"
GET /v1/checkpoint/memory?subject=SOL&limit=10

// "What were my recent decisions?"
GET /v1/checkpoint/memory?action_type=swap&limit=20

// "Show me blocked checkpoints"
GET /v1/checkpoint/memory?verdict=BLOCK&limit=10

// "Pattern analysis" (Deep tier, LLM-powered)
POST /v1/checkpoint/memory/patterns
{ "lookback_days": 30 }
// Returns: "You've checked SOL 47 times. Your buy decisions when VIE score > 70 have had 82% positive outcomes."
```

**Outcome tracking (separate endpoint: `POST /v1/checkpoint/outcome`):**

```typescript
POST /v1/checkpoint/outcome
{
  "checkpoint_id": "chk_abc123",
  "outcome": "success",              // "success" | "failure" | "abandoned"
  "data": { "pnl_pct": 12.5 }       // Optional structured outcome data
}
```

This closes the feedback loop. Over time, Checkpoint accumulates outcome data that makes pattern analysis genuinely useful (solving Option B's cold start problem organically).

**Retention:** 90 days default. Daily cleanup cron (append to existing `src/core/cache-warming-cron.ts` cleanup or a new lightweight cron). Configurable per agent via API.

---

## 5. THE REQUEST FORMAT

### Decision: Both minimal and structured formats. The LLM parses minimal into structured.

**Why:** Adoption requires zero friction for new agents. A single string query gets a useful response. But production agents need structured input for deterministic, cacheable, cheaper calls. Supporting both means Checkpoint works as a "just ask" tool for prototyping and a precision instrument for production.

### Unified Request Schema

```typescript
const CheckpointRequestSchema = z.object({
  // ─── Minimal path ───────────────────────────────────────
  check: z.string().max(1000).optional(),       // Free-text query

  // ─── Structured path ───────────────────────────────────
  verify: z.object({
    claims: z.array(z.object({
      type: z.enum(['price', 'volume', 'balance', 'holders', 'market_cap', 'liquidity', 'metadata', 'custom']),
      subject: z.string().min(1).max(100),
      value: z.union([z.string(), z.number()]),
      unit: z.string().optional(),
      source: z.string().optional(),
      tolerance: z.number().min(0).max(1).optional(),
    })).max(20).optional(),
    raw: z.string().max(2000).optional(),
  }).optional(),

  assess: z.object({
    premises: z.array(z.object({
      claim: z.string().max(500),
      source: z.string().optional(),
    })).max(10),
    conclusion: z.string().max(500),
    action: z.string().optional(),
    context: z.string().max(1000).optional(),
  }).optional(),

  preflight: z.object({
    action: z.string().max(50),
    params: z.record(z.unknown()),
    budget: z.object({
      max_credits: z.number().optional(),
      max_usd: z.number().optional(),
    }).optional(),
  }).optional(),

  // ─── Options ────────────────────────────────────────────
  tier: z.enum(['quick', 'standard', 'deep']).default('standard'),
  session_id: z.string().max(50).optional(),
  domain: z.enum(['crypto', 'general']).default('crypto'),
});
```

### Minimal-to-Structured Conversion

When only `check` is provided, a Haiku LLM call parses it:

**System prompt:**
```
You are a checkpoint request parser. Given a free-text question, extract structured components.
Return JSON with these optional fields:
- verify: { claims: [{ type, subject, value, unit }] } — if the text contains factual claims to check
- assess: { premises: [{ claim }], conclusion } — if the text describes reasoning or a decision
- preflight: { action, params } — if the text describes an action to take
Only include fields that are clearly present. Do not invent data.
```

**Example:** `"Is SOL a good buy right now? It's at $142 with volume up 300%"` becomes:
```json
{
  "verify": { "claims": [
    { "type": "price", "subject": "SOL", "value": 142, "unit": "USD" },
    { "type": "volume", "subject": "SOL", "value": "up 300%", "unit": "pct_change" }
  ]},
  "assess": {
    "premises": [{ "claim": "SOL price is $142" }, { "claim": "SOL volume is up 300%" }],
    "conclusion": "SOL is a good buy"
  }
}
```

The minimal path always costs more (due to the parsing LLM call) but the cost is trivial (~$0.00005). The tier still controls the depth of the actual analysis.

---

## 6. THE RESPONSE FORMAT

### Unified Response Schema

```typescript
interface CheckpointResponse {
  // ─── Top-level verdict ──────────────────────────────────
  id: string;                           // "chk_abc123" — for outcome tracking
  verdict: 'PROCEED' | 'CAUTION' | 'HOLD' | 'BLOCK';
  confidence: number;                   // 0.0-1.0
  summary: string;                      // 1-line human-readable verdict

  // ─── Step results (only present if that step ran) ───────
  verify?: VerifyResult;
  assess?: AssessResult;
  preflight?: PreflightResult;

  // ─── Memory ─────────────────────────────────────────────
  memory: {
    checkpoint_id: string;              // Same as top-level id
    prior_checks: number;               // How many times this subject was checked before
    last_check?: {
      verdict: string;
      created_at: string;
      outcome?: string;                 // If the agent reported back
    };
    from_memory: boolean;               // True if this is a cached duplicate
  };

  // ─── Meta ───────────────────────────────────────────────
  tier: string;
  credits_charged: number;
  cached: boolean;
  processing_time_ms: number;
  steps_run: string[];                  // ["verify", "assess", "preflight"]
}
```

### Verdict Logic

The overall verdict is the **most severe** across all steps:

```
BLOCK:   preflight.viable === false with blockers
         OR verify.overall === 'disputed' with >50% claims disputed
         OR assess.verdict === 'unsupported'

HOLD:    assess.verdict === 'flawed'
         OR verify.overall === 'disputed' (minority disputed)
         OR preflight.risk_level === 'WARNING'

CAUTION: assess.verdict === 'weak'
         OR verify.overall === 'partial'
         OR preflight.risk_level === 'CAUTION'
         OR any step has warnings

PROCEED: All steps pass cleanly
```

### Tier-Specific Responses

**Quick tier:**
- `summary`: 1 sentence.
- `verify`: Present if claims provided. No LLM parsing of raw text.
- `assess`: Rules-based only. No LLM analysis.
- `preflight`: Basic checks only (health + budget). No liquidity/slippage deep checks.
- No `llm_analysis` field anywhere.

**Standard tier:**
- `summary`: 2-3 sentences.
- `verify`: Full structured + raw LLM parsing.
- `assess`: Rules-based + premise verification. No LLM logical analysis.
- `preflight`: Full action-specific checks.
- `memory.last_check` included.

**Deep tier:**
- `summary`: Full paragraph with specific recommendations.
- `verify`: Everything in Standard + source reliability scoring.
- `assess`: Everything in Standard + LLM logical evaluation (`llm_analysis` field).
- `preflight`: Everything in Standard + historical outcome data for similar actions.
- `memory`: Pattern analysis included (if sufficient history exists).

---

## 7. PRICING

### Decision

| Tier | Cost | Rationale |
|------|------|-----------|
| Quick | 0.5 cr | Below the 1cr psychological barrier. Agents should call this reflexively. At $0.0005 per call, LLM cost is <10% even with a Haiku parsing call. Designed for high-volume, low-friction usage. |
| Standard | 2.0 cr | The default. Covers 1-2 LLM calls (parsing + premise extraction) at comfortable margin. Same price as the orchestration fee, which agents already pay. |
| Deep | 5.0 cr | Premium analysis with full LLM reasoning evaluation. 2-3 LLM calls (parsing + assessment + synthesis). At $0.005 per call, LLM costs are ~$0.0003, giving 94% margin. |

### Cost Breakdown

```
Haiku call: ~$0.00005-0.0001 per call
1 credit = $0.001

Quick (0.5 cr = $0.0005):
  - 0-1 LLM calls (only if minimal format used): $0.00005
  - 1-3 API calls for verification: $0 (internal endpoints) or $0.0001 (x402)
  - Margin: ~80-90%

Standard (2.0 cr = $0.002):
  - 1-2 LLM calls: $0.0001-0.0002
  - 3-6 API calls for verification: $0-0.0003
  - Margin: ~85-90%

Deep (5.0 cr = $0.005):
  - 2-3 LLM calls (may upgrade to Sonnet for ambiguous cases): $0.0003-0.001
  - 5-10 API calls: $0-0.0005
  - Margin: ~70-90%
```

### Volume Sustainability

At 100K daily calls (ambitious target):
- Revenue: 100K * 2cr avg * $0.001 = $200/day = $6,000/month
- LLM cost: 100K * $0.0002 avg = $20/day = $600/month
- API cost: 100K * $0.0002 avg = $20/day = $600/month
- **Net margin: ~80%**

At 1M daily calls:
- Revenue: $60,000/month
- Costs: ~$12,000/month
- **Net margin: ~80%**

LLM costs do not become unsustainable at any realistic volume. The per-call cost is dominated by margin, not compute.

### Cache Pricing

Identical checkpoint requests within the dedup window (5 minutes): **0 credits** (served from `checkpoint_memory`).

Cache hits on underlying data (e.g., SOL price already cached from a VIE call): no additional data-fetching cost, but the checkpoint processing fee still applies. This means Checkpoint benefits from the existing Smart Cache infrastructure without requiring its own cache layer for data.

---

## 8. INFRASTRUCTURE INTEGRATION

Checkpoint is a **consumer** of existing ClawNet infrastructure, not a replacement.

| Checkpoint Needs | Existing Infrastructure | How It Connects |
|---|---|---|
| Data verification | `cross-verify.ts` + 344 endpoint registry | Extends `VERIFICATION_SOURCES` map. Calls endpoints via `clawApiCall()`. |
| Crypto entity safety | VIE engine (`vie-engine.ts`, `vie-sources.ts`) | Calls `computeVieScore()` for preflight swap/transfer checks. Uses cached VIE scores from `intel_scores` table. |
| Entity context | Context Engine (`context-engine.ts`) | Calls `buildContext()` for anomaly data used in assess step. |
| Counterparty trust | Agent Trust (`agent-trust.ts`) | Calls `computeTrustScore()` for preflight transfer checks (is destination trustworthy?). |
| Predictive signals | Predictive Alerts (`predictive-alerts.ts`) | Queries `intel_events` for recent alerts on checkpoint subjects. Surfaces in Deep tier assess/preflight. |
| LLM reasoning | `providers/llm.ts` | Uses `llmComplete()` with `role: 'synthesis'` for parsing and assessment. |
| Caching | Smart Cache v2 (`cache/index.ts`) | `cacheGet`/`cacheSet` for data fetched during verification. |
| Billing | `db/credits.ts` + `utils/billing.ts` | Standard `deductCredit()` + `trackDelegatedSpend()` pattern. |
| History | `db/intel.ts` | Reads `intel_events` and `intel_scores` for historical context. |
| Sessions | `db/sessions.ts` | Optionally writes checkpoint summaries to agent sessions. |
| Endpoint health | `endpoint-health-cron.ts` | Reads health data for source reliability weighting and preflight service checks. |
| Circuit breaker | `core/circuit-breaker.ts` | Checks breaker state for preflight API call viability. |
| Audit | `db/connection.ts` | `logAudit()` for every checkpoint call. |

### Data Flow

```
POST /v1/checkpoint
  |
  ├── Parse request (Zod validation)
  ├── If minimal format: LLM parse -> structured (llmComplete, Haiku)
  ├── Dedup check (checkpoint_memory by request_hash)
  |
  ├── VERIFY (parallel source fetches)
  |   ├── Map claims -> CLAIM_VERIFIERS registry
  |   ├── Fetch from endpoints (clawApiCall, cacheGet/cacheSet)
  |   └── Resolve verdicts (weighted majority)
  |
  ├── ASSESS
  |   ├── Extract premises -> structured claims (LLM if needed)
  |   ├── Run premises through VERIFY pipeline
  |   ├── Pattern match against REASONING_PATTERNS
  |   ├── Flag missing factors + contradictions
  |   └── Deep tier: LLM logical evaluation (llmComplete)
  |
  ├── PREFLIGHT (if present)
  |   ├── Route to ACTION_HANDLERS[action]
  |   ├── Domain checks (VIE scores, liquidity, gas, health)
  |   └── Budget validation
  |
  ├── MEMORY
  |   ├── Query checkpoint_memory for prior checks on subject
  |   ├── Write new checkpoint_memory row
  |   └── Optionally update agent session
  |
  ├── VERDICT (most severe across steps)
  ├── Billing (deductCredit + trackDelegatedSpend)
  └── Return CheckpointResponse
```

---

## 9. RELATIONSHIP TO THE 4 CRYPTO SKILLS

### Decision: Option D — The crypto skills remain standalone marketplace skills. Checkpoint is infrastructure that calls them internally.

**Why:**

- **Option A (pre-configured profiles)** kills the standalone value of VIE/Context/Trust/Alerts. Agents that only need a VIE score should not have to go through Checkpoint.
- **Option B (standalone + Checkpoint uses them)** is the closest to correct but implies they are peers. They are not. Checkpoint is a higher-order abstraction.
- **Option C (absorbed)** destroys existing integrations and marketplace presence.
- **Option D** is the clean architecture: VIE, Context Engine, Agent Trust, and Predictive Alerts are domain-specific intelligence skills. They exist on the marketplace, agents can call them directly, and they have their own pricing/tiers. Checkpoint is infrastructure that internally leverages these engines when relevant. An agent calling Checkpoint for a crypto swap gets VIE data as part of preflight, but it does not know or care that VIE exists. An agent that specifically wants a deep VIE report calls VIE directly.

### Concrete Integration

| Checkpoint Step | Uses Which Skill Engines | When |
|---|---|---|
| Verify | Cross-verify (data verification layer) | Always, for structured claims |
| Assess | Context Engine (anomaly data for premise checks) | When premises reference crypto entities |
| Preflight (swap) | VIE (contract safety), Context Engine (liquidity) | Always for swap actions |
| Preflight (transfer) | Agent Trust (destination trust score), VIE (destination contract safety) | Always for transfer actions |
| Deep tier analysis | Predictive Alerts (recent alert patterns) | Deep tier only, for forward-looking context |

**Billing:** When Checkpoint calls VIE/Context/Trust engines internally, it does NOT charge the agent for those sub-calls separately. The checkpoint tier price covers everything. Internally, the engine functions are called directly (not via HTTP), so there is no double-billing. The functions `computeVieScore()`, `buildContext()`, `computeTrustScore()` are imported and called as library functions, not as API calls.

### The Crypto Skills' Future

VIE, Context Engine, Agent Trust Score, and Predictive Alerts continue as:
1. **Standalone API endpoints** (`/v1/vie/report`, `/v1/intel/context`, `/v1/intel/trust`, `/v1/intel/alerts/analyze`) for agents that want deep domain-specific intelligence.
2. **Marketplace skills** with their own pricing, ratings, and trust signals.
3. **Internal engines** that Checkpoint calls as library functions (no HTTP overhead, no separate billing).

Checkpoint does NOT replace them. It orchestrates them. An agent that calls Checkpoint gets the benefit of all four skills without knowing they exist. An agent that wants a 15-factor VIE deep report still calls VIE directly.

---

## 10. SITE ORGANIZATION

### Decision: Checkpoint gets its own dedicated page, not buried in the marketplace. The crypto skills stay on the marketplace AND get featured placement.

### Site Architecture

```
claw-net.com/
├── / (landing page)
│   └── "Agent Checkpoint" as the primary product CTA
│       (above the fold, next to Orchestration)
│
├── /checkpoint (dedicated page)
│   ├── Hero: "One call. Four checks. One verdict."
│   ├── How it works: visual flow of Verify -> Assess -> Preflight -> Memory
│   ├── Interactive demo: paste a query, see a sample response
│   ├── Pricing table: Quick / Standard / Deep
│   ├── Code examples: minimal + structured format
│   └── "Powered by" section showing VIE, Context, Trust, Alerts logos
│
├── /marketplace (existing)
│   ├── Featured section: "Intelligence Suite"
│   │   ├── VIE — Verified Intelligence Engine
│   │   ├── Context Engine
│   │   ├── Agent Trust Score
│   │   └── Predictive Alerts
│   └── All other marketplace skills
│
├── /docs/checkpoint (API documentation)
│   ├── Quick start
│   ├── Request format (minimal + structured)
│   ├── Response format (by tier)
│   ├── Memory & outcome tracking
│   └── Integration guide
```

### Why Not the Marketplace

Checkpoint is infrastructure, not a skill. Putting it in the marketplace alongside "Solana Token Price" and "NFT Metadata" diminishes its gravity. It is the core product feature that makes ClawNet different from a simple API aggregator. It should be presented as a primary product alongside orchestration.

### Why the Crypto Skills Stay on the Marketplace

They ARE skills. They are domain-specific, priced individually, and agents may want just one of them. Putting them on a separate "Applications" page fragments the marketplace. Instead, they get a "Featured: Intelligence Suite" section at the top of the marketplace, with visual treatment that distinguishes them from community skills.

---

## Implementation Plan

### New Files

| File | Purpose |
|------|---------|
| `src/routes/checkpoint.ts` | HTTP route: `POST /v1/checkpoint`, `GET /v1/checkpoint/memory`, `POST /v1/checkpoint/outcome` |
| `src/core/checkpoint-engine.ts` | Core engine: `runCheckpoint()`, `verifyClaimsEngine()`, `assessReasoningEngine()`, `preflightCheckEngine()`, `checkpointMemoryEngine()` |
| `src/db/checkpoint.ts` | DB layer: `writeCheckpointMemory()`, `queryCheckpointMemory()`, `recordOutcome()`, `getRecentCheckpoints()` |
| `site/checkpoint.html` | Static product page |

### Database Migration (append to connection.ts)

```typescript
{
  version: 71,
  sql: `
    CREATE TABLE IF NOT EXISTS checkpoint_memory (
      id TEXT PRIMARY KEY,
      api_key TEXT NOT NULL,
      session_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      request_hash TEXT NOT NULL,
      subject TEXT,
      action_type TEXT,
      overall_verdict TEXT NOT NULL,
      verify_overall TEXT,
      assess_score INTEGER,
      preflight_viable INTEGER,
      confidence REAL NOT NULL,
      detail_json TEXT NOT NULL,
      outcome TEXT,
      outcome_data TEXT,
      outcome_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_checkpoint_mem_key ON checkpoint_memory(api_key, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_checkpoint_mem_subject ON checkpoint_memory(api_key, subject);
    CREATE INDEX IF NOT EXISTS idx_checkpoint_mem_hash ON checkpoint_memory(request_hash);
  `
}
```

### Barrel Export Addition (`src/db/index.ts`)

Add `export * from './checkpoint';` to the barrel.

### Route Registration (`src/index.ts`)

```typescript
import { checkpointRouter } from './routes/checkpoint';
app.route('/v1/checkpoint', checkpointRouter);
```

### Billing Integration

Standard pattern: `deductCredit(billingKey, tierCost)` + `trackDelegatedSpend(keyInfo, tierCost)`. Checkpoint is the 14th billing site.

### Estimated Implementation Effort

| Component | Effort |
|-----------|--------|
| `checkpoint-engine.ts` (core logic) | 2 days |
| `checkpoint.ts` route (HTTP layer) | 1 day |
| `checkpoint.ts` DB layer | 0.5 days |
| CLAIM_VERIFIERS registry expansion | 1 day |
| ACTION_HANDLERS for crypto actions | 1 day |
| ACTION_HANDLERS for platform actions | 0.5 days |
| Memory/outcome endpoints | 0.5 days |
| Migration + barrel + registration | 0.25 days |
| `site/checkpoint.html` | 1 day |
| Testing (unit + integration) | 1.5 days |
| **Total** | **~9 days** |

---

## Open Questions (Resolved)

These came up during design. Recording the decisions for posterity.

**Q: Should Checkpoint require authentication?**
A: Yes. API key required (`checkApiKey` middleware). Checkpoint writes to `checkpoint_memory` keyed by API key. Anonymous access would have no memory and no billing.

**Q: Should Checkpoint support streaming?**
A: No, not at launch. The response is structured JSON, not a narrative. Streaming adds complexity for minimal UX benefit. If Deep tier responses grow large enough to warrant streaming, add it in v2.

**Q: Should Checkpoint have webhooks?**
A: Not at launch. The call is synchronous: agent asks, Checkpoint answers. Async patterns (e.g., "notify me if this entity's checkpoint status changes") can be built on top of Predictive Alerts subscriptions.

**Q: What about non-crypto domains?**
A: The Verify step works for any domain with verifiable claims (anything in the 344 endpoint registry). The Assess step's rules-based patterns start crypto-focused but the architecture supports adding patterns for any domain. The Preflight step's `invoke_skill` and `api_call` handlers are domain-agnostic. The `domain` field in the request is a hint for future expansion, not a hard gate.

**Q: Rate limiting?**
A: Standard per-key rate limiting from the middleware stack. No special Checkpoint-specific limits. The credit cost itself is the rate limiter: 0.5-5cr per call naturally throttles abuse.

**Q: What if all verification sources are down?**
A: Checkpoint returns `verify.overall: 'unverifiable'` with the reason "All verification sources unavailable." The overall verdict becomes `CAUTION` (not `BLOCK`). Inability to verify is not the same as contradiction. The agent is told "we could not confirm this" and makes its own decision.
