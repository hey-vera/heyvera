# Manifest — Technical Specification

**Version:** 1.0
**Date:** 2026-03-18
**Status:** DEFINITIVE — Implementation Ready
**Predecessor:** `specs/agent-checkpoint-spec.md` (renamed, decisions preserved)

---

## Why Manifest Exists

Every autonomous agent follows: **Get Data -> Decide -> Act -> Learn.**

At each step, the agent is alone. No second opinion, no verification, no safety net.

Manifest is the second opinion. One call, four checks, one verdict:

- "Your data is verified / disputed / stale"
- "Your reasoning has a flaw / is sound"
- "Your action has these risks"
- "Here's what happened last time you did something similar"

This is not crypto-specific. This works for any agent making any data-driven decision. Crypto is where it launches because that is where ClawNet has the deepest verification endpoints. As the marketplace grows with more data skills, Manifest automatically verifies against more sources.

**Endpoint:** `POST /v1/manifest`
**Route file:** `src/routes/manifest.ts`
**Core engine:** `src/core/manifest-engine.ts`
**DB layer:** `src/db/manifest.ts`
**Persistent store:** `manifest_memory` table (migration v79)

---

## 1. THE VERIFY STEP — "Is this data accurate?"

### What Manifest CAN Verify

Manifest verifies **factual claims that can be checked against at least one independent data source.** It is transparent about its limits.

**Verifiable (structured claim types with known sources):**

| Claim Type | Example | Verification Sources |
|---|---|---|
| `price` | "SOL is $142.50" | claw-token-price, coingecko-price, dexscreener-token |
| `volume` | "24h volume is $2B" | claw-token-price, dexscreener-token |
| `balance` | "Wallet has 500 SOL" | claw-wallet-balance |
| `holders` | "Token has 50K holders" | claw-token-holders, rugmunch-holder-analysis |
| `market_cap` | "Market cap is $5B" | coingecko-price, claw-token-price |
| `liquidity` | "Liquidity pool is $2M" | dexscreener-token |
| `metadata` | "Symbol is BONK" | claw-token-metadata |
| `api_response` | "This endpoint returns valid JSON" | Direct re-call via clawApiCall() |
| `skill_output` | "Skill X returned Y" | Re-invoke via skill engine |

**Verifiable (via re-fetching — no tolerance, binary pass/fail):**

| Claim Type | How It Works |
|---|---|
| `api_response` | Re-calls the endpoint. Compares structure/key fields. Verdict: `verified` if shape matches, `disputed` if different. |
| `skill_output` | Re-invokes the skill with same params. Compares output. Only on Standard/Deep (costs credits). |

**NOT verifiable (Manifest says so explicitly):**

| Cannot Verify | Why | Response |
|---|---|---|
| Opinions | "This is the best DEX" | `verdict: 'unverifiable', reason: 'Subjective opinion — no factual basis to check'` |
| Predictions | "SOL will hit $200" | `verdict: 'unverifiable', reason: 'Future predictions cannot be verified against current data'` |
| Proprietary data | "Our internal model says X" | `verdict: 'unverifiable', reason: 'No independent source available for proprietary data'` |
| Sentiment scores | "Sentiment is 0.85" | `verdict: 'unverifiable', reason: 'Methodology-dependent — cannot cross-reference'` |
| Custom untyped | Any claim with type `custom` and no matching source | `verdict: 'unverifiable', reason: 'No verification source registered for this claim type'` |

Manifest never silently skips a claim. Every claim gets a verdict, even if that verdict is `unverifiable` with a reason.

### Claim Verifiers Registry

```typescript
const CLAIM_VERIFIERS: Record<string, ClaimVerifier> = {
  price: {
    endpoints: ['claw-token-price', 'coingecko-price', 'dexscreener-token'],
    field: 'priceUsd',
    tolerance: 0.05,     // 5%
    type: 'numeric',
  },
  volume: {
    endpoints: ['claw-token-price', 'dexscreener-token'],
    field: 'volume24h',
    tolerance: 0.15,     // 15% — volume data is inherently noisy
    type: 'numeric',
  },
  balance: {
    endpoints: ['claw-wallet-balance'],
    field: 'balance',
    tolerance: 0.01,     // 1%
    type: 'numeric',
  },
  holders: {
    endpoints: ['claw-token-holders', 'rugmunch-holder-analysis'],
    field: 'totalHolders',
    tolerance: 0.10,
    type: 'numeric',
  },
  market_cap: {
    endpoints: ['coingecko-price', 'claw-token-price'],
    field: 'marketCap',
    tolerance: 0.10,
    type: 'numeric',
  },
  liquidity: {
    endpoints: ['dexscreener-token'],
    field: 'liquidity',
    tolerance: 0.10,
    type: 'numeric',
  },
  metadata: {
    endpoints: ['claw-token-metadata'],
    field: null,
    tolerance: 0,
    type: 'exact',
  },
  api_response: {
    endpoints: [],       // dynamic — re-calls the source endpoint
    field: null,
    tolerance: 0,
    type: 'refetch',
  },
  skill_output: {
    endpoints: [],       // dynamic — re-invokes the skill
    field: null,
    tolerance: 0,
    type: 'reinvoke',
  },
};
```

### Verification Engine (`verifyClaims()`)

**Input:**

```typescript
interface VerifyInput {
  claims?: Array<{
    type: 'price' | 'volume' | 'balance' | 'holders' | 'market_cap' |
          'liquidity' | 'metadata' | 'api_response' | 'skill_output' | 'custom';
    subject: string;          // "SOL", "0x1234...", endpoint ID, skill ID
    value: string | number;   // The claimed value
    unit?: string;            // "USD", "SOL", "count"
    source?: string;          // Where the agent got this data
    tolerance?: number;       // Override default (0.05 = 5%)
  }>;
  raw?: string;               // Free text with embedded claims (Standard/Deep only)
}
```

**Processing:**

1. **Structured claims:** For each claim, look up `CLAIM_VERIFIERS[claim.type]`. Fetch from up to 3 endpoints in parallel via `clawApiCall()`. All fetched data flows through Smart Cache (same keys as VIE/orchestration, so cached data is reused).

2. **Raw text (Standard/Deep only):** LLM call (Haiku) with this system prompt:
   ```
   Extract verifiable factual claims from this text. Return a JSON array of
   { type, subject, value, unit }. Only extract claims that can be checked
   against external data. Skip opinions, predictions, and subjective statements.
   If the text contains no verifiable claims, return an empty array.
   ```
   Extracted claims then flow through the same structured pipeline.

3. **Verdict resolution per claim:**

| Condition | Verdict |
|---|---|
| 2+ sources agree within tolerance | `verified` |
| Sources disagree beyond tolerance | `disputed` (includes all source values + deviation %) |
| No sources available for claim type | `unverifiable` (includes reason) |
| Sources return data older than 5 minutes | `stale` (verified but flagged) |

4. **Contradiction handling:** Weighted majority. Source reliability weights come from endpoint health data (`endpoint-health-cron.ts` success rates). If Source A (95% uptime, weight 0.95) says $142 and Source B (80% uptime, weight 0.80) says $138, the weighted majority favors Source A. The response always includes ALL source values — the agent makes its own judgment.

5. **All sources down:** Returns `verify.overall: 'unverifiable'` with reason "All verification sources unavailable." Overall manifest verdict becomes CAUTION, not BLOCK. Inability to verify is not contradiction.

### Verify Output

```typescript
interface VerifyResult {
  overall: 'verified' | 'disputed' | 'partial' | 'unverifiable';
  claims: Array<{
    claim: string;                  // Human-readable: "SOL price = $142.50"
    verdict: 'verified' | 'disputed' | 'unverifiable' | 'stale';
    sources: Array<{
      name: string;
      value: string | number;
      fetched_at: string;           // ISO 8601
      reliability: number;          // 0.0-1.0 from endpoint health
    }>;
    deviation_pct?: number;         // Max deviation across sources (numeric claims)
    reason?: string;                // Why it is unverifiable (if applicable)
  }>;
  verified_count: number;
  disputed_count: number;
  unverifiable_count: number;
}
```

`overall` logic: all verified -> `verified`. Any disputed -> `disputed`. Mix of verified + unverifiable -> `partial`. All unverifiable -> `unverifiable`.

---

## 2. THE ASSESS STEP — "Is my reasoning sound?"

### Decision: Verify the premises, not the logic.

When an agent says "buy SOL because volume is up 300%", the most valuable check is whether volume IS actually up 300%. If the premise is false, the reasoning is automatically flawed regardless of logical structure. This ties directly into the Verify step and costs nothing extra.

Deep tier adds LLM logical evaluation for complex multi-step reasoning chains. This is gated behind the premium price because it introduces LLM cost and (controlled) hallucination risk.

### Input

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

### Assessment Engine (`assessReasoning()`)

**Rules-based layer (all tiers):**

1. **Premise verification.** Each premise is converted to a structured claim and run through the Verify pipeline. "SOL volume is up 300%" becomes `{ type: 'volume', subject: 'SOL' }`. The LLM extraction uses Haiku (~$0.00005). If the premise cannot be parsed into a structured claim, it is marked `unverifiable` with reason.

2. **Pattern matching.** A lookup table of known reasoning patterns detects what the agent is trying to do and flags what it missed:

```typescript
const REASONING_PATTERNS: Record<string, ReasoningCheck> = {
  buy_on_volume:    { requires: ['volume_up'],        warns: ['check_if_pump_and_dump', 'check_liquidity'] },
  sell_on_whale:    { requires: ['whale_sold'],        warns: ['check_if_rebalancing', 'check_whale_identity'] },
  buy_on_price_dip: { requires: ['price_down'],        warns: ['check_if_trend_reversal', 'check_fundamentals'] },
  sell_on_holders:  { requires: ['holders_decreasing'], warns: ['check_timeframe', 'check_if_consolidation'] },
  buy_on_social:    { requires: ['social_positive'],   warns: ['check_bot_percentage', 'check_organic_growth'] },
  buy_on_safety:    { requires: ['contract_safe'],     warns: ['check_holder_concentration', 'check_liquidity_lock'] },

  // General patterns (non-crypto)
  act_on_api_data:  { requires: ['data_fresh'],        warns: ['check_data_source_reliability', 'check_for_rate_limiting'] },
  purchase_skill:   { requires: ['skill_healthy'],     warns: ['check_skill_success_rate', 'check_alternatives'] },
};
```

3. **Missing factor detection.** For each matched pattern, Manifest flags things the agent did NOT consider. If the agent says "buy because volume up" but did not mention liquidity, holder distribution, or contract safety, those become `missing_factors`.

4. **Contradiction detection.** If any premise was `disputed` in the Verify step, the assessment flags: "Your reasoning is based on a disputed premise: [premise]. Verified value: [actual]."

**LLM evaluation layer (Deep tier only):**

System prompt:
```
You are a reasoning auditor. Given the premises and conclusion below, identify:
1. Logical fallacies (confirmation bias, recency bias, survivorship bias, etc.)
2. Missing considerations the agent should have evaluated
3. Whether the conclusion follows from the premises
4. A confidence score (0-100) in the reasoning quality

Rules:
- Be specific. Do not say "be careful." Say exactly what is wrong or missing.
- Only reference data provided to you. Do not invent market data.
- If the premises are all verified, focus on logical structure.
- If premises are disputed, lead with that — bad data invalidates any logic.

Respond ONLY with this JSON:
{ "fallacies": ["..."], "missing": ["..."], "follows": bool, "confidence": number, "explanation": "..." }
```

The prompt is structured to prevent hallucination by (a) requiring JSON output, (b) prohibiting invented data, and (c) grounding the evaluation in the verified/disputed premise data that is passed alongside the prompt. The LLM evaluates logic, not facts — facts were already checked by Verify.

### Assess Output

```typescript
interface AssessResult {
  reasoning_score: number;          // 0-100
  verdict: 'sound' | 'weak' | 'flawed' | 'unsupported';
  premises_verified: number;
  premises_disputed: number;
  premises_unverifiable: number;
  missing_factors: string[];        // Things the agent did not consider
  warnings: string[];               // Specific risks from pattern matching
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
- Premise verification rate (40%): `(verified / total) * 100`
- Pattern match completeness (30%): `(1 - (missing_factors.length / total_expected)) * 100`
- Contradiction penalty (30%): `100 - (25 * contradictions.length)`

All intermediate math uses `round6()`. Final score is clamped 0-100.

**Verdict thresholds:** >=75 `sound`, >=50 `weak`, >=25 `flawed`, <25 `unsupported`.

---

## 3. THE PREFLIGHT STEP — "Will this action succeed?"

Preflight is optional. Manifest runs it only when `preflight` is present in the request.

### Input

```typescript
interface PreflightInput {
  action: string;            // Action type identifier
  params: Record<string, unknown>;  // Action-specific parameters
  budget?: {
    max_credits?: number;
    max_usd?: number;
  };
}
```

### Supported Action Types

**Crypto actions (domain-specific checks):**

| Action | Params | Checks |
|---|---|---|
| `swap` | `{ from, to, amount, slippage? }` | Liquidity depth (dexscreener), slippage estimate, gas cost, contract safety (VIE cached score from `intel_scores`), economic rationality (gas < 5% of trade) |
| `transfer` | `{ to, amount, token? }` | Address format validation, scam address check (VIE data), gas cost, sender balance check |
| `stake` | `{ protocol, amount, duration? }` | Protocol safety (VIE), current APY vs historical, lock period assessment |
| `mint` | `{ contract, amount? }` | Contract safety (VIE), mint authority status, recent mint patterns |

**Platform actions (always available):**

| Action | Params | Checks |
|---|---|---|
| `invoke_skill` | `{ skill_id, params? }` | Skill health status (from `skill_health_cron`), success_rate, avg_latency, cost vs budget, rate limit check |
| `api_call` | `{ endpoint_id, params? }` | Endpoint health (from `endpoint-health-cron`), circuit breaker state, cost vs budget |
| `data_purchase` | `{ skill_id, tier? }` | Skill availability, cost breakdown, alternative skills with better price/reliability |

**Unknown/custom actions:** Get a generic check: budget validation + health check on any referenced endpoints/skills. Returns `viable: true` with warning: "No domain-specific checks available for action type '[action]'. Generic budget and health checks passed."

### Preflight Engine (`preflightCheck()`)

Each action handler is an async function that returns a standardized result. Handlers call existing infrastructure directly:

- `computeVieScore()` from `vie-engine.ts` (for swap/transfer/stake/mint safety)
- `getIntelScore()` from `db/intel.ts` (for cached VIE scores — avoids re-fetching)
- `clawApiCall()` from `providers/clawapis.ts` (for liquidity/gas data)
- Endpoint health data from cache (written by `endpoint-health-cron.ts`)
- Skill health data from cache (written by `skill-health-cron.ts`)
- Circuit breaker state from `core/circuit-breaker.ts`

All checks run in parallel where possible. The handler returns as soon as all checks complete or timeout (3s max per check).

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
  blockers: string[];           // Hard stops
  suggestions: string[];        // Actionable advice
}
```

`viable` = false if ANY check is a blocker. `risk_level`: no warnings = `CLEAR`, warnings only = `CAUTION`, failed non-blocker checks = `WARNING`, any blocker = `BLOCK`.

---

## 4. THE MEMORY STEP — "What should I remember?"

### Decision: Dedicated `manifest_memory` table in SQLite.

Sessions have a 50KB limit and are designed for general agent state, not structured decision history. A dedicated table gives: unlimited history (pruned by retention), queryable structured data (SQL, not JSON blob), cross-session continuity, and pattern detection across time.

### Database Schema

```sql
-- Migration v79
CREATE TABLE IF NOT EXISTS manifest_memory (
  id TEXT PRIMARY KEY,                    -- 'mfst_' + nanoid
  api_key TEXT NOT NULL,
  session_id TEXT,                        -- Optional link to agent session
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- What was checked
  request_hash TEXT NOT NULL,             -- SHA-256 of normalized request (dedup)
  domain TEXT NOT NULL DEFAULT 'general', -- 'crypto' | 'general' | custom string
  subject TEXT,                           -- Primary entity: "SOL", "0x1234...", skill ID
  action_type TEXT,                       -- "swap", "transfer", "invoke_skill", null

  -- Verdicts (denormalized for fast queries)
  overall_verdict TEXT NOT NULL,          -- "PROCEED", "CAUTION", "HOLD", "BLOCK"
  verify_overall TEXT,                    -- "verified", "disputed", "partial", null
  assess_score INTEGER,                   -- 0-100, null if not assessed
  preflight_viable INTEGER,              -- 0 or 1, null if no preflight
  confidence REAL NOT NULL,              -- 0.0-1.0

  -- Full response (compressed if large)
  detail_json TEXT NOT NULL,             -- Complete manifest response

  -- Outcome tracking
  outcome TEXT,                          -- "success", "failure", "partial", "abandoned", null
  outcome_data TEXT,                     -- Agent-reported result JSON
  outcome_at TEXT,                       -- When outcome was reported
  outcome_value REAL                     -- Numeric outcome (PnL %, error rate, etc.)
);

CREATE INDEX IF NOT EXISTS idx_manifest_mem_key ON manifest_memory(api_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manifest_mem_subject ON manifest_memory(api_key, subject, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manifest_mem_hash ON manifest_memory(request_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manifest_mem_verdict ON manifest_memory(overall_verdict, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manifest_mem_outcome ON manifest_memory(outcome) WHERE outcome IS NOT NULL;
```

### Memory Engine (`manifestMemory()`)

**Automatic behavior on every manifest call:**

1. Compute `request_hash` = SHA-256 of normalized `{ verify, assess, preflight }` input (ignoring `tier`, `session_id`). Uses `computeRequestHash()` from `utils/receipt-hash.ts`.

2. **Dedup check:** Query `manifest_memory` for same `request_hash` + same `api_key` within the last 5 minutes. If found, return the cached result with `from_memory: true`. Charge 0 credits.

3. **History lookup:** Query `manifest_memory` for same `subject` + same `api_key`. Return `prior_checks` count and `last_check` summary. This data is included in every manifest response.

4. **Write:** After manifest completes, insert a row to `manifest_memory`.

5. **Session sync (optional):** If `session_id` is provided and the session exists, append a manifest summary to the session state under `_manifest_history` (last 10 entries, stays under 50KB limit).

### Memory Query Endpoint: `GET /v1/manifest/memory`

```
GET /v1/manifest/memory?subject=SOL&limit=10
GET /v1/manifest/memory?action_type=swap&limit=20
GET /v1/manifest/memory?verdict=BLOCK&limit=10
GET /v1/manifest/memory?since=2026-03-01T00:00:00Z&limit=50
```

Auth: API key required. Only returns memories for the calling key.

Response:
```json
{
  "memories": [
    {
      "id": "mfst_abc123",
      "subject": "SOL",
      "action_type": "swap",
      "verdict": "PROCEED",
      "confidence": 0.87,
      "verify_overall": "verified",
      "assess_score": 82,
      "created_at": "2026-03-18T14:30:00Z",
      "outcome": "success",
      "outcome_value": 12.5
    }
  ],
  "total": 47,
  "limit": 10,
  "offset": 0
}
```

### Outcome Tracking Endpoint: `POST /v1/manifest/outcome`

```json
{
  "manifest_id": "mfst_abc123",
  "outcome": "success",
  "data": { "pnl_pct": 12.5, "duration_minutes": 45 },
  "value": 12.5
}
```

Validation:
- `manifest_id` must exist and belong to the calling API key.
- `outcome` must be one of: `success`, `failure`, `partial`, `abandoned`.
- `value` is optional numeric — used for aggregate analysis (e.g., average PnL when PROCEED was issued).
- Outcome can only be set once per manifest. Returns 409 if already set.
- Costs 0 credits (we WANT agents to report outcomes).

This closes the feedback loop. Over time, Manifest accumulates outcome data that makes historical analysis genuinely useful.

### Retention

90 days default. Cleanup runs in the existing daily cleanup cron (append to `cache-warming-cron.ts`):
```sql
DELETE FROM manifest_memory WHERE created_at < datetime('now', '-90 days') LIMIT 5000
```
Batched deletes, same pattern as existing cleanup.

### How Memory Creates the Flywheel

1. **Month 1:** Memory deduplicates repeated checks (saves agent credits, builds trust).
2. **Month 3:** Agents start reporting outcomes. Manifest can say "Last time you checked this subject, the verdict was PROCEED and the outcome was success."
3. **Month 6:** Enough outcome data exists for aggregate signals: "Agents who ignored CAUTION verdicts for this action type had 68% negative outcomes." These signals feed into the Assess step as additional warnings.
4. **Month 12:** The outcome database is large enough for predictive accuracy metrics, published on the Manifest page: "Manifest BLOCK verdicts prevented losses in 94% of cases." This becomes the sales pitch.

The switching cost is the memory. An agent that migrates away from Manifest loses its entire decision history, outcome patterns, and personalized risk calibration. No competitor can replicate a year of verified decision history.

---

## 5. REQUEST FORMAT

One format handles all usage patterns: noob, pro, and hybrid.

### Zod Schema

```typescript
const ManifestRequestSchema = z.object({
  // ─── Minimal path ───────────────────────────────────────
  check: z.string().max(2000).optional(),       // Free-text query

  // ─── Structured path ───────────────────────────────────
  verify: z.object({
    claims: z.array(z.object({
      type: z.enum([
        'price', 'volume', 'balance', 'holders', 'market_cap',
        'liquidity', 'metadata', 'api_response', 'skill_output', 'custom'
      ]),
      subject: z.string().min(1).max(200),
      value: z.union([z.string(), z.number()]),
      unit: z.string().max(20).optional(),
      source: z.string().max(200).optional(),
      tolerance: z.number().min(0).max(1).optional(),
    })).max(20).optional(),
    raw: z.string().max(2000).optional(),
  }).optional(),

  assess: z.object({
    premises: z.array(z.object({
      claim: z.string().max(500),
      source: z.string().max(200).optional(),
    })).max(10),
    conclusion: z.string().max(500),
    action: z.string().max(100).optional(),
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
  domain: z.string().max(50).default('general'),  // 'crypto', 'general', or custom
}).refine(
  data => data.check || data.verify || data.assess || data.preflight,
  { message: 'At least one of check, verify, assess, or preflight is required' }
);
```

### Minimal-to-Structured Conversion

When only `check` is provided, Haiku parses it:

```
System: You are a manifest request parser for an agent safety system.
Given a free-text question, extract structured components.

Return JSON with these optional fields:
- verify: { claims: [{ type, subject, value, unit }] } — if the text contains factual claims to check
- assess: { premises: [{ claim }], conclusion } — if the text describes reasoning or a decision
- preflight: { action, params } — if the text describes an action to take
- domain: string — "crypto" if about tokens/wallets/DeFi, otherwise "general"

Rules:
- Only include fields that are clearly present in the text.
- Do not invent data that is not stated or clearly implied.
- For prices/values, extract the exact number given.
- If the text is just a question with no claims, return { "verify": null, "assess": null, "preflight": null }.
```

**Example transformations:**

```
"Is SOL a good buy right now? It's at $142 with volume up 300%"
→ {
    "verify": { "claims": [
      { "type": "price", "subject": "SOL", "value": 142, "unit": "USD" },
      { "type": "volume", "subject": "SOL", "value": "up 300%", "unit": "pct_change" }
    ]},
    "assess": {
      "premises": [{ "claim": "SOL price is $142" }, { "claim": "SOL volume is up 300%" }],
      "conclusion": "SOL is a good buy"
    },
    "domain": "crypto"
  }

"Should I call this API? It returned a 500 error last time"
→ {
    "preflight": { "action": "api_call", "params": { "context": "returned 500 error previously" } },
    "domain": "general"
  }

"Is this restaurant really rated 4.5 stars?"
→ {
    "verify": { "claims": [
      { "type": "custom", "subject": "restaurant", "value": 4.5, "unit": "stars" }
    ]},
    "domain": "general"
  }
```

The minimal path always costs slightly more (~$0.00005 for the parsing LLM call) but the cost is trivial. The tier still controls depth.

**Hybrid usage:** Agent provides both `check` and some structured fields. The structured fields take precedence; `check` is parsed for any additional claims not already covered.

---

## 6. RESPONSE FORMAT

### Unified Response Schema

```typescript
interface ManifestResponse {
  // ─── Top-level verdict ──────────────────────────────────
  id: string;                           // "mfst_" + nanoid
  verdict: 'PROCEED' | 'CAUTION' | 'HOLD' | 'BLOCK';
  confidence: number;                   // 0.0-1.0
  summary: string;                      // Tier-dependent length

  // ─── Step results (only present if that step ran) ───────
  verify?: VerifyResult;
  assess?: AssessResult;
  preflight?: PreflightResult;

  // ─── Memory ─────────────────────────────────────────────
  memory: {
    manifest_id: string;                // Same as top-level id
    prior_checks: number;               // Times this subject was checked before
    last_check?: {
      id: string;
      verdict: string;
      created_at: string;
      outcome?: string;                 // If the agent reported back
      outcome_value?: number;
    };
    from_memory: boolean;               // True if this is a deduped cached result
  };

  // ─── Meta ───────────────────────────────────────────────
  tier: 'quick' | 'standard' | 'deep';
  domain: string;
  credits_charged: number;
  cached: boolean;
  processing_time_ms: number;
  steps_run: string[];                  // ["verify", "assess", "preflight"]
}
```

### Verdict Logic

The overall verdict is the **most severe** across all steps:

```
BLOCK:   preflight.viable === false (has blockers)
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

### Confidence Calculation

```typescript
confidence = round6(
  weights.reduce((sum, { value, weight }) => sum + value * weight, 0)
);
```

Weights:
- Verify: `verified_count / total_claims` (weight 0.4)
- Assess: `reasoning_score / 100` (weight 0.3)
- Preflight: `checks_passed / total_checks` (weight 0.3)
- Steps not run are excluded and weights renormalized.

### Tier-Specific Response Behavior

**Quick (0.5 credits) — target: <500ms:**

- `summary`: 1 sentence.
- `verify`: Structured claims only. No LLM parsing of `raw` text. Max 3 sources per claim.
- `assess`: Rules-based only (pattern matching + premise verification). No LLM analysis. No `llm_analysis` field.
- `preflight`: Basic checks only (health + budget + cached VIE score). No live data fetches for liquidity/slippage.
- `memory`: `prior_checks` and `last_check` included. No pattern analysis.

Quick tier is designed to be called reflexively before every agent action. At $0.0005 per call, there is no reason not to call it.

**Standard (2.0 credits):**

- `summary`: 2-3 sentences with specific data points.
- `verify`: Full structured + raw LLM parsing. Up to 3 sources per claim with reliability scores.
- `assess`: Rules-based + premise verification. Missing factors and contradictions included. No LLM logical analysis.
- `preflight`: Full action-specific checks including live data fetches.
- `memory`: `prior_checks`, `last_check`, and outcome data included.

**Deep (5.0 credits):**

- `summary`: Full paragraph with specific recommendations and risk quantification.
- `verify`: Everything in Standard + source reliability ranking + staleness analysis.
- `assess`: Everything in Standard + LLM logical evaluation (`llm_analysis` field populated).
- `preflight`: Everything in Standard + historical outcome data for similar actions (from manifest_memory aggregate queries).
- `memory`: Pattern analysis included if sufficient history exists (e.g., "You have checked SOL 47 times. Actions taken on PROCEED verdicts had 82% positive outcomes.").

---

## 7. PRICING

| Tier | Cost | Latency Target | LLM Calls | Margin |
|---|---|---|---|---|
| Quick | 0.5 cr ($0.0005) | <500ms | 0-1 (parsing only if `check` used) | ~85% |
| Standard | 2.0 cr ($0.002) | <3s | 1-2 (parsing + premise extraction) | ~87% |
| Deep | 5.0 cr ($0.005) | <8s | 2-3 (parsing + assessment + synthesis) | ~80% |

### Cost Breakdown

```
Haiku call: ~$0.00005-0.0001
Sonnet call: ~$0.0003-0.001 (Deep tier, ambiguous cases only)
1 credit = $0.001

Quick (0.5 cr = $0.0005):
  - 0-1 LLM calls: $0-0.0001
  - 1-3 API calls for verification: $0 (cached) to $0.0001 (x402)
  - Margin: ~80-90%

Standard (2.0 cr = $0.002):
  - 1-2 LLM calls: $0.0001-0.0002
  - 3-6 API calls: $0-0.0003
  - Margin: ~85-90%

Deep (5.0 cr = $0.005):
  - 2-3 LLM calls: $0.0003-0.001
  - 5-10 API calls: $0-0.0005
  - Margin: ~70-90%
```

### Cache Pricing

- **Dedup hit** (same request within 5 minutes): **0 credits.** Served from `manifest_memory`.
- **Underlying data cache hits** (SOL price already cached from VIE/orchestration): No additional data cost, but manifest processing fee still applies. Manifest benefits from Smart Cache without needing its own data cache layer.

---

## 8. INFRASTRUCTURE INTEGRATION

Manifest is a **consumer** of existing ClawNet infrastructure. It calls engine functions directly (imported, not HTTP). No double-billing.

| Manifest Needs | Existing Infrastructure | Connection |
|---|---|---|
| Data verification | `cross-verify.ts` + 344 endpoint registry | Extends VERIFICATION_SOURCES map. Calls `clawApiCall()`. |
| Crypto entity safety | VIE engine | Calls `computeVieScore()` directly. Reads cached scores from `intel_scores`. |
| Entity context | Context Engine | Calls `buildContext()` for anomaly data (when available). |
| Counterparty trust | Agent Trust | Reads `intel_scores` for trust data. |
| Predictive signals | Predictive Alerts | Queries `intel_events` for recent alerts on subjects. Deep tier only. |
| LLM reasoning | `providers/llm.ts` | Uses `llmComplete()` with `role: 'synthesis'` for parsing and assessment. |
| Caching | Smart Cache v2 | `cacheGet`/`cacheSet` for verification data. Same keys as orchestration. |
| Billing | `db/credits.ts` + `utils/billing.ts` | Standard `deductCredit()` + `trackDelegatedSpend()`. |
| Intel history | `db/intel.ts` | Reads `intel_events` and `intel_scores` for Deep tier historical context. |
| Sessions | `db/sessions.ts` | Optional writes of manifest summaries to agent sessions. |
| Endpoint health | `endpoint-health-cron.ts` | Source reliability weights for verification. |
| Circuit breaker | `core/circuit-breaker.ts` | Preflight checks for endpoint/skill viability. |
| Request hashing | `utils/receipt-hash.ts` | `computeRequestHash()` for dedup. |
| Audit | `db/connection.ts` | `logAudit()` for every manifest call. |

### Data Flow

```
POST /v1/manifest
  |
  +-- Parse request (Zod validation)
  +-- If `check` only: LLM parse -> structured (llmComplete, Haiku)
  +-- Dedup check (manifest_memory by request_hash, last 5 min)
  |
  +-- VERIFY (parallel source fetches)
  |   +-- Map claims -> CLAIM_VERIFIERS registry
  |   +-- Fetch from endpoints (clawApiCall, cacheGet/cacheSet)
  |   +-- Resolve verdicts (weighted majority)
  |
  +-- ASSESS (after verify, uses verify results)
  |   +-- Extract premises -> structured claims (LLM if needed)
  |   +-- Run premises through VERIFY pipeline (reuse cached data)
  |   +-- Pattern match against REASONING_PATTERNS
  |   +-- Flag missing factors + contradictions
  |   +-- Deep tier: LLM logical evaluation (llmComplete)
  |
  +-- PREFLIGHT (parallel with assess if no data dependency)
  |   +-- Route to ACTION_HANDLERS[action]
  |   +-- Domain checks (VIE scores, liquidity, gas, health)
  |   +-- Budget validation
  |
  +-- MEMORY
  |   +-- Query manifest_memory for prior checks on subject
  |   +-- Write new manifest_memory row
  |   +-- Optionally update agent session
  |
  +-- VERDICT (most severe across steps)
  +-- CONFIDENCE (weighted average of step scores)
  +-- SUMMARY (tier-dependent, LLM-generated for Deep)
  +-- Billing (deductCredit + trackDelegatedSpend)
  +-- logAudit()
  +-- Return ManifestResponse
```

### Parallelism Strategy

```
Quick tier:
  [verify claims in parallel] -> [assess rules + preflight basic] -> [memory + verdict]
  Total: ~200-400ms

Standard tier:
  [LLM parse (if needed)] -> [verify claims in parallel] -> [assess + preflight in parallel] -> [memory + verdict]
  Total: ~1-3s

Deep tier:
  [LLM parse (if needed)] -> [verify claims in parallel] -> [assess(rules) + preflight in parallel]
    -> [LLM assess + LLM summary in parallel] -> [memory + verdict]
  Total: ~3-8s
```

---

## 9. WHAT MANIFEST IS NOT

**Manifest does NOT replace VIE.** Agents can still call `POST /v1/vie/report` directly for deep crypto safety reports. Manifest internally uses VIE scores when relevant, but it is not a VIE wrapper. VIE is a deep domain skill; Manifest is a universal decision-support layer.

**Manifest does NOT replace orchestration.** It verifies data. It does not FETCH data. An agent that needs token price data calls orchestration or a data skill. An agent that HAS token price data and wants to verify it calls Manifest.

**Manifest does NOT make decisions.** It advises. The verdict is a recommendation, not an instruction. The agent decides. This is critical for both liability and agent autonomy.

**Manifest does NOT require crypto.** The `domain` field defaults to `general`. A non-crypto agent sending `{ "check": "Is this API endpoint reliable?" }` gets useful verification against endpoint health data, budget checks, and historical memory. The response format is identical regardless of domain.

**Manifest does NOT replace the Intelligence Suite.** The four intelligence skills (VIE, Context Engine, Agent Trust, Predictive Alerts) are deep domain-specific analysis tools. Manifest is a lightweight decision checkpoint that draws from them when relevant. An agent wanting a 15-factor VIE deep report calls VIE. An agent wanting a quick sanity check calls Manifest.

---

## 10. THE LONG-TERM INFRASTRUCTURE PLAY

### Month 1: Crypto Launch

Manifest launches with strong crypto verification because ClawNet has deep endpoint coverage for price, volume, liquidity, holder, and safety data. The Verify step handles 8 structured claim types with 10+ verification sources. Preflight handles 4 crypto action types with VIE integration. The memory system starts accumulating decision history from day one.

### Month 3: Marketplace Expansion

As more data skills join the marketplace, Manifest's verification capability expands automatically. Every new data skill that registers endpoints in the API registry becomes a potential verification source. The CLAIM_VERIFIERS registry grows without code changes — new endpoint IDs are added to existing claim types. Custom claim types can be added with a single registry entry.

### Month 6: Outcome Intelligence

The outcome database is large enough for meaningful aggregate analysis. Deep tier manifests include: "In 847 similar swap decisions, agents who received CAUTION verdicts and proceeded anyway had negative outcomes 62% of the time." These statistics are derived from real data, not predictions. They are published on the Manifest product page as proof of value.

### Month 12: The Trust Layer

Manifest IS the trust layer of the agent economy. Every serious agent calls Manifest before every decision because:
- The memory makes it more valuable over time (personalized risk calibration)
- The outcome database provides statistical backing for verdicts
- The verification coverage spans dozens of data sources
- The switching cost is high (losing decision history)

The historical database is unreplicable. A competitor starting on month 12 has zero outcome data, zero memory, and zero calibration. ClawNet has 12 months of verified decisions with tracked outcomes across thousands of agents.

---

## 11. MIGRATION AND FILE PLAN

### New Migration (v79)

Append to `MIGRATIONS` array in `src/db/connection.ts`:

```typescript
{
  version: 79,
  sql: `
    CREATE TABLE IF NOT EXISTS manifest_memory (
      id TEXT PRIMARY KEY,
      api_key TEXT NOT NULL,
      session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      request_hash TEXT NOT NULL,
      domain TEXT NOT NULL DEFAULT 'general',
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
      outcome_at TEXT,
      outcome_value REAL
    );
    CREATE INDEX IF NOT EXISTS idx_manifest_mem_key ON manifest_memory(api_key, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_manifest_mem_subject ON manifest_memory(api_key, subject, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_manifest_mem_hash ON manifest_memory(request_hash, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_manifest_mem_verdict ON manifest_memory(overall_verdict, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_manifest_mem_outcome ON manifest_memory(outcome) WHERE outcome IS NOT NULL;
  `
}
```

### New Files

| File | Purpose | Estimated Lines |
|---|---|---|
| `src/routes/manifest.ts` | HTTP route: `POST /v1/manifest`, `GET /v1/manifest/memory`, `POST /v1/manifest/outcome` | ~250 |
| `src/core/manifest-engine.ts` | Core engine: `runManifest()`, `verifyClaims()`, `assessReasoning()`, `preflightCheck()`, `manifestMemory()`, `computeVerdict()`, `generateSummary()` | ~500 |
| `src/db/manifest.ts` | DB layer: `writeManifestMemory()`, `queryManifestMemory()`, `recordManifestOutcome()`, `getRecentManifests()`, `getManifestById()`, `getOutcomeStats()` | ~150 |

### Files to Modify

| File | Change |
|---|---|
| `src/db/connection.ts` | Add migration v79 (manifest_memory table) |
| `src/db/index.ts` | Add `export * from './manifest';` to barrel |
| `src/index.ts` | Import + mount: `import { manifestRouter } from './routes/manifest'; app.route('/v1/manifest', manifestRouter);` |

### Barrel Export Addition (`src/db/index.ts`)

```typescript
export * from './manifest';
```

### Route Registration (`src/index.ts`)

```typescript
import { manifestRouter } from './routes/manifest';
app.route('/v1/manifest', manifestRouter);
```

### Billing Integration

Standard pattern. Manifest is the 14th billing site (after checkpoint, which was renamed):

```typescript
// In manifest route handler, after processing:
const tierCost = { quick: 0.5, standard: 2.0, deep: 5.0 }[tier];
deductCredit(billingKey, tierCost);
trackDelegatedSpend(keyInfo, tierCost);
```

---

## 12. ROUTE IMPLEMENTATION SPEC

### `POST /v1/manifest` — Main endpoint

**Auth:** `checkApiKey` middleware (X-API-Key required).

**Request body:** ManifestRequestSchema (see Section 5).

**Response:** ManifestResponse (see Section 6).

**Error responses:**
```typescript
// No steps requested
{ error: 'At least one of check, verify, assess, or preflight is required', code: 'MANIFEST_EMPTY_REQUEST' }

// Insufficient credits
{ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', required: 2.0, available: 0.5 }

// Validation error
{ error: 'Invalid claim type: foo', code: 'MANIFEST_VALIDATION_ERROR' }
```

### `GET /v1/manifest/memory` — Query past manifests

**Auth:** `checkApiKey` middleware.

**Query params:**
- `subject` (string, optional) — filter by subject
- `action_type` (string, optional) — filter by action type
- `verdict` (string, optional) — filter by verdict
- `since` (ISO 8601 string, optional) — only after this timestamp
- `limit` (number, optional, default 20, max 100)
- `offset` (number, optional, default 0)

**Response:**
```json
{
  "memories": [...],
  "total": 47,
  "limit": 20,
  "offset": 0
}
```

### `POST /v1/manifest/outcome` — Report what happened

**Auth:** `checkApiKey` middleware.

**Request body:**
```typescript
z.object({
  manifest_id: z.string().min(1),
  outcome: z.enum(['success', 'failure', 'partial', 'abandoned']),
  data: z.record(z.unknown()).optional(),
  value: z.number().optional(),
})
```

**Response:**
```json
{ "ok": true, "manifest_id": "mfst_abc123", "outcome": "success" }
```

**Errors:**
```typescript
{ error: 'Manifest not found or does not belong to this key', code: 'MANIFEST_NOT_FOUND' }
{ error: 'Outcome already recorded for this manifest', code: 'MANIFEST_OUTCOME_EXISTS' }
```

**Cost:** 0 credits. Outcome reporting is free because the data is more valuable to ClawNet than the revenue from charging for it.

---

## 13. DETAILED ENGINE IMPLEMENTATION

### `manifest-engine.ts` — Function signatures

```typescript
import { VerifyInput, VerifyResult, AssessInput, AssessResult, PreflightInput, PreflightResult } from './manifest-types';

// Main entry point — called by the route handler
export async function runManifest(
  request: ManifestRequest,
  apiKey: string,
  tier: 'quick' | 'standard' | 'deep',
): Promise<ManifestResponse>;

// Step 1: Verify claims against independent sources
export async function verifyClaims(
  input: VerifyInput,
  tier: 'quick' | 'standard' | 'deep',
  domain: string,
): Promise<VerifyResult>;

// Step 2: Assess reasoning by verifying premises + pattern matching
export async function assessReasoning(
  input: AssessInput,
  verifyResult: VerifyResult | null,
  tier: 'quick' | 'standard' | 'deep',
  domain: string,
): Promise<AssessResult>;

// Step 3: Preflight action viability checks
export async function preflightCheck(
  input: PreflightInput,
  domain: string,
): Promise<PreflightResult>;

// Step 4: Memory read/write
export async function manifestMemory(
  apiKey: string,
  requestHash: string,
  subject: string | null,
  sessionId: string | null,
): Promise<{ prior_checks: number; last_check: object | null; from_memory: ManifestResponse | null }>;

// Verdict + confidence computation
export function computeVerdict(
  verify: VerifyResult | null,
  assess: AssessResult | null,
  preflight: PreflightResult | null,
): { verdict: 'PROCEED' | 'CAUTION' | 'HOLD' | 'BLOCK'; confidence: number };

// Summary generation (1-line for Quick, paragraph for Deep)
export async function generateSummary(
  verdict: string,
  verify: VerifyResult | null,
  assess: AssessResult | null,
  preflight: PreflightResult | null,
  tier: 'quick' | 'standard' | 'deep',
): Promise<string>;

// Parse free-text `check` into structured request
export async function parseMinimalRequest(
  check: string,
): Promise<{ verify?: VerifyInput; assess?: AssessInput; preflight?: PreflightInput; domain?: string }>;
```

### Key Implementation Details

**`verifyClaims()` — source fetching:**

```typescript
async function fetchVerificationData(
  claim: StructuredClaim,
  verifier: ClaimVerifier,
): Promise<SourceResult[]> {
  const endpoints = verifier.endpoints.slice(0, 3); // max 3 sources
  const results = await Promise.allSettled(
    endpoints.map(epId => {
      const cacheKey = `manifest:verify:${epId}:${claim.subject}`;
      return cacheGet(cacheKey)
        .then(cached => cached || clawApiCall(epId, { query: claim.subject }).then(data => {
          cacheSet(cacheKey, data, 300); // 5 min TTL
          return data;
        }));
    })
  );
  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => (r as PromiseFulfilledResult<unknown>).value);
}
```

**`assessReasoning()` — premise-to-claim conversion:**

The LLM extracts verifiable claims from each premise string. This is a Haiku call with the same system prompt used for raw verify parsing. The extracted claims are then run through `verifyClaims()`, reusing any cached data from the Verify step. This means if the agent already sent structured verify claims, the assess step is essentially free.

**`preflightCheck()` — handler dispatch:**

```typescript
const handler = ACTION_HANDLERS[input.action] || ACTION_HANDLERS['_generic'];
return handler(input.params, input.budget, domain);
```

The `_generic` handler validates budget and checks health of any referenced endpoints/skills. It always returns `viable: true` unless budget is exceeded.

**`generateSummary()` — per-tier behavior:**

- Quick: Template string: `"${verdict}: ${topFinding}."` No LLM call.
- Standard: Template with data points: `"${verdict}. ${verifyOneLiner}. ${assessOneLiner}. ${preflightOneLiner}."` No LLM call.
- Deep: LLM call (Haiku) that takes the full verify/assess/preflight results and produces a 3-5 sentence narrative with specific recommendations.

---

## 14. EXAMPLE REQUESTS AND RESPONSES

### Example 1: Noob (natural language, Quick tier)

**Request:**
```json
{
  "check": "Is it safe to swap 100 USDC to SOL right now?",
  "tier": "quick"
}
```

**Response (0.5 credits, ~300ms):**
```json
{
  "id": "mfst_7kx9m2pq",
  "verdict": "PROCEED",
  "confidence": 0.84,
  "summary": "PROCEED: SOL price verified at $142.38, liquidity adequate for $100 swap.",
  "verify": {
    "overall": "verified",
    "claims": [
      {
        "claim": "SOL price ≈ current market",
        "verdict": "verified",
        "sources": [
          { "name": "claw-token-price", "value": 142.38, "fetched_at": "2026-03-18T14:30:01Z", "reliability": 0.97 }
        ]
      }
    ],
    "verified_count": 1,
    "disputed_count": 0,
    "unverifiable_count": 0
  },
  "preflight": {
    "viable": true,
    "risk_level": "CLEAR",
    "checks": [
      { "check": "liquidity_depth", "passed": true, "value": "$2.1M" },
      { "check": "gas_cost", "passed": true, "value": "0.00025 SOL" },
      { "check": "contract_safety", "passed": true, "value": "VIE score: 87" }
    ],
    "estimated_cost": { "credits": 0.15, "usd": 0.00015 },
    "blockers": [],
    "suggestions": []
  },
  "memory": {
    "manifest_id": "mfst_7kx9m2pq",
    "prior_checks": 12,
    "last_check": {
      "id": "mfst_prev456",
      "verdict": "PROCEED",
      "created_at": "2026-03-17T10:15:00Z",
      "outcome": "success",
      "outcome_value": 4.2
    },
    "from_memory": false
  },
  "tier": "quick",
  "domain": "crypto",
  "credits_charged": 0.5,
  "cached": false,
  "processing_time_ms": 287,
  "steps_run": ["verify", "preflight"]
}
```

### Example 2: Pro (structured, Standard tier)

**Request:**
```json
{
  "verify": {
    "claims": [
      { "type": "price", "subject": "SOL", "value": 142.50, "unit": "USD" },
      { "type": "volume", "subject": "SOL", "value": 2000000000, "unit": "USD" }
    ]
  },
  "assess": {
    "premises": [
      { "claim": "SOL price is $142.50" },
      { "claim": "SOL 24h volume is $2B, up 300% from yesterday" }
    ],
    "conclusion": "Buy SOL with 10% of portfolio",
    "action": "swap 500 USDC -> SOL"
  },
  "preflight": {
    "action": "swap",
    "params": { "from": "USDC", "to": "SOL", "amount": 500 },
    "budget": { "max_credits": 5 }
  },
  "tier": "standard",
  "session_id": "sess_abc123",
  "domain": "crypto"
}
```

**Response (2.0 credits, ~2.1s):**
```json
{
  "id": "mfst_8ab2nx4w",
  "verdict": "CAUTION",
  "confidence": 0.71,
  "summary": "CAUTION: SOL price verified at $142.38, but claimed volume of $2B is disputed — actual 24h volume is $1.2B (40% deviation). Your reasoning is based on a disputed premise.",
  "verify": {
    "overall": "disputed",
    "claims": [
      {
        "claim": "SOL price = $142.50 USD",
        "verdict": "verified",
        "sources": [
          { "name": "claw-token-price", "value": 142.38, "fetched_at": "2026-03-18T14:30:01Z", "reliability": 0.97 },
          { "name": "coingecko-price", "value": 142.41, "fetched_at": "2026-03-18T14:30:02Z", "reliability": 0.95 }
        ],
        "deviation_pct": 0.08
      },
      {
        "claim": "SOL 24h volume = $2,000,000,000 USD",
        "verdict": "disputed",
        "sources": [
          { "name": "claw-token-price", "value": 1200000000, "fetched_at": "2026-03-18T14:30:01Z", "reliability": 0.97 },
          { "name": "dexscreener-token", "value": 1180000000, "fetched_at": "2026-03-18T14:30:02Z", "reliability": 0.92 }
        ],
        "deviation_pct": 40.0
      }
    ],
    "verified_count": 1,
    "disputed_count": 1,
    "unverifiable_count": 0
  },
  "assess": {
    "reasoning_score": 42,
    "verdict": "weak",
    "premises_verified": 1,
    "premises_disputed": 1,
    "premises_unverifiable": 0,
    "missing_factors": ["check_if_pump_and_dump", "check_liquidity", "check_holder_concentration"],
    "warnings": ["Volume claim is disputed — actual volume is 40% lower than stated"],
    "contradictions": ["Premise 'SOL 24h volume is $2B' is disputed. Verified value: ~$1.19B"]
  },
  "preflight": {
    "viable": true,
    "risk_level": "CAUTION",
    "checks": [
      { "check": "liquidity_depth", "passed": true, "value": "$2.1M", "threshold": "Min $500 for $500 swap" },
      { "check": "slippage_estimate", "passed": true, "value": "0.12%", "threshold": "Max 2%" },
      { "check": "gas_cost", "passed": true, "value": "0.00025 SOL ($0.036)" },
      { "check": "contract_safety", "passed": true, "value": "VIE score: 87/100" },
      { "check": "economic_rationality", "passed": true, "value": "Gas = 0.007% of trade" }
    ],
    "estimated_cost": { "credits": 0.15, "usd": 0.00015 },
    "blockers": [],
    "suggestions": ["Volume premise is disputed — verify your data source before proceeding"]
  },
  "memory": {
    "manifest_id": "mfst_8ab2nx4w",
    "prior_checks": 12,
    "last_check": {
      "id": "mfst_prev456",
      "verdict": "PROCEED",
      "created_at": "2026-03-17T10:15:00Z",
      "outcome": "success",
      "outcome_value": 4.2
    },
    "from_memory": false
  },
  "tier": "standard",
  "domain": "crypto",
  "credits_charged": 2.0,
  "cached": false,
  "processing_time_ms": 2134,
  "steps_run": ["verify", "assess", "preflight"]
}
```

### Example 3: Non-crypto (general domain)

**Request:**
```json
{
  "check": "I want to invoke skill 'weather-forecast' to get tomorrow's weather for NYC. Is it reliable?",
  "tier": "quick",
  "domain": "general"
}
```

**Response (0.5 credits, ~280ms):**
```json
{
  "id": "mfst_9cd3oy5x",
  "verdict": "PROCEED",
  "confidence": 0.91,
  "summary": "PROCEED: Skill 'weather-forecast' is healthy with 97.2% success rate.",
  "preflight": {
    "viable": true,
    "risk_level": "CLEAR",
    "checks": [
      { "check": "skill_health", "passed": true, "value": "HEALTHY" },
      { "check": "success_rate", "passed": true, "value": "97.2%", "threshold": "Min 90%" },
      { "check": "avg_latency", "passed": true, "value": "340ms", "threshold": "Max 5000ms" },
      { "check": "cost", "passed": true, "value": "0.5 credits" }
    ],
    "estimated_cost": { "credits": 0.5, "usd": 0.0005 },
    "blockers": [],
    "suggestions": []
  },
  "memory": {
    "manifest_id": "mfst_9cd3oy5x",
    "prior_checks": 0,
    "from_memory": false
  },
  "tier": "quick",
  "domain": "general",
  "credits_charged": 0.5,
  "cached": false,
  "processing_time_ms": 276,
  "steps_run": ["preflight"]
}
```

---

## 15. RELATIONSHIP TO INTELLIGENCE SUITE

### Decision: Manifest is infrastructure. Intelligence Suite skills are domain expertise.

The four Intelligence Suite skills (VIE, Context Engine, Agent Trust Score, Predictive Alerts) are deep, domain-specific analysis tools. They exist on the marketplace, have their own pricing, and agents call them directly when they need deep reports.

Manifest is a lightweight, universal decision checkpoint that draws from them when relevant:

| Manifest Step | Uses Which Engine | How | When |
|---|---|---|---|
| Verify | Cross-verify data layer | Direct function import | Always, for structured claims |
| Assess | Context Engine | Reads `intel_events` for anomaly data | When premises reference crypto entities (Standard/Deep) |
| Preflight (swap) | VIE | Reads `intel_scores` for cached trust score; calls `computeVieScore()` if no recent score | Always for swap/transfer/stake/mint actions |
| Preflight (transfer) | Agent Trust | Reads `intel_scores` for destination trust | Always for transfer actions |
| Deep tier analysis | Predictive Alerts | Queries `intel_events` for recent alert patterns | Deep tier only, for forward-looking context |

**Billing:** When Manifest calls VIE/Context/Trust engines internally, it does NOT charge separately. The manifest tier price covers everything. Engine functions are called directly (imported, not HTTP), so there is no double-billing and no latency overhead.

**Coexistence:** An agent can call Manifest AND VIE in the same workflow. Manifest for quick decision support ("should I?"), VIE for deep safety analysis ("tell me everything about this token"). They serve different needs.

---

## 16. IMPLEMENTATION PLAN

### Phase 1: Core Engine (2 days)

1. Create `src/core/manifest-engine.ts`
   - `runManifest()` — orchestrates all steps
   - `verifyClaims()` — CLAIM_VERIFIERS registry + source fetching + verdict resolution
   - `assessReasoning()` — premise verification + pattern matching + LLM (Deep)
   - `preflightCheck()` — ACTION_HANDLERS dispatch + domain checks
   - `manifestMemory()` — dedup + history lookup + write
   - `computeVerdict()` — severity aggregation
   - `generateSummary()` — tier-dependent summary
   - `parseMinimalRequest()` — LLM free-text parsing

2. Create `src/db/manifest.ts`
   - `writeManifestMemory()` — insert row
   - `queryManifestMemory()` — parameterized query with filters
   - `recordManifestOutcome()` — update outcome columns
   - `getManifestById()` — lookup by ID + API key
   - `getRecentManifests()` — subject-based history
   - `getOutcomeStats()` — aggregate stats for Deep tier pattern analysis

### Phase 2: Route + Migration (1 day)

3. Create `src/routes/manifest.ts`
   - `POST /v1/manifest` — main endpoint
   - `GET /v1/manifest/memory` — query history
   - `POST /v1/manifest/outcome` — report outcomes
   - Zod validation, billing, audit logging

4. Update `src/db/connection.ts` — migration v79
5. Update `src/db/index.ts` — barrel export
6. Update `src/index.ts` — mount router

### Phase 3: Action Handlers (1.5 days)

7. Implement crypto ACTION_HANDLERS: swap, transfer, stake, mint
   - Integrate with VIE scores (read from `intel_scores`, fallback to `computeVieScore()`)
   - Liquidity/slippage checks via `clawApiCall()` to dexscreener
   - Gas estimation via Solana RPC (if available) or static estimate

8. Implement platform ACTION_HANDLERS: invoke_skill, api_call, data_purchase
   - Skill health from `skill-health-cron.ts` cache
   - Endpoint health from `endpoint-health-cron.ts` cache
   - Circuit breaker state from `circuit-breaker.ts`

9. Implement `_generic` handler for unknown action types

### Phase 4: Testing (1.5 days)

10. Create `tests/unit/manifest.test.ts`
    - Verify step: structured claims, raw parsing, weighted majority, all-sources-down
    - Assess step: premise verification, pattern matching, contradiction detection, scoring
    - Preflight step: each action handler, budget validation, unknown action fallback
    - Memory: dedup, history lookup, outcome recording
    - Verdict logic: all severity combinations
    - Integration: full runManifest() with mocked dependencies

### Phase 5: Cleanup Cron (0.25 days)

11. Add manifest_memory cleanup to daily cron:
    ```typescript
    // In cache-warming-cron.ts or dedicated cleanup cron
    let deleted = 0;
    do {
      const result = getDb().prepare(
        "DELETE FROM manifest_memory WHERE created_at < datetime('now', '-90 days') LIMIT 5000"
      ).run();
      deleted = result.changes;
    } while (deleted === 5000);
    ```

### Total: ~6.25 days

| Component | Effort |
|---|---|
| `manifest-engine.ts` (core logic) | 2 days |
| `manifest.ts` route (HTTP layer) | 0.75 days |
| `manifest.ts` DB layer | 0.5 days |
| CLAIM_VERIFIERS + source integration | 0.5 days |
| ACTION_HANDLERS (crypto) | 1 day |
| ACTION_HANDLERS (platform) | 0.5 days |
| Migration + barrel + registration | 0.25 days |
| Testing | 1.5 days |
| Cleanup cron | 0.25 days |
| **Total** | **~6.25 days** |

---

## 17. OPEN QUESTIONS (RESOLVED)

**Q: Should Manifest require authentication?**
A: Yes. API key required (`checkApiKey` middleware). Memory is keyed by API key. Anonymous access would have no memory, no billing, and no value.

**Q: Should Manifest support streaming?**
A: No. The response is structured JSON. Streaming adds complexity for no benefit. Deep tier may feel slow (3-8s) but the agent is waiting for a verdict, not reading a narrative.

**Q: Rate limiting?**
A: Standard per-key rate limiting from middleware. No Manifest-specific limits. Credit cost is the natural throttle.

**Q: What about the old "checkpoint" name?**
A: Renamed to Manifest everywhere. The old spec at `specs/agent-checkpoint-spec.md` is superseded by this document. All table names, route paths, and function names use "manifest."

**Q: What if an agent sends only `preflight` with no `verify` or `assess`?**
A: That is valid. Manifest runs only the steps provided. An agent that just wants a preflight check gets one. The verdict is based solely on preflight results.

**Q: Should outcome reporting cost credits?**
A: No. Outcome data is more valuable to ClawNet than the ~0.1cr we could charge. Free reporting maximizes the feedback loop.

**Q: Should the `domain` field restrict functionality?**
A: No. It is a hint, not a gate. A `domain: 'general'` request that includes a crypto claim type still verifies it against crypto sources. The domain field helps the LLM parser and pattern matcher choose appropriate defaults, but it never blocks functionality.

**Q: How does Manifest handle claims it has never seen before (e.g., "this restaurant has 4.5 stars")?**
A: It returns `verdict: 'unverifiable', reason: 'No verification source registered for this claim type'`. This is honest and correct. As more data skills join the marketplace covering restaurant data, review data, etc., these claims become verifiable without any Manifest code changes — just a registry entry mapping the new claim type to the new endpoints.
