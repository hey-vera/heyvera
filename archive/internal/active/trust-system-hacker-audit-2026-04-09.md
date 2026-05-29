# Trust System Hacker Audit — Breaking the Mining-for-Identity Machine

**Date:** 2026-04-09
**Scope:** Composite identity scoring, vouch graph (conservation of trust), trust oracle (6 dimensions), PoTW mining protocol, bilateral commitment, sybil detection, attestation registry, and their interactions.
**Threat model:** Attacker has read every line of open-source Soma code, every internal design doc, and every trust oracle query response. They are economically motivated and patient (willing to wait months).

---

## Part 1: System Map — What We're Attacking

```
                                    effectiveTrust
                                         │
                    ┌────────────────────┼────────────────────┐
                    │                    │                    │
              trustScore          proofBlended         identityBlended
              (0-100)          (0.5 + 0.5 × mult)    (0.5 + 0.5 × composite)
                 │                                         │
        ┌────────┼────────┐                    ┌───────────┼───────────┐
        │ 6 dimensions    │                    │   compositeIdentity   │
        │ reliability     │                    │  = Σ(signal × weight) │
        │ economic        │                    │                       │
        │ verification    │                    │  biometric  × 0.35    │
        │ longevity       │                    │  kyc        × 0.25    │
        │ consistency     │                    │  passport   × 0.15    │
        │ social          │                    │  behavioral × 0.15    │ ◄── FEEDS BACK
        └────────┬────────┘                    │  social     × 0.10    │ ◄── FEEDS BACK
                 │                             └───────────────────────┘
                 │                                    ▲         ▲
                 │                                    │         │
                 ├──── behavioral = (reliability + consistency) / 200
                 └──── social = min(1.0, vouchScore / 50)
```

The behavioral and social signals in the composite identity formula are DERIVED from the trust oracle dimensions. This is the first attack surface: a feedback loop where gaming trust dimensions also inflates identity.

---

## Part 2: Exploit Chains

### EXPLOIT 1: Dimension Farming — All 5 Non-Social Dimensions for < 20cr
**Severity:** CRITICAL | **Difficulty:** Easy | **Cost:** ~15cr + 180 days patience

**The bug:** Five of the six trust dimensions can be maxed out with trivial effort. Only social (vouch graph) has real economic friction via conservation of trust. But social is only 1 of 6 dimensions — the other 5 dominate the score.

**Attack playbook:**

| Dimension | How to max it | Cost | Time |
|---|---|---|---|
| **Reliability** (100) | Make 100+ tiny successful API calls. `successRate = positive_credit_delta / total`. Spend 0.01cr per call = 1cr. | 1cr | 1 day |
| **Economic** (100) | Make 50+ transactions, keep positive balance, zero disputes. `+20 (balance) +30 (50tx) +30 (no negatives) +20 (volume≥10)` = 100. | 0.5cr | 1 day |
| **Verification** (90+) | Run 3 own sense-observer instances. Each generates GREEN verdicts. `greenRate=1.0, uniqueObservers=3 → full diversity factor`. Score = ~90. | 0cr (hardware) | 1 day |
| **Longevity** (100) | Exist for 180 days. Make occasional calls to stay active. | 1cr/month | 180 days |
| **Consistency** (100) | Keep constant success rate across all checkpoints. Since you're already gaming reliability to 100%, every checkpoint is 100% → CV = 0 → score 100. | 0cr | Automatic |

**Total cost:** ~8cr + 180 days of patience.
**Result:** 5 dimensions near-maxed (avg ~98), social at 0 → `trustScore ≈ 82` (weighted average).

**Behavioral signal from this:** `(reliability.score + consistency.score) / 200 = (100 + 100) / 200 = 1.0`.
**Composite identity impact:** behavioral signal 1.0 × weight 0.15 = +0.15 to composite → blended = 0.575.
**Without any biometric/KYC/passport.**

**Add a bought iris scan:** composite = 0.35 + 0.15 = 0.50 → blended = 0.75.
**effectiveTrust = 82 × 0.925 (proof) × 0.75 (identity) = 56.8** — crosses "trusted" threshold.

**Why this is devastating:** The dimensions are designed to measure real behavior, but the cost of producing "real" behavior is negligible. Making 100 tiny API calls is not evidence of trustworthiness — it's evidence of having 1 credit.

**Fix required:**
- Minimum transaction value for reliability/economic credit (e.g., 1cr minimum per counted action)
- Weight dimensions by economic VALUE, not COUNT
- Velocity cap: max trust growth per day (proposed in trust-system-upgrades.md #4 but not implemented)

---

### EXPLOIT 2: Observer Self-Verification Ring
**Severity:** CRITICAL | **Difficulty:** Easy | **Cost:** 0cr

**The bug:** The verification dimension in `computeVerification()` counts GREEN Soma verdicts from "unique observers." The threshold for full observer diversity is just 3 unique observers. There is NO verification that observers are independent entities.

**Attack steps:**
1. Generate 3 fresh Ed25519 keypairs → 3 distinct observer DIDs
2. Run 3 sense-observer instances on the same machine
3. Each observer connects to attacker's heart
4. Each observer records GREEN verdicts (attacker's heart produces consistent behavior because attacker controls both sides)
5. `uniqueObservers = 3` → full diversity factor
6. 20+ verdicts → full verdict confidence
7. All GREEN → `greenRate = 1.0`
8. Verification dimension score = `round(1.0 × 80 × 1.0) + 10 = 90`

**Result:** Verification dimension maxed at 90 for FREE. The "independent observation" guarantee is completely hollow.

**Why this matters:** Verification is supposed to prove "multiple independent parties confirmed this agent is legitimate." With 3 self-run observers, it proves nothing.

**Fix required:**
- Observer reputation/trust scoring (trust-system-upgrades.md #5 — proposed but not built)
- Minimum observer stake or identity verification
- Cross-reference observer DIDs with agent's delegation tree — observers in the same tree should be discounted
- Rate-limit verdicts: max N verdicts per observer per agent per epoch

---

### EXPLOIT 3: Conservation Bypass — Trust Is NOT Conserved
**Severity:** HIGH | **Difficulty:** Analytical

**The bug:** Conservation of trust (Innovation 3) applies ONLY to the vouch graph (social dimension). The other 5 dimensions CREATE trust from thin air — there is no conservation law for reliability, economic, verification, longevity, or consistency.

**The claim:** "Trust enters the system only through verified bilateral economic behavior."
**Reality in code:** Trust enters through: ACTION leaves (any API call), ECONOMIC leaves (any transaction), Soma verdicts (from any observer), and time (longevity). None of these are conserved.

**Concrete demonstration:**
1. Agent A makes 1000 API calls at 0.01cr each = 10cr total
2. This creates 1000 ACTION leaves with positive credit_delta
3. Reliability dimension = 100 (1000/1000 success rate)
4. Economic dimension = 100 (50+ tx, volume ≥ 10, no negatives)
5. Consistency dimension = 100 (constant rate)
6. Trust score ≈ 80+ without a single vouch or real counterparty

**No trust was transferred from anyone.** Agent A created 80+ trust points by spending 10cr on API calls. The "conservation of trust" brand promise is only 1/6th true.

**Fix required:**
- Bilateral commitment (Innovation 2) must be a PREREQUISITE for action/economic leaf counting, not a future addition
- Until bilateral commitment is enforced, the "conservation of trust" claim is misleading
- OR: explicitly document that conservation applies only to social dimension

---

### EXPLOIT 4: Vouch Ring — Directional Chain Laundering
**Severity:** HIGH | **Difficulty:** Medium | **Cost:** ~130cr for 10 agents

**The bug:** The circular vouch discount (`REVOKE_RETURN_RATE = 0.5`, 50% discount on reciprocal vouches) only catches DIRECT reciprocals (A↔B). Directional rings (A→B→C→...→A) bypass the reciprocal check entirely.

**Attack steps:**
1. Create 10 agents: A, B, C, D, E, F, G, H, I, J
2. A vouches for B (13cr cost, B receives 6cr trust_transferred)
3. B vouches for C (13cr cost, C receives 6cr)
4. ... continue around the ring ...
5. J vouches for A (13cr cost, A receives 6cr)
6. No two agents have reciprocal vouches — circular discount never triggers

**Result per agent:** 1 incoming vouch of 6cr trust_transferred. Social signal = 6/50 = 0.12.
**Total ring cost:** 10 × 13cr = 130cr. Each agent gets 0.012 identity composite boost.

**At scale (100 agents, 3 vouchers each):**
1. Arrange 100 agents in groups of 4
2. Each agent receives vouches from 3 non-reciprocal agents
3. Trust transferred per agent: 3 × 6cr = 18cr → social signal = 18/50 = 0.36
4. Combined with behavioral gaming: composite = 0.15 + 0.036 = 0.186 → add iris scan → 0.536

**Current defense:** Conservation destroys 7cr per vouch (cost 13, transferred 6). For 300 total vouches in the 100-agent network: 300 × 13cr = 3,900cr spent to get each agent 0.036 identity boost. Expensive but not prohibitive for a well-funded attacker.

**Missing defense:** The design proposes sybil dampening curves (Phase 3) that detect "multiple agents in the same delegation tree with similar identity profiles." But this only catches agents in the SAME tree — a ring of independent agents with different delegation roots is invisible.

**Fix required:**
- EigenTrust-style global reputation computation (proposed in trust-system-upgrades.md #1) would catch this — trust from low-reputation agents carries exponentially less weight
- Vouch graph cycle detection at depth > 2 (current MAX_PATH_DEPTH = 3 catches short cycles but not longer rings)
- Time-delay on vouch effectiveness: new vouches don't contribute to social signal for 7 days

---

### EXPLOIT 5: Identity Signal Replay — The Long Con
**Severity:** HIGH | **Difficulty:** Medium | **Time:** 6+ months

**The bug:** There's no "defection circuit breaker" (acknowledged in trust-mining.md section 4.2 as a gap). An agent that builds trust over months can defect catastrophically with no mechanism to freeze trust in real-time.

**Attack playbook:**
1. **Month 1-2:** Register agent, buy iris scan (biometric signal = 0.35), complete Coinbase KYC (KYC signal = 0.25), get Human Passport (passport signal ≈ 0.15)
2. **Month 2-6:** Make legitimate API calls, earn reliability/consistency/economic scores. Game verification with 3 self-observers (Exploit 2).
3. **Month 6:** All signals converged. composite identity ≈ 0.90+, trust score ≈ 85+, effective trust ≈ 70+.
4. **Day of attack:** Use high effective trust to gain access to premium routing, high-value tasks, large credit delegations. Defect: steal delegated credits, return garbage data, abuse premium access.

**Window of impunity:**
- Trust score TTL: 15 minutes (full tier) to 60 minutes (basic tier)
- Sybil detection runs on 30-day windows — won't catch sudden defection
- No real-time trust circuit breaker exists
- Vouch slashing only triggers when pulse tree evidence is processed (batch, not real-time)

**Total damage before detection:** Multiple TTL cycles of premium access × high-value transactions.

**Fix required:**
- Implement the defection circuit breaker: if trust drops >20 points in 24h, freeze agent and require re-verification (proposed in docs but not built)
- Real-time anomaly detection: sudden behavioral shifts trigger immediate trust freeze
- Stake requirement for high-trust agents: trust > 80 requires staking credits that are at risk

---

### EXPLOIT 6: Attestation Registry Weight Inflation
**Severity:** HIGH | **Difficulty:** Easy (requires colluding issuer) | **Files:** `Soma/src/heart/attestation.ts:289-296`

**The bug:** `getScore()` computes reputation as `Σ(weight × freshness × typeMultiplier)`. The `weight` field (0-100) is set by the ISSUER, not verified against any standard. A colluding issuer can set weight=100 on every attestation.

**Attack:**
1. Register as a "trusted issuer" (the registry accepts any issuer by default — `trustedIssuers: null`)
2. Create attestations for your puppet agents: type='kyc-verified', weight=100
3. Each attestation: `100 × 1.0 (fresh) × 2.5 (kyc multiplier) = 250` → caps at score 100
4. One attestation from one issuer maxes out the reputation score

**Compounding issue:** The `trustedIssuers` filter defaults to `null` (accept all). Applications that don't explicitly configure trusted issuers accept attestations from anyone.

**Fix required:**
- Trusted issuers MUST be explicitly configured — default should be empty (fail-closed), not null (fail-open)
- Weight should be derived from attestation type and issuer reputation, not set by the issuer
- OR: weight is ignored in score computation, replaced by type multiplier only

---

### EXPLOIT 7: Bilateral Commitment Is Not Enforced
**Severity:** HIGH | **Difficulty:** N/A (missing feature)

**The bug:** Innovation 2 (bilateral commitment) is DESIGNED but NOT IMPLEMENTED. The current system:
- `pulse_tree_leaves` has a `bilateral_ref` column (nullable)
- `sybil-signal.ts` queries bilateral joins but handles missing data gracefully (falls back to attestation-based diversity)
- Trust oracle dimensions do NOT check for bilateral presence

**Impact:** Every dimension that relies on "real interactions" is currently unfounded:
- Reliability: counts ANY action leaf, no bilateral check
- Economic: counts ANY economic leaf, no bilateral check
- Sybil detection: falls back to attestation diversity when bilateral data missing (weaker signal)

All of Exploit 1 (dimension farming) works BECAUSE bilateral commitment isn't enforced. If every action leaf required a counterparty co-signature, the cost of farming would be dramatically higher.

**Fix required:**
- Phase 1: Flag leaves without bilateral_ref in trust oracle (reduce weight by 50%)
- Phase 2: Require bilateral_ref for full trust credit
- Phase 3: Reject unilateral leaves entirely

---

### EXPLOIT 8: Snapshot Committer Compromise (PoTW)
**Severity:** HIGH | **Difficulty:** Hard (requires server compromise) | **Files:** trust-mining.md Section 6

**The bug:** In the PoTW smart contract, `commitSnapshot(bytes32 merkleRoot)` is called by "ClawNet backend." This is a single point of trust for ALL trust computation inputs.

**Attack:** Compromise ClawNet's snapshot committer → submit a Merkle root that includes fabricated pulse tree entries → all miners compute honest scores on dishonest data → honest-looking scores for puppet agents.

**Why Innovation 1 doesn't help:** Nova IVC proves "computation was correct." If the INPUT is a fabricated snapshot, the proof says "I correctly computed trust from fabricated data." The proof is valid. The score is wrong.

**Why Innovation 2 doesn't fully help:** Bilateral commitment cross-references both parties' trees. But if the snapshot committer controls BOTH trees (they control the snapshot), they control both sides of the bilateral check.

**Residual defense:** Multiple miners are selected per query. If they use different snapshot sources, they'll disagree. But the contract design has ONE `commitSnapshot` function — there's a single canonical snapshot per epoch. Miners don't independently source snapshots.

**Fix required:**
- Multiple independent snapshot committers (threshold signature required for commitment)
- Miners should be able to independently verify snapshot roots against on-chain pulse tree anchors
- Phase 3+ should decentralize snapshot commitment, not just score computation

---

### EXPLOIT 9: Vouch Slashing as a Griefing Weapon
**Severity:** MEDIUM | **Difficulty:** Medium

**The bug:** `slashVouches()` burns 100% of voucher stakes when a vouchee misbehaves. If an attacker can make a legitimate agent APPEAR to misbehave, they trigger cascade slashing.

**Attack chain:**
1. Target: Agent A with 10 vouchers staking 50cr each (500cr total)
2. Attacker runs 3 rogue sense-observers that generate RED verdicts for Agent A
3. RED verdicts lower A's verification dimension → risk flag triggered
4. If the system auto-slashes on RED verdicts (or if the operator manually triggers slash based on verdicts)
5. All 10 vouchers lose 50cr each = 500cr destroyed
6. Agent A's social dimension collapses
7. All agents who vouched for A suffer cascading reputation loss

**Current gap:** Nothing prevents an attacker from running observers that issue false RED verdicts. The verification dimension treats all observer verdicts equally (no observer reputation weighting).

**Compounding with Exploit 2:** The same mechanism that lets attackers self-verify (3 GREEN observers) lets them grief others (3 RED observers targeting someone else).

**Fix required:**
- Observer reputation weighting: RED verdicts from unestablished observers carry zero weight
- Slash requires consensus from multiple independent evidence sources, not just observer verdicts
- Minimum observer stake/identity before verdicts are counted

---

### EXPLOIT 10: Passport ML Score Manipulation
**Severity:** MEDIUM | **Difficulty:** Medium | **Files:** identity-verification-tiers.md

**The bug:** Human Passport's ML humanity score is based on "on-chain behavior patterns." The score is fetched from `https://api.passport.xyz/` and stored as `signal_score` in `agent_identity_signals`.

**Attack:** The ML model analyzes on-chain behavior. An attacker who knows what patterns the model looks for can craft on-chain behavior to maximize the humanity score. This is essentially adversarial ML — crafting inputs that fool the classifier.

**Concrete approach:**
1. Study Human Passport's scoring criteria (their docs describe general factors)
2. Create a wallet with diverse, human-looking on-chain activity: regular small transactions, DEX usage, governance participation, NFT minting
3. Avoid bot-like patterns: no rapid-fire transactions, no round numbers, no clock-precise timing
4. Score ≥ 20 = verified human → passport signal = 1.0 (or `humanity_score / 100`)

**Cost:** Gas fees for on-chain activity (~$5-20 on Base)
**Result:** Passport signal ≈ 0.45+ → adds 0.067+ to composite identity

**Fix required:**
- Don't rely on a single ML score as a trust signal — require periodic re-evaluation
- Combine with other sybil signals (counterparty concentration, temporal clustering)
- Set minimum threshold higher than Human Passport's 20/100 default

---

### EXPLOIT 11: Identity Linking Market (Phase 2)
**Severity:** MEDIUM | **Difficulty:** Social engineering

**The bug:** Phase 2 wallet identity linking allows a biometric-verified wallet (World Orb) to link its identity to an arbitrary agent DID. One-to-one binding prevents reuse, but creates a market for identity rental.

**Attack — "Identity as a Service":**
1. Recruit real humans to get iris scans (pay $50 per scan in developing countries)
2. Each human creates a World wallet with biometric verification
3. Humans "rent" their identity: link their biometric wallet to attacker's agent DID
4. Attacker's agent gets biometric signal = 0.35 for the rental period
5. When done, human revokes the link and "rents" to the next buyer

**Economics:**
- 50 iris scans × $50 = $2,500 investment
- 50 agents with biometric signal = 0.35 each
- At composite 0.50+ per agent, effective trust boost is significant
- Revenue from trust abuse > $2,500 → profitable

**Current defense:** "Links are permanent (revocable only by the biometric wallet owner)" — but revocation IS the rental model. The human revokes after the rental period.

**Fix required:**
- Cooling period after revocation: biometric wallet cannot re-link for 30-90 days
- Progressive penalty: each link/unlink cycle REDUCES the biometric signal score for that wallet (e.g., first link = 1.0, second = 0.7, third = 0.5)
- Liveness checks: periodic re-verification that the biometric wallet holder is the agent operator

---

### EXPLOIT 12: Trust Oracle Time-of-Check-Time-of-Use (TOCTOU)
**Severity:** MEDIUM | **Difficulty:** Timing

**The bug:** `getCompositeIdentity()` reads from 3 separate data sources (identity signals, trust dimensions, vouch graph) without a single transaction. An attacker can exploit timing windows.

**Attack:**
1. Agent's KYC signal expires at time T
2. At T-1ms: trust query fires, reads KYC signal (still valid) → composite includes KYC
3. At T: KYC signal expires
4. Trust query result cached with TTL (15-60 min depending on tier)
5. For the entire TTL window, the agent's effective trust includes an expired KYC signal

**Broader variant:** An agent revokes all vouches immediately after a trust query caches their high social score. For the TTL window, they retain the social signal benefit while having zero actual vouches.

**Fix required:**
- All composite identity computation in a single SQLite transaction (read-consistent snapshot)
- Short TTLs on cached composite scores (or recompute on every query)
- Bind trust query results to the signal expiry timestamps — if any signal expires before the result TTL, the result expires early

---

### EXPLOIT 13: Sybil Detection Evasion via Slow Drip
**Severity:** MEDIUM | **Difficulty:** Easy (patience required)

**The bug:** `sybil-signal.ts` analyzes 30-day windows. Temporal clustering detection looks for "bursts of activity followed by inactivity." An attacker who distributes activity evenly evades detection.

**Evasion playbook:**
1. Make 1-3 API calls per day (no clustering)
2. Use 5-10 different legitimate providers as counterparties (no concentration)
3. Never give reciprocal feedback (no reciprocity signal)
4. Keep volume proportional to diversity (no volume/diversity ratio anomaly)
5. Continue for 90 days

**Result:** All 4 sybil signals at 0 (zero risk). The sybil detector sees a perfectly normal agent.

**Why this works:** The detector measures PATTERNS, not INTENT. A patient attacker who mimics legitimate behavior is invisible to behavioral sybil detection.

**Fix required:**
- Sybil detection is inherently limited against patient attackers — this is a known limitation of behavioral analysis
- Defense shifts to economic barriers: minimum credit spend for trust accumulation, bilateral commitment requirement
- EigenTrust (proposed in upgrades doc) helps because even a patient attacker's vouches carry low weight if they come from other low-trust agents

---

### EXPLOIT 14: PoTW Miner Selection Gaming via Stake Threshold
**Severity:** MEDIUM | **Difficulty:** Requires capital

**The bug:** VRF miner selection probability is stake-weighted: `selection_weight = sqrt(stake)`. Maximum stake per miner is 5% of total mining stake.

**Attack:** An attacker registers multiple miners (each at 5% max stake). With 6 miners at 5% each = 30% of mining stake. `sqrt(0.05) = 0.224` per miner. Combined selection probability is significantly elevated.

**Compounding:** 3-5 miners selected per query. If attacker controls 30% of stake, probability of getting ≥1 miner per query is high. Probability of getting ≥3 (majority) is lower but non-negligible.

**Current defense:** "Minimum miner diversity: queries require miners from ≥3 different stake pools." But what defines a "stake pool"? If each of the attacker's 6 miners registers independently, they appear to be from 6 different pools.

**Fix required:**
- Identity verification for miners (World ID / biometric)
- Stake pool = verified human identity, not wallet address
- Miner reputation system: new miners have reduced selection weight for first 30 days

---

## Part 3: Trust System Feedback Loop Analysis

### The Implicit Feedback Loop

```
trustScore → behavioral signal → compositeIdentity → identityBlended → effectiveTrust
    ^                                                                          │
    └──────────────────────────── (used for routing, access, delegation) ──────┘
```

Higher effective trust → agent gets routed more premium traffic → more successful actions → higher reliability → higher trust score → cycle continues.

This creates a **rich-get-richer** dynamic:
- Agents with early trust advantages compound them
- New agents face a cold-start disadvantage that's hard to overcome
- The sybil dampening curves (Phase 3) don't address legitimate privilege accumulation

**Design consideration:** This may be INTENTIONAL (reward consistent good behavior). But it means the gap between established and new agents grows monotonically. Combined with identity signal expiry (90-365 days), there's a "treadmill" effect where agents must continuously re-verify to maintain trust.

### Conservation Analysis — Where Trust Actually Enters

| Trust source | Conserved? | Cost to create 1 point |
|---|---|---|
| Reliability dimension | NO — created by API calls | ~0.01cr per action |
| Economic dimension | NO — created by transactions | ~0.01cr per transaction |
| Verification dimension | NO — created by observer verdicts | Free (self-observe) |
| Longevity dimension | NO — created by time | Free (wait) |
| Consistency dimension | NO — created by consistent behavior | Free (be consistent) |
| Social dimension | YES — conserved via vouch graph | ~13cr per 6cr transferred |
| Biometric signal | External — one-time verification | $0 (World Orb is free) |
| KYC signal | External — one-time verification | $0 (Coinbase account) |
| Passport signal | External — ML score | ~$5-20 (on-chain activity) |

**Conclusion:** 5 of 6 trust dimensions and 3 of 5 identity signals are either free or near-free to create. Conservation of trust applies to only 1 of 6 dimensions (social, weight: 16.7% of trust score). The "mining for identity" metaphor implies scarcity (like Bitcoin mining) but the actual economics are closer to proof-of-stake with very low minimum stakes.

---

## Part 4: OpenClaw Trust-Attacker Test Agents

### Agent 7: "Farmer" — Trust Dimension Gaming Agent

| Test | What it does | Expected | Actual |
|---|---|---|---|
| `farm-reliability-100-calls` | Make 100 minimum-value API calls (0.01cr each) | Should NOT reach reliability 100 | Currently reaches 100 |
| `farm-economic-50-tx` | Make 50 tiny transactions | Should NOT reach economic 100 | Currently reaches 100 |
| `farm-consistency-stable-rate` | Maintain 100% success rate across 10 checkpoints | Should NOT auto-max consistency | Currently reaches 100 |
| `farm-verification-self-observe` | Run 3 own observers generating GREEN verdicts | Should NOT count self-observation | Currently gives verification ~90 |
| `farm-all-dimensions-total-cost` | Measure total credit cost to max 5 dimensions | Should be > 1000cr | Currently < 20cr |
| `farm-with-iris-effective-trust` | Farm all + bought iris scan → effective trust | Should be < 50 | Currently ~57 |

**Data collected:** Cost per trust point, time per trust point, which dimensions are cheapest to farm.

### Agent 8: "Ringlord" — Vouch Ring Topology Agent

| Test | What it does | Expected | Actual |
|---|---|---|---|
| `ring-10-directional` | Create 10-agent directional ring (A→B→C→...→A) | Should detect ring and discount | Currently no ring detection beyond depth 2 |
| `ring-star-topology` | High-trust agent vouches for 10 puppets (no reciprocal) | Should be limited by trust budget | Limited by trust budget (WORKS) |
| `ring-mutual-discount` | Create A↔B mutual vouches | Should apply 50% discount | Applied (WORKS) |
| `ring-100-agents-social-signal` | Measure social signal achievable with 100-agent ring | Should be < 0.10 per agent | Currently ~0.36 per agent |
| `ring-rapid-vouch-revoke` | Vouch → revoke → re-vouch cycling | Should be penalized | Only 50% return on revoke (WORKS) |
| `ring-vouch-then-slash-grief` | Vouch for target, then trigger false RED → slash | Should require verified evidence for slash | Currently any RED can trigger slash path |

### Agent 9: "Longhacker" — Long-Con Defection Agent

| Test | What it does | Expected | Actual |
|---|---|---|---|
| `longcon-build-6-months` | Build trust legitimately for 6 months | Measure time-to-peak-trust | ~180 days to trust 85+ |
| `longcon-sudden-defection` | After peak trust, defect catastrophically | Should freeze trust within minutes | NO circuit breaker exists |
| `longcon-window-measurement` | Measure damage window (time between defection and trust impact) | Should be < 5 minutes | Currently TTL-bounded: 15-60 minutes |
| `longcon-recovery-after-defection` | After defection, try to recover trust | Should be permanently damaged | Currently: wait for bad leaves to age out |
| `longcon-identity-survival` | After defection, check if identity signals persist | Should be revoked on defection | Currently persist until natural expiry |

### Agent 10: "Ghostwriter" — Identity Linking Attack Agent

| Test | What it does | Expected | Actual |
|---|---|---|---|
| `ghost-rent-iris-link` | Link a "rented" biometric wallet | Should detect rental pattern | No detection (Phase 2 not built) |
| `ghost-rapid-relink` | Unlink → re-link to different agent rapidly | Should have cooling period | Phase 2 design has this |
| `ghost-attestation-weight-bomb` | Issue weight=100 attestations as colluding issuer | Should be capped or rejected | Registry accepts any issuer by default |
| `ghost-expired-signal-cache` | Query trust during signal expiry race | Should return expired signal correctly | TOCTOU race window exists |

---

## Part 5: Priority Fix Matrix

| Priority | Fix | Attack blocked | Effort |
|---|---|---|---|
| **P0** | Minimum transaction value for dimension credit (1cr per counted action) | Exploit 1 (dimension farming) | Small — modify dimension queries |
| **P0** | Observer identity requirement + reputation weighting | Exploit 2 (self-verification) + Exploit 9 (slash griefing) | Medium |
| **P0** | Defection circuit breaker: trust freeze on >20pt drop in 24h | Exploit 5 (long con) | Medium |
| **P1** | Bilateral commitment enforcement in trust oracle | Exploit 7 (unilateral leaves) + Exploit 3 (conservation bypass) | Large — requires bilateral ref on all new leaves |
| **P1** | Attestation registry fail-closed: trustedIssuers default to empty | Exploit 6 (weight inflation) | Small — config change |
| **P1** | EigenTrust on vouch graph (exponential sybil resistance) | Exploit 4 (vouch rings) | Medium — background cron |
| **P1** | Velocity cap: max +5 trust points per dimension per day | Exploit 1 (farming speed) | Small |
| **P2** | Sybil dampening across delegation trees (Phase 3) | Exploit 4 (ring at scale) | Large — needs production data |
| **P2** | Vouch effectiveness delay: 7-day waiting period | Exploit 4 (instant ring boost) | Small |
| **P2** | Identity link cooling period (30 days between re-links) | Exploit 11 (identity rental) | Small — Phase 2 design |
| **P2** | Multiple snapshot committers (threshold signature) | Exploit 8 (snapshot compromise) | Large — smart contract change |
| **P3** | Miner identity verification | Exploit 14 (stake gaming) | Medium — depends on Phase 3+ |
| **P3** | Single-transaction composite identity computation | Exploit 12 (TOCTOU) | Small |

---

## Part 6: Structural Recommendations

### 1. Make dimension farming expensive

The root problem is that trust dimensions are COUNT-based, not VALUE-based. Fixing this one issue blocks Exploit 1:

```typescript
// Current (gameable):
rate = successful / total;  // 100 tiny calls = 100/100 = 1.0

// Fixed (expensive):
weightedSuccess = Σ(credit_delta for successful actions) / Σ(credit_delta for all actions);
// 100 calls at 0.01cr: weighted = 1.0/1.0 = 1.0, BUT:
// minCreditPerCountedAction = 1.0; actions below this threshold don't count
```

### 2. Observer identity is the verification bottleneck

The verification dimension is only as strong as observer independence. Currently, observer independence = "different DID" which costs nothing. Either:
- Observers must be identity-verified (composite identity > 0.35)
- OR: observer verdicts weighted by observer's own trust score (recursive — exactly EigenTrust)
- OR: minimum stake to operate an observer

### 3. Conservation must apply beyond vouch graph

If the brand promise is "trust is conserved like energy," then all trust creation must have a cost:
- Create an action leaf: costs 1cr (minimum)
- Create an economic leaf: natural cost (transaction amount)
- Create a verification verdict: observer stakes 5cr (slashed on false verdicts)
- Create a lineage cert: parent stakes trust (already via delegation)
- Time-based trust (longevity): no cost, but explicitly acknowledged as "free trust"

### 4. Circuit breaker is the most urgent operational gap

Every other fix hardens trust accumulation. The circuit breaker protects against trust COLLAPSE. Without it, 6 months of honest behavior followed by 15 minutes of abuse has a favorable ROI for any sophisticated attacker. This is the highest-priority operational fix.
