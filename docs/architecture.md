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
| `src/routes/soma.ts` | Soma verdict API + receipt lookup |
| `src/routes/x402-skills.ts` | x402 payment-gated skill invocation |
| `src/middleware/auth.ts` | checkApiKey, checkPermission, checkPolicy |
| `src/middleware/soma-provenance.ts` | X-Soma-* provenance headers on all responses |

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
- `SENTRY_DSN` (optional), `RESEND_API_KEY` (optional)
