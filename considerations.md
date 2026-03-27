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

**Status:** IN PROGRESS — building now. Highest competitive impact per effort hour.

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

## 28. Org-Level Identity for API Keys

**What:** Add optional `org_id` field to API keys so multiple keys/agents can be grouped under one organization. Sellers on the marketplace see "Company X" instead of individual masked keys.

**Why defer:**
- Org identity standards for AI agents are still emerging (Anon, Billions/KYA, t54 all building competing approaches).
- ClawNet's current key + delegated key + attestation stack already provides 80% of org accountability.
- Building a proprietary org identity system risks being incompatible with whatever standard wins.
- The right move is to be compatible when standards mature, not build ahead of them.

**What to watch:**
- Anon (@AnonPlatform) — building org identity for agents, big announcement pending.
- ERC-8004 — on-chain agent identity registry (EVM-native).
- KYA standards — "Know Your Agent" becoming regulatory expectation per a16z/PYMNTS.
- **Skyfire KYA** — Skyfire's "Know Your Agent" implementation is emerging as a de facto standard for agent identity verification. Combines wallet identity + usage history + org attestation. Worth tracking as the leading KYA implementation.
- **ERC-8004 update** — ERC-8004 is gaining traction as the on-chain identity layer that KYA standards reference. If ERC-8004 + Skyfire KYA converge, that becomes the standard to implement.

**When to build:**
- When 2+ agent frameworks (LangChain, CrewAI, ElizaOS) ship org identity support by default.
- Or when a paying customer specifically requests org grouping for their delegated keys.

**Implementation sketch:**
- Add `org_id TEXT` + `org_name TEXT` to `api_keys` table.
- Group delegated keys under org in `GET /v1/economy/keys/delegated`.
- Show org name (not just masked key) to marketplace sellers.
- Accept external org identity tokens (Anon, KYA) as optional auth enrichment.

**Effort:** 1-2 days for the DB + API changes. Integration with external identity providers depends on their SDK maturity.

## 29. MPP (Machine Payments Protocol) Integration

**What:** Add MPP as a second keyless payment protocol alongside x402. MPP adds session-based spending caps and fiat fallback via Stripe.

**Why defer:**
- MPP launched 2026-03-18 on Tempo L1 — day 1, unproven in production.
- Tempo L1 is new and unclear how decentralized/permissionless it actually is.
- MPP's "sessions" feature is already solved by ClawNet's credit system (buy once, spend unlimited, sub-ms settlement).
- ClawNet's payment abstraction layer (`src/payments/`) already has an MPP stub ready to implement.

**When to build:**
- When agent frameworks ship MPP wallet support by default (LangChain, CrewAI, etc.).
- Or when MPP daily transaction volume exceeds $100K (currently near zero).
- Implementation is ~1 week thanks to the payment gateway abstraction.

**Effort:** 1 week (implement `MppVerifier` in `src/payments/mpp-verifier.ts`).

## 30. Lightning/LSAT Payment Support

**What:** Add Lightning Network LSAT (Lightning Service Authentication Tokens) as a keyless payment option for Bitcoin-native agents.

**Why defer:**
- Lightning LSAT adoption among AI agents is extremely small.
- BTC price volatility makes it unsuitable as a primary commerce rail for a platform pricing in USD-pegged credits.
- The Bitcoin-maximalist agent builder audience exists but is not large enough to justify proactive investment.
- Payment abstraction layer already has an LSAT stub (`src/payments/lsat-verifier.ts`).

**When to build:**
- Only if a significant customer or partnership specifically requires Lightning payments.
- Or if Lightning LSAT transaction volume among AI agents reaches meaningful levels.
- Implementation is ~1 week thanks to the payment gateway abstraction.

**Effort:** 1 week (implement `LsatVerifier` in `src/payments/lsat-verifier.ts`).

## 31. Free Trial Tier for Agent Onboarding

**What:** Give new API keys 1-5 free credits on creation so agents can try ClawNet (especially Manifest) without buying credits first.

**Why consider:**
- The Anon article argues: "if the first thing an agent encounters is a payment wall, you've eliminated your own top of funnel."
- x402 solves this for wallet-holding agents, but non-crypto agents (the majority) still need to buy credits before their first call.
- A small free trial (5 credits = $0.005) removes the last friction point.

**Why defer:**
- Risk of abuse (bots creating keys for free credits).
- Need rate limiting per IP/email on key creation first.
- Current signup flow via Clerk + dashboard works for serious users.

**When to build:** When user acquisition becomes the priority (post-launch, when the product is proven).

**Effort:** 2 hours (add `topUpCredits(key, 5)` after key creation in `src/db/keys.ts`).

## 32. Multi-Chain USDC for x402 Keyless Access

**What:** Accept x402 payments in USDC on Ethereum mainnet (and potentially Arbitrum, Polygon, Optimism) in addition to Base.

**Why defer:**
- Already support 2 chains: Solana USDC (credit top-ups) + Base USDC (x402 keyless).
- Ethereum mainnet gas fees ($0.50-5) make micropayments irrational — agents already use Base for cheap txs.
- Agents on Ethereum are migrating to L2s (Base, Arbitrum) organically.
- Adding each chain = new `KeylessPaymentVerifier` implementation (~1 week each).
- Payment gateway abstraction makes this trivial to add later.

**When to build:** When a specific chain's agent ecosystem grows large enough that agents can't/won't bridge to Base. Arbitrum or Polygon are more likely candidates than Ethereum mainnet.

**Effort:** 1 week per chain (new verifier implementing `KeylessPaymentVerifier` interface).

## 33. Virtual Agent Cards (machines.cash, lobster.cash, Clawcard.sh)

**What:** Virtual credit cards for agents to pay traditional SaaS/APIs that don't accept crypto.

**Why defer:**
- Niche use case. ClawNet's x402 + Stripe covers the primary payment rails.
- Most agent-to-agent commerce is on-chain or API-based — very few target APIs only accept card payments.
- machines.cash and lobster.cash are early-stage with limited adoption data.

**When to revisit:**
- If >20% of skill invocations fail because target APIs only accept card payments
- If a significant number of user requests specifically mention card-only APIs

**Implementation:** Add machines.cash or lobster.cash as a marketplace skill, not core infrastructure. This is a skill-level integration, not a platform change.

**Effort:** 1-2 days to integrate as a skill (not core).

## 34. ZK Privacy Payments (ClawPay / Railgun)

**What:** Zero-knowledge privacy layer for agent transactions using Railgun ZK pool.

**Why defer:**
- Premature — most agents don't need payment privacy.
- Regulatory risk — ZK payment privacy is under active regulatory scrutiny.
- ClawPay is very early (meme-adjacent tokens, unclear technical maturity).
- ClawNet's off-chain credit system already provides payment privacy by default (only ClawNet sees internal credit movements).

**When to revisit:**
- If enterprise customers request privacy-preserving payments
- If Railgun/ZK tech matures significantly and regulatory clarity improves
- If on-chain payment privacy becomes a competitive requirement

**Effort:** 1 week (new payment verifier + ZK proof verification).

## 35. No-Code Agent Builder (OpenServ pattern)

**What:** Visual/no-code interface for creating and deploying agents.

**Why defer:**
- ClawNet's strength is developer-first API platform. No-code dilutes positioning and requires significant frontend investment.
- OpenServ's token collapsed -90% suggesting the no-code agent market isn't mature.
- Building a visual agent builder is an entirely different product surface — drag-and-drop UI, template library, preview/test, deployment pipeline.
- Better to be the best API platform than a mediocre no-code platform.

**When to revisit:**
- If market consolidates and no-code becomes table stakes for agent platforms
- If a partnership opportunity arises to embed ClawNet as the backend for an existing no-code builder

**Effort:** 2-4 weeks (full builder UI).

## 36. Decentralized Compute / Inference (Heurist pattern)

**What:** Decentralized GPU marketplace for LLM inference.

**Why defer:**
- ClawNet routes to Anthropic/OpenAI — centralized providers are more reliable, faster, and have better quality.
- Building a compute layer is a different business entirely (GPU procurement, scheduling, model hosting).
- Decentralized inference quality hasn't caught up to centralized providers for production workloads.
- Heurist and similar projects are interesting but serve a different market (cost-sensitive, censorship-resistant inference).

**When to revisit:**
- If centralized LLM providers become too expensive or restrictive
- If decentralized inference quality catches up to centralized providers
- If we need censorship-resistant inference for specific use cases

**Implementation:** Would integrate as an LLM provider option in `src/providers/llm.ts`, not build compute infrastructure. Add Heurist/similar as a `LLM_PROVIDER` option.

**Effort:** 1-2 days to add as LLM provider option (not building compute infra).

## 37. Multi-Facilitator x402 with PayAI

**What:** Support multiple x402 facilitators (PayAI, Coinbase, Dexter, others) for multi-chain x402 payments.

**Why defer:**
- ClawNet currently uses Coinbase x402 on Base/Solana. PayAI adds Polygon, Avalanche, Sei, IoTeX.
- Not urgent until demand exists on those chains.
- §25 already covers multi-facilitator support in detail — this entry focuses specifically on PayAI as a facilitator.
- PayAI charges $0.001/tx (first 1K free) — competitive but not compelling enough to prioritize.

**When to revisit:**
- If users request x402 on Polygon/Avalanche/Sei
- If PayAI becomes the dominant facilitator (currently Dexter leads at ~50% market share)
- If Coinbase facilitator has reliability issues

**Effort:** 1-2 days (add facilitator abstraction in `src/payments/`). See §25 for full implementation plan.

## 38. Outcome-Based Pricing (Nevermined pattern)

**What:** Charge only when agent delivers verified results, not per-call.

**Why defer:**
- Requires defining "success" per endpoint/skill — complex metering and validation.
- ClawNet's per-call + cache pricing is simpler, predictable, and proven.
- Outcome-based pricing creates disputes ("did it really succeed?") that need arbitration infrastructure.
- Nevermined is pioneering this but hasn't proven market-wide adoption yet.

**When to revisit:**
- If competitors (Nevermined) gain significant market share with this model
- If enterprise customers demand outcome-based pricing
- If our output contract validation (`output_contract_json`) matures enough to reliably define "success"

**Implementation sketch:** Add `billing_mode: 'per_call' | 'outcome'` to skills. Outcome mode: charge on invoke, auto-refund if output fails validation contract within 5 minutes. Uses existing escrow infrastructure for the hold-and-release pattern.

**Effort:** 1-2 weeks (new billing mode, success criteria per skill, refund logic).

## 39. Agent Self-Registration (ATXP pattern)

**What:** Allow agents to autonomously create their own ClawNet accounts without human developer intervention.

**Why defer:**
- Security risk — sybil attacks, abuse without human accountability.
- ATXP ($19.2M raised, Stripe-backed) is pioneering this but it's early and unproven at scale.
- ClawNet's self-onboard flow already provides API keys programmatically via Clerk — the gap is removing the human identity requirement entirely.
- Without KYA (Know Your Agent) standards matured, autonomous registration is a spam vector.

**When to revisit:**
- If ATXP's model proves secure at scale
- If agent-to-agent commerce requires zero-human-touch onboarding
- If KYA standards (see §28) provide sufficient identity guarantees for autonomous agents

**Implementation:** Add autonomous registration endpoint with rate limiting + deposit requirement (e.g., 100 credits minimum to prevent sybil). Tie to wallet identity via SIWX (see §19).

**Effort:** 1-2 days (add autonomous registration endpoint with rate limiting + deposit requirement).

## 40. Nested Multi-Hop Payment Chains (ATXP pattern)

**What:** Track payment chains across multiple agent hops (Human → Agent A → Agent B → Tool) with full cost attribution per hop.

**Why defer:**
- ClawNet's delegated billing + composite skills already handle 2-level nesting (parent → child via `trackDelegatedSpend()`).
- Full multi-hop adds DAG tracking complexity without clear demand.
- ATXP is building this for Stripe-connected agents but the use case (5+ hop chains) is rare in practice.
- Our composite-of-composite support (max depth 3, max 10 leaf invocations) covers the realistic nesting scenarios.

**When to revisit:**
- If composite-of-composite skills (depth 3+) need per-hop cost attribution
- If cross-platform agent chains become common (Agent on ClawNet → Agent on PayAI → Tool on x402engine)
- If ATXP's multi-hop model becomes an interoperability standard

**Implementation:** Payment DAG tracking table, cross-agent settlement reconciliation, per-hop cost breakdown in receipts.

**Effort:** 1 week (payment DAG tracking, cross-agent settlement).

---

*Last updated: 2026-03-20*
*Based on Artemis Agentic Commerce Market Map analysis (173 companies) — competitive research against 402.bot, Questflow, OpenServ, Blockrun, Dexter, Daydreams, PayAI, Virtuals Protocol, Bittensor, x402engine, Agoragentic, ClawIndex, x402scan, Helixa, Cred Protocol, machines.cash, lobster.cash, ClawPay, Railgun, Heurist, Nevermined, ATXP, Skyfire.*


When to consider Rust
If ClawNet hits 10K+ concurrent requests and Node becomes the bottleneck (you're nowhere near this)
For specific hot paths only (e.g., a Merkle tree computation service as a sidecar)
If you build an on-chain program (Solana programs are written in Rust)
What that dev is probably thinking
"Rust/Zig = fast = better." That's true for Cloudflare Workers, game engines, and databases. It's not true for an API that spends 99% of its time waiting on network calls.

Ship features, get users. Language doesn't matter until you have scaling problems — and you don't.

## 41. x402r Refund & Arbitration Protocol

**What:** x402r.org adds refund/escrow to x402 payments via smart contracts. Routes payments through escrow with configurable refund windows and dispute resolution. TypeScript SDK available. Deployed on 11+ networks including Base.

**Why defer:**
- ClawNet already has off-chain escrow (7-state machine in src/db/escrow.ts) for credit-based payments.
- x402r is focused on on-chain escrow — adds gas costs and latency.
- Our x402 payment volume is still low — refund demand is minimal.
- Would need to modify x402-skills.ts to route through x402r contracts instead of direct facilitator settlement.

**When to revisit:**
- When x402 payment volume exceeds 100/day
- When agents request refundable x402 payments
- When x402r SDK matures and gas costs on Base drop further

**Effort:** 2-3 days for basic integration, 1 week for full refund lifecycle.

## 42. Sponge Gateway Registration (YC W26)

**What:** Register ClawNet as a Sponge Gateway provider so agents with Sponge wallets auto-discover ClawNet's 344+ endpoints. Sponge (paysponge.com) is backed by YC W26, built by ex-Stripe tech leads.

**Why defer:**
- Sponge is still early (launched Q1 2026).
- Our existing discovery (.well-known, llms.txt, OpenAPI, Bazaar) already covers agent discovery.
- Would need to implement Sponge's provider registration API.

**When to revisit:**
- When Sponge reaches 1000+ active agent wallets
- When agents specifically request Sponge wallet support
- When Sponge Gateway has a self-service registration portal

**Effort:** 1-2 days.

## 43. SKALE-on-Base as Settlement Chain + BITE Confidential x402

**What:** SKALE on Base is a Layer 3 (Chain ID: `1187947933`) providing zero-gas EVM execution on top of Base. Uses sFUEL (worthless gas token) with rate limiting instead of economic gas costs. Chain operator pays monthly in SKL tokens. 800 TPS per chain, instant finality.

**BITE Protocol (Blockchain Integrated Threshold Encryption):**
- Phase 1 (LIVE): Transaction-level threshold encryption. Encrypted in mempool, 16 validators use BLS key shares to decrypt after block finality. Block explorers can't see payment details.
- Phase 2 (IN DEV): Smart contract decryption via precompiled `Decryptor` contract. Enables **MachinePay Confidential x402** — agents pay for API calls and competitors can't see amount, recipient, or balance.
- Phase 3 (PLANNED): Threshold re-encryption for selective disclosure / access control.
- Phase 4 (PLANNED): Threshold FHE — compute on encrypted data (confidential balances, encrypted AMMs).

**MachinePay Confidential x402 — Why it matters:**
- `EncryptedToken_x402` contract with dual encryption (threshold key + user key)
- Transfer spans 2 blocks (encrypt → validate → re-encrypt)
- Standard ERC20 Transfer events suppressed (no amount leaks)
- ERC-3009 supported for signature-based agent payments
- Agents' strategies, spending patterns, and vendor relationships stay private

**x402 Bazaar:** SKALE's marketplace — 100+ API services, 69 native wrappers, 170+ on-chain payments (very early). 95/5 revenue split. SDK: `@x402/extensions @x402/fetch @x402/evm @x402/core`. Supports MCP (Claude/Cursor), ChatGPT GPTs, LangChain, Auto-GPT.

**Integration requirements:**
- Bridge USDC from Base → SKALE chain (IMA bridge, 16 validator BLS threshold)
- RPC: `https://1187947933.rpc.thirdweb.com`
- sFUEL distribution to agent wallets (new operational concern)
- Unclear if Coinbase CDP facilitator supports SKALE chain settlement yet
- ClawNet credit system, billing math, auth layers — no changes needed

**Phase 1 — NOW (zero risk):**
- List ClawNet endpoints on x402 Bazaar for discovery only (settlement stays on Base)
- Free distribution to Claude/Cursor/LangChain agents

**Phase 2 — WHEN BITE Phase 2 ships:**
- Add SKALE-on-Base as optional settlement chain
- Integrate MachinePay for confidential x402 payments
- Market as "private agent commerce" — unique differentiator

**Contact:** Sawyer (@TheGreatAxios), VP DevSuccess at SKALE. Offered direct guidance on integration + BITE Protocol. Reached via x402 Coinbase dev talk (March 2026).

**Effort:** Bazaar listing: 1 day. Full SKALE settlement: 3-5 days. BITE Phase 2 integration: 1 week (when available).

## 44. APINow Tokenized API Discovery

**What:** APINow (apinow.fun) tokenizes API endpoints — usage drives token value. Has npm SDK, AI-powered semantic search for endpoint discovery, and a Dune dashboard tracking on-chain API transaction flows.

**Why defer:**
- Tokenized APIs introduce price speculation into API costs — ClawNet uses stable credit pricing by design.
- APINow is a competitor to ClawNet's x402 skills system.
- Their semantic discovery approach is worth studying but our Trinity engine (semantic + p2p + onchain) is already more comprehensive.

**When to revisit:**
- When APINow's endpoint catalog has unique data sources not in our registry
- When tokenized API pricing model proves more effective than stable credits
- Competitive intelligence: monitor their Dune dashboard

**Effort:** 1 day to add as discovery source to index-sync.ts.

## 45. MPP (Machine Payments Protocol) — Stripe/Tempo

**What:** Open standard by Stripe and Tempo. Defines price announcement, payment authorization, and settlement confirmation. Session-based spending caps with fiat fallback. 100+ services at launch (Alchemy, Dune, etc.).

**Why defer:**
- Day-1 on Tempo L1 — unproven infrastructure.
- MPP sessions are already solved by ClawNet's credit + delegated key system.
- Payment abstraction layer has an MPP stub ready.

**When to revisit:**
- When agent frameworks ship MPP wallet support by default
- When MPP daily volume exceeds $100K
- When major API providers require MPP (not just accept it)

**Effort:** ~1 week.

## 46. kojimem.dev — Ephemeral Memory-as-a-Service

**What:** x402-native memory service for AI agents using ERC-7710 delegation. Agents store findings, delegate access, and destroy memory. Sub-cent USDC costs ($0.015 total for a full session). Two agents can share memory backpacks.

**Why defer:**
- Site appears pre-launch or very early stage.
- ClawNet already has Agent Context Layer (SQLite sessions, 50KB state, max 10/key).
- ERC-7710 delegation maps to our delegated key system conceptually.

**When to revisit:**
- When kojimem launches publicly with stable API
- When agents need larger shared memory beyond our 50KB session limit
- When ERC-7710 delegation becomes standard for agent identity

**Effort:** 1 day to add as endpoint once API is stable.

## 47. EIP-3009 Token Support

**What:** EIP-3009 (Transfer With Authorization) enables gasless, authorized token transfers — the standard USDC uses for x402 compatibility. "Add 3009 support" means implementing `transferWithAuthorization()` so a token works with x402 facilitators.

**Why defer:**
- Only relevant if launching $CLAWNET token.
- USDC already has EIP-3009 — our current x402 flow works.
- Token launch is deferred until revenue milestones are hit.

**When to revisit:**
- When $CLAWNET token development begins
- Critical: must implement EIP-3009 for the token to be x402-compatible

**Effort:** Built into token contract (1-2 days as part of token development).

## 48. lobster.cash / Virtual Agent Cards

**What:** Virtual Visa/Mastercard credit cards for AI agents. Agents get their own cards in fiat dollars to pay for cloud compute, API access, and hire other agents. Human-set limits.

**Why defer:**
- ClawNet's credit system + x402 + Stripe already covers primary payment rails.
- Virtual cards add regulatory complexity (KYC/AML for card issuance).
- Only relevant for APIs that exclusively accept card payments.

**When to revisit:**
- When ClawNet needs to integrate APIs that only accept traditional card payments
- When virtual agent cards become standard (lobster.cash, AgentCard.sh)

**Effort:** 1 day for basic integration.
## 49. XMTP Agent Messaging Integration

**What:** XMTP is the messaging protocol for AI agents. Adding XMTP support would let agents discover and interact with ClawNet via messages, not just HTTP. Agents could send a message to ClawNet's XMTP address and get orchestration results back.

**Why defer:**
- XMTP SDK adds a dependency and requires running a persistent listener.
- Our existing discovery surfaces (HTTP API, MCP, .well-known, llms.txt) cover the primary use cases.
- XMTP agent adoption is still early — most agents use HTTP.

**When to revisit:**
- When XMTP agent-to-agent traffic exceeds HTTP discovery
- When major frameworks (AgentKit, ElizaOS) ship XMTP as default transport
- When agents need real-time push notifications from ClawNet

**Effort:** 2-3 days for basic listener + response handler.

## 50. Crossmint Agent Wallet + NFT Attestation Anchoring

**What:** Crossmint appears in 3 categories on the market map (payments, cards, wallets). They offer agent wallets, NFT minting, and payment infrastructure. ClawNet could use Crossmint to mint attestation anchors as NFTs — making attestations permanently verifiable on-chain without running our own smart contracts.

**Why defer:**
- Our Merkle anchoring system already posts roots to Solana via SPL Memo.
- NFT minting adds gas costs per attestation (vs batched Merkle roots).
- Crossmint integration requires API key and account setup.

**When to revisit:**
- When agents need individually tradeable/transferable attestation proofs
- When Crossmint offers x402-native minting (pay per mint)
- When attestation volume justifies per-attestation NFTs

**Effort:** 1-2 days.

## 51. VeryAI as Manifest Trust Source

**What:** VeryAI provides independent AI output verification — checks for hallucinations, factual accuracy, and source attribution. Could be added as a 4th external trust source in manifest's `crossReferenceExternalTrust()`.

**Why defer:**
- VeryAI API documentation is limited — unclear pricing and availability.
- We already cross-reference 3 internal trust sources (skill health, indexed endpoints, attestation history).
- Adding external API calls to manifest increases latency.

**When to revisit:**
- When VeryAI has public, documented REST API with clear pricing
- When manifest users request external verification signals
- Implementation: literally one `sources.push()` call in `crossReferenceExternalTrust()`

**Effort:** 2-4 hours once API is documented.

## 52. Coinbase AgentKit Native Plugin

**What:** Register ClawNet as an official AgentKit plugin so every Coinbase AgentKit agent auto-discovers ClawNet's tools. We already have AgentKit-compatible tool definitions in `src/integrations/agentkit.ts` — the next step is publishing as an npm package.

**Why defer:**
- AgentKit plugin registry may require Coinbase approval.
- Our tool definitions are ready but need testing against real AgentKit agents.
- MCP integration already covers Claude/Cursor/Codex agents.

**When to revisit:**
- When AgentKit usage exceeds MCP connections
- When Coinbase opens plugin marketplace for third-party tools
- When we have confirmed AgentKit agent users

**Effort:** 1 day to publish npm package + test.

## 53. Allium Deep Data Integration

**What:** Allium provides structured blockchain data across 60+ chains via SQL-like queries. Currently added as basic registry endpoints. A deeper integration would pipe Allium data directly into the orchestration engine as a first-class data source (like ClawAPIs).

**Why defer:**
- Basic endpoints already in registry — agents can query via orchestration.
- Deep integration requires Allium API key and contract.
- ClawAPIs already covers our primary blockchain data needs.

**When to revisit:**
- When agents need cross-chain data beyond Solana/Base
- When Allium offers x402-native access
- When we need SQL-level query flexibility for data skills

**Effort:** 1-2 days for deep integration.


Potential Bottleneck	At 1M calls/day	Status
SQLite single-writer	Fine for reads, slow at 100M+ rows	Plan addresses at 50K agents (Section 28.2)
Redis memory	500MB for 1M trust scores	Fine (25GB+ available)
Ed25519 verification	1,200/s needed vs 5K-15K/s capacity	4-12x headroom
LLM cost (post pre-filter)	$1/day at 1M calls (if 1% are orchestrated)	Sustainable
Gas (direct settlement)	$7-100/month batched	Sustainable
VPS CPU (single-process Node)	May need a second VPS at 500K+ concurrent	Monitor first

---

## 54. Open Wallet Standard (OWS) Signer Adapter

**Added:** 2026-03-23. **Revisit:** 2-4 weeks after OWS launch (mid-April 2026).

MoonPay launched OWS (openwallet.sh) on March 23, 2026 as an open-source standard for agent key management. Contributors include PayPal, Solana Foundation, Ethereum Foundation, Circle, Ripple, OKX. MIT-licensed, available on npm (`@open-wallet-standard/core`) and PyPI.

**What it provides:**
- Key storage with AES-256-GCM encryption at rest
- Keys decrypted only during signing, held in protected memory, wiped immediately after
- Single seed derives accounts across 8 chain families (EVM, Solana, Bitcoin, Cosmos, etc.)
- Unified signing interface using CAIP-2 chain identifiers
- Pre-signing policy engine (rules that gate what gets signed)
- Private key never touches the agent process or LLM context

**Why we're deferring (not skipping):**
OWS launched TODAY. The npm package is hours old. The API will change. We defined the `AidSigner` interface in `@aidprotocol/trust-compute` (v2.1.0) so that OWS can be plugged in later without protocol changes. The interface is implementation-agnostic — OWS, HSM, KMS, or raw keys all work.

**What was built (March 23):**
- `AidSigner` interface in `@aidprotocol/trust-compute` — abstract signing contract
- `TestSigner` class — in-memory Ed25519 signer for unit tests, ships with trust-compute
- `SigningAlgorithm` and `HashAlgorithm` types exported for use across packages

**What to build when OWS stabilizes:**
- `@aidprotocol/signer-ows` package — OWS adapter implementing `AidSigner`
- AID-specific pre-signing policies: no self-attestation, signing rate limits, counterparty trust gates
- `keyManagement` field in manifest declarations (standard, version, keyProtection, policyEngine)
- Refactor all ClawNet signing operations to accept `AidSigner` parameter instead of raw keys

**Ed25519 alignment:** AID uses `did:key` with Ed25519 (multicodec `0xed`). OWS supports Solana (Ed25519 native). An agent's AID signing key and Solana wallet key are the same key type. OWS manages that key securely.

**Effort:** 2-3 days for the adapter + policies once OWS API stabilizes.

## 55. Trust Score Cost Attribution UX

**Added:** 2026-03-23. **Revisit:** When $CLAWNET token launches.

When an agent pays for a trust computation, the response should break down what that cost paid for — which analyses ran, what each found, how long each step took. Transparency makes pricing defensible and helps agents optimize.

**Why we're deferring:**
1. $CLAWNET token doesn't exist yet (deferred until $50K-$100K revenue milestones)
2. Some referenced features (divergence engine DIV-001–DIV-009, collusion detection strategies, reporter credibility views) may not be fully implemented yet
3. DIF doesn't care about monetization UX — this is a product feature, not a protocol feature

**Proposed breakdown (9 steps, weights sum to 1.0):**

| Step | Weight | Description |
|------|--------|-------------|
| `attestation_fetch` | 10% | Fetch and filter attestation history |
| `revocation_check` | 5% | Check revocation registry |
| `collusion_detection` | 20% | Anti-collusion graph analysis |
| `independence_scoring` | 10% | Issuer independence scores |
| `reporter_credibility` | 5% | Reporter credibility multipliers |
| `score_computation` | 15% | Weighted category scores with decay |
| `diversity_cap` | 5% | Diversity requirements + clamping |
| `divergence_analysis` | 25% | Manifest-attestation divergence engine |
| `manifest_bonus` | 5% | Manifest disclosure bonus |

**Key constraints:**
- Does NOT change the scoring formula — instrumentation wraps the pure function at the API layer
- Does NOT enable partial computation — full pipeline always runs (prevents gaming)
- The `computation` field is OPTIONAL in ScoreResult — only added by the API wrapper, not the library

**Effort:** 2-3 days once the token launch is underway and all referenced features are confirmed live.

The presentation format (it's built on Gamma, a pitch deck tool) is clean and worth noting if you ever need to make a visual pitch deck for investors or DIF. But the technology itself is a completely different domain.

Let me be straight with you: building for 1M users right now would be premature engineering that costs weeks and delivers zero value at your current scale.

Here's why:

Architecture	Users it handles	What it requires
Current (post-fixes)	~5,000	Single VPS, SQLite, JSON files
1M users	1,000,000	PostgreSQL, Redis, BullMQ, S3, load balancer, multiple servers
The jump from SQLite → PostgreSQL alone touches every DB query in the codebase. Per-tenant SQLite at 1M means 1M open database files — that's worse, not better. The real 1M architecture is:

PostgreSQL replaces SQLite (the single biggest change)
Redis for sessions, OTPs, state caching, rate limits
BullMQ (Redis-backed job queue) replaces the scheduler
S3 / object storage for tenant configs (not local filesystem)
Stateless app servers behind a load balancer (no local state at all)
That's a platform rewrite, not a feature add. It would take weeks and you'd be building infrastructure for users you don't have yet.

The pragmatic path:

Milestone	When	What to build
0–100 users	Now (you're here)	What we just shipped — AsyncLocalStorage, DB OTPs, file locking, parallel scheduler
100–1,000	When you hit ~50 active users	Add Redis for sessions + OTPs (drop-in, ~2 hours)
1,000–10,000	When you hit ~500 active users	PostgreSQL migration, BullMQ scheduler
10,000–1M	When revenue justifies it	Multi-server, S3, load balancer
Each step takes maybe 1-2 days and is triggered by actual growth, not speculation. You never build more than one step ahead.

The x402 MCP Toolkit is the most relevant piece. It lets developers monetize MCP tools directly. That's essentially what your marketplace does — skill creators publish endpoints and earn per call. If x402 now has a native MCP monetization toolkit, you should evaluate whether ClawNet's marketplace should integrate with it or whether it's a competing approach. Either way, you need to be aware of it.