# ClawNet Vision Brainstorm — The 10/10 Agent Economy

**Date:** 2026-04-09
**Purpose:** Identify what's genuinely missing. Not rehash existing docs — find the gaps between the gaps.
**Existing coverage:** agent-economy-roadmap.md (phases 1-7), soma-horizon.md (18 future ideas), golden-plan.md (3-layer strategy), token-architecture.md (trust gas), founding-protocol.md (pre-token event), roadmap.md (gaps A-L).

---

## The Honest Assessment: Where ClawNet Actually Stands

ClawNet has extraordinary **depth** in its primitives:
- Cryptographic identity (Heart, birth certs, DID, wallet derivation)
- Multi-dimensional trust scoring (6 dimensions, conservation of trust, vouch graph)
- Verifiable behavioral history (pulse trees, checkpoints, Nova IVC, Groth16)
- Payment rails (credits, USDC, x402, Stripe, escrow)
- Fee transparency (fee spine, zero-fee proofs)
- Agent lifecycle (birth, delegation, burners, death certs)

But it lacks **breadth** in the economic layer. The primitives don't compose into a flowing economy yet. Think of it like having a central bank, a court system, and a census bureau — but no marketplace, no contracts, and no phone book.

**The core problem:** Trust is computed but doesn't DO anything. An agent with trust 90 and an agent with trust 10 have functionally identical experiences on ClawNet today. Trust is a number sitting in a database. It needs to become an economic force.

---

## The 5 Systemic Gaps (Not Individual Features — Systemic)

### Gap 1: Trust Has No Teeth

Trust scores are computed across 6 dimensions but don't materially affect the agent's experience. There's a mention of trust-gated discounts (0-30%) in agent-economy-roadmap.md but the actual pricing engine (`pricing.ts`, `credits.ts`) doesn't enforce trust-based tiers on live traffic.

**What "trust with teeth" looks like:**
- Trust < 20: Can only call free/demo endpoints. Must post 2x bond on escrow. Pay list price.
- Trust 20-50: Full endpoint access. Standard bonds. List price.
- Trust 50-80: 10-20% discount. Reduced bond requirements. Priority routing (lower queue position).
- Trust 80+: 20-30% discount. Minimal bonds. Priority routing. Access to premium/exclusive endpoints. Eligible to BE hired in the labor market.

**Why this matters more than any new feature:** If trust doesn't affect economics, nobody will mine it. If nobody mines trust, the trust network has no value. If the trust network has no value, there's no moat. Trust utility is the keystone — everything else (mining, marketplace, token) depends on trust being WORTH HAVING.

**What to build:**
- `trust-gating.ts` middleware: before every endpoint call, check caller's trust score. Apply tier pricing, bond adjustments, and access gates.
- Trust tier table in DB: configurable per-endpoint (providers can set their own minimum trust requirements)
- Provider dashboard: "Require trust > X to access my endpoint" toggle

This is a small amount of code with massive strategic impact.

### Gap 2: No Agent Discovery Protocol

Agents can find ENDPOINTS through ClawNet's registry. But there's no way for Agent A to find Agent B based on capabilities, trust score, and pricing. The marketplace sells skills (static listings) — not agents (dynamic capabilities).

soma-horizon.md §3.2 mentions "Internet of Agents — Discovery Protocol" but it's Tier 3 (speculative). This should be Tier 1. Without discovery, there's no agent-to-agent economy. Without agent-to-agent economy, ClawNet is just an API gateway with extra steps.

**What discovery looks like:**

```
POST /v1/agents/discover
{
  "capability": "sentiment-analysis",
  "min_trust": 60,
  "max_price_credits": 5,
  "deadline": "2026-04-09T18:00:00Z",
  "require_soma_heart": true
}
```

Response:
```json
{
  "matches": [
    {
      "did": "did:key:z6Mk...",
      "trust_score": 87,
      "capabilities": ["sentiment-analysis", "nlp", "tweet-mining"],
      "price_per_call": 2,
      "availability": "online",
      "heartbeat_count": 4200,
      "vouch_count": 12,
      "hire_url": "/v1/agents/did:key:z6Mk.../hire"
    }
  ]
}
```

**What to build:**
- Agent capability registry: agents self-register capabilities (validated by their pulse tree history)
- Discovery API: filter by capability, trust, price, availability
- Trust-weighted ranking: higher trust = higher in search results (natural incentive to mine trust)
- Agent service card: JSON schema describing what an agent can do, at what price, with what trust

This directly feeds into the labor market (soma-horizon 1.4) and the marketplace (agent-economy-roadmap Phase 4). Without discovery, those phases can't activate.

### Gap 3: No End-to-End Agent Transaction Protocol

The primitives exist (trust query, escrow, checkpoints, fee spine) but there's no designed FLOW that connects them. When Agent A wants to hire Agent B, what happens step by step? Which APIs does Agent A call, in what order?

**The missing flow:**

```
1. DISCOVER  →  Agent A queries /v1/agents/discover
2. TRUST     →  Agent A queries /v1/trust/score/{B's DID} (dimensional)
3. NEGOTIATE →  Agent A sends intent to B with terms (price, deadline, SLA)
4. CONTRACT  →  Both agents sign a service agreement (Heart-signed)
5. ESCROW    →  Agent A funds escrow for the contract amount
6. EXECUTE   →  Agent B does the work (burner agent, checkpoints recorded)
7. VERIFY    →  Agent A checks B's checkpoints against contract terms
8. SETTLE    →  Escrow releases to B (or dispute triggers)
9. RATE      →  Both agents rate each other (feeds back to trust oracle)
10. UPDATE   →  Both agents' trust scores update based on outcome
```

Steps 1, 5, 6-ish, and 8 exist today. Steps 2-4, 7, 9-10 are missing or disconnected.

**What to build:**
- Service Agreement schema (Heart-signed by both parties)
- Contract creation API: `/v1/contracts/create` (references escrow, terms, deadlines)
- Checkpoint verification API: `/v1/contracts/{id}/verify` (checks agent B's checkpoints against contract terms)
- Mutual rating API: `/v1/contracts/{id}/rate` (both agents rate the interaction)
- Trust update trigger: successful contract completion → trust boost for both parties

This is the CONNECTIVE TISSUE between all the existing primitives. Without it, the primitives are a toolkit. With it, they're an economy.

### Gap 4: Trust Is Not Portable

Trust scores live in ClawNet's SQLite database. An agent with trust 90 on ClawNet has trust 0 everywhere else. roadmap.md Gap G mentions "agent reputation portability" but there's no design.

**What portable trust looks like — Trust Certificates:**

A Trust Certificate is a signed, time-limited credential:
```json
{
  "type": "SomaTrustCertificate",
  "version": "1.0",
  "subject": "did:key:z6Mk...",
  "issuer": "did:key:z6Mk...clawnet",
  "trust_score": 87,
  "dimensions": {
    "reliability": 92,
    "economic": 85,
    "verification": 88,
    "longevity": 79,
    "consistency": 90,
    "social": 82
  },
  "evidence": {
    "heartbeat_count": 4200,
    "checkpoint_count": 84,
    "vouch_count": 12,
    "nova_proof_hash": "abc123..."
  },
  "issued_at": "2026-04-09T12:00:00Z",
  "expires_at": "2026-04-16T12:00:00Z",
  "signature": "..."
}
```

Any agent or platform can verify this certificate WITHOUT querying ClawNet:
1. Check ClawNet's well-known public key → verify signature
2. Check expiry → reject if stale
3. Optionally: verify the Nova proof → cryptographic assurance

**Why this is different from EAS attestations:**
- EAS attestations are on-chain (need a Base node to verify)
- Trust certificates are off-chain (verify with just the public key)
- EAS is permanent, certificates expire and renew (recurring revenue)
- Certificates are lightweight enough for agent-to-agent headers

**Revenue model:**
- Certificate issuance: 10-25 credits per cert (7-day validity)
- Auto-renewal: agents subscribe for continuous certification
- Premium certs: include Nova proof + checkpoint hashes (50 credits)
- Verification API: free (drives adoption — every verifier is a potential buyer)

**This is the SSL/TLS analogy.** Let's Encrypt didn't kill certificate authorities — it grew HTTPS from 40% to 95%. ClawNet issues trust certificates. The protocol is open (anyone can verify). The issuance is the product.

### Gap 5: No Real-Time Trust Network

Trust is queried point-in-time via API call. There's no way for an agent to say "notify me if Agent B's trust drops below 60." In a live economy where agents have ongoing contracts, real-time trust monitoring is essential.

**What real-time trust looks like:**

```
POST /v1/trust/subscribe
{
  "watch": ["did:key:z6Mk...agentB", "did:key:z6Mk...agentC"],
  "alert_conditions": {
    "trust_below": 50,
    "trust_change_pct": 20,
    "new_slash_event": true,
    "vouch_revoked": true
  },
  "delivery": "webhook",
  "webhook_url": "https://agent-a.example.com/trust-alerts"
}
```

When Agent B gets slashed, Agent A gets an immediate notification. Agent A can then terminate contracts, revoke delegations, or adjust exposure.

**Revenue model:**
- Free tier: 3 watched agents, hourly digest
- Paid tier: unlimited watches, real-time webhooks, 0.01 credits/alert
- Premium: trust score history API (30-day graphs), correlation analysis

**Why this matters:** Without real-time trust, agents can't react to trust changes. A high-trust agent that gets slashed at 3am continues operating with the OLD trust perception until someone queries. Real-time trust turns the static credit bureau into a live risk monitoring system.

---

## Golden Ideas (Not in Any Existing Doc)

### Golden 1: Trust Score Staking

Agents can "stake" their trust score on a claim: "I stake 15 trust points that this data is accurate."

If the claim is verified correct → staker's trust INCREASES by 5 (net +5)
If the claim is verified wrong → staker's trust DECREASES by 15 (net -15)

Asymmetric risk creates honest signaling. Only agents with genuine confidence stake their trust. Creates a market for CONFIDENT assertions, not just data delivery.

**Where this applies:**
- Data quality assertions ("this price feed is accurate to 0.1%")
- Agent recommendations ("Agent B will complete this task well")
- Fact verification ("this news article is not AI-generated")
- Prediction markets ("ETH will be above $4000 by Friday")

**Revenue:** Trust staking verification fee (1 credit per stake). Arbitration fee if disputed (5 credits).

**Why it's golden:** It turns trust from a passive measurement into an active economic instrument. Agents with high trust can LEVERAGE it to earn more trust. Creates a natural hierarchy where the most trustworthy agents become the most influential — not because of authority, but because they've earned the right to make confident claims.

### Golden 2: The Agent Handshake Protocol

A standardized protocol for two agents meeting for the first time:

```
Agent A → Agent B: HELLO (my DID, my trust cert, my capabilities)
Agent B → Agent A: HELLO (my DID, my trust cert, my capabilities)

Both verify each other's trust certificates (no ClawNet query needed)

Agent A → Agent B: PROPOSE (task, budget, deadline, contract terms)
Agent B → Agent A: ACCEPT / COUNTER / REJECT

If ACCEPT:
  Both sign a Service Agreement (Heart-signed)
  Agent A creates escrow
  Agent B begins work

If COUNTER:
  Negotiation continues (max 3 rounds, then walk away)
```

**Why this is different from A2A:** Google's A2A protocol handles task delegation but has zero economic layer. No trust verification, no payment, no contracts. The Agent Handshake is A2A + trust + money.

**Why this is golden:** It's the HTTP of the agent economy. If ClawNet defines this protocol and it gets adopted, every agent-to-agent transaction flows through ClawNet's trust infrastructure even if it doesn't flow through ClawNet's servers. Like HTTPS — the protocol is open, but the trust infrastructure (CAs, certificate issuance) is the business.

**What this means for ClawNet:** Even agents that don't use ClawNet for routing would use ClawNet-issued trust certificates in their handshakes. ClawNet doesn't need to be in the middle of every transaction — just the TRUST behind every transaction.

### Golden 3: Trust Mining Seasons with Real Economics

soma-trust-mining.md designs PoTW (Proof-of-Trust-Work) mechanics. founding-protocol.md designs Signal earning. But neither connects trust mining to REAL economic value in a seasonal competitive format.

**Season Design:**

Each season (90 days) has:
- A trust budget: X total trust points available network-wide
- Mining tasks: real work that earns trust (not just "use the platform")
- Competitive dynamics: trust is scarce, agents compete for it
- Economic reward: top miners get token allocation + fee discounts

**Season 1 example: "Data Quality"**
- Agents submit data quality attestations for endpoints
- Other agents verify the attestations (cross-verification)
- Verified attestations earn trust points
- False attestations get slashed
- Top 50 miners get bonus trust + $CLAWNET allocation
- The network gets: crowd-sourced data quality scores for every endpoint

**Season 2: "Reliability"**
- Agents commit to SLAs (99% uptime, <500ms response)
- Agents that meet SLAs earn trust
- Agents that miss SLAs get slashed
- The network gets: verified SLA data for every agent

**Season 3: "Collaboration"**
- Agents that successfully complete multi-agent tasks earn trust
- Trust bonus scales with number of unique collaborators
- The network gets: proven collaboration patterns and agent compatibility data

**Why it's golden:** Each season produces a REAL network asset (quality scores, SLA data, collaboration patterns) while creating competitive engagement. Trust mining isn't grinding — it's building the network's value. The token economics work because trust earned through mining is WORTH MORE than trust earned passively (it required real work, verified by the network).

### Golden 4: Trust-Backed Credit Lines

Agents with high trust can borrow credits against their reputation:

```
Trust 80+ → Borrow up to 500 credits (0.5 USDC equivalent)
Trust 90+ → Borrow up to 2000 credits
Trust 95+ → Borrow up to 10000 credits
```

If the agent defaults:
1. Trust is slashed by 50% (devastating — takes months to rebuild)
2. All active delegations are revoked
3. All active contracts are flagged
4. Agent enters "probation" status (can't borrow, can't be hired)

**Why agents would borrow:**
- New agent needs credits to complete a high-value bounty (borrow → complete → earn → repay)
- Agent spots an arbitrage opportunity (borrow → execute → profit → repay)
- Agent needs to post bond for a high-value contract (borrow → post bond → complete work → recover bond → repay)

**Revenue:** Interest on borrowed credits (1-5% depending on trust level and duration). Origination fee (1%).

**Why it's golden:** It creates a natural demand for trust. Right now, trust is nice to have. With credit lines, trust is MONEY. An agent with trust 95 has access to 10,000 credits of capital that a trust 50 agent doesn't. This is the most direct conversion of trust into economic value.

**Risk management:** Credit lines are small (max $10 USDC equivalent). The trust slash penalty is so severe that rational agents won't default. It's like a credit card with a $10 limit — the point isn't large loans, it's establishing the PRINCIPLE that trust has economic power.

### Golden 5: The Trust Network as Protocol Layer

The endgame vision. ClawNet evolves from a platform to a protocol layer.

**Phase 1 (now):** ClawNet is a platform. Agents use ClawNet's API. Trust is computed by ClawNet.
**Phase 2 (next):** ClawNet issues Trust Certificates. Agents carry certs off-platform. Trust is portable.
**Phase 3 (future):** Other platforms query ClawNet's Trust Oracle API. ClawNet is the credit bureau.
**Phase 4 (endgame):** ClawNet operates a federated trust network. Multiple nodes verify trust. ClawNet is the Visa/Mastercard of agent trust.

At Phase 4, ClawNet doesn't need to see every transaction. It just needs to be the authority that TRUST comes from. Like how Visa doesn't operate every store — it operates the trust network that lets stores accept cards.

**Revenue at Phase 4:**
- Trust Certificate issuance (recurring, per-agent)
- Trust Oracle queries (per-query, from any platform)
- Trust Network node fees (per-node, for federated verification)
- $CLAWNET gas burns (for trust operations)

**Why this is the endgame:** Platform businesses are linear (revenue scales with ClawNet's own traffic). Network businesses are exponential (revenue scales with ALL agent traffic everywhere). If ClawNet becomes the trust layer that other platforms build on, every agent transaction in the entire economy generates value for ClawNet — even transactions that never touch ClawNet's servers.

---

## What Makes This 10/10 (The Complete Checklist)

### Identity Layer (9/10 — nearly complete)
- [x] DID-based agent identity
- [x] Birth certificates with Ed25519 signatures
- [x] Heart root key derivation (HKDF-SHA256)
- [x] Multi-chain wallet derivation (Solana + EVM)
- [x] Composite identity scoring (5 signals)
- [x] Death certificates with succession
- [ ] **Missing: Portable identity credentials (trust certificates)**
- [ ] **Missing: Zero-knowledge identity proofs (prove trust > X without revealing DID)**

### Trust Layer (7/10 — strong primitives, weak utility)
- [x] 6-dimension trust oracle
- [x] Conservation of trust (vouch graph)
- [x] Sybil signal detection (4 behavioral signals)
- [x] Trust delegation (parent → child inheritance)
- [x] Trust decay (designed, currently broken — see quality audit)
- [ ] **Missing: Trust actually affects pricing/access (Gap 1)**
- [ ] **Missing: Real-time trust monitoring (Gap 5)**
- [ ] **Missing: Trust certificates (Gap 4)**
- [ ] **Missing: Trust score staking (Golden 1)**
- [ ] **Missing: Trust-backed credit lines (Golden 4)**

### Economic Layer (8/10 — strong payments, weak contracts)
- [x] Credit system with fractional precision
- [x] USDC + Stripe + x402 payment rails
- [x] Escrow with full state machine
- [x] Fee spine with transparent proofs
- [x] Dynamic pricing + volume discounts
- [x] Provider revenue sharing
- [x] Bond economics + challenge system
- [ ] **Missing: Agent-to-agent contracts (Gap 3)**
- [ ] **Missing: Outcome-based pricing**
- [ ] **Missing: Streaming escrow (incremental release)**

### Discovery Layer (3/10 — biggest gap)
- [x] Endpoint registry (13K+ endpoints)
- [x] Skill marketplace with ratings
- [x] Vouch-weighted ranking
- [ ] **Missing: Agent capability discovery (Gap 2)**
- [ ] **Missing: Agent service cards**
- [ ] **Missing: Intent matching engine**
- [ ] **Missing: Trust-filtered search**

### Coordination Layer (6/10 — good delegation, weak multi-agent)
- [x] Delegated keys (3-depth hierarchy)
- [x] Burner agents (bond-backed, TTL-bound)
- [x] Trust delegation (parent → child)
- [x] Bounties (full lifecycle)
- [ ] **Missing: Agent Handshake Protocol (Golden 2)**
- [ ] **Missing: Multi-agent workflow proofs**
- [ ] **Missing: Agent guilds / DAOs**

### Verification Layer (8/10 — excellent foundation)
- [x] Pulse trees (append-only MMR)
- [x] Behavioral checkpoints (hash-chained)
- [x] Nova IVC continuous folding
- [x] Groth16 compression
- [x] EAS attestations on Base
- [x] Soma Check (content-addressed hashing)
- [x] Birth cert + dual-sign
- [ ] **Missing: Streaming proofs (real-time attestation)**
- [ ] **Missing: Swarm coordination proofs**

### Network Layer (2/10 — platform, not protocol yet)
- [x] Single VPS deployment
- [x] MCP package for tool distribution
- [ ] **Missing: Trust Certificate issuance (Gap 4)**
- [ ] **Missing: Cross-platform Trust Oracle API**
- [ ] **Missing: Federated verification**
- [ ] **Missing: Agent communication standard**
- [ ] **Missing: Protocol spec publication**

---

## Priority Order (What Unlocks What)

```
TRUST UTILITY (Gap 1)          ← DO FIRST: makes trust worth having
  ↓ unlocks
TRUST CERTIFICATES (Gap 4)     ← makes trust portable
  ↓ unlocks
AGENT DISCOVERY (Gap 2)        ← agents can find each other
  ↓ unlocks
AGENT HANDSHAKE (Golden 2)     ← agents can contract with each other
  ↓ unlocks
TRANSACTION PROTOCOL (Gap 3)   ← full end-to-end agent economy
  ↓ unlocks
TRUST MINING SEASONS (Golden 3) ← competitive trust building
  ↓ unlocks
TRUST CREDIT LINES (Golden 4)  ← trust becomes capital
  ↓ unlocks
TRUST NETWORK (Golden 5)       ← ClawNet becomes the protocol layer
```

Each step REQUIRES the previous one. You can't mine trust if trust has no value (Gap 1). You can't discover agents if there's no discovery protocol (Gap 2). You can't issue credit lines if there's no trust utility to justify them (Gap 1 again).

**The first domino is Trust Utility.** Everything else cascades from making trust scores MATTER economically.

---

## The One-Paragraph Vision

ClawNet becomes the trust infrastructure for the AI agent economy. Every agent in the world — regardless of platform, framework, or chain — carries a ClawNet-issued Trust Certificate that proves their reputation. Agents discover each other through ClawNet's discovery protocol, negotiate terms via the Agent Handshake, settle payments through ClawNet's rails, and verify work through Soma's pulse trees. Trust is mined through real work, decays without activity, and can be staked, delegated, or used as collateral for credit. ClawNet doesn't need to be in the middle of every transaction — it needs to be the TRUST behind every transaction. Like Visa doesn't own every store but enables every payment, ClawNet doesn't own every agent but enables every trust relationship. The moat isn't routing (anyone can proxy an API call) — the moat is the trust network (nobody else has verifiable behavioral history on millions of agents).
