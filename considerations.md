# Considerations — Deferred Features & Strategic Decisions

Features researched but deferred from immediate implementation. Revisit as the platform matures.

## 1. ERC-8004 On-Chain Identity Registration

**What:** Register ClawNet as an agent on Ethereum's ERC-8004 Identity Registry (NFT-based agent ID, on-chain reputation, validation registry).

**Why defer:**
- ERC-8004 is EVM-native (Ethereum/Base). ClawNet is on Solana for payments.
- Registering requires deploying/interacting with Ethereum smart contracts — adds complexity.
- The standard is still maturing (v2 spec in progress as of March 2026).
- Our existing trust signals (avgRating, successRate, verified, SLA contracts, penalty tiers) cover the same ground off-chain.

**When to revisit:**
- When ERC-8004 gains Solana support or a cross-chain bridge emerges
- When agent interoperability becomes a growth blocker
- When we need verifiable, cross-platform reputation (e.g., to be listed on 402bot's provider directory)

**Effort:** 2-3 days for basic registration, 1-2 weeks for full reputation integration.

## 2. Base Chain Payment Support (Multi-Chain x402)

**What:** Accept x402 payments on BOTH Base (EVM) and Solana simultaneously.

**Why defer:**
- Our x402 provider mode already works on Base via `@x402/hono` middleware.
- Adding Solana x402 requires `x402-solana` integration on the server side (we currently only use it as a client).
- Multi-chain complicates facilitator management and receipt tracking.
- Base alone covers the largest x402 volume (~75M+ transactions combined with Solana).

**When to revisit:**
- When Solana x402 volume exceeds Base
- When agents request Solana-native x402 access
- When the x402 v2 CAIP standard makes multi-chain trivial

**Effort:** 1-2 days.

## 3. Polymarket / Prediction Market Integration

**What:** 402bot has direct Polymarket integration (place orders, track performance, portfolio analytics).

**Why defer:**
- Niche use case — prediction markets are a small segment of our user base.
- Regulatory concerns around facilitating prediction market trading.
- Our orchestration engine can already route to prediction market APIs if endpoints exist in the registry.

**When to revisit:**
- When prediction markets become mainstream for AI agents
- When users specifically request this

**Effort:** 1-2 days.

## 4. Nookplot / DID Integration

**What:** 402bot integrates with Nookplot for decentralized identity (DID) and agent discovery.

**Why defer:**
- Nookplot is a small, emerging protocol — unclear adoption trajectory.
- Our `.well-known` discovery files achieve similar discoverability without DID dependency.
- DID standards are fragmented (did:web, did:key, did:nookplot, etc.).

**When to revisit:**
- When a dominant DID standard emerges in the AI agent space
- When cross-platform agent discovery becomes critical

**Effort:** 1 day.

## 5. Innernet Integration

**What:** 402bot uses Innernet as a "contextual onchain conversation surface" for agent-to-agent discovery.

**Why defer:**
- Very early-stage protocol.
- Our existing discovery engine (semantic search + P2P mesh + staking boost) provides robust discovery.
- Adding another discovery surface adds maintenance burden.

**When to revisit:**
- When Innernet reaches meaningful adoption
- When we need Base-chain-native discovery

**Effort:** 1 day.

## 6. Campaign Attribution / Referral Tracking

**What:** 402bot uses `?campaignId=` parameters on MCP URLs to track which integration brought which agent.

**Why partially defer:**
- We already have a referral system (currently disabled in code).
- Campaign tracking for MCP connections would require session-level attribution.
- Low priority until MCP adoption is significant.

**What we DID implement:**
- Agent referral system exists (disabled, ready to re-enable).

**When to revisit:**
- When MCP server has >100 daily connections
- When we need attribution for partnership deals

**Effort:** 2-4 hours.

## 7. Wallet-Based Identity / Sessions (x402 v2)

**What:** x402 v2 supports wallet-based identity where a client authenticates once and makes subsequent requests without repeating the full payment handshake.

**Why defer:**
- Our existing API key + session system provides this functionality.
- x402 v2 wallet sessions are designed for high-throughput scenarios we haven't hit yet.
- Would require upgrading `@x402/hono` and `@x402/core` to their latest v2 APIs.

**When to revisit:**
- When x402 call volume exceeds 1000/day
- When agents complain about per-request payment latency

**Effort:** 1 day.

## 8. Upstream Proxy Routes

**What:** 402bot proxies upstream providers (Allium, Dune, Zapper) through its own paid endpoints, adding value through normalization and caching.

**Why partially defer:**
- Our endpoint auto-discovery already polls 344+ endpoints from clawapis.com.
- Adding dedicated proxy routes for specific providers creates maintenance burden.
- Our orchestration engine already handles routing to the best provider.

**What we DID implement:**
- Data skills with `api_proxy` type already proxy upstream APIs.
- Output normalizer provides standardized response formats.

**When to revisit:**
- When specific providers request dedicated integration
- When we need provider-specific caching or transformation

**Effort:** Variable per provider.

## 9. Gasless x402 Payments (Facilitator-Sponsored Gas)

**What:** The x402 facilitator can sponsor gas costs so payers don't need native tokens (SOL/ETH) for fees.

**Why defer:**
- Currently using Coinbase CDP facilitator which handles gas sponsorship automatically.
- On Base, gas is already < $0.001 per tx — marginal benefit.
- Would only matter for Solana x402 (SOL gas ≈ $0.00025).

**When to revisit:**
- When we add Solana-side x402 provider mode
- When agents explicitly report gas as a friction point

**Effort:** Configuration only (facilitator handles it).

## 10. Research Planner (Pre-Hire Planning)

**What:** 402bot has a Gemini-assisted "Research Planner" that helps users plan before hiring an agent.

**Why defer:**
- Our `GET /v1/estimate` endpoint already provides cost estimation.
- Our orchestration engine's `parseIntent` → `optimizePlan` already does plan optimization.
- Adding an AI-assisted pre-planning step adds latency and LLM cost.

**What we already have:**
- `/v1/estimate` — pre-flight cost estimation
- `checkBudget()` — 402 pre-flight if plan exceeds maxCredits
- 4 strategy options (cheapest, balanced, fastest, reliable)

**When to revisit:**
- When users request explicit plan preview before execution
- When composite skills need cost breakdown before running

**Effort:** 4-8 hours.

## 11. ERC-8183: Agentic Commerce Protocol (On-Chain Escrow)

**What:** ERC-8183 ("Agentic Commerce") is a new Ethereum standard (submitted March 10, 2026) by Virtuals Protocol + Ethereum Foundation. Defines an on-chain escrow protocol for trustless agent-to-agent commerce with Client/Provider/Evaluator roles, a 4-state job lifecycle (Open→Funded→Submitted→Terminal), and Hook extensibility.

**Why defer:**
- Our existing escrow system (`src/db/escrow.ts`) already implements a 7-state machine that covers the same ground off-chain.
- Our validator system (`src/db/validations.ts`) serves the same role as ERC-8183's Evaluator.
- Our cryptographic receipts (`src/utils/receipt-hash.ts`) provide deliverable hashing similar to ERC-8183's `bytes32` deliverable references.
- The standard is only days old — no reference implementations or SDKs exist yet.
- On-chain escrow adds gas costs and latency vs our instant off-chain credit system.

**Parallels (we're already ERC-8183-compatible in spirit):**

| ERC-8183 | ClawNet Equivalent |
|---|---|
| Job (Client/Provider/Evaluator) | 7-state escrow system |
| Escrowed funds + conditional release | `deductCredit()` + escrow flow |
| Evaluator role | Validator system |
| Deliverable hash (bytes32) | SHA-256 receipts |
| Hook extensibility | Webhook system |
| Reputation from completed jobs | Trust signals (avgRating, successRate) |

**When to revisit:**
- When ERC-8183 has a reference implementation and SDK
- When agents demand on-chain settlement for high-value jobs
- When Virtuals Protocol or other platforms adopt it and we need interoperability

**Effort:** 2-3 days for basic on-chain settlement bridge, 1-2 weeks for full integration.

## 12. FHE Confidential Payments (Mind Network x402z)

**What:** Fully Homomorphic Encryption for agent-to-agent payments. Amounts, sender balances, and commercial intent are never revealed. Mind Network validators process encrypted payment data and compute state changes without decryption.

**Why defer:**
- Built on x402z protocol + ERC-7984 standard — not finalized yet.
- Testnet launched Jan 2026, mainnet targeted Q3 2026.
- Requires specialized FHE compute infrastructure we don't have.
- Our payment data is already private (off-chain credit system) — this mainly benefits on-chain x402 payments.

**When to revisit:**
- When Mind Network reaches mainnet (Q3 2026)
- When agent privacy becomes a customer requirement
- When x402z has SDK support for Solana

**Effort:** 1-2 weeks for integration once SDK is available.

## 13. Token Gateway — Accept Any Token

**What:** Accept SOL, ETH, or any SPL/ERC-20 token as payment, auto-swap to USDC via Jupiter (Solana) or Uniswap (EVM) before crediting the user's account.

**Why defer:**
- Adds DEX integration complexity (Jupiter SDK, slippage handling, failed swaps).
- Regulatory risk — auto-swapping tokens may trigger money transmitter rules.
- Current USDC-only model is simpler and more predictable.
- PayAI has this as "coming soon" too — it's not trivial.

**When to revisit:**
- When agents frequently request non-USDC payment
- When Jupiter/Uniswap x402 integrations mature
- When regulatory clarity improves

**Effort:** 2-3 days for basic Jupiter integration, 1 week for production-grade with error handling.

## 14. ElizaOS Plugin

**What:** Create a ClawNet plugin for ElizaOS (the popular open-source AI agent framework). Agents built on ElizaOS could discover and invoke ClawNet skills natively.

**Why defer:**
- ElizaOS is one of many agent frameworks — investing heavily in one risks lock-in.
- Our MCP server already works with any MCP-compatible host (Claude, Cursor, Codex).
- PayAI has an ElizaOS plugin (25 GitHub stars) — we could build one if demand warrants.

**When to revisit:**
- When ElizaOS becomes dominant (>50% market share of agent frameworks)
- When users specifically request ElizaOS integration

**Effort:** 2-3 days.

## 15. CT Agent Monetization (Crypto Twitter)

**What:** PayAI has a product where AI agent accounts on Twitter/X can sell custom content (market analyses, project reviews) via x402 micropayments.

**Why defer:**
- Niche use case targeting crypto Twitter influencer bots.
- Requires Twitter API integration (rate limits, costs, ToS compliance).
- Not aligned with our core orchestration mission.

**When to revisit:**
- When we have a social media integration strategy
- When demand for AI-generated crypto content monetization grows

**Effort:** 1-2 weeks.

## 16. On-Chain Escrow (Anchor/Solana Smart Contracts)

**What:** Move escrow from off-chain SQLite to on-chain Solana smart contracts (Anchor framework), similar to PayAI's approach.

**Why defer:**
- Our 7-state SQLite escrow is faster (instant vs blockchain confirmation time).
- On-chain escrow adds gas costs per operation.
- Off-chain gives us more flexibility for dispute resolution and state transitions.
- On-chain is more trustless but our validator system provides trust guarantees.

**When to revisit:**
- When agents demand trustless escrow (no trust in ClawNet as intermediary)
- When Solana gas costs become negligible
- When cross-platform escrow interoperability is needed

**Effort:** 1-2 weeks for Anchor contract + integration.

## 17. OrbitDB / IPFS Service Listings

**What:** PayAI stores agent service listings on IPFS with OrbitDB for decentralized discovery. Services are censorship-resistant and don't depend on a central server.

**Why defer:**
- Our centralized SQLite marketplace with semantic search provides better discovery UX.
- IPFS adds latency for reads and requires pinning infrastructure.
- We already have libp2p mesh for P2P discovery.
- Decentralized storage is valuable but premature at our scale.

**When to revisit:**
- When censorship resistance becomes a requirement
- When we need cross-platform skill sharing (skills discoverable outside ClawNet)
- When IPFS performance improves

**Effort:** 3-5 days for IPFS integration + OrbitDB node.

## 18. WURK-Style Human-in-the-Loop Marketplace

**What:** AI agents can hire humans for tasks they can't do autonomously (feedback, opinions, verification, social engagement). WURK offers 25+ human micro-task services via x402.

**Why defer:**
- Requires building or integrating a human labor marketplace — significant operational complexity.
- Quality control for human workers needs moderation infrastructure.
- We added WURK as an endpoint in our API registry — agents can access it through orchestration.

**What we DID implement:**
- WURK API endpoints added to API registry (3 endpoints).
- Agents can hire humans through ClawNet's orchestration by routing to WURK endpoints.

**When to revisit:**
- When autonomous agent tasks frequently require human verification
- When WURK or similar services offer SDK integration

**Effort:** 1 week for native integration, or use WURK via existing API registry.

## 19. SIWX (Sign-In-With-X) — Wallet-Based Auth Layer

**What:** Add wallet-based authentication as a 4th auth layer (alongside API Key, Clerk, Admin). Uses CAIP-122/EIP-4361/Sign-In-With-Solana standards. Wallets that have paid via x402 can sign in to access content they already paid for, maintain persistent sessions, and track spending history — all without an API key.

**Why defer:**
- Need x402 users first. No point building wallet identity for an audience that doesn't exist yet.
- Requires `tweetnacl` new dependency for Solana ed25519 verification (EVM covered by existing `viem`).
- Adds complexity to auth middleware (`checkApiKeyOrWallet` combined middleware).
- The x402 SIWX extension (`@x402/extensions/sign-in-with-x`) may not be fully published yet.

**Implementation plan (when ready):**
- New middleware `src/middleware/siwx-auth.ts` — verify EVM sigs via `viem/siwe`, Solana sigs via `tweetnacl`
- New routes `src/routes/siwx.ts` — challenge/verify/session/refresh/link endpoints
- New DB `src/db/wallets.ts` — wallet_sessions + wallet_key_links tables (migration v76)
- Wallet resolves to synthetic API key internally (all billing/session infra works unchanged)
- `checkApiKeyOrWallet` combined middleware for routes accepting either auth
- Capture `payer_address` in x402_receipts (currently always null)
- SIWX bypass: wallet that already paid for a skill skips re-payment

**When to revisit:**
- When x402 payment volume justifies repeat-access optimization
- When $CLAWNET token is approaching launch (wallet identity needed for token payments)
- When agent-to-agent commerce requires persistent wallet identity

**Effort:** 2-3 days. New dep: `tweetnacl`.

## 20. Permit2 Multi-Token x402 Payments (ERC-20 + $CLAWNET Prep)

**What:** Accept ANY ERC-20 token for x402 skill payments via Uniswap's Permit2 contract. Key tokens: USDC (existing, EIP-3009), EURC (Permit2), $CLAWNET (Permit2, when launched). Includes token-to-credit conversion, auto-swap to USDC, and revised token economics.

**Why defer:**
- $CLAWNET token doesn't exist yet. Building multi-token rails for a future token is premature.
- EURC demand is unproven — no evidence agents want to pay in EUR stablecoin.
- Requires upgrading from @x402/hono V1 API (`paymentMiddlewareFromConfig`) to V2 (`paymentMiddleware` + `x402ResourceServer` with registered schemes).
- Requires new deps: `@uniswap/permit2-sdk`, `@uniswap/v3-sdk`, `@uniswap/sdk-core`.
- Adds significant complexity: token pricing oracle, slippage handling, DEX swap execution, multi-token receipt tracking.
- High risk: smart contract interaction, MEV exposure, volatile token price manipulation.

**Implementation plan (when ready):**
- Token registry `src/config/token-registry.ts` — accepted tokens with conversion rates
- Token pricing `src/utils/token-pricing.ts` — USDC hardcoded, EURC from ECB, $CLAWNET from DEX TWAP
- Permit2 utils `src/utils/permit2.ts` — signature verification, transfer execution
- Multi-token payout `src/utils/evm-multi-token-payout.ts` — generalized ERC-20 transfers
- Routes `src/routes/permit2-payment.ts` — quote/execute/status endpoints
- Expand `x402_receipts` with token_symbol, token_address, token_amount columns
- `accepts` array in x402 middleware config (one PaymentOption per enabled token)
- Creator payout preference: $CLAWNET (with 5% bonus) or USDC (auto-swap)

**$CLAWNET discount:** 10% cheaper than USDC to incentivize token usage.

**Revised token economics for $CLAWNET-denominated revenue:**
- 50% burn (was 40% — buyback step eliminated since already holding token)
- 0% buyback (eliminated)
- 30% DAO treasury (was 20%)
- 20% staker rewards (was 15%)

**Staking tiers (future):**
| Tier | Staked | Fee Discount | Rate Boost | Payout Bonus |
|------|--------|-------------|------------|-------------|
| Bronze | 1K | 5% | 1.5x | 0% |
| Silver | 10K | 10% | 2x | 2% |
| Gold | 50K | 15% | 3x | 5% |
| Diamond | 200K | 20% | 5x | 10% |

**Token addresses (Base Mainnet):**
- USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- EURC: `0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42`
- Permit2: `0x000000000022D473030F116dDEE9F6B43aC78BA3`
- $CLAWNET: TBD

**When to revisit:**
- 2 weeks before $CLAWNET token launch
- When EURC demand is validated by user requests
- When x402 payment volume exceeds $1K/month (justifies multi-token infra)

**Effort:** 3-5 days. Build 2 weeks before token launch, not months before.

## 21. A2A (Agent-to-Agent) Protocol Support

**What:** Add Google's A2A protocol (v0.3.0) alongside MCP. A2A standardizes agent-to-agent task delegation — agents discover each other via `/.well-known/agent-card.json` and delegate tasks via `message/send` (JSON-RPC). Makes every ClawNet skill discoverable by AWS Bedrock, Google ADK, Azure, LangChain, Salesforce, and 100+ other A2A adopters.

**Why do it:**
- 100-150+ organizations already support A2A (Google, AWS, Microsoft, Salesforce, SAP, LangChain, etc.)
- Official `@a2a-js/sdk` has **native Hono support** (`A2AHonoApp`) — plug-and-play for ClawNet's stack
- ClawNet's orchestration pipeline (`parseIntent -> optimizePlan -> executePlan`) maps 1:1 to A2A's task model
- Competitors Questflow and Daydreams already support A2A
- MCP handles tool access; A2A handles agent collaboration — complementary, not competing

**Implementation plan:**
1. `npm install @a2a-js/sdk` (1 new dependency)
2. Reformat `/.well-known/agent-card.json` to A2A AgentCard spec (name, url, version, protocolVersions, capabilities, skills array with AgentSkill objects, authentication)
3. Create `src/routes/a2a.ts` — JSON-RPC endpoint handling `message/send`, `message/stream`, `tasks/get`, `tasks/cancel`
4. Map incoming A2A messages to ClawNet's `orchestrate` or `invoke-skill` based on target skill
5. Return results as A2A `Task` objects with proper state transitions (submitted→working→completed/failed)
6. Support streaming via SSE (`message/stream`) — ClawNet already has SSE infrastructure
7. Map ClawNet skills to A2A skills in the agent card
8. Auth bridging: declare API key auth in agent card's securitySchemes

**When to do:** NOW — highest competitive impact per effort hour.

**Effort:** 2-3 days.

## 22. Zero-Auth Discovery Routes

**What:** Open read-only discovery routes so agents can browse ClawNet's skill catalog and endpoint registry without an API key. Currently most `/v1/*` routes require `checkApiKey`. 402.bot, Agoragentic, and Blockrun all allow zero-friction discovery. This is the biggest onboarding friction for agent-to-agent adoption.

**Routes to make public (no auth):**
- `GET /v1/skills` — browse marketplace (already partially public for marketplace browsing)
- `GET /v1/skills/:id` — skill details including pricing, trust signals, SLA
- `GET /v1/registry` — full endpoint catalog (344+ endpoints) — ALREADY has no auth middleware
- `GET /v1/registry/health` — endpoint status dashboard
- `GET /v1/estimate` — cost estimation (dry-run, no credits consumed)
- `GET /v1/skills/:id/mcp` — MCP tool manifest per skill
- `GET /v1/skills/:id/openapi` — OpenAPI spec per skill

**Keep auth on:** All execution routes (orchestrate, invoke, batch, stream, swarm), economy routes (transfer, keys, escrow), admin routes, creator routes.

**When to do:** NOW — half day, removes the #1 friction point for agent discovery.

**Effort:** Half day. Remove `checkApiKey` middleware from the listed GET routes.

## 23. Token Savings Tracking in Responses

**What:** Add a `tokensSaved` field to every orchestration and skill invocation response showing how many LLM tokens the cache/orchestration saved vs raw API calls. 402.bot tracks this aggressively (claims 58M cumulative tokens saved) and it's their best marketing metric.

**Implementation:**
1. In `executePlan()` (`src/core/executor.ts`), track per-step: estimated raw tokens (from endpoint metadata) vs actual tokens consumed
2. Cache hits count full token savings (the entire step was free)
3. Add to response: `{ tokensSaved: 148000, costWithoutClawNet: "$0.014", costWithClawNet: "$0.003" }`
4. Accumulate in a platform-wide counter for the stats dashboard (`GET /v1/stats/telemetry`)
5. Display in the `/v1/auth/usage` response for per-user tracking

**Why:** Proves ClawNet's value in hard numbers. "ClawNet saved you 148K tokens and $0.011 on this query" is more compelling than "your query cost 3 credits."

**When to do:** NOW — half day, powerful marketing metric.

**Effort:** Half day.

## 24. API Registry Expansion (22 → 50+ x402engine endpoints)

**What:** x402engine now has 68 endpoints but ClawNet only registers 22 in `src/config/api-registry.ts`. Missing endpoints include:
- **Crypto data:** price feed ($0.001), market data ($0.002), historical data ($0.003), trending ($0.001), coin search ($0.001), token metadata ($0.002), ENS resolve/reverse ($0.001) — all very cheap
- **Newer LLMs:** GPT-5.3 Codex, GPT-5.4 Pro, Kimi K2.5, additional Llama/Qwen/Mistral variants
- **Web content fetch** (up to 10 URLs for $0.005) — cheaper than Jina for bulk
- **MegaETH support** — 10ms confirmation vs ~2s on Base, would reduce x402 payment latency dramatically

Also consider registering Agoragentic as a **seller** on their marketplace (they offer 97/3 revenue split vs our 85/15 — we'd keep more selling through them as a distribution channel).

**When to do:** Soon — half day, more endpoints = more value for orchestration.

**Effort:** Half day (add endpoints to api-registry.ts, update endpoint-health-cron samples).

## 25. Multi-Facilitator x402 Support

**What:** Add PayAI and Dexter as fallback x402 facilitators alongside Coinbase's. Currently ClawNet uses a single facilitator chain (configured URL → x402.org → facilitator.x402.org → payai.network). Formalizing multi-facilitator support adds:
- **Reliability:** If Coinbase's facilitator is down, automatically fail over to PayAI or Dexter
- **Multi-chain:** PayAI covers 7 chains (Solana, Base, Polygon, Avalanche, Sei, IoTeX, SKALE). Dexter covers 6 chains + SKALE (zero-gas)
- **Cost:** PayAI charges $0.001/tx (first 1K free). Dexter is free. Coinbase's pricing is opaque.
- **Speed:** Dexter has overtaken Coinbase as #1 facilitator (50% market share, 25M+ settlements)

**Implementation:**
1. Update `src/routes/x402-skills.ts` facilitator chain to explicitly try multiple facilitators in priority order
2. Add env vars: `X402_FACILITATOR_URLS` (comma-separated, replaces single URL)
3. Health-check facilitators periodically and route to the fastest healthy one
4. Add facilitator selection to `GET /v1/stats/telemetry` for monitoring
5. Consider offering Solana-native x402 via Dexter (currently Base-only via Coinbase)

**When to do:** When x402 volume grows beyond testing. Currently ~$28K daily volume across the entire protocol — not urgent.

**Effort:** 1 day.

## 26. Social Proof / Usage Stats in Docs

**What:** Add real usage metrics to docs.html — active agents, API calls processed, skills registered, etc.

**Why defer:**
- Need real users first. Fake/inflated metrics destroy trust immediately.
- The comparison table and technical depth serve as social proof until real adoption data exists.
- Once 100+ active agents exist, add a live counter pulling from `/v1/stats/roadmap` or similar.

**Trigger to revisit:** 100+ active API keys with >10 calls each.

**Effort:** 2 hours (add a stats banner to docs pulling from the existing `/v1/stats/roadmap` endpoint).

## 27. Rate Limits Per Tier in Docs

**What:** Document differentiated rate limits per API key tier (free, starter, pro, enterprise).

**Why defer:**
- Currently one tier: 60 req/min per IP for all keys.
- This is a product decision, not a docs task — need to define the tiers first.
- Adding "coming soon" tiers to docs is worse than saying nothing.
- When paid tiers are introduced, document them alongside the pricing page update.

**Trigger to revisit:** When a second rate limit tier is implemented in `src/middleware/rate-limit.ts`.

**Effort:** 1 hour (docs update only, after the product decision is made).

---

*Last updated: 2026-03-18*
*Based on Artemis Agentic Commerce Market Map analysis (173 companies) — competitive research against 402.bot, Questflow, OpenServ, Blockrun, Dexter, Daydreams, PayAI, Virtuals Protocol, Bittensor, x402engine, Agoragentic, ClawIndex, x402scan, Helixa, Cred Protocol.*
