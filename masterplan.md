# ClawNet Master Plan

## What Was Built This Session (2026-03-18/19)

### ClawNet (claw-net repo) — ~19,000 lines added
- **Docs rewrite** — 25 sections, 100+ endpoints documented, QA'd to 9.5/10
- **Marketplace rebrand** — "Agent Services" → "Data Skill Marketplace" across 14 pages
- **VIE** (Verified Intelligence Engine) — first marketplace skill, crypto trust scoring, 21 tests
- **Intelligence Suite** — Context Engine + Agent Trust Score + Predictive Alerts + shared intel layer (4 tables)
- **Manifest** — universal data verification (verify, assess, preflight, remember). Core infrastructure product.
- **Attestation** — signed proof of every agent action. Public verification endpoint. Core infrastructure product.
- **LLM Reseller** — custom markup, model restrictions, provision endpoint for end users
- **Dashboard tabs** — Overview / Reseller / Keys
- **Payment abstraction layer** — KeylessPaymentVerifier interface. x402 live, MPP + LSAT stubs ready.
- **Nav dropdown fix** + endpoint count 344→390+
- **Roadmap update** — token burn 50/20/15/15
- **OpenAPI 3.1** + .well-known/openapi.json redirect

### Pulse (pulse repo) — ~2,560 lines added
- Feature Radar (pain point → feature suggestion)
- Topic Scorer (smart, not random)
- Platform Voices (X/Reddit/Discord/LinkedIn/HN/ProductHunt)
- Voice Drift Detection
- Intent Classification (LLM-powered)
- Conversation Memory (CRM injection)
- Niche Categories (7 presets)
- Adaptive Mix (learning loop)
- Opportunistic Override (trending interrupts)
- Strategic Targeting (gateway accounts)
- Content Compounding (narrative arcs)
- Business Attribution (UTM → conversion)
- Post Attribution (measure outcomes)

### Key Architecture Decisions
- **Manifest** = core product (its own page at /manifest.html, in Products nav)
- **Attestation** = core product (its own page at /attestation.html, in Products nav)
- **4 crypto skills** (VIE, Context, Trust, Alerts) = marketplace skills, NOT core products
- **Manifest calls VIE/Context/Trust internally** as library functions (no HTTP, no double billing)
- **Payment gateway** is protocol-agnostic (src/payments/). x402 today, MPP/LSAT pluggable.
- **Credits** are the universal settlement layer. All payment protocols convert to credits.
- **Nav:** Products → Pulse, Radar, Manifest, Attestation | Developers → API Endpoints, Marketplace, Documentation, Playground

### DB Migrations Added
- v77: vie_reports (VIE historical pattern database)
- v78: intel_entities, intel_scores, intel_events, intel_subscriptions (shared Intelligence Suite layer)
- v79: manifest_memory (Manifest decision history + outcome tracking)
- v80: attestations + attestation_stats (signed action proofs)
- v81: reseller_configs (LLM reseller markup)

### Test Status
- 87 tests passing (5 test files)
- Build clean (tsc --noCheck)

---

## P0: Do Now (next session, ~6 hours)

| # | Item | Effort | Type | Details |
|---|------|--------|------|---------|
| 1 | **x402 Idempotency** | 2-3h | Code | Add `payment_hash` column to `x402_receipts` (migration v82). In 3 POST handlers in `src/routes/x402-skills.ts`, hash `X-PAYMENT` header, check for existing receipt, return cached result on retry. Prevents double-execution. |
| 2 | **x402 Receipt Extension** | 3-4h | Code | Store Coinbase facilitator-signed receipt. Add `facilitator_receipt_json` + `payer_address_verified` columns to `x402_receipts`. Update `GET /x402/verify/:requestId` to return facilitator receipt + attestation data. May need to upgrade `@x402/*` packages. |
| 3 | **MCP Directory Submissions** | 1-2h | Outreach | Submit ClawNet MCP server to: Smithery.ai, mcp.so, Glama.ai/mcp, MCP Hub, Awesome MCP Servers GitHub. 6 tools: list-skills, get-skill, search-registry, get-credits, invoke-skill, orchestrate. Zero code needed. |
| 4 | **Positioning Statement** | 30min | Content | "AI agent orchestration with 390+ live APIs, skill marketplace, and cryptographic receipts" |

## P1: This Week (~16 hours)

| # | Item | Effort | Type | Details |
|---|------|--------|------|---------|
| 5 | **LangChain Plugin** | 8-10h | Code | npm package `@clawnet/langchain`. 3 tools: `ClawNetOrchestrateTool`, `ClawNetSkillTool`, `ClawNetSearchTool`. Each extends `@langchain/core/tools` StructuredTool. Uses `@clawnet/sdk` internally. Submit PR to LangChain community integrations. |
| 6 | **AgentKit Integration** | 6-8h | Code | ClawNet as Coinbase AgentKit action. 3 actions: `clawnet_orchestrate`, `clawnet_invoke_skill`, `clawnet_pay_x402`. AgentKit agents already have Base wallets = x402 native. DM Lincoln Murr (@xlincolnx). |
| 7 | **Market Map DM** | 30min | Outreach | DM @henloitsjoyce. Category: "Agent Infrastructure." One-liner + logo + URL. |
| 8 | **Discovery files audit** | 1-2h | Code | Ensure .well-known/x402.json, agent-card.json, mcp.json all current and complete. |

## P2: This Month (~25 hours)

| # | Item | Effort | Type | Details |
|---|------|--------|------|---------|
| 9 | CrewAI Plugin | 4-6h | Code | Python package `clawnet-crewai` on PyPI. 3 tools. |
| 10 | ElizaOS Plugin | 6-8h | Code | TypeScript plugin for crypto/Web3 agent community. |
| 11 | Link Receipt → Attestation | 3-4h | Code | `attestation_id` column on `x402_receipts`. Single verify endpoint shows payment proof + delivery proof. |
| 12 | SDK publish to npm | 4-6h | Code | Extract `src/sdk/client.ts` → `@clawnet/sdk` npm package. Foundation for all plugins. |
| 13 | Partnership outreach | 2-3h | Outreach | Coinbase AgentKit team, XMTP, Crossmint, LangChain maintainers. |

## P3: Next Month (~18 hours)

| # | Item | Effort | Type | Details |
|---|------|--------|------|---------|
| 14 | OpenAI Agents SDK | 4-6h | Code | Function calling tool definitions |
| 15 | Vercel AI SDK | 3-4h | Code | Custom tools for Next.js devs |
| 16 | x402 Offer Extension | 2-3h | Code | Standards compliance for 402 challenges |
| 17 | Protocol Documentation | 4-6h | Content | "Trust handshake" narrative: discovery → payment → verification → attestation |

---

## Key Context for Next Session

### x402 Extensions (Coinbase announced 2026-03-19)
- **Receipt Extension**: facilitator-signed proof of payment. Complements ClawNet's Attestation (proof of delivery). Together = complete trust chain. No competitor has both halves.
- **Idempotency Extension**: prevents double-execution on retries. ClawNet's x402 routes currently have NO idempotency — must fix.

### Market Position
- ClawNet spans 4 categories on the Agentic Finance Market Map but is listed in ZERO
- Biggest gap is DISTRIBUTION, not features
- MCP submissions + LangChain plugin + AgentKit integration = highest ROI for visibility
- Key competitors: Nevermined (orchestration), VeryAI (verification), Skyfire (x402 payments)
- Key partners: Coinbase (AgentKit/x402), Crossmint (wallets), XMTP (messaging)

### Considerations.md has 32 entries
- §28: Org-Level Identity (defer until standards mature)
- §29: MPP Integration (stub ready in src/payments/mpp-verifier.ts)
- §30: Lightning/LSAT (stub ready in src/payments/lsat-verifier.ts)
- §31: Free Trial Tier (5 free credits on signup)
- §32: Multi-Chain USDC (defer, already support Solana + Base)

### ClawNet's Positioning
"Verify before you act (Manifest). Prove after you did (Attestation). 390+ APIs, one key, pay-per-call."

### What NOT to build
- MPP (Tempo L1 too new, credit system already solves sessions)
- Lightning/LSAT (niche audience, volatile asset)
- Org identity (wait for standards — Anon, Billions, KYA)
- Multi-chain USDC beyond Solana + Base (agents already use cheap L2s)
- More features in general — focus on DISTRIBUTION
