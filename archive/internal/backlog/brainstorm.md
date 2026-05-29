# Brainstorm — running log of future ideas across all projects

**Purpose:** single source of truth for things we're NOT building right now but don't want to forget. When we resume building, start here.

**Organized by project.** Cross-reference other strategy docs when relevant.

**Last updated:** 2026-04-07.

---

## ClawNet

### Near-term (unblocked, not prioritized)

- **Telemetry dashboard** — expose `/v1/stats/*` endpoints: per-endpoint usage, cache hit rates, x402 ETag savings, top agents, revenue by endpoint
- **Agent wallets v2** — delegated spend + time-bound budgets + per-endpoint limits
- **Endpoint health SLA** — auto-suspend endpoints with <95% uptime over 24h
- **Multi-region cache** — same certified cache layer, replicated across regions
- **Rate limit marketplace** — let providers sell rate-limit allocation (e.g., "1000 calls/sec premium tier")
- **Webhook subscriptions** — agents subscribe to "notify when endpoint X hash changes"
- **Cost prediction** — agent submits a planned workload, we estimate spend with/without x402 ETag
- **Bulk credit packs** — pre-purchase credits at discount, expire unused after N months
- **Solana-native billing** — USDC deposits via Phantom, direct-to-endpoint settlement, skip our credit layer
- **Promo code engine v2** — referral codes, campaign attribution, A/B testing
- **Provider analytics** — show providers their endpoint performance, consumer demographics, revenue trends

### Future

- **Agent reputation system** — score agents by polling discipline, payment reliability, hit rates; feeds into x402 ETag discount tiers
- **Cross-provider dedup** — multiple providers offering identical data (BTC price) → serve once, credit all providers proportionally
- **Private endpoints** — Clerk-auth-only endpoints for sensitive data
- **MCP-native discovery** — ClawNet as MCP server so Claude Desktop finds endpoints natively
- **Endpoint notebooks** — Jupyter-style notebooks that bundle endpoint calls + analysis, shareable
- **Endpoint composition language** — DSL for chaining endpoints (ETL pipelines via API calls)
- **Treasury diversification** — don't hold all USDC on one wallet; multi-sig, yield-bearing strategies
- **Token launch ($CLAWNET)** — full architecture in `internal/token-architecture.md`: BME model, 25% revenue burn, staking for tier benefits, "digital tools" SEC classification. Launch at $50-100K monthly revenue milestone.
- **Credit denomination change** — display USD not credits. Details in `internal/pricing-economics.md`.
- ~~**Tier system unification**~~ — DONE (2026-04-06). Old tiers deprecated, all 'founding'. Soma Check T0-T3 separate. See `internal/tier-system.md`.
- ~~**Cache hit economics revision**~~ — DECIDED (2026-04-06). Keeping 50/50 cache split. See `docs/reference/billing.md`.
- **Provider payout spread reduction** — 25% -> 15% buy/sell spread. Details in `internal/pricing-economics.md`.

### Verified Data Machine (2026-04-07)

- **Full vision doc:** `internal/verified-data-machine.md` — unified Heart+Cache+Check+Receipt machine
- **Provenance chain architecture:** `internal/provenance-chain-architecture.md` — DerivationCert schema, provenance DAG, 7 levels of proof, C2PA/OpenLineage interop
- **Modular Heart concept** — each module standalone, composes seamlessly, no combination fails
- **$CLAWNET expanded role** — verification staking, verifier rewards, governance (beyond BME)
- **Blacksmith provenance chain** — derivation certs, `X-Soma-Derived-From`, full DAG from data origin through every agent transformation
- **Session A COMPLETE** — provenance chain architecture in `provenance-chain-architecture.md`
- **5 ultra-think sessions remaining** — token v2 (B), modular design (C), proof assessment (D), 10-year stress test (E), agent network operator platform (F)
- **Key research findings:** No framework has data verification. $12.9M/year avg cost of bad data. Agent memory gap (Soma Check uniquely fills "has source changed?"). Credit bureau model ($124B market) is the long-term moat analogy.

#### Agent Networks & Hierarchical Hearts (2026-04-07)

Core finding: every agent needs its own heart. Not debatable — 40 years of PKI, SPIFFE/SPIRE, Ethereum validators, military DoD PKI, and every 2026 AI agent identity proposal all converge on individual identity.

**Architecture:** Root Heart (cold) → Fleet Heart (intermediate) → Agent Heart (leaf). HD derivation from single seed = 1000-key management is operationally same as 1-key. BLS aggregate signatures compress 1000 sigs into O(1) verification. SPIFFE-style short-lived SVIDs auto-expire for ephemeral agents.

**Cross-network hiring flow:** Agent A (Network X) hires Agent B (Network Y) → delegation cert scopes work + spend + expiry → B's output carries B's birth cert + A's delegation cert → full chain verifiable by anyone who trusts Root X.

**Competitive landscape for "agents hire agents" economy:**
- **CrewAI** — orchestration, no trust/payment layer. Cooperate (run crews with Soma hearts)
- **Olas (Autonolas)** — agent marketplace, token-staked registry. Compete on trust layer, cooperate on discovery
- **Virtuals ACP** — agent commerce protocol, 4-phase lifecycle. Compete on evaluator role (ClawNet as evaluator oracle)
- **MS Agent Governance Toolkit** (2026-04-03) — DID identity, trust 0-1000, delegation chains. Most direct overlap. Governance focus, NOT provenance. We beat them on provenance chain.
- **ERC-8004** — on-chain agent identity (85K+ agents). Identity + Reputation + Validation registries. Cooperate (register Soma hearts as ERC-8004 identities)
- **ERC-8183** — programmable escrow for agent commerce. ClawNet as evaluator oracle is a natural fit.
- **MCP/A2A** — transport layers. Cooperate (Soma hearts for every MCP server, sense for every client)

**Massive gap nobody fills:** trust + payment + provenance in a single flow. Everyone has one piece. ClawNet has all three.

**Credit bureau moat:** Trust data accumulation creates non-replicable moat. Equifax: $5.5B revenue from credit scores. Agent trust scores backed by verified transaction history cannot be forked. Long-term demand driver for $CLAWNET.

**Agent Network Operator Platform concept:** Fleet management dashboard, one-click 1000 hearts, cross-network hiring marketplace, trust score aggregation, fleet-level billing. See Session F in verified-data-machine.md for full ultra-think prompt.

### Open questions

- Should credits be deprecated in favor of direct USDC?
- Should we self-host LLM (for orchestration) vs use OpenAI forever?
- Should orchestration be moved to agents (they pick endpoints) or stay server-side?
- Cache hit platform share: 5% (option A) or 0% (option B)? Currently leaning A with path to B.
- Token chain: Solana (SPL) or Base (ERC-20)? Both have existing integration.
- MCP sub-registry: build curated Soma-verified tool registry via MCP's sub-registry architecture?

---

## Soma

### Near-term (blocked by scale test)

See `internal/scale-test-plan.md` for the 4-phase scaling sequence.

### Post-scale Tier A (must-have for future-readiness)

Per `internal/soma-future-proofing.md`:
1. Complete PQ migration (ML-DSA-65 full implementation, not stub)
2. Event-unit abstraction (rename per-token HMAC → per-event HMAC conceptually)
3. Genome evolution chain (self-modifying agents)
4. Real TEE integration (AWS Nitro end-to-end)

### Post-scale Tier B (strategic positioning)

5. Aggregate signatures / BLS (swarm identity)
6. Agent-lineage DAG (parent-child spawning)
7. Feature-extractor plugin interface (modality-agnostic fingerprinting)
8. Ephemeral heart pattern (just-in-time identity)

### Post-scale Tier C (research-level)

9. ZK-proof primitives (privacy-preserving attestation)
10. On-chain verdict contracts (Solidity reference)
11. Threshold-of-observers verification
12. Trusted-time oracle integration

### Other ideas

- **Soma Vouch** (2026-04-05, originally logged as "Soma Bazaar", renamed same day) — verifiable discovery + transitive trust attestations + libp2p gossipsub for cert rotations + x402 Bazaar backwards-compat via two optional fields. MVP shipped as `/v1/soma/vouch/*`. Full origin spec in `groundbreaking-extensions.md` Extension 9.5. Viral trust loop parallel to 0xJeff's x402 rail-propagation mechanic.
- **Soma SDK ports** — Python, Rust, Go, Java soma-heart implementations (currently TypeScript-only)
- **Soma browser extension** — observer runs in browser, verifies any agent you interact with
- **Soma for MCP servers** — every MCP server auto-gets a Soma heart, every MCP client auto-runs sense
- **Soma as a service** — hosted sensorium (for users who can't run it locally)
- **Attack harness extension** — add adversarial ML attacks (gradient-leakage, membership inference)
- **Soma Check v2** — hash commitments on-chain (provider can't backdate "unchanged" lies)

### Known gaps (from audit)

- Dual-sign still dead — needs design work
- Birth cert signing incomplete — Phase 1 shortcut via `_lastBirthCert`, refactor needed
- Provenance policy deferred — cache paths don't produce certs yet

---

## x402 ETag

Full strategy in `internal/x402-etag-strategy.md`. Summary of things not actioned yet:

### Tier 2 — strategic moat
- Claim `x402-etag.org` domain
- Publish spec as IETF informational I-D
- Public registry of enabled endpoints
- Certification badge program
- Edge proxy offering (`etag.clawnet.com`)
- Reference middlewares for every framework

### Tier 3 — protocol family
- x402 Batch (probe many hashes in one call)
- x402 Subscribe (SSE push on hash change)
- x402 Range (pay only for new records in list responses)
- x402 Vary (multi-variant pricing)

### Tier 4 — trust & safety
- Soma cert chain on every hash (cryptographic "can't lie about unchanged")
- TEE-attested ETag (premium tier)
- Dispute/insurance layer (staked USDC)
- On-chain hash commitments

### Tier 5 — data/analytics
- Analytics API (hit rates, freshness, change frequency)
- Agent behavior scoring
- Cross-provider dedup

### Open questions (from strategy doc)
- Drop `X-Soma-Hash` header in v1.0 or keep both forever?
- Authenticate `/check` probe or keep free-public?
- Publish spec before or after clawapis pilot?
- Registry pricing: flat fee vs % of calls?
- Open-source middleware or ClawNet-exclusive?

---

## Proof-of-Delivery layer (the "holy shit" play)

**Researched 2026-04-04.** State of x402: volume collapsed 92% from Dec 2025 peak (Artemis), ~50% wash trading, real commerce ~$14k/day. Payment rails shipped before market exists. Window is open because **everyone is fighting over payment, nobody is fighting over delivery trust**.

### Top 5 x402 pain points we uniquely solve

1. **Payment-without-delivery race** (GitHub coinbase/x402#1062) — facilitator timeout < Base confirmation, wallet debited, no refund, no webhook. Most-cited dev complaint. **Our fix:** Soma hash-before-pay via x402 ETag probe makes race impossible.
2. **Centralized facilitator tax** — Coinbase charges $0.001/settlement since Jan 2026. ChaosChain racing to decentralize. **Our fix:** ClawNet as neutral facilitator; Soma cert replaces facilitator trust.
3. **"Paid, got garbage"** — x402 is pure payment transport, no delivery/quality verification. x402Disputes.com exists as unadopted band-aid. **Our fix:** literally Soma's thesis — birth-cert the response, cryptographic dispute evidence.
4. **No batching/subscriptions** — every call = on-chain settlement. Stripe's MPP (Mar 2026, $500M Series A) pitches batching as THE x402-killer. **Our fix:** x402 ETag + Range + Subscribe + Batch sub-protocols.
5. **Wallet privacy leak** — every x402 call reveals wallet address, leaks agent economic graph. **Our fix:** Soma selective disclosure + PQ + stealth-address roadmap.

### 3 groundbreaking ideas (ranked)

**A. Verifiable x402 — EigenLayer AVS for Soma attestation.** Restaked ETH slashes providers who lie about "unchanged" or ship bad data. Shared economic security for data honesty. ERC-8004 (live Jan 2026) covers identity; nobody has slashing for delivery quality. The missing piece of the agentic trust stack.

**B. TEE-attested x402 ETag — hardware-signed hashes.** Provider runs in Nitro/TDX, signs hash with attested enclave key. Coinbase Agentic Wallets (Feb 2026) already does TEE for keys — pattern is mainstream. Premium tier: "Verified-by-TEE."

**C. Intent-based x402 — CowSwap for APIs.** Agent declares intent (*"BTC price ≤ $0.01, freshness ≤ 5s, Soma-verified"*), solvers compete, warmest x402 ETag cache wins. Solvers stake Soma reputation. Nobody has shipped solver competition for API calls. **Turns API markets into auction markets.**

### The positioning play — Proof-of-Delivery for Agent Commerce

Protocol-agnostic middleware sitting ABOVE x402/MPP/L402/AP2/TAP. The honesty layer x402 structurally cannot provide. Stack: x402 ETag + Soma birth certs + EigenLayer AVS + TEE attestation + intent-based routing.

**Pitch:** *"x402 says money moved. Soma proves data was real. Together: trustless agent commerce."*

**Why we win regardless of which payment protocol wins:**
- x402 wins → payment rails commoditize → trust layer becomes premium → we own it
- MPP wins → same story, we're protocol-agnostic → win
- Multi-protocol world → we span them all → win bigger

**Artemis's "mirage" critique is our wedge:** agent commerce hasn't exploded because agents can't trust what they're buying. Payment isn't the bottleneck — trust is. We're building the trust bottleneck release.

### References to track (post-research 2026-04-04)

- `coinbase/x402` GitHub — issues #694 (delegated billing), #839 (escrow), #1057 (rate limits), #1062 (timeout race), #447 (Circle Gateway)
- ChaosChain decentralized facilitator — `github.com/ChaosChain/chaoschain-x402`
- Stripe/Tempo MPP — direct competitor, $500M Series A Mar 2026
- Google AP2 (ap2-protocol.org), Visa TAP, ERC-8004 (live mainnet 20k agents)
- L402 / Lightning Labs `lightning-agent-tools` — Lightning-native alt
- Bankr x402 Cloud (launched 4/02/2026), x402Disputes.com, World AgentKit
- EigenLayer AVS docs for verifiable AI
- Artemis x402 dashboard — `app.artemisanalytics.com/asset/x402`
- Cloudflare x402 blog post, CoinDesk 2026-03-11 volume-collapse coverage

### Detailed roadmaps (new 2026-04-04)

- `proof-of-delivery-roadmap.md` — full implementation specs for AVS + TEE + Intent tracks
- `groundbreaking-extensions.md` — S/A/B-tier extensions (SNARK chains, universal badge, provenance graphs, confidential compute, marketplaces, credit scores, etc.)

---

## Agent topology + delegation architecture

**Captured 2026-04-04 after realizing the original "100 flat hearts" scale test measured the wrong thing first.**

### Core realization

Real agent systems (Claude Code Task tool, LangGraph, AutoGen, CrewAI, Pulse) are **hierarchical/delegated**, not flat. The flat 100-heart test only measures multi-tenant hosting capacity. The realistic hot path is 1 parent spawning 100 delegated children.

### Test matrix (updated in `scale-test-plan.md`)

- **Test B (realistic hot path):** 1 × 100 delegated — run first
- **Test A (multi-tenant floor):** 100 flat — run second
- **Test C:** 10 × 10 hierarchical multi-tenant
- **Test D:** ephemeral 1000/sec spawn-die
- **Test E:** 10-deep chain depth stress

### Delegation architecture (full spec in `soma-future-proofing.md`)

- Each child gets own heart (not shared parent heart)
- Delegation cert = parent signs child's birth + scope + spend limit + expiry
- Proof-of-computation chain: data → child cert → parent cert → root
- Verifier only trusts root pubkey; chain self-verifies
- Revocation: revoke parent → all descendants implicitly revoked

### NO hard depth cap

**Changed 2026-04-04.** Originally spec'd 10-level hard cap. User correctly pointed out this limits future agent topologies. New design:
- No hard limit
- Soft warning at depth 100
- SNARK-compressed chains give O(1) verify regardless of depth
- Fallback without SNARKs: caching + batching + Merkle proofs

### Fast + low-compute verification targets

- **Target:** <500µs verdict on mobile/edge, any chain depth
- **Today:** 1-3ms at depth 5 (linear with depth without compression)
- **Techniques:** SNARK compression, WASM verifier, verdict caching, bloom-filter revocation, batch verify via BLS
- **Ambition:** verify on Raspberry Pi Zero in <10ms; browser extension verifies every response zero user perception

---

## Adoption blockers we need to solve

Not technical novelty — these are the things that keep Soma + x402 ETag from being adopted at scale. Full detail in `groundbreaking-extensions.md` section "Adoption-focused additions."

### Developer UX
- **1-line SDK target**: `soma.middleware({ endpointId })` on server, `soma.call(url, { verify: true })` on client
- **15-minute POC** from install to first verified endpoint
- **SDKs in every major language** (JS/TS, Python, Go, Rust, Java) before public push

### Trust signal
- **Universal verification badge** (browser extension + `X-Soma-Verified` header + `verify.soma.dev` explorer)
- **Soma HTTPS lock** — visual/cultural parity with SSL green lock
- **`soma://` URI scheme** for clickable receipt verification

### Debugging
- **Chain explorer at verify.soma.dev** — Etherscan-for-Soma-receipts
- **Failure reasons** — not just "verify failed" but "cert signature mismatch at level 3, signed by revoked key K"
- **Timeline view** — related receipts + revocation events + AVS slashing activity

### Performance escape hatches
- **Fast lane** for HFT/gaming: pre-verified session tokens, batched verify at intervals
- **Opt-out** of chain walk for trusted local providers (with audit log)

### Graceful failure modes
- **Sensorium offline** → cached revocation fallback + degraded-mode warning
- **Key compromise** → emergency revocation broadcast + grace period on new keys
- **ClawNet hit-by-bus** → decentralized operator continuation
- **Cert format v2** → dual-verify during migration window

### Legal + regulatory
- **AVS slashing = securities?** Legal review pre-mainnet
- **Receipt storage = data retention regs?** GDPR/HIPAA analysis
- **Operator KYC requirements** by jurisdiction
- **Staking regulation** (where do operators incorporate?)

### Long-term sustainability
- **10-year question:** who pays for sensorium + AVS infrastructure?
- **Revenue mix:** protocol fees + verification subscriptions + reputation oracle queries + certification fees + marketplace fees
- **Bridge strategy:** ClawNet funds bootstrap → self-sustaining by year 3 via fee capture

---

## Pulse

(Referenced in memory — separate repo, different context.)

Per `project_pulse_session_20260330` memory: major build landed (Create, Growth, billing, chat tools, security, OAuth, Brand Intelligence, adaptive preferences). No immediate TODOs surfaced here.

If/when Pulse integrates with ClawNet endpoints: opportunity for Pulse agents to use x402 ETag for efficient polling.

---

## Cross-cutting (applies to multiple projects)

### Infrastructure

- **Multi-node deployment** — scale guardian-vps to a cluster (needed for Soma 1000-heart test)
- **Observability stack** — unified logging/metrics across ClawNet, Pulse, Soma
- **Backup/DR plan** — SQLite WAL is brittle at scale, need real backup strategy
- **CI/CD for Soma** — auto-publish soma-heart/soma-sense on tag, run tests on PR

### Documentation

- **Public Soma docs gaps** (per `project_soma_docs_gaps` memory): API reference, tutorials, migration guide, protocol spec in one place
- **ClawNet public docs** — currently internal; carve out a public subset for providers/agents
- **x402 ETag spec** — publish RFC-style spec at x402-etag.org (Tier 2 item)

### Business / ecosystem

- **Token launch** ($CLAWNET) — per `project_token_economics` memory
- **Partnership pipeline** — clawapis first, then identify next 3-5 paid API providers to pitch
- **Conference strategy** — Coinbase x402 dev event March 2026 (per `project_x402_ecosystem` memory)
- **Market positioning** — Artemis market map (per `project_competitive_landscape`)
- **Gumroad packages** — 6 paid + 10 free (per `project_gumroad_packages`)

### Research

- **Agent economy modeling** — how does agent spend evolve as they scale from 1 → 1M → 1B agents?
- **Identity-privacy tradeoff** — how much identity to reveal for trust vs how little for privacy?
- **Protocol game theory** — what incentive structure keeps providers honest in x402 ETag without TEE?

---

## When we resume building

**Checklist for picking back up:**

1. Re-read this file (brainstorm.md)
2. Re-read `internal/verified-data-machine.md` for unified Machine vision + ultra-think session prompts
3. Re-read `internal/provenance-chain-architecture.md` for DerivationCert schema + provenance DAG
4. Re-read `internal/x402-etag-strategy.md` for x402 ETag priorities
5. Re-read `internal/soma-future-proofing.md` for positioning invariants + delegation chain spec
6. Re-read `internal/scale-test-plan.md` for topology test matrix
7. Re-read `internal/proof-of-delivery-roadmap.md` for AVS/TEE/Intent implementation specs
8. Re-read `internal/groundbreaking-extensions.md` for S/A/B-tier extensions + adoption playbook
9. Check task list for pending items (#77 Soma 100-hearts bench, #106-110 x402 ETag Tier 1)
10. Check memory for recent decisions
11. Pick highest-leverage item from Tier 1 of whichever strategy doc applies

**First three things to do on resume (recommended):**
1. Lock x402-etag.org domain (defensive, 5 minutes)
2. Build **Test B** from scale-test-plan (1 × 100 delegated — realistic hot path, NOT flat 100)
3. USDC telemetry + discovery flag on ClawNet (unblocks clawapis)

**Post-scale decisions (revisit after tests B + A complete):**
- Start AVS Phase 1 stub? (from proof-of-delivery-roadmap.md)
- Start universal badge browser extension? (from groundbreaking-extensions.md)
- Start delegation chain cert implementation? (from soma-future-proofing.md)

---

## Meta — how to keep this doc useful

- Append, don't restructure, until the file gets too long (>500 lines), then split
- Every idea gets one line minimum — capture first, elaborate later
- Cross-reference other docs instead of duplicating content
- When an item moves to "active build," delete it here (it's tracked elsewhere)
- Review this file at start of each new session (reload context)
