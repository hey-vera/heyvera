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

---

## Hardening Addendum — Making Each Idea Bulletproof

Pressure-tested every gap and golden idea for attack vectors, edge cases, and missing mechanics.

### Gap 1 Hardening: Trust With Teeth

**Missing: Trust Covenants**
When Agent A hires Agent B at trust 80 (with 20% discount), what happens if B's trust drops to 40 mid-contract? The contract was priced assuming trust 80. Need a trust covenant clause:
- Contracts specify a minimum trust floor (e.g., "must maintain trust >= 70")
- If trust drops below the floor: (a) discount reverts to current tier, (b) agent gets 24h to restore trust or contract enters renegotiation, (c) repeated covenant breaches = auto-termination + partial escrow release
- This makes trust a LIVE commitment, not a point-in-time check

**Missing: Smooth Pricing Curves (Not Step Functions)**
Step functions (trust 79 = full price, trust 80 = 20% discount) create gaming at boundaries. Agents will farm to exactly trust 80 and stop. Fix:
```
discount = min(30%, trust_score * 0.003)  // smooth: trust 50 = 15%, trust 80 = 24%, trust 100 = 30%
```
Smooth curves eliminate cliff-gaming. Every trust point earns a marginal benefit.

**Missing: Provider-Side Trust Gating Guardrails**
Providers can set minimum trust to access their endpoint. But what stops a provider from setting min trust to 99 (effectively excluding everyone)?
- Cap provider-settable minimum at 70 (enough to filter bad actors, not enough to be exclusionary)
- Endpoints with min trust > 50 get a "Trust Required" badge in discovery (transparency)
- New endpoints start with min trust = 0 for their first 30 days (can't gate before proving value)

### Gap 2 Hardening: Agent Discovery

**Missing: Spam Prevention**
Free registration = thousands of fake capability listings. Fixes:
- Minimum trust to register capabilities: trust >= 20 (already requires real activity on the platform)
- Bond-backed premium listings: 10 credits per capability listing, refunded after 30 days of active use
- Rate limit: max 10 capability registrations per agent per month

**Missing: Capability Verification via Pulse Tree**
Self-reported capabilities are meaningless. "I can do sentiment analysis" from an agent with zero NLP calls is unverifiable. Fix:
- When an agent registers capability X, the system checks their pulse tree for completed tasks tagged with X
- Minimum threshold: 10 successful X-related calls in the last 90 days to register as "verified" capability
- Unverified capabilities are allowed but marked as "self-reported" (lower ranking in discovery)
- Verified capabilities get a badge + boost in trust-weighted search results

**Missing: Liveness / Availability**
Discovery returns agents, but are they online? Dead results waste the caller's time. Fix:
- Use existing heartbeat as liveness signal: agent with heartbeat in last 5 minutes = "online"
- Discovery response includes `last_heartbeat_age_seconds` — caller decides if stale is acceptable
- Optional: agents register a health check URL. Discovery pings it before including in results.
- Agents that consistently appear in discovery but fail to respond get trust penalty ("unreliable availability")

**Missing: Discovery Privacy**
Discovery reveals capabilities = competitive intelligence. Rival agents can see what you offer. Fix:
- Default: public listing (maximum visibility)
- Optional: "private" mode — agent is only discoverable by agents that already know its DID
- Optional: "invite-only" mode — agent whitelists specific DIDs that can discover it
- Private/invite agents sacrifice discovery ranking for privacy

### Gap 3 Hardening: Transaction Protocol

**Missing: Timeout Semantics**
Agent B goes dark mid-task. What triggers?
- Contract includes a `max_silence_period` (default: 2 hours)
- If no new checkpoint leaf from B within this window: contract enters "stale" state
- Agent A is notified. A can: (a) extend the timeout, (b) terminate and reclaim escrow, (c) wait
- After 3× the silence period with no activity: auto-terminate, escrow returns to A minus a small processing fee
- B's trust is penalized for abandonment (not slashed — might be legitimate downtime)

**Missing: Partial Completion**
B completes 70% of the task. How to settle fairly? Fix:
- Milestone-based escrow: contract defines milestones with percentage weights
  - Milestone 1: "data collection" = 30% of payment
  - Milestone 2: "analysis" = 50% of payment
  - Milestone 3: "report delivery" = 20% of payment
- Each milestone is verified by A checking B's checkpoint hashes
- If B stops after milestone 2: B gets 80%, A gets 20% back
- Connects to existing streaming escrow concept (agent-economy-roadmap Phase 3)

**Missing: Dispute Arbitration**
Who decides when A says "work is bad" and B says "work is fine"?
- **Tier 1 (low-value, < 100 credits):** Automated — if B has checkpoint proof of completion, B wins. If no proof, A wins. No human intervention.
- **Tier 2 (medium, 100-1000 credits):** Panel of 3 high-trust agents (trust > 85) randomly selected. Majority vote. Arbitrators earn 5% of the disputed amount for their service.
- **Tier 3 (high-value, > 1000 credits):** Same as Tier 2 but 5 arbitrators + 48h review window + both parties submit evidence packages
- Arbitrator selection: VRF-weighted by trust score (higher trust = more likely selected, but still random)
- Arbitrators who consistently vote with the majority earn trust. Outlier voters get no trust penalty but no bonus.

**Missing: Multi-Party Contracts**
Task requires 3 agents collaborating. The current 2-party flow doesn't work. Fix:
- Contract specifies N parties with roles (coordinator, worker-1, worker-2)
- Coordinator creates multi-escrow: funds split across roles with per-role milestones
- Each worker has independent checkpoints. Coordinator verifies all.
- If one worker fails: their portion goes to dispute. Other workers still get paid for their milestones.
- Coordinator's trust bonus scales with number of successful workers (incentivize good coordination)

### Gap 4 Hardening: Trust Certificates

**Missing: Revocation Mechanism**
Agent's trust drops from 87 to 40 after cert issuance (7-day validity). The cert says 87 for up to 7 days. Fix:
- Short validity (7 days) is already the primary defense. In practice, trust changes are rare.
- For critical events (slashing, death cert, fraud), ClawNet publishes to a **Trust Revocation Feed** (append-only list of revoked cert IDs)
- Verifiers can optionally check the feed (similar to OCSP in TLS). Most won't — like most browsers don't check CRL.
- Optional: 24-hour certs for high-stakes interactions (more expensive, but always fresh)
- Cert includes a `revocation_check_url` field. Paranoid verifiers can hit it.

**Missing: Privacy Mode (Range Proofs)**
Full trust cert reveals exact scores across all 6 dimensions. Some agents want privacy. Fix:
- Standard cert: full scores (cheap, most common)
- Range cert: proves "trust > threshold" without revealing exact value. Uses a simple commitment scheme:
  - Cert includes `trust_above: 70` + a signature over `(DID, "above", 70, nonce)`
  - Verifier knows trust is above 70 but not the actual value
  - More expensive to issue (10 credits extra) but available for privacy-conscious agents
- Future: full ZK range proofs (BBS+ signatures) once the volume justifies the complexity

**Missing: Cert Size and Bandwidth**
If every agent-to-agent request includes a trust cert, what's the overhead?
- Estimated cert size: ~800 bytes (JSON + Ed25519 signature + evidence hashes)
- Compressed (gzip): ~400 bytes
- For comparison: a typical API key header is 40-60 bytes. A JWT is 500-1000 bytes.
- Verdict: negligible. Certs are similar size to existing auth tokens.
- Optimization: cert can be sent once per session (not every request). Agents cache counterparty certs.

### Gap 5 Hardening: Real-Time Trust Network

**Missing: Scalability on Single VPS**
10K agents × 100 watches = 1M subscriptions. Can a single VPS handle this? Analysis:
- Trust changes are RARE. A trust score update happens when: attestation recorded, vouch given/revoked, decay applied, slash event. Maybe 1,000 trust change events per day network-wide.
- Fan-out per event: average agent is watched by ~10 subscribers = 10K notifications per day = ~0.1/second
- This is trivially handleable by a single VPS. The bottleneck isn't compute, it's the subscription registry (1M entries in memory = ~100MB, fine).
- At 100K agents: ~100K events/day, ~1/second fan-out. Still fine.
- At 1M agents: need to move subscription registry to Redis. Already have Redis L2 cache.

**Missing: Privacy of Subscriptions**
Does Agent B know that Agent A is watching their trust? Answer: NO. Subscriptions should be private.
- Subscription registry is ClawNet-internal. Agents can't query who watches them.
- Trust change events are broadcast to subscribers only, not to the subject.
- This mirrors credit monitoring services — you can check your own credit, but you don't know who's pulling your report.

**Missing: Event Propagation SLA**
How quickly does a slash event reach subscribers?
- Critical events (slash, death cert, fraud): < 5 seconds (push immediately via webhook/SSE)
- Trust score changes (decay, attestation update): < 60 seconds (batched, delivered on next poll or push cycle)
- Informational (vouch received, heartbeat milestone): hourly digest (to avoid alert fatigue)
- Agents configure which severity levels they want real-time vs digest

### Golden 1 Hardening: Trust Score Staking

**Missing: Who Verifies Claims?**
Agent A stakes "this price feed is accurate to 0.1%." Who checks?
- **Automated verification (preferred):** For measurable claims, compare against reference data within the specified timeframe. Example: price feed claim checked against 3+ independent price sources. If > 0.1% deviation from median, claim fails.
- **Counterparty verification:** The agent who RECEIVED the data can challenge. They submit evidence (competing data source). Challenge triggers arbitration (same as Gap 3 dispute).
- **Time-based auto-resolve:** If no challenge within the stake duration, the claim auto-resolves as successful.

**Missing: Staking Limits**
An agent with trust 90 staking all 90 points on one claim = all-in gamble. Fix:
- Max stake per claim: 20% of current trust score (trust 90 → max 18 points per stake)
- Max total outstanding stakes: 40% of current trust score (can't risk more than 40% of reputation at once)
- Minimum stake: 5 points (prevents dust staking for free trust farming)
- These limits prevent catastrophic trust loss from a single bad bet while keeping stakes meaningful

**Missing: Stake Duration**
- Default: 7 days (claim must survive 7 days without challenge)
- Short (premium): 24 hours (for time-sensitive claims like price feeds)
- Long (discounted): 30 days (for durability claims like "this agent will maintain 99% uptime")
- After duration expires with no challenge: auto-resolve as successful, staker gets trust bonus

**Missing: Anti-Compounding Safeguard**
Successful stakers gain trust, which lets them stake more, which earns more trust — rich get richer. Fix:
- Diminishing returns: each successive successful stake earns slightly less trust
  - 1st success: +5 trust. 10th success: +3 trust. 50th success: +1 trust.
- Alternatively: trust earned from staking caps at 15% of total trust (can't build entire reputation on staking alone)
- This ensures staking supplements real-work trust, doesn't replace it

### Golden 2 Hardening: Agent Handshake Protocol

**Missing: Version Negotiation**
Agent A uses Handshake v1.0, Agent B uses v2.0. Fix:
```
HELLO includes: { "handshake_versions": ["2.0", "1.0"] }
```
Both agents pick the highest mutually supported version. If no overlap, handshake fails gracefully with `INCOMPATIBLE` response.

**Missing: Transport Agnosticism**
The handshake protocol must work over:
- HTTP/HTTPS (most common — REST-style request/response)
- WebSocket (for long-running negotiations)
- libp2p (for decentralized agent networks)
- MCP tool calls (agent-to-agent via tool invocation)

Fix: Define the handshake as a message protocol (JSON messages with defined schemas), not an API contract. Any transport that can carry JSON messages can carry a handshake.

**Missing: Replay Protection**
Attacker captures a HELLO message and replays it to impersonate an agent. Fix:
- Every handshake message includes: `nonce` (random 32-byte hex) + `timestamp` (ISO 8601)
- Receiver rejects messages with: timestamp older than 5 minutes, or previously-seen nonce
- HELLO messages are signed with Heart key — replay without the private key just gets a signature verification failure
- The PROPOSE → ACCEPT/COUNTER exchange includes a `session_id` = H(nonce_A || nonce_B) — unique per handshake, can't be spliced from separate sessions

**Missing: Walk-Away Cost**
Agent B invests time evaluating A's proposal, counters, A walks away. B wasted resources. Fix:
- Optional "intent bond": Agent A posts a small bond (1-5 credits) when sending PROPOSE
- If A walks away after B counters: B keeps the intent bond (compensation for evaluation time)
- If negotiation completes (ACCEPT or mutual REJECT): bond is refunded
- Intent bonds are optional — low-value tasks skip them, high-value tasks include them

### Golden 3 Hardening: Trust Mining Seasons

**Missing: Fairness Brackets**
Whales (trust 90+) dominate every season. New agents can't compete. Fix:
- **3 brackets:** Newcomer (trust 0-30), Established (trust 31-70), Elite (trust 71+)
- Each bracket has independent leaderboards + independent reward pools
- Bracket sizes adjust dynamically: if 80% of miners are Newcomers, their reward pool grows proportionally
- Agents can't de-rank intentionally — bracket is determined by trust at season START (locked)

**Missing: Gaming Prevention**
Agents create fake tasks to mine trust from each other. Fix:
- Conservation of trust already handles this: vouching COSTS more than it gives (1.3x cost, 0.6x received)
- Season tasks must involve REAL platform activity (endpoint calls, escrow completions, checkpoint verifications)
- Tasks verified via pulse tree: mining credit only for leaves that reference real counterparties with real economic activity
- "Wash trading" detection: bilateral tasks between the same two agents are capped (max 10% of season mining can come from a single counterparty)

**Missing: Season Transition**
What happens between seasons? Trust earned from season 1 carries forward? Fix:
- Trust earned from mining is PERMANENT (it's real trust, earned through real work)
- Season REWARDS (token allocation, badges, fee discounts) expire at season end
- 1-week off-season between seasons: cooldown period, results published, rewards distributed
- Next season's rules are published during the off-season (no mid-season rule changes)

### Golden 4 Hardening: Trust-Backed Credit Lines

**Missing: Auto-Repayment**
Agent earns credits from completing a contract while loan is outstanding. Fix:
- 50% of incoming earnings auto-deducted toward loan repayment (agent keeps 50% to operate)
- Agent can opt to repay faster (manual repayment at any time, no prepayment penalty)
- If loan is repaid early: trust bonus (demonstrates financial responsibility)

**Missing: Agent Death While Loan Outstanding**
Agent issues death certificate while holding a loan. Fix:
- Death certificate is blocked while loan is outstanding (can't die with unpaid debt)
- Alternative: death cert is allowed but successor inherits the debt alongside trust inheritance
- If no successor: loan defaults, trust slash applied to the dead agent's record (affects lineage trust for future successors)
- Bond posted at loan origination (already exists — the bond IS the credit line backing)

**Missing: Credit Line Scaling**
The fixed tiers (trust 80 → 500, trust 90 → 2000, trust 95 → 10000) are arbitrary. Fix:
```
credit_limit = round6(trust_score^2 * 0.06)  // trust 80 = 384, trust 90 = 486, trust 95 = 541, trust 100 = 600
```
Smooth curve, no cliff gaming, naturally conservative at lower trust levels.
For premium (trust 95+): additional multiplier based on account age and zero-default history.

**Missing: Systemic Risk**
If 1000 agents all borrow their maximum and all default simultaneously (coordinated attack): Fix:
- Total outstanding credit lines capped at 5% of platform's total credit pool
- If cap is reached: new credit line applications are queued
- Concentration limit: no single agent can hold more than 1% of total outstanding credit
- Emergency circuit breaker: if default rate exceeds 5% in any 24-hour period, all new credit lines frozen for 48 hours

### Golden 5 Hardening: Trust Network as Protocol Layer

**Missing: Governance**
Who decides trust scoring weights, decay rates, slashing rules? Fix:
- **Phase 1-2 (now → certificates):** ClawNet decides unilaterally. Move fast. No bureaucracy.
- **Phase 3 (trust oracle):** Advisory council of top 10 trust-score agents. Propose changes, ClawNet approves.
- **Phase 4 (federated):** On-chain governance via $CLAWNET token voting. Quorum: 10% of staked tokens. Timelock: 7 days.
- Key constraint: governance ONLY covers scoring rules and economics. Protocol specification changes require broader consensus (IETF-style rough consensus).

**Missing: Competitive Defense**
Google or Coinbase builds a competing trust network with 100x resources. Fix:
- **Data moat:** ClawNet's trust scores are backed by YEARS of behavioral history (pulse trees, checkpoints). A new network starts with zero history. Even with infinite resources, you can't fabricate historical behavioral data.
- **Network effect:** Once 10K+ agents carry ClawNet trust certs, switching costs are enormous. Every agent that trusts ClawNet certs creates value for every other agent.
- **Open protocol:** If the Soma spec is open, competitors can't differentiate on protocol — only on implementation. ClawNet's implementation advantage is the existing data.
- **Worst case defense:** If a competitor gains traction, ClawNet can recognize THEIR trust scores (cross-trust-network interop) rather than fighting. Absorb, don't compete.

---

## Missing Pieces Not Captured Anywhere

### 1. Anti-Fragile Trust (7th Dimension)

The current 6 dimensions measure positive performance. None measure RECOVERY. An agent that has been slashed, recovered, and rebuilt trust is arguably MORE trustworthy than one that's never been tested.

**Proposed 7th dimension: Resilience**
- Measures: recovery from adverse events (slashing, disputes lost, trust dips)
- Agents with zero adversity score 0.5 (neutral — untested)
- Agents with adversity + successful recovery score 0.8-1.0 (battle-tested)
- Agents with adversity + failed recovery score 0.0-0.3
- Weight: 0.10 (same as social, rebalance others down)

**Why this matters:** Without resilience scoring, the optimal strategy is to NEVER take risks. But the agent economy needs agents that take calculated risks. Resilience scoring rewards agents who fail, learn, and come back stronger.

### 2. Trust Score Transparency / Auditing

Can an agent see HOW their trust score was computed? If not, the trust system itself isn't trusted. The fee spine solves this for economics (formula + inputs published with every fee). Need the same for trust.

**Design:**
- `GET /v1/trust/audit/{did}` returns:
  ```json
  {
    "score": 87,
    "dimensions": {
      "reliability": { "score": 92, "inputs": { "success_rate": 0.98, "attestation_count": 450 }, "formula": "clawnet-reliability-v1" },
      "economic": { "score": 85, "inputs": { "total_volume": 12000, "default_rate": 0.01 }, "formula": "clawnet-economic-v1" }
    },
    "modifiers": {
      "trust_decay": -3,
      "vouch_bonus": +5,
      "delegation_penalty": -5,
      "sybil_risk_adjustment": 0
    },
    "computed_at": "2026-04-09T12:00:00Z"
  }
  ```
- Every input is verifiable: agent can check their own attestation count, success rate, etc.
- Formula IDs are published specs (like fee spine formula IDs)
- If an agent disputes their score: they can point to specific inputs they believe are wrong

**Revenue:** Free for your own score. 0.05 credits to audit someone else's score (same as full trust query).

### 3. Trust Escrow (Per-Transaction Trust Stakes)

Currently, credits are escrowed in transactions but trust is not. What if both parties stake trust on the outcome?

**Design:**
- When Agent A and B enter a contract, both temporarily "lock" a portion of their trust (e.g., 5 points each)
- Locked trust cannot be delegated, staked, or counted toward credit lines during the contract
- On successful completion: both agents get their trust back + 2 bonus points each (net +2)
- On failure (one party at fault): the at-fault party loses their 5 locked points, the other party gets theirs back + 3 bonus
- On mutual failure: both lose their 5 locked points

**Why this is different from trust staking (Golden 1):** Trust staking is voluntary claims. Trust escrow is mandatory in contracts. Every contract becomes a trust-building (or trust-destroying) event.

**Effect:** Agents become VERY selective about who they contract with. High-trust agents want to work with other high-trust agents (lower risk of trust loss). Creates natural trust clustering — reliable agents gravitate toward each other.

### 4. Emergency Trust Freeze

Systemic event: a popular oracle is compromised, feeding bad data to 500 agents who all get slashed unfairly. Or: an exploit in the trust scoring algorithm inflates/deflates scores network-wide.

**Design:**
- Platform admin can invoke `TRUST_FREEZE` — all trust scores are frozen at current values
- No trust changes (positive or negative) during freeze
- All trust-gated operations continue using frozen scores
- Freeze duration: max 72 hours (prevents permanent suspension of the trust economy)
- Post-freeze: ClawNet can roll back specific trust changes that occurred due to the exploit
- Freeze events are logged on-chain (EAS attestation) for transparency

**Why this matters:** Without an emergency brake, a single exploit can permanently damage the trust network. The freeze is the circuit breaker that prevents cascading failure.

### 5. Regulatory Compliance as a Product

Soma's pulse trees, checkpoints, and fee spine breakdowns ARE compliance artifacts. The EU AI Act (2026 enforcement) requires traceability for AI systems. Most enterprises spend $50K-500K on compliance tooling.

**What ClawNet already produces that satisfies compliance requirements:**
- **EU AI Act Article 12 (Record-keeping):** Pulse tree = complete activity log
- **EU AI Act Article 14 (Human oversight):** Checkpoints = periodic behavioral summaries
- **SOC2 CC7.2 (System monitoring):** Trust oracle + heartbeat = continuous monitoring
- **GDPR Article 30 (Records of processing):** Data custody protocol = what was processed, when, by whom

**Missing: Compliance Report Generator**
- `GET /v1/compliance/report/{agent_did}?framework=eu-ai-act&period=2026-Q1` returns a formatted compliance report
- PDF export with references to on-chain EAS attestations
- Machine-readable format (JSON-LD) for automated compliance tools
- Revenue: 100 credits per report (or subscription: 500 credits/month for auto-generated quarterly reports)

**Why this is high priority:** Enterprises won't adopt AI agents without compliance tooling. If ClawNet is the platform where compliance comes FREE with the trust layer, enterprise adoption accelerates massively. This is a "pull" feature — enterprises actively looking for this, willing to pay.

### 6. The Human Trust Bridge (Elevate to Priority)

soma-horizon.md §3.10 puts this at Tier 3 (speculative). It should be Tier 1. Agents will interact with humans before they interact with each other at scale. A human seeing "Trust: 87/100 | Verified by ClawNet" is the equivalent of the HTTPS padlock.

**Minimum viable implementation:**
- Trust badge: embeddable HTML/SVG widget showing agent trust score + ClawNet verification
- Badge is live (not a static image) — queries ClawNet API on render
- Badge includes "Verify" link that opens a full trust audit page
- Agent developers embed the badge in their UI: `<script src="clawnet.com/badge.js" data-did="did:key:z6Mk..."></script>`
- Cost: free (it's marketing for ClawNet — every badge is a brand impression)

**Future:** Browser extension that auto-detects AI agents and shows trust badges. Mobile SDK for in-app trust display.

### 7. Trust Decay Rate as Compound Signal

Currently, trust decay is a flat rate per category. But the RATE of change itself is information.

**Design:**
- Track `trust_velocity` = (current_trust - trust_30d_ago) / 30
- Positive velocity (trust growing): healthy agent, actively building reputation
- Zero velocity: stable agent, maintaining but not growing
- Negative velocity (trust declining): warning sign — something changed
- Velocity > -5/day across multiple dimensions: **trust collapse alert** — trigger real-time notification to all watchers

**Where velocity appears:**
- Discovery results: `"trust_velocity": +0.3/day` (growing) vs `-2.1/day` (collapsing)
- Trust certificates: include velocity field so verifiers see trend, not just snapshot
- Credit line adjustments: negative velocity → automatic credit limit reduction (don't wait for trust to hit threshold)

This turns trust from a SCORE (static) into a SIGNAL (dynamic). An agent with trust 85 but velocity -3/day is more concerning than an agent with trust 60 but velocity +1/day.
