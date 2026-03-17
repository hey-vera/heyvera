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
31. [Endpoint Auto-Discovery](#31-endpoint-auto-discovery)
32. [Pricing Economics](#32-pricing-economics)
33. [Agent Economy Layer](#33-agent-economy-layer)
34. [Site Architecture & UX](#34-site-architecture--ux)
35. [Skill Health Monitoring](#35-skill-health-monitoring)
36. [Per-Skill Rate Limiting](#36-per-skill-rate-limiting)
37. [MCP & OpenAPI Manifests](#37-mcp--openapi-manifests)
38. [Skill Discovery Extras](#38-skill-discovery-extras)
39. [Webhook HMAC Signing](#39-webhook-hmac-signing)
40. [Credit Gifting](#40-credit-gifting)
41. [x402 Verification & Reputation](#41-x402-verification--reputation)
42. [Stripe Subscription Lifecycle](#42-stripe-subscription-lifecycle)
43. [Trust Signals & Cryptographic Receipts](#43-trust-signals--cryptographic-receipts)
44. [Composite Skills (Subcontracting)](#44-composite-skills-subcontracting)
45. [SLA Contracts](#45-sla-contracts)
46. [Skill Output Contracts](#46-skill-output-contracts)
47. [Agent Budget Accounts](#47-agent-budget-accounts)
48. [Event Webhooks](#48-event-webhooks)
43. [Stripe Refund Flow](#43-stripe-refund-flow)
44. [Dashboard Authentication & Claim](#44-dashboard-authentication--claim)
45. [Creator Revenue Dashboard](#45-creator-revenue-dashboard)
46. [Clerk Webhooks & GDPR Erasure](#46-clerk-webhooks--gdpr-erasure)
47. [Contact Form](#47-contact-form)
48. [Dev Revenue Flow — Where the Money Goes](#48-dev-revenue-flow--where-the-money-goes)
56. [Public Roadmap & Token Launch Tracker](#56-public-roadmap--token-launch-tracker)
57. [Agent Self-Onboarding](#57-agent-self-onboarding)
58. [Flywheel — Recommendations & Discovery](#58-flywheel--recommendations--discovery)
59. [Creator Tools & Quality Scoring](#59-creator-tools--quality-scoring)
60. [Agent Referral System](#60-agent-referral-system)
61. [Embeddable Widgets](#61-embeddable-widgets)

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
├─ Step 5: Response returned (smart cache v2)
│  ├─ Smart cache: content-hash tracked, adaptive TTL applied, gzip compressed for Redis
│  ├─ 4 billing scenarios: fresh hit (10%), SWR stale (10%), unchanged data (10%), changed data (100%)
│  ├─ Response includes: creditsSaved, fullPriceCredits, staleServed, unchangedData
│  ├─ Optional diff: { changed: { price: { from: 145, to: 146.8 } } } when diff:true
│  ├─ Logged to orchestrations table (query, steps, cost, duration)
│  └─ Agent context updated (3× TTL persistent cache per agent)
│
└─ Step 6: Creator gets paid (if third-party skill)
   ├─ 85% of skill.credit_cost → creator's credit balance
   ├─ 15% of skill.credit_cost → clawhub-treasury
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
│  ├─ Runs 68 migrations (v1 → v68) — each is idempotent
│  │  ├─ v1-v10: Core tables (api_keys, skills, orchestrations, feedback)
│  │  ├─ v11-v20: Marketplace (transactions, stakes, payout_requests)
│  │  ├─ v21-v30: Escrow, governance, tasks, swarms
│  │  ├─ v31-v40: Skill metrics, ratings, versions, A/B testing
│  │  ├─ v41-v44: Financial safety triggers + performance indexes
│  │  ├─ v45-v48: Context layer, reputation, endpoint health, subscriptions
│  │  ├─ v49-v51: Data skills (sample_output_json, update_frequency)
│  │  ├─ v52: paired_skill_id column
│  │  ├─ v53-v64: Economy layer (trust signals, receipts, compare, composite)
│  │  ├─ v65-v67: SLA contracts, composability v2, dynamic pricing, validators, sessions
│  │  └─ v68: Smart cache (cache_volatility, cache_access_log tables)
│  └─ Logs: "Database initialized (68 migrations applied)"
│
├─ initRedis()
│  ├─ If REDIS_URL set → connect to Redis (L2 cache)
│  └─ If not set → memory-only cache (L1), no error
│
├─ preloadCache()
│  ├─ Queries cache_access_log for top 50 hot keys (3+ accesses in 24h)
│  ├─ Pre-loads from Redis into L1 memory
│  └─ Eliminates cold-start penalty after deploy
│
├─ seedOfficialSkills()
│  ├─ Ensures clawhub-official key exists (platform author, 0% fee)
│  ├─ Ensures clawhub-treasury key exists (collects 15% fees)
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
│  ├─ /v1/recommendations → recommendations.ts (co-usage, popular, trending)
│  ├─ /v1/creator → creator.ts (templates, validation, revenue estimates)
│  ├─ /v1/cache   → cache-stats.ts (per-agent stats, optimizer)
│  └─ /webhook/*  → clerk-webhook.ts, stripe-webhook.ts
│
├─ Start background services (9 crons)
│  ├─ startPayoutCron() → every 4 hours, settles PENDING payouts via Solana USDC
│  ├─ startEscrowCron() → checks expired escrows
│  ├─ startSkillAbCron() → promotes A/B test winners
│  ├─ startStakeUnlockCron() → unlocks matured stakes
│  ├─ startEndpointHealthCron() → pings API providers
│  ├─ startEndpointDiscoveryCron() → polls clawapis.com/api/pricing every 4h
│  ├─ startSkillHealthCron() → pings skill proxy_urls every 15m
│  ├─ startSkillSchedulerCron() → executes due scheduled skills every 1m
│  ├─ startCacheWarmingCron() → pre-fetches hot keys every 5m + health alerting
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
│  ├─ HIT? → return cached response, deduct proportional cache fee
│  │  └─ cacheCreditCost(liveCost) = 10% of live, min 0.1 credits
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
└─ Cache hit on same query: next caller pays cacheCreditCost (10% of live, min 0.1cr), $0 platform cost
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
│  ├─ HIT? → return cached, bill cacheCreditCost(skill.credit_cost) — 10% of live
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
│  │  ├─ authorShare = round6(chargedCredits × 0.85) → creator balance
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
├─ Creator gets: round6(10 × 0.85) = 8.5 credits (split on skillCredits only)
├─ Treasury gets: 10 - 8.5 = 1.5 credits ($0.0015)
├─ Platform x402 cost: $0.004 (covered by surcharge = $0.004)
├─ Platform revenue: $0.0015 treasury + $0.004 surcharge - $0.004 x402 = $0.0015 profit
└─ NET: +$0.0015 per call ✓ (was -$0.0035 LOSS before surcharge fix)
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
│  ├─ 85% → creator, 15% → treasury
│  └─ Platform cost: $0 (creator hosts the API, not us)
│
└─ Response: { answer: <creator API response>, skill: { id, version } }

Financials — api_proxy skill (creator-hosted, 3cr):
├─ Agent pays: 3 credits ($0.003)
├─ Creator gets: round6(3 × 0.85) = 2.55 credits
├─ Treasury gets: 0.45 credits ($0.00045)
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
│  │  ├─ Bill: cacheCreditCost(skill.credit_cost) — 10% of live, min 0.1cr
│  │  ├─ Creator still earns full credit_cost (platform absorbs delta)
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
│  │  ├─ 85% → creator
│  │  └─ 15% → treasury
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
├─ Creator gets: round6(3 × 0.85) = 2.55 credits
├─ Treasury gets: 0.45 credits ($0.00045)
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
│  └─ Cache hit: cacheCreditCost(liveCost) — 10% of original, min 0.1cr
│
├─ action: "skill"
│  ├─ Body: { action: "skill", skillId: "token-analysis", variables: { token: "SOL" } }
│  ├─ Same flow as POST /v1/skills/:id/invoke (§7)
│  ├─ Billing: max(actualCost, skill.credit_cost) with 85/15 split
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
│  │  │  ├─ Calculate: 85% of payment = $0.00425 USDC
│  │  │  ├─ sendBaseUsdc(creatorWallet, 0.00425)
│  │  │  │  └─ EVM_PRIVATE_KEY signs tx on Base mainnet
│  │  │  ├─ Wait 1 confirmation
│  │  │  └─ Log tx hash (don't block response on failure)
│  │  │
│  │  └─ NO → platform keeps 100% (creator didn't set EVM wallet)
│  │
│  └─ Platform keeps: 15% = $0.00075 USDC (or 100% if no wallet)
│
└─ Response: { answer: "...", metadata: { durationMs, skill } }

x402 listing:
├─ GET /x402/skills → all public skills with USDC pricing
└─ GET /x402/ → provider discovery (x402 protocol standard)

Financials — x402 call on 5cr skill with creator_evm_wallet:
├─ Agent pays: $0.005 USDC (on Base)
├─ Creator receives: $0.00425 USDC (85%, auto-split to Base wallet)
├─ Platform keeps: $0.00075 USDC (15%)
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
│  │  │  ├─ feePct = (author === 'clawhub-official') ? 0 : 15
│  │  │  ├─ authorShare = round6(10 × 0.85) = 8.5 credits
│  │  │  └─ feeCredits = 10 - 8.5 = 1.5 credits
│  │  │
│  │  ├─ Credit seller:
│  │  │  UPDATE api_keys SET credits = credits + 8.5 WHERE key = ?
│  │  │
│  │  ├─ Credit treasury:
│  │  │  UPDATE api_keys SET credits = credits + 1.5 WHERE key = 'clawhub-treasury'
│  │  │
│  │  └─ Record transaction:
│  │     INSERT INTO transactions (from_agent, to_agent, amount_credits, type, fee_credits, skill_id)
│  │     VALUES (buyer, seller, 10, 'SKILL_SALE', 1.5, 'defi-scanner')
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
├─ Seller receives: 8.5 credits (in their balance, withdrawable)
├─ Treasury receives: 1.5 credits ($0.0015)
├─ Refund on failure: buyer gets 10 back, seller loses 8.5, treasury loses 1.5
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
│  ├─ Creator share: 85% = $0.00425 USDC
│  └─ Platform keeps: 15% = $0.00075 USDC
│
├─ Step 2: Send USDC on Base
│  │  (src/utils/evm-payout.ts → sendBaseUsdc())
│  │
│  ├─ Load EVM_PRIVATE_KEY (platform's Base wallet)
│  ├─ USDC contract: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
│  ├─ Chain: Base mainnet (chainId: 8453)
│  ├─ transfer(creatorWallet, 4250) — 6 decimals
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

## 19. Cache System (Smart Cache v2)

```
Smart cache architecture (28 features, 3 layers):

Request arrives
│
├─ Layer 1: Memory cache (L1)
│  ├─ In-process JavaScript Map
│  ├─ Smart eviction: LFU weighted by accessCount × creditCost
│  │  └─ Expensive, frequently-accessed entries survive over cheap, rare ones
│  ├─ Fastest: ~0.01ms lookup
│  ├─ Memory tracking: totalBytes + totalMB in stats
│  └─ Lost on process restart (preloaded from Redis on boot)
│
├─ Layer 2: Redis (L2, optional)
│  ├─ Shared across restarts
│  ├─ ~1-5ms lookup
│  ├─ Gzip compression: values >1KB auto-compressed (60-80% Redis memory savings)
│  ├─ Falls back to L1-only if REDIS_URL not set
│  └─ TTL per key (auto-expiry)
│
└─ Layer 3: Agent context (SQLite)
   ├─ Per-agent persistent cache
   ├─ 3× TTL multiplier (lasts 3x longer than Redis)
   ├─ Max 500 entries, 5MB per agent
   ├─ Survives Redis flush + process restart
   └─ Checked in executor before Redis

Lookup order (with client freshness control):
├─ Client sends { cache: "prefer" | "fresh" | "smart" }
│  ├─ "prefer": serve any cached data (cheapest)
│  ├─ "fresh": skip cache, always fetch live (most expensive)
│  └─ "smart" (default): serve fresh cache, or stale+SWR
│
├─ Check negative cache → recent failure? → return CACHED_FAILURE (skip broken endpoint)
├─ Check agent context (SQLite) → HIT? → return, 0 credits
├─ Check L1 memory (smartCacheGet) →
│  ├─ FRESH HIT → return, cache rate (10%)
│  └─ STALE HIT (SWR) → return stale data immediately, enqueue background refresh
│     └─ Background refresh: bounded queue (max 100, 5 concurrent), deduped by key
├─ Check L2 Redis → HIT? → decompress if gzipped, promote to L1, return
└─ MISS → coalesceRequest() → single upstream call shared across concurrent waiters
   ├─ Content-hash comparison: if data unchanged from previous cache → charge cache rate
   ├─ Delta/diff: if client sent diff:true → include { changed, added, removed } in response
   ├─ Store in L1 + L2 + agent context
   ├─ Record volatility check (for adaptive TTL learning)
   └─ Record cache access (for analytics + warming)

Cache key format: claw:SHA256(endpointId + normalizedParams)[:16]
├─ Semantic normalization: SOL/sol/Solana → same key
├─ Symbol aliases: bitcoin→btc, ethereum→eth, solana→sol, etc.
└─ All param values lowercased + trimmed before hashing

Smart billing (4 scenarios):
├─ Fresh cache hit:      10% of live cost (cache rate)
├─ SWR stale served:     10% of live cost (cache rate)
├─ Fresh fetch, data UNCHANGED (content-hash match): 10% (smart pricing)
├─ Fresh fetch, data CHANGED: 100% full rate
└─ Response includes: creditsSaved, fullPriceCredits, staleServed, unchangedData

Adaptive TTL (auto-tuning):
├─ Tracks change frequency per endpoint in cache_volatility table
├─ volatilityRatio = change_count / check_count
├─ TTL multiplier:
│  ├─ ratio < 0.1 (rarely changes):  2.5× base TTL
│  ├─ ratio < 0.3 (mostly stable):   1.5× base TTL
│  ├─ ratio 0.3-0.7 (normal):        1.0× (no change)
│  ├─ ratio > 0.7 (volatile):        0.5× base TTL
│  └─ ratio > 0.9 (always changing): 0.25× base TTL
├─ Clamped: min 30s, max 3× original
└─ Needs ≥10 checks before adjusting (insufficient data → use base TTL)

Request coalescing (single-flight):
├─ If 10 agents request SOL price simultaneously with empty cache:
│  ├─ WITHOUT coalescing: 10 upstream API calls (10× cost)
│  └─ WITH coalescing: 1 upstream call, 9 agents wait for same result
├─ Implemented via inFlightRequests Map, deduped by cache key
└─ Promise shared across all concurrent callers for same key

Negative caching (failure protection):
├─ When an endpoint fails (500, timeout, circuit open):
│  ├─ Cache the failure for 30 seconds
│  └─ Subsequent requests return CACHED_FAILURE immediately
├─ Prevents thundering herd on broken endpoints
└─ Auto-expires after 30s, retry allowed

Startup preloading:
├─ On server boot, after Redis connects:
│  ├─ Query cache_access_log for top 50 hot keys (3+ accesses in 24h)
│  ├─ Pre-load from Redis into L1 memory
│  └─ Eliminates cold-start penalty after deploy
└─ Logged: "Cache preloaded from Redis: loaded X/Y candidates"

Cache warming cron (every 5 minutes):
├─ Identifies hot keys about to expire (>80% through TTL)
├─ Pre-fetches up to 10 endpoints per cycle
├─ Platform absorbs upstream cost, earns cache-hit revenue from agents
├─ Piggybacks health check: alerts admin if hit rate drops >20%
└─ setInterval().unref() — doesn't prevent process exit

Multi-layer invalidation:
├─ invalidateKey(key): L1 memory + L2 Redis (key + meta + gz) + L3 agent context
├─ invalidateByEndpoint(endpointId): all L1 entries tagged with that endpoint
├─ Batch invalidation: DELETE /v1/admin/cache/keys (up to 100 keys)
└─ Per-endpoint: DELETE /v1/admin/cache/endpoint/:endpointId

Cache optimizer (beyond-100% feature):
├─ GET /v1/cache/optimizer → TTL suggestions per endpoint
│  ├─ "claw-token-price: increase TTL 60s→150s, save ~340 credits/day"
│  ├─ "claw-token-metadata: already optimal (hitRate 98%)"
│  └─ "claw-x-mentions: decrease TTL, data changes every fetch"
├─ GET /v1/cache/my-stats → per-agent hit rate + personalized suggestions
│  └─ "You use cache:'fresh' on 80% of requests → switch to 'smart' for ~$4/mo savings"
└─ Based on real volatility data + agent usage patterns

Cache analytics (DB tables):
├─ cache_volatility: per-endpoint change tracking (check_count, change_count, last_hash)
├─ cache_access_log: every access logged (hit, stale_served, content_changed, credits_saved)
└─ Admin endpoints:
   ├─ GET /v1/admin/cache/stats — memory/redis/compression stats
   ├─ GET /v1/admin/cache/volatility — all endpoint volatility data
   ├─ GET /v1/admin/cache/hot-keys — most popular cache keys
   ├─ GET /v1/admin/cache/endpoint-analytics — per-endpoint hit rates (7 days)
   └─ GET /v1/admin/cache/warming-candidates — keys queued for pre-fetch

Key files:
├─ src/cache/index.ts — core: 28 features (coalescing, SWR, compression, eviction, etc.)
├─ src/cache/adaptive-ttl.ts — volatility tracking + TTL auto-tuning
├─ src/cache/warming.ts — hot key detection + analytics + access logging
├─ src/cache/health-alert.ts — admin alerts on hit rate drops
├─ src/cache/optimizer.ts — TTL suggestions + budget advisor
├─ src/core/cache-warming-cron.ts — periodic pre-fetch cron
├─ src/core/executor.ts — consumer: coalescing, negative cache, smart billing
├─ src/routes/cache-admin.ts — admin endpoints (stats, invalidation, analytics)
└─ src/routes/cache-stats.ts — agent-facing stats (GET /v1/cache/my-stats + /optimizer)

Data skill TTL tiers (unchanged):
├─ realtime:  60s
├─ hourly:    3,600s
├─ daily:     86,400s
├─ weekly:    604,800s
├─ static:    2,592,000s (30 days)
└─ Custom: "30s", "5m", "2h", "3d" (clamped 10s-30d)
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
│  └─ Billing: max(actualCost, skill.credit_cost) with 85/15 split
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
│  ├─ stopEndpointDiscoveryCron()
│  ├─ stopMeshNode() — libp2p graceful disconnect
│  └─ (email alerts — no teardown needed)
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
│ POST /v1/orchestrate (cached)  │ cacheCreditCost (10%)    │ 100% platform│
│ GET  /v1/stream/orchestrate    │ stepCredits + 2cr fee   │ 100% platform│
│ POST /v1/batch                 │ (steps + 2cr) × queries │ 100% platform│
│ POST /v1/skills/:id/invoke     │ max(steps, skill.cost)  │ 85/15 or 100│
│ POST /v1/skills/:id/invoke (c) │ cacheCreditCost (10%)   │ 85/15 or 100│
│ GET  /v1/skills/:id/query      │ skill.cost (live)       │ 85/15 or 100│
│ GET  /v1/skills/:id/query (c)  │ cacheCreditCost (10%)   │ 85/15 or 100│
│ POST /v1/openclaw/invoke query │ stepCredits + 2cr fee   │ 100% platform│
│ POST /v1/openclaw/invoke skill │ max(steps, skill.cost)  │ 85/15 or 100│
│ POST /v1/openclaw/invoke swarm │ 20cr base + sub-tasks   │ mixed        │
│ POST /x402/skills/:id          │ USDC payment            │ 85/15 USDC   │
│ POST /v1/marketplace/.../buy   │ skill.credit_cost       │ 85/15        │
│ POST /v1/tasks                 │ max(steps, skill.cost)  │ 85/15 or 100│
│ POST /v1/swarm/task            │ 20cr + sub-task costs   │ mixed        │
│ POST /v1/marketplace/stake     │ amountCredits (locked)  │ n/a          │
├──────────────────────────────────────────────────────────────────────────┤
│ (c) = cache hit                                                         │
│ 85/15 = 85% creator + 15% treasury (third-party)                       │
│ 100  = 100% platform (official skills, author = clawhub-official)      │
│ mixed = base fee to platform + sub-task splits vary                     │
│ USDC = direct crypto payment, 85% auto-split to creator EVM wallet     │
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
├─ Creator gets: 85% of skill.credit_cost (unchanged)
├─ Treasury gets: 15% fee + surcharge (surcharge covers real USDC spent by hot wallet)
├─ Surcharge covers: real USDC spent by hot wallet on x402 API calls
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
│                        2-WALLET ARCHITECTURE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  RECEIVING WALLET (H6xbRy...)                                              │
│  ├─ Purpose: Collects USDC from credit purchases                           │
│  ├─ Env: SOLANA_RECEIVING_WALLET (public address only, no key in .env)     │
│  ├─ IN:  Users send USDC to buy credits (solana.ts verify route)           │
│  ├─ OUT: Manual sweep to Hot Wallet when needed                            │
│  └─ Risk: LOW — no private key on server                                   │
│                                                                             │
│  HOT WALLET (AqYkp3...)                                                    │
│  ├─ Purpose: Pays x402 API providers + sends USDC to creators              │
│  ├─ Env: SOLANA_PRIVATE_KEY (bs58 private key)                             │
│  │       PLATFORM_PAYOUT_PRIVATE_KEY (same key — both point here)          │
│  ├─ IN:  Manual top-up from Receiving wallet / bank                        │
│  ├─ OUT: x402 API calls + creator payouts (every 4h cron)                  │
│  └─ Risk: MEDIUM — private key in .env, keep limited float                 │
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
│  ├─ Creator gets: round6(10 × 0.85) = 8.5 credits  → topUpCredits(author)
│  ├─ Treasury gets: round6(10 - 8.5) = 1.5 credits   → topUpCredits(treasury)
│  ├─ Treasury gets: 3 credits (surcharge)              → topUpCredits(treasury)
│  └─ Total treasury: 4.5 credits per call
│
├─ Meanwhile, Hot wallet paid $0.003 to x402 provider
│  └─ Treasury has 4.5 credits (pure profit in 2-wallet setup — no sweep needed)
│     └─ Net cost to platform: $0.003 API cost, offset by 4.5cr × $0.001 = $0.0045 in user payments
│
├─ User invokes orchestration query (3 API steps, total cost = 5.4 credits)
│  ├─ stepCredits = 5.4 credits (creditsForExecution)
│  ├─ orchestration fee = 2 credits
│  ├─ TOTAL DEDUCTED: 7.4 credits
│  ├─ Nobody gets paid — credits burned (reduces platform obligation)
│  └─ Platform profit = 7.4 credits × $0.001 = $0.0074 in reduced liability
│
├─ Treasury credits (every 4h, payout-cron.ts)
│  ├─ clawhub-treasury accumulates 15% fees + x402 surcharges
│  ├─ With 2-wallet setup: these are pure DB profit (no sweep needed)
│  ├─ Optional: if TREASURY_SWEEP_WALLET is set, auto-sweep converts
│  │   credits to USDC and sends to that wallet
│  └─ Admin dashboard shows treasury balance via /v1/admin/reconcile
│
├─ Creator requests payout
│  ├─ Creator has 8.5 credits earned → POST /v1/marketplace/payout-request
│  ├─ Credits deducted from creator's balance
│  ├─ Payout cron picks up PENDING request
│  ├─ Convert: 8.5 × $0.00075 = $0.006375 USDC
│  ├─ sendSolanaUsdc(creatorWallet, $0.006375) from HOT wallet
│  └─ Creator receives USDC
│
└─ Hot wallet balance check (every 4h)
   ├─ getHotWalletUsdcBalance() checks HOT wallet USDC
   ├─ getPayoutWalletSolBalance() checks HOT wallet SOL (gas)
   ├─ If USDC below HOT_WALLET_LOW_BALANCE_USDC ($50 default) → email alert
   └─ If SOL below HOT_WALLET_LOW_SOL (0.1 default) → email alert

STRIPE FLOW:
├─ User pays $20 via Stripe checkout
├─ $20 → Stripe balance (your Stripe account)
├─ 20,000 credits minted to user's DB balance
├─ Stripe auto-payout → your bank account (Stripe settings)
└─ Manual: bank → buy USDC → send to Hot Wallet

CREDIT ACCOUNTING INVARIANT:
├─ credits_minted = SUM(all topUpCredits from purchases)
├─ credits_in_circulation = SUM(api_keys.credits) + SUM(stakes) + SUM(escrows)
├─ credits_burned = SUM(orchestration fees + cache hits)
├─ credits_transferred = SUM(transactions: author shares + treasury fees + surcharges)
├─ MUST HOLD: credits_minted = credits_in_circulation + credits_burned + credits_paid_out
└─ Check: GET /v1/admin/reconcile → drift should be 0
```

---

## 31. Endpoint Auto-Discovery

```
ClawNet starts → 30s delay → runEndpointDiscovery()
│
├─ Fetch https://clawapis.com/api/pricing (15s timeout)
│  └─ Returns JSON: { x: {81 endpoints}, helius: {80 endpoints}, solscan: {22 endpoints} }
│
├─ Parse each API section:
│  ├─ X/Twitter (81 endpoints)
│  │  ├─ Key format: "GET /x/2/tweets/*" → id: "clawapis-x-2-tweets"
│  │  ├─ Pricing: $0.05 (tier 1), $0.10 (tier 2), $0.15 (tier 3)
│  │  └─ Category: social (most), intelligence (trends), utility (compliance)
│  │
│  ├─ Helius (80 endpoints)
│  │  ├─ Key format: "getBalance" → id: "clawapis-helius-getbalance"
│  │  ├─ Pricing: $0.001 (standard RPC), $0.005 (DAS), $0.05 (enhanced)
│  │  └─ Category: solana (tokens/assets), infrastructure (RPC)
│  │
│  └─ SolScan (22 endpoints)
│     ├─ Key format: "GET /solscan/account/tokens" → id: "clawapis-solscan-account-tokens"
│     ├─ Pricing: $0.01 flat (all endpoints)
│     └─ Category: solana (tokens/NFT), defi (market data)
│
├─ For each discovered endpoint:
│  ├─ Generate stable ID: clawapis-{api}-{path}
│  ├─ Auto-classify category from description keywords
│  ├─ Infer input/output schemas from API type + description
│  ├─ Compute credit cost: creditCostForEndpoint({ costPerCall })
│  └─ Assign to capability group if applicable (for optimizer swaps)
│
├─ Merge into live registry:
│  ├─ New endpoint? → append to apiRegistry + index in Map
│  ├─ Existing endpoint? → update costPerCall if changed upstream
│  └─ Capability groups merge into dynamicAlternatives (used by optimizer)
│
├─ Registry structure:
│  ├─ Static: 161 hardcoded endpoints (all providers)
│  ├─ Discovered: 183 ClawAPIs endpoints (auto-refreshed)
│  ├─ Total: 344 endpoints available to orchestrator
│  └─ Map index: O(1) findEndpoint() lookups (was O(n))
│
├─ Cron: repeats every 4 hours
│  └─ New endpoints added by ClawAPIs appear automatically within 4h
│
└─ Stats: GET /v1/stats shows { endpoints: { total, static, discovered, byProvider } }

EXTENSIBILITY:
├─ Architecture supports any provider with a discovery endpoint
├─ Add new provider: ~10 lines in endpoint-discovery.ts
├─ Current: only ClawAPIs has standardized /api/pricing
└─ Future: x402engine, DeFi Llama, etc. when they add discovery APIs
```

---

## 32. Pricing Economics

```
CREDIT PRICING (all sub-$0.001 on cheapest endpoints):

  Endpoint USD Cost × 1500 (COST_MARKUP_FACTOR) = Credits Charged
  ─────────────────────────────────────────────────────────────────
  $0.0001 (cheapest)      × 1500  =  0.15 credits  ($0.00015)
  $0.0005 (mid-cheap)     × 1500  =  0.75 credits  ($0.00075)
  $0.001  (standard RPC)  × 1500  =  1.5 credits   ($0.0015)
  $0.005  (DAS/enhanced)  × 1500  =  7.5 credits   ($0.0075)
  $0.01   (SolScan flat)  × 1500  =  15 credits    ($0.015)
  $0.05   (X API tier 1)  × 1500  =  75 credits    ($0.075)
  $0.10   (X API tier 2)  × 1500  =  150 credits   ($0.15)

  SMART CACHE PRICING (proportional — 10% of live, min 0.1 credits):
    Live Cost    → Cache Cost   (USD)       Savings
    ─────────────────────────────────────────────────
    0.15 cr      → 0.1 cr      ($0.0001)   33% off (minimum floor)
    0.75 cr      → 0.1 cr      ($0.0001)   87% off (minimum floor)
    1.5 cr       → 0.15 cr     ($0.00015)  90% off
    7.5 cr       → 0.75 cr     ($0.00075)  90% off
    15 cr        → 1.5 cr      ($0.0015)   90% off
    75 cr        → 7.5 cr      ($0.0075)   90% off
    150 cr       → 15 cr       ($0.015)    90% off
    37,500 cr    → 3,750 cr    ($3.75)     90% off

  Formula: cacheCreditCost(live) = round6(max(0.1, live × 0.10))

  Orchestration fee = 2 credits ($0.002) — LLM planning + synthesis
  Minimum possible charge = 0.001 credits ($0.000001)

MARGIN ANALYSIS:
├─ Buy rate:    1 credit = $0.001 (Stripe/USDC purchase)
├─ Cost rate:   1 credit covers $0.000667 API cost (at 1500× markup)
├─ Margin:      33% gross on every live endpoint call
├─ Orch fee:    100% margin (LLM cost ≈ $0.0004, fee = $0.002)
├─ Cache hits:  10% of live price retained — proportional platform revenue
│               (was flat 1cr — unfair on expensive endpoints)
└─ Payout rate: $0.00075/credit (25% below buy rate — prevents arbitrage)

CACHE FAIRNESS (all 3 parties win):
├─ User:     90% cheaper than live (always), instant response
├─ Creator:  earns full credit_cost regardless of cache vs live
│            (IP compensated identically, zero incentive to fight caching)
├─ Platform: proportional revenue on cache hits, pays $0 upstream
│            (no longer subsidizing expensive data for flat $0.001)
└─ Net: high cache-hit ratio = lower costs for users, proportional revenue for platform

REVENUE SPLIT (per skill invocation):
├─ 85% → creator (via round6, not Math.floor)
├─ 15% → clawhub-treasury
├─ x402 surcharge → treasury (1:1 cost recovery, separate from 85/15)
└─ Treasury credits = pure profit (optional sweep to USDC if TREASURY_SWEEP_WALLET set)

PRICING OPTIMIZER STRATEGIES:
├─ cheapest:  swap to lowest-cost alternative in capability group
├─ balanced:  only swap if over targetCredits budget
├─ fastest:   swap to lowest-latency alternative
├─ reliable:  no swaps — use LLM's original selection
└─ Dynamic alternatives from discovery merge with static map
```

---

## 33. Agent Economy Layer

```
PURPOSE:
  Transforms ClawNet from a consumption-only platform into a full agent economy
  where AI agents can pay each other, delegate spending, and auto-cashout.

CREDIT TRANSFERS (POST /v1/economy/transfer):
├─ Agent A pays Agent B directly (peer-to-peer credit movement)
├─ 1% platform fee (min 1 credit) → clawhub-treasury
├─ Min 10 credits, max 100,000 per transfer
├─ Self-transfer blocked (fromKey === toKey)
├─ Idempotency key support (prevent double-transfers on retries)
├─ Audit trail: logAudit() + transactions ledger (type: CREDIT_TRANSFER)
└─ Transfer history: GET /v1/economy/transfers?direction=sent|received|all

DELEGATED KEYS (POST /v1/economy/keys/delegate):
├─ Create child API keys with spending caps
├─ Auth middleware resolves parent → billing deducts from parent balance
├─ Spend limit tracked: incrementDelegatedSpend() after each deduction
├─ Permissions: invoke, query, transfer (transfer NOT default)
├─ Max 1 level deep (no sub-sub-keys), max 20 per parent
├─ Expiry support: expiresInHours parameter
├─ Revoke: DELETE /v1/economy/keys/delegated/:childKey
└─ List: GET /v1/economy/keys/delegated

RECEIPTS API (GET /v1/economy/receipts):
├─ Machine-readable proof of payment for agent accounting
├─ Merges credit_transfers + transactions into unified view
├─ Filter by type: ?type=CREDIT_TRANSFER|SKILL_SALE|PAYOUT_REQUEST
├─ Counterparty keys masked via maskApiKey()
└─ Includes tx_hash for on-chain payouts

AUTO-PAYOUT THRESHOLD (PUT /v1/economy/auto-payout):
├─ Set threshold: "when my earnings exceed N credits, auto-request USDC payout"
├─ Payout cron checks every 4h: if earned >= threshold → createPayoutRequest()
├─ Threshold minimum: 1000 credits
├─ Requires valid Solana wallet address
├─ Disable: DELETE /v1/economy/auto-payout
└─ Credits flow: earned via SKILL_SALE → threshold hit → PENDING payout → cron sends USDC

REPUTATION (GET /v1/economy/reputation):
├─ Score from reputation_events table (SUM of score_delta)
├─ Trust levels: new (0-9), emerging (10-49), established (50-199), trusted (200+)
├─ Public lookup: GET /v1/economy/reputation/:key (masked key in response)
└─ Events recorded by skill system on invocations, task completions

FLOW: Agent-to-Agent Payment
  Agent A                    ClawNet                    Agent B
    │                           │                           │
    ├─ POST /transfer ─────────>│                           │
    │   { toKey, amount, memo } │                           │
    │                           ├─ Validate (min/max/self)  │
    │                           ├─ Deduct A: amount + 1% fee│
    │                           ├─ Credit B: amount         │
    │                           ├─ Fee → treasury           │
    │                           ├─ Record in credit_transfers
    │                           ├─ Record in transactions   │
    │<── { transferId, fee } ───┤                           │
    │                           │                           │

FLOW: Delegated Key Billing
  Sub-Key Request      Auth Middleware        Billing Route
    │                       │                      │
    ├─ X-API-Key: cn-child->│                      │
    │                       ├─ getDelegationInfo()  │
    │                       ├─ Check expiry/limit   │
    │                       ├─ Resolve parent key   │
    │                       ├─ Set keyInfo.key=parent│
    │                       ├───────────────────────>│
    │                       │                       ├─ deductCredit(parent)
    │                       │                       ├─ trackDelegatedSpend(child)
    │                       │                       └─ Response
    │<──────────────────────┤                       │

DB TABLES:
├─ credit_transfers: id, from_key, to_key, amount, fee, memo, idempotency_key
├─ delegated_keys: child_key, parent_key, label, spend_limit, spent, expires_at, permissions_json
├─ auto_payout_config: agent_key, threshold_credits, usdc_wallet, enabled
└─ Triggers: trg_transfer_amount_positive (amount > 0)

SECURITY:
├─ Transfer rate limiting via existing rate-limit middleware
├─ Min/max transfer bounds (10-100,000 credits)
├─ Delegated keys cannot create sub-sub-keys (1 level max)
├─ transfer permission NOT default on delegated keys
├─ Env keys (test-key-123) blocked from transfer/delegate
└─ All operations logged to audit_log
```

---

## 34. Site Architecture & UX

```
PAGES (site/):
├─ index.html          — Homepage: hero, pricing carousel, API demo, voting, features
├─ dashboard.html      — Authenticated: stats, key management, top-up, subscription, USDC
├─ marketplace.html    — Skill browse/publish/manage, semantic search
├─ docs.html           — Full API reference with sidebar navigation
├─ endpoints.html      — Endpoint catalog with live status
├─ login.html          — Clerk sign-in (minimal nav)
├─ success.html        — Post-payment confirmation (minimal nav)
├─ contact-section.html— Contact form
├─ terms.html          — Terms of service
├─ privacy.html        — Privacy policy
├─ admin.html          — Admin dashboard (no public nav)
├─ admin-vps.html      — VPS admin (no public nav)
└─ rehaul_marketplace.html — Marketplace redesign (staging)

DESIGN SYSTEM:
├─ Dark theme default (--bg-primary: #0a0a0b)
├─ Light theme via [data-theme="light"] CSS variables
├─ Theme persists via localStorage key: clawnet_theme
├─ Toggle button: sun/moon SVG icons
├─ Font stack: Inter (sans) + JetBrains Mono (code)
├─ Accent: #10b981 (emerald green)
└─ All pages monolithic (inline CSS + JS, no shared files)

CONSISTENT NAV (all public pages):
├─ Logo: "Claw Network" text (no image)
├─ Links: Home, Docs, Marketplace, Endpoints, Dashboard
├─ Right: Theme toggle, API status dot, credits badge, auth buttons
├─ Auth states: Sign In + Get API Key (logged out) → Dashboard + Sign Out (logged in)
├─ Social: GitHub, Telegram, X Community in footer
└─ Mobile: nav-links hidden below 900px

STATUS INDICATOR:
├─ Fetches /health with explicit CORS headers
├─ Shows: Operational (green) / Degraded (yellow) / Offline (red)
├─ Polls every 60 seconds
└─ Live avg response time from /v1/stats → avgDurationMs

PRICING DISPLAY (index.html):
├─ Subscription hero: $29/mo = 40,000 credits (best value, shown first)
├─ Credit carousel: 6 tiers ($5–$1,000) with horizontal scroll-snap
├─ USDC option: +7% bonus, Phantom wallet integration
├─ Lowest advertised cost: $0.0001/query (0.1cr minimum cache hit)
├─ Subscription rate: $0.000725/credit (27% cheaper than card)
└─ Carousel: hide prev btn at start, next btn at end

API DEMO (index.html):
├─ Tabbed: cURL / JavaScript / Python
├─ Rotating examples: token analysis, portfolio, market data, data skill
├─ Response panel: scrollable with max-height
├─ Auto-rotate every 8 seconds with dot navigation
└─ Copy button for code snippets

VOTING SECTION (index.html):
├─ API integration suggestions with upvote
├─ "Suggest an API" opens modal form (name + description + use case)
├─ Suggestions stored via POST /v1/vote/suggest
├─ localStorage tracks user's votes (client-side dedup)
└─ Future: display community suggestions as voteable cards

INTERACTIVE ELEMENTS:
├─ Animated number counters (stats, response time)
├─ Hero code examples rotate every 6s with dots
├─ Pricing carousel with scroll-snap and dot indicators
├─ API demo rotates every 8s with transition
├─ Theme toggle with smooth CSS transitions
└─ Live status + credit balance polling
```

---

## 35. Skill Health Monitoring

```
PURPOSE:
  Automatically detect when data skill backing APIs go down.
  Prevents agents from wasting credits on broken data sources.

CRON: src/core/skill-health-cron.ts
├─ Schedule: every 15 minutes (node-cron)
├─ Scope: skills WHERE skill_type = 'data' AND proxy_url IS NOT NULL AND active = 1 AND public = 1
├─ Batch size: up to 100 skills per run
└─ Registered in src/index.ts alongside other crons

HEALTH CHECK FLOW:
  Cron fires every 15m
  │
  ├─ Query: SELECT data skills with proxy_url
  ├─ For each skill:
  │   ├─ HEAD request to proxy_url (10s timeout)
  │   ├─ Result: 2xx or 405 → UP, anything else or timeout → DOWN
  │   │
  │   ├─ If UP:
  │   │   ├─ Reset health_fail_count to 0
  │   │   ├─ Set health_status = 'HEALTHY'
  │   │   └─ Update health_checked_at = now()
  │   │
  │   └─ If DOWN:
  │       ├─ Increment health_fail_count
  │       ├─ If fail_count >= 3 → health_status = 'DEGRADED'
  │       ├─ Log warning when status transitions to DEGRADED
  │       └─ Update health_checked_at = now()
  │
  └─ Log summary: { checked, degraded, recovered }

RECOVERY:
├─ When a DEGRADED skill's proxy_url responds again → auto-reset to HEALTHY
├─ No manual intervention needed
└─ Skill remains visible in marketplace (health_status shown, not delisted)

DB COLUMNS (migration v61):
├─ health_status TEXT NOT NULL DEFAULT 'HEALTHY'
├─ health_fail_count INTEGER NOT NULL DEFAULT 0
└─ health_checked_at TEXT
```

---

## 36. Per-Skill Rate Limiting

```
PURPOSE:
  Creators can set max_calls_per_hour on their skills to prevent abuse
  or manage upstream API quotas.

SCHEMA (migration v60):
└─ ALTER TABLE skills ADD COLUMN max_calls_per_hour INTEGER

CREATOR SETS LIMIT:
├─ POST /v1/skills { ..., maxCallsPerHour: 100 }
└─ Stored in skills.max_calls_per_hour column

ENFORCEMENT (src/routes/skills.ts):
  Request arrives at skill invoke/query
  │
  ├─ Check: skill.max_calls_per_hour is set?
  │   └─ No → skip rate limiting
  │
  ├─ Yes: cacheIncr(`skill-rate:${skillId}`, 3600)
  │   ├─ Redis INCR with 1-hour TTL (auto-resets each hour)
  │   ├─ If count > max_calls_per_hour → 429 Too Many Requests
  │   │   └─ { error, code: 'SKILL_RATE_LIMITED', retryAfterSeconds }
  │   └─ If count <= limit → proceed with invocation
  │
  └─ Applied to BOTH:
      ├─ POST /v1/skills/:id/invoke (prompt_template + api_proxy)
      └─ GET  /v1/skills/:id/query  (data skills)

NOTE: This is per-skill global rate limit, separate from per-key rate limiting.
Creator protects their upstream API; platform protects against key abuse.
```

---

## 37. MCP & OpenAPI Manifests

```
PURPOSE:
  Every skill auto-generates machine-readable tool definitions.
  Agents can discover skills and invoke them without human documentation.

MCP MANIFEST (GET /v1/skills/:id/mcp):
├─ Returns Model Context Protocol tool definition
├─ Schema version: 2024-11-05
├─ Fields:
│   ├─ name: skill name (kebab-case)
│   ├─ description: skill description
│   ├─ input_schema: JSON Schema from params_json or default query param
│   ├─ invocation: { method, url, headers, priceCredits }
│   └─ metadata: { provider, category, tags, updateFrequency, healthStatus }
├─ Compatible with: Claude Code, Claude Desktop, Cursor, any MCP client
└─ No auth required to read manifest (public skill discovery)

OPENAPI SPEC (GET /v1/skills/:id/openapi):
├─ Returns OpenAPI 3.1.0 specification per skill
├─ Auto-generates paths based on skill_type:
│   ├─ data: GET /v1/skills/{id}/query with query parameters
│   ├─ prompt_template: POST /v1/skills/{id}/invoke with JSON body
│   └─ api_proxy: POST /v1/skills/{id}/invoke with JSON body
├─ Includes: security schemes (X-API-Key), pricing info, response schema
├─ Compatible with: OpenAI function calling, LangChain, Vercel AI SDK
└─ No auth required to read spec

MCP PACKAGE (packages/mcp/):
├─ @clawnet/mcp — standalone MCP server binary
├─ Lists all public skills as callable tools
├─ esbuild → dist/index.js (730KB)
├─ Bin: clawnet-mcp
├─ Status: built, ready to publish (npm publish --access public)
└─ Config: claude_code_config.json for Claude Code/Desktop/Cursor setup
```

---

## 38. Skill Discovery Extras

```
TAG FILTERING (GET /v1/skills?tag=defi):
├─ Query parameter: ?tag=<tag>
├─ SQL: tags_json LIKE '%"<tag>"%' (quoted to prevent partial matches)
├─ Combinable with: ?type=data&tag=defi (type + tag filter)
├─ Applied to both listPublicSkills() and countPublicSkills()
└─ Tags stored as JSON array in tags_json column

SIMILAR SKILLS (GET /v1/skills/:id/similar):
├─ Uses embedding vector of the source skill
├─ Queries searchDiscovery() with skill's own embedding as query
├─ Excludes the source skill from results
├─ Returns top N similar skills by cosine similarity
├─ Requires embedding model to be loaded (graceful fallback if not)
└─ Use case: agent-driven discovery — "skills like this one"

STAKING DISCOVERY BOOST (in discovery-engine.ts):
├─ Skills with active stakes get a discovery ranking bonus
├─ Formula: boost = sqrt(staked / 100) * 0.05
│   ├─ 100 staked credits → 5% score boost
│   ├─ 400 staked credits → 10% score boost
│   ├─ 1600 staked credits → 20% score boost
│   └─ Capped at 50% maximum boost
├─ Batch SQL: single query fetches all stake amounts for result skills
├─ Wrapped in try/catch — fails gracefully if stakes table issues
└─ Applied after merge/filter, before final sort

BATCH QUERY (POST /v1/skills/batch-query):
├─ Parallel multi-skill data queries in one HTTP call
├─ Max 10 skills per batch
├─ Body: [{ skillId: string, params?: Record<string, string> }]
├─ Each skill queried independently, results collected
├─ Credits deducted per skill (cache or live pricing)
├─ Response: { results: [{ skillId, data, cached, credits }], totalCredits }
└─ Data skills only (skill_type = 'data')
```

---

## 39. Webhook HMAC Signing

```
PURPOSE:
  Creators can verify that webhook payloads truly came from ClawNet.
  Prevents spoofing of task completion and skill invocation webhooks.

SECRET MANAGEMENT:
├─ PUT  /v1/economy/webhook-secret → generate or set HMAC secret
│   ├─ Auto-generate: omit body → crypto.randomBytes(32).toString('hex')
│   ├─ User-provided: { secret: "..." } (min 16 chars)
│   └─ Stored in api_keys.webhook_secret (migration v62)
├─ DELETE /v1/economy/webhook-secret → remove secret (disable signing)
└─ Audit logged: WEBHOOK_SECRET_SET / WEBHOOK_SECRET_REMOVED

SIGNING FLOW (src/routes/tasks.ts):
  Task completes → fireWebhook(url, payload, webhookSecret?)
  │
  ├─ If no secret → plain POST (backward compatible)
  │
  └─ If secret exists:
      ├─ Serialize payload to JSON string
      ├─ HMAC-SHA256: crypto.createHmac('sha256', secret).update(body).digest('hex')
      ├─ Add headers:
      │   ├─ X-ClawNet-Signature: sha256=<hex>
      │   └─ X-ClawNet-Timestamp: <unix epoch seconds>
      └─ Creator verifies: recompute HMAC, compare, check timestamp freshness

VERIFICATION (creator side):
  const expected = crypto.createHmac('sha256', secret)
    .update(rawBody).digest('hex');
  const valid = crypto.timingSafeEqual(
    Buffer.from(signature.replace('sha256=', '')),
    Buffer.from(expected)
  );
```

---

## 40. Credit Gifting

```
PURPOSE:
  One agent gifts credits to another — zero-fee peer recognition.
  Uses the transfer system under the hood with gift memo.

ENDPOINT: POST /v1/economy/gift

REQUEST:
├─ { toKey: "cn-xxxx", amount: 500, memo?: "thanks for the data" }
├─ Amount: min 1, max 50,000 credits
├─ Memo: optional, stored in transfer record
└─ Auth: X-API-Key header (sender)

FLOW:
  Sender calls POST /v1/economy/gift
  │
  ├─ Validate: env keys cannot gift, amount bounds, toKey exists
  ├─ transferCredits(fromKey, toKey, amount, { memo: "gift: <memo>" })
  │   ├─ Deducts from sender (no fee — gifts are free)
  │   ├─ Credits to recipient
  │   └─ Records in credit_transfers table
  ├─ Audit: logAudit(entityType: 'gift', action: 'CREDIT_GIFT')
  └─ Response: { ok: true, giftId, amount, toKey: masked }

LIMITS:
├─ Max 50,000 credits per gift (prevent accidental large transfers)
├─ No fee (unlike regular transfers which charge 1%)
├─ Rate limited by standard per-key rate limiter
└─ Env keys (test-key-123, clawhub-treasury) blocked from gifting
```

---

## 41. x402 Verification & Reputation

```
RECEIPT VERIFICATION (GET /x402/verify/:requestId):
├─ Lookup x402_receipts by request_id
├─ Returns: skillId, skillName, priceUsdc, network, payerAddress,
│           durationMs, success, error, createdAt
├─ Use case: agent proves it paid for a skill call
├─ No auth required (receipts are publicly verifiable)
└─ 404 if request_id not found

DB TABLE: x402_receipts (migration v36)
├─ request_id TEXT PRIMARY KEY
├─ skill_id, skill_name, price_usdc, network
├─ payer_address, created_at, duration_ms
├─ success INTEGER, error TEXT
└─ Inserted after every x402 skill invocation

REPUTATION VIA x402 (GET /x402/reputation/:agentKey):
├─ Public endpoint — no auth required
├─ Queries reputation_events for the agent's API key
├─ Returns:
│   ├─ score: SUM of score_delta from reputation_events
│   ├─ trustLevel: trusted (200+) / established (50-199) / emerging (10-49) / new (0-9)
│   ├─ totalEvents: count of all events
│   └─ recentEvents: count in last 30 days
├─ API key masked in response (maskApiKey)
└─ Mirrors GET /v1/economy/reputation/:key (same data, x402 namespace)

FACILITATOR FALLBACK:
├─ Primary: X402_FACILITATOR_URL env var (default: https://x402.org/facilitator)
├─ Fallback URLs: hardcoded backup facilitators
├─ Array deduplication: filter unique URLs
├─ Used by createFacilitator() in x402-skills.ts
└─ Runtime: if primary fails, middleware handles retry
```

---

## 42. Stripe Subscription Lifecycle

```
Stripe fires invoice.payment_succeeded
│
├─ POST /v1/webhooks/stripe-subscriptions
│   ├─ Verify signature: stripe.webhooks.constructEvent()
│   ├─ Idempotency: INSERT OR IGNORE into stripe_processed_events (event_id PK)
│   │   └─ If already processed → return { received: true } (no double-credit)
│   └─ Extract: email, subscriptionId, periodEnd from invoice
│
├─ Look up API key by email
│   └─ No key found → warn + skip (credits not applied)
│
├─ Atomic transaction (claim + topUp + upsert):
│   ├─ INSERT OR IGNORE event_id (concurrent-safe)
│   ├─ Rollover cap: MAX_ROLLOVER = SUBSCRIPTION_CREDITS_PER_MONTH × 3
│   │   ├─ creditsToAdd = min(monthlyAllotment, MAX_ROLLOVER − currentBalance)
│   │   ├─ If currentBalance ≥ MAX_ROLLOVER → grant 0 (cap hit)
│   │   └─ Prevents unbounded credit accumulation
│   ├─ topUpCredits(key, creditsToAdd) — adds to balance
│   └─ upsertSubscription(subscriptionId, key, email, creditsPerMonth, periodEnd, 'active')
│
└─ Cancellation: customer.subscription.deleted
    ├─ Same webhook route, different event type
    ├─ upsertSubscription(…, status: 'cancelled')
    ├─ Credits already granted are KEPT (no clawback)
    └─ No further monthly renewals after cancellation

Default: SUBSCRIPTION_CREDITS_PER_MONTH = 50,000 ($29/mo plan)
Rollover cap: 150,000 credits (3 months accumulated max)
```

---

## 43. Stripe Refund Flow

```
Stripe fires charge.refunded
│
├─ POST /v1/webhooks/stripe (same checkout webhook route)
│   ├─ Verify Stripe signature
│   └─ Event type: charge.refunded
│
├─ Look up API key by billing email
│   └─ No key → warn + skip
│
├─ Idempotency: cumulative refund tracking
│   ├─ getStripeChargeRefundedCents(chargeId) → previousCents
│   ├─ delta = charge.amount_refunded − previousCents
│   └─ If delta ≤ 0 → already processed, skip
│
├─ Proportional credit deduction (inside transaction):
│   ├─ totalGranted = credits + credits_used
│   ├─ creditsPerDollar = totalGranted / amount_paid
│   ├─ creditsToDeduct = round(refundedUSD × creditsPerDollar)
│   │   └─ Accounts for bonus tiers (user who bought $100 → 125K credits
│   │      gets proportional deduction, not flat 1000/dollar)
│   ├─ deductAmount = min(creditsToDeduct, currentBalance)
│   │   └─ Can't go negative — deducts only what's available
│   ├─ UPDATE api_keys SET credits = credits − deductAmount, amount_paid = MAX(0, amount_paid − refundUSD)
│   └─ upsertStripeChargeRefundedCents(chargeId, totalRefunded)
│
└─ Fallback: if amount_paid = 0, use base rate (1000 cr/$1)

Anti-exploit: proportional deduction means a $100 buyer who got +12% bonus
gets more credits deducted per dollar refunded (fair to platform).
Partial refunds supported: delta-based tracking processes each chunk independently.
```

---

## 44. Dashboard Authentication & Claim

```
User visits /dashboard.html
│
├─ Clerk JS loads → checks session
│   ├─ Not signed in → redirect to /login.html
│   └─ Signed in → get Clerk JWT token
│
├─ GET /v1/dashboard/me (Bearer token)
│   ├─ requireClerkAuth middleware:
│   │   ├─ Verify JWT signature with Clerk public key
│   │   ├─ Extract clerkUserId + email
│   │   └─ Set on Hono context: c.set('clerkUserId'), c.set('clerkEmail')
│   │
│   ├─ Key lookup (two strategies):
│   │   ├─ Primary: getApiKeyByClerkId(clerkUserId) — linked account
│   │   └─ Fallback: getApiKeyByEmail(email) — auto-links on first match
│   │       └─ linkKeyToClerkUser(key, clerkUserId) — permanent binding
│   │
│   └─ Return: { hasKey, maskedKey, credits, creditsUsed, email, stats }
│       └─ hasKey=false → show "No credits yet" state
│
├─ Credit claim flow (purchased with different email):
│   ├─ POST /v1/dashboard/send-claim-email { purchaseEmail }
│   │   ├─ Rate limit: wasEmailSentRecently(email) → 429
│   │   ├─ Generate claim token (crypto.randomUUID)
│   │   ├─ storeClaimToken(token, purchaseEmail, clerkUserId, 1hr expiry)
│   │   ├─ Send Resend email with magic link
│   │   └─ logEmailSend(email) for rate tracking
│   │
│   ├─ User clicks email link → GET /v1/dashboard/verify-claim/:token
│   │   ├─ getClaimToken(token) → validate not expired or used
│   │   ├─ markClaimTokenUsed(token)
│   │   ├─ Transfer credits: find key by purchaseEmail → link to clerkUserId
│   │   └─ Redirect to /dashboard.html?claim=success|expired|invalid|used
│   │
│   └─ Auto-claim: POST /v1/dashboard/claim-session { sessionId }
│       └─ For Stripe checkout redirect → auto-link purchase to Clerk user
│
└─ POST /v1/dashboard/reveal-key → returns full API key (once per session)
    ├─ Only returns the unmasked key, never stored in frontend
    └─ Frontend tracks reveal state in localStorage
```

---

## 45. Creator Revenue Dashboard

```
Dashboard loads → checkCreator() called after loadDashboard()
│
├─ GET /v1/dashboard/creator-stats (Clerk JWT auth)
│   ├─ requireClerkAuth middleware
│   ├─ Look up API key by clerkUserId → fallback by email
│   ├─ No key → return { isCreator: false }
│   │
│   ├─ getCreatorStats(key) → { totalEarned, totalSales, skillBreakdown[] }
│   ├─ getSkillsByAuthor(key) → all skills by this author
│   ├─ getPayoutRequests(key) → withdrawal history
│   │
│   └─ Return:
│       ├─ isCreator: true if skills.length > 0
│       ├─ totalEarned: sum of all credit earnings
│       ├─ totalSales: count of sales
│       ├─ publishedSkills: count
│       ├─ skills[]: { id, name, creditCost, uses, public, earned, sales }
│       └─ withdrawals[]: { id, amountCredits, usdcEquivalent, status, createdAt }
│
├─ Frontend rendering (JS injection, no DOM if not creator):
│   ├─ Creator stats grid: credits earned, revenue ($), sales, published, pending payout
│   ├─ Skill rows: name, ID, cost, uses, earned credits, $ earned
│   └─ Payout history: amount, USDC equivalent, time ago, status badge (PAID/PENDING)
│
├─ Related marketplace endpoints (API key auth, not Clerk):
│   ├─ GET  /v1/marketplace/creator/stats       → same data, API-key authed
│   ├─ POST /v1/marketplace/creator/withdraw     → request USDC payout (min 1000 credits)
│   └─ GET  /v1/marketplace/creator/withdrawals  → payout history
│
└─ Payout rate: PAYOUT_USDC_PER_CREDIT = $0.00075
    └─ 10,000 credits earned → $7.50 USDC withdrawal
```

---

## 46. Clerk Webhooks & GDPR Erasure

```
Clerk fires webhook → POST /v1/webhooks/clerk
│
├─ Verify Svix signature (webhook verification)
│   └─ Invalid signature → 400
│
├─ Event: user.created
│   ├─ Check if API key already exists for this Clerk user
│   │   └─ Already has key → skip (idempotent)
│   ├─ createFreeTrialKey(clerkUserId, email, FREE_TRIAL_CREDITS)
│   │   └─ Default: 100 free credits
│   └─ Log: { clerkUserId, email, credits, maskedKey }
│
├─ Event: user.deleted (GDPR right to erasure)
│   ├─ Atomic transaction:
│   │   ├─ Deactivate API key: SET active = 0
│   │   ├─ Anonymize email: SET email = '[deleted]'
│   │   │   └─ Removes PII while preserving credit balance record
│   │   └─ Unpublish all skills: SET public = 0, active = 0
│   │       └─ Skills removed from registry/discovery
│   │
│   ├─ Financial records KEPT (legal/tax compliance):
│   │   ├─ transactions: 730-day retention
│   │   ├─ orchestrations: 180-day retention
│   │   └─ audit_log: 90-day retention
│   │
│   └─ logAudit({ entityType: 'clerk_user', action: 'USER_DELETED' })
│
└─ All other event types → { received: true } (acknowledged, not processed)
```

---

## 47. Contact Form

```
User submits contact form on website
│
├─ POST /v1/contact { name, email, subject, message, website? }
│   ├─ Zod validation:
│   │   ├─ name: 1-100 chars, trimmed
│   │   ├─ email: valid email, max 254 chars, lowercased
│   │   ├─ subject: enum [general, billing, technical, partnership, other]
│   │   ├─ message: 10-2000 chars, trimmed
│   │   └─ website: optional (honeypot field for spam bots)
│   │
│   ├─ Honeypot check: if website field has value → 200 OK (silently discard)
│   │
│   ├─ Rate limit: 3 submissions per IP per 10 minutes
│   │   ├─ In-memory Map (bounded at 50K entries)
│   │   ├─ Cleanup interval: hourly
│   │   └─ Exceeded → 429 "Rate limit exceeded"
│   │
│   ├─ Send email via Resend API:
│   │   ├─ To: hello@claw-net.org (or CONTACT_EMAIL env var)
│   │   ├─ Subject: [ClawNet Contact] {Subject Label} from {Name}
│   │   ├─ HTML body: styled email with all fields, sender email in reply-to
│   │   └─ All user input escaped with escapeHtml()
│   │
│   └─ Return: { ok: true, message: "Message sent successfully" }
│
└─ No auth required — public endpoint
```

---

---

## 48. Dev Revenue Flow — Where the Money Goes

This is the plain-English guide to how ClawNet makes money, where it comes from, and how much you keep. No jargon — just dollars and percentages.

### How Users Pay You

There are **3 ways** money enters the system:

```
┌──────────────────────────────────────────────────────────┐
│                    MONEY IN                               │
├──────────────┬──────────────────┬────────────────────────┤
│ 1. Stripe    │ 2. Solana USDC   │ 3. x402 (per-call)    │
│ Credit card  │ Crypto wallet    │ Pay-as-you-go crypto   │
│ $5 – $1,000  │ Any amount       │ $0.001 per credit      │
│ one-time     │ one-time         │ auto-deducted          │
└──────────────┴──────────────────┴────────────────────────┘
```

**What they're buying:** Credits. 1 credit ≈ $0.001. Credits are spent on API calls.

### Stripe Credit Card Tiers

| Package | Price | Credits  | Bonus  | You keep* |
|---------|-------|----------|--------|-----------|
| Starter | $5    | 5,000    | 0%     | ~$4.56    |
| Basic   | $20   | 22,000   | +10%   | ~$19.12   |
| Plus    | $50   | 60,000   | +20%   | ~$48.06   |
| Pro     | $100  | 125,000  | +25%   | ~$96.80   |
| Growth  | $500  | 750,000  | +50%   | ~$485.50  |
| Scale   | $1000 | 2,000,000| +100%  | ~$971.00  |

*After Stripe's ~2.9% + $0.30 processing fee. All credits land in your database immediately.

### Solana USDC Tiers

Same dollar amounts, **+7% more credits** than Stripe at every level. No credit card processing fee — you keep 100% of the USDC.

| Package | Price   | Credits   | vs Stripe |
|---------|---------|-----------|-----------|
| Starter | $5 USDC | 5,350     | +350 more |
| Scale   | $1000   | 2,140,000 | +140K more |

### Subscriptions (Monthly)

- Default: 50,000 credits/month (configurable via `SUBSCRIPTION_CREDITS_PER_MONTH`)
- Rollover capped at 3× monthly allotment (prevents hoarding)
- Cancelled = no more credits, existing balance stays until spent

### Where Your Revenue Comes From

You make money **5 different ways** from every credit users spend:

```
┌─────────────────────────────────────────────────────────────────┐
│                   💰 YOUR 5 REVENUE STREAMS                     │
├───┬─────────────────────────┬──────────┬───────────────────────┤
│ # │ Source                  │ Margin   │ How it works           │
├───┼─────────────────────────┼──────────┼───────────────────────┤
│ 1 │ API Markup              │ 33–50%   │ User pays 1500× the   │
│   │                         │          │ actual API cost in     │
│   │                         │          │ credits. You pocket    │
│   │                         │          │ the difference.        │
├───┼─────────────────────────┼──────────┼───────────────────────┤
│ 2 │ Orchestration Fee       │ ~80%     │ 2 credits ($0.002)    │
│   │                         │          │ per LLM-routed query.  │
│   │                         │          │ LLM call costs ~$0.0004│
├───┼─────────────────────────┼──────────┼───────────────────────┤
│ 3 │ Marketplace Fee (15%)   │ 100%     │ Creators sell skills.  │
│   │                         │          │ You take 15% of every  │
│   │                         │          │ sale. Creator gets 85%.│
├───┼─────────────────────────┼──────────┼───────────────────────┤
│ 4 │ Cache Hit Spread        │ 100%     │ First call pays full   │
│   │                         │          │ price (live API call). │
│   │                         │          │ Repeat calls = 10% of  │
│   │                         │          │ live (min 0.1cr) from  │
│   │                         │          │ cache. Pure profit.    │
├───┼─────────────────────────┼──────────┼───────────────────────┤
│ 5 │ Swarm Decomposition Fee │ ~100%    │ 20 credits upfront     │
│   │                         │          │ for multi-agent queries.│
│   │                         │          │ Covers LLM planning.   │
└───┴─────────────────────────┴──────────┴───────────────────────┘
```

### Show Me the Math — Example Month

Say 100 users each buy the $100 Stripe package:

```
MONEY IN:
  100 users × $100                          = $10,000 gross
  Stripe fees (2.9% + $0.30 each)           = -$319
  Net received                              = $9,681

CREDITS ISSUED:
  100 users × 125,000 credits               = 12,500,000 credits

CREDITS SPENT (hypothetical usage):
  8,000,000 credits used across all calls

YOUR COSTS (what you pay for upstream APIs):
  Credits go to live API calls.
  COST_MARKUP_FACTOR = 1500 means:
    If an API costs $0.001/call → user pays 1.5 credits ($0.0015)
    Your cost per credit spent ≈ $0.00067
  8,000,000 credits × $0.00067             = ~$5,360 in API costs

YOUR PROFIT:
  $9,681 (net Stripe) - $5,360 (API costs)  = ~$4,321 gross profit
  + marketplace 15% fees
  + cache hits (zero cost, users still pay cacheCreditCost)
  + orchestration fees (2cr × number of queries)

  Realistic margin: 40–60% after all costs
```

### Money Going Out — Creator Payouts

When creators build skills and sell them on your marketplace:

```
┌────────────────────────────────────────────────────┐
│                   MONEY OUT                         │
├─────────────────────────┬──────────────────────────┤
│ Creator earns credits   │ 85% of each skill sale   │
│ Creator requests payout │ POST /v1/marketplace/     │
│                         │   creator/withdraw        │
│ Minimum payout          │ 1,000 credits ($0.75)    │
│ Payout rate             │ $0.00075 per credit       │
│ Payout method           │ Solana USDC (auto, 4h)   │
│ x402 EVM auto-split     │ 85% USDC to Base wallet  │
│                         │ (instant, per-call)       │
└─────────────────────────┴──────────────────────────┘
```

**Anti-arbitrage:** Users buy credits at $0.001 each. Creators cash out at $0.00075 each. That 25% spread means nobody can buy credits and immediately withdraw for profit.

### The 2-Wallet Architecture

```
Wallet 1: RECEIVING (H6xbRy...)
  └─ Public address only — users send USDC here to buy credits
  └─ No private key on server — lowest risk
  └─ Manually sweep to Hot Wallet when needed

Wallet 2: HOT WALLET (AqYkp3...)
  └─ SOLANA_PRIVATE_KEY + PLATFORM_PAYOUT_PRIVATE_KEY (same key)
  └─ Pays x402 API providers + sends USDC to creators
  └─ Funded by: you (manual top-up from Receiving / bank)

Wallet 3 (EVM, separate chain): EVM_PRIVATE_KEY
  └─ x402 auto-split — sends 85% to creator's Base wallet
  └─ Funded by: incoming x402 payments (self-sustaining)
```

### Where Every Credit Ends Up (The Full Picture)

```
User buys 125,000 credits for $100 (Pro tier)
│
├─ User makes an orchestrated query (e.g., "analyze AAPL")
│   ├─ 2 credits → Platform (orchestration fee)
│   ├─ 5 credits → API call (e.g., financial data endpoint)
│   │   ├─ ~3.3 credits worth → Your API cost ($0.0033)
│   │   └─ ~1.7 credits worth → Your margin ($0.0017)
│   └─ Total: 7 credits spent, you keep ~3.7 credits worth
│
├─ User invokes a marketplace skill (e.g., "token-analyzer", costs 10cr)
│   ├─ 8.5 credits → Creator (85%)
│   ├─ 1.5 credits → Treasury (15% platform fee)
│   └─ Creator cashes out 8.5 cr = $0.006375 USDC
│
├─ User hits a cached result
│   ├─ cacheCreditCost charged (10% of live, min 0.1cr)
│   ├─ 0 API cost (served from Redis)
│   └─ cacheCreditCost = pure profit
│
└─ Credits remaining sit in user's balance (no expiry)
```

### Quick Reference — All the Numbers

| Thing | Value | Where it's set |
|-------|-------|----------------|
| Credit buy price (Stripe) | $0.001/credit | Hardcoded in price tiers |
| Credit buy price (Solana) | ~$0.00093/credit | +7% bonus built in |
| Credit buy price (x402) | $0.001/credit | `X402_USDC_PER_CREDIT` env |
| Creator payout rate | $0.00075/credit | `PAYOUT_USDC_PER_CREDIT` env |
| API cost markup | 1500× raw cost | `COST_MARKUP_FACTOR` env |
| Orchestration fee | 2 credits/query | `ORCHESTRATION_FEE` env |
| Marketplace cut | 15% to platform | Hardcoded (85/15 split) |
| Swarm fee | 20 credits upfront | `SWARM_BASE_FEE` env |
| Cache hit price | cacheCreditCost (10% of live, min 0.1cr) | cacheCreditCost() in credits.ts |
| Min creator payout | 1,000 credits | Hardcoded in withdraw route |
| Subscription default | 50,000 cr/month | `SUBSCRIPTION_CREDITS_PER_MONTH` |
| Rollover cap | 3× monthly | Hardcoded in stripe.ts |

### TL;DR

1. **Users pay you** via Stripe, Solana, or x402 — you get credits in your DB
2. **You profit** from the markup between what users pay per credit ($0.001) and what upstream APIs actually cost (~$0.00067)
3. **Creators profit** by selling skills — they get 85%, you get 15%
4. **Cache hits** are free money — users pay cacheCreditCost (10% of live, min 0.1cr), you pay $0 in API costs
5. **Anti-arbitrage** — buy at $0.001, sell at $0.00075 — no exploit possible
6. **Realistic margin** — 40-60% of gross revenue after API costs and Stripe fees

---

## 43. Trust Signals & Cryptographic Receipts

```
PURPOSE:
  Agents can evaluate skill quality BEFORE purchase and verify execution AFTER.
  Trust data is denormalized onto skills table for zero-cost listing queries.

TRUST SIGNAL DENORMALIZATION:
├─ avg_rating REAL — average of skill_ratings, refreshed on every rateSkill()
├─ rating_count INTEGER — total ratings
├─ success_rate REAL — percentage (0-100) from skill_metrics
├─ avg_latency_ms REAL — average from skill_metrics
├─ updateSkillTrustSignals(skillId) — called after recordSkillMetric() and rateSkill()
└─ Backfilled on migration v64 from existing metrics/ratings

PROVIDER TRUST OBJECT (in every invoke/query response):
├─ verified: boolean (security_status === 'VERIFIED')
├─ successRate: number (denormalized)
├─ avgRating: number (denormalized)
├─ reputationScore: number (from reputation_events SUM)
├─ sla: object | undefined (parsed sla_json)
└─ hasOutputContract: boolean

CRYPTOGRAPHIC RECEIPTS:
├─ computeRequestHash({ skillId, variables, timestamp }) → sha256:hex
├─ computeResultHash({ answer/data, costCredits }) → sha256:hex
├─ Deterministic: sorted-key JSON canonicalization
├─ Stored on transactions: request_hash, result_hash
├─ GET /v1/economy/receipts/:id → returns hashes + verifiable boolean
└─ Only sender/receiver can view receipt

COMPARE/QUOTE FLOW (POST /v1/marketplace/compare):
├─ Public endpoint, no auth required
├─ Body: { query, maxResults (1-20), filters: { minSuccessRate?, verifiedOnly?, maxCredits?, type? } }
├─ Composite scoring: 40% success rate + 30% rating + 20% usage + 10% verified
├─ Returns: ranked alternatives + bestValue + fastest + cheapest
└─ Agents use this to make procurement decisions
```

---

## 44. Composite Skills (Subcontracting)

```
PURPOSE:
  Skills can chain other skills, enabling emergent higher-order capabilities.
  A "market analyst" composite can call price-tracker + sentiment-analyzer.

DESIGN:
├─ skill_type: 'composite' — declared dependencies, not runtime dynamic
├─ dependencies_json: [{ skillId, paramMapping, outputKey }]
├─ Max 5 dependencies per composite
├─ Flat only: no composite-of-composite (prevents unbounded chains)
├─ Sequential execution (budget tracking per step)
└─ Pre-flight budget check: total cost = sum(dep costs) + assembly fee

CREATION VALIDATION (validateCompositeDependencies):
├─ Max 5 dependencies
├─ No self-reference
├─ No duplicate dependencies
├─ Each dep must be public, active, non-composite
└─ Error thrown at creation time, not runtime

EXECUTION (executeCompositeSkill):
├─ Pre-calculate total cost → reject if insufficient credits
├─ For each dependency:
│   ├─ Resolve param mapping: {{variable}} → caller inputs or previous outputs
│   ├─ Data skills: GET proxy_url with params
│   ├─ API proxy: POST/GET proxy_url with params
│   ├─ Bill per hop: 85/15 split to dependency author
│   ├─ Record transaction with receipt hashes + parentRequestId
│   └─ Store result in results[outputKey]
├─ Charge assembly fee: 85/15 split to composite author
└─ Return: { results, costBreakdown, totalCreditsCharged }

ANTI-LOOP PROTECTIONS:
├─ Creation time: deps must be non-composite
├─ No self-reference
├─ Max depth 1
└─ Pre-flight budget check prevents runaway spend

DEPENDENCY GRAPH (GET /v1/economy/dependency-graph):
├─ Returns all composite skills and their dependencies as nodes + edges
├─ Node: { id, name, type: 'composite'|'dependency', creditCost }
├─ Edge: { from, to, outputKey }
└─ Useful for visualization and impact analysis
```

---

## 45. SLA Contracts

```
PURPOSE:
  The single feature that makes the economy trustworthy — creators commit to
  performance guarantees, agents can trust these commitments when selecting skills.

SLA SCHEMA (sla_json on skills):
├─ guaranteed_uptime: 0-100 (percentage)
├─ max_latency_ms: maximum acceptable latency
├─ min_success_rate: 0-100 (percentage)
└─ penalty_pct: 0-100 (% of credit_cost refunded on violation)

ENFORCEMENT (skill-health-cron.ts, every 15 minutes):
├─ checkSLACompliance(skillId) — checks metrics vs SLA thresholds
│   ├─ LATENCY: avg of last 100 invocations vs max_latency_ms
│   ├─ SUCCESS_RATE: avg of last 100 invocations vs min_success_rate
│   └─ UPTIME: health_status === 'DEGRADED' → violation
├─ recordSLAViolation() → sla_violations table
├─ fireWebhookEvent(author_key, 'SLA_VIOLATED', ...) → notify author
└─ Penalty credits calculated: credit_cost × penalty_pct/100

SLA VIOLATIONS TABLE:
├─ id, skill_id, violation_type, measured_value, sla_threshold
├─ penalty_credits, resolved (boolean), created_at
└─ GET /v1/economy/sla-violations/:skillId — query violations

MARKETPLACE INTEGRATION:
├─ Listings include sla object when present
├─ Compare endpoint shows hasSLA boolean
└─ Agents can filter/prefer skills with SLA guarantees
```

---

## 46. Skill Output Contracts

```
PURPOSE:
  Agents trust output shape — machine-verifiable guarantee that a skill returns
  the promised data structure. Violations are detected and reported.

OUTPUT CONTRACT (output_contract_json on skills):
├─ JSON Schema-like: { type, required, properties: { field: { type } } }
├─ Set at skill creation time via outputContract field
└─ Shown in marketplace detail + compare results

VALIDATION (validateOutputContract):
├─ Type check: object/array/string/number
├─ Required fields: checks presence in output object
├─ Property types: validates field types match contract
└─ Returns { valid, errors[] }

ENFORCEMENT:
├─ Data skill query responses: validated after fetch
├─ _outputContract field added to response: { valid, errors }
├─ On violation: fireWebhookEvent(author, 'OUTPUT_CONTRACT_VIOLATION', ...)
└─ Future: auto-refund on repeated violations
```

---

## 47. Agent Budget Accounts

```
PURPOSE:
  Autonomous agents need spending controls beyond simple delegated keys.
  Budget accounts add daily/weekly caps and auto-topup.

BUDGET ACCOUNT (extends delegated_keys table):
├─ account_type: 'budget' (vs 'delegated' for regular sub-keys)
├─ daily_limit REAL — max credits/day (null = unlimited)
├─ weekly_limit REAL — max credits/week (null = unlimited)
├─ daily_spent / weekly_spent — current period counters
├─ last_daily_reset / last_weekly_reset — date strings for reset logic
├─ auto_topup BOOLEAN — if true, parent refills when depleted
└─ auto_topup_amount REAL — credits to add per refill

COUNTER RESETS:
├─ resetBudgetCountersIfNeeded(childKey) — called in auth middleware
├─ Daily: resets when last_daily_reset !== today's date
└─ Weekly: resets when last_weekly_reset is > 7 days ago

BUDGET CHECKS:
├─ checkBudgetLimits(childKey, amount) → { allowed, reason }
├─ Checks: overall spend limit, daily limit, weekly limit
└─ incrementBudgetSpend() — tracks daily + weekly after deduction

ENDPOINTS:
├─ POST /v1/economy/keys/budget-account — create budget account
├─ GET /v1/economy/keys/budget-account/:childKey — get status
└─ DELETE /v1/economy/keys/delegated/:childKey — revoke (same as regular)

BILLING INTEGRATION:
├─ trackDelegatedSpend() now calls incrementBudgetSpend() alongside incrementDelegatedSpend()
└─ All 13 billing sites automatically track budget spend (no changes needed)
```

---

## 48. Event Webhooks

```
PURPOSE:
  Agents register webhook URLs to receive real-time notifications about
  economy events — enabling autonomous decision-making without polling.

EVENT TYPES:
├─ SKILL_INVOKED — skill was called (author notification)
├─ CREDIT_LOW — balance approaching zero
├─ BUDGET_DEPLETED — budget account daily/weekly limit reached
├─ SLA_VIOLATED — SLA contract breached
├─ PAYOUT_SENT — USDC payout completed
├─ TRANSFER_RECEIVED — incoming credit transfer
└─ OUTPUT_CONTRACT_VIOLATION — skill output didn't match contract

WEBHOOK REGISTRATION (agent_webhooks table):
├─ id, agent_key, url, events_json (["*"] = all), secret, active
├─ failure_count — tracks consecutive failures
├─ Max 10 webhooks per agent
└─ Auto-disabled after 10 consecutive failures

DELIVERY:
├─ fireWebhookEvent(agentKey, eventType, payload) — non-blocking
├─ HMAC signature: X-ClawNet-Signature header (t=timestamp,v1=hmac)
├─ Max 3 retries with exponential backoff (1s, 2s, 4s)
├─ 10s timeout per attempt
└─ 4xx = don't retry (client error), 5xx = retry

ENDPOINTS:
├─ POST /v1/economy/webhooks — register webhook
├─ GET /v1/economy/webhooks — list webhooks
└─ DELETE /v1/economy/webhooks/:id — delete webhook

SECURITY:
├─ Secret-based HMAC (sha256) if secret provided
├─ Timestamp in signature prevents replay attacks
├─ Only fires for the webhook owner's events
└─ URL validation on registration
```

---

## 49. Composite Skill Pipelines (v2)

Advanced composite execution engine with 6 capabilities beyond basic sequential chaining.

```
OUTPUT PIPING:
├─ {{steps.outputKey.field}} in paramMapping
├─ Step N output → Step N+1 input
├─ Deep field access: {{steps.priceData.data.price}}
└─ Backward compatible with {{variable}} syntax

PARALLEL GROUPS:
├─ group field on dependency steps (integer)
├─ Same group number = run concurrently via Promise.allSettled
├─ Groups execute in numeric order (0, 1, 2...)
└─ Ungrouped steps run sequentially between groups

CONDITIONAL STEPS:
├─ condition: { field, op, value }
├─ 9 operators: exists, not_exists, eq, neq, gt, lt, gte, lte, contains
├─ field references: {{variable}} or {{steps.outputKey.field}}
├─ Skipped steps recorded in costBreakdown with skipped: true
└─ No billing for skipped steps

RETRY + FALLBACK:
├─ retries field (1-3, default 1)
├─ Exponential backoff between retries (500ms, 1s, 2s)
├─ fallbackSkillId — alternate skill if primary exhausts retries
├─ Fallback billed at fallback skill's rate
└─ costBreakdown shows fallbackUsed: true

COMPOSITE CACHING:
├─ compositeConfig.cacheTtl (seconds)
├─ Cache key = sha256(skillId + sorted variables)
├─ Stored in Redis via cacheSet/cacheGet
├─ Cached responses marked cached: true
└─ Saves all sub-skill invocation costs on cache hit

COST ESTIMATION:
├─ GET /v1/economy/estimate/:skillId
├─ Returns: totalCredits, assemblyFee, dependencies[], maxCredits
├─ Conditional deps flagged (may not execute)
├─ compositeConfig.maxTotalCredits for budget cap
└─ Pre-flight check before any billing
```

---

## 50. Trust Decay

Age-weighted rating system — older ratings contribute less to averages.

```
DECAY FORMULA:
├─ weight = max(0.1, 1.0 - (days_since_rating / 30 * 0.1))
├─ 30-day-old rating: weight 0.9
├─ 180-day-old rating: weight 0.4
├─ 300-day-old rating: weight 0.1 (floor)
└─ Ratings never fully expire — just fade

EXECUTION:
├─ Runs every 15 minutes via skill-health-cron
├─ UPDATE skill_ratings SET decay_weight = ...
├─ Refreshes denormalized avg_rating on skills table
├─ decay_weight column added in migration v66
└─ getDecayAdjustedRating() for per-skill query

IMPACT:
├─ A skill with 4.8★ from 6 months ago and no recent reviews
│  now shows lower effective rating than a 4.5★ with recent activity
└─ Forces skill authors to maintain quality over time
```

---

## 51. Penalty Escalation

Automated 4-tier penalty system for repeated SLA violations.

```
TIERS:
├─ Tier 0: CLEAN — no penalties (0-2 violations in 7 days)
├─ Tier 1: WARNING — 3+ violations in 7 days (flagged, no action)
├─ Tier 2: REDUCED_VISIBILITY — 6+ violations (excluded from featured/compare)
└─ Tier 3: DELISTED — 10+ violations (auto-set public=0)

ENFORCEMENT:
├─ Checked after every SLA compliance cycle (every 15 minutes)
├─ escalatePenalty(skillId) counts violations in last 7 days
├─ Tier changes trigger webhook to skill author
├─ Tier 3 auto-delists: UPDATE skills SET public = 0
└─ Tiers can decrease when violations age out of 7-day window

ENDPOINTS:
├─ GET /v1/economy/penalty/:skillId — current tier + description
├─ Marketplace detail includes penaltyTier field
└─ Compare endpoint filters out tier 2+ skills

RECOVERY:
├─ Fix underlying SLA issues → violations stop
├─ After 7 days with <3 violations → tier drops back to 0
└─ Tier 3 requires manual re-listing (admin or author)
```

---

## 52. Scheduled Skill Execution

Cron-based scheduled execution of any skill type.

```
FLOW:
├─ POST /v1/economy/scheduled-skills — create schedule
│  ├─ skillId, cronExpression, variables, maxCreditsPerRun
│  └─ Max 20 schedules per API key
├─ Scheduler cron checks every 1 minute for due skills
├─ Executes skill (data/api_proxy/composite)
├─ Records: lastStatus, lastError, totalRuns, totalCreditsSpent
├─ Calculates next_run_at from cron expression
└─ Budget guard: skips if credits < maxCreditsPerRun

ENDPOINTS:
├─ POST /v1/economy/scheduled-skills — create
├─ GET /v1/economy/scheduled-skills — list active
└─ DELETE /v1/economy/scheduled-skills/:id — deactivate

SKILL TYPES:
├─ data: GET proxy_url with variables as query params
├─ api_proxy: POST/GET proxy_url with variables as body/params
├─ composite: full executeCompositeSkill() with billing
└─ prompt_template: not supported (requires LLM pipeline)
```

---

## 53. Proposal Bonds

Anti-spam mechanism for governance proposals.

```
FLOW:
├─ POST /v1/governance/propose with bond: true (default)
├─ 100 credits locked from proposer's balance
├─ Deducted atomically in createProposal() transaction
├─ Bond amount stored on proposal row (bond_credits column)
├─ When proposal closes (auto-close or manual):
│  ├─ releaseBond() returns credits to proposer
│  └─ bond_released flag prevents double-release
└─ Opt-out: bond: false in request body (100 credit minimum still required)

ANTI-SPAM EFFECT:
├─ Creating 10 proposals = 1000 credits locked
├─ Credits returned but unavailable during voting period
└─ Economic cost to spam (opportunity cost of locked credits)
```

---

## 54. Structured Report Categories

Categorized skill reporting for faster admin triage.

```
CATEGORIES:
├─ security — vulnerability, data leak, malicious behavior
├─ spam — unsolicited, repetitive, low-quality
├─ copyright — IP violation, unauthorized content use
├─ quality — broken, unreliable, doesn't match description
├─ misleading — deceptive pricing, false claims
└─ other — default, free-text only

FLOW:
├─ POST /v1/marketplace/skills/:id/report
│  ├─ reason: "..." (5-500 chars)
│  └─ category: "security" (optional, default "other")
├─ Stored in skill_reports table (category column, v66)
├─ Response includes category breakdown
├─ Auto-flag after 3 reports (any category mix)
└─ Admin can filter/sort reports by category
```

---

## 55. Receipt Verification

Public endpoint for cryptographic transaction verification.

```
ENDPOINT: GET /v1/economy/receipts/verify/:transactionId
(no auth required — public auditability)

RESPONSE:
├─ verified: boolean (both hashes present)
├─ transaction: { id, type, credits, fee, skillId, from, to, timestamp }
├─ requestHash: sha256 of { skillId, variables, timestamp }
├─ resultHash: sha256 of { data, costCredits }
└─ integrity: human-readable verification status

USE CASES:
├─ Agents verify they were billed correctly
├─ Skill authors prove execution occurred
├─ Dispute resolution — cryptographic proof of request/result
└─ Third-party audit without API key access
```

---

## 56. Public Roadmap & Token Launch Tracker

Live revenue tracking toward $CLAWNET token launch milestones.

```
PUBLIC API: GET /v1/stats/roadmap (no auth required)
├─ Source: src/routes/stats.ts → getRevenueBreakdown() from src/db/admin.ts
├─ Revenue: SUM(amount_paid) from api_keys = actual USD received
├─ Platform fees: marketplace fee_credits + invoke fee_credits + swarm fees
└─ Response:
   ├─ revenue: { totalUsd, platformFeesCredits, platformFeesUsd, payingUsers }
   ├─ milestones: [
   │   { name: "Seed",         target: $50K,  description: "Minimum viable liquidity" }
   │   { name: "Launch Ready", target: $75K,  description: "Confident launch" }
   │   { name: "Cushion",      target: $100K, description: "Full launch + marketing" }
   │ ]
   ├─ current: { milestone, targetUsd, progressPct }
   └─ tokenLaunch: {
       status: BUILDING | VIABLE | READY,
       split: { burn: 40%, buybackLp: 25%, treasury: 20%, rewards: 15% }
     }

FRONTEND: site/roadmap.html
├─ Animated progress bar (0% → 100% of current milestone)
├─ 3 milestone markers ($50K / $75K / $100K)
├─ Tokenomics cards (burn, buyback, treasury, rewards)
├─ 5 development phases with done/active/planned indicators
├─ Auto-refreshes every 2 minutes from /v1/stats/roadmap
└─ Matches site design system (Inter, --accent: #10b981, dark/light theme)

TOKEN REVENUE FLOW (post-launch):
  Platform Revenue (85/15 split on skills)
  └─ 25% of payout revenue → Smart Contract
     ├─ 40% → Burn $CLAWNET + mint Orchestrator Badge NFT
     ├─ 25% → Buy $CLAWNET from market + add to LP with USDC
     ├─ 20% → Lock in DAO treasury (governed by holders)
     └─ 15% → Rewards pool (60% stakers / 40% contributors)
```

---

## 57. Dynamic Pricing

Demand-based surge pricing, volume discounts, and off-peak discounts applied at billing time.

```
PRICING LAYERS:
├─ Surge Pricing (demand-based)
│  ├─ Tracks per-skill calls/hour in skill_demand table
│  ├─ Creator configures thresholds in pricingConfig on skill creation
│  ├─ Multiplier up to 5x when demand exceeds threshold
│  ├─ Overrides off-peak discount (surge takes priority)
│  └─ dynamicCreditCost() in src/core/credits.ts
│
├─ Volume Discounts (caller loyalty)
│  ├─ Monthly call count tracked in caller_skill_usage table
│  ├─ Tiered discount up to 50% off base price
│  ├─ Resets monthly per caller-skill pair
│  └─ Always stacks with other modifiers (additive)
│
└─ Off-Peak Discounts (time-based)
   ├─ Creator defines UTC hour windows
   ├─ Discount up to 50% during off-peak hours
   └─ Disabled when surge is active (surge overrides)

STACKING RULES:
├─ Surge active?  → surge multiplier × base (no off-peak)
├─ Off-peak only? → base × (1 - offPeakDiscount)
├─ Volume always  → result × (1 - volumeDiscount)
└─ Final = round6(stacked result)

BILLING INTEGRATION:
├─ applyDynamicPricing() called at 3 billing sites:
│  ├─ api_proxy skill execution (skills.ts)
│  ├─ prompt_template skill execution (skills.ts)
│  └─ data query skill execution (skills.ts)
├─ Creator configures via pricingConfig in POST /v1/skills
└─ Pricing breakdown included in response costBreakdown
```

---

## 58. Composite-of-Composite Nesting

Composite skills can now contain other composite skills, up to depth 3.

```
DEPTH LIMITS:
├─ Max nesting depth: 3
├─ Max total leaf invocations across entire tree: 10
├─ composite_depth column on skills table tracks static depth
└─ Runtime depth counter as defense-in-depth (incremented per recursive call)

CYCLE DETECTION:
├─ hasCircularDependency() — BFS traversal at creation time
├─ Builds full dependency graph before saving
├─ Rejects skill creation if cycle detected
└─ Returns error with cycle path for debugging

EXECUTION FLOW:
  POST /v1/skills/:id/invoke (composite)
  └─ executeCompositeSkill(skill, vars, depth=0)
     ├─ For each dependency:
     │  ├─ If dep is atomic → execute normally
     │  └─ If dep is composite → executeCompositeSkill(dep, mappedVars, depth+1)
     │     └─ depth+1 > 3 → reject with COMPOSITE_DEPTH_EXCEEDED
     ├─ Track total leaf invocations across tree
     │  └─ leafCount > 10 → reject with COMPOSITE_LEAF_LIMIT
     ├─ Output piping works across nesting levels
     └─ Cost = sum of all leaf skill costs + assembly fees per composite level

EXAMPLE (depth 2):
  MarketAnalysis (composite, depth=2)
  ├─ PriceBundle (composite, depth=1)
  │  ├─ btc-price (atomic, leaf)
  │  └─ eth-price (atomic, leaf)
  ├─ SentimentBundle (composite, depth=1)
  │  ├─ twitter-sentiment (atomic, leaf)
  │  └─ news-sentiment (atomic, leaf)
  └─ summarize-report (atomic, leaf)
  Total leaves: 5 (within 10 limit)
```

---

## 59. Autonomous Hiring & Firing

Automatic replacement of degraded skills in composite pipelines, with revert on recovery.

```
TRIGGER: skill-health-cron.ts marks skill as DEGRADED (3 consecutive failures)

AUTO-REPLACE FLOW:
  Skill marked DEGRADED
  └─ autoReplaceInComposites(degradedSkillId)
     ├─ Find composites with auto_replace=1 that depend on this skill
     ├─ findReplacementSkill(degradedSkill)
     │  ├─ Match by tag + type (same category)
     │  ├─ Filter to ACTIVE + healthy skills only
     │  ├─ Prefer similar credit_cost (within 2x)
     │  └─ Return best match or null (no replacement = no swap)
     ├─ Swap dependency in composite_dependencies
     ├─ Record swap in composite_swaps table
     │  ├─ composite_id, original_skill_id, replacement_skill_id
     │  ├─ swapped_at timestamp
     │  └─ reverted_at (null until revert)
     ├─ Fire webhook to composite owner (if configured)
     │  └─ event: "skill.auto_replaced"
     └─ Max 3 active swaps per composite (safety limit)

AUTO-REVERT FLOW:
  Skill recovers (health check passes)
  └─ autoRevertInComposites(recoveredSkillId)
     ├─ Find active swaps where original_skill_id = recovered
     ├─ Restore original dependency
     ├─ Set reverted_at on swap record
     └─ Fire webhook: "skill.auto_reverted"

OPT-IN:
├─ auto_replace=1 on composite skill (default 0)
├─ Creator explicitly enables per composite
└─ Atomic skills are never auto-replaced (only composite deps)
```

---

## 60. Quorum & Governance Execution

Proposals auto-execute whitelisted actions when quorum is met and majority votes FOR.

```
PROPOSAL CREATION:
├─ quorum_pct: 0-51% (percentage of active keys that must vote)
├─ action_type: SKILL_DELIST | SKILL_VERIFY | PARAMETER_CHANGE
├─ action_payload_json: action-specific parameters
└─ Existing fields: title, description, bond, duration

QUORUM CALCULATION:
├─ getActiveKeyCount() — counts active non-treasury API keys
├─ checkQuorum(proposalId)
│  ├─ totalVoters = count of votes cast
│  ├─ requiredVoters = ceil(activeKeyCount × quorum_pct / 100)
│  └─ quorumMet = totalVoters >= requiredVoters
└─ Quorum checked at proposal close time

AUTO-EXECUTION ON CLOSE:
  Proposal voting period ends
  └─ closeProposal(proposalId)
     ├─ Count FOR vs AGAINST votes
     ├─ checkQuorum() — is threshold met?
     ├─ If quorum met AND majority FOR:
     │  └─ executeProposal(proposal)
     │     ├─ SKILL_DELIST → deactivate skill (is_active=0)
     │     ├─ SKILL_VERIFY → set verified=1 on skill
     │     └─ PARAMETER_CHANGE → apply bounded update
     │        ├─ fee: 1-50% (reject outside bounds)
     │        ├─ orchestration fee: 0-100 credits
     │        └─ Rejects unrecognized parameter names
     ├─ If quorum NOT met → proposal fails (no execution)
     └─ releaseBond() returns credits to proposer

SAFETY:
├─ Only whitelisted action_types accepted
├─ PARAMETER_CHANGE values bounded (cannot set fee to 0% or 100%)
├─ executeProposal() in src/routes/governance.ts
└─ Audit log entry for every auto-execution
```

---

## 61. Validator Roles

Community validators submit verdicts on transactions for credit rewards.

```
ADMIN PROMOTION:
├─ POST /v1/admin/validators/promote
│  ├─ Sets is_validator=1 on api_keys row
│  └─ Admin-only (existing admin guard)
└─ Validators are regular users with extra permissions

VALIDATION FLOW:
  POST /v1/validators/verify
  ├─ Body: { transactionId, verdict, notes? }
  ├─ verdict: VALID | INVALID | INCONCLUSIVE
  ├─ Guards:
  │  ├─ Must be validator (is_validator=1)
  │  ├─ Cannot validate own transactions (no self-validation)
  │  ├─ Daily limit: 100 validations per validator
  │  └─ Cannot validate same transaction twice
  ├─ Stored in validations table (src/db/validations.ts)
  └─ Reward: 0.5 credits per validation (topUpCredits)

LEADERBOARD:
├─ GET /v1/validators/leaderboard
│  ├─ Ranked by total validations submitted
│  ├─ Shows: validatorId, totalValidations, verdictBreakdown
│  └─ Public endpoint (no auth required)
└─ Per-skill aggregation:
   └─ GET /v1/validators/skill/:skillId
      ├─ Validations for transactions involving this skill
      └─ Verdict distribution (VALID/INVALID/INCONCLUSIVE counts)

DB SCHEMA:
  validations table
  ├─ id, transaction_id, validator_key_id
  ├─ verdict (VALID/INVALID/INCONCLUSIVE)
  ├─ notes (optional free text)
  └─ created_at
```

---

## 62. Persistent Agent Sessions

Stateful agent sessions with configurable triggers for scheduled skill execution.

```
SESSION CRUD:
├─ POST /v1/economy/sessions — create session
│  ├─ name, initial state (JSON), ttl (optional)
│  └─ Returns session ID
├─ GET /v1/economy/sessions — list sessions for key
├─ GET /v1/economy/sessions/:id — get session with state
├─ PATCH /v1/economy/sessions/:id — update session state
│  └─ Merges new state into existing (partial update)
└─ DELETE /v1/economy/sessions/:id — destroy session

LIMITS:
├─ Max 10 sessions per API key
├─ Max 50KB state per session
└─ Sessions stored in agent_sessions table (src/db/sessions.ts)

SCHEDULED SKILL INTEGRATION:
├─ Scheduled skills now accept sessionId in configuration
├─ Session state injected into skill variables
│  ├─ Keys prefixed with session. namespace
│  ├─ Example: session.lastPrice, session.portfolio
│  └─ Merged with explicit variables (explicit wins on conflict)
└─ Trigger types expanded:
   ├─ cron — existing time-based triggers (unchanged)
   ├─ context_change — fires when session state changes
   │  ├─ triggerConfig.watchKeys: ["portfolio", "alerts"]
   │  └─ Only fires if watched keys are modified
   └─ threshold — fires when session value crosses boundary
      ├─ triggerConfig.field: "session.balance"
      ├─ triggerConfig.op: "lt" | "gt" | "eq"
      ├─ triggerConfig.value: 100
      └─ Evaluated on every session state update

FLOW:
  Agent creates session (initial state)
  └─ Agent creates scheduled skill with sessionId
     └─ Trigger fires (cron/context_change/threshold)
        ├─ Load session state from DB
        ├─ Inject as session.* variables
        ├─ Execute skill with merged variables
        └─ Optionally update session state with result
```

---

## 57. Agent Self-Onboarding

```
AI agent wants to use ClawNet (no human signup needed)
│
├─ POST /v1/onboard (no auth required, 5/IP/hour rate limit)
│  ├─ Body: { name?, email?, referredBy?: "cn-xxxx" }
│  ├─ Creates API key: cn- + 48 hex chars (crypto.randomBytes)
│  ├─ Awards 100 free trial credits
│  ├─ If referredBy valid: +25 bonus credits to new agent, +50 to referrer
│  └─ Returns:
│     ├─ apiKey — ready to use immediately
│     ├─ gettingStarted — endpoint guide (orchestrate, skills, discover, budget)
│     ├─ topSkills — top 5 by rating/usage (name, id, creditCost, avgRating)
│     └─ limits — rate limit tiers, credit info, topup instructions
│
├─ GET /v1/onboard/manifest (no auth, MCP-compatible)
│  ├─ Returns tool manifest for MCP-compatible agent frameworks
│  ├─ Includes: orchestrate tool + all public skills as individual tools
│  ├─ Each tool has: name, description, inputSchema (JSON Schema)
│  └─ Authentication + pricing metadata included
│
└─ SDK: @clawnet/sdk (src/sdk/client.ts)
   ├─ ClawNet.onboard() — static, creates key programmatically
   ├─ new ClawNet({ apiKey }) — wraps all REST endpoints
   └─ Methods: orchestrate, invokeSkill, discover, getBalance, etc.

Key files:
├─ src/routes/onboard.ts — POST /v1/onboard + GET /v1/onboard/manifest
└─ src/sdk/client.ts — @clawnet/sdk TypeScript client
```

---

## 58. Flywheel — Recommendations & Discovery

```
Agent-native skill recommendations (collaborative filtering)
│
├─ GET /v1/recommendations/skills/:skillId
│  ├─ "Agents who used X also used Y"
│  ├─ Finds API keys that transacted for skillId
│  ├─ Finds other skills those keys also used
│  ├─ Ranked by co-usage frequency
│  └─ Returns: { skillId, name, coUsageCount, coUsageRate, creditCost, avgRating }
│
├─ GET /v1/recommendations/agent
│  ├─ Personalized for the calling agent's API key
│  ├─ Finds keys with 3+ shared skills (similar usage pattern)
│  ├─ Recommends skills those similar agents used that this agent hasn't
│  └─ Filters out skills the agent already uses
│
├─ GET /v1/recommendations/popular?period=week
│  ├─ Most-used skills by transaction count
│  ├─ Trend detection: compare this period vs previous period (up/down/stable)
│  └─ Returns: { skillId, name, usageCount, uniqueUsers, avgRating, trend }
│
└─ GET /v1/recommendations/trending
   ├─ Highest growth rate (this week vs last week)
   ├─ Min 5 uses filter (removes noise)
   └─ Sorted by growth percentage

Platform usage insights (admin):
├─ getPlatformHealth() — active keys, transactions, cache hit rate, revenue
├─ getEndpointUsageHeatmap() — hourly endpoint usage (feeds cache warming)
└─ getSkillEcosystemStats() — skills by type, creators, revenue, top creator

Key files:
├─ src/core/recommendations.ts — collaborative filtering engine
├─ src/core/usage-insights.ts — platform intelligence
└─ src/routes/recommendations.ts — 4 public endpoints
```

---

## 59. Creator Tools & Quality Scoring

```
Creator onboarding + skill quality automation
│
├─ LLM Skill Generator
│  ├─ POST /v1/creator/template with { type, name, description }
│  ├─ OR: generateSkillFromDescription("a tool that analyzes token risk")
│  ├─ LLM auto-detects skill_type: URL mentioned → api_proxy, text → prompt_template, data → data
│  ├─ Returns complete skill config: name, description, type, credit_cost, tags, template/proxy_url
│  └─ Zero friction: describe in English → get publishable config
│
├─ Pre-Publish Validation
│  ├─ POST /v1/creator/validate with skill config
│  ├─ Checks: proxy_url reachable, prompt has {{vars}}, JSON valid, description length, tags exist
│  └─ Returns: { approved, score, checks[], suggestions[] }
│
├─ Quality Scoring (0-100, cached 1 hour)
│  ├─ Reliability (0-25): success_rate + SLA compliance
│  ├─ Performance (0-25): avg_latency_ms buckets
│  ├─ Trust (0-25): rating + verified + age
│  ├─ Usage (0-25): invocation count + unique users + trending
│  ├─ Grade: A(90+) B(75+) C(60+) D(40+) F(<40)
│  └─ Flags: low_rating, slow_response, unverified, no_sla, low_usage, new_skill
│
├─ Creator Stats: GET /v1/creator/stats
│  └─ skillCount, totalRevenue, totalInvocations, avgRating, topSkill, growth
│
├─ Revenue Estimator: GET /v1/creator/revenue-estimate?creditCost=2&dailyUses=50
│  └─ dailyCredits, monthlyCredits, monthlyUsd, creatorShareUsd, breakEvenDays
│
└─ Creator Growth Notifications (every 30 minutes)
   ├─ Milestone webhooks: 1, 10, 50, 100, 500, 1000 invocations
   ├─ Rating milestones: first rating, first 5-star
   ├─ Revenue milestones: 100, 1000, 10000 credits earned
   └─ Fires SKILL_MILESTONE webhook event + logger

Key files:
├─ src/core/skill-generator.ts — LLM-powered skill creation
├─ src/core/quality-scoring.ts — 0-100 score with 1h cache
├─ src/core/creator-tools.ts — templates, validation, revenue, stats
├─ src/core/creator-notifications.ts — milestone tracking + cron
└─ src/routes/creator.ts — 4 creator endpoints
```

---

## 60. Agent Referral System

```
Viral growth: agents that bring other agents earn credits
│
├─ How it works:
│  ├─ Agent A has key cn-aaaa
│  ├─ Agent A refers Agent B: POST /v1/onboard { referredBy: "cn-aaaa" }
│  ├─ Agent B gets: 100 trial + 25 bonus = 125 credits
│  ├─ Agent A gets: +50 credits (referral reward)
│  └─ Both benefit — flywheel incentive
│
├─ Implementation (SQLite, atomic transactions):
│  ├─ agent_referrals table: referrer_key, referred_key (UNIQUE), credits_awarded
│  ├─ recordReferral() — transaction: INSERT referral + topUpCredits(referrer, 50) + topUpCredits(referred, 25)
│  ├─ Dedup: UNIQUE constraint on referred_key prevents double-counting
│  └─ Migration v69 creates table + index
│
├─ Stats:
│  ├─ getReferralStats(apiKey) — total referred, credits earned, masked referred keys
│  └─ getTopReferrers(limit) — leaderboard sorted by count
│
└─ Anti-abuse:
   ├─ Onboard endpoint rate limited: 5/IP/hour
   ├─ referred_key UNIQUE: can't refer same key twice
   └─ Credits awarded via topUpCredits (audit logged)

Key file: src/core/agent-referrals.ts
```

---

## 61. Embeddable Widgets

```
Creators embed skill stats on their sites — drives traffic back to ClawNet
│
├─ GET /v1/widgets/badge/:skillId — SVG badge (no auth, CORS enabled)
│  ├─ ┌──────────────────────────────────┐
│  │  │  ClawNet │ token-analysis │ ★4.8 │
│  │  └──────────────────────────────────┘
│  ├─ Color: green (≥4.0), yellow (≥3.0), red (<3.0)
│  └─ Content-Type: image/svg+xml
│
├─ GET /v1/widgets/card/:skillId — HTML card (embeddable iframe)
│  ├─ Dark-themed card: name, description, rating, invocations, cost
│  ├─ "Try it" button → POST /v1/skills/:id/invoke
│  ├─ "Powered by ClawNet" footer
│  └─ Supports ?format=js for script injection
│
└─ GET /v1/widgets/embed/:skillId — Copy-paste snippet
   └─ Returns HTML with <script> tag for creators to paste on their site

Key file: src/routes/widgets.ts
```

---

## 62. llms.txt — Machine-Readable Discovery

```
ClawNet publishes a machine-readable llms.txt file at /llms.txt so AI agents
can discover all platform capabilities in a single fetch — a de facto standard
adopted by AI-native platforms.
│
├─ GET /llms.txt — compact discovery document (text/plain)
│  ├─ Core API endpoints (orchestrate, batch, stream, LLM, swarm)
│  ├─ Skill marketplace endpoints (browse, invoke, query, MCP/OpenAPI manifests)
│  ├─ x402 payment endpoints (discovery, skills list, invoke, receipts)
│  ├─ Economy endpoints (budget accounts, gifting, webhooks, scheduled skills)
│  ├─ Discovery endpoints (semantic search, recommendations, registry)
│  ├─ Authentication methods (API key, x402, Clerk)
│  ├─ MCP server connection details
│  ├─ Pricing model and credit economics
│  └─ .well-known discovery file locations
│
└─ GET /llms.txt/full — expanded version with live skill listings
   ├─ Everything from compact version
   └─ Dynamic content: fetches live public skills from DB
      └─ Each skill listed with ID, description, credit cost, and tags
         └─ Agents can discover and invoke skills without prior knowledge

Key file: src/routes/llms.ts
```

---

## 63. .well-known Discovery Files

```
Standard discovery documents for cross-platform interoperability
│
├─ GET /.well-known/agent-card.json — ClawNet identity card
│  ├─ Primary discovery document — other platforms auto-discover capabilities
│  ├─ Capabilities: orchestration, marketplace, x402 payments, MCP tools
│  ├─ Auth methods: API key, x402, Clerk
│  ├─ Endpoint map: base URLs for all service categories
│  ├─ Pricing model: credits_per_usd, orchestration_fee, cache_discount
│  └─ Trust features: signed responses, cryptographic receipts,
│     SLA contracts, validator network
│
├─ GET /.well-known/agents.json — list of agent services
│  ├─ orchestrator — natural language → API routing
│  ├─ marketplace — skill discovery and invocation
│  └─ x402_provider — USDC-on-Base payment gateway
│
├─ GET /.well-known/mcp.json — MCP server discovery
│  ├─ stdio transport details
│  ├─ HTTP transport details (POST /mcp)
│  └─ Tool list: list-skills, get-skill, invoke-skill,
│     search-registry, orchestrate, get-credits
│
└─ GET /.well-known/x402.json — x402 payment discovery
   ├─ Network, chain, recipient, facilitator
   ├─ Pricing: per-credit and per-orchestration USDC rates
   └─ Returns { enabled: false } when X402_RECIPIENT_ADDRESS not configured

Key file: src/routes/well-known.ts
```

---

## 64. Bounty System — Demand-Side Marketplace

```
Users post problems and bounties for skill creators to fulfill,
creating demand-side marketplace liquidity
│
├─ Lifecycle:
│  POST /v1/bounties (create) → open → claimed → submitted → completed
│                                    → expired (past deadline)
│                                    → cancelled (by creator)
│
├─ GET /v1/bounties — list bounties (public, filterable by status/category/tag)
├─ GET /v1/bounties/:id — bounty details
│
├─ POST /v1/bounties — create bounty
│  ├─ Body: { title, description, rewardCredits, category, tags, deadline? }
│  ├─ deductCredit(creator, rewardCredits) — escrows reward from creator
│  └─ Status: open
│
├─ POST /v1/bounties/:id/claim — claim a bounty
│  ├─ Locks bounty to claimer (only one claimer at a time)
│  └─ Status: open → claimed
│
├─ POST /v1/bounties/:id/submit — submit work
│  ├─ Body: { submissionUrl }
│  └─ Status: claimed → submitted
│
├─ POST /v1/bounties/:id/complete — creator approves
│  ├─ topUpCredits(claimer, rewardCredits) — transfers escrowed amount
│  └─ Status: submitted → completed
│
├─ DELETE /v1/bounties/:id — cancel (only if status = open)
│  ├─ topUpCredits(creator, rewardCredits) — returns escrowed credits
│  └─ Status: open → cancelled
│
└─ Expiration:
   └─ expireBounties() cron detects past-deadline bounties
      └─ Returns credits to creator, status → expired

Key files: src/routes/bounties.ts, src/db/bounties.ts
```

---

## 65. Output Normalization — Structured Response Formatting

```
Raw API responses transformed into standardized formats for agent consumption
│
├─ Formats supported: JSON, CSV, Markdown table, plain text
│
├─ Pipeline: parse → filter fields → flatten → redact sensitive
│            → truncate arrays → format
│
├─ Features:
│  ├─ Field filtering — include/exclude specific fields from output
│  ├─ Object flattening — nested objects → dot-notation keys
│  ├─ Sensitive data redaction — auto-redacts keys matching:
│  │   password, secret, token, private_key, api_key
│  ├─ Array truncation — limit long arrays to N items
│  ├─ Schema validation — lightweight JSON Schema validation
│  │   (required fields + type checks)
│  └─ CSV/Markdown export — array-of-objects → tabular format
│     with proper escaping
│
└─ Usage:
   ├─ Programmatic: normalizeOutput(data, options)
   └─ At invocation: ?format=csv query parameter on skill invoke

Key file: src/utils/output-normalizer.ts
```

---

## 66. Sponsored Free-Tier — Creator-Funded Skill Access

```
Skill creators sponsor free credits for their skills to attract users
│
├─ Sponsorship model:
│  ├─ Creator escrows credits from balance into sponsorship
│  ├─ Users invoke sponsored skill for free (up to limits)
│  ├─ Credits deducted from sponsorship pool, not user's balance
│  └─ Sponsors can top-up, deactivate, or let sponsorships expire
│
├─ POST /v1/sponsorships — create sponsorship
│  ├─ Body: { skillId, totalCredits, dailyLimitPerUser?, maxUsesPerUser?, expiresAt? }
│  └─ deductCredit(creator, totalCredits) — escrows credits
│
├─ GET /v1/sponsorships — list my sponsorships
├─ GET /v1/sponsorships/:id — sponsorship details
│
├─ POST /v1/sponsorships/:id/top-up — add more credits
│  └─ deductCredit(creator, additionalCredits)
│
├─ DELETE /v1/sponsorships/:id — deactivate
│  └─ Remaining credits returned to creator
│
└─ Limits:
   ├─ dailyLimitPerUser — max credits per user per day (default: 10)
   ├─ maxUsesPerUser — max total uses per user (default: 100)
   ├─ expiresAt — optional expiration date
   └─ Partial sponsorship: if remaining < needed, user pays difference

Key files: src/routes/sponsorship.ts, src/db/sponsorship.ts
```

---

## 67. Remote HTTP MCP Server — Zero-Install Agent Integration

```
ClawNet serves MCP tools over HTTP — agents connect remotely without
installing anything
│
├─ Endpoint: POST /mcp (JSON-RPC over HTTP)
│
├─ Supported methods:
│  ├─ initialize — returns server capabilities and tool list
│  ├─ tools/list — enumerate available tools
│  ├─ tools/call — execute a tool
│  └─ ping — health check
│
├─ Session management:
│  ├─ Server generates Mcp-Session-Id header on first request
│  ├─ Sessions time out after 15 minutes of inactivity
│  └─ Max 100 concurrent sessions
│
├─ Tools available (same as stdio server):
│  ├─ list-skills — browse skill marketplace
│  ├─ get-skill — skill details
│  ├─ invoke-skill — execute a skill
│  ├─ search-registry — search API endpoint registry
│  ├─ orchestrate — natural language orchestration
│  └─ get-credits — check credit balance
│
└─ Connection examples:
   ├─ claude mcp add-json clawnet '{"type":"url","url":"https://api.claw-net.org/mcp"}'
   └─ curl -X POST https://api.claw-net.org/mcp \
        -H 'Content-Type: application/json' \
        -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

Key file: src/mcp/http-transport.ts
```

---

## 68. Verification Tiers — Provider Trust Hierarchy

```
Skills assigned verification tiers that signal trust level to agents
│
├─ Tier 0: Unverified
│  └─ Default for all new skills
│
├─ Tier 1: Basic (auto-verified)
│  ├─ Requirements (all must be met):
│  │  ├─ 100+ total uses
│  │  ├─ 95%+ success rate
│  │  ├─ 4.0+ average rating
│  │  ├─ 5+ reviews
│  │  ├─ Health status: healthy
│  │  └─ Not flagged
│  └─ autoVerifySkill() promotes when criteria met
│     └─ Can be called from health cron
│
├─ Tier 2: Verified
│  └─ Manual verification by admin
│
├─ Tier 3: Official
│  └─ Admin-promoted (ClawNet official skills)
│
└─ Marketplace filtering:
   └─ GET /v1/marketplace/skills?tier=2 — filter by minimum tier

Key file: src/db/skill-extensions.ts
```

---

## 69. Payment-Proof-Backed Reviews — Sybil-Resistant Ratings

```
Reviews include payment proof to verify reviewer actually paid for the skill
│
├─ Review types:
│  ├─ Verified purchase — reviewer provides x402 receipt or transaction ID
│  │  └─ Marked with verified_purchase = true
│  └─ Unverified — standard review without payment proof
│     └─ Still accepted but weighted lower
│
├─ Verification flow:
│  1. Reviewer submits rating with optional paymentProofType + paymentProofId
│  2. System looks up receipt/transaction in database
│  3. If found and matches skill_id → review marked as verified purchase
│  4. Payment amount recorded for economic weight
│
└─ Stats endpoint returns:
   ├─ Total reviews vs verified reviews
   ├─ Average rating (all) vs average verified rating
   └─ Verified purchase rate (% of reviews with proof)

Key file: src/db/skill-extensions.ts
```

---

## 70. Composite Skill Metrics — Token Savings & Efficiency

```
Composite skills track efficiency metrics demonstrating value to agents
│
├─ Metrics tracked:
│  ├─ tool_calls_compressed — individual tool calls the composite replaces
│  ├─ estimated_token_savings — context tokens saved (~15k per compressed call)
│  ├─ avg_execution_time_ms — running average execution time
│  ├─ total_executions — total times composite has been run
│  └─ success_rate — running success rate
│
├─ Token savings formula:
│  └─ (toolCallCount - 1) × 15,000 tokens saved per execution
│
└─ Displayed on:
   ├─ Marketplace skill cards for composite skills
   └─ Skill detail pages

Key file: src/db/skill-extensions.ts
```

---

## 71. Extended x402 Payment Routes

```
Beyond skill invocation, x402 payments now cover orchestration and data queries
│
├─ POST /x402/orchestrate — natural language orchestration paid via USDC on Base
│  ├─ Pricing: ORCHESTRATION_FEE × X402_USDC_PER_CREDIT USDC per query
│  │   └─ Default: 2 × $0.001 = $0.002 per query
│  ├─ Same parseIntent → optimizePlan → executePlan → formatResponse pipeline
│  └─ x402 receipt tracked in x402_receipts table
│
├─ POST /x402/query/:id — data skill query paid via USDC on Base
│  ├─ Pricing: skill.credit_cost × X402_USDC_PER_CREDIT USDC per query
│  ├─ Executes data skill proxy call
│  └─ x402 receipt tracked in x402_receipts table
│
└─ All x402 routes share:
   ├─ Same facilitator (CDP with fallbacks)
   ├─ Same receipt tracking (x402_receipts table)
   ├─ Same 85/15 creator revenue split (if skill has creator_evm_wallet)
   └─ Public receipt verification at GET /x402/verify/:requestId

Key file: src/routes/x402-skills.ts
```

---

## 72. x402 Test Mode — Echo Merchant

```
Development testing environment for x402 payments. Inspired by PayAI's Echo Merchant concept.
│
├─ Endpoints:
│  ├─ GET /x402/test-config — test mode configuration and available endpoints
│  ├─ POST /x402/test/skills/:id — invoke a skill without payment (rate-limited: 10/IP/hour)
│  └─ POST /x402/test/orchestrate — orchestrate without payment (rate-limited: 5/IP/hour)
│
├─ Behavior:
│  ├─ No x402 payment required (middleware bypassed)
│  ├─ Skill executes normally (parseIntent → executePlan → formatResponse)
│  ├─ Receipt recorded with test=1 flag (excluded from revenue calculations)
│  ├─ Response includes metadata.testMode: true
│  └─ Rate-limited per IP to prevent abuse
│
└─ Use case: Developers testing x402 client implementations can validate their
   integration against real ClawNet infrastructure without spending USDC.

Key file: src/routes/x402-skills.ts
```

---

## 73. Stats Telemetry — Public Platform Metrics

```
Public endpoint providing aggregated platform statistics for dashboard display.
│
├─ Endpoint: GET /v1/stats/telemetry
│
├─ Returns:
│  ├─ Total skills, endpoints, active API keys
│  ├─ 30-day aggregates: orchestrations, credits transacted, x402 payments/revenue
│  ├─ Cache hit rate, average latency
│  ├─ Open bounties, active sponsorships
│  └─ Daily breakdowns (30-day rolling): orchestrations, credits, skill invocations, x402 payments
│
├─ No auth required — public data for transparency
└─ Rate-limited

Key file: src/routes/stats-telemetry.ts
```

---

## 74. Composite Revenue Splitting

```
When a composite skill executes multiple sub-skills, revenue is split
proportionally among all sub-skill creators.
│
├─ Split formula:
│  ├─ 15% → treasury (standard platform fee)
│  ├─ 85% → creator pool, split proportionally by each sub-skill's credit_cost
│  └─ Last recipient gets remainder to avoid rounding errors
│
├─ Recorded as: composite_split transaction type with note linking
│  composite → sub-skill
│
└─ Fire-and-forget: Split execution never crashes the caller.
   Errors logged but not propagated.

Key file: src/utils/composite-split.ts
```

---

## 75. Agent Self-Onboarding — Zero-Friction Registration

```
Agents can register and get an API key with a single POST request.
No human signup, no email verification, no OAuth flow.
│
├─ Endpoints:
│  ├─ POST /v1/self-onboard/register — instant registration, returns API key
│  └─ GET /v1/self-onboard/quickstart — onboarding guide (no auth)
│
├─ Registration body:
│  { name, description?, email?, agentType?, capabilities?, webhookUrl? }
│
├─ Returns:
│  ├─ API key
│  ├─ Free trial credits (if configured)
│  └─ Quick-start examples for orchestrate/skills/x402/MCP
│
├─ Rate-limited: 5 registrations per IP per hour
│
└─ Alternative access (no registration needed):
   ├─ x402: pay per call with USDC
   ├─ MCP: connect for browsing (invoke requires key)
   └─ Public endpoints: marketplace, endpoints, llms.txt

Key file: src/routes/self-onboard.ts
```

---

## 76. MCP Per-Tool Pricing

```
HTTP MCP server tools are categorized as free or paid:
│
├─ Free tools (no auth required):
│  ├─ list-skills
│  ├─ get-skill
│  ├─ search-registry
│  └─ get-credits
│
├─ Paid tools (require CLAWNET_API_KEY in MCP server environment):
│  ├─ invoke-skill — skill's credit_cost
│  └─ orchestrate — 2 credits
│
└─ Table:
   | Tool            | Cost               |
   |-----------------|---------------------|
   | list-skills     | Free               |
   | get-skill       | Free               |
   | search-registry | Free               |
   | get-credits     | Free               |
   | invoke-skill    | Skill's credit_cost |
   | orchestrate     | 2 credits          |

Key file: src/mcp/http-transport.ts
```

---

*Generated from codebase analysis. Last updated: 2026-03-16. 69 DB migrations, decimal credits (v3), 2-wallet architecture, treasury auto-sweep, endpoint auto-discovery (183 ClawAPIs endpoints), smart cache v2 (28 features: content-hash validation, SWR, adaptive TTL, request coalescing, negative caching, gzip compression, LFU eviction, cache warming, cost optimizer, budget advisor), agent economy layer (trust signals, cryptographic receipts, compare/quote, composite skills v2, SLA contracts, output contracts, budget accounts, event webhooks, trust decay, penalty escalation, scheduled execution, proposal bonds, validator roles, persistent agent sessions), flywheel system (agent self-onboarding, MCP manifest, SDK scaffolding, recommendations engine, quality scoring, creator tools, LLM skill generator, growth notifications, referral system, embeddable widgets), dynamic pricing (surge/volume/off-peak), composite-of-composite nesting (depth 3), autonomous hiring/firing, quorum governance execution, llms.txt machine-readable discovery, .well-known discovery files, bounty system, output normalization, sponsored free-tier, remote HTTP MCP server, verification tiers, payment-proof-backed reviews, composite skill metrics, extended x402 payment routes, x402 test mode, stats telemetry, composite revenue splitting, agent self-onboarding, MCP per-tool pricing.*
