# Intelligence Suite — Architecture Specification

**ClawNet's Interconnected Data Skill Stack**

Four skills that individually are useful and together form a compounding intelligence moat. This document is the foundation reference for building skills 2-4 so they integrate seamlessly with VIE and with each other.

---

## 1. The Four Skills

| # | Skill | Question It Answers | Core Function |
|---|-------|---------------------|---------------|
| 1 | **VIE (Verified Intelligence Engine)** | "Is this safe?" | Cross-references 5 sources, scores trust 0-100. ALREADY BUILT. |
| 2 | **Context Engine** | "What does this mean?" | Normalized, LLM-enriched data with anomaly detection against historical baselines. |
| 3 | **Agent Trust Score** | "Who should I trust?" | Reputation scoring for wallets, deployers, and ClawNet agents using proprietary platform data. |
| 4 | **Predictive Alert Engine** | "What's about to happen?" | Forward-looking pattern matching across VIE history, context anomalies, and on-chain signals. |

---

## 2. Shared Data Layer

### 2.1 Entity Profile (the universal subject)

Every intelligence query targets an **entity**. An entity is a token, wallet, contract, or agent. All 4 skills share the same entity identity system so their outputs are joinable.

```
Entity identity = (address, entity_type, chain)
```

- `address`: mint address, wallet pubkey, contract address, or ClawNet API key hash
- `entity_type`: `token | wallet | contract | agent`
- `chain`: `solana | ethereum | base`

The `intel_entities` table is the shared registry. Any skill that evaluates an entity upserts a row here. This table is the join key for cross-skill queries.

### 2.2 Intelligence Event Stream

All 4 skills write to a single `intel_events` table. This is the shared event log that enables:
- Predictive Alert Engine to pattern-match across all skill outputs
- Context Engine to build anomaly baselines from VIE scoring history
- Agent Trust Score to track which agents queried what (behavioral signal)
- Time-series analysis across all intelligence dimensions

Events are append-only, immutable, and timestamped. Each event has a `skill_id`, `entity_id`, `event_type`, and a `payload_json` for skill-specific data.

### 2.3 Common Scoring Rubric

All skills produce a primary score on a **0-100 scale** with a **0.0-1.0 confidence value**. This makes scores comparable across skills and composable in UIs.

| Score Range | Level | Color (UI hint) |
|-------------|-------|-----------------|
| 80-100 | VERIFIED / SAFE / TRUSTED | Green |
| 60-79 | LOW risk / FAVORABLE | Light green |
| 40-59 | MEDIUM / MIXED | Yellow |
| 20-39 | HIGH risk / POOR | Orange |
| 0-19 | CRITICAL / DANGEROUS / UNTRUSTED | Red |

Confidence modifies how much weight to give the score:
- `>= 0.8` — high confidence, score is reliable
- `0.5-0.79` — moderate confidence, treat as directional
- `< 0.5` — low confidence, flag for user and suggest more data

### 2.4 Shared SQLite Tables (migration v78)

See Section 8 for the full migration SQL. Summary of shared tables:

| Table | Purpose | Written by | Read by |
|-------|---------|------------|---------|
| `intel_entities` | Entity profiles with last-known metadata | All 4 | All 4 |
| `intel_events` | Append-only event stream | All 4 | Predictive Alert, Context Engine |
| `intel_scores` | Latest score per (entity, skill) pair | All 4 | All 4 (cross-referencing) |
| `intel_subscriptions` | Webhook/alert subscriptions per entity | Predictive Alert | Predictive Alert |

The existing `vie_reports` table (v77) remains as-is for VIE-specific deep storage. The shared tables are a lightweight overlay that enables cross-skill correlation without migrating VIE's existing data model.

---

## 3. Skill Dependency Graph

### 3.1 Call Relationships

```
                    ┌─────────────────────┐
                    │  Predictive Alert    │
                    │  Engine              │
                    └──────┬──────┬───────┘
                           │      │
                    reads  │      │ reads
                    events │      │ anomalies
                           │      │
              ┌────────────┘      └────────────┐
              ▼                                ▼
    ┌──────────────────┐            ┌──────────────────┐
    │  VIE              │◄───────────│  Context Engine   │
    │  (Safety Scoring) │  calls for │  (Enrichment +    │
    └──────────────────┘  safety     │   Anomaly Detect) │
              ▲            check     └──────────────────┘
              │                                ▲
              │  reads                         │ reads
              │  query history                 │ entity context
              │                                │
    ┌──────────────────┐                       │
    │  Agent Trust      │───────────────────────┘
    │  Score             │  enriches trust with
    └──────────────────┘   contextual data
```

### 3.2 Detailed Dependencies

**VIE (Skill 1) — no upstream dependencies**
- Reads: 5 external data sources (rugmunch, apollo, dexscreener, claw-x-mentions, claw-token)
- Writes: `vie_reports`, `intel_events`, `intel_scores`, `intel_entities`
- Called by: Context Engine (safety pre-check), Agent Trust Score (historical patterns)

**Context Engine (Skill 2) — depends on VIE**
- Calls VIE internally when it encounters an entity it hasn't seen before (or whose VIE score is stale > 1h). This is an internal call, not a composite skill dependency — it reads from `intel_scores` first and only calls VIE's engine functions directly if no recent score exists.
- Reads: `intel_events` (for historical baselines), `intel_entities`, `intel_scores` (for VIE score)
- Writes: `intel_events` (anomaly detections), `intel_scores`, `intel_entities`
- Uses LLM for: enrichment narratives, anomaly classification

**Agent Trust Score (Skill 3) — depends on VIE + Context Engine**
- Reads: `intel_scores` (VIE + Context scores for entities the agent interacted with)
- Reads: ClawNet internal tables — `transactions`, `skill_metrics`, `reputations`, `api_keys` usage patterns
- Writes: `intel_events`, `intel_scores` (agent entity type), `intel_entities`
- Does NOT call VIE or Context Engine at runtime — reads their stored scores. This is a read-dependency, not a call-dependency.

**Predictive Alert Engine (Skill 4) — reads from all 3**
- Reads: `intel_events` (full stream from all skills), `intel_scores` (all dimensions)
- Reads: `vie_reports` (historical score trajectories)
- Reads: External data for real-time signals (price feeds, volume spikes)
- Writes: `intel_events` (alert events), `intel_subscriptions` (manages alert configs)
- Does NOT call other skills at runtime — pattern matches against their stored outputs.

### 3.3 Key Design Decision: Read-Dependencies, Not Call-Dependencies

Skills 3 and 4 do NOT invoke skills 1 and 2 via the composite skill system. They read from the shared `intel_scores` and `intel_events` tables. This is critical because:

1. **Cost efficiency** — an Agent Trust Score query shouldn't trigger 3 VIE calls. It reads what's already been scored.
2. **Latency** — cascading skill calls would make Skill 4 unacceptably slow.
3. **Decoupling** — if VIE is temporarily degraded, Skills 3 and 4 still work with stale data (lower confidence, but functional).

The only call-dependency is Context Engine → VIE, and even that is conditional (only when no recent VIE score exists for the entity).

---

## 4. Customer Journey & Progressive Disclosure

### 4.1 The Natural Progression

```
NEED                              SKILL            WHAT THEY LEARN
────────────────────────────────────────────────────────────────────
"I found a new token. Safe?"  →   VIE Shield   →   Trust score, risk level

"Score is 62. What does         →   Context      →   WHY the score is what it is,
 that actually mean?"               Lens              what's normal vs anomalous

"I want to know before it       →   Predictive   →   Alerts when patterns shift,
 dumps, not after"                  Radar              before the crowd notices

"Which trading bot should       →   Agent Trust  →   Reputation scores for
 I trust with my money?"            Sovereign          counterparties and agents
```

Each level answers the question the previous level raises. VIE tells you the score; you wonder what it means. Context explains it; you wonder how to act earlier. Predictive tells you early; you wonder who to trust to act on your behalf.

### 4.2 Concrete Upsell Triggers

**VIE → Context Engine:**
- When VIE returns a MEDIUM score (40-59), the response includes: `"upgrade_hint": "This token has mixed signals. Context Engine can explain exactly which factors are driving the score and whether this pattern is unusual. Add Lens for $X/mo."`
- When VIE returns a score that changed significantly from the last query: `"score_changed": true, "previous_score": 73, "upgrade_hint": "Score dropped 11 points since last check. Context Engine tracks these movements and flags anomalies."`

**Context Engine → Predictive Alert:**
- When Context Engine detects an anomaly: `"anomaly_detected": true, "upgrade_hint": "This pattern has preceded price drops in 68% of similar tokens. Predictive Alert Engine can watch for these patterns and notify you automatically."`

**Predictive Alert → Agent Trust Score:**
- When an alert fires about an entity the user trades with: `"alert_action": "You received an alert about a token. Agent Trust Score can evaluate the agent/bot that recommended it to you."`

### 4.3 First-Touch Hooks

- **First VIE call free** — any new API key gets 1 complimentary VIE Standard report. Zero risk to try. The response format sells the depth of data.
- **VIE Quick at 0.25cr** (reduced from 0.5cr) — this is the gateway drug. An agent running continuous monitoring pays $0.00025 per safety check. At that price, there's no reason NOT to check every token.
- **Context Engine "sample anomaly"** — when a user has made 5+ VIE calls, auto-generate a Context Engine preview showing anomalies across their queried entities. Delivered via webhook or in the VIE response as a `context_preview` field.

---

## 5. Intelligence Suite Product Tiers

### 5.1 Tier Definitions

| Tier | Name | Skills Included | Monthly (credits) | Per-Query |
|------|------|-----------------|-------------------|-----------|
| — | Pay-as-you-go | Any individual skill | No subscription | See individual pricing |
| 1 | **Shield** | VIE only | 100cr/mo (includes 200 Quick checks) | Quick: 0.25cr, Standard: 1.5cr, Deep: 3.0cr |
| 2 | **Lens** | VIE + Context Engine | 300cr/mo (includes Shield + 100 Context queries) | Context: 2.0cr |
| 3 | **Radar** | VIE + Context + Alerts | 750cr/mo (includes Lens + unlimited alert subscriptions + 50 pattern analyses) | Pattern analysis: 3.0cr, Alert subscription: 0cr (included) |
| 4 | **Sovereign** | All 4 skills | 1500cr/mo (includes Radar + 200 Agent Trust queries) | Agent Trust: 2.5cr |

### 5.2 Pricing Philosophy

- **Pay-as-you-go is always available.** Subscriptions are a commitment discount (roughly 25-40% cheaper per-query than pay-as-you-go at expected usage).
- **Subscriptions don't lock out individual skills.** A Shield subscriber can still buy a one-off Context Engine query at full price.
- **Overage is billed at pay-as-you-go rates.** Monthly allocation exhausted? Keep going at standard per-query pricing. No shutoffs.
- **Bundle does NOT cannibalize individual revenue** because individual pricing is set 30-40% higher than the per-query effective rate at subscription volumes. The bundle is the better deal, which is the point — it increases LTV.

### 5.3 Implementation

Subscriptions are implemented as recurring credit top-ups with a `subscription_tier` column on `api_keys`. When a subscription is active:
- The monthly credit allocation is topped up on the billing anniversary
- Tier-specific features are unlocked (e.g., alert subscriptions for Radar+)
- Per-query deductions work identically to pay-as-you-go (same billing infrastructure)

This means subscriptions require NO special billing code paths. They're just pre-paid credit bundles with a tier flag that unlocks features.

---

## 6. Individual Skill Pricing

### 6.1 VIE (already built — adjust Quick tier)

| Tier | Credits | What You Get |
|------|---------|-------------|
| Quick | **0.25cr** (was 0.5) | Trust score, risk level, recommendation, confidence. Cached results at 10% cost. |
| Standard | 1.5cr | Quick + per-category factor scores, overrides list. |
| Deep | 3.0cr | Standard + LLM-synthesized verdict, evidence chain, comparable tokens. |

### 6.2 Context Engine

| Tier | Credits | What You Get |
|------|---------|-------------|
| Summary | 1.0cr | Normalized entity profile, current state, 1-line context summary. |
| Standard | 2.0cr | Summary + anomaly detection against 30-day baseline, category breakdowns. |
| Deep | 4.0cr | Standard + LLM-enriched narrative, trend analysis, comparable entity behavior. |

### 6.3 Agent Trust Score

| Tier | Credits | What You Get |
|------|---------|-------------|
| Quick | 1.0cr | Trust score 0-100, confidence, risk level. |
| Standard | 2.5cr | Quick + behavioral breakdown (transaction patterns, skill usage, dispute history). |
| Deep | 5.0cr | Standard + LLM-synthesized trust narrative, peer comparison, red flag analysis. |

### 6.4 Predictive Alert Engine

| Tier | Credits | What You Get |
|------|---------|-------------|
| Subscribe | 0cr (with Radar/Sovereign) or 5cr one-time setup | Register an entity for monitoring. Alerts fire to webhook. |
| Pattern Analysis | 3.0cr | On-demand: "What patterns exist for this entity across all intelligence dimensions?" |
| Deep Forecast | 6.0cr | Pattern Analysis + LLM-synthesized forward-looking assessment with confidence intervals. |

---

## 7. Common Response Envelope

Every Intelligence Suite skill returns this shape. Consumers parse ONE format regardless of which skill they called.

```typescript
interface IntelligenceResponse {
  // ─── Identity ───────────────────────────────────────────────
  skill: 'vie' | 'context' | 'trust' | 'alert';
  version: '1.0';
  request_id: string;

  // ─── Target ─────────────────────────────────────────────────
  target: {
    address: string;
    type: 'token' | 'wallet' | 'contract' | 'agent';
    chain: 'solana' | 'ethereum' | 'base';
    name?: string;          // human-readable if known (e.g., "BONK")
    first_seen?: string;    // ISO 8601 — when this entity first appeared in our data
  };

  // ─── Primary Score ──────────────────────────────────────────
  score: {
    value: number;          // 0-100
    confidence: number;     // 0.0-1.0
    level: 'VERIFIED' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    previous?: number;      // last known score (if entity was scored before)
    delta?: number;         // score change since previous
    trend?: 'improving' | 'stable' | 'declining';
  };

  // ─── Skill-Specific Intelligence ───────────────────────────
  intelligence: Record<string, unknown>;
  // VIE: { factors, overrides_applied, explanation?, evidence? }
  // Context: { anomalies, baseline, enrichment, category_scores }
  // Trust: { behavioral_signals, transaction_patterns, dispute_history }
  // Alert: { active_alerts, pattern_matches, forecast? }

  // ─── Cross-Skill References ────────────────────────────────
  related: {
    vie_score: number | null;
    vie_level: string | null;
    vie_updated: string | null;
    context_summary: string | null;
    context_anomaly_count: number | null;
    context_updated: string | null;
    trust_score: number | null;
    trust_level: string | null;
    trust_updated: string | null;
    active_alerts: number | null;
    alert_updated: string | null;
  };

  // ─── Metadata ──────────────────────────────────────────────
  meta: {
    cached: boolean;
    data_age_seconds: number;
    credits_charged: number;
    tier: string;
    sources_consulted: number;
    processing_time_ms: number;
  };

  // ─── Upsell (optional) ────────────────────────────────────
  upgrade_hint?: string;
}
```

### 7.1 Cross-Referencing Rules

Every skill response populates the `related` block by reading from `intel_scores`:

```sql
SELECT skill_id, score_value, score_level, updated_at
FROM intel_scores
WHERE entity_address = ? AND entity_chain = ?
ORDER BY updated_at DESC
```

This is a single indexed query. If no data exists for a skill, the field is `null`. This means:
- A VIE response for a token you've also run Context Engine on will include the context summary.
- An Agent Trust Score response will include the VIE score for the agent's most-queried entities.
- Every response gets richer as the customer uses more skills — a natural incentive to expand.

### 7.2 Backward Compatibility for VIE

VIE's existing response format (`POST /v1/vie/report`) remains unchanged. The Intelligence Suite envelope is returned by a NEW endpoint: `POST /v1/intel/{skill}/report`. VIE's existing route continues to work as-is — no breaking change.

Internally, the VIE route handler will also write to `intel_events` and `intel_scores` (added as a non-blocking write at the end of the existing handler, same pattern as the current `vie_reports` insert).

---

## 8. Foundation Tables — Migration v78

These tables should be added NOW so VIE starts populating them immediately. When skills 2-4 are built months from now, they'll have months of VIE data already in the shared tables.

```sql
-- v78: Intelligence Suite shared tables
-- Entity profiles — universal identity registry for all intelligence targets
CREATE TABLE IF NOT EXISTS intel_entities (
  id TEXT PRIMARY KEY,                              -- nanoid
  address TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'token',         -- token | wallet | contract | agent
  chain TEXT NOT NULL DEFAULT 'solana',
  name TEXT,                                         -- human-readable (BONK, etc.)
  metadata_json TEXT,                                -- flexible: { symbol, decimals, program, ... }
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_scored TEXT,                                   -- last time ANY skill scored this entity
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(address, entity_type, chain)
);
CREATE INDEX IF NOT EXISTS idx_intel_entities_address ON intel_entities(address, chain);
CREATE INDEX IF NOT EXISTS idx_intel_entities_type ON intel_entities(entity_type);

-- Intelligence scores — latest score per (entity, skill) pair
-- This is the cross-referencing table that powers the `related` block in responses
CREATE TABLE IF NOT EXISTS intel_scores (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES intel_entities(id),
  entity_address TEXT NOT NULL,                       -- denormalized for fast lookups
  entity_chain TEXT NOT NULL DEFAULT 'solana',         -- denormalized
  skill_id TEXT NOT NULL,                              -- 'vie' | 'context' | 'trust' | 'alert'
  score_value INTEGER NOT NULL,                        -- 0-100
  score_confidence REAL NOT NULL,                      -- 0.0-1.0
  score_level TEXT NOT NULL,                           -- VERIFIED | LOW | MEDIUM | HIGH | CRITICAL
  summary TEXT,                                        -- 1-line human-readable summary
  detail_json TEXT,                                    -- skill-specific score breakdown
  previous_score INTEGER,                              -- last score before this one
  score_delta INTEGER,                                 -- change from previous
  scored_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_intel_scores_entity_skill
  ON intel_scores(entity_address, entity_chain, skill_id);
CREATE INDEX IF NOT EXISTS idx_intel_scores_skill ON intel_scores(skill_id, scored_at);
CREATE INDEX IF NOT EXISTS idx_intel_scores_level ON intel_scores(score_level);

-- Intelligence events — append-only event stream across all skills
-- This is the foundation for Predictive Alert Engine pattern matching
-- and Context Engine anomaly detection baselines
CREATE TABLE IF NOT EXISTS intel_events (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES intel_entities(id),
  entity_address TEXT NOT NULL,                       -- denormalized
  entity_chain TEXT NOT NULL DEFAULT 'solana',         -- denormalized
  skill_id TEXT NOT NULL,                              -- which skill produced this event
  event_type TEXT NOT NULL,                            -- SCORE_CHANGE | ANOMALY | ALERT_FIRED | PATTERN_MATCH | TRUST_CHANGE | QUERY
  severity TEXT NOT NULL DEFAULT 'info',               -- info | warning | critical
  payload_json TEXT NOT NULL,                          -- event-specific data
  api_key_hash TEXT,                                   -- SHA-256 of querying key (behavioral signal, never raw key)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_intel_events_entity ON intel_events(entity_address, entity_chain, created_at);
CREATE INDEX IF NOT EXISTS idx_intel_events_type ON intel_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_intel_events_skill ON intel_events(skill_id, created_at);
CREATE INDEX IF NOT EXISTS idx_intel_events_severity ON intel_events(severity)
  WHERE severity IN ('warning', 'critical');

-- Alert subscriptions — what entities to watch and where to send alerts
CREATE TABLE IF NOT EXISTS intel_subscriptions (
  id TEXT PRIMARY KEY,
  api_key TEXT NOT NULL,                               -- subscriber's API key
  entity_address TEXT NOT NULL,
  entity_chain TEXT NOT NULL DEFAULT 'solana',
  entity_type TEXT NOT NULL DEFAULT 'token',
  alert_types TEXT NOT NULL DEFAULT '["SCORE_CHANGE","ANOMALY"]',  -- JSON array of event types
  threshold_json TEXT,                                  -- { "score_drop": 10, "confidence_below": 0.5 }
  webhook_url TEXT,                                     -- where to POST alerts (null = poll via API)
  active INTEGER NOT NULL DEFAULT 1,
  last_fired_at TEXT,
  fire_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_intel_subs_key ON intel_subscriptions(api_key, active);
CREATE INDEX IF NOT EXISTS idx_intel_subs_entity ON intel_subscriptions(entity_address, entity_chain, active);
```

### 8.1 VIE Integration (build now)

After the migration, add the following to the VIE route handler (`src/routes/vie.ts`) as a non-blocking write after the existing `vie_reports` insert:

```typescript
// Write to shared intelligence tables (non-blocking)
try {
  const entityId = upsertIntelEntity(target, target_type, chain);
  upsertIntelScore(entityId, target, chain, 'vie', result.trust_score, result.confidence, result.risk_level, /* summary */);
  appendIntelEvent(entityId, target, chain, 'vie', 'SCORE_CHANGE', 'info', { trust_score: result.trust_score, tier, factors: result.factors });
} catch (err) {
  logger.warn({ err }, 'Intel shared table write failed — non-blocking');
}
```

These helper functions go in a new file: `src/db/intel.ts`, re-exported via the barrel.

---

## 9. Data Flywheel Design

### 9.1 How the Four Databases Feed Each Other

```
Month 1-3: VIE builds trust pattern database
  └── "Token X had score 85 on day 1, dropped to 30 by day 7 → rug pull confirmed"
  └── "Tokens with contract_safety < 30 AND holder_concentration > 60% fail 89% of the time"
  └── This historical pattern data IS the training set for Predictive Alert Engine

Month 3-6: Context Engine builds anomaly baseline database
  └── "Normal behavior for a 30-day-old Solana token with >1000 holders looks like THIS"
  └── "This token's volume pattern deviates 3.2σ from its peer group"
  └── Anomaly baselines feed back to VIE: a "normal" score of 65 means something different
      for a 1-day token vs a 6-month token. Context provides the baseline.

Month 4-8: Predictive Alert Engine builds prediction accuracy database
  └── "Pattern X (VIE score drop + volume spike + holder concentration increase)
       preceded a >50% price drop within 72h in 73% of historical cases"
  └── Prediction accuracy feeds back to confidence scores across all skills.
  └── Confirmed predictions validate VIE's scoring model and Context's anomaly thresholds.

Month 6-12: Agent Trust Score builds reputation graph
  └── "Agents that consistently queried high-risk tokens before crashes = suspicious"
  └── "Agents with >90% VIE-verified trade history = trustworthy counterparties"
  └── Reputation data feeds back to Context Engine: known-bad-actor wallets get
      flagged automatically in context reports.
```

### 9.2 The Compounding Loop

```
VIE scores entity
  → Context Engine detects anomaly (uses VIE history as baseline)
    → Predictive Alert fires (uses VIE trajectory + Context anomaly)
      → Agent Trust Score updates (agent that held this entity gets -reputation)
        → Next VIE query on related entity has richer context
          → Context Engine anomaly detection is sharper (more data points)
            → Predictions get more accurate (validated patterns)
              → ...
```

Each skill's output makes every other skill's output more accurate. This is the moat.

### 9.3 Data Moat Timeline

**After 6 months:**
- VIE has scored tens of thousands of entities with outcome tracking (did the score predict reality?)
- Context Engine has baseline behavior profiles for every active Solana token
- Proprietary dataset: "what does normal look like for crypto entity type X at age Y"
- No competitor can replicate this without the same query volume

**After 12 months:**
- Predictive patterns validated against real outcomes (accuracy metrics published)
- Agent Trust graph covers the active DeFi agent ecosystem
- Cross-skill correlation data reveals patterns invisible to any single data source
- The flywheel is self-reinforcing: more queries → better baselines → better predictions → more queries

### 9.4 What Makes This a Moat (Not Just a Feature)

1. **Proprietary query data.** Every VIE call teaches us what entities agents care about. This attention data is unavailable to anyone outside ClawNet.
2. **Outcome tracking.** VIE's `outcome` and `outcome_at` columns on `vie_reports` create a labeled dataset. Did the 85-score token actually stay safe? Did the 23-score token actually rug? This is ML training data that improves with every confirmed outcome.
3. **Cross-entity correlation.** When the same deployer wallet creates 5 tokens and 3 rugged, VIE learns deployer patterns. Context Engine surfaces the connection. Predictive Alert fires on the 6th token before it launches. No single-skill system can do this.
4. **Agent behavioral data.** Which agents consistently query risky tokens? Which agents have high VIE score correlation with profitable trades? This is ClawNet-exclusive intelligence.

---

## 10. Customer Incentive Structure

### 10.1 Acquisition

| Incentive | Mechanism | Goal |
|-----------|-----------|------|
| First VIE call free | New API keys get 1 complimentary VIE Standard (1.5cr value) | Zero-friction trial |
| VIE Quick at 0.25cr | Permanent low floor | Make safety checks a reflex |
| Free VIE Quick on signup | 10 free Quick checks (2.5cr) bundled with new account | Build habit |
| Intelligence preview | After 5+ VIE calls, auto-include a `context_preview` snippet in VIE responses | Tease Context Engine |

### 10.2 Volume Incentives

Intelligence Suite calls get their own volume discount tier, stacking with the platform's existing credit volume pricing:

| Monthly Intelligence Calls | Discount |
|---------------------------|----------|
| 1-100 | Base price |
| 101-500 | 10% off per-query cost |
| 501-2000 | 20% off |
| 2001-10000 | 30% off |
| 10000+ | Custom (contact) |

Implemented via `dynamicCreditCost()` — the existing volume discount infrastructure handles this. Intelligence skills tag their transactions with `category: 'intelligence'` for volume tracking.

### 10.3 Loyalty

- **30-day active agent:** 5% permanent discount on all Intelligence Suite skills (applied via a `loyalty_discount` flag on the API key, checked at billing time).
- **90-day active agent:** 10% permanent discount.
- Discount is on the credit cost, not the USD price. This means loyal agents get more intelligence per dollar.

### 10.4 Referral

Existing ClawNet referral system applies. Additionally:
- Agent that refers another agent earns 10% of the referred agent's Intelligence Suite spend for 90 days.
- Capped at 500cr per referral (prevents gaming).

### 10.5 VIE Quick Pricing Decision: 0.25cr

Reducing VIE Quick from 0.5cr to 0.25cr:
- **Revenue impact:** Quick is the gateway. Volume will increase more than 2x to compensate for the price cut.
- **Strategic value:** At 0.25cr, an agent can safety-check 4000 tokens per dollar. This makes "check everything" the default behavior, which feeds the data flywheel.
- **Upsell math:** If 10% of Quick users upgrade to Standard (1.5cr) or Deep (3.0cr), the blended revenue per user exceeds the Quick-only revenue at 0.5cr.

---

## 11. API Design

### 11.1 Route Structure

All Intelligence Suite skills live under `/v1/intel/`:

```
POST /v1/intel/vie/report           — VIE analysis (new unified endpoint)
POST /v1/intel/context/report       — Context Engine analysis
POST /v1/intel/trust/report         — Agent Trust Score
POST /v1/intel/alert/subscribe      — Create alert subscription
POST /v1/intel/alert/analyze        — On-demand pattern analysis
GET  /v1/intel/alert/subscriptions  — List active subscriptions
DELETE /v1/intel/alert/:id          — Remove subscription

GET  /v1/intel/entity/:address      — Cross-skill entity profile
GET  /v1/intel/history/:address     — Score history across all skills
GET  /v1/intel/events/:address      — Event stream for an entity

POST /v1/intel/suite/report         — Multi-skill query in one call
                                       (runs VIE + Context + Trust in parallel,
                                        returns combined envelope)
```

The existing `/v1/vie/report` endpoint remains for backward compatibility. It returns the current VIE-specific format. The new `/v1/intel/vie/report` returns the unified envelope.

### 11.2 The Suite Endpoint

`POST /v1/intel/suite/report` is the power endpoint. It accepts:

```json
{
  "target": "TokenMintAddress...",
  "target_type": "token",
  "chain": "solana",
  "skills": ["vie", "context", "trust"],
  "tier": "standard",
  "budget_max_credits": 10
}
```

It runs the requested skills in parallel (or sequentially if there are dependencies), merges their outputs into a single response, and bills once. The combined cost is the sum of individual skill costs minus a 15% bundle discount.

### 11.3 Webhook Integration

Intelligence events fire webhooks when:
1. An alert subscription matches a new event
2. A score changes by more than the configured threshold
3. An anomaly is detected at severity `warning` or `critical`

Webhook delivery uses the existing `signWebhookPayload()` infrastructure with `X-ClawNet-Signature` + `X-ClawNet-Timestamp` headers.

---

## 12. Shared Infrastructure to Build NOW

Even though only VIE exists today, build these pieces now so skills 2-4 integrate seamlessly:

### 12.1 Build Immediately (with v78 migration)

| Component | File | Purpose |
|-----------|------|---------|
| `intel_entities`, `intel_scores`, `intel_events`, `intel_subscriptions` tables | `src/db/connection.ts` (migration v78) | Shared data layer |
| `src/db/intel.ts` | New file | `upsertIntelEntity()`, `upsertIntelScore()`, `appendIntelEvent()`, `getEntityProfile()`, `getRelatedScores()`, `getEntityEvents()` |
| Barrel export | `src/db/index.ts` | Add `export * from './intel'` |
| VIE integration | `src/routes/vie.ts` | Non-blocking writes to shared tables after existing VIE logic |
| Response builder | `src/core/intel-envelope.ts` | New file: `buildIntelResponse()` takes skill output + related scores → unified envelope |
| Intel routes | `src/routes/intel.ts` | New file: `/v1/intel/entity/:address`, `/v1/intel/history/:address`, `/v1/intel/events/:address` — read-only queries against shared tables |

### 12.2 Build When Context Engine Ships

| Component | File | Purpose |
|-----------|------|---------|
| `src/core/context-engine.ts` | New file | Anomaly detection, baseline computation, LLM enrichment |
| `src/core/context-sources.ts` | New file | Data fetching (reuses VIE source patterns) |
| Context route | `src/routes/intel.ts` (extend) | `POST /v1/intel/context/report` |

### 12.3 Build When Agent Trust Score Ships

| Component | File | Purpose |
|-----------|------|---------|
| `src/core/trust-scorer.ts` | New file | Reputation computation from ClawNet internal data |
| Trust route | `src/routes/intel.ts` (extend) | `POST /v1/intel/trust/report` |

### 12.4 Build When Predictive Alert Engine Ships

| Component | File | Purpose |
|-----------|------|---------|
| `src/core/alert-engine.ts` | New file | Pattern matching, subscription management, alert firing |
| `src/core/alert-patterns.ts` | New file | Pattern library (extracted from VIE outcome data) |
| `src/core/alert-cron.ts` | New file | Background cron that evaluates subscriptions against new events |
| Alert routes | `src/routes/intel.ts` (extend) | Alert CRUD + analysis endpoints |

---

## 13. Appendix: Entity Event Types

Standard event types that any skill can emit:

| Event Type | Emitted By | Meaning |
|------------|-----------|---------|
| `SCORE_CHANGE` | All 4 | Entity's score was computed or changed |
| `ANOMALY` | Context Engine | Behavior deviates from baseline |
| `ALERT_FIRED` | Predictive Alert | A subscription threshold was crossed |
| `PATTERN_MATCH` | Predictive Alert | A known pattern was detected |
| `TRUST_CHANGE` | Agent Trust Score | Agent's trust score changed |
| `QUERY` | All 4 | An intelligence query was made (behavioral signal) |
| `OUTCOME_CONFIRMED` | VIE (manual/auto) | Predicted outcome was confirmed |
| `ENTITY_LINKED` | Context Engine, Agent Trust | Two entities were identified as related |
| `RISK_ESCALATION` | VIE, Predictive Alert | Risk level increased (e.g., LOW → HIGH) |
| `RISK_DEESCALATION` | VIE, Predictive Alert | Risk level decreased |

---

## 14. Appendix: What NOT to Build

Explicit anti-patterns to avoid:

1. **Do NOT make skills call each other via HTTP.** Use shared tables and direct function imports. HTTP calls between co-located skills add latency, failure modes, and billing complexity for zero benefit.

2. **Do NOT create a separate database.** All intelligence tables live in the same SQLite database alongside the rest of ClawNet. WAL mode handles the concurrent read/write pattern fine.

3. **Do NOT build a custom event bus.** The `intel_events` table IS the event bus. Skills write to it; the alert cron reads from it. SQLite handles the throughput. If scale demands it later, swap the event reader to poll Redis — but don't over-engineer now.

4. **Do NOT duplicate VIE's scoring logic.** Context Engine and Agent Trust Score read VIE scores from `intel_scores`. They never re-implement the 5-source scoring algorithm.

5. **Do NOT create separate subscription/billing systems for the Intelligence Suite.** Use the existing `deductCredit()` / `trackDelegatedSpend()` / `round6()` infrastructure. Subscriptions are just pre-paid credit bundles.

6. **Do NOT break VIE's existing API.** The `/v1/vie/report` endpoint must continue returning its current format forever. New format lives at `/v1/intel/vie/report`.
