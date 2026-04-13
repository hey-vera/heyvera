# Proof-of-Delivery — architecture + implementation roadmap

**Status:** internal strategy + engineering spec. Captures the three groundbreaking ideas identified in 2026-04-04 x402 ecosystem research. Written to be picked up months from now without context loss.

**Thesis (from `brainstorm.md`):** x402 settles payment, but cannot prove delivery. Every competing protocol (MPP, AP2, TAP, ACP, L402) focuses on payment rails or authorization. **Nobody is building the cryptographic honesty layer.** That's our adjacent moat.

**Pitch:** *"x402 says money moved. Soma proves data was real. Together: trustless agent commerce."*

Three tracks below, prioritized by defensibility × time-to-ship × leverage.

---

## Track 1 — EigenLayer AVS for Soma attestation (highest leverage)

Package Soma's cert chain as an Actively Validated Service on EigenLayer. Restaked ETH slashes providers who ship bad data or lie about "unchanged."

### Why this is the play

- ERC-8004 (live Jan 2026, 20k agents registered) solves agent identity. Nobody solves **economic slashing for delivery quality.**
- Shared security is the breakthrough: we don't have to bootstrap our own stakers — we borrow Ethereum's security budget via EigenLayer.
- No competitor can copy this without rebuilding Soma from scratch. Soma cert chain IS the AVS's validation logic.
- Slashing → real economic skin in the game for providers → trust becomes provable, not promised.

### Architecture sketch

```
┌────────────────────────────────────────────────────────────────┐
│  Restakers (ETH holders delegating to our AVS operators)       │
└────────────────────────────────────────────────────────────────┘
                              ↓ slashing authority
┌────────────────────────────────────────────────────────────────┐
│  AVS Operator Set (runs Soma sense, watches providers)         │
│  - Each operator runs independent Soma sensorium               │
│  - Sees birth certs from providers                             │
│  - Verifies hash claims against upstream truth                 │
│  - Votes on delivery verdict (k-of-n threshold)                │
└────────────────────────────────────────────────────────────────┘
                              ↓ attestations
┌────────────────────────────────────────────────────────────────┐
│  Providers (staked, subject to slashing)                       │
│  - Serve x402 ETag endpoints                                   │
│  - Emit Soma birth certs with every response                   │
│  - Stake $USDC or restaked $ETH as bond                        │
└────────────────────────────────────────────────────────────────┘
                              ↓ verified calls
┌────────────────────────────────────────────────────────────────┐
│  Agents (pay for data, receive slashable guarantee)            │
└────────────────────────────────────────────────────────────────┘
```

### Slashing conditions (unambiguous, on-chain verifiable)

1. **Freshness lie:** provider returns `{unchanged: true}` with hash H at time T, but hash H was emitted at T-N where N exceeds claimed TTL → slash
2. **Data mismatch:** provider returns data D with hash H, but sha256(D) ≠ H → slash (provable from raw response)
3. **Cert forgery:** birth cert signature invalid against declared DID → slash
4. **Revocation violation:** provider uses revoked key to sign → slash
5. **Double-sign:** provider signs two different responses with same nonce → slash

Important: NON-slashing conditions include upstream provider failures, network errors, rate-limit 429s. We slash for **dishonesty**, not for **unavailability**.

### Implementation phases

**Phase 1 — AVS stub (off-chain, in-process)**
- Build slashing logic as a local verifier (no EigenLayer yet)
- Takes: Soma birth cert, claimed hash, observed response
- Returns: `{ valid: boolean, slashingCondition?: enum }`
- Artifact: `src/soma-avs/verifier.ts` + tests
- Dependencies: existing Soma birth cert + sense primitives
- **Purpose:** prove the logic works before touching restaking

**Phase 2 — Operator software**
- Daemon that runs sensorium + watches registered provider endpoints
- Polls endpoints, verifies certs, writes attestation receipts
- Agent-facing: queries AVS "is provider P trustworthy?" → returns operator consensus
- Artifact: `packages/soma-avs-operator/` (separate npm package)
- Dependencies: Phase 1 + threshold signature scheme

**Phase 3 — On-chain slashing contract**
- Solidity contract on Base holding provider stakes
- `submitSlashingProof(providerId, condition, evidence)` called by operator quorum
- Slashes stake, distributes to victim + operator rewards
- Artifact: `contracts/SomaAVS.sol` + Hardhat tests
- Dependencies: Phase 2 + legal review (staking is regulated)

**Phase 4 — EigenLayer integration**
- Register as an AVS on EigenLayer mainnet
- Operators opt in via EigenLayer interface
- Restakers delegate to our operator set
- Slashing goes through EigenLayer's slasher
- Artifact: EigenLayer AVS registration + docs
- Dependencies: Phases 1-3 complete + audit + operator recruitment

### Open questions

- Slashing rate: what % of stake per violation? EigenLayer standard is 4-10%.
- Threshold: k-of-n operators required to slash? (Suggested: 7-of-10 or 2/3+1)
- How to bootstrap operator set? First operators likely ClawNet-run until decentralized.
- Recovery window: how long can providers appeal before slash finalizes?
- Gas costs: slashing proofs must be cheap enough to not deter honest claims.

### Risks

- **Regulatory:** AVS slashing touches staking regulations (SEC, CFTC attention on restaking)
- **Operator collusion:** <33% malicious operators can't force bad slash, but can veto legit slash
- **Upstream truth problem:** for endpoints with no canonical truth (opinion, LLM output), "freshness" is the only verifiable property
- **Gas cost spiral:** if slashing proofs cost more than stake recovered, economic model breaks

### Dependencies on Soma scale testing

Must complete before Phase 2:
- Test B + Test E from `scale-test-plan.md` (delegation + chain verify) — determines operator cost per endpoint watched
- Receipt Layer Phase 2+ EAS anchoring — operators need permanent record of claims

---

## Track 2 — TEE-attested x402 ETag (enterprise tier)

Provider runs in TEE enclave (AWS Nitro, Intel TDX, AMD SEV). Hash signed with attested enclave key. Client gets hardware-rooted proof of "unchanged."

### Why this is the play

- Coinbase Agentic Wallets (Feb 2026) already uses TEEs for agent keys → pattern is mainstream, not exotic
- TEE attestation eliminates provider self-signing trust issue
- Pairs cleanly with AVS: TEE-attested providers get lower slashing risk (hardware enforces honesty)
- Premium monetization: "Verified-by-TEE" tier at 2-5x standard pricing

### Architecture sketch

```
┌────────────────────────────────────┐
│  Provider's TEE Enclave            │
│  ┌──────────────────────────────┐  │
│  │  Soma heart runs in enclave  │  │
│  │  - Signs hashes with enclave │  │
│  │    attestation key           │  │
│  │  - Key never leaves TEE      │  │
│  │  - Enclave measurement       │  │
│  │    published on registration │  │
│  └──────────────────────────────┘  │
└────────────────────────────────────┘
              ↓ response + TEE attestation
┌────────────────────────────────────┐
│  Client verifies:                  │
│  1. hash signature valid           │
│  2. signing key matches enclave    │
│     attestation                    │
│  3. enclave measurement matches    │
│     expected genome                │
└────────────────────────────────────┘
```

### Implementation phases

**Phase 1 — Nitro-only PoC**
- AWS Nitro is easiest (managed, widely available)
- Provider builds Nitro enclave image, attests at startup, signs hashes with enclave key
- Client verifies attestation doc against AWS root of trust
- Artifact: `examples/nitro-provider/` reference implementation
- Dependencies: Soma TEE attestation hooks (task #98 completed)

**Phase 2 — Multi-TEE (Nitro + TDX + SEV)**
- Abstract attestation verification behind common interface
- Support Intel TDX (newer Intel Xeon) + AMD SEV-SNP
- Artifact: `src/soma-tee/` with vendor-specific verifiers
- Dependencies: Phase 1 + test hardware access

**Phase 3 — Enclave measurement registry**
- Public registry of approved enclave images (hash → provider metadata)
- Providers publish measurements, clients verify against registry
- Artifact: `contracts/SomaEnclaveRegistry.sol` or off-chain registry
- Dependencies: Phase 2 + governance model for approvals

### Open questions

- Who approves enclave measurements? (Centralized = us, decentralized = hard)
- Performance cost of enclave: Nitro adds ~5-15% overhead per call
- Key rotation in TEE: how do providers rotate keys without downtime?
- Measurement staleness: vendor patches enclave runtimes, measurements change

### Risks

- **Vendor lock-in:** AWS/Intel/AMD are single points of trust
- **TEE vulnerabilities:** SGX has had major CVEs (Plundervolt, Foreshadow), TDX/SEV will too
- **Cost:** enclave instances 30-50% more expensive than regular VMs
- **UX complexity:** providers need devops maturity to run enclaves

### Dependencies

- Soma TEE attestation hooks (Chunk 6m, task #98) — DONE
- Real-world testing on Nitro infrastructure — NOT DONE
- Public measurement registry — NOT DONE

---

## Track 3 — Intent-based x402 (CowSwap for APIs)

Agents declare intents, solvers compete to fulfill. Warmest x402 ETag cache wins on price. Solvers stake Soma reputation.

### Why this is the play

- UniswapX / CoW Swap pattern proven at scale in DeFi
- Inverts current model: agents stop picking endpoints, endpoints compete for agents
- ClawNet's 14k+ endpoint registry becomes solver's arsenal (distribution moat)
- Combines naturally with x402 ETag (cache hits = cheapest solver wins)
- Nobody has shipped solver competition for API calls

### Architecture sketch

```
┌──────────────────────────────────────┐
│  Agent (intent creator)              │
│  Declares: {                         │
│    data_type: "btc_price_usdc",      │
│    max_staleness: 5s,                │
│    max_price: 0.01 USDC,             │
│    trust_level: "soma_verified",     │
│    deadline: now+30s                 │
│  }                                   │
└──────────────────────────────────────┘
               ↓ intent broadcast
┌──────────────────────────────────────┐
│  Solver Network                      │
│  - Solvers watch intent pool         │
│  - Each solver has cache + providers │
│  - Bid: offer data + price + freshness│
│  - Winner: cheapest + meets criteria │
└──────────────────────────────────────┘
               ↓ winning bid
┌──────────────────────────────────────┐
│  Agent accepts, pays, receives data  │
│  All wrapped in Soma cert chain      │
└──────────────────────────────────────┘
```

### Implementation phases

**Phase 1 — Intent protocol spec**
- Define intent schema (JSON + typed signing)
- Define solver bid schema
- Define settlement flow (who holds funds during auction)
- Artifact: `internal/intent-protocol-spec.md`
- Dependencies: none

**Phase 2 — Off-chain solver matching (centralized MVP)**
- ClawNet runs the intent pool + matcher
- Solvers register, submit bids via API
- Matcher picks winner by (price, freshness, reputation)
- Artifact: `src/routes/intents.ts` + solver SDK
- Dependencies: Phase 1 + reputation layer

**Phase 3 — Solver staking + reputation**
- Solvers stake USDC to register
- Bad fulfillment (late, wrong data) → reputation hit + stake slash
- Reputation feeds Soma cert chain
- Artifact: `contracts/SolverStaking.sol` + scoring engine
- Dependencies: Phase 2 + on-chain infrastructure

**Phase 4 — Decentralized solver network**
- Intent pool replicated across nodes (gossip)
- Solvers compete without central matcher
- Cross-chain settlement (agent on Solana, solver on Base)
- Artifact: p2p intent network + cross-chain bridge integration
- Dependencies: Phases 1-3 + L2/bridge integrations

### Open questions

- Batch solving: solver fulfills 100 intents atomically → lower gas, better pricing?
- MEV resistance: commit-reveal on intent, bids, execution
- Privacy: zero-knowledge intents (agent doesn't reveal what it wants until bid accepted)
- Solver bootstrap: who are first 5-10 solvers? Likely ClawNet + 2-3 trusted partners initially
- Settlement asset: USDC only, or multi-asset?

### Risks

- **Cold start:** no solvers → no fulfillment → no agents → no solvers
- **Solver MEV:** solver who sees intent can front-run at the provider layer
- **Gas cost for on-chain settlement per intent:** may need L2 or state channels
- **Matching algorithm games:** solvers can collude on pricing if matcher is predictable

### Dependencies

- x402 ETag production-ready (Tier 1 from x402-etag-strategy.md)
- Soma reputation scoring layer (not yet built)
- Solver SDK + docs

---

## Integration map — how the three tracks compose

```
Agent submits intent ────────► Intent Matcher ────────► Solver wins bid
                                                              │
                                                              ▼
                              Solver calls provider ◄── x402 ETag check
                              (Soma verified)
                                      │
                                      ▼
                              Response includes:
                              - Data
                              - Soma birth cert
                              - TEE attestation (if premium)
                              - x402 ETag hash
                                      │
                                      ▼
                              AVS operators verify
                              (slash if dishonest)
                                      │
                                      ▼
                              Agent receives verified data
```

The three tracks reinforce each other:
- **AVS** slashes providers/solvers for dishonesty
- **TEE** makes honesty enforceable at hardware level (reduces slashing events)
- **Intent** creates the auction market that surfaces honesty as a price signal

---

## Priority + build order

**If Soma scale testing goes well (week 4-8):**

1. Intent protocol spec (Track 3 Phase 1) — 1 week, no external dependencies
2. AVS stub / off-chain verifier (Track 1 Phase 1) — 2 weeks, builds on existing Soma primitives
3. TEE Nitro PoC (Track 2 Phase 1) — 2 weeks, leverages completed task #98

**If Soma scale testing reveals bottlenecks:**

Fix scale issues first. These tracks assume Soma can handle throughput at realistic scales (1K+ cert verifications/sec).

---

## When to start

**Do not start any track until:**
- Soma scale tests B + A passed (`scale-test-plan.md`)
- x402 ETag Tier 1 complete (`x402-etag-strategy.md`)
- Clawapis pilot live or dead (either way, decision made)

**These tracks are 6-month investments minimum.** Don't start them to procrastinate on Tier 1.

---

## References

- `brainstorm.md` — high-level summary
- `x402-etag-strategy.md` — Tier 4 trust & safety (overlaps with AVS/TEE)
- `soma-future-proofing.md` — delegation chain architecture (prerequisite)
- `scale-test-plan.md` — must complete before starting any track
- EigenLayer AVS docs: docs.eigencloud.xyz
- ERC-8004 trustless agents spec
- CoW Protocol intent docs
- AWS Nitro Enclaves documentation
