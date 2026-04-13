# Proof-of-Trust-Work (PoTW) — Decentralized Trust Mining Protocol

**Status:** design doc, NOT implemented. Build centralized trust first, decentralize second.
**Depends on:** Trust Oracle v1 (live), Nova IVC (live), Groth16 (live), $CLAWNET token (not launched).
**Trigger:** Decentralize trust scoring AFTER $50-100K monthly trust revenue + 6 months operating history.

---

## 0. Problem Statement

ClawNet computes trust scores centrally. This works for launch but creates:
- **Single point of failure:** ClawNet goes down = trust goes down
- **Single point of bias:** ClawNet could theoretically manipulate scores
- **Centralization risk:** Agents must trust ClawNet to be honest about trust
- **Scaling bottleneck:** One server computing all trust scores

The goal: move trust computation to a decentralized miner network where **cheating is mathematically impossible, not just economically irrational.**

### Why This Is Hard

Trust scores are not like block validation. A block is valid or invalid — binary, objective. Trust scores are computed from behavioral history — continuous, multi-dimensional, and the "correct" answer depends on which data you include and how you weight it.

This makes trust mining fundamentally harder than Bitcoin mining or Ethereum validation:
- There's no single "right answer" that's trivially verifiable
- The scoring formula is complex (6 dimensions: reliability, economic, verification, longevity, consistency, social + vouch graph resolution)
- Inputs (pulse trees) are large and evolving
- An attacker who controls inputs AND computation can produce "valid" but dishonest scores

---

## 1. Architecture Overview

Four-layer defense. Each layer addresses a different attack class.

```
Layer 1: VRF Selection          ← WHO computes (prevents targeting)
Layer 2: Committed Inputs       ← WHAT they compute on (prevents input manipulation)
Layer 3: ZK-Verified Computation ← HOW they compute (prevents output manipulation)
Layer 4: Economic Security      ← WHY they stay honest (prevents rational cheating)
```

### Layer 1: VRF Miner Selection

**Problem:** If miners know in advance which agents they'll score, they can be bribed or collude.

**Solution:** Algorand-style VRF (Verifiable Random Function).

```
seed = H(finalized_block_hash || epoch_number || agent_did)
(output, proof) = VRF.Eval(miner_secret_key, seed)
selected = output < threshold(miner_stake)
```

**Properties:**
- Miner cannot predict selection before block finalization (seed depends on future block hash)
- Selection is self-certifying: miner proves they were selected without revealing to others first
- No commit-reveal phase — eliminates last-revealer advantage entirely
- Stake-weighted: higher stake = higher selection probability (but diminishing returns)
- Multiple miners selected per query (3-5) for redundancy

**Why Algorand's model, not commit-reveal:**
Commit-reveal breaks with 2/3 Sybil control (Commit-Reveal^2, arXiv:2504.03936). VRF has no reveal phase to exploit. A miner either produces a valid VRF proof or doesn't — there's no strategic timing.

### Layer 2: Committed Inputs (Pulse Tree Snapshots)

**Problem:** If miners choose which pulse tree entries to include, they can manipulate scores (MEV analogue).

**Solution:** Committed pulse tree snapshots.

```
1. Pulse tree state committed to on-chain Merkle root at epoch boundary
2. VRF selects miners AFTER commitment (seed includes commitment hash)
3. Miners MUST use the committed snapshot — any deviation is detectable
4. Trust computation references snapshot root, not live state
```

**Anti-pulse-stuffing:**
Agents can try to inflate their pulse tree with meaningless transactions before the snapshot.

Defenses:
- **Economic weight, not count:** Score formula weights entries by economic value transacted, not number of entries. 1000 zero-value self-transfers = 0 signal.
- **Counterparty diversity with quality:** Current `rawDiversity * 5` is trivially gameable. Replace with diversity weighted by counterparty trust score. Interacting with 100 untrusted Sybils < interacting with 10 high-trust agents.
- **Temporal clustering detection:** `src/utils/sybil-signal.ts` checks 30-day windows. Extend to 90-day rolling analysis with velocity anomaly detection. Flag agents whose pulse tree grows 10x faster than their economic activity.
- **Nova fold cost:** Every pulse entry requires a Nova IVC fold, which burns micro-$CLAWNET. At scale, stuffing thousands of fake entries has real cost.

### Layer 3: ZK-Verified Computation (Nova IVC — see Innovation 1)

**Problem:** Even with correct inputs, miners can output whatever score they want.

**Solution:** Trust scoring formula runs inside Nova IVC. Each step of the scoring algorithm is a fold in the Nova accumulator. The proof mathematically guarantees the output matches the formula applied to the committed inputs.

```
Circuit (public):  trust_scoring_v1 (deterministic Rust implementation, compiled to Nova circuit)
                   NOTE: trust_scoring_v1.rs does not exist yet — must be a deterministic port
                   of the TypeScript trust-oracle.ts scoring logic. Prerequisite for Phase 1.
Input (public):    pulse_tree_snapshot_root, agent_did, epoch
Witness (private): pulse_tree_entries (Merkle proofs for each entry used),
                   bilateral counterparty entries (Merkle proofs from counterparty trees — Innovation 2)
Output (public):   trust_score, dimension_scores[6], risk_flags

Nova IVC Proof: "I ran trust_scoring_v1 on these inputs, fold by fold, and got this output"
              → Anyone can verify in ~1ms (Nova IVC verification is fast)
              → Nobody can fake without running the actual computation
```

**Verification mode: mandatory proof on every submission (Innovation 1).**

Every miner submission includes a Nova IVC proof. There is no optimistic tier, no random audits, no challenge windows. This costs ~2-3x the raw computation time (~200-300ms for a score that takes ~100ms to compute) — acceptable for per-epoch trust scores. The expensive Groth16 compression to on-chain only happens monthly, not per-query.

### Layer 4: Economic Security

**Problem:** Rational miners cheat if profit > expected_loss.

**Solution:** Stake + slash where `slash >= bribe_value / detection_probability`.

```
Miner registration:
  - Stake: 10,000 $CLAWNET minimum (isolated from other protocol roles)
  - Lock: 30-day cooldown on unstaking
  - VRF key registration: must register verification key before first epoch

Rewards:
  - Per-query: 0.005cr equivalent in $CLAWNET (funded by trust query revenue)
  - Availability bonus: consistent uptime earns higher selection weight
  - Penalize offline miners (miss 3 consecutive selections = 1% slash)

Slashing (availability only — computation fraud is impossible with Innovation 1):
  - Invalid Nova proof (soundness bug, not expected): 50% of stake
  - Repeated availability failures (3+ in 30 days): progressive 5%/10%/25% slash
  - Prolonged downtime (>7 days unresponsive): 100% of stake + deregistration
```

**Economic security note (updated for Innovation 1):**

With mandatory Nova IVC proofs, computation fraud is mathematically impossible — a miner cannot produce a valid proof for an incorrect score. Slashing applies primarily to availability (miners going offline) and protocol violations (submitting with stale snapshots). The "bribe a miner" attack model from pre-innovation design no longer applies: even a bribed miner must submit the correct score because the proof enforces it.

Remaining economic concern: miner collusion on INPUT manipulation (claiming a different snapshot root). Mitigated by: committed snapshots on-chain before VRF selection, multiple miners per query cross-checking roots.

---

## 2. Five Core Innovations

Each vulnerability in Section 1 has a structural flaw: a class of attack that layered defenses can mitigate but not eliminate. This section presents five architectural innovations — each inspired by the Bitcoin principle of finding a single structural insight that makes an "impossible" problem trivially solvable.

### Innovation 1: Proof-as-Byproduct (eliminates optimistic verification entirely)

**The problem:** Optimistic verification requires external challengers. External challengers are economically rational — they don't challenge (zero successful challenges on OP Mainnet in production). Random audits improve this but are still probabilistic.

**The Bitcoin parallel:** Bitcoin didn't solve double-spending by adding auditors. It made the work itself the proof. You can't produce a valid block without doing the work. There's nothing to audit — the block IS the audit.

**The insight:** Trust scoring runs inside Nova IVC. The output IS a proof.

We already have Nova IVC running for pulse trees. Trust scoring itself becomes an IVC computation:

```
Before:  miner runs scoring → submits score → maybe gets audited (probabilistic)
After:   miner runs scoring INSIDE Nova → submits score + Nova proof → verified in 1ms (deterministic)
```

Each step of the scoring algorithm — process pulse entry, compute dimension, resolve vouch path — is a fold in the Nova accumulator. The final output is a score AND a Nova proof that the score was computed correctly.

**Properties:**
- Verification cost: ~1ms (Nova verify is fast)
- No challenge window needed — every score is immediately final
- No bonds needed — no challenges to bond against
- No random audits needed — every submission is proven
- Scoring takes 100ms → Nova IVC adds ~2-3x overhead → 200-300ms total, fine for per-epoch scores
- The expensive part (Groth16 compression for on-chain) only happens monthly

**What this eliminates:** The entire optimistic/challenge/audit infrastructure. No challenge windows, no bonds, no random audits. Score submission = score finalization. The only remaining attack surface is inputs.

### Innovation 2: Bilateral Commitment (makes Sybil farming quadratic cost)

**The problem:** Sybil farms can stuff fake interactions into pulse trees. ZK proves the computation was honest but can't prove the inputs were real. LayerZero found 800K/6M airdrop addresses were Sybil clusters.

**The Bitcoin parallel:** Bitcoin's UTXO model. You can't spend a coin without the sender's signature on the transaction. Every transfer has two parties who both commit. You can't create money from nothing because the ledger requires matching debits and credits.

**The insight:** Every pulse tree entry requires bilateral commitment — both parties fold the same interaction into their own trees.

```
Before:  Agent A calls Provider B → A's pulse tree records it → done
After:   Agent A calls Provider B → A's tree records (interaction, B_signature)
                                  → B's tree records (interaction, A_signature)
                                  → Trust scoring only counts entries present in BOTH trees
```

This is double-entry bookkeeping for trust.

**Why Sybil farming becomes quadratic cost:**
- To create k fake interactions, you need k separate identities
- Each identity needs its own pulse tree, Nova IVC state, and $CLAWNET for fold burns
- Each identity needs to maintain bilateral records with every other identity it interacts with
- Cost grows O(k^2) instead of O(k)

**Combined with World ID:**
- One biometric = one identity = one pulse tree
- Cannot have 1000 pulse trees without 1000 pairs of eyeballs
- Sybil farming without biometric: possible but permanently capped at trust 39 (building tier)
- Sybil farming WITH biometric: impossible at scale

**ZK verification:** The scoring formula, running inside Nova IVC (Innovation 1), includes Merkle membership proofs from BOTH parties' trees for every interaction it counts. If the counterparty tree doesn't contain the matching entry, the entry gets zero weight. This is verified inside the proof — no external cross-reference needed.

**Primitives already exist:** Soma birth certificates are already dual-signed (provider + platform). Extend this: every API call, transfer, and interaction produces a bilateral pulse entry. The data model changes minimally — we enforce that trust scoring cross-references both parties' trees within the ZK circuit.

### Innovation 3: Conservation of Trust (kills vouch laundering by physics, not detection) — PROPOSED, not yet in code

**The problem:** Vouch graph laundering through one-directional chains. A (high trust) vouches for B, B vouches for C, C vouches for D. Trust flows freely. PageRank-style attenuation and cycle detection are band-aids.

**The Bitcoin parallel:** Bitcoin has a fixed supply. You can send coins to anyone, but you can't create new ones. The total supply is conserved. Moving coins somewhere means removing them from somewhere else.

**The insight:** Vouching transfers trust, it doesn't create it. Conservation law.

```
Before:  A vouches for B → B gains trust, A risks stake but keeps their score
After:   A vouches for B → A's score decreases by f(stake) → B's score increases by f(stake) × decay
         Net effect: trust redistributed, never created from nothing
```

**How this kills laundering:**
- A→B→C→D: at each hop, trust attenuates (decay factor per hop)
- A chain of 5 vouches: D receives ~15% of what A put in
- A loses real trust to vouch for B. If B is fake, A paid real trust for nothing.
- Cycles (A→B→C→A): every participant's trust DECREASES because each hop has decay. Cycles are self-punishing — no detection needed.

**Where does trust ENTER the system?**
One source only: **verified bilateral economic behavior** (from Innovation 2). Real API calls with real economic value, confirmed by both parties. This is the "mining" of trust — not hash grinding, but genuine useful work on the network.

**Trust thermodynamics:**
- Trust-energy is conserved (vouching redistributes, doesn't create)
- Trust-energy enters via work (real bilateral economic activity)
- Trust-energy exits via decay (inactivity time-decays trust) and slashing (bad behavior destroys trust)
- No perpetual motion: you cannot create infinite trust through vouch cycles

**What this eliminates:** Cycle detection algorithms. PageRank computation. Graph analysis for laundering detection. The conservation law makes these unnecessary — the physics does the work.

### Innovation 4: Import Evidence, Not Verdicts (solves cross-platform trust)

**The problem:** External platforms claim "agent A has trust score 75." We can't verify this. Checking the signature only proves Platform X said it, not that it's true. `trust-import.ts` has a `proofData` field that is never validated.

**The Bitcoin parallel:** SPV (Simplified Payment Verification). A light client doesn't trust a full node's claim that a transaction is valid. It downloads the block header, verifies the Merkle proof, and checks the transaction itself. Trust the math, not the messenger.

**The insight:** Never import another platform's trust score. Import their signed behavioral data and re-score it yourself.

```
Before:  Platform X says "trust score = 75" → we cap at 39 and hope it's honest
After:   Platform X exports signed pulse tree snapshot → we re-compute using OUR formula
```

**What this means:**
- We never trust another platform's scoring formula (it could be garbage or gamed)
- We trust their SIGNED BEHAVIORAL DATA (verifiable via their registered public key)
- We run our own formula on their data → consistent, comparable scores
- Fabricating internally consistent behavioral data across hundreds of entries is orders of magnitude harder than faking one score number
- The cap at 39 becomes unnecessary — we're computing from first principles

**Soma standard behavioral evidence export:**

```
SomaBehavioralExport {
  platform: string           // Who signed this
  agentDid: string           // Who it's about
  pulseTreeRoot: string      // Merkle root of their behavioral history
  entries: PulseEntry[]      // Raw behavioral data
  merkleProofs: Proof[]      // Proves entries are under the root
  platformSignature: string  // Platform's signature over the root
}
```

Any Soma-compatible platform can export this. Any platform can re-score it. No trust in the verdict required.

**Combined with bilateral commitment (Innovation 2):** Imported behavioral data can be cross-referenced if we have the counterparty's records. If Platform X says "agent A interacted with agent B 500 times" and we have agent B's pulse tree showing 3 interactions with agent A — the import is flagged as fraudulent automatically.

**The court analogy:** Courts don't accept another court's verdict as evidence. They accept the underlying evidence and reach their own judgment.

### Innovation 5: Hash-Rooted Proof Stack (quantum-safe by architecture, not by algorithm)

**The problem:** Groth16 is pairing-based (quantum-vulnerable). Nova IVC uses Pedersen commitments (also quantum-vulnerable). When quantum computers arrive, the entire proof stack breaks. LatticeFold is the eventual replacement but won't be production-ready until ~2028-2030.

**The Bitcoin parallel:** Bitcoin addresses are hash(hash(pubkey)). Even if ECDSA breaks, finding the preimage of SHA-256 is still hard. Bitcoin has partial quantum resistance because the security ROOT is hashes, and the efficiency layer (signatures) is separable.

**The insight:** Separate data integrity (hash-based, quantum-safe forever) from proof efficiency (SNARKs, replaceable). Make hashes the root of trust, SNARKs the optimization layer.

```
Layer 1 (root):        Pulse tree = SHA-256 Merkle tree         ← QUANTUM-SAFE
Layer 2 (integrity):   Each entry = hash-committed              ← QUANTUM-SAFE
Layer 3 (efficiency):  Nova IVC = folding with Pedersen         ← Replaceable
Layer 4 (compression): Groth16 = succinct on-chain verify      ← Replaceable
Layer 5 (anchor):      On-chain = Merkle root hash              ← QUANTUM-SAFE
```

**The security guarantee flows from hashes, not SNARKs:**
- Pulse tree data is provably correct via Merkle proofs (SHA-256, 128-bit post-quantum security)
- Nova/Groth16 make verification CHEAPER but don't make it MORE CORRECT
- Remove all SNARKs and you can still verify everything — just more expensively

**Transition plan requiring zero cryptographic breakthroughs:**

| Era | Layer 3 | Layer 4 | On-chain verify cost |
|-----|---------|---------|---------------------|
| Now (2026) | Nova IVC (Pedersen) | Groth16 | ~300K gas |
| Hybrid (2030) | Nova IVC + hash commitments | Groth16 optional | ~300K-2M gas |
| Post-quantum (2033+) | LatticeFold | Drop Groth16 | ~1M gas (estimated) |
| Emergency (quantum arrives early) | Drop IVC, Merkle-only | None | ~5M gas (expensive but works) |

**The key insight:** We never lose data integrity. The pulse tree is hash-based. Even if every SNARK in the stack breaks overnight, an agent's behavioral history is still provably intact via Merkle proofs. We lose cheap verification until LatticeFold matures — that's an inconvenience, not a catastrophe.

**Build now:** Tag every Merkle tree node with the hash algorithm used (`sha256:abc123`). When hash agility is needed later, old proofs remain valid under their tagged algorithm.

### Summary: Five Innovations as a System

| # | Vulnerability | Innovation | Bitcoin Parallel | Eliminates |
|---|---------------|-----------|-----------------|------------|
| 1 | Optimistic verification gameable | Proof-as-byproduct (Nova IVC scoring) | Block IS the proof of work | Challenge windows, bonds, audits |
| 2 | Sybil farms game inputs | Bilateral commitment (double-entry pulse) | UTXO requires sender + receiver | O(k) Sybil attacks → O(k^2) where k = fake identities |
| 3 | Vouch graph laundering | Conservation of trust (transfer, not create) | Fixed supply, conservation | Cycle detection, PageRank |
| 4 | External trust unverifiable | Import evidence, not verdicts | SPV: verify proof, not node | Trust in external platforms |
| 5 | Quantum kills proof stack | Hash-rooted proof layering | Addresses are hash(pubkey) | Quantum as existential threat |

These five innovations reinforce each other:
- Innovation 1 (proof-as-byproduct) verifies Innovation 2 (bilateral commitment) inside the ZK circuit
- Innovation 2 (bilateral) provides the input integrity that Innovation 1 proves
- Innovation 3 (conservation) works because trust only enters through Innovation 2's verified bilateral behavior
- Innovation 4 (import evidence) extends Innovation 2 cross-platform via Soma standard
- Innovation 5 (hash-rooted) ensures all data under Innovations 1-4 survives quantum transition

---

## 3. Attack Vector Analysis (Updated with Innovations)

### 3.1 Optimistic Verification Abuse — ELIMINATED by Innovation 1

**Original attacks:** Collusion to suppress challenges, rational apathy (nobody challenges), challenge flooding DoS.

**Status: Entire attack class eliminated.** Innovation 1 (proof-as-byproduct) removes optimistic verification entirely. Every score submission includes a Nova IVC proof verified in ~1ms. There is no challenge window, no bonds, no external challengers, no audits to game.

- Collusion to suppress challenges → no challenges exist to suppress
- Rational apathy → no challengers needed; proof is mandatory
- Challenge flooding → no challenge mechanism to flood

**Residual concern:** If Nova IVC itself has a soundness bug, a miner could forge a proof. Mitigated by: (a) Nova is formally verified (Microsoft Research), (b) multiple miners per query — all must produce valid proofs independently, (c) the protocol can run spot-check re-computation on any score at any time.

**References preserved:** "Hollow Victory" (arXiv:2504.05094), OP Mainnet challenge history, Proof of Diligence (arXiv:2402.07241) — these informed the decision to eliminate optimistic verification rather than patch it.

### 3.2 Input Manipulation — HARDENED by Innovation 2

**Attack: Sybil interaction farming**
- Create 1000 wallets, generate fake transaction history, inflate pulse trees
- LayerZero 2024: 800K of 6M addresses were Sybil clusters

**Defense (Innovation 2 — bilateral commitment + existing layers):**
1. **Bilateral commitment:** Every pulse entry must exist in BOTH parties' trees. Faking an interaction requires maintaining TWO full agent identities with synchronized pulse trees. Cost grows O(k^2) where k = fake identities.
2. **World ID biometric anchor:** One eyeball scan = one identity = one pulse tree. Cannot scale Sybil farms biometrically. Without biometric: permanently capped at trust 39.
3. **Economic weight:** Pulse entries weighted by real economic value, not count. Self-transfers = 0 weight. Bilateral check: if counterparty's tree shows $0 value, entry weighted at $0 regardless of what your tree claims.
4. **Counterparty quality:** Diversity weighted by counterparty trust. Interacting with untrusted Sybils gives zero diversity credit — and Sybils can't reach high trust because trust is conserved (Innovation 3).
5. **Nova fold cost:** Both parties burn micro-$CLAWNET per fold. 1000 fake interactions × 2 identities × fold cost. Low individually but compounds at scale.
6. **Temporal velocity bounds:** Score formula caps trust growth rate. Can't go from 0→90 in a week regardless of activity volume.
7. **Cross-reference in ZK circuit:** Innovation 1's Nova IVC proof includes Merkle membership proofs from BOTH trees. Missing counterparty entry = zero weight, verified cryptographically.

**Residual gap:** A well-funded attacker with real money making real API calls across real providers can still build genuine-looking bilateral history. This is the hardest attack to prevent because the behavior IS real — just the intent is malicious. Mitigated by velocity bounds and the fact that real economic activity has real cost.

**Attack: Pulse stuffing (wash trading analogue)**
- Agent creates meaningless-but-valid transactions to inflate their tree

**Defense (strengthened by bilateral commitment):**
- Bilateral requirement: counterparty must also record the transaction. Self-dealing requires two identities.
- Score formula distinguishes transaction types:
  - Endpoint calls with real providers: full weight
  - Self-transfers: zero weight
  - Transfers to new/low-trust agents: reduced weight (and their low trust means low diversity credit via Innovation 3)
  - Transactions below minimum value threshold: zero weight
- Anomaly detector: if tx_count / unique_counterparties > 10, flag as suspicious

**Attack: Miner selective inclusion (MEV analogue)**
- Miner sees pulse tree, includes only entries that produce desired score

**Defense (unchanged — already strong):**
- Pulse tree committed to Merkle root BEFORE miner selection
- Nova IVC proof includes Merkle membership proofs for ALL entries used
- Verifier checks: entries used = complete set under committed root
- No discretion in entry selection — formula specifies exactly which entries to include

### 3.3 Economic Attacks

**Attack: Grief-then-exit**
- Miner manipulates scores, accepts slash, profits from external bribe, exits

**Defense:**
- 30-day unstaking cooldown — can't exit quickly
- Slash is immediate, unstaking is delayed
- If slashed, remaining stake locked for additional 30 days (total 60-day exposure)
- Cumulative slashing: second offense = 100% + ban

**Attack: Death spiral (slashing drives miners away)**
- EigenLayer TVL dropped from $15B to $7B after slashing launch

**Defense:**
- Isolated staking: trust mining stake is separate from other protocol roles
- Graduated slashing: first offense = 50%, not 100% (allows honest mistakes)
- Availability penalty is small (1% per 3 misses) — doesn't punish downtime harshly
- Minimum miner count: if active miners < 10, fall back to centralized scoring (safety net)
- Reward scaling: as miner count drops, per-query reward increases (self-correcting)

**Attack: Majority miner takeover**
- Attacker acquires enough $CLAWNET to control >50% of mining stake

**Defense:**
- Diminishing returns on stake: `selection_weight = sqrt(stake)` — 4x stake = 2x selection probability
- Maximum stake cap per miner: no single miner can hold >5% of total mining stake
- Minimum miner diversity: queries require miners from ≥3 different stake pools
- If one entity controls >30% of total stake, protocol raises alarm and slows score finality

### 3.4 Timing Attacks

**Attack: Last-revealer advantage**
- In commit-reveal, the last miner to reveal sees all other scores and can strategically deviate

**Defense:**
- No commit-reveal phase at all. VRF selection is self-certifying.
- Miners submit scores with VRF proofs. Submission order doesn't matter because:
  - Each miner's score is independently verifiable via ZK
  - Final score = median of all miner submissions (outlier-resistant)
  - A miner can't change their score after seeing others (VRF proof is deterministic)

**Attack: Miner delay**
- Miner waits to see other submissions before sending theirs

**Defense:**
- Submission deadline: scores must arrive within T seconds of epoch start
- Late submissions are invalid (miner loses reward, no penalty beyond that)
- VRF proof includes timestamp — submission after deadline is provably late
- Score doesn't change regardless of when miner sees others (deterministic from committed inputs)

### 3.5 Governance / Upgrade Attacks

**Attack: Scoring formula takeover**
- Attacker accumulates governance tokens, changes formula to inflate their agents' scores
- Beanstalk 2022: $1B flash loan → malicious governance vote → $182M drained

**Defense:**
- **No flash-loan governance:** Governance weight based on time-locked stake, not liquid tokens
- **Formula versioning:** New formula = new SP1 program binary, published to IPFS, hash registered on-chain
- **Timelock:** 14-day delay on all formula changes
- **Veto period:** During timelock, any miner with >1% stake can trigger emergency veto (escalates to full miner vote)
- **Separation of powers:** Governance can propose formula changes but cannot deploy them unilaterally. Deployment requires 67% of active miner stake to ratify.
- **Escape hatch:** If governance is compromised, miners can fork to the last known-good formula hash

**Attack: Gradual formula drift**
- Small, innocuous-looking changes that cumulatively benefit an attacker over many updates

**Defense:**
- All formula changes produce a diff that is human-readable (Rust source code, not bytecode)
- Regression testing: new formula must produce scores within ±5% of old formula on historical data
- Formula change history is immutable on-chain — full audit trail

---

## 4. Trust Layer Gap Analysis

These gaps exist in the CURRENT trust system (before mining) and become critical when decentralized.

### 4.1 Vouch Graph Trust Laundering — SOLVED by Innovation 3

**Current state:** `vouch-graph.ts` has 50% discount on reciprocal vouches (A↔B) and MAX_PATH_DEPTH=3.

**Gap:** One-directional chain laundering. A (high-trust) vouches for B, B vouches for C, C vouches for D. This launders trust without triggering the reciprocal check. MIN_STAKE=10cr is too cheap.

**Fix (Innovation 3 — conservation of trust):**
- Vouching TRANSFERS trust, doesn't create it. A vouching for B reduces A's score.
- `vouch_effect = stake × (voucher_trust / 100) × decay^depth`
- A's trust decreases by `vouch_effect / decay` (voucher pays more than receiver gains)
- Chains attenuate naturally: A→B→C→D, each hop loses trust energy
- Cycles are self-punishing: every participant's trust DECREASES. No detection needed.
- Minimum vouch stake: 100cr (10x current) or 500 $CLAWNET (note: separate from miner stake of 10,000 $CLAWNET — vouch staking is agent-to-agent, miner staking is for trust computation)

### 4.2 Behavioral Fingerprinting Evasion (The Long Con)

**Current state:** `src/utils/sybil-signal.ts` uses 30-day windows. Trust scoring uses 60/40 recent/historical split.

**Gap:** An attacker operates honestly for 90+ days, builds high trust, then defects catastrophically. The scoring window doesn't look back far enough, and there's no mechanism for sudden trust collapse on defection.

**Fix:**
- **Volatility tracking:** Track trust score variance over time. Agents with very stable scores for long periods that suddenly shift get flagged for manual review.
- **Defection circuit breaker:** If an agent's trust drops >20 points in 24h, freeze their trust score and require re-verification.
- **Economic stake requirement for high trust:** Agents above trust 80 must have ≥1000cr staked in the platform. Sudden defection = stake at risk.
- **Counterparty reporting:** If 3+ high-trust counterparties report an agent within 7 days, immediate trust freeze pending review.

### 4.3 Trust Import Verification — SOLVED by Innovation 4

**Current state:** `trust-import.ts` accepts external scores with cap at 39 and 20-tx local requirement. `proofData` field exists but is never validated. `verified` always false.

**Gap:** No cryptographic verification of imported credentials. An attacker on a compromised platform could present inflated external scores.

**Fix (Innovation 4 — import evidence, not verdicts):**
- **Never import scores.** Import signed behavioral data (SomaBehavioralExport) and re-compute using our formula.
- **Issuer allowlist:** Explicit list of trusted platforms and their signing keys
- **Cryptographic proof verification:** Imported pulse tree must include valid platform signature over Merkle root
- **Cross-reference via bilateral commitment (Innovation 2):** If we have the counterparty's records, imported interactions are cross-checked. Discrepancies = fraud flag.
- **W3C VC 2.0 format:** Migrate `proofData` to standard Verifiable Credential format for the signed behavioral export
- **Score cap becomes unnecessary:** We're computing from raw data, not trusting external numbers. Natural ceiling from data quality.

### 4.4 Counterparty Diversity Gaming

**Current state:** Legacy `trust-scoring-v11.ts` uses `rawDiversity * 5, cap at 1` — trivially gameable. Note: the live trust oracle (`trust-oracle.ts`) uses a different vouch-graph-based diversity approach, but similar gaming concerns apply.

**Fix:**
- `diversity = sum(counterparty_trust[i] * tx_value[i]) / total_tx_value`
- Weight by both counterparty quality AND transaction economic value
- Minimum transaction value for diversity credit: 0.1cr
- Cap individual counterparty contribution at 20% of total diversity score

### 4.5 Quantum Timeline — MITIGATED by Innovation 5

**Current state:** `crypto-agility.ts` has ML-DSA-65 behind feature flag. Nova is PQ-upgradeable (LatticeFold). Groth16 is NOT.

**Gap:** Groth16 monthly compression is the quantum bottleneck. No PQ path for pairing-based SNARKs.

**Fix (Innovation 5 — hash-rooted proof stack):**
- Data integrity layer (SHA-256 Merkle tree) is quantum-safe NOW
- SNARKs (Nova, Groth16) are efficiency optimizations, not the root of trust
- If quantum arrives tomorrow: drop SNARKs, verify via Merkle proofs (expensive but functional)
- No cryptographic breakthroughs required for survival

**Timeline:**
- 2026-2028: No practical quantum threat. Current hash-rooted architecture is fine.
- 2028-2030: NIST mandates PQ migration planning. Begin LatticeFold integration research.
- 2030-2032: Ed25519 deprecated. Hybrid signatures required. Tag Merkle nodes with algorithm IDs.
- 2032-2035: Replace Nova with LatticeFold. Drop Groth16. Data remains intact throughout.

**Action now:** Tag Merkle tree nodes with hash algorithm identifier (`sha256:abc123`). This is the only prep needed — everything else is a swap of the efficiency layer, not the integrity layer.

---

## 5. Aggregation Protocol

How multiple miners' scores become the canonical trust score.

### 5.1 Score Aggregation

```
1. VRF selects 5 miners for agent X in epoch E
2. Each miner computes trust score inside Nova IVC from committed pulse tree snapshot
3. Each submits: (score, dimension_scores[6], risk_flags, vrf_proof, nova_proof)
4. Protocol verifies each Nova proof (~1ms each) — rejects invalid proofs immediately
5. Protocol computes from verified scores:
   - canonical_score = median(scores)     // outlier-resistant
   - canonical_dims = median(dims, axis=0) // per-dimension median
   - risk_flags = union(all_risk_flags)   // conservative: any flag from any miner
6. Outlier detection:
   - If a miner's verified score deviates >10 points from median: investigate (all proofs valid,
     so disagreement indicates input discrepancy — possible stale snapshot or bug, not fraud)
7. Score finalized IMMEDIATELY (no challenge window — Innovation 1 eliminates it)
```

### 5.2 Consensus Thresholds

| Miners Responding | Minimum Agreement | Action |
|-------------------|-------------------|--------|
| 5/5 | 3/5 within ±5 points | Accept median |
| 4/5 | 3/4 within ±5 points | Accept median |
| 3/5 | 2/3 within ±5 points | Accept median, flag for audit |
| <3/5 | — | Reject, re-select miners |
| 0/5 | — | Fallback to centralized scoring |

### 5.3 Score Finality (Updated — Innovation 1 eliminates challenge windows)

With proof-as-byproduct (Innovation 1), scores are final on submission:

```
All queries: IMMEDIATE finality
- Every miner submission includes Nova IVC proof
- Proof verified in ~1ms — score is canonical the moment it's verified
- No "provisional" period — agents can use scores immediately
- Outlier scores (>10 point deviation from median) trigger investigation,
  but the median score is still usable immediately

Dispute mechanism (for edge cases only):
- If a miner suspects their committed snapshot differs from others,
  they can request a snapshot audit (not a score challenge)
- Snapshot audits compare Merkle roots — if roots match, scores must match
  (deterministic computation from same inputs, proven by Nova)
- If roots differ: epoch boundary commitment was inconsistent → protocol bug, not miner fraud
```

---

## 6. Smart Contract Architecture (Base)

```solidity
// ITrustMining — deployed on Base alongside IClawNetToken

interface ITrustMining {
    // --- Miner Registration ---
    function registerMiner(
        bytes32 vrfVerificationKey,
        uint256 stakeAmount
    ) external;
    function deregisterMiner() external; // 30-day cooldown
    function minerStake(address miner) external view returns (uint256);
    function activeMinerCount() external view returns (uint256);

    // --- Epoch Management ---
    function currentEpoch() external view returns (uint256);
    function epochSnapshot(uint256 epoch) external view returns (bytes32 merkleRoot);
    function commitSnapshot(bytes32 merkleRoot) external; // Called by ClawNet backend

    // --- Score Submission (Innovation 1: proof-as-byproduct) ---
    function submitScore(
        bytes32 agentDid,
        uint256 epoch,
        uint96 score,             // 0-100, 6 decimal places
        uint96[6] calldata dims,  // 6 dimension scores
        bytes32 riskFlags,        // Packed risk flag bitfield
        bytes calldata vrfProof,  // Proves miner was selected
        bytes calldata novaProof  // Nova IVC proof of correct computation (mandatory)
    ) external;
    // Nova proof verified on-chain in ~1ms. Invalid proof = tx reverts.
    // No challenge mechanism needed — every score is proven at submission time.

    // --- Slashing (availability only, not fraud — fraud is impossible with Nova proofs) ---
    function slashMiner(address miner, uint256 amount, bytes32 reason) external;
    // Slashing now only for: missing submissions (availability), stale snapshots, protocol violations
    // Computation fraud is impossible — Nova proof guarantees correctness

    // --- View ---
    function getCanonicalScore(bytes32 agentDid) external view returns (
        uint96 score,
        uint96[6] memory dims,
        uint256 epoch,
        bool finalized
    );

    // --- Events ---
    event MinerRegistered(address indexed miner, uint256 stake);
    event ScoreSubmitted(bytes32 indexed agentDid, uint256 epoch, address miner, uint96 score);
    event ScoreFinalized(bytes32 indexed agentDid, uint256 epoch, uint96 canonicalScore);
    event ProofVerified(bytes32 indexed agentDid, uint256 epoch, address miner, bool valid);
    event MinerSlashed(address indexed miner, uint256 amount, bytes32 reason);
    event EpochFinalized(uint256 indexed epoch, bytes32 snapshotRoot);
}
```

### Verification Contract (Nova IVC — Innovation 1)

```solidity
// Nova IVC proof verification — every score submission is verified on-chain

interface ITrustVerifier {
    // Verify a Nova IVC trust computation proof
    // circuitHash: hash of trust_scoring circuit (deterministic, versioned)
    // publicInputs: (snapshotRoot, agentDid, epoch)
    // publicOutputs: (score, dims[6], riskFlags)
    // novaProof: Nova IVC proof bytes (includes bilateral commitment checks — Innovation 2)
    function verifyTrustComputation(
        bytes32 circuitHash,
        bytes calldata publicInputs,
        bytes calldata publicOutputs,
        bytes calldata novaProof
    ) external view returns (bool);
    // Called by submitScore() — every submission verified, not just challenged ones

    // Current authorized circuit hash (governance-controlled, timelocked)
    function authorizedCircuitHash() external view returns (bytes32);

    // Propose new circuit hash (14-day timelock + 67% miner ratification)
    function proposeCircuitUpdate(bytes32 newHash, string calldata ipfsCid) external;
    function ratifyCircuitUpdate(bytes32 proposalId) external; // Miner signs ratification
    function executeCircuitUpdate(bytes32 proposalId) external; // After timelock + 67%
    function vetoCircuitUpdate(bytes32 proposalId) external;    // Any miner >1% stake
}
```

---

## 7. Phase Rollout

### Phase 0: Centralized (CURRENT)
```
ClawNet backend computes all trust scores.
Scores recorded as TRUST leaves in pulse tree.
No miners, no token dependency.
Good enough for launch. Ship this.
```

### Phase 1: Transparent Centralized
```
Still centralized, but every score computation produces a ZK proof.
Proof published: anyone can verify ClawNet computed honestly.
Builds verifier infrastructure. Tests Nova IVC integration.
Prerequisite: deterministic Rust port of trust-oracle.ts scoring logic.
Does NOT require token or miners.
Trigger: Trust oracle live + 1000 daily queries.
```

### Phase 2: Open Verification
```
External verifiers can independently compute scores and compare.
Discrepancies trigger investigation.
Still ClawNet as canonical source, but with external accountability.
Trigger: 10K daily queries + 3+ external verifiers running.
```

### Phase 3: Hybrid Mining
```
Miners submit Nova-proven scores alongside ClawNet.
ClawNet score remains canonical, but miner consensus is tracked.
Miners earn reduced rewards (proving reliability).
All scores verified via Nova IVC proof — no optimistic assumptions.
Discrepancies between ClawNet and miner consensus trigger investigation.
Trigger: $CLAWNET launched + 20+ registered miners.
```

### Phase 4: Miner Canonical
```
Miner consensus becomes the canonical score.
ClawNet operates as one miner among many (no special privilege).
Full VRF selection, Nova IVC proof on every submission.
Scores final immediately (Innovation 1 — no challenge windows).
ClawNet retains emergency override (governance-controlled, timelocked).
Trigger: 100+ active miners + 6 months Phase 3 without incident.
```

### Phase 5: Full Decentralization
```
Emergency override removed.
Governance fully on-chain (miner-weighted).
Formula upgrades via proposal → timelock → ratification.
ClawNet has no special powers.
Trigger: 500+ miners + 12 months Phase 4 without incident.
```

---

## 8. Integration with Existing Soma Layers

### Trust Mining ↔ Soma Heart (pulse tree)
- Heart produces the pulse tree entries that miners score
- Committed snapshot = Merkle root of pulse tree at epoch boundary
- Mining does NOT change how Heart works — it changes who reads the tree

### Trust Mining ↔ Soma Check (content-addressed caching)
- Soma Check interactions (304 cache hits, ETag matches) are pulse tree entries
- These entries have weight in trust scoring (demonstrates efficient API usage)
- Mining doesn't change Check — it uses Check's data as input

### Trust Mining ↔ Identity Verification
- World ID / biometric verification provides the Sybil-resistance anchor
- Miners with biometric verification: higher stake multiplier (proposed 1.5x — exact value TBD, needs smart contract support)
- Agents with biometric verification: harder to Sybil farm (one eyeball = one identity)

### Trust Mining ↔ Fee Spine
- Trust query fees (0.03cr dimensional, 0.05cr full) fund miner rewards
- Fee spine records SomaFeeBreakdown for every trust query — provable revenue
- Miner reward pool = percentage of trust query revenue

### Trust Mining ↔ $CLAWNET Token
- Miner stake denominated in $CLAWNET
- Nova IVC proving costs (miner overhead) incentivized by $CLAWNET rewards
- Miner rewards in $CLAWNET (funded by trust query revenue)
- Slashed $CLAWNET burned (supply reduction — availability slashing only)

### Trust Mining ↔ Nova IVC / Groth16
- Trust scores themselves become TRUST leaves in the pulse tree
- Nova folds trust score updates into running proof
- Monthly Groth16 compresses the full trust history
- Mining adds more leaves = more folds = more micro-burns

---

## 9. Comparison with Existing Systems

| Property | Chainlink | Bittensor | EigenLayer | PoTW (ours) |
|----------|-----------|-----------|------------|-------------|
| Data type | Price feeds (objective) | AI model quality (subjective) | Restaked security | Trust scores (behavioral) |
| Miner selection | DON committees | Emission schedule | Operator opt-in | VRF (unpredictable) |
| Verification | Median aggregation | Validator weight voting | Slashing conditions | Mandatory Nova IVC proof per submission |
| Sybil defense | Reputation + stake | Registration cost | ETH stake | World ID + bilateral commitment + stake + VRF |
| Known attacks | Oracle manipulation | Weight-copying, Sybil rings | Cascading slashes | See Section 3 |
| Challenge system | None (trusted nodes) | None (social consensus) | Slashing proposals | None needed (proof mandatory, not challenged) |
| Governance | Multisig | Subnet owner | Governance token | Timelock + miner ratification |

### Why PoTW is stronger:
- **vs Chainlink:** ZK verification instead of trusted committee. Chainlink nodes could theoretically collude; our miners literally cannot produce a fake proof.
- **vs Bittensor:** Weight-copying is impossible — you can't copy a ZK proof. Bittensor's validators can free-ride on others' work; our miners must independently compute (proven by ZK).
- **vs EigenLayer:** No cascading slash risk (isolated staking). EigenLayer's shared security model means one AVS failure affects all. Our mining stake is purpose-specific.

### Why PoTW is weaker:
- **vs Chainlink:** Chainlink has 8 years of production hardening and node operator reputation. We're day 1.
- **vs Bittensor:** Bittensor's open emission model attracts more miners. Our model requires staking, which limits participation.
- **vs EigenLayer:** EigenLayer leverages existing ETH security ($billions). Our security is limited to $CLAWNET market cap.

---

## 10. Resolved Design Decisions

All 14 open questions resolved through brainstorm. Answers stress-tested against adversarial edge cases.

### Q1. Audit rate — RESOLVED by Innovation 1
Proof-as-byproduct means every score is proven. No audit sampling needed.

### Q2. Miner count floor — RESOLVED: separate snapshot from mining

**Gap found in "floor of 1" answer:** With a single miner, snapshot censorship is possible. A single snapshot committer could exclude pulse entries. Nova proves the score is correct FOR the snapshot, but nobody checks if the snapshot was complete.

**Architecture: two roles, separate operators:**

| Role | Responsibility | Minimum | Phase |
|------|---------------|---------|-------|
| Snapshot node | Computes Merkle root of full pulse tree, submits on-chain | 3 (root consensus) | Phase 4+ |
| Trust miner | Scores agents using the committed root, produces Nova proof | 1 (proven) | Phase 1+ |

- Phase 1-3: ClawNet is sole snapshot node (owns the DB). Miners cross-check by independently computing from the API-exported tree.
- Phase 4+: 3+ snapshot nodes independently compute roots. All match → canonical. Disagree → flag, investigate, fall back to previous epoch.
- Single-miner scores labeled "centralized-proven" (mathematically correct, not censorship-resistant).
- DDoS on snapshot nodes → no new epoch → scores freeze at last good epoch. Annoying, not exploitable.

### Q3. Score finality — RESOLVED by Innovation 1
No challenge window. Scores final on submission with Nova proof. Instant finality.

### Q4. Cross-epoch consistency — RESOLVED: epoch duration + freshness

Same snapshot + deterministic formula = same score. Miner disagreement = snapshot bug, not fraud.

**Epoch duration:**

| Duration | Freshness | Mining overhead | Phase |
|----------|-----------|-----------------|-------|
| 1 hour | Very fresh | High (24 rounds/day) | Phase 1-3 (centralized, cheap) |
| 6 hours | Acceptable | Moderate (4/day) | Phase 4+ (decentralized, balanced) |

**Stale trust race condition:** Agent checks trust in epoch N, transacts, epoch N+1 changes score.
Fix: Trust query responses include `valid_until: epoch_end_timestamp`. Counterparties check freshness. High-value interactions require current-epoch score.

Cross-epoch score jumps >20 points are legitimate behavioral changes, logged for monitoring but not blocked.

### Q5. Formula determinism — RESOLVED: structured Merkle snapshot (BLOCKER for Phase 1)

All scoring inputs committed in a multi-subtree Merkle tree:

```
EpochRoot
├── PulseEntries/
│   └── agent_{did}/
│       ├── entry_N (bilateral: agent's side)
│       └── entry_N_counter (bilateral: counterparty's side, Innovation 2)
├── VouchGraph/
│   └── edge_N (voucher→vouchee, stake, trust_transferred, timestamp, Innovation 3)
├── AttestationStats/
│   └── agent_{did}_summary
└── EpochMetadata/
    ├── epoch_number
    ├── epoch_timestamp          ← replaces Date.now()
    ├── previous_epoch_root      ← chain of epochs
    └── scoring_circuit_hash     ← which formula version
```

**Engineering changes required:**
1. Replace `Date.now()` in scoring with `epoch_timestamp` from snapshot
2. Replace live DB vouch graph reads with snapshot subtree
3. Current soma-heart flat pulse list → structured multi-subtree Merkle tree
4. Build Rust port of scoring function (pure, deterministic)
5. Test: TypeScript and Rust produce identical output to 6 decimal places on same snapshot

This is the single biggest engineering task and the Phase 1 gate.

### Q6. Bilateral commitment offline — RESOLVED: weighted credit by interaction mode

ClawNet as routing layer handles bilateral commitment atomically for routed calls. Edge cases resolved:

**Weighted bilateral credit:**

| Interaction mode | Bilateral credit | Why |
|-----------------|-----------------|-----|
| Routed through ClawNet | 100% | ClawNet witnessed both sides live |
| Verify mode (dual-signed cert) | 75% | Both parties committed, no third-party witness |
| Direct call, no verification | 0% | No proof of interaction |

**Edge cases:**
- ClawNet goes down: all interactions degrade to verify mode (75% credit). System degrades gracefully.
- Counterparty refuses to co-sign: both parties get 0% bilateral credit. Non-cooperative providers accumulate low trust over time — self-punishing.
- Incentive alignment: free routing + 100% bilateral credit = no reason not to use ClawNet (the funnel).

### Q7. Conservation of trust calibration — RESOLVED: d=0.6, c=1.3 + edge case rules

**Parameters:**
- Decay per hop (d): 0.6 — receiver gets 60% of what voucher risked
- Voucher cost factor (c): 1.3 — voucher loses 30% more than receiver gains
- Net destruction per vouch: 0.7 trust units per 1.0 vouched

**Edge case rules:**
- **Can't over-vouch:** Max vouch amount = `current_trust / cost_factor`. Agent with score 5 can vouch at most 3.8 points.
- **Revocation costs:** Revoking returns 50% of cost. Flash vouch is always unprofitable.
  - A vouches 10 points, loses 13. Revokes: gets back 6.5. Net cost: 6.5. B loses full 6.
- **Cascading slash:** A vouches for B, B gets slashed → A loses vouch stake + doesn't get vouch cost back. Double penalty for vouching for bad actors.
- **Trust sink protection:** If total system trust drops below threshold, base creation rate from bilateral activity increases (dynamic equilibrium). Prevents deflationary spiral.

**Calibration plan:** Simulate with 100 OpenClaw agents for 30 days. Measure total system trust stability. Adjust d and c until equilibrium is reached.

### Q8. Multi-chain attestation — RESOLVED: Merkle root on Base, off-chain verify

**Agent on Solana checking trust:**
```
1. GET /v1/trust/query?did=agent_B
2. Response: { score: 72, merkle_proof: [...], epoch_root: "0xabc...", chain: "base" }
3. Agent verifies: hash(proof_path) == epoch_root (local hash ops, any chain, any language)
4. High-stakes: read epoch_root from Base contract via RPC, confirm match
5. Low-stakes: trust API response (signed by ClawNet + tied to Merkle proof)
```

No bridge contracts. No multi-chain deployments. Cross-chain trust verification is a hash operation, not a smart contract call. Innovation 5 (hash-rooted) makes this chain-agnostic by design.

### Q9. Miner geographic diversity — RESOLVED: VRF diversity preference, not enforcement

Can't verify geography on-chain. Don't enforce it — encourage it.

**VRF diversity selection:**
```
1. VRF generates random ordering of eligible miners
2. Pick top 5
3. Diversity check: if >3 of 5 share same self-reported region,
   swap 4th/5th with next miners from different regions
4. No diverse alternatives: proceed as-is
```

**Nation-state censorship math:** With 100 miners, 60% US-based, diversity enforcement:
- Probability of all 5 being US-based drops from 7.8% to ~0%
- Even a US government order affecting all 60 US miners: 2 non-US miners always in the set
- Those 2 produce proven scores equally valid as the other 3

### Q10. Trust score granularity — RESOLVED: fixed-point 6 decimals

0.000000 to 100.000000. Matches `round6()` convention throughout ClawNet credit math.

On-chain: multiply by 10^6, store as uint96 (already in smart contract interface).

**Conservation law verification (per-epoch):**
```
expected_delta = bilateral_trust_created - vouch_trust_destroyed - decay_trust_lost
actual_delta = sum(scores_epoch_N+1) - sum(scores_epoch_N)
if |actual_delta - expected_delta| > 0.000001 * agent_count:
    flag conservation violation (indicates rounding bug in circuit)
```

Run this check on every epoch in the OpenClaw test.

### Q11. Governance — RESOLVED: two-chamber model with constitutional layer

| Chamber | Who | Votes on | Threshold |
|---------|-----|----------|-----------|
| **Miner** | Active miners, stake-weighted | Formula changes, circuit upgrades | 67% |
| **Token** | $CLAWNET holders, 30-day time-locked | Economic parameters (fees, burn rates, staking tiers) | 51% |
| **Both** | Joint vote | Major protocol upgrades, constitutional changes | 75% each |

**Constitutional rules (hardcoded in smart contract):**
- Chamber structure changeable only by 75% supermajority in BOTH chambers + 30-day timelock
- No single-transaction governance (anti flash-loan)
- Miner chamber quorum: 50% of active miners
- Token chamber quorum: 10% of circulating supply
- Emergency pause: any 3 miners can pause scoring for 24h (investigated by both chambers)

**Deadlock resolution:**
- Zero active miners → token holders alone, 75% + 30-day timelock
- Zero token participation → miners alone, 75% + 30-day timelock
- Both dead → ClawNet emergency override (Phase 4 only, removed in Phase 5)

### Q12. Formula marketplace — RESOLVED: deferred, architecture-ready

Not now. Phase 6+. Trust-first model depends on a single consistent trust score. Formula fragmentation undermines this.

Architecture supports it later without redesign: circuit hash is a parameter (not hardcoded). Multiple authorized programs = multiple formulas.

### Q13. Cross-platform mining — RESOLVED: ClawNet-only, Soma-compatible interfaces

ClawNet-only for Phases 1-5. Innovation 4 (import evidence) is the cross-platform bridge.

Architecture checklist (don't paint into a corner):
- [x] Circuit hash is a parameter, not hardcoded
- [x] Platform identifier in every SomaFeeBreakdown
- [ ] SomaBehavioralExport format is platform-agnostic
- [ ] Miner registration is per-platform (future: cross-platform contract)

### Q14. SomaBehavioralExport — RESOLVED: Soma extension + optional VC 2.0 wrapper

```typescript
interface SomaBehavioralExport {
  // Header
  schemaVersion: '1.0';
  platform: string;                // e.g., 'clawnet'
  platformDid: string;             // Platform's DID
  agentDid: string;                // Agent being exported
  exportTimestamp: string;         // ISO 8601

  // Merkle commitment
  pulseTreeRoot: string;           // Root hash of agent's pulse tree
  epochNumber: number;             // Epoch this export represents
  platformSignature: string;       // Platform signs the root

  // Behavioral evidence (with proofs)
  entries: Array<{
    entryHash: string;             // Hash of this entry
    merkleProof: string[];         // Proof entry is under pulseTreeRoot
    timestamp: string;
    interactionType: string;       // 'endpoint_call' | 'transfer' | 'vouch' | etc.
    counterpartyDid: string;
    economicValue: number;         // Credits transacted
    bilateralSignature?: string;   // Counterparty's signature (Innovation 2)
  }>;

  // Vouch graph edges
  vouches: Array<{
    voucherDid: string;
    voucheeDid: string;
    stakeAmount: number;
    trustTransferred: number;      // Innovation 3
    timestamp: string;
    merkleProof: string[];
  }>;

  // Optional: W3C VC 2.0 envelope for external interop
  verifiableCredential?: object;
}
```

Soma spec defines the content. VC 2.0 defines the optional container. Lightweight JSON internally, W3C-compliant externally.

---

## 11. Testing Plan: OpenClaw → Mining → Data → Customers

### Phase A: OpenClaw Agent Swarm (test Soma components)

**Goal:** Validate bilateral commitment, conservation law, and Sybil defenses with real agent behavior.

```
Deploy 50-100 OpenClaw agents on testnet.
Each agent routes API calls through ClawNet (testing bilateral commitment).
Agents interact with each other (testing vouch graph + conservation).

Adversarial agents (controlled, known to us):
  10 agents form a Sybil ring          → test bilateral + conservation defenses
  5 agents attempt pulse stuffing       → test economic weight filters
  5 agents do the "long con"            → honest 30 days, then defect
  5 agents attempt vouch laundering     → one-directional chains

Metrics collected:
  - Trust scores over time (per agent, per epoch)
  - Conservation law delta (expected vs actual, per epoch)
  - Sybil detection accuracy (did we catch the 10 Sybils?)
  - Long con detection (did the circuit breaker fire?)
  - Vouch laundering effectiveness (did chains attenuate trust?)
  - Bilateral credit rates (routed vs verify vs direct)
```

**Success criteria:**
- Conservation law holds to 6 decimal places on every epoch
- Sybil ring agents never exceed trust 39 (building tier)
- Vouch laundering chains attenuate >80% of input trust over 3 hops
- Long con defection triggers circuit breaker within 24h
- Pulse stuffing agents gain <5% trust advantage over honest agents

### Phase B: Mining Testnet (test Innovation 1 + snapshot consensus)

**Goal:** Validate Nova IVC proof-as-byproduct, snapshot commitment, and miner selection.

**Prerequisite:** Q5 (deterministic Rust scoring function).

```
1. Build deterministic Rust port of trust-oracle.ts scoring
2. Compile to Nova IVC circuit
3. Deploy 5 test miners (3 honest, 2 adversarial)
4. Deploy 3 snapshot nodes
5. Run 1-hour epochs for 7 days

Adversarial miners attempt:
  - Submit wrong scores         → Nova proof should reject on-chain
  - Use stale/modified snapshot → root mismatch detection
  - Go offline for 6+ hours    → availability slashing

Measurements:
  - Proof generation time per score (target: <500ms)
  - On-chain verification gas cost (target: <500K gas)
  - Epoch throughput (agents scored per epoch)
  - Snapshot node consensus rate (target: 100% agreement)
  - False positive rate on adversarial detection
```

**Success criteria:**
- Zero adversarial scores accepted (Nova proof rejects all fakes)
- Proof generation <500ms per agent score
- Snapshot consensus 100% across 3 nodes
- Availability slashing fires correctly for offline miners

### Phase C: Data Collection + Calibration (30 days)

**Goal:** Calibrate conservation parameters with real data.

```
Run Phase A + B simultaneously for 30 days.

Analyze:
  - Conservation equilibrium: does total system trust stabilize?
  - Optimal d (decay): sweep 0.4-0.8, measure laundering resistance vs vouch utility
  - Optimal c (cost): sweep 1.1-1.5, measure vouching participation vs gaming resistance
  - Epoch duration: compare 1h vs 6h on score freshness vs mining overhead
  - Bilateral credit weights: is 75% for verify mode the right number?

Output:
  - Calibrated parameters (d, c, epoch_duration, credit_weights)
  - Attack effectiveness report (what % caught, what slipped, why)
  - Performance benchmarks (proof time, gas cost, throughput)
  - Recommendations for Phase 3 (hybrid mining) readiness
```

### Phase D: clawapis Onboarding (first real customer)

**Goal:** Validate trust system with real economic activity.

```
1. clawapis registers as provider on ClawNet
2. Their OpenClaw agent routes real API calls through ClawNet
3. Bilateral commitment generates real pulse tree data
4. Trust score builds from actual economic interactions
5. First-party validation: does the trust score feel meaningful?
   - High-quality provider → trust rises?
   - Downtime/errors → trust drops?
   - Score matches intuitive assessment of provider quality?

Feedback loop:
  - If score doesn't match reality → adjust dimension weights
  - If gaming is too easy → tighten bilateral requirements
  - If trust builds too slowly → adjust base creation rate
```

**Success criteria:**
- clawapis trust score correlates with actual service quality
- No trust manipulation possible through normal provider behavior
- Trust score is useful for other agents' routing decisions

---

## 13. Summary: Is This Bulletproof?

**What IS bulletproof (mathematical/cryptographic guarantees):**
- **Computation honesty** — Nova IVC proof-as-byproduct means every score is proven. No optimistic assumptions. No challenge windows. Mathematical certainty. (Innovation 1)
- **VRF selection** — miners cannot predict or target specific agents. Cryptographic guarantee. (Layer 1)
- **Input completeness** — committed Merkle snapshots + ZK inclusion proofs. Miners cannot cherry-pick data. (Layer 2)
- **Bilateral commitment** — Sybil farming is O(k^2) cost, not O(k) (k = fake identities). Combined with World ID biometric anchor, large-scale input manipulation requires real-world resources beyond most attackers. (Innovation 2)
- **Trust conservation** — vouch laundering is self-punishing. No cycle detection needed. The physics does the work. (Innovation 3)
- **Data integrity** — hash-rooted proof stack survives quantum computers. Data never at risk; only proof efficiency degrades. (Innovation 5)

**What is NOT bulletproof (residual risks):**
- **Well-funded Sybil farms with real economic activity** — bilateral commitment makes this quadratically expensive and World ID makes it hard, but a nation-state-level attacker willing to burn real money on real API calls could still slowly build fraudulent trust. Mitigated by velocity bounds and anomaly detection. No system solves this absolutely.
- **Economic security floor** — slashing only works if $CLAWNET has value. At very low token prices, the cost of attacking is low. This is true of ALL proof-of-stake systems. Mitigated by minimum miner count fallback to centralized scoring.
- **Phase transitions** — each move from centralized → decentralized is a risk window. Mitigated by gradual rollout (6 phases, 12+ months per phase).
- **Long con attacks** — an agent operating honestly for 90+ days then defecting. Mitigated by defection circuit breaker (trust freeze on >20-point drop in 24h) and economic stake requirements for high-trust agents.

**The honest assessment:** With the five innovations, this system provides:
1. **Mathematical proof** of computation honesty (not just economic incentives)
2. **Quadratic cost** for Sybil attacks (not just linear cost)
3. **Physical conservation law** for vouch graph integrity (not just detection heuristics)
4. **Evidence-based** cross-platform trust (not verdict-based)
5. **Quantum survival** by architecture (not by algorithm upgrades)

It is the strongest decentralized trust scoring design we're aware of. The remaining attack surfaces require real-world resources (money, identity documents, time) rather than computational tricks — which is the best any digital system can achieve.

The right question isn't "is it bulletproof?" but "is the attack cost higher than the attack value?" For AI agent trust scores: overwhelmingly yes at any scale.
