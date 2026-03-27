# ClawNet — CLAUDE.md
Always stage commit push after major changes.
Sovereign AI agent orchestration layer. Hono API on port 3402, SQLite WAL (better-sqlite3, raw SQL — no ORM), Redis L2 cache, Clerk auth, Stripe + USDC/Solana payments. Single-process Node on a VPS.

## Quick Reference

```bash
npm run dev          # Dev mode (tsx watch + .env)
npm run build        # Compile to dist/ (tsc --noCheck)
npm start            # Run compiled dist/index.js
npm run test:unit    # Vitest unit tests
npm run typecheck    # Type check only (no emit)
npm run mcp          # Start MCP server
```

**VPS:** `guardian-vps` (guardian@24.199.121.137), deploy with `deploy` alias.

## Stack Rules (CRITICAL — never deviate)

| Use               | NOT                         |
|-------------------|-----------------------------|
| Hono              | Fastify                     |
| npm               | pnpm                        |
| better-sqlite3    | Drizzle / any ORM           |
| Single flat repo  | Turborepo / monorepo        |
| Plain HTML (site/)| Vite / React SPA            |
| Clerk + Phantom   | Reown AppKit                |
| .env on VPS       | sops / systemd secrets      |
| libp2p + yamux    | @libp2p/node (doesn't exist)|

## Project Structure (210 .ts files)

```
src/
├── routes/        (67)  HTTP endpoints (Hono routers)
├── core/          (49)  Business logic, crons, execution engine
├── db/            (28)  26 domain files re-exported via index.ts barrel
├── utils/         (28)  Billing, payouts, masking, shutdown, email, crypto
├── middleware/    (11)  Auth (API key, Clerk, AID, admin), rate limit, signing
├── cache/          (5)  Smart cache v2 (L1 memory + L2 Redis)
├── integrations/   (5)  Telegram bot, ag0, agentkit
├── payments/       (5)  x402/MPP/LSAT payment verifiers
├── providers/      (3)  LLM (Anthropic/OpenAI), ClawAPIs x402, facilitator pool
├── mcp/            (3)  MCP tool server (10 tools)
├── config/         (2)  Zod env validation, API registry (274 endpoints)
├── sdk/            (1)  @clawnet/sdk TypeScript client
├── mesh/           (1)  libp2p DHT node
├── bots/           (1)  x-outreach (Twitter/X marketing)
site/              (25)  Static HTML website (not in src/)
tests/unit/        (12)  Vitest tests (185 passing)
```

## Orchestration Pipeline

```
POST /v1/orchestrate → parseIntent(query) → optimizePlan(intent, pricing)
  → executePlan(intent, budget?) → formatResponse() → bill credits
```

- **Budget:** `{ maxCredits?, strategy: cheapest|balanced|fastest|reliable }`
- **Cache hits** = 10% of live cost (min 0.1cr) — small cache fee, no call cost to caller or provider
- **Orchestration fee:** 2 credits per LLM-routed query (burned, not credited)
- `checkBudget()` returns 402 pre-flight if plan exceeds `maxCredits`

## Database Patterns

```typescript
// ALWAYS use getDb() — never store reference
const row = getDb().prepare('SELECT * FROM t WHERE id = ?').get(id);

// Transactions — note double parentheses
getDb().transaction(() => { /* ... */ })();

// Audit trail (fire-and-forget, never crashes caller)
logAudit({ entityType, entityId, action, actorId?, data? });
```

- **121 migrations** in `src/db/connection.ts` (v1–v121)
- **Adding a migration:** append `{ version: 122, sql: 'ALTER TABLE ...' }` to the `MIGRATIONS` array in `connection.ts`. Increment version. Runs automatically on next `initDb()`. No rollback support.
- **Barrel export** at `src/db/index.ts` — import from here, never from domain files directly
- Financial safety triggers on `credits`, `credit_cost`, `amount_credits` columns

## Billing Math (src/core/credits.ts)

```typescript
round6(n)                        // ALWAYS use — prevents floating-point drift
creditCostForEndpoint(ep)        // Explicit creditCost OR round6(max(0.001, cost * 1500))
creditsForExecution(steps, lookup) // Sum of live step costs (0 for cached/failed)
x402SurchargeCredits(usdAmount)  // 1:1 cost recovery → credited to clawhub-treasury
cacheCreditCost(liveCost)        // round6(max(0.1, liveCost * 0.10))
dynamicCreditCost(...)           // Surge (up to 5x) + volume discounts + off-peak
trustGatedCreditCost(...)        // AID trust tiers (0-30% discounts)
```

- **Credit rate:** CREDITS_PER_USD=1000 → $0.001/credit, fractional supported (min 0.001)
- **Revenue split:** 85% creator / 15% treasury (uses `round6()`, not `Math.floor()`)
- **Deduction guard:** `WHERE credits >= amount` + DB trigger
- **Delegated billing:** auth resolves child→parent, `deductCredit(parent)` then `trackDelegatedSpend(child)` across 20+ billing sites

## Auth (4 layers)

| Layer | Header | Usage |
|-------|--------|-------|
| API Key | `X-API-Key` (cn-...) | Most /v1/* routes (not all — some are public) |
| AID | `X-AID-DID` + `X-AID-PROOF` + `X-AID-TIMESTAMP` + `X-AID-NONCE` | Protocol-level Ed25519 auth (trust-gated pricing) |
| Clerk | `Authorization: Bearer` | Escrow, user endpoints |
| Admin | `X-Admin-Key` | /v1/admin/* (timing-safe SHA-256) |

**Middleware files (11):** auth, admin-auth, clerk-auth, aid-auth, aid-gateway, aid-verify, aid-enrich, aid-provider-proof, aid-verification-receipt, rate-limit, sign-response.

## Critical Gotchas

- **`round6()`** — use on ALL credit math, never raw floating-point
- **`maskApiKey()`** from `src/utils/mask.ts` — ALWAYS use, never `.slice()`
- **`trackDelegatedSpend()`** — must be called after every `deductCredit()`
- **x402 surcharge** — MUST credit `clawhub-treasury`, not burn
- **DB imports** — always from `src/db/index.ts`, never domain files directly
- **`clawhub-treasury` + `clawhub-official`** — auto-reactivated on startup
- **Composite skills** — max depth 3, max 10 leaf invocations, BFS cycle detection
- **Per-skill rate limit** — `checkSkillRateLimit()` uses `cacheIncr(key, 3600)`
- **Webhook HMAC** — `X-ClawNet-Signature` + `X-ClawNet-Timestamp` headers

## AID — Agent Identity Document

Self-sovereign agent identity with Ed25519 DIDs (`did:key:z...`), Merkle-anchored trust chains, and offline verification. Full plan in `x204` file.

**Key files:**
| File | What |
|------|------|
| `src/core/aid-builder.ts` | `generateAgentKeypair()`, `buildAIDDocument()`, `computeTrustScoreWithProof()`, `deriveCapabilities()` |
| `src/utils/aid-verifier.ts` | `verifyAIDDocument()` — offline verification, pure crypto |
| `src/utils/ed25519-signer.ts` | `signVC()`, `verifyVCSignature()` — platform Ed25519 signing (deterministic from `PLATFORM_SIGNING_SECRET`) |
| `src/utils/jcs.ts` | `jcsSerialize()`, `base58btcEncode/Decode()`, `validateMultibaseEd25519()` — shared crypto |
| `src/utils/crypto-agility.ts` | `aidHash()`, `verifySignature()`, `negotiateAlgorithm()` — post-quantum migration path |
| `src/core/merkle-anchor.ts` | `buildMerkleTree()`, `getMerkleProof()`, `verifyMerkleProof()` |
| `src/db/aid.ts` | AID key CRUD, trust snapshots, cross-platform attestations, capabilities |
| `src/db/attestations.ts` | `createAutoAttestation()` with `executionSteps[]` — three-layer trust lifecycle |
| `src/routes/aid.ts` | register, resolve, trust-chain, attest, capabilities, verify, export, rotate-key, did.json, trust, freeze, heartbeat, erasure |
| `src/middleware/aid-auth.ts` | AID-native protocol auth (Ed25519 signed requests, nonce replay detection) |

**Trust score formula (LIVE):**
```
score = successRate*40 + chainCoverage*25 + volume*20 + manifestAdherence*15
```

**Three-layer trust lifecycle:**
```
MANIFEST (intent, optional) → EXECUTION PROOF (evidence, auto) → ATTESTATION (outcome, auto)
All feed into trust score via attestation_stats table.
```

**Public trust API:** `GET /v1/aid/:did/trust` — free, no auth, rate-limited. Returns verdict (not exact score), attestation count, capabilities. The "credit bureau" endpoint.

## x402 Payment Layer (src/routes/x402-skills.ts, src/payments/)

Agents can invoke skills via x402 without an account. Payment verified on-chain before execution.

**Flow:** Agent → `POST /x402/skills/:id` (no payment) → 402 + offer → Agent pays → retries with `X-PAYMENT` header → facilitator verifies → execute → response + receipt.

**Facilitator pool:** Coinbase, PayAI, Skyfire — automatic failover with health tracking (60s cooldown).

**x402 client:** `clawApiCall()` in `src/providers/clawapis.ts` — outbound x402 calls to upstream endpoints using Solana wallet.

## Smart Cache v2 (src/cache/)

Three-layer: L1 memory (10k max, LFU eviction) → L2 Redis (gzip >1KB) → agent context (SQLite).

Features: content-hash validation, stale-while-revalidate, adaptive TTL, request coalescing, negative caching (30s), semantic key normalization (SOL↔sol↔Solana), startup preloading, background refresh queue, proportional pricing (10% of live).

## Cron Jobs (16 active)

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
| Index sync | periodic | AG0 index synchronization |
| Anchor | periodic | Merkle root Solana anchoring |
| AID snapshot | 4h | Merkle tree rebuild, capability refresh |
| Proof of life | periodic | AID heartbeat monitoring |
| Canary | periodic | Canary checks |
| Trust decay | periodic | Rating weight decay (10%/30 days) |

## Route Pattern

```typescript
import { Hono } from 'hono';
import { checkApiKey } from '../middleware/auth';

const router = new Hono();
router.post('/path', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  return c.json({ ok: true });
});
export { router };

// Error response — always include code
return c.json({ error: 'message', code: 'SNAKE_CASE_CODE' }, 4xx);
```

## 2-Wallet Architecture

| Wallet | Purpose | Env Var |
|--------|---------|---------|
| RECEIVING | Users send USDC | `SOLANA_RECEIVING_WALLET` (public only) |
| HOT WALLET | x402 calls + payouts | `SOLANA_PRIVATE_KEY` = `PLATFORM_PAYOUT_PRIVATE_KEY` |

Treasury sweep optional — with 2-wallet setup, treasury credits are pure profit.

## Key Files

| File | What |
|------|------|
| `src/index.ts` | Server entry, middleware stack, 16 cron startups |
| `src/db/connection.ts` | initDb(), getDb(), 121 migrations, logAudit() |
| `src/db/index.ts` | Barrel export of 26 domain DB files |
| `src/core/credits.ts` | round6(), all billing math, trustGatedCreditCost() |
| `src/core/executor.ts` | executePlan(), circuit breaker, cache |
| `src/core/pricing.ts` | optimizePlan(), checkBudget(), 4 strategies |
| `src/core/composite-executor.ts` | Output piping, parallel, conditionals, depth 3 |
| `src/core/aid-builder.ts` | AID document builder, trust score, capabilities |
| `src/cache/index.ts` | L1+L2, SWR, coalescing, negative cache |
| `src/core/soma.ts` | Soma Heart singleton, key bridging, genome |
| `src/providers/clawapis.ts` | x402 client, clawApiCall() + soma birth certificates |
| `src/providers/x402-facilitator.ts` | Facilitator pool (Coinbase/PayAI/Skyfire), failover |
| `src/utils/billing.ts` | trackDelegatedSpend() |
| `src/utils/mask.ts` | maskApiKey() (first4+last4) |
| `src/utils/solana-payout.ts` | sendSolanaUsdc(), balance checks |
| `src/utils/shutdown.ts` | SIGTERM/SIGINT, 15s drain |
| `src/utils/jcs.ts` | Shared JCS + base58btc + Ed25519 validation |
| `src/utils/crypto-agility.ts` | aidHash(), post-quantum migration path |
| `src/routes/api.ts` | POST /v1/orchestrate, GET /v1/estimate |
| `src/routes/aid.ts` | AID: register, resolve, trust, verify, export, rotate-key |
| `src/routes/x402-skills.ts` | x402 payment-gated skill invocation |
| `src/middleware/auth.ts` | checkApiKey, checkPermission, checkPolicy |
| `src/middleware/aid-auth.ts` | AID-native Ed25519 request auth |
| `x204` | AID protocol plan |
| `flow.md` | System flow document |

## Soma Heart (src/core/soma.ts)

Cryptographic data provenance via [soma-heart](https://github.com/1xmint/Soma). Every outbound x402 API call through `clawApiCall()` gets a birth certificate (data hash + Ed25519 signature + heartbeat chain entry).

**Key bridging:** Derives soma keypair from the same `PLATFORM_SIGNING_SECRET` SHA-256 seed as AID (`src/utils/ed25519-signer.ts`). Same Ed25519 key material, different DID encoding (soma: base64, AID: base58btc). AID DID (`did:web:api.claw-net.org`) is canonical.

**Integration points:**
- `src/core/soma.ts` — `initHeart()`, `getHeart()`, `getHeartSafe()`, `destroyHeart()`
- `src/providers/clawapis.ts` — `clawApiCall()` wraps fetch in `heart.fetchData()`, stores birth certificate via `getLastBirthCertificate()`
- `src/core/executor.ts` — `StepResult.birthCertificate`, `ExecutionResult.birthCertificates`
- `src/routes/api.ts` — `POST /v1/orchestrate` response includes `provenance` field when certificates exist
- `src/routes/well-known.ts` — `GET /.well-known/soma.json` exposes genome, both DIDs, heartbeat chain status

**Not used:** `heart.generate()`, seeds, behavioral modification (claw-net is an orchestrator, not an LLM agent).

## Testing

```bash
npm run test:unit           # 185 tests via Vitest (12 test files)
npm run test:unit:coverage  # With coverage
npm run typecheck           # tsc --noEmit (0 errors expected)
```

Tests in `tests/unit/` — credit, escrow, governance, skills, and more. Use `setupTestDb()` from `tests/unit/helpers/db.ts`.

## Environment

All env vars are Zod-validated in `src/config/index.ts`. See `.env.example` for the full list. Key vars:

- `PORT=3402`, `NODE_ENV`, `LOG_LEVEL`
- `ANTHROPIC_API_KEY`, `LLM_PROVIDER` (anthropic|openai|openclaw)
- `REDIS_URL`, `CACHE_TTL_SECONDS=300`
- `CLERK_SECRET_KEY`, `ADMIN_API_KEY` (required in prod, min 16 chars)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `SOLANA_RECEIVING_WALLET`, `SOLANA_PRIVATE_KEY`, `SOLANA_RPC_URL`
- `CREDITS_PER_USD=1000`, `COST_MARKUP_FACTOR=1500`, `ORCHESTRATION_FEE=2`
- `PLATFORM_SIGNING_SECRET` (deterministic Ed25519 key derivation for AID)
- `X402_RECIPIENT_ADDRESS` (enables x402 payment mode)
- `AG0_DISCOVERY_ENABLED`, `INDEX_SYNC_ENABLED`, `MERKLE_ANCHOR_ENABLED` (feature flags)
- `SENTRY_DSN` (optional), `RESEND_API_KEY` (optional)

## Workflow

Always stage, commit, and push after considerable changes. User SSHs to VPS and types `deploy`.
