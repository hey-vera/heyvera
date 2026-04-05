# Groundbreaking Extensions — the S/A/B-tier ideas

**Status:** internal strategy + engineering spec. Complements `proof-of-delivery-roadmap.md` (which covers the core AVS/TEE/Intent tracks). This doc covers the extensions that take Soma + x402 ETag from "good protocol" to "category-defining platform."

**Written 2026-04-04.** Intended to be pickable months later without re-deriving context.

---

## Philosophy

Core tracks (AVS, TEE, Intent) make us functionally correct. Extensions here make us **unavoidable**. Each extension targets one of:

- **Future-proofing:** handles agent topologies we can't imagine today
- **Adoption:** dissolves onboarding friction for devs
- **Moat:** creates value no competitor can replicate
- **Composability:** lets other projects build on us

Three tiers by strategic priority.

---

## S-tier — category-defining

### Extension 1: SNARK-compressed delegation chains

**Problem solved:** verification cost scales with chain depth. Hard depth caps artificially limit future agent topologies (recursive self-improvement, multi-generation evolution, deep corporate hierarchies).

**Design:** each delegation link includes a succinct proof that "this link is valid AND parent link was valid" via recursive SNARKs (Nova, SuperNova, Sangria, or IVC-style).

- **Constant-time verification:** O(1) regardless of depth
- **Verify cost:** 1-5ms per SNARK (current PLONK / Halo2 benchmarks)
- **Proof size:** ~200-500 bytes constant
- **Enables:** infinite delegation depth, multi-generation agents, self-improving chains

**Implementation sketch:**
```typescript
interface CompressedChain {
  leaf_cert: DelegationCert;      // direct parent
  recursive_proof: Uint8Array;    // proves validity of all ancestors
  root_commitment: string;        // hash of root pubkey
}

verifyChain(receipt, compressedChain, rootPubkey) → {
  verify leaf signature (standard)
  verify recursive proof (one SNARK verify)
  check root_commitment == hash(rootPubkey)
  return verdict
}
```

**Build order:**
1. Native chain verify with caching (MVP, no SNARKs) — exists in plan
2. Pick circuit framework (circom vs Halo2 vs Nova) — research-tier
3. Prototype circuit for single delegation link
4. Recursive composition for N-level chains
5. Opt-in SNARK mode alongside native verify
6. SNARK-by-default once prover tooling matures

**Dependencies:** delegation chain architecture (in `soma-future-proofing.md`) must ship first.

**Open questions:**
- Prover cost: generating SNARKs is expensive (0.5-5s currently). Acceptable for delegation events (rare), not per-receipt.
- Circuit audits: SNARK circuits are unforgiving — bug = silent invalidity. Need formal verification.
- Trusted setup: some schemes require it (Groth16), others don't (STARKs, Halo2).

---

### Extension 2: Universal verification badge (Soma HTTPS lock)

**Problem solved:** trust signal is invisible. Developers don't "feel" the value of Soma verification until they build tooling themselves.

**Design:** browser extension + SDK that surfaces Soma verification as a visual/audible signal, like the HTTPS lock icon that transformed web trust.

**Components:**
1. **Browser extension** — intercepts API responses, verifies Soma cert chains, shows verified badge in devtools + toolbar
2. **Universal `X-Soma-Verified` response header** — standard across all Soma-enabled endpoints
3. **Public verification service** at `verify.soma.dev` — paste a receipt, get verdict + chain visualization
4. **`soma://` URI scheme** — clickable links that open verification UI

**Adoption mechanics:**
- Developers see the badge → want it on their API → implement Soma
- Users see "Soma verified" in their wallet/app → demand it from providers
- Becomes meme: "x402 ETag inside" / "Soma verified" as trust signals

**Implementation phases:**
1. Chrome + Firefox extension (MVP) — reads response headers, verifies chains locally
2. `verify.soma.dev` web app — paste receipt, get chain viz (like Etherscan for receipts)
3. Mobile SDK hooks — iOS/Android verify + badge
4. Embed-in-website badge — `<script src="soma.dev/badge.js">` widget

**Dependencies:** stable receipt format v1, SDK in JS/TS/Python/Go.

**Why this is S-tier:** turns a crypto primitive into a cultural signal. Adoption = inevitable once it's visible.

---

### Extension 3: Recursive provenance graphs

**Problem solved:** single receipts prove "X signed this data" but can't answer "show me the full provenance of this decision across 50 agent actions."

**Design:** receipts compose — receipt A cites receipts B, C, D it depended on. Full provenance is a DAG of receipts traversable in either direction.

**Schema extension:**
```typescript
interface Receipt {
  // existing fields...
  dependencies?: string[];  // receipt hashes this receipt builds on
  derivation_type?: "computed" | "aggregated" | "filtered" | "transformed";
}
```

**Query API:**
- `provenanceOf(receipt) → DAG` — walk backwards
- `descendantsOf(receipt) → DAG` — walk forwards (requires indexing)
- `proveCompliance(receipt, rules) → ComplianceProof` — apply policy rules to DAG

**Use cases:**
- **Regulatory audit:** "show me every source that fed into this trade decision"
- **Data lineage:** "which upstream providers contributed to this forecast?"
- **Dispute resolution:** "the wrong answer came from step 7, not step 12"
- **Attribution:** "agents A and B both contributed; split royalties by %"

**Implementation phases:**
1. Add `dependencies` field to receipt schema (backward compatible)
2. SDK helpers: `receipt.cite(...otherReceipts)`
3. Provenance query service (off-chain, indexed)
4. Compliance policy DSL on top of DAG

**Why S-tier:** unlocks regulatory/enterprise adoption. Every enterprise compliance requirement maps to "prove the chain of data."

---

### Extension 4: Confidential computation proofs (TEE + Soma + ZK)

**Problem solved:** agents processing PII (medical, financial, legal) can't reveal inputs to prove correct computation.

**Design:** TEE runs computation, emits Soma receipt + ZK proof that "output corresponds to valid inputs under policy P, without revealing inputs."

**Stack:**
- TEE (Nitro/TDX) isolates computation
- Soma cert proves which enclave ran it
- ZK proof (zkVM like RISC Zero / SP1 / Jolt) proves correctness
- Combined attestation: hardware-rooted + math-rooted

**Implementation sketch:**
```typescript
interface ConfidentialReceipt {
  output_hash: string;
  enclave_attestation: TeeAttestation;
  zk_proof: Uint8Array;
  policy_hash: string;       // commitment to input/output policy
  soma_cert: BirthCert;
}

verifyConfidential(receipt, policy) → {
  verify TEE attestation (hardware trust)
  verify ZK proof against policy (math trust)
  verify Soma cert (identity trust)
  return verdict
}
```

**Unlocks:**
- Medical agents processing patient records without exposing them
- Financial agents trading with private strategies, provably within risk limits
- Legal agents analyzing privileged documents, provably within redaction rules
- Government agents enforcing policies on classified data

**Dependencies:** Track 2 (TEE) + ZK tooling maturity + policy DSL.

**Why S-tier:** $100B+ regulated industries (healthcare, finance, legal, govt) unreachable today become reachable with confidential computation.

---

## A-tier — major strategic moves

### Extension 5: Receipt marketplaces

Verified facts become tradeable assets. "Soma-verified AAPL snapshot at 2025-04-04T14:00:00Z" minted as NFT. Buyers pay for pre-verified, timestamped, cryptographically-attested data without calling the underlying endpoint again.

- **Market:** secondary market where agents resell paid data
- **Pricing:** dynamic based on freshness decay + demand
- **Revenue split:** original provider earns royalty on every resale
- **Liquidity:** agents aggregate popular queries, resell to others

**Tech:** receipts as NFTs on Base/Solana, metadata on IPFS, royalty enforcement via ERC-2981.

**Why A-tier:** creates economic incentive for any agent to share verified data, compounds network effects.

---

### Extension 6: Portable agent credit scores

Receipts build reputation. Agent X has 10,000 successful verified receipts, 2 disputes, 99.8% uptime → reputation score 872.

- **Portable:** reputation follows agent across platforms (bound to DID)
- **Composable:** reputation considers provenance of work (who delegated them)
- **Sybil-resistant:** new agents start low, must build track record
- **Queryable:** "show agents with reputation >800 for financial analysis"

**Use cases:**
- Agent marketplaces (hire by reputation)
- Agent-to-agent trust (delegate to high-rep agents)
- Insurance pricing (low-rep = higher premiums)
- Governance weight (high-rep = more voting power)

**Tech:** scoring engine pulls from receipt history + dispute outcomes + slashing events. Published as queryable API + on-chain oracle.

**Why A-tier:** enables agent-to-agent commerce at scale. Without reputation, every agent starts from zero every time.

---

### Extension 7: ZK-private delegation chains

Prove "I was delegated by someone in set S" without revealing which one.

**Design:** zero-knowledge proof over delegation chain. Verifier learns: "delegation is valid, root is in allowlist L" but NOT "path through the chain."

**Use cases:**
- Corporate agents where internal structure is confidential
- Government agents where chain-of-command is classified
- Private agent networks where membership is secret
- Whistleblower agents where identity must be shielded

**Tech:** Groth16 / Halo2 circuit over delegation validity + Merkle membership in allowlist.

**Why A-tier:** unlocks sectors (defense, intelligence, law, healthcare) that can't operate with public delegation chains.

---

### Extension 8: Offline + edge verification

Sense verifies without internet. Revocation log snapshots + SNARK chains shipped together.

**Design:**
- Signed revocation snapshot bundled with receipt (valid for N hours)
- SNARK-compressed chain = O(1) verify, no chain lookup
- Pre-compiled verifier in WASM (runs in browser, mobile, IoT)

**Use cases:**
- Agents on airplanes, warehouses, factories
- IoT devices verifying inbound commands
- Edge inference servers verifying model outputs
- Disconnected field operations (military, disaster response)

**Implementation phases:**
1. WASM verifier library (compile existing sense to WASM)
2. Revocation snapshot signing + bundling
3. Snapshot freshness policy (how old is OK?)
4. Offline-mode SDK

**Why A-tier:** every agent-in-a-device scenario requires offline verify. This is mandatory for IoT/edge scale.

---

### Extension 9: Forward-secret receipts (quantum-safe long-lived)

Old receipts must remain verifiable in 10, 20, 50 years — even after quantum computers break current signatures.

**Design:**
- Hybrid PQ signatures from day one (Ed25519 + ML-DSA, as per crypto-agility)
- Forward-secure key rotation: old keys proven correct by new keys
- Archived key registries for long-lived verification

**Use cases:**
- Compliance trails required to survive decades (SOX, HIPAA, GDPR)
- Historical research on agent behavior
- Legal evidence in multi-year disputes

**Tech:** already scaffolded in crypto-agility (CryptoProvider abstraction). Need to complete PQ migration + key archive.

**Why A-tier:** regulated industries require long-term verifiability. Without forward-secrecy, every receipt is a time bomb.

---

## B-tier — valuable additions

### Extension 10: Cross-protocol bridge

Translation layer: Soma cert ↔ ERC-8004 identity ↔ AP2 mandate ↔ TAP attestation ↔ L402 macaroon.

Lets agents with Soma credentials operate in ERC-8004 ecosystems and vice versa. Single source of truth (Soma) projects into every standard.

**Tech:** format translators, signature aggregators, policy mappers.

---

### Extension 11: Time-locked receipts

Receipt sealed until future time T, verifiable at T. Uses VRF or time-lock puzzles.

**Use cases:** sealed bids, prediction markets, timed reveals, delayed disclosure, escrow.

---

### Extension 12: Dispute futures (prediction markets)

Markets on "will provider P be slashed in 30d?" Creates continuous economic honesty signal.

- Liquid prediction markets on AVS slashing events
- Aggregated odds = community trust signal
- Providers watch their own prediction market like a credit rating

**Tech:** Polymarket-style binary markets tied to AVS slashing outcomes.

---

## Adoption-focused additions

Not "groundbreaking" per se, but dissolve the friction between "Soma exists" and "Soma is adopted."

### 1-line SDK integration target

```typescript
// Provider side: 1 line
app.use(soma.middleware({ endpointId: 'my-api' }));

// Consumer side: 1 line
const data = await soma.call('provider.com/api', { verify: true });
```

Target: solo dev ships a Soma-verified endpoint in <15 minutes.

### Debugging + chain explorer

`verify.soma.dev` as Etherscan-for-receipts. Paste a receipt hash → get:
- Full chain visualization
- Verification result with failure reasons
- Revocation status of every ancestor
- Timeline of related events
- Downloadable proof bundle

### Fast lane for HFT / gaming

Some use cases can't tolerate 1ms verification overhead. Provide a "fast lane":
- Pre-verified session tokens (verify once, reuse N times)
- Batched verification at interval boundaries
- Opt-out of chain walk, trust provider locally with periodic audits

### Graceful failure modes

- **Sensorium offline:** fall back to cached revocation log + warning
- **Key compromise:** emergency revocation broadcast, grace period on new keys
- **ClawNet hit-by-bus:** decentralized fallback (operators continue independently)
- **Cert format v2:** migration path for v1 receipts (dual-verify during transition)

### Legal + regulatory posture

- **AVS slashing = securities?** Legal review before mainnet launch.
- **Receipt storage = data retention?** GDPR/HIPAA compliance analysis.
- **KYC for operators/solvers?** Regulated jurisdictions require it.
- **Staking jurisdiction:** where do AVS operators need to incorporate?

### Long-term sustainability

Who pays to run this in 10 years?
- Protocol fees on slashing events
- Verification service subscriptions
- Reputation oracle queries (paid API)
- Endpoint certification fees (already planned)
- Receipt marketplace fees (Extension 5)

Bridge strategy: ClawNet funds bootstrap, protocol becomes self-sustaining via fee capture by year 3.

---

## Build order (post-core-tracks)

Assumes AVS + TEE + Intent from `proof-of-delivery-roadmap.md` are underway.

**Year 1 priorities:**
1. Universal badge browser extension (highest adoption leverage)
2. `verify.soma.dev` chain explorer (debugging + trust signal)
3. 1-line SDK in JS/TS/Python
4. Recursive provenance graphs (enterprise unlock)
5. Portable agent credit scores (A2A commerce unlock)

**Year 2 priorities:**
6. SNARK chain compression (removes depth bottleneck)
7. Offline + edge verification (IoT scale)
8. Confidential computation proofs (regulated industries)
9. Receipt marketplaces (compounding network effects)
10. Forward-secret receipts (long-term compliance)

**Year 3+ (speculative):**
11. Cross-protocol bridge
12. Time-locked receipts
13. Dispute futures
14. ZK-private chains

---

## Key open questions

1. **Which SNARK scheme?** Nova (recursive), Halo2 (no trusted setup), Groth16 (fast verify, trusted setup), STARKs (quantum-safe, bigger proofs)
2. **Badge UX:** green lock was universally adopted; what's our visual? "Soma verified" text? Soma rune? Color scheme?
3. **Marketplace:** NFT per receipt feels heavy. Alternative: aggregate market for "verified data streams"?
4. **Reputation scoring algorithm:** ml-derived vs formula-based? Gameable either way — need red-teaming.
5. **Confidential computation:** full zkVM (RISC Zero) vs domain-specific circuits? zkVM is easier to adopt, slower to prove.
6. **Sustainability split:** protocol fees vs endpoint fees vs marketplace fees — what's the right mix?

---

## Cross-references

- `proof-of-delivery-roadmap.md` — core tracks (AVS, TEE, Intent) that these extend
- `soma-future-proofing.md` — delegation chain architecture + SNARK compression spec
- `scale-test-plan.md` — must complete before building extensions
- `x402-etag-strategy.md` — Tier 1-6 infrastructure extensions build on
- `brainstorm.md` — running log, references everything
