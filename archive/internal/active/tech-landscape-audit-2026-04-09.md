# ClawNet Tech Landscape Audit — Better Tech Out There?

**Date:** 2026-04-09
**Purpose:** Research-backed comparison of ClawNet's current stack against state-of-art alternatives. Where we're ahead, where we're behind, and what to upgrade.

---

## Verdict Summary

| Layer | ClawNet Current | Better Alternative Exists? | Action |
|-------|----------------|---------------------------|--------|
| ZK Proofs | Nova IVC + Groth16 | **YES — SP1 Hypercube** | Migrate proving to Succinct Prover Network |
| Delegation | Custom macaroon-style | **YES — Biscuit/AIP (IETF)** | Adopt AIP tokens for delegation |
| Trust Certificates | Planned: custom JSON | **YES — W3C VC 2.0 + BBS+** | Build certs as W3C VCs with BBS+ signatures |
| On-Chain Identity | DID:key + EAS on Base | **Complement: ERC-8004** | Bridge ClawNet DIDs into ERC-8004 registries |
| Agent Protocol | None (planned custom) | **YES — Extend A2A v1.0** | Build trust+payment as A2A extensions |
| Payment Rails | Credits + x402 + Stripe | **Complement: Stripe MPP** | Add MPP as streaming payment rail |
| Trust Scoring | 6-dimension oracle | **Ahead of field** | Integrate Cred Protocol as sybil signal source |
| Post-Quantum | ML-DSA-65 hybrid | **Aligned with FIPS 204** | No change needed |
| Behavioral History | Pulse trees + checkpoints | **Unique — nobody else has this** | Keep, this is the moat |

---

## 1. ZK Proofs: Nova IVC Is Being Superseded

### What ClawNet Has
- Nova IVC folding for continuous per-heartbeat proofs
- Groth16 compression for on-chain verification (192 bytes)
- Self-hosted proving (CPU-based, ~50-100ms per fold)
- `NovaBridge` abstraction in `soma-heartbeat.ts`

### What's Better: SP1 Hypercube + Succinct Prover Network

**SP1 Hypercube** (Succinct Labs, live on mainnet 2026):
- Full RISC-V zkVM — proves ANY program, not just specific circuits
- Real-time proving: 99.7% of Ethereum blocks proved in < 12 seconds (16 GPUs)
- Decentralized prover network with proof contests (cost optimization via auction)
- **Cost: $0.005 per transaction or less**, dropping with each release
- GPU-accelerated, FPGA acceleration rolling out Q2 2026 (20x speedup)
- 10x cheaper than alternative zkVMs across diverse workloads

**Why this matters for ClawNet:**
- Nova's folding scheme is elegant but limited — it only proves the specific fold function, not arbitrary computation
- SP1 can prove ClawNet's entire checkpoint verification logic, not just hash folds
- The Succinct Prover Network means ClawNet doesn't need to run its own proving infrastructure — outsource to the decentralized network at $0.005/proof
- Groth16 compression can still be the final on-chain format, but the IVC chain can use SP1 instead of Nova

**Migration path:**
1. Write the pulse tree fold function as a Rust program (it's already essentially a hash chain)
2. Compile to RISC-V, prove with SP1
3. Use Succinct Prover Network for proof generation (no self-hosting)
4. Keep Groth16 compression for on-chain verification on Base
5. The `NovaBridge` abstraction makes this a clean swap — same interface, better backend

**a16z benchmarks** confirm: Nova-based implementations (Novanet, Nexus 1.0) show "significant increases in proving time" at scale vs SP1's "remarkably gradual increase, showing minimal performance degradation."

### What to Keep
The DESIGN of continuous folding is right. The pulse tree append-only structure is right. What changes is the PROVER — from self-hosted Nova to outsourced SP1.

---

## 2. Delegation: Macaroons Are Obsolete, Biscuit/AIP Is the Standard

### What ClawNet Has
- Custom macaroon-style capability tokens with caveats
- Custom caveats fail open (identified in hacker audit)
- No chain verification function (delegation depth not enforced)
- No domain prefix on signing (cross-primitive confusion risk)
- Revocation registry accepts revocations from any signer

### What's Better: IETF AIP with Biscuit Tokens

**Agent Identity Protocol (AIP)** — IETF draft-prakash-aip-00 (March 2026):
- Defines **Invocation-Bound Capability Tokens (IBCTs)** that bind identity, authorization, scope constraints, and provenance into one cryptographic artifact
- Two modes:
  - **Compact (JWT)**: Ed25519-signed, single-hop, < 1 hour lifetime
  - **Chained (Biscuit)**: Multi-hop delegation with append-only blocks and Datalog policy evaluation
- **Cryptographic scope attenuation**: scope can ONLY narrow at each hop, never widen. Enforced cryptographically — not by convention, by math.
- Four attenuation dimensions: tools (subset), budget (ceiling), domains (subset), time (ceiling)
- **Completion blocks**: tamper-evident audit trail of execution outcomes with result hashes
- A2A transport binding: tokens in `metadata.aip_token` field
- MCP transport binding: `X-AIP-Token` HTTP header
- Reference implementations in Python and Rust
- **100% rejection rate across 600 adversarial test cases**

**Why Biscuit is strictly better than ClawNet's macaroons:**

| Feature | ClawNet Macaroons | Biscuit/AIP |
|---------|-------------------|-------------|
| Scope attenuation | Convention (fail-open caveats) | Cryptographic (math enforces narrowing) |
| Multi-hop delegation | No chain verification | Append-only blocks with per-hop validation |
| Policy language | Custom caveat strings | Datalog (bounded, expressive, well-studied) |
| Depth limiting | Not enforced | Explicit per-block depth tracking |
| Audit trail | None | Completion blocks with result hashes |
| Transport bindings | Custom | A2A + MCP + generic HTTP defined |
| Adversarial testing | Not tested | 100% rejection on 600 attacks |
| Budget semantics | None | Per-token authorization ceiling |

**Migration path:**
1. Add `biscuit-auth` npm package (JS/TS implementation exists)
2. Map ClawNet delegation concepts to Biscuit blocks:
   - Parent creates authority block with capabilities, budget ceiling, depth limit
   - Each delegation hop appends a block that narrows scope
   - Verification walks the chain, checking attenuation at every hop
3. Keep existing delegation DB tables — add `token_format: 'biscuit' | 'legacy'` column
4. New delegations use Biscuit. Old ones continue working until expiry.
5. Publish AIP identity document at `.well-known/aip/` for interop

**Also relevant: Attenuating Authorization Tokens (AATs)** — draft-niyikiza-oauth-attenuating-agent-tokens-00:
- JWT-based format where any holder can derive a more restrictive token offline
- Lighter weight than Biscuit but less expressive
- Consider for simple single-hop cases where full Biscuit is overkill

---

## 3. Trust Certificates: Use W3C VC 2.0 + BBS+ Instead of Custom JSON

### What ClawNet Planned
- Custom JSON trust certificate with Ed25519 signature
- Full dimension scores revealed to every verifier
- No selective disclosure
- Custom verification logic

### What's Better: W3C Verifiable Credentials 2.0 with BBS+ Data Integrity

**W3C VC 2.0** — published as W3C Recommendation (2025):
- Standard credential format recognized by the entire identity ecosystem
- JSON-LD based with defined proof formats
- Supported by major identity platforms (Microsoft Entra, Mattr, SpruceID, etc.)

**BBS+ Data Integrity Cryptosuite** — W3C specification:
- **Selective disclosure**: holder proves a SUBSET of claims without revealing the rest
- **Unlinkable derived proofs**: verifier cannot correlate multiple presentations of the same credential (privacy)
- Based on BBS signatures — the issuer signs ALL claims, the holder derives a new proof revealing only selected claims
- No interaction with issuer needed for selective disclosure (offline)

**What this means for Trust Certificates:**

Instead of:
```json
{
  "type": "SomaTrustCertificate",
  "trust_score": 87,
  "dimensions": { "reliability": 92, "economic": 85, ... }
}
```

Build as:
```json
{
  "@context": ["https://www.w3.org/ns/credentials/v2", "https://soma.clawnet.com/v1"],
  "type": ["VerifiableCredential", "SomaTrustCertificate"],
  "issuer": "did:key:z6Mk...clawnet",
  "credentialSubject": {
    "id": "did:key:z6Mk...agent",
    "trustScore": 87,
    "dimensions": { ... },
    "heartbeatCount": 4200,
    "novaProofHash": "abc123..."
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "bbs-2023",
    "proofPurpose": "assertionMethod",
    "proofValue": "..."
  }
}
```

**Selective disclosure example:**
Agent wants to prove `trustScore > 70` without revealing exact score or dimension breakdown:
- Derive a BBS+ proof that reveals ONLY `trustScore` and `heartbeatCount`
- Verifier sees enough to make a trust decision, but not the full profile
- Zero additional implementation needed — BBS+ handles this natively

**Why this is better:**
1. **Interoperability**: Any platform that supports W3C VCs can verify ClawNet trust certs (MolTrust, Solana Agent Registry, enterprise systems)
2. **Selective disclosure**: Free — just use BBS+ instead of Ed25519 for the proof
3. **Unlinkability**: Verifier B can't collude with Verifier A to track an agent across interactions
4. **Ecosystem**: Libraries exist in JS/Rust/Go (Digital Bazaar, Spruce, MATTR)
5. **Standards alignment**: Future-proofed against whatever the industry converges on

**Trade-off:** BBS+ signatures are ~10x slower than Ed25519 for signing (~2ms vs ~0.2ms). But verification is still fast (~3ms). For a credential issued once per week, this is negligible.

---

## 4. On-Chain Identity: Bridge to ERC-8004

### What ClawNet Has
- DID:key (off-chain, Ed25519-derived)
- EAS attestations on Base (receipt layer, design phase)
- Heart root key derivation

### What Exists: ERC-8004 (Live, Multi-Chain)

**ERC-8004 — Trustless Agents** (live January 2026):
- On-chain registries on Ethereum mainnet + 15+ chains (Base, SKALE, GOAT, MegaETH, Metis, TRON)
- Three registries: **Identity** (unique agent IDs), **Reputation** (feedback signals), **Validation** (verification checks)
- Audited by Cyfrin, Nethermind, and Ethereum Foundation
- Interoperable with Solana Agent Registry
- Cred Protocol uses ERC-8004 as the identity layer for their credit scoring
- v2 in development with MCP support and x402 integration

**What ClawNet should do:**
- Don't replace DID:key — it's the right choice for off-chain identity
- **Bridge**: When an agent registers with ClawNet, optionally register their DID in the ERC-8004 Identity Registry on Base
- **Reputation bridge**: Push trust score updates to the ERC-8004 Reputation Registry
- **Cross-platform discovery**: Other platforms querying ERC-8004 can discover ClawNet-registered agents
- **Cost**: Registration tx on Base is < $0.001. ClawNet could batch-register agents.

This makes ClawNet agents discoverable across the entire ERC-8004 ecosystem (15+ chains, interoperable with Solana) without changing anything about the internal identity system.

---

## 5. Agent Protocol: Extend A2A, Don't Compete

### What ClawNet Planned
- Custom "Agent Handshake Protocol" (from vision brainstorm)
- Custom discovery, negotiation, contract protocol

### What Exists: A2A v1.0 (Linux Foundation, 150+ orgs)

**A2A v1.0 — stable specification (2026):**
- Agent Cards (JSON): capability discovery, signed cards for identity verification
- Task lifecycle: `working → input-required → completed/failed/canceled`
- JSON-RPC 2.0 over HTTP(S)
- Multi-turn conversations with context grouping
- Streaming (SSE) + push notifications (webhooks)
- Enterprise-grade: multi-tenancy, OAuth 2.0, mutual TLS
- **NOT included: payment, trust, or economic layer** — explicitly absent from the spec

**Strategy:**
ClawNet should NOT build a competing agent protocol. 150+ orgs including Google, Microsoft, AWS already support A2A. Instead:

1. **Implement A2A server**: ClawNet agents expose A2A-compatible Agent Cards
2. **Extend Agent Cards**: Add ClawNet-specific fields:
   ```json
   {
     "name": "Agent-B",
     "skills": [...],
     "clawnet_extensions": {
       "did": "did:key:z6Mk...",
       "trust_certificate_url": "https://clawnet.com/v1/trust/cert/...",
       "payment_rails": ["x402", "credits", "mpp"],
       "soma_heart": true
     }
   }
   ```
3. **Trust layer as A2A extension**: Before task submission, verify counterparty's trust cert
4. **Payment layer as A2A extension**: Use AIP tokens (IBCTs) for budget authorization within A2A tasks
5. **The "handshake"**: Is just an A2A task creation with trust + payment pre-validation

**Why this is better than custom:**
- Instant interop with 150+ orgs
- Agents built for A2A can use ClawNet's trust layer without ClawNet-specific code
- ClawNet becomes "the trust layer for A2A" — complementary, not competitive
- A2A explicitly lacks payment/trust — ClawNet fills the gap

---

## 6. Payment Rails: Add Stripe MPP for Streaming

### What ClawNet Has
- Credits (internal, fractional)
- x402 (USDC on Base/Solana)
- Stripe (one-time purchases)

### What's New: Stripe MPP (Machine Payments Protocol, March 2026)

- **Session-based streaming micropayments**: Agent pre-authorizes spending limit, streams granular payments within session
- **Fiat compliance built in**: KYC, AML, fraud detection handled by Stripe
- **100+ services at launch**: Alchemy, Dune Analytics, Merit Systems
- **Complementary to x402**: x402 = crypto per-call, MPP = fiat streaming

**What ClawNet should do:**
- Add MPP as a third payment rail alongside credits and x402
- MPP sessions map perfectly to ClawNet's **streaming escrow** concept (agent-economy-roadmap Phase 3)
- Use MPP for enterprise customers who need fiat + compliance
- Use x402 for crypto-native agents
- Credits remain the internal unit of account

---

## 7. Trust Scoring: ClawNet Is Actually Ahead

### Competitive Landscape

| System | Dimensions | On-Chain | Conservation | Behavioral History | Sybil Detection |
|--------|-----------|----------|--------------|-------------------|-----------------|
| **ClawNet** | 6 | EAS on Base | Yes (vouch graph) | Pulse trees + checkpoints | 4 behavioral signals |
| **IETF draft-sharif** | 5 | No | No | No | No |
| **Cred Protocol** | Credit score (single) | SKALE | No | Wallet analysis | Yes (probabilistic) |
| **Solana Agent Registry** | Reputation signals | Solana | No | No | No |
| **MolTrust** | Trust score (single) | Base | No | No | Agent-to-agent ratings |
| **ERC-8004** | Reputation registry | Multi-chain | No | No | No |
| **Mnemom** | 5 pillars (teams) | No | No | No | No |

**ClawNet's advantages:**
- Only system with conservation of trust (economic cost to vouch)
- Only system with verifiable behavioral history (pulse trees, checkpoints)
- Only system with continuous IVC folding (cryptographic proof of behavioral chain)
- Only system combining 6 dimensions with sybil detection

**Where to improve:**
- **Integrate Cred Protocol** as an additional sybil signal source. Cred has 200M+ wallet addresses analyzed, probabilistic bot risk scores 0-100, and MCP tools ready to use. Add as a 5th sybil signal alongside ClawNet's 4 behavioral signals.
- **Integrate Solana Agent Registry** reputation data for cross-platform trust import (currently trust-import.ts accepts unverified proofData — Solana Registry would be a verified source)

---

## 8. Competitors to Watch

### MolTrust (Swiss, small but aligned)
- W3C VCs + Ed25519, Base-anchored, Singapore IMDA compliant
- Trust score 0-100, agent-to-agent ratings, sybil detection
- Pricing: $0.005/trust query, $0.05/VC issuance
- Bitcoin Lightning payments via PhoenixD
- **Risk level: LOW** — small team, no behavioral history, no conservation of trust
- **Watch for:** They're building the exact trust certificate model we described. If they ship W3C VC-based trust certs first, they establish the format.

### Solana Agent Registry (Solana Foundation)
- On-chain identity + reputation + validation, 400ms finality
- < $0.001/tx, interoperable with ERC-8004
- **Risk level: MEDIUM** — Solana Foundation resources, but reputation is simplistic (signals, not multi-dimensional scoring)
- **Action:** Bridge ClawNet identities into their registry for discoverability

### Cred Protocol (SKALE chain)
- 350K+ credit score requests, 200M+ wallet addresses
- On-chain credit scoring + sybil detection
- MCP tools available
- **Risk level: LOW** for trust scoring (they do wallets, not agents), but **HIGH** for sybil detection (they're much further along on wallet-level analysis)
- **Action:** Integrate their sybil API as a signal source

### Microsoft Entra Agent ID (GA May 2026)
- Enterprise agent identity with Conditional Access, governance
- Agent 365 control plane for visibility into agent activity
- Zero Trust for AI extending ZT architecture to AI workloads
- **Risk level: HIGH for enterprise** — Microsoft will dominate enterprise agent identity
- **Action:** ClawNet targets crypto-native and open-source agents. Don't compete with Microsoft on enterprise. Position as "the trust layer Microsoft doesn't have" — behavioral history, conservation of trust, verifiable proofs.

---

## 9. Post-Quantum: ClawNet Is Aligned

- FIPS 204 (ML-DSA) finalized August 2024, production implementations exist
- ClawNet already has ML-DSA-65 hybrid signatures
- Sirraya Labs has ML-DSA-87 + DID/VC integration in production
- EU targets 2026 for PQ planning, 2030 for critical infrastructure
- **No change needed.** Consider ML-DSA-87 upgrade for higher security level when touching this code.

---

## 10. Priority Tech Upgrades

### Do Now (High Impact, Proven Tech)
1. **Biscuit/AIP for delegation** — Fixes the fail-open caveats bug, gives cryptographic scope attenuation. Reference implementations exist. Most urgent because current delegation is actively insecure.
2. **W3C VC 2.0 for trust certificates** — When building trust certs (Gap 4 in vision brainstorm), use W3C VCs with BBS+ instead of custom JSON. Libraries exist.
3. **ERC-8004 identity bridge** — Register ClawNet agents in ERC-8004 Identity Registry on Base. Small code change, massive discoverability boost.

### Do Next (Strategic Advantage)
4. **A2A v1.0 Agent Card publication** — Expose ClawNet agents as A2A-compatible. Add trust + payment extensions. Instant interop with 150+ orgs.
5. **Cred Protocol sybil integration** — Add their MCP tools as 5th sybil signal. They have 200M+ wallets analyzed, we have 4 behavioral signals. Together = best sybil detection in the space.
6. **Stripe MPP as third payment rail** — Enables streaming escrow for enterprise customers.

### Do Later (Infrastructure Upgrade)
7. **SP1 Hypercube migration** — Replace self-hosted Nova with SP1 via Succinct Prover Network. Better performance, lower cost, no self-hosting. But current Nova works fine for current scale — do this when proving load increases.

---

## Sources

- [SP1 Hypercube Real-Time Proving](https://blog.succinct.xyz/real-time-proving-16-gpus/)
- [SP1 Hypercube Mainnet Launch](https://blog.succinct.xyz/sp1-hypercube-is-now-live-on-mainnet/)
- [a16z zkVM Benchmarks](https://github.com/a16z/zkvm-benchmarks)
- [IETF AIP — Agent Identity Protocol](https://www.ietf.org/archive/id/draft-prakash-aip-00.html)
- [IETF AAT — Attenuating Agent Tokens](https://datatracker.ietf.org/doc/html/draft-niyikiza-oauth-attenuating-agent-tokens-00)
- [IETF Agent Payment Trust](https://datatracker.ietf.org/doc/html/draft-sharif-agent-payment-trust-00)
- [Biscuit Authorization](https://www.biscuitsec.org/)
- [W3C Verifiable Credentials 2.0](https://www.w3.org/TR/vc-data-model-2.0/)
- [W3C BBS+ Data Integrity Cryptosuite](https://www.w3.org/TR/vc-di-bbs/)
- [A2A Protocol v1.0 Specification](https://a2a-protocol.org/latest/specification/)
- [A2A Surpasses 150 Organizations](https://www.prnewswire.com/news-releases/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year-302737641.html)
- [ERC-8004 Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004)
- [Cred Protocol on SKALE](https://blog.skale.space/blog/cred-protocol-launchs-on-skale-building-the-trust-layer-for-on-chain-credit-and-agent-economies)
- [Solana Agent Registry](https://solana.com/agent-registry/what-is-agent-registry)
- [MolTrust](https://moltrust.ch/)
- [Microsoft Entra Agent ID at RSAC 2026](https://techcommunity.microsoft.com/blog/microsoft-entra-blog/microsoft-entra-innovations-announced-at-rsac-2026/4502146)
- [Stripe Machine Payments Protocol](https://stripe.com/blog/machine-payments-protocol)
- [x402 vs Stripe MPP Comparison](https://workos.com/blog/x402-vs-stripe-mpp-how-to-choose-payment-infrastructure-for-ai-agents-and-mcp-tools-in-2026)
- [ML-DSA FIPS 204](https://csrc.nist.gov/pubs/fips/204/final)
- [ML-DSA-87 Production Implementation](https://medium.com/writingsofaamirhameed-com/building-post-quantum-identity-a-complete-implementation-of-ml-dsa-87-from-fips-204the-quantum-e55b48af7e69)
