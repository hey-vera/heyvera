# ClawNet — Complete System Flows

Every flow in the system, from boot to shutdown. Tree diagrams show exact paths money, data, and auth take through the codebase.

---

## Table of Contents

1. [Master Flow](#1-master-flow)
2. [Boot Sequence](#2-boot-sequence)
3. [Authentication](#3-authentication)
4. [Credit Purchase — Stripe](#4-credit-purchase--stripe)
5. [Credit Purchase — Solana USDC](#5-credit-purchase--solana-usdc)
6. [Orchestration (LLM Query)](#6-orchestration-llm-query)
7. [Skill Invocation — prompt_template](#7-skill-invocation--prompt_template)
8. [Skill Invocation — api_proxy](#8-skill-invocation--api_proxy)
9. [Skill Invocation — data](#9-skill-invocation--data)
10. [Batch Queries](#10-batch-queries)
11. [Streaming](#11-streaming)
12. [OpenClaw Unified Gateway](#12-openclaw-unified-gateway)
13. [x402 Payment Flow](#13-x402-payment-flow)
14. [Marketplace Purchase](#14-marketplace-purchase)
15. [Creator Payout — Solana](#15-creator-payout--solana)
16. [Creator Payout — EVM Auto-Split](#16-creator-payout--evm-auto-split)
17. [Swarm Decomposition](#17-swarm-decomposition)
18. [Discovery](#18-discovery)
19. [Cache System](#19-cache-system)
20. [Escrow](#20-escrow)
21. [Staking](#21-staking)
22. [Agent Context Layer](#22-agent-context-layer)
23. [Referral System](#23-referral-system)
24. [Skill Creation](#24-skill-creation)
25. [Task System (Async)](#25-task-system-async)
26. [Admin Dashboard](#26-admin-dashboard)
27. [Graceful Shutdown](#27-graceful-shutdown)
28. [P2P Mesh Network](#28-p2p-mesh-network)
29. [Billing Summary Table](#29-billing-summary-table)
30. [Complete USDC Money Flow](#30-complete-usdc-money-flow)

---

## 1. Master Flow

```
Agent/Dev wants to use ClawNet
│
├─ Step 1: Get an API key
│  ├─ Option A: Stripe checkout → pay USD → receive cn-xxxx key + credits ($1 = 1000 credits)
│  ├─ Option B: Solana USDC transfer → verify on-chain → receive cn-xxxx key + credits ($1 = 1000 credits)
│  └─ Option C: Clerk sign-up → free trial key (100 credits)
│
├─ Step 2: Call the API
│  ├─ Headers: X-API-Key: cn-xxxx
│  ├─ Every request hits checkApiKey middleware
│  │  ├─ Validates key format (cn- + 48 hex chars)
│  │  ├─ Looks up key in SQLite (active = 1)
│  │  ├─ Sets context: { key, email, credits, creditsUsed, amountPaid, isEnvKey }
│  │  └─ 401 if invalid or deactivated
│  │
│  └─ Rate limit applied per key tier:
│     ├─ Free tier ($0 paid):     30 req/min
│     ├─ Starter ($1-9 paid):     60 req/min
│     ├─ Pro ($10-99 paid):      120 req/min
│     └─ Enterprise ($100+ paid): 300 req/min
│
├─ Step 3: Choose your route
│  ├─ POST /v1/orchestrate      → LLM plans + executes multi-step query (see §6)
│  ├─ POST /v1/skills/:id/invoke → Run a specific skill directly (see §7-9)
│  ├─ GET  /v1/skills/:id/query  → Query a data skill for structured JSON (see §9)
│  ├─ POST /v1/batch             → Up to 10 queries in one call (see §10)
│  ├─ GET  /v1/stream/orchestrate → SSE streaming response (see §11)
│  ├─ POST /v1/openclaw/invoke   → Unified gateway: query/skill/discover/swarm (see §12)
│  ├─ POST /x402/skills/:id      → Pay per call with USDC, no API key needed (see §13)
│  └─ POST /v1/swarm/task        → AI decomposes complex task into sub-tasks (see §17)
│
├─ Step 4: Credits are deducted
│  ├─ Atomic deduction: UPDATE api_keys SET credits = credits - ? WHERE credits >= ?
│  ├─ SQLite trigger trg_credits_non_negative prevents going below 0
│  ├─ Daily spend cap checked (DAILY_SPEND_CAP env var)
│  └─ Anomaly alert fires if single deduction > ANOMALY_THRESHOLD
│
├─ Step 5: Response returned
│  ├─ Cached in Redis (L2) + Memory (L1) for future callers
│  ├─ Logged to orchestrations table (query, steps, cost, duration)
│  └─ Agent context updated (3× TTL persistent cache per agent)
│
└─ Step 6: Creator gets paid (if third-party skill)
   ├─ 97% of skill.credit_cost → creator's credit balance
   ├─ 3% of skill.credit_cost → clawhub-treasury
   ├─ Creator withdraws: POST /v1/marketplace/creator/withdraw
   └─ Payout cron sends USDC to creator's Solana wallet every 4 hours
```

---

## 2. Boot Sequence

```
npm run dev → tsx src/index.ts
│
├─ initDb()
│  ├─ Opens SQLite file at DB_PATH
│  ├─ Sets pragmas: WAL mode, foreign_keys, busy_timeout=5000
│  ├─ Runs 52 migrations (v1 → v52) — each is idempotent
│  │  ├─ v1-v10: Core tables (api_keys, skills, orchestrations, feedback)
│  │  ├─ v11-v20: Marketplace (transactions, stakes, payout_requests)
│  │  ├─ v21-v30: Escrow, governance, tasks, swarms
│  │  ├─ v31-v40: Skill metrics, ratings, versions, A/B testing
│  │  ├─ v41-v44: Financial safety triggers + performance indexes
│  │  ├─ v45-v48: Context layer, reputation, endpoint health, subscriptions
│  │  ├─ v49-v51: Data skills (sample_output_json, update_frequency)
│  │  └─ v52: paired_skill_id column
│  └─ Logs: "Database initialized (52 migrations applied)"
│
├─ initRedis()
│  ├─ If REDIS_URL set → connect to Redis (L2 cache)
│  └─ If not set → memory-only cache (L1), no error
│
├─ seedOfficialSkills()
│  ├─ Ensures clawhub-official key exists (platform author, 0% fee)
│  ├─ Ensures clawhub-treasury key exists (collects 3% fees)
│  ├─ Re-activates both keys if deactivated (prevents silent marketplace outage)
│  ├─ Seeds/updates 10 prompt_template skills:
│  │  token-analysis, social-sentiment, portfolio-optimizer, wallet-profiler,
│  │  trending-tokens, whale-tracker, defi-yield-scanner, token-launch-radar,
│  │  price-oracle, nft-collection-intel
│  ├─ Seeds/updates 7 data skills:
│  │  price-oracle-data, trending-tokens-data, whale-tracker-data,
│  │  defi-yield-data, token-analysis-data, wallet-profiler-data, token-launch-data
│  ├─ Sets bidirectional paired_skill_id links between LLM ↔ data variants
│  └─ Updates prompt templates, tags, schemas on every boot (idempotent)
│
├─ Hono app.route() registration
│  ├─ /v1         → api.ts (orchestrate, estimate, balance, health)
│  ├─ /v1/skills  → skills.ts (CRUD, invoke, query)
│  ├─ /v1/batch   → batch.ts
│  ├─ /v1/stream  → stream.ts
│  ├─ /v1/openclaw → openclaw.ts (unified gateway)
│  ├─ /x402       → x402-skills.ts (USDC payment)
│  ├─ /v1/marketplace → marketplace.ts
│  ├─ /v1/tasks   → tasks.ts (async execution)
│  ├─ /v1/swarm   → swarm.ts
│  ├─ /v1/admin   → admin.ts (dashboard, revocation, reconciliation)
│  ├─ /v1/context → context.ts (agent memory)
│  ├─ /v1/mesh    → mesh.ts (P2P peers)
│  ├─ /v1/referral → referral.ts
│  ├─ /v1/discover → discover.ts
│  ├─ /v1/stats   → stats.ts
│  └─ /webhook/*  → clerk-webhook.ts, stripe-webhook.ts
│
├─ Start background services
│  ├─ startPayoutCron() → every 4 hours, settles PENDING payouts via Solana USDC
│  ├─ startEscrowCron() → checks expired escrows
│  ├─ startSkillAbCron() → promotes A/B test winners
│  ├─ startStakeUnlockCron() → unlocks matured stakes
│  ├─ startEndpointHealthCron() → pings API providers
│  ├─ startHeartbeat() → logs uptime every 60s
│  └─ startMeshNode() → libp2p P2P node on port 4001
│
├─ setupGracefulShutdown()
│  └─ Registers SIGTERM/SIGINT handlers (see §27)
│
└─ Hono serve({ port: 3402 })
   └─ Logs: "ClawNet listening on port 3402"
```

---

## 3. Authentication

```
Any API request arrives
│
├─ checkApiKey middleware (src/middleware/auth.ts)
│  │
│  ├─ Extract: X-API-Key header
│  │  └─ Missing? → 401 { error: "API key required", code: "MISSING_API_KEY" }
│  │
│  ├─ Check 1: Environment keys (API_KEYS env var)
│  │  ├─ Timing-safe compare against comma-separated list
│  │  └─ Match? → set context { isEnvKey: true }, skip DB lookup
│  │
│  ├─ Check 2: Format validation
│  │  ├─ Must match: /^cn-[a-f0-9]{48}$/
│  │  └─ Invalid? → 401 { error: "Invalid API key format", code: "INVALID_API_KEY" }
│  │
│  ├─ Check 3: Database lookup
│  │  ├─ SELECT * FROM api_keys WHERE key = ? AND active = 1
│  │  ├─ Not found? → 401 { error: "Invalid API key", code: "INVALID_API_KEY" }
│  │  └─ Found? → set context:
│  │     ├─ key: "cn-xxxx..."
│  │     ├─ email: "user@example.com"
│  │     ├─ credits: 5000
│  │     ├─ creditsUsed: 1200
│  │     ├─ amountPaid: 10.00
│  │     └─ isEnvKey: false
│  │
│  └─ Rate limit check (per-key, tiered)
│     ├─ Redis INCR on key "rl:{apiKey}" with 60s TTL
│     ├─ Tier = rateTier(amountPaid)
│     │  ├─ $0:       30/min
│     │  ├─ $1-9:     60/min
│     │  ├─ $10-99:  120/min
│     │  └─ $100+:   300/min
│     ├─ Under limit? → proceed
│     └─ Over limit? → 429 { error: "Rate limit exceeded", code: "RATE_LIMITED" }
│
├─ Clerk auth (dashboard/referral routes only)
│  ├─ Reads Clerk JWT from Authorization: Bearer header
│  ├─ Verifies with Clerk SDK
│  └─ Sets clerkUserId in context
│
└─ Admin auth (all /v1/admin/* routes)
   ├─ Router-level middleware: adminRouter.use('*', requireAdmin)
   ├─ Checks X-Admin-Key header against ADMIN_API_KEY env var
   └─ Missing/wrong? → 403 { error: "Forbidden", code: "ADMIN_REQUIRED" }
```

---

## 4. Credit Purchase — Stripe

```
User clicks "Buy Credits" on dashboard
│
├─ Frontend creates Stripe Checkout session
│  ├─ Product: ClawNet credits
│  ├─ Price: $1 = 1000 credits (CREDITS_PER_USD=1000, so $0.001/credit)
│  └─ Metadata: { email, existingApiKey? }
│
├─ User completes payment on Stripe
│
├─ Stripe fires webhook → POST /webhook/stripe
│  │
│  ├─ Idempotency check: isStripeSessionClaimed(sessionId)?
│  │  └─ Already claimed? → 200 OK (no-op, prevents double credit)
│  │
│  ├─ New key or top-up?
│  │  ├─ No existing key → generate cn- + 48 hex chars
│  │  │  ├─ INSERT INTO api_keys (key, email, credits, amount_paid, active)
│  │  │  └─ Send welcome email via Resend
│  │  │
│  │  └─ Existing key → topUpCredits(key, credits, sessionId, amountPaid)
│  │     └─ UPDATE api_keys SET credits = credits + ?, amount_paid = amount_paid + ?
│  │
│  ├─ Mark session claimed: claimStripeSession(sessionId)
│  │  └─ INSERT INTO stripe_processed_sessions (session_id)
│  │
│  └─ Log audit: { entityType: 'api_key', action: 'stripe_purchase', data: { credits, amountPaid } }
│
├─ User redirected to /session/:sessionId page
│  ├─ GET /v1/session/:sessionId
│  ├─ Returns: { status: "complete", key: maskApiKey(key), credits }
│  └─ Key shown ONCE — user must save it
│
└─ User's financials after $5 purchase:
   ├─ Credits: +5,000
   ├─ Cost per credit: $0.001
   └─ Amount paid: $5.00 (tracked for rate tier upgrades)
```

---

## 5. Credit Purchase — Solana USDC

```
Agent/Dev sends USDC to ClawNet's Solana wallet
│
├─ Frontend or agent calls POST /v1/credits/solana
│  ├─ Body: { signature: "5K3x...", amount: 5.00 }
│  │
│  ├─ Idempotency: tryClaimSolanaSignature(signature)
│  │  ├─ INSERT OR IGNORE INTO solana_processed_sigs (signature)
│  │  ├─ Already exists? → 409 { error: "Signature already claimed" }
│  │  └─ New? → proceed
│  │
│  ├─ Verify on-chain:
│  │  ├─ Fetch tx from Solana RPC
│  │  ├─ Confirm: recipient = CLAWNET_SOLANA_ADDRESS
│  │  ├─ Confirm: token = USDC mint (EPjFWdd...)
│  │  ├─ Confirm: amount matches claimed amount
│  │  └─ Confirm: finalized (not just confirmed)
│  │
│  ├─ Calculate credits: amount × CREDITS_PER_USD
│  │  └─ $5 USDC → 5,000 credits (same rate as Stripe)
│  │
│  ├─ Top up: topUpCredits(key, credits, null, amountPaid)
│  │
│  └─ Log audit: { action: 'solana_purchase', data: { signature, amount, credits } }
│
└─ User's financials after 5 USDC:
   ├─ Credits: +5,000
   ├─ No Stripe fees (saves ~3%)
   └─ Signature stored permanently (replay protection)
```

---

## 6. Orchestration (LLM Query)

```
Agent calls POST /v1/orchestrate
├─ Headers: X-API-Key: cn-xxxx
├─ Body: { query: "What's the best DeFi yield on ETH right now?",
│          pricing: { maxCredits: 20, strategy: "cheapest" } }
│
├─ Step 1: Auth + rate limit (see §3)
│
├─ Step 2: Query validation
│  ├─ Max 2000 characters
│  └─ Pre-check: credits >= 1 (reject early if broke)
│
├─ Step 3: Cache check
│  ├─ Key: claw:SHA256(query + strategy)[:16]
│  ├─ L1 memory → L2 Redis
│  ├─ HIT? → return cached response, deduct 1 credit
│  │  └─ CACHE_HIT_CREDIT = 1 ($0.001)
│  └─ MISS? → proceed to LLM
│
├─ Step 4: parseIntent(query, pricingHint)
│  │  (src/core/intent-parser.ts)
│  │
│  ├─ Template matching (fast path, no LLM):
│  │  ├─ Regex patterns for common queries
│  │  ├─ e.g., "price of {token}" → endpointId: "price-oracle"
│  │  └─ Match? → skip LLM, save ~3s
│  │
│  └─ LLM fallback (slow path):
│     ├─ Send query to Anthropic/OpenAI
│     ├─ LLM returns: { summary, reasoning, steps[], parallelGroups[] }
│     │  ├─ steps: [{ endpointId, params, dependsOn, reason }]
│     │  └─ parallelGroups: [["0","1"], ["2"]] (which steps run together)
│     └─ Cost: ~$0.0002-0.001 LLM inference (absorbed by ORCHESTRATION_FEE)
│
├─ Step 5: Budget pre-check
│  ├─ estimatedCost = creditsForExecution(steps) + ORCHESTRATION_FEE
│  ├─ If pricing.maxCredits set AND estimatedCost > maxCredits:
│  │  ├─ Try optimizePlan(intent, pricing) first
│  │  │  └─ Swaps expensive endpoints for cheaper alternatives
│  │  │     (11 capability groups, ~45 alternatives in registry)
│  │  ├─ Still over budget? → 402 { error: "Plan exceeds budget", code: "BUDGET_EXCEEDED",
│  │  │                             estimated, maxCredits, cheapestAlternative }
│  │  └─ Under budget? → use optimized plan
│  └─ If no maxCredits → proceed with original plan
│
├─ Step 6: optimizePlan(intent, pricing)
│  │  (src/core/pricing.ts)
│  │
│  ├─ Strategy: "cheapest"  → pick lowest-cost endpoint per capability group
│  ├─ Strategy: "balanced"  → weight cost + latency + success rate
│  ├─ Strategy: "fastest"   → pick lowest-latency endpoint
│  └─ Strategy: "reliable"  → pick highest success rate
│
├─ Step 7: executePlan(intent, budget, apiKey)
│  │  (src/core/executor.ts)
│  │
│  ├─ For each parallel group:
│  │  ├─ Check agent context cache (SQLite, 3× TTL)
│  │  │  └─ HIT? → use cached data, step.cached = true, 0 credits
│  │  ├─ Check endpoint cache (Redis)
│  │  │  └─ HIT? → use cached data, step.cached = true, 0 credits
│  │  ├─ MISS → call x402 API endpoint
│  │  │  ├─ Circuit breaker check (3 failures → OPEN, skip for 60s)
│  │  │  ├─ Make HTTP request to external API
│  │  │  ├─ x402 payment from SOLANA_PRIVATE_KEY wallet
│  │  │  ├─ Record: step.success, step.cached, step.durationMs
│  │  │  └─ Cache response in Redis + agent context
│  │  └─ Failed? → step.success = false, 0 credits charged
│  │
│  └─ Returns: { steps[], totalDurationMs }
│
├─ Step 8: formatResponse(query, stepResults)
│  ├─ LLM synthesizes all step results into natural language answer
│  └─ Returns: { answer: "...", suggestedActions: ["..."] }
│
├─ Step 9: Billing
│  ├─ stepCredits = creditsForExecution(steps, findEndpoint)
│  │  └─ Sum of creditCostForEndpoint(ep) for each step where success=true AND cached=false
│  ├─ totalCost = stepCredits + ORCHESTRATION_FEE (default 2 credits)
│  ├─ deductCredit(apiKey, totalCost)
│  │  └─ UPDATE api_keys SET credits = credits - ?, credits_used = credits_used + ?
│  │     WHERE key = ? AND credits >= ?
│  ├─ Daily spend cap check
│  └─ Anomaly alert if totalCost > ANOMALY_THRESHOLD
│
├─ Step 10: Cache + log
│  ├─ Cache response in Redis (query-level, 30min default)
│  ├─ insertOrchestration({ query, steps, cost, duration, success })
│  └─ Update agent context (per-endpoint results, 3× TTL)
│
└─ Response: {
     answer: "The best DeFi yield on ETH right now is...",
     suggestedActions: ["Check wallet-profiler for your holdings", ...],
     costBreakdown: { steps: 3, cached: 1, credits: 8, orchestrationFee: 2 },
     metadata: { durationMs: 1234, cacheHit: false }
   }

Example financials for this call:
├─ Agent pays: 8 step credits + 2 orchestration fee = 10 credits ($0.010)
├─ Platform pays: ~$0.002 x402 API costs + ~$0.0003 LLM cost
├─ Platform revenue: $0.010 - $0.0023 = $0.0077 profit
└─ Cache hit on same query: next caller pays 1 credit ($0.001), $0 platform cost
```

---

## 7. Skill Invocation — prompt_template

```
Agent calls POST /v1/skills/token-analysis/invoke
├─ Headers: X-API-Key: cn-xxxx
├─ Body: { variables: { token: "SOL" } }
│
├─ Step 1: Auth + rate limit (see §3)
│
├─ Step 2: Resolve skill
│  ├─ SELECT * FROM skills WHERE id = 'token-analysis' AND active = 1
│  ├─ A/B variant routing (if challenger version exists):
│  │  ├─ 70% → control (current version)
│  │  └─ 30% → challenger (new version being tested)
│  └─ Pre-check: credits >= skill.credit_cost
│
├─ Step 3: Skill-level cache check
│  ├─ Key: claw:skill:{skillId}:SHA256(variables)[:16]
│  ├─ HIT? → return cached, bill 1 credit (cache hit)
│  └─ MISS? → continue
│
├─ Step 4: Check for deterministic execution plan
│  │  (src/core/skill-executor.ts)
│  │
│  ├─ Skill has execution_plan_json?
│  │  ├─ YES → buildIntentFromPlan(planJson, variables, skillName)
│  │  │  ├─ Parse JSON array of steps
│  │  │  ├─ Interpolate {varName} placeholders with user variables
│  │  │  ├─ Validate each endpointId exists in API registry
│  │  │  └─ Return ParsedIntent (bypasses LLM — saves ~3-5s)
│  │  │
│  │  └─ NO → fall through to LLM
│  │
│  └─ Plan invalid/missing? → render prompt template + parseIntent()
│
├─ Step 5: Render prompt template
│  ├─ Template: "Analyze the token {token} for trading opportunities..."
│  ├─ Replace {token} → "SOL"
│  └─ Result: "Analyze the token SOL for trading opportunities..."
│
├─ Step 6: parseIntent() → executePlan() → formatResponse()
│  └─ Same pipeline as orchestration (see §6, Steps 4-8)
│     ├─ LLM plans which x402 endpoints to call
│     ├─ Executes calls (price data, on-chain metrics, etc.)
│     └─ LLM synthesizes into answer
│
├─ Step 7: Billing
│  ├─ actualCost = creditsForExecution(steps, findEndpoint)
│  ├─ chargedCredits = max(actualCost, skill.credit_cost)
│  │  └─ Creator's price is the MINIMUM floor
│  │
│  ├─ If official skill (author = clawhub-official):
│  │  ├─ All credits → platform (no revenue share)
│  │  └─ Treasury fee: 0%
│  │
│  ├─ If third-party skill:
│  │  ├─ authorShare = floor(chargedCredits × 0.97) → creator balance
│  │  ├─ feeCredits = chargedCredits - authorShare → clawhub-treasury
│  │  └─ recordTransaction({ type: 'SKILL_INVOKE', ... })
│  │
│  ├─ deductCredit(callerKey, chargedCredits)
│  ├─ incrementSkillUses(skillId)
│  └─ recordSkillMetric({ skillId, latencyMs, success, costCredits })
│
├─ Step 8: Cache response (300s TTL)
│
└─ Response: {
     answer: "SOL is currently trading at $142.50...",
     suggestedActions: [...],
     skill: { id: "token-analysis", version: 1 },
     costBreakdown: { credits: 5, cached: 0 }
   }

Example financials — OFFICIAL skill (token-analysis, 5cr):
├─ Agent pays: 5 credits ($0.005)
├─ Creator (clawhub-official): $0 (it's the platform's own skill)
├─ Treasury: $0 (official skills exempt from fee)
├─ Platform keeps: 5 credits ($0.005)
├─ Platform pays: ~$0.002 x402 cost
└─ NET: +$0.003 profit per call

Example financials — THIRD-PARTY skill (defi-dashboard, 10cr, $0.004 x402 cost):
├─ x402 surcharge: ceil($0.004 × 1000) = 4 credits
├─ Agent pays: 10 + 4 = 14 credits ($0.014)
├─ Creator gets: floor(10 × 0.97) = 9 credits (split on skillCredits only)
├─ Treasury gets: 10 - 9 = 1 credit ($0.001)
├─ Platform x402 cost: $0.004 (covered by surcharge = $0.004)
├─ Platform revenue: $0.001 treasury + $0.004 surcharge - $0.004 x402 = $0.001 profit
└─ NET: +$0.001 per call ✓ (was -$0.0035 LOSS before surcharge fix)
```

---

## 8. Skill Invocation — api_proxy

```
Agent calls POST /v1/skills/my-custom-api/invoke
├─ Headers: X-API-Key: cn-xxxx
├─ Body: { variables: { symbol: "ETH" } }
│
├─ Step 1: Auth + resolve skill (same as §7)
│  └─ Skill has skill_type = 'api_proxy', proxy_url = "https://creator-api.com/data"
│
├─ Step 2: SSRF protection
│  ├─ isProxyUrlSafe(proxy_url)
│  │  ├─ Must be HTTPS
│  │  ├─ No private IPs (10.x, 172.16-31.x, 192.168.x, 127.x)
│  │  ├─ No IPv6 SSRF bypass (fc00::, fe80::, ::1)
│  │  └─ No localhost, metadata endpoints (169.254.x)
│  └─ Unsafe? → 403 { error: "Proxy URL blocked", code: "SSRF_BLOCKED" }
│
├─ Step 3: Forward request to creator's API
│  ├─ Method: POST (or skill's proxy_method)
│  ├─ URL: https://creator-api.com/data
│  ├─ Body: interpolated variables → { symbol: "ETH" }
│  ├─ Timeout: 30s
│  └─ Max response: 1MB (MAX_RESPONSE_BYTES)
│
├─ Step 4: Response safety scan
│  ├─ Check for malicious content in response body
│  └─ Oversized response? → skip cache, still return to caller
│
├─ Step 5: Billing
│  ├─ chargedCredits = skill.credit_cost (no x402 involved!)
│  ├─ 97% → creator, 3% → treasury
│  └─ Platform cost: $0 (creator hosts the API, not us)
│
└─ Response: { answer: <creator API response>, skill: { id, version } }

Financials — api_proxy skill (creator-hosted, 3cr):
├─ Agent pays: 3 credits ($0.003)
├─ Creator gets: floor(3 × 0.97) = 2 credits
├─ Treasury gets: 1 credit ($0.001)
├─ Platform x402 cost: $0 (creator's API, not our x402 endpoints)
├─ No surcharge (no x402 calls)
└─ NET: +$0.001 pure profit (always profitable for platform)
```

---

## 9. Skill Invocation — data

```
Agent calls GET /v1/skills/price-oracle-data/query?token=SOL
├─ Headers: X-API-Key: cn-xxxx
│
├─ Step 1: Auth + resolve skill
│  └─ Skill: skill_type = 'data', update_frequency = 'realtime',
│     proxy_url = "https://api.clawapis.com/crypto/price", credit_cost = 1
│
├─ Step 2: Query param validation
│  ├─ Max 20 query parameters (prevents abuse)
│  └─ Params extracted: { token: "SOL" }
│
├─ Step 3: Cache check (smart TTL based on update_frequency)
│  ├─ Key: claw:data:{skillId}:SHA256(params)[:16]
│  ├─ TTL by frequency:
│  │  ├─ realtime:  60 seconds
│  │  ├─ hourly:    3,600 seconds (1 hour)
│  │  ├─ daily:     86,400 seconds (24 hours)
│  │  ├─ weekly:    604,800 seconds (7 days)
│  │  └─ static:    2,592,000 seconds (30 days)
│  │
│  ├─ HIT? →
│  │  ├─ Return cached JSON immediately
│  │  ├─ Bill: 1 credit (CACHE_HIT_CREDIT)
│  │  ├─ Creator still gets credited (platform absorbs cost delta)
│  │  └─ Response time: ~5ms (Redis lookup only)
│  │
│  └─ MISS? → live fetch
│
├─ Step 4: Live fetch
│  ├─ SSRF check on proxy_url (same as §8)
│  ├─ GET https://api.clawapis.com/crypto/price?token=SOL
│  │  └─ x402 payment sent automatically from SOLANA_PRIVATE_KEY wallet
│  ├─ Response: { "symbol": "SOL", "price": 142.50, "change24h": 3.2 }
│  └─ Cache response with update_frequency TTL
│
├─ Step 5: Billing (live fetch)
│  ├─ chargedCredits = max(1, skill.credit_cost) = 1 credit
│  │
│  ├─ If official data skill:
│  │  └─ Platform keeps 100% (no revenue share)
│  │
│  ├─ If third-party data skill:
│  │  ├─ 97% → creator
│  │  └─ 3% → treasury
│  │
│  └─ deductCredit(callerKey, 1)
│
└─ Response: {
     data: { symbol: "SOL", price: 142.50, change24h: 3.2 },
     cached: false,
     ttl: 60,
     skill: { id: "price-oracle-data", updateFrequency: "realtime" }
   }

Financials — OFFICIAL data skill cache hit:
├─ Agent pays: 1 credit ($0.001)
├─ Platform x402 cost: $0 (served from Redis)
├─ NET: +$0.001 pure profit
└─ This is the best-margin call in the system

Financials — OFFICIAL data skill live fetch:
├─ Agent pays: 1 credit ($0.001)
├─ Platform pays: ~$0.0003 x402 cost
└─ NET: +$0.0007 profit (first caller pays, then all subsequent cache)

Financials — THIRD-PARTY data skill (creator-hosted proxy_url, 3cr):
├─ Agent pays: 3 credits ($0.003)
├─ Creator gets: floor(3 × 0.97) = 2 credits
├─ Treasury gets: 1 credit ($0.001)
├─ Platform x402 cost: $0 (creator's URL, not x402)
├─ No surcharge (data skills don't use x402)
└─ NET: +$0.001 profit (always profitable)
```

---

## 10. Batch Queries

```
Agent calls POST /v1/batch
├─ Headers: X-API-Key: cn-xxxx
├─ Body: {
│    queries: [
│      { query: "Price of SOL" },
│      { query: "Top DeFi yields" },
│      { query: "Whale movements today" }
│    ],
│    pricing: { strategy: "cheapest", maxCredits: 50 }
│  }
│
├─ Step 1: Auth + validation
│  ├─ Max 10 queries per batch
│  ├─ Pre-flight: credits >= queryCount (min 1 per query)
│  └─ Rate limit: each query counts as 1 request
│
├─ Step 2: Parse all intents in parallel
│  ├─ parseIntent("Price of SOL") → 1 step
│  ├─ parseIntent("Top DeFi yields") → 2 steps
│  └─ parseIntent("Whale movements today") → 2 steps
│  └─ Total steps: 5 (must be ≤ MAX_BATCH_STEPS = 30)
│
├─ Step 3: Estimate total cost + deduct upfront
│  ├─ estimatedTotal = sum(creditsForExecution(steps)) + (ORCHESTRATION_FEE × 3)
│  │  = (2 + 4 + 4) + 6 = 16 credits
│  ├─ Budget check: 16 ≤ 50 maxCredits ✓
│  ├─ deductCredit(apiKey, 16) — ATOMIC upfront deduction
│  └─ If insufficient credits → 402 before any execution
│
├─ Step 4: Execute all queries in parallel
│  ├─ executePlan(intent1) → result1 (1.2s)
│  ├─ executePlan(intent2) → result2 (2.1s)
│  └─ executePlan(intent3) → result3 (1.8s)
│  └─ Wall clock: ~2.1s (parallel, not 5.1s serial)
│
├─ Step 5: Refund difference
│  ├─ actualCost = 14 credits (some steps had cache hits)
│  ├─ refund = 16 - 14 = 2 credits
│  └─ topUpCredits(apiKey, 2) — partial refund
│
└─ Response: {
     batchId: "batch_abc123",
     succeeded: 3,
     failed: 0,
     results: [
       { query: "Price of SOL", answer: "...", credits: 4 },
       { query: "Top DeFi yields", answer: "...", credits: 6 },
       { query: "Whale movements today", answer: "...", credits: 4 }
     ],
     totalCredits: 14
   }

Financials:
├─ Agent pays: 14 credits ($0.014) for 3 queries
├─ vs 3 separate calls: same cost, but one HTTP roundtrip
├─ Refund: 2 credits returned (estimate was conservative)
└─ Atomic: if batch fails mid-way, only successful queries charged
```

---

## 11. Streaming

```
Agent calls GET /v1/stream/orchestrate?query=Analyze+SOL&strategy=balanced
├─ Headers: X-API-Key: cn-xxxx
│
├─ Step 1: Auth + pre-checks
│  ├─ Min 10 credits required (cost unknown until execution completes)
│  ├─ Concurrent stream check: max 5 per API key
│  │  └─ At limit? → 429 { error: "Too many concurrent streams" }
│  └─ Open SSE connection
│
├─ Step 2: Server-Sent Events stream
│  │
│  ├─ event: start
│  │  data: { query: "Analyze SOL", timestamp: "..." }
│  │
│  ├─ event: plan
│  │  data: { steps: 3, estimatedCredits: 8, strategy: "balanced" }
│  │
│  ├─ event: step (× N steps)
│  │  data: { stepIndex: 0, endpointId: "price-oracle", status: "success", cached: false }
│  │  data: { stepIndex: 1, endpointId: "whale-tracker", status: "success", cached: true }
│  │  data: { stepIndex: 2, endpointId: "defi-yields", status: "success", cached: false }
│  │
│  ├─ *** BILLING HAPPENS HERE (before checking if client disconnected) ***
│  │  ├─ totalCost = creditsForExecution(steps) + ORCHESTRATION_FEE
│  │  ├─ deductCredit(apiKey, totalCost)
│  │  └─ RED-2 fix: prevents free-riding by disconnecting before billing
│  │
│  ├─ event: done
│  │  data: { answer: "SOL analysis...", credits: 8, durationMs: 2100 }
│  │
│  └─ event: error (if something fails)
│     data: { error: "Step failed", code: "EXECUTION_ERROR" }
│
└─ Connection closed

Key difference from POST /v1/orchestrate:
├─ Credits deducted AFTER execution (not before) because cost is unknown until done
├─ Client sees real-time progress as steps complete
├─ 10 credit minimum ensures platform isn't left holding the bag
└─ Billing before disconnect-check prevents abuse
```

---

## 12. OpenClaw Unified Gateway

```
Agent calls POST /v1/openclaw/invoke
├─ Headers: X-API-Key: cn-xxxx
├─ Body: { action: "query|skill|discover|swarm", ... }
│
├─ action: "query"
│  ├─ Body: { action: "query", query: "Price of ETH", pricing: { ... } }
│  ├─ Same flow as POST /v1/orchestrate (§6)
│  ├─ Billing: stepCredits + ORCHESTRATION_FEE
│  └─ Cache hit: 1 credit (CACHE_HIT_CREDIT)
│
├─ action: "skill"
│  ├─ Body: { action: "skill", skillId: "token-analysis", variables: { token: "SOL" } }
│  ├─ Same flow as POST /v1/skills/:id/invoke (§7)
│  ├─ Billing: max(actualCost, skill.credit_cost) with 97/3 split
│  └─ A/B variant routing active
│
├─ action: "discover"
│  ├─ Body: { action: "discover", query: "DeFi yield data" }
│  ├─ Triple-layer discovery:
│  │  ├─ Layer 1: Semantic search (sqlite-vec embeddings)
│  │  ├─ Layer 2: P2P mesh broadcast (libp2p peers)
│  │  └─ Layer 3: On-chain registry lookup
│  ├─ Billing: 0 credits (free — drives adoption)
│  └─ Returns: ranked skill list with metadata
│
├─ action: "swarm"
│  ├─ Body: { action: "swarm", task: "Full market analysis", maxBudget: 100 }
│  ├─ Same flow as POST /v1/swarm/task (§17)
│  └─ Billing: SWARM_BASE_FEE (20cr) + sub-task costs
│
├─ GET /v1/openclaw/catalog
│  ├─ Auth: checkApiKey
│  ├─ Returns: full capability listing (all skills + endpoints + pricing)
│  └─ Billing: 0 credits
│
└─ GET /v1/openclaw/status
   ├─ Auth: checkApiKey
   ├─ Returns: { balance, usage, reputation, rateTier, rateLimitRemaining }
   └─ Billing: 0 credits

Purpose: single endpoint for agent frameworks (LangChain, AutoGPT, etc.)
that want one URL to access all ClawNet capabilities.
```

---

## 13. x402 Payment Flow

```
Agent calls POST /x402/skills/token-analysis
├─ NO API key needed — payment is the auth
├─ Body: { variables: { token: "SOL" } }
│
├─ Step 1: x402 middleware
│  ├─ Client includes x402 payment header
│  │  └─ Contains: signed USDC transfer on Base mainnet
│  ├─ Facilitator verifies payment:
│  │  ├─ Amount: skill.credit_cost × X402_USDC_PER_CREDIT ($0.001/credit)
│  │  │  └─ 5 credits × $0.001 = $0.005 USDC
│  │  ├─ Recipient: ClawNet's EVM wallet
│  │  └─ Chain: Base mainnet (USDC: 0x833589fCD...)
│  ├─ Payment verified? → proceed
│  └─ Payment failed? → 402 Payment Required
│
├─ Step 2: Execute skill
│  ├─ Get skill (must be public)
│  ├─ Render template + parseIntent() + executePlan() + formatResponse()
│  ├─ incrementSkillUses(skillId)
│  └─ Same execution as §7, but no credit deduction (paid via USDC)
│
├─ Step 3: Creator auto-split (Option C lite)
│  ├─ Does skill have creator_evm_wallet?
│  │  ├─ YES → fire-and-forget:
│  │  │  ├─ Calculate: 97% of payment = $0.00485 USDC
│  │  │  ├─ sendBaseUsdc(creatorWallet, 0.00485)
│  │  │  │  └─ EVM_PRIVATE_KEY signs tx on Base mainnet
│  │  │  ├─ Wait 1 confirmation
│  │  │  └─ Log tx hash (don't block response on failure)
│  │  │
│  │  └─ NO → platform keeps 100% (creator didn't set EVM wallet)
│  │
│  └─ Platform keeps: 3% = $0.00015 USDC (or 100% if no wallet)
│
└─ Response: { answer: "...", metadata: { durationMs, skill } }

x402 listing:
├─ GET /x402/skills → all public skills with USDC pricing
└─ GET /x402/ → provider discovery (x402 protocol standard)

Financials — x402 call on 5cr skill with creator_evm_wallet:
├─ Agent pays: $0.005 USDC (on Base)
├─ Creator receives: $0.00485 USDC (97%, auto-split to Base wallet)
├─ Platform keeps: $0.00015 USDC (3%)
├─ Platform pays: ~$0.002 x402 API costs + ~$0.0001 Base gas
├─ NET: -$0.00185 LOSS
│
├─ ⚠ x402 route does NOT yet have surcharge (USDC price is per-skill, not per-execution).
│    Future fix: compute x402 cost pre-flight and add to skill's USDC price.
│
└─ Advantage: no API key needed, pay-per-call, crypto-native
```

---

## 14. Marketplace Purchase

```
Agent calls POST /v1/marketplace/skills/defi-scanner/purchase
├─ Headers: X-API-Key: cn-xxxx
├─ Body: { variables: { chain: "ethereum" } }
│
├─ Step 1: Validation
│  ├─ Skill exists, public, not FLAGGED
│  ├─ Not a self-purchase (email check — can't buy your own skill)
│  ├─ Not free (credit_cost > 0)
│  ├─ Not simulation mode
│  └─ Pre-validate template variables
│
├─ Step 2: Atomic payment settlement
│  │  (src/db/marketplace.ts → marketplacePurchase())
│  │
│  ├─ getDb().transaction(() => {
│  │  ├─ Deduct from buyer:
│  │  │  UPDATE api_keys SET credits = credits - 10 WHERE key = ? AND credits >= 10
│  │  │
│  │  ├─ Calculate split:
│  │  │  ├─ feePct = (author === 'clawhub-official') ? 0 : 3
│  │  │  ├─ authorShare = floor(10 × 0.97) = 9 credits
│  │  │  └─ feeCredits = 10 - 9 = 1 credit
│  │  │
│  │  ├─ Credit seller:
│  │  │  UPDATE api_keys SET credits = credits + 9 WHERE key = ?
│  │  │
│  │  ├─ Credit treasury:
│  │  │  UPDATE api_keys SET credits = credits + 1 WHERE key = 'clawhub-treasury'
│  │  │
│  │  └─ Record transaction:
│  │     INSERT INTO transactions (from_agent, to_agent, amount_credits, type, fee_credits, skill_id)
│  │     VALUES (buyer, seller, 10, 'SKILL_SALE', 1, 'defi-scanner')
│  │  })()
│  │
│  └─ Transaction failed? → 402 { error: "Insufficient credits" }
│
├─ Step 3: Execute skill inline (no second charge)
│  ├─ Render template → parseIntent() → executePlan() → formatResponse()
│  └─ On failure → auto-refund:
│     ├─ marketplaceRefund(params)
│     │  ├─ Return credits to buyer
│     │  ├─ Deduct from seller (if seller has enough)
│     │  ├─ Deduct from treasury (if treasury has enough)
│     │  └─ Deficit? → admin alert email
│     └─ recordTransaction({ type: 'REFUND', ... })
│
└─ Response: {
     txId: "tx_abc123",
     creditsCharged: 10,
     feeCredits: 1,
     sellerReceives: 9,
     answer: "Ethereum DeFi scanner results...",
     suggestedActions: [...]
   }

Financials:
├─ Buyer pays: 10 credits ($0.010)
├─ Seller receives: 9 credits (in their balance, withdrawable)
├─ Treasury receives: 1 credit ($0.001)
├─ Refund on failure: buyer gets 10 back, seller loses 9, treasury loses 1
└─ Self-purchase blocked: prevents wash trading / inflating skill stats
```

---

## 15. Creator Payout — Solana

```
Creator calls POST /v1/marketplace/creator/withdraw
├─ Headers: X-API-Key: cn-xxxx (creator's key)
├─ Body: { amountCredits: 5000, solanaWallet: "7xKXt..." }
│
├─ Step 1: Validation
│  ├─ Min withdrawal: 1000 credits
│  ├─ Max pending requests: 3
│  ├─ Creator has earned enough (credits balance check minus staked)
│  └─ Valid Solana address
│
├─ Step 2: Create payout request
│  ├─ createPayoutRequest({ agentKey, amountCredits: 5000, usdcWallet })
│  ├─ Record transaction: type = 'PAYOUT_REQUEST'
│  └─ Status: PENDING
│
├─ Step 3: Payout cron picks it up (every 4 hours)
│  │  (src/core/payout-cron.ts → startPayoutCron())
│  │
│  ├─ getAllPendingPayouts()
│  │  └─ SELECT * FROM payout_requests WHERE status = 'PENDING'
│  │
│  ├─ For each payout:
│  │  ├─ Convert: 5000 credits × PAYOUT_USDC_PER_CREDIT ($0.00075) = $3.75 USDC
│  │  │  └─ Payout rate is 25% below buy rate ($0.001/credit)
│  │  │     This prevents arbitrage: buy credits → withdraw → profit
│  │  │
│  │  ├─ Min check: $3.75 ≥ $1.00 minimum ✓
│  │  │
│  │  ├─ sendSolanaUsdc("7xKXt...", 3.75)
│  │  │  (src/utils/solana-payout.ts)
│  │  │  ├─ Load PLATFORM_PAYOUT_PRIVATE_KEY (bs58 Solana keypair)
│  │  │  │  └─ MUST be a DEDICATED wallet, NOT SOLANA_PRIVATE_KEY
│  │  │  ├─ Create/reuse recipient's USDC Associated Token Account
│  │  │  │  └─ Platform pays ATA creation if needed (~0.002 SOL)
│  │  │  ├─ SPL token transfer: 3,750,000 lamports (6 decimals)
│  │  │  └─ Return: transaction signature
│  │  │
│  │  ├─ Success:
│  │  │  ├─ markPayoutPaid(payoutId, txSignature)
│  │  │  └─ Log: { payoutId, amount: 3.75, txHash: "5K3x..." }
│  │  │
│  │  └─ Failure:
│  │     ├─ updatePayoutStatus(payoutId, 'REJECTED', error.message)
│  │     └─ Credits NOT returned (admin must investigate)
│  │
│  └─ Next run: 4 hours
│
└─ Creator checks status: GET /v1/marketplace/creator/withdrawals
   └─ Returns: [{ id, amountCredits: 5000, usdcEquivalent: 3.75, status: "PAID", txHash: "5K3x..." }]

Financials:
├─ Creator earned: 5000 credits from skill invocations
├─ Creator receives: $3.75 USDC (at $0.00075/credit)
├─ Users paid: $0.001/credit × 5000 = $5.00 to buy those credits
├─ Platform spread: $5.00 - $3.75 = $1.25 margin (25%)
├─ Gas cost: ~0.002 SOL (~$0.30) per payout
└─ Min payout: $1.00 USDC (prevents dust payouts eating gas)
```

---

## 16. Creator Payout — EVM Auto-Split

```
x402 call triggers auto-split (fire-and-forget)
│
├─ Trigger: POST /x402/skills/:id completes successfully
│  └─ Skill has creator_evm_wallet = "0xABC..."
│
├─ Step 1: Calculate split
│  ├─ Total payment: skill.credit_cost × X402_USDC_PER_CREDIT
│  │  └─ 5 credits × $0.001 = $0.005 USDC
│  ├─ Creator share: 97% = $0.00485 USDC
│  └─ Platform keeps: 3% = $0.00015 USDC
│
├─ Step 2: Send USDC on Base
│  │  (src/utils/evm-payout.ts → sendBaseUsdc())
│  │
│  ├─ Load EVM_PRIVATE_KEY (platform's Base wallet)
│  ├─ USDC contract: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
│  ├─ Chain: Base mainnet (chainId: 8453)
│  ├─ transfer(creatorWallet, 4850) — 6 decimals
│  ├─ Wait 1 confirmation
│  └─ Return txHash
│
├─ Step 3: Log (fire-and-forget)
│  ├─ Success: log txHash, don't block response
│  └─ Failure: log error, don't block response, creator misses this payout
│
└─ Key difference from Solana payout:
   ├─ Instant (same transaction flow, not batched every 4h)
   ├─ Only triggers on x402 calls (not credit-based calls)
   ├─ Only if creator set creator_evm_wallet on skill creation
   └─ Gas: ~$0.001 on Base (very cheap)
```

---

## 17. Swarm Decomposition

```
Agent calls POST /v1/swarm/task
├─ Headers: X-API-Key: cn-xxxx
├─ Body: {
│    task: "Complete market analysis: SOL ecosystem health, DeFi yields, whale activity, and price prediction",
│    maxBudget: 100
│  }
│
├─ Step 1: Guards
│  ├─ Recursion check: X-Swarm-Depth header present? → 400 (prevents nested swarms)
│  ├─ Credit check: credits >= maxBudget + SWARM_BASE_FEE
│  │  └─ Need: 100 + 20 = 120 credits minimum
│  └─ Deduct SWARM_BASE_FEE (20 credits) immediately
│     └─ Non-refundable — covers LLM decomposition cost
│
├─ Step 2: Create swarm task
│  ├─ createSwarmTask(apiKey, task)
│  ├─ Status: PENDING
│  └─ Return: { swarmId, status: "PENDING", pollUrl: "/v1/swarm/{id}" }
│
├─ Step 3: Async execution (background)
│  │
│  ├─ LLM decomposes task into sub-tasks (max 4):
│  │  ├─ Sub-task 1: "SOL ecosystem health check" → route to token-analysis skill
│  │  ├─ Sub-task 2: "Top DeFi yields on Solana" → route to defi-yield-scanner
│  │  ├─ Sub-task 3: "Recent whale movements in SOL" → route to whale-tracker
│  │  └─ Sub-task 4: "SOL price technical analysis" → route to general orchestration
│  │
│  ├─ Execute all 4 in parallel:
│  │  ├─ Each sub-task: resolve skill/query → execute → track cost
│  │  ├─ Per-subtask billing: normal skill/orchestration costs
│  │  └─ Running total tracked against maxBudget (100 credits)
│  │
│  ├─ Budget enforcement:
│  │  ├─ Before each sub-task: check remaining budget
│  │  └─ Over budget? → skip remaining sub-tasks, synthesize with what we have
│  │
│  └─ LLM synthesizes all results into cohesive analysis
│
├─ Step 4: Completion
│  ├─ updateSwarmTask(id, { status: 'COMPLETED', results, subTasks })
│  └─ Total cost: 20 (base) + 5 + 5 + 5 + 8 = 43 credits
│
└─ Agent polls: GET /v1/swarm/{id}
   └─ Response: {
        swarmId: "swarm_abc",
        status: "COMPLETED",
        subTasks: [
          { task: "SOL ecosystem health", skill: "token-analysis", credits: 5, status: "success" },
          { task: "DeFi yields", skill: "defi-yield-scanner", credits: 5, status: "success" },
          { task: "Whale movements", skill: "whale-tracker", credits: 5, status: "success" },
          { task: "Price analysis", skill: null, credits: 8, status: "success" }
        ],
        result: "Comprehensive SOL market analysis: ...",
        totalCredits: 43
      }

Financials:
├─ Agent pays: 43 credits ($0.043)
├─ Breakdown: 20cr base fee + 23cr sub-task execution
├─ Platform revenue on base fee: $0.02 pure profit (20cr × $0.001)
├─ Sub-task costs: standard billing per §6/§7 (+ surcharge on third-party skills)
└─ Unspent budget: 100 - 43 = 57 credits NOT charged
```

---

## 18. Discovery

```
Agent calls GET /v1/discover?query=DeFi yield data for Solana
│
├─ Auth: None (public — drives adoption)
├─ Billing: 0 credits
│
├─ Triple-layer search:
│  │
│  ├─ Layer 1: Semantic search (primary)
│  │  ├─ Embed query via LLM → float[] vector
│  │  ├─ sqlite-vec cosine similarity against skill_embeddings
│  │  └─ Returns: top N skills by semantic distance
│  │
│  ├─ Layer 2: P2P mesh broadcast (if mesh node running)
│  │  ├─ Broadcast query to connected libp2p peers
│  │  ├─ Peers check their local skill registries
│  │  └─ Returns: skills from other ClawNet nodes
│  │
│  └─ Layer 3: On-chain registry (future)
│     └─ Placeholder for blockchain-registered skills
│
├─ Merge + rank results:
│  ├─ Semantic score (primary)
│  ├─ Stake total (discovery boost from stakers)
│  ├─ Reputation score (creator trust)
│  └─ Invocation count (popularity signal)
│
└─ Response: [
     { id: "defi-yield-data", name: "DeFi Yield Data", score: 0.94,
       type: "data", creditCost: 2, updateFrequency: "hourly",
       pairedSkill: { id: "defi-yield-scanner", type: "prompt_template" } },
     { id: "defi-yield-scanner", name: "DeFi Yield Scanner", score: 0.91,
       type: "prompt_template", creditCost: 5 },
     ...
   ]
```

---

## 19. Cache System

```
Cache architecture (two layers + agent context):

Request arrives
│
├─ Layer 1: Memory cache (L1)
│  ├─ In-process JavaScript Map
│  ├─ LRU eviction when at capacity
│  ├─ Fastest: ~0.01ms lookup
│  └─ Lost on process restart
│
├─ Layer 2: Redis (L2, optional)
│  ├─ Shared across restarts
│  ├─ ~1-5ms lookup
│  ├─ Falls back to L1-only if REDIS_URL not set
│  └─ TTL per key (auto-expiry)
│
└─ Layer 3: Agent context (SQLite)
   ├─ Per-agent persistent cache
   ├─ 3× TTL multiplier (lasts 3x longer than Redis)
   ├─ Max 500 entries, 5MB per agent
   ├─ Survives Redis flush + process restart
   └─ Checked in executor before Redis

Lookup order:
├─ Check agent context (SQLite) → HIT? → return, 0 credits
├─ Check L1 memory → HIT? → return
├─ Check L2 Redis → HIT? → promote to L1, return
└─ MISS → execute, store in all layers

Cache key format: claw:SHA256(endpointId + JSON.stringify(params))[:16]

Query-level cache (orchestration):
├─ Key: claw:query:SHA256(query + strategy)[:16]
├─ TTL: 30 minutes (default)
├─ Cost: 1 credit on cache hit
└─ Stored after successful orchestration

Skill-level cache:
├─ Key: claw:skill:{skillId}:SHA256(variables)[:16]
├─ TTL: 300 seconds (5 min)
└─ Cost: 1 credit on cache hit

Data skill cache:
├─ Key: claw:data:{skillId}:SHA256(params)[:16]
├─ TTL: based on update_frequency
│  ├─ realtime:  60s
│  ├─ hourly:    3,600s
│  ├─ daily:     86,400s
│  ├─ weekly:    604,800s
│  └─ static:    2,592,000s (30 days)
└─ Cost: 1 credit on cache hit

Endpoint step cache:
├─ Key: claw:SHA256(endpointId + params)[:16]
├─ TTL: per endpoint in API registry (300s-604800s)
├─ Cost: 0 credits (transparent to caller)
└─ Checked during executePlan() per-step
```

---

## 20. Escrow

```
Hirer creates escrow for contracted work
│
├─ POST /v1/escrow (Clerk auth)
│  ├─ Body: { workerId: "clerk_xxx", amountCredits: 500, deadline: "2026-04-01" }
│  ├─ Status: CREATED
│  └─ Returns: { escrowId }
│
├─ State machine (7 states):
│  │
│  │  CREATED ──fund──→ FUNDED ──start──→ WORK_IN_PROGRESS
│  │                      │                    │         │
│  │                      │                 release    dispute
│  │                      │                    │         │
│  │                   refund              COMPLETED  DISPUTED
│  │                      │                             │
│  │                      ▼                          resolve
│  │                   REFUNDED                         │
│  │                                                    ▼
│  │                                                 RESOLVED
│  │
│  ├─ fundEscrow(escrowId, hirerId)
│  │  ├─ Deduct amountCredits from hirer's balance (atomic)
│  │  ├─ Credits held in escrow (not in anyone's balance)
│  │  └─ CREATED → FUNDED
│  │
│  ├─ transitionEscrow(id, 'WORK_IN_PROGRESS')
│  │  └─ FUNDED → WORK_IN_PROGRESS (worker starts)
│  │
│  ├─ releaseEscrow(escrowId)
│  │  ├─ Credits worker's balance
│  │  ├─ WIP → COMPLETED (handles transition internally)
│  │  └─ ⚠ Do NOT call transitionEscrow('COMPLETED') separately
│  │
│  ├─ refundEscrow(escrowId)
│  │  ├─ Credits back to hirer
│  │  └─ FUNDED → REFUNDED
│  │
│  └─ resolveEscrow(escrowId, workerPct)
│     ├─ Admin splits: workerPct% to worker, rest to hirer
│     ├─ e.g., 70% → worker gets 350cr, hirer gets 150cr
│     └─ DISPUTED → RESOLVED
│
├─ Expired escrow cron:
│  ├─ getExpiredEscrows() — past deadline + still FUNDED/WIP
│  └─ Admin notified for manual resolution
│
└─ Financials for 500cr escrow:
   ├─ Hirer deposits: 500 credits = $0.50 (locked)
   ├─ Worker completes: receives 500 credits
   ├─ Worker withdraws: 500 × $0.00075 = $0.375 USDC
   └─ Disputed (70/30 split): worker 350cr, hirer 150cr
```

---

## 21. Staking

```
Creator or supporter stakes credits to boost skill visibility
│
├─ POST /v1/marketplace/stake
│  ├─ Headers: X-API-Key: cn-xxxx
│  ├─ Body: { skillId: "my-skill", amountCredits: 1000, lockDays: 30 }
│  │
│  ├─ stakeCredits({ agentKey, amountCredits: 1000, skillId, lockDays: 30 })
│  │  ├─ Deduct 1000 credits from staker's balance
│  │  ├─ INSERT INTO stakes (agent_key, skill_id, amount_credits, unlocks_at)
│  │  │  └─ unlocks_at = datetime('now', '+30 days')
│  │  └─ Credits locked — cannot spend or withdraw until unlock
│  │
│  └─ Effect: skill's stake_total increases
│     └─ Discovery ranking: semantic_score × (1 + log(stake_total))
│        └─ More stake = higher visibility in search results
│
├─ Unlock (after 30 days):
│  ├─ POST /v1/marketplace/unstake/:stakeId
│  ├─ Check: unlocks_at <= now
│  │  ├─ Locked? → 400 { error: "Stake still locked", unlocksAt: "..." }
│  │  └─ Unlocked? → return credits to balance
│  └─ unstakeCredits(stakeId, agentKey)
│     └─ UPDATE api_keys SET credits = credits + 1000
│
├─ Stake unlock cron:
│  └─ Runs periodically, no auto-unstake — user must call unstake manually
│
└─ Financials:
   ├─ Staker locks: 1000 credits = $1.00 value (opportunity cost: can't use for 30 days)
   ├─ Benefit: skill ranks higher in discovery → more invocations → more revenue
   ├─ Risk: credits returned in full (no slashing)
   └─ Strategy: creators self-stake to bootstrap visibility
```

---

## 22. Agent Context Layer

```
Per-agent persistent memory — survives Redis flushes and restarts
│
├─ How it works:
│  ├─ Every executePlan() step result is auto-stored per agent
│  ├─ Key: (api_key, endpoint_id, params_hash)
│  ├─ TTL: 3× the endpoint's Redis TTL
│  │  └─ Redis TTL = 300s → agent context TTL = 900s
│  ├─ Max: 500 entries, 5MB total per agent
│  └─ Eviction: oldest entry deleted when limit hit
│
├─ Read path (during execution):
│  ├─ Before each step in executePlan():
│  │  ├─ getAgentContext(apiKey, endpointId, params)
│  │  ├─ HIT? → use cached data, skip API call, step.cached = true
│  │  └─ MISS? → proceed to Redis check → API call
│  └─ Cost: 0 credits (transparent optimization)
│
├─ Write path (after execution):
│  ├─ After successful step:
│  │  ├─ setAgentContext(apiKey, endpointId, params, data, category, ttl)
│  │  ├─ Hash: SHA256(endpointId + JSON(params))[:16]
│  │  └─ Stored in SQLite (not Redis)
│  └─ Entries >500KB silently skipped
│
├─ Management routes:
│  ├─ GET  /v1/context       → list entries (summary, no payload)
│  ├─ GET  /v1/context/stats → namespace stats (entries, size, categories)
│  ├─ DELETE /v1/context      → clear all context
│  └─ DELETE /v1/context/:id  → clear specific endpoint context
│
├─ Cleanup:
│  └─ purgeExpiredContexts() runs periodically (cron or on read miss)
│
└─ Why it exists:
   ├─ Agent asks "SOL price" → cached in context for 15 min
   ├─ Agent asks "Compare SOL to ETH" → SOL data reused from context
   ├─ No extra credits charged → agent gets smarter for free
   └─ 3× TTL means agent context outlasts Redis restarts
```

---

## 23. Referral System

```
Existing user shares referral code with friend
│
├─ Step 1: Get your code
│  ├─ GET /v1/referral/my-code (Clerk JWT auth)
│  ├─ If no code exists → auto-generate one
│  ├─ createReferralCode(code, ownerKey)
│  └─ Returns: { code: "ABC123" }
│
├─ Step 2: Friend applies code at signup
│  ├─ POST /v1/referral/apply (Clerk JWT auth)
│  ├─ Body: { code: "ABC123" }
│  │
│  ├─ Validation:
│  │  ├─ Code exists?
│  │  ├─ Not self-referral? (can't use your own code)
│  │  ├─ Not already used? (one referral per account)
│  │  └─ UNIQUE(referree_key) in referral_uses table
│  │
│  ├─ applyReferralCode(referreeKey, code, ownerKey, bonusReceiver, bonusOwner)
│  │  ├─ Friend (referree) gets: REFERRAL_BONUS_RECEIVER = 500 credits
│  │  ├─ You (referrer) get: REFERRAL_BONUS_OWNER = 250 credits
│  │  └─ Both credited atomically
│  │
│  └─ Returns: 'ok' | 'already_used' | 'self_referral'
│
└─ Financials:
   ├─ Friend gets: 500 free credits ($0.50 value)
   ├─ Referrer gets: 250 free credits ($0.25 value)
   ├─ Platform cost: 750 credits ($0.75) per referral
   └─ ROI: if friend spends $5 → platform recovers cost in ~3-4 queries
```

---

## 24. Skill Creation

```
Creator calls POST /v1/skills
├─ Headers: X-API-Key: cn-xxxx
├─ Body: {
│    name: "solana-gas-tracker",
│    description: "Real-time Solana gas fees and network congestion",
│    skillType: "data",                          ← prompt_template | api_proxy | data
│    proxyUrl: "https://my-api.com/solana/gas",  ← required for api_proxy and data
│    creditCost: 2,
│    category: "infrastructure",
│    tags: ["solana", "gas", "network"],
│    updateFrequency: "realtime",                ← data skills only
│    sampleOutput: { "avgFee": 0.00025, ... },   ← data skills only
│    creatorEvmWallet: "0xABC...",               ← optional, for x402 auto-split
│    public: true
│  }
│
├─ Step 1: Validation
│  ├─ Zod schema validation (all fields)
│  ├─ Name: 2-50 chars, alphanumeric + hyphens
│  ├─ Description: 10-500 chars
│  ├─ creditCost: 0-10000
│  ├─ EVM wallet: not zero address (0x000...000 rejected)
│  └─ updateFrequency: realtime|hourly|daily|weekly|static
│
├─ Step 2: Security checks
│  ├─ SSRF check on proxyUrl: isProxyUrlSafe()
│  │  └─ Must be HTTPS, no private IPs, no localhost, no IPv6 bypass
│  │
│  ├─ If prompt_template:
│  │  ├─ Render template with dummy variables (catch syntax errors)
│  │  └─ Scan for injection patterns:
│  │     ├─ "ignore previous", "system prompt", "<script>"
│  │     ├─ SQL injection markers
│  │     └─ Also scans executionPlanJson if provided
│  │
│  └─ Passed? → security_status = 'CLEAN'
│     Failed? → security_status = 'FLAGGED' (invisible to marketplace)
│
├─ Step 3: Store skill
│  ├─ INSERT INTO skills (id, name, description, skill_type, ...)
│  ├─ If public → immediately visible in marketplace
│  ├─ If pairedSkillId provided → validate ownership + set bidirectional link
│  └─ Begin embedding generation (background, for semantic discovery)
│
├─ Step 4: Optional — set execution plan
│  ├─ executionPlanJson: deterministic step sequence
│  ├─ If provided → skill invocations bypass LLM entirely (~3-5s faster)
│  └─ Official skills all have execution plans
│
└─ Response: {
     id: "solana-gas-tracker",
     name: "solana-gas-tracker",
     skillType: "data",
     creditCost: 2,
     status: "active",
     public: true
   }

Three skill types in detail:
├─ prompt_template:
│  ├─ Creator writes: "Analyze {token} for trading opportunities..."
│  ├─ On invoke: LLM plans x402 API calls → executes → synthesizes answer
│  ├─ Output: natural language analysis
│  └─ Cost to platform: LLM + x402 API calls
│
├─ api_proxy:
│  ├─ Creator provides: their own API URL
│  ├─ On invoke: ClawNet forwards request to creator's API
│  ├─ Output: whatever creator's API returns
│  └─ Cost to platform: $0 (creator hosts everything)
│
└─ data:
   ├─ Creator provides: data source URL + update_frequency + sample_output
   ├─ On query: GET to source URL → smart-cached by frequency
   ├─ Output: structured JSON (same shape as sample_output)
   └─ Cost to platform: $0 if creator-hosted, or x402 cost if using ClawAPIs
```

---

## 25. Task System (Async)

```
Agent calls POST /v1/tasks
├─ Headers: X-API-Key: cn-xxxx
├─ Body: {
│    skillId: "portfolio-optimizer",
│    variables: { walletAddress: "7xKXt..." },
│    idempotencyKey: "task-abc-123",        ← optional, prevents duplicate execution
│    webhookUrl: "https://my-agent.com/cb"  ← optional, POST result when done
│  }
│
├─ Step 1: Idempotency check
│  ├─ getTaskByIdempotencyKey("task-abc-123")
│  ├─ Exists? → return existing task (no re-execution, no double charge)
│  └─ New? → proceed
│
├─ Step 2: Create + execute
│  ├─ createTask({ requesterKey, skillId, input, idempotencyKey, webhookUrl })
│  ├─ Status: PENDING → RUNNING
│  ├─ Execute skill (same flow as §7-9 depending on skill_type)
│  ├─ Status: RUNNING → COMPLETED (or FAILED)
│  └─ Billing: max(actualCost, skill.credit_cost) with 97/3 split
│
├─ Step 3: Webhook delivery (if webhookUrl set)
│  ├─ POST https://my-agent.com/cb
│  │  Body: { taskId, status: "COMPLETED", result: { answer: "..." } }
│  │
│  ├─ Retry with exponential backoff:
│  │  ├─ Attempt 1: immediately
│  │  ├─ Attempt 2: +1 second
│  │  ├─ Attempt 3: +3 seconds
│  │  └─ Max 3 attempts total
│  │
│  ├─ updateWebhookStatus(taskId, attempts, status)
│  │  ├─ "delivered" — webhook received 2xx
│  │  └─ "failed" — all 3 attempts failed
│  │
│  └─ Webhook failure does NOT affect task result or billing
│
├─ Step 4: Rating (optional)
│  ├─ POST /v1/tasks/:id/rate { rating: 4 }
│  ├─ 1-5 stars
│  └─ Updates creator reputation: ±0.1 based on rating
│
└─ Polling: GET /v1/tasks/:id
   └─ Returns: { taskId, status, result, error, webhookStatus, costCredits, durationMs }
```

---

## 26. Admin Dashboard

```
Admin calls GET /v1/admin/dashboard
├─ Headers: X-Admin-Key: <ADMIN_API_KEY>
│
├─ Router-level guard: adminRouter.use('*', requireAdmin)
│  └─ ALL admin routes protected even if individual handler forgets check
│
├─ Dashboard data:
│  ├─ DB stats: getDbStats()
│  │  ├─ totalOrchestrations, totalRevenue, avgDurationMs
│  │  ├─ successRate, feedbackCount, avgRating, topQueries
│  │  └─ Active users (credits >= 1 AND used in last 30 days)
│  │
│  ├─ Cache stats: cacheStats()
│  │  └─ { memory: { size, hits, misses }, redisConnected }
│  │
│  ├─ Reconciliation: getReconciliation()
│  │  ├─ creditsRemaining (sum of all api_keys.credits)
│  │  ├─ creditsUsed (sum of all api_keys.credits_used)
│  │  ├─ creditsStaked (locked in stakes)
│  │  ├─ creditsInEscrow (held in active escrows)
│  │  ├─ totalGranted (all credits ever issued)
│  │  ├─ expectedCirculating = totalGranted - creditsUsed - creditsStaked - creditsInEscrow
│  │  ├─ drift = creditsRemaining - expectedCirculating
│  │  └─ Drift ≠ 0 means a bug in the financial system
│  │
│  ├─ Revenue: getRevenueBreakdown()
│  │  ├─ totalPlatformCredits, totalPlatformUsdEquiv
│  │  └─ Breakdown: marketplaceFees, invokeFees, swarmFees
│  │
│  └─ Treasury: getTreasuryStatus()
│     ├─ Treasury key balance
│     ├─ Official creator balance
│     └─ Recent fee transactions + refunds
│
├─ Admin actions:
│  ├─ Revoke API key: revokeKeyByKey(key, reason)
│  ├─ Revoke by email: revokeKeysByEmail(email, reason)
│  ├─ Manage payouts: approve/reject pending withdrawals
│  ├─ Flag skills: updateSkillSecurityStatus(skillId, 'FLAGGED')
│  └─ Resolve disputes: resolveEscrow(id, workerPct)
│
└─ Rendered as HTML dashboard (not JSON API)
```

---

## 27. Graceful Shutdown

```
SIGTERM or SIGINT received (Docker stop, Ctrl+C, deploy)
│
├─ 30 second hard deadline (process.exit(1) if exceeded)
│
├─ Phase 1: Stop accepting new requests (0s)
│  └─ HTTP server.close() — finish in-flight, reject new
│
├─ Phase 2: Drain in-flight requests (0-15s)
│  └─ Wait up to 15 seconds for active requests to complete
│
├─ Phase 3: Stop background services (15-25s)
│  ├─ stopHeartbeat()
│  ├─ stopPayoutCron()
│  ├─ stopEscrowCron()
│  ├─ stopSkillAbCron()
│  ├─ stopStakeUnlockCron()
│  ├─ stopEndpointHealthCron()
│  ├─ stopMeshNode() — libp2p graceful disconnect
│  └─ stopTelegram()
│
├─ Phase 4: Close data stores (25-30s)
│  ├─ closeRedis() — graceful QUIT command
│  └─ closeDb()
│     ├─ PRAGMA wal_checkpoint(TRUNCATE) — flush WAL to main DB
│     └─ db.close()
│
├─ Phase 5: Exit
│  └─ process.exit(0)
│
└─ Docker: stop_grace_period = 40s (> 30s hard deadline)
   └─ Docker sends SIGTERM, waits 40s, then SIGKILL
      (Was missing before — Docker would SIGKILL during 15s drain)
```

---

## 28. P2P Mesh Network

```
libp2p node starts on boot (startMeshNode)
│
├─ Configuration:
│  ├─ Transport: TCP on port 4001
│  ├─ Stream muxer: Yamux (@chainsafe/libp2p-yamux, NOT @libp2p/mplex)
│  ├─ Encryption: Noise protocol
│  ├─ Services: Kademlia DHT + Ping
│  └─ Listen: /ip4/0.0.0.0/tcp/4001
│
├─ Peer discovery:
│  ├─ Kademlia DHT crawl (automatic)
│  ├─ Bootstrap peers (if configured)
│  └─ On peer:connect event:
│     ├─ Extract peer ID + multiaddr
│     ├─ upsertPeer(peerId, addr, metadata)
│     │  └─ INSERT OR REPLACE INTO peers (id, multiaddr, last_seen)
│     └─ Log: "Mesh peer connected"
│
├─ API:
│  ├─ GET /v1/mesh/peers
│  │  └─ Returns: { nodeId, listening: ["/ip4/.../tcp/4001"], peers: [...] }
│  └─ Peers pruned: getPeers() returns last_seen > -24h
│     └─ pruneStalePeers() removes > 7 days old
│
├─ Used by:
│  ├─ Discovery (§18) — broadcast skill queries to mesh peers
│  └─ Future: agent-to-agent communication, swarm coordination
│
└─ VPS setup:
   └─ sudo ufw allow 4001/tcp (must be opened manually)
```

---

## 29. Billing Summary Table

Every route that costs credits, in one place:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Route                          │ Cost                    │ Split        │
├──────────────────────────────────────────────────────────────────────────┤
│ POST /v1/orchestrate           │ stepCredits + 2cr fee   │ 100% platform│
│ POST /v1/orchestrate (cached)  │ 1 credit                │ 100% platform│
│ GET  /v1/stream/orchestrate    │ stepCredits + 2cr fee   │ 100% platform│
│ POST /v1/batch                 │ (steps + 2cr) × queries │ 100% platform│
│ POST /v1/skills/:id/invoke     │ max(steps, skill.cost)  │ 97/3 or 100 │
│ POST /v1/skills/:id/invoke (c) │ 1 credit                │ 97/3 or 100 │
│ GET  /v1/skills/:id/query      │ skill.cost (live)       │ 97/3 or 100 │
│ GET  /v1/skills/:id/query (c)  │ 1 credit                │ 97/3 or 100 │
│ POST /v1/openclaw/invoke query │ stepCredits + 2cr fee   │ 100% platform│
│ POST /v1/openclaw/invoke skill │ max(steps, skill.cost)  │ 97/3 or 100 │
│ POST /v1/openclaw/invoke swarm │ 20cr base + sub-tasks   │ mixed        │
│ POST /x402/skills/:id          │ USDC payment            │ 97/3 USDC    │
│ POST /v1/marketplace/.../buy   │ skill.credit_cost       │ 97/3         │
│ POST /v1/tasks                 │ max(steps, skill.cost)  │ 97/3 or 100 │
│ POST /v1/swarm/task            │ 20cr + sub-task costs   │ mixed        │
│ POST /v1/marketplace/stake     │ amountCredits (locked)  │ n/a          │
├──────────────────────────────────────────────────────────────────────────┤
│ (c) = cache hit                                                         │
│ 97/3 = 97% creator + 3% treasury (third-party)                         │
│ 100  = 100% platform (official skills, author = clawhub-official)      │
│ mixed = base fee to platform + sub-task splits vary                     │
│ USDC = direct crypto payment, 97% auto-split to creator EVM wallet     │
├──────────────────────────────────────────────────────────────────────────┤
│ FREE routes (0 credits):                                                │
│ GET  /v1/estimate, /v1/health, /v1/stats, /v1/balance                  │
│ GET  /v1/discover, /v1/openclaw/catalog, /v1/openclaw/status           │
│ GET  /v1/skills (list), /v1/marketplace/* (browse)                     │
│ GET  /v1/context/*, /v1/mesh/peers, /v1/referral/*                     │
│ POST /v1/skills (create), POST /v1/marketplace/*/star                  │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Credit Purchase Rates

```
Buying credits:
├─ Stripe:   $1.00 = 1,000 credits ($0.001/credit)
├─ Solana:   $1.00 USDC = 1,000 credits ($0.001/credit)
└─ x402:     Per-call USDC pricing ($0.001/credit = X402_USDC_PER_CREDIT)

Selling credits (creator payout):
├─ Payout rate: $0.00075/credit (PAYOUT_USDC_PER_CREDIT)
├─ 25% below buy rate → prevents buy-withdraw arbitrage
├─ Min payout: $1.00 USDC (prevents dust payouts)
└─ Cron: every 4 hours via Solana USDC transfer

Platform margin per credit:
├─ Buy:    $0.001 in (from user)
├─ Payout: $0.00075 out (to creator)
├─ Spread: $0.00025 per credit (25% margin) ✓
└─ No arbitrage possible: buy at $0.001, withdraw at $0.00075 = loss

x402 surcharge (third-party prompt_template skills):
├─ Caller pays: skill.credit_cost + round6(apiCostUsd × CREDITS_PER_USD)
├─ Creator gets: 97% of skill.credit_cost (unchanged)
├─ Treasury gets: 3% fee + surcharge (surcharge → treasury → auto-sweep → operations wallet)
├─ Surcharge covers: real USDC spent by operations wallet on x402 API calls
├─ Applies to: third-party prompt_template skills only
└─ Does NOT apply to: official skills, api_proxy, data skills, cache hits

Decimal credits (v3):
├─ Credits can be fractional: 0.15, 0.75, 1.5, etc.
├─ Minimum charge: 0.001 credits ($0.000001)
├─ All credit math uses round6() — 6 decimal places, no floating-point drift
├─ A $0.0001 x402 endpoint = 0.15 credits (not rounded up to 1)
└─ Display: user sees exact decimal balance (e.g. "40.953 credits")
```

---

## 30. Complete USDC Money Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        3-WALLET ARCHITECTURE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  RECEIVING WALLET (H6xbRy...)                                              │
│  ├─ Purpose: Collects USDC from credit purchases                           │
│  ├─ Env: SOLANA_RECEIVING_WALLET (public address only, no key in .env)     │
│  ├─ IN:  Users send USDC to buy credits (solana.ts verify route)           │
│  ├─ OUT: Manual sweep to Operations + Payout wallets                       │
│  └─ Risk: LOW — no private key on server                                   │
│                                                                             │
│  OPERATIONS WALLET (AqYkp3...)                                             │
│  ├─ Purpose: Pays x402 API providers + receives treasury fee sweeps        │
│  ├─ Env: SOLANA_PRIVATE_KEY (bs58 private key)                             │
│  │       TREASURY_SWEEP_WALLET (same public address)                       │
│  ├─ IN:  Treasury auto-sweep (every 4h, 3% fees + x402 surcharges)        │
│  │       Manual top-up from Receiving wallet                               │
│  ├─ OUT: Pays ClawAPIs/x402 providers for API calls                       │
│  └─ Risk: MEDIUM — private key in .env, but only working capital at risk   │
│                                                                             │
│  PAYOUT WALLET (dedicated, separate)                                       │
│  ├─ Purpose: Sends USDC to skill creators                                  │
│  ├─ Env: PLATFORM_PAYOUT_PRIVATE_KEY (bs58 private key)                   │
│  ├─ IN:  Manual top-up from Receiving wallet                               │
│  ├─ OUT: Creator payouts (every 4h cron, rate: $0.00075/credit)           │
│  └─ Risk: MEDIUM — limited float, isolated from main funds                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

COMPLETE MONEY FLOW — $20 USDC purchase + skill invocations:

User sends $20 USDC to buy credits
│
├─ $20 USDC → RECEIVING wallet (H6xbRy...)
├─ 20,000 credits minted to user's DB balance
│
├─ User invokes third-party skill (credit_cost=10, x402 API cost=$0.003)
│  ├─ skillCredits = 10
│  ├─ surcharge = round6(0.003 × 1000) = 3 credits
│  ├─ TOTAL DEDUCTED from user: 13 credits
│  │
│  ├─ Creator gets: round6(10 × 0.97) = 9.7 credits  → topUpCredits(author)
│  ├─ Treasury gets: round6(10 - 9.7) = 0.3 credits   → topUpCredits(treasury)
│  ├─ Treasury gets: 3 credits (surcharge)              → topUpCredits(treasury)
│  └─ Total treasury: 3.3 credits per call
│
├─ Meanwhile, Operations wallet paid $0.003 to x402 provider
│  └─ Treasury has 3.3 credits → sweep converts at $0.00075/cr = $0.002475
│     └─ Net cost to platform: $0.003 - $0.002475 = $0.000525 (covered by margin)
│
├─ User invokes orchestration query (3 API steps, total cost = 5.4 credits)
│  ├─ stepCredits = 5.4 credits (creditsForExecution)
│  ├─ orchestration fee = 2 credits
│  ├─ TOTAL DEDUCTED: 7.4 credits
│  ├─ Nobody gets paid — credits burned (reduces platform obligation)
│  └─ Platform profit = 7.4 credits × $0.001 = $0.0074 in reduced liability
│
├─ Treasury auto-sweep (every 4h, payout-cron.ts)
│  ├─ Check clawhub-treasury balance (3% fees + surcharges accumulated)
│  ├─ If balance >= TREASURY_SWEEP_MIN (default 10,000 credits)
│  ├─ Convert: credits × PAYOUT_USDC_PER_CREDIT = USDC amount
│  ├─ deductTreasuryForSweep(balance)
│  ├─ sendSolanaUsdc(TREASURY_SWEEP_WALLET, amountUsdc)
│  └─ USDC arrives in Operations wallet → refills x402 calling funds
│
├─ Creator requests payout
│  ├─ Creator has 9.7 credits earned → POST /v1/marketplace/payout-request
│  ├─ Credits deducted from creator's balance
│  ├─ Payout cron picks up PENDING request
│  ├─ Convert: 9.7 × $0.00075 = $0.007275 USDC
│  ├─ sendSolanaUsdc(creatorWallet, $0.007275) from PAYOUT wallet
│  └─ Creator receives USDC
│
└─ Hot wallet balance check (every 4h)
   ├─ getHotWalletUsdcBalance() checks PAYOUT wallet
   ├─ If below HOT_WALLET_LOW_BALANCE_USDC ($50 default)
   └─ Telegram alert: "Top up PLATFORM_PAYOUT_PRIVATE_KEY wallet"

STRIPE FLOW:
├─ User pays $20 via Stripe checkout
├─ $20 → Stripe balance (your Stripe account)
├─ 20,000 credits minted to user's DB balance
├─ Stripe auto-payout → your bank account (Stripe settings)
└─ Manual: bank → buy USDC → send to Receiving/Operations/Payout wallets

CREDIT ACCOUNTING INVARIANT:
├─ credits_minted = SUM(all topUpCredits from purchases)
├─ credits_in_circulation = SUM(api_keys.credits) + SUM(stakes) + SUM(escrows)
├─ credits_burned = SUM(orchestration fees + cache hits)
├─ credits_transferred = SUM(transactions: author shares + treasury fees + surcharges)
├─ MUST HOLD: credits_minted = credits_in_circulation + credits_burned + credits_paid_out
└─ Check: GET /v1/admin/reconcile → drift should be 0
```

---

*Generated from codebase analysis. Last updated: 2026-03-12. Decimal credits (v3), treasury auto-sweep, surcharge-to-treasury fix, 3-wallet architecture.*
