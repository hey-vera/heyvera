# Architecture Reference

## Key Files

| File | What |
|------|------|
| `src/index.ts` | Server entry, middleware stack, cron startups |
| `src/db/connection.ts` | initDb(), getDb(), migrations, logAudit() |
| `src/db/index.ts` | Barrel export of domain DB files |
| `src/core/credits.ts` | round6(), all billing math |
| `src/core/executor.ts` | executePlan(), circuit breaker, cache, zauth pre-flight |
| `src/core/pricing.ts` | optimizePlan(), checkBudget(), 4 strategies |
| `src/core/composite-executor.ts` | Output piping, parallel, conditionals, depth 3 |
| `src/cache/index.ts` | L1+L2, SWR, coalescing, negative cache |
| `src/core/soma.ts` | Soma Heart singleton, heartLlmComplete(), key bridging, genome |
| `src/core/soma-receipt.ts` | Unified receipt builder for all payment paths |
| `src/core/eas-anchor-cron.ts` | EAS receipt Merkle anchoring on Base |
| `src/providers/clawapis.ts` | x402 client, clawApiCall() + soma birth certificates |
| `src/providers/llm.ts` | llmComplete() — routes through heart.generate() first |
| `src/providers/x402-facilitator.ts` | Facilitator pool (Coinbase/PayAI/Skyfire), failover |
| `src/utils/billing.ts` | trackDelegatedSpend() |
| `src/utils/mask.ts` | maskApiKey() (first4+last4) |
| `src/utils/solana-payout.ts` | sendSolanaUsdc(), balance checks |
| `src/utils/shutdown.ts` | SIGTERM/SIGINT, 15s drain |
| `src/utils/jcs.ts` | Shared JCS + base58btc + Ed25519 validation |
| `src/utils/crypto-agility.ts` | somaHash(), ML-DSA-65 hybrid signing, PQC migration |
| `src/utils/eas.ts` | EAS integration: off-chain attestations, schema encoding, batch timestamp |
| `src/routes/api.ts` | POST /v1/orchestrate, GET /v1/estimate |
| `src/routes/endpoints.ts` | GET /v1/endpoints (catalog), POST /v1/endpoints/:id/call |
| `src/routes/soma.ts` | Soma verdict API + receipt lookup + verify mode |
| `src/routes/x402-skills.ts` | x402 payment-gated skill invocation |
| `src/routes/providers.ts` | Provider umbrella REST API (13 endpoints, incl. self-service registration) |
| `src/middleware/auth.ts` | checkApiKey, checkPermission, checkPolicy |
| `src/middleware/soma-provenance.ts` | X-Soma-* provenance headers on all responses (dual-sign aware) |
| `src/core/dual-sign.ts` | Dual-signed Soma: validate provider cert + platform co-sign |
| `src/core/dual-sign-state.ts` | Request-scoped dual-sign state for middleware |
| `src/core/zktls.ts` | zkTLS verification via Reclaim Protocol (opt-in) |
| `src/db/providers.ts` | Provider CRUD, endpoint mapping, analytics, revenue share |
| `src/db/promo-codes.ts` | Promo code CRUD + redemption (event-scoped, max_uses, expiry) |

## Cron Jobs

| Cron | Interval | What |
|------|----------|------|
| Escrow | periodic | Expire stale escrows |
| Endpoint health | 15m | Ping endpoints, mark DEGRADED |
| Endpoint discovery | 4h | Poll clawapis.com/api/pricing |
| Skill A/B | periodic | A/B test skill variants |
| Stake unlock | periodic | Unlock matured stakes |
| Payout | 4h | Creator payouts + treasury sweep + wallet alerts |
| Skill health | 15m | SLA checks, penalty escalation, trust decay, auto-replace |
| Skill scheduler | 1m | Execute due scheduled skills |
| Cache warming | periodic | Preload popular cache entries |
| Creator notifications | periodic | Email notifications |
| Index sync | periodic | Multi-source endpoint sync |
| Soma anchor | periodic | Soma verdict Merkle root → Solana memo |
| EAS anchor | periodic | Soma receipt Merkle root → Base EAS timestamp |
| Zauth discovery | 4h | Auto-discover verified x402 endpoints |
| Canary | periodic | Canary checks |
| Trust decay | periodic | Rating weight decay (10%/30 days) |

## Smart Cache v2

Reference: `src/cache/`

Three-layer: L1 memory (10k max, LFU eviction) → L2 Redis (gzip >1KB) → agent context (SQLite).

Features: content-hash validation, stale-while-revalidate, adaptive TTL, request coalescing, negative caching (30s), semantic key normalization (SOL↔sol↔Solana), startup preloading, background refresh queue, proportional pricing (10% of live).

## 2-Wallet Architecture

| Wallet | Purpose | Env Var |
|--------|---------|---------|
| RECEIVING | Users send USDC | `SOLANA_RECEIVING_WALLET` (public only) |
| HOT WALLET | x402 calls + payouts | `SOLANA_PRIVATE_KEY` = `PLATFORM_PAYOUT_PRIVATE_KEY` |

Treasury sweep optional — with 2-wallet setup, treasury credits are pure profit.

## Environment

All env vars Zod-validated in `src/config/index.ts`. See `.env.example` for the full list. Key vars:

- `PORT=3402`, `NODE_ENV`, `LOG_LEVEL`
- `ANTHROPIC_API_KEY`, `LLM_PROVIDER` (anthropic|openai|openclaw)
- `REDIS_URL`, `CACHE_TTL_SECONDS=300`
- `CLERK_SECRET_KEY`, `ADMIN_API_KEY` (required in prod, min 16 chars)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `SOLANA_RECEIVING_WALLET`, `SOLANA_PRIVATE_KEY`, `SOLANA_RPC_URL`
- `CREDITS_PER_USD=1000`, `COST_MARKUP_FACTOR=1500`, `ORCHESTRATION_FEE=2`
- `PLATFORM_SIGNING_SECRET` (deterministic Ed25519 key derivation for Soma Heart)
- `X402_RECIPIENT_ADDRESS` (enables x402 payment mode)
- `EVM_PRIVATE_KEY` (Base wallet for EAS attestations + x402 payouts)
- `BASE_RPC_URL` (Coinbase CDP), `BASE_RPC_FALLBACK` (Alchemy — auto-failover)
- `EAS_SCHEMA_UID` (registered receipt schema on Base)
- `AG0_DISCOVERY_ENABLED`, `INDEX_SYNC_ENABLED`, `MERKLE_ANCHOR_ENABLED` (feature flags)
- `EAS_ANCHOR_ENABLED` (hourly receipt anchoring on Base), `PQ_SIGNATURES_ENABLED` (hybrid Ed25519+ML-DSA-65)
- `ZKTLS_ENABLED`, `RECLAIM_APP_ID`, `RECLAIM_APP_SECRET` (opt-in zkTLS data origin proofs)
- `SENTRY_DSN` (optional), `RESEND_API_KEY` (optional)

## Soma Check Protocol — Conditional Payment via Content-Addressed Change Detection

First conditional payment protocol for APIs. Agents check a content hash before paying — if data hasn't changed, they pay nothing. Built on Soma's existing `dataHash` from birth certificates.

**Flow:**
```
1. Agent → GET /v1/endpoints/:id/check          → { dataHash, fresh, age } (FREE)
2. Agent → POST /v1/endpoints/:id/call
           + If-Soma-Hash: <previous_hash>
   a. Hash MATCHES cache → { unchanged: true }   (0 credits)
   b. Hash DIFFERS        → normal x402 flow      (full price, new dataHash returned)
   c. No header           → normal x402 flow      (backward compatible)
```

**Key files:**
- `src/routes/endpoints.ts` — `GET /:id/check` (free hash probe), `If-Soma-Hash` header on `POST /:id/call`
- `src/core/cache-certificate.ts` — `getCacheHashInfo()` lightweight hash lookup
- `src/core/provider-cache-warm-cron.ts` — Soma Check hash comparison skips re-cache on unchanged data

**Response headers:** All endpoint responses include `X-Soma-Hash` (data content hash) and `X-Soma-Protocol: Soma Check/1.0`. Agents store the hash and send it as `If-Soma-Hash` on subsequent requests.

**Why it's in Soma:** The hash that enables conditional payments IS the same hash that proves data provenance. One primitive, two capabilities. No other protocol has this — x402, ACP, AP2, L402 all charge unconditionally.

## Five-Layer Trust Stack

ClawNet provides the only five-layer cryptographic trust stack in x402:

| Layer | Technology | What It Proves | File |
|-------|-----------|----------------|------|
| 1. TLS Origin | zkTLS (Reclaim Protocol) | Data came from the server's TLS certificate | `src/core/zktls.ts` |
| 2. Provider Cert | Soma Heart (provider-side) | Provider processed data authentically | `src/core/dual-sign.ts` |
| 3. Platform Cert | Soma Heart (ClawNet-side) | Platform relayed without tampering | `src/core/soma.ts` |
| 4. PQ Signature | Ed25519 + ML-DSA-65 hybrid | Quantum-resistant durability | `src/utils/crypto-agility.ts` |
| 5. On-Chain Anchor | EAS on Base | Immutable public record | `src/core/eas-anchor-cron.ts` |

Layers 1-2 are opt-in. Layers 3-5 are always-on for paid interactions.

## Provider Umbrella

x402 providers register their endpoints and route traffic through ClawNet. Three tiers:

| Tier | Fee | Live Share | Cache Revenue | Key Features |
|------|-----|-----------|---------------|-------------|
| Open | 0% | 100% | None | Listing + basic analytics |
| Standard | 5% | 95% | 50% of cache hits | Orchestration, cache revenue, Soma provenance |
| Verified | 10% | 90% | 50% of cache hits | Priority orchestration, cache warming, PQ sigs, trust badge |

Cache hits are pure profit for providers — their server is never touched.

- **Tier comparison:** `GET /v1/providers/tiers` (public) — tier details and pricing
- **Self-service:** `POST /v1/providers/register` (any API key holder) — pending review
- **Admin registration:** `POST /v1/providers` (admin) — direct creation
- **Tier change:** `POST /v1/providers/:id/tier` (admin) — set open/standard/verified
- **Endpoint mapping:** `POST /v1/providers/:id/endpoints` — links endpoints to provider
- **Freshness declarations:** `PATCH /v1/providers/:id/endpoints/:eid/freshness` — set TTL, enable cache warming
- **Revenue dashboard:** `GET /v1/providers/:id/revenue` — live vs cache revenue, comparison to direct
- **Scoped keys:** `POST /v1/providers/:id/keys` — API key restricted to provider's endpoints
- **Analytics:** `GET /v1/providers/:id/analytics` — calls, cache hits, revenue, latency
- **Dual-sign:** Providers running Soma heart get automatic dual-signed provenance
- **Verify mode:** `POST /v1/soma/verify` — agents call providers directly, submit cert for async verification
- **Cache warming:** Provider sets `cacheWarm: true` + `updateFrequencySeconds` — proactive refresh cron
- **Push invalidation:** `POST /v1/providers/:id/invalidate` — provider pushes when data changes, immediate cache clear
- **Auto-discover:** `POST /v1/providers/:id/auto-discover` — auto-map endpoints from pricing URL in one call
- **Demand insights:** `GET /v1/providers/:id/insights` — per-endpoint volume, cache rates, growth trends, recommendations
- **Agent freshness:** `POST /v1/endpoints/:id/call` accepts `freshness`: `realtime` (skip cache), `fast` (stale+refresh), `relaxed` (default)

## Certified Cache Layer

Every cache entry gets a Soma certificate chaining to the original birth certificate. Cached data is MORE trustworthy than direct calls — triple provenance.

- **Certificate creation:** On every cache set after a live fetch (`src/core/cache-certificate.ts`)
- **Certificate serving:** Cache hits include `provenance.cacheCert` with original cert + cache cert + chain hash
- **Freshness verification:** Agents request `maxAge` (seconds) — cache only serves if fresh enough
- **Cleanup:** Expired certificates pruned automatically
- **DB:** `cache_certificates` table (migration v144)

## Promo Codes

Admin-created event-scoped codes for controlled credit distribution.

- **Admin create:** `POST /v1/admin/promo-codes` — code, credits_amount, max_uses, expires_at, event_name
- **Admin list:** `GET /v1/admin/promo-codes` — all codes with usage stats
- **Admin detail:** `GET /v1/admin/promo-codes/:id` — code + redemption list
- **Deactivate:** `POST /v1/admin/promo-codes/:id/deactivate` — kill a code
- **Redeem (new users):** `POST /v1/self-onboard/register` with `promoCode` field
- **Redeem (existing):** `POST /v1/account/redeem-promo` with `code` field
- One redemption per account per code. DB: `promo_codes` + `promo_redemptions` tables (migration v140)

## SDK & Integration Packages

All published under `@1xmint` scope on npm. Soma repos published unscoped.

| Package | npm | What |
|---------|-----|------|
| `@1xmint/clawnet-sdk` | 1.0.0 | TypeScript SDK — orchestrate, skills, receipts, trust |
| `@1xmint/clawnet-mcp` | 1.0.0 | MCP server for Claude Code, Cursor, etc. |
| `@1xmint/clawnet-agentkit` | unpublished | Coinbase AgentKit actions (x402 native) |
| `@1xmint/clawnet-langchain` | unpublished | LangChain StructuredTool integration |
| `@1xmint/clawnet-elizaos` | unpublished | ElizaOS plugin (5 actions) |
| `@1xmint/clawnet-openai-agents` | unpublished | OpenAI Agents SDK function tools |
| `@1xmint/clawnet-vercel-ai` | unpublished | Vercel AI SDK tool factory |
| `soma-heart` | 0.1.1 | Soma execution runtime (provider-side) |
| `soma-sense` | 0.1.0 | Soma verification sensorium (observer-side) |

All integration packages expose: orchestrate, invoke skill, search, verify receipt.
AgentKit adds x402 USDC payment. ElizaOS adds Soma trust check.
