# Soma 1.2 Scope — Buyer-Paid Verification & Trust Teeth

Status: **backlog / design** — not yet built. Next major Soma spec bump after 1.1.
Opened: 2026-04-10
Updated: 2026-04-11 — reframed around ERC-8004 as canonical on-chain signal store per 2026-04-11 pressure test (see `soma-1-2-adversarial-pressure-test.md`); added D4 mandatory public-goods disputer; added D5 EigenLayer AVS as primary L4 bond source; added Adjacent Integration Surfaces section (AP2 Mandate adapter, Stripe MPP side-car, ERC-8004 read/write-back, World ID personhood). Prior update 2026-04-10 added billing spine revenue architecture, battle-tested fee stack, dynamic parameters, kill metric.
Related: `trust-accountability-teeth.md`, `soma-1-2-adversarial-pressure-test.md`, `trust-mining-economy.md`, `soma-trust-salvage-from-aid.md`, `wallet-rotation-architecture.md`, `heart-billing-spine.md`, `moat-compounding-thesis.md`, `rating.md`, Soma `SOMA-CAPABILITIES-SPEC.md` (1.1)

## Core insight

The cleanest accountability mechanism is **the buyer pays for verification.** Not the seller (conflict of interest). Not the user (time pressure, won't do it). Not a shared fund (tragedy of commons). **The party who is about to rely on the work pays an independent verifier to confirm it before accepting the result.**

This is a market, not a promise. It aligns incentives:

- Buyer has direct interest in catching bad work before it lands.
- Verifier makes money per check and loses business if they lie.
- Seller knows their work will be checked, which itself raises average quality.
- No single party can silently corrupt the system.

Original user framing: *"possibly the person buying the agent to do work, theyll pay for like nova verification through their soma heart?"*

Yes. That's the mechanism.

## External anchor — ERC-8004 is the canonical on-chain signal store

**ERC-8004 went live 2026-01-29 as a live Ethereum standard and has 1000–2000 builders shipping on it as of early Q2 2026.** It defines three minimal on-chain registries (Identity, Reputation, Validation) and **deliberately under-specifies** Sybil defense, verifier independence, score aggregation, freshness, and resale control. From the EIP text: *"The protocol's contribution is to make signals public and use the same schema."*

**Soma 1.2 positions as the off-chain aggregator layer ERC-8004 explicitly delegates to.** Not a parallel identity registry, not a competing public signal store — the aggregator that reads ERC-8004 signals and produces the verifier-independence-scored, freshness-bound, reception-receipt-backed trust number that 8004 intentionally leaves for third parties.

**Implications for the 1.2 build:**

- Soma's `verifier-registry` reads ERC-8004 Reputation registry entries as raw signals. Soma's aggregator is what turns signals into scores.
- Soma's `ReceptionReceipt` is write-back compatible: Soma-issued receipts can be posted to ERC-8004 Validation registry, giving 8004 builders a richer signal source.
- `min-trust-score` caveat reads the Soma aggregator; the Soma aggregator reads both the Soma outcome log AND the ERC-8004 Reputation registry. Two input streams, one score.
- This framing 10x's Soma's addressable index — 1000–2000 existing ERC-8004 builders are all candidate consumers of the aggregator layer.
- This framing also eliminates the "yet another identity registry" moat risk: Soma is not competing with 8004, it's the piece 8004 doesn't ship.

**What is NOT aggregated onto 8004.** Soma's rotation-backed credential system, heartbeat chain, birth certificates, and runtime attestation remain Soma-native. ERC-8004 is about reputation signals, not about identity bootstrap or runtime proofs. The line is: *raw reputation signals → 8004 public store; identity/runtime → Soma heart; aggregation + independence scoring + freshness → Soma 1.2*.

**Risk to watch: Dexter marketplace.** Dexter already glues ERC-8004 + x402 on the Solana side. Needs a deep-read before Soma commits to this positioning — if Dexter is already solving the aggregator problem, Soma is late and must pivot to differentiation (folded receipts via Nova, verifier-independence scoring, AP2 adapter). If Dexter is only wiring raw signals without aggregation, the gap is real and Soma fills it. Listed as a research item in `soma-1-2-adversarial-pressure-test.md`.

See `soma-1-2-adversarial-pressure-test.md` Perspective 2 and golden idea #1 for the full reasoning behind this positioning.

## How it wires into Soma

Delegation gets a new caveat that says "every invocation of this capability must be accompanied by a verification receipt from a trusted verifier, paid for by the invoker's heart."

```typescript
// Added to src/heart/delegation.ts Caveat union
| {
    kind: 'requires-verification';
    verifierDid: string;              // who to ask
    verificationCapability: string;   // what capability to invoke on the verifier
    budgetPerCheck: number;           // credits the heart will spend per check
    sampleRate: number;               // 0..1 — stochastic sampling allowed
    mode: 'sync' | 'async';           // block on verification, or log after
    timeoutMs?: number;
  }
| { kind: 'min-trust-score'; score: number; lookbackMs?: number }
| { kind: 'max-recent-failures'; count: number; windowMs: number }
```

`requires-verification` is the mechanism. `min-trust-score` and `max-recent-failures` are the gates that use the resulting outcome log (see `trust-accountability-teeth.md`).

## Example: code review worker

```
Alice → Bob (worker agent)
capabilities: ["tool:code-review"]
caveats:
  - budget: 1000 credits
  - requires-verification:
      verifierDid: did:key:zNova
      verificationCapability: tool:verify:code-review
      budgetPerCheck: 10
      sampleRate: 1.0
      mode: async
  - min-trust-score: 0.7
  - expires-at: 30d
```

Every time Bob completes a review, his heart triggers an x402 call to Nova's `tool:verify:code-review` endpoint with 10 credits from Alice's budget. Nova re-reads the PR, runs its own checks, signs a `ReceptionReceipt` with outcome + severity + evidence hash, and returns it. Bob's heart appends it to his outcome log. Alice's next delegation to Bob reads Bob's outcome log to evaluate the `min-trust-score` caveat.

## Package split

- **Soma core (`src/heart/`)** — new primitives: `reception-receipt.ts`, `outcome-log.ts`, `verifier-registry.ts`, `reputation-aggregator.ts`. New caveats in `delegation.ts`. Spec bump to 1.2.

- **`@soma/verification-client`** — the buyer side. Given a delegation with `requires-verification`, triggers the x402 call to the verifier after each invocation, collects the receipt, appends to the local outcome log, gossips the head. Handles sampling, retries, timeouts, receipt verification.

- **`@soma/verifier-sdk`** — the verifier side. Helpers for building a verifier service: validates incoming verification requests, runs the domain-specific check, signs a `ReceptionReceipt`, returns it over x402. Nova is the first consumer of this SDK.

## Nova as reference verifier

Nova (ClawAPIs' OpenClaw bot) is the ideal first verifier because it's:

1. Already agent-native and x402-native.
2. Already running in the same ecosystem we want to land (see `heydata-clawapis-soma-pitch.md`).
3. Greenfield — no retrofit pain.
4. A business case: ClawAPIs charges per verification, which directly funds Nova operation.

**What Nova first verifies.** Start narrow. Best candidate domains:

- **Code review / PR analysis** — deterministic re-check, clear success criteria, easy to compare outputs.
- **x402 endpoint response integrity** — re-fetch, compare hashes, confirm provider didn't silently change data. Cross-references Soma Check.
- **Deploy outcome verification** — pre/post state snapshot comparison (requires TEE attestation for strong version, heuristic version works earlier).

**What Nova should NOT try to verify first.** Open-ended creative work, natural language quality, anything where "correct" is subjective. Save for 1.3+.

## HeyDATA Data Skills application

Once Nova is live as a verifier, HeyDATA's Data Skills become the killer application. Every Data Skill runs under a Soma delegation; every high-stakes action (send email, spend x402, write to Notion) gets a `requires-verification` caveat pointing at Nova or another trusted verifier. The Skill cannot silently do damage — every consequential action is checked by an independent party before it lands.

This is what turns "HeyDATA has a trust story" from marketing claim into mechanical property.

## Adjacent integration surfaces

Soma 1.2 positions against three live 2026 payment/identity standards in addition to x402. Shipping adapters for each unlocks distribution Nova-as-first-client alone cannot reach. All four adapters below are candidate work items for Phase 1.5 / 2.0, not Phase 1 — but the architectural decisions for each must be made now because they affect the shape of the 1.2 primitives.

### AP2 Mandate adapter (Google Agent Payment Protocol)

Google AP2 launched March 2026 with 60+ partners across payment networks. **It has no reputation layer by design** — reputation is explicitly designed to come from third-party extensions. If Soma delegation caveats (`requires-personhood`, `min-trust-score`, `max-recent-failures`) speak AP2 VDC (Verifiable Digital Credentials) format, Soma rides onto those 60+ partners as the reputation extension AP2 punted on.

Concrete work:
- Map `requires-verification` to AP2 Intent Mandate extensions
- Map `min-trust-score` / `max-recent-failures` to AP2 Cart Mandate extensions
- `@soma/ap2-adapter` package as a new SDK surface alongside `@soma/verification-client` and `@soma/verifier-sdk`

Two-week integration estimate. Highest distribution ROI in 1.2.

### Stripe MPP side-car

Stripe Machine Payment Protocol launched 2026-03-18 with 100+ day-one partners including Anthropic and OpenAI. It's session-based with Shared Payment Tokens (SPTs). **An MPP session is a natural fold boundary for reception streams** — one session commits to a start, end, sub-action set, and final outcome.

Integration pattern is side-car: a process observes MPP session streams, produces one folded reception receipt per session, publishes it on-chain as a Soma trust block (see `trust-mining-economy.md`). MPP does not need to know about Soma; Stripe cooperation is not required. This is the cleanest path to retail-rail agent-commerce trust.

### ERC-8004 read/write-back

Covered under "External anchor" above. Soma aggregator reads ERC-8004 Reputation registry as a raw signal source; Soma-issued ReceptionReceipts can be posted back to ERC-8004 Validation registry as enriched signals. Bidirectional, not competitive.

### World ID + Coinbase AgentKit (personhood caveat)

World ID + AgentKit launched March 2026 as the first productized path for proving the human behind an agent. Soma's `requires-personhood` caveat (from salvaged concept 7 in `soma-trust-salvage-from-aid.md`) reads a World ID proof as a pluggable credential, not as a score multiplier. Keeps "Soma proves WHETHER, World proves WHO" cleanly separated — the two signals are orthogonal and compose via AND in a caveat, never collapse into one number.

## Open questions

1. **Verification cost vs. work cost.** If verification costs 50% of the work itself, the economics don't work for small jobs. Mitigation: `sampleRate < 1.0` for routine work, `sampleRate = 1.0` for money movement / irreversible actions.

2. **Verifier collusion.** A bribed verifier is indistinguishable from a correct one until a third party recomputes. Mitigation: high-stakes work uses quorum (`requires-verification` extended to `verifierDids: string[]` in 1.3). Out of scope for 1.2.

3. **Turtles all the way down.** Verifiers need verifiers too. Termination: verifiers are rated by the buyer population over time. A verifier that's wrong loses business. The terminal node is the buyer's own satisfaction, which is not a rating but a purchase decision.

4. **Privacy.** Outcome logs leak behavioral patterns. 1.2 ships public logs; 1.3 considers selective-disclosure proofs.

5. **Latency.** `mode: 'sync'` blocks on verification, adding latency to every action. Default to `async` for most caveats; reserve `sync` for irreversible operations.

6. **Replay forgery.** A verifier's receipt must be bound to the specific action digest so it can't be reused. Already handled by including `actionDigest` in the signed receipt.

7. **Cold start.** New agents have no score. Bootstrap either with conservative defaults, grace delegations requiring step-up on every action, or human approval for first N runs. Need to pick one and document.

8. **What counts as "evidence"?** Domain-specific. For x402 responses, it's the response hash. For deploys, ideally TEE-attested post-state. For PRs, the PR URL + commit hash. Soma can't standardize this centrally; it's per capability class.

## Code shapes to preserve verbatim

```typescript
// reception-receipt.ts
interface ReceptionReceipt {
  protocol: 'soma-receipt/1';
  actionDigest: string;
  agentDid: string;
  ratedBy: string;
  outcome: 'success' | 'partial' | 'failed' | 'harmful';
  severity: number;
  evidence: string;
  ratedAt: number;
  signature: string;
}

// outcome-log.ts — mirror of revocation-log.ts
interface OutcomeLogEntry {
  seq: number;
  prevHash: string;
  receipt: ReceptionReceipt;
  appendedAt: number;
  entryHash: string;
}

// reputation-aggregator.ts
interface TrustScore {
  score: number;          // 0..1
  sampleCount: number;
  mostRecentAt: number;
  harmfulInWindow: number;
  formulaVersion: 'v1';
}
function computeTrustScore(log: OutcomeLog, now: number): TrustScore;
```

## Billing spine and revenue architecture

Soma 1.2 does not just add accountability primitives — it formalizes the heart as the billing spine for the agent economy. This section captures the fee architecture, token flow, and kill metric that the build is designed around. Full architectural detail is in `heart-billing-spine.md`.

### Core principle (supersedes trust-query-only fee model)

**Heart is the spine. Every payment a reference heart signs pays a base metering fee. Trust products layer on top.** The previous framing ("free routing, paid trust queries only") is correct for the pre-spine era but undercounts revenue once heart becomes the runtime through which all agent I/O flows. The billing point is the sign, not the registry.

### Seven-layer fee stack

| # | Layer | Rate | Applies to | Notes |
|---|---|---|---|---|
| L1 | Heart base metering | 5 bps (floor 1, ceiling 10) | Every x402 payment a reference heart signs | Primary revenue at scale; TAM = all agent payments |
| L2 | Verification routing premium | +50 bps (floor 25, ceiling 100) | Verification calls via registry-discovered verifiers | Stacked on L1; waived for direct buyer→verifier flows |
| L3 | Trust oracle queries | 0.03 cr dimensional / 0.05 cr full / 0.001 cr historical | Registry lookups | Unchanged from existing fee model |
| L4 | Verifier staking | $5K / $25K / $50K USD-equiv in $CLAWNET at TWAP | Registering as a verifier per capability-class tier | USD-denominated, slashed on proven bad verification |
| L5 | Subscriptions + proofs | $100–$1000/yr / 25 cr Groth16 | Trust product consumers | Unchanged |
| L6 | Insurance data licensing | Enterprise per-seat, Year 3+ | Actuarial feeds for agent-action underwriters | Highest margin stream, not launched Year 1 |
| L7 | Jurisdiction compliance reports | Per-report or per-seat, Year 2+ | EU AI Act and equivalent compliance artifacts | Same shape as SOC 2 audit services |

Floors protect against governance zeroing out fees. Ceilings protect against rent extraction. Neither can be changed without supermajority + time-lock.

### Dynamic parameters

- L1 and L2 rates tunable within floor/ceiling via $CLAWNET governance, time-locked 14 days.
- L4 staking USD-denominated via TWAP lookback — stable across token price volatility.
- Burn rate adjusts programmatically toward target supply curve; no manual tuning.
- Subscription tiers adjust to user profile (new, enterprise, public-goods waiver).
- Staking amounts scale by capability-class risk tier.

### Treasury allocation

All protocol fees route to a USDC treasury (multi-chain: Base, Solana, Ethereum):

- 35% → $CLAWNET buy-and-burn, weekly, TWAP-based
- 25% → protocol operations (aggregator infrastructure, servers, audits, reference implementations)
- 30% → ecosystem grants (verifier reference implementations, open-source tooling, integrations, documentation)
- 10% → insurance reserve (slashing disputes, bad-verifier buyer compensation)

Grants allocation is high on purpose. The ecosystem needs funded reference work more than it needs aggressive burns in the early years.

### Staking and slashing defenses

Staking alone does not prevent verifier rug-pulls. Three stacked defenses required:

1. **Time-locked withdrawal**: 14 days minimum, during which fresh receipts can still trigger slashing.
2. **Reputation-weighted unlock**: new verifier = 90-day cooldown; 2-year clean = 14-day cooldown. Bad actors structurally locked in longer.
3. **Quorum-dispute slashing**: any third party can submit a dispute by deterministically recomputing a verification. If the dispute holds, the original verifier is slashed and the disputer earns a portion. Standing bounty for catching bad verifiers.

### $CLAWNET demand sinks (four, orthogonal)

- **Stake**: verifiers lock USD-equivalent for registry operation.
- **Burn**: 35% of fee revenue buy-and-burn, weekly TWAP.
- **Gas**: trust operations paid in $CLAWNET get 10% discount vs. USDC (Chainlink CCIP trick — surcharge non-native payment).
- **Credit**: burn-for-credits at 15% discount vs. Stripe (already in existing fee model).

Supply side: heart operators earn $CLAWNET for publishing outcome log heads and serving as gossip peers. Indexer-reward pattern from The Graph. Creates daily emissions paid to actual protocol work.

### Kill metric (named explicitly before emotional attachment)

**If 18 months after Soma 1.2 launch, fewer than 100 reference hearts run in production AND less than $1M/month in x402 volume passes through metered hearts, the thesis is broken. Pivot target: Soma-as-compliance-tool for supervised AI, sold into regulated industries (medical, legal, financial).** Smaller market, different sales motion, but the primitives still have real value in a world where autonomous agents don't materialize at the expected pace.

### What this does NOT depend on

- Does not depend on ClawNet running a first-party commercial verifier. Registry operation is the ClawNet position; first-party verification remains out-of-scope to preserve neutrality. Optional exception: public-goods verifier for open-source supply chain and public dataset integrity, priced at cost.
- Does not depend on the token launching before revenue is real. Launch trigger at $50K+ monthly revenue sustained across 3 months, unchanged from existing fee model.
- Does not depend on a single chain. Treasury and metering are chain-agnostic by design.

## Open decisions — must be ratified before Phase 1 locks in

These three values are written above as stated positions, but they are **not yet ratified**. They must be stress-tested and signed off before `src/heart/metering.ts` and treasury routing land, because the code will encode them. Revisit at the start of Phase 1.

### D1 — Treasury split (35% burn / 25% ops / 30% grants / 10% insurance reserve)

Deliberately weighted toward distribution over scarcity. The grants-heavy allocation is because grants fund reference implementations that feed the index, and the index is the moat (see `moat-compounding-thesis.md`). Token holders will push for 50%+ burn by analogy to Curve, The Graph, MakerDAO.

**Stress test before ratifying:**
- Model burn rate vs. ecosystem growth at 35% vs. 50% vs. 65% across Year 1-3 volume assumptions.
- Identify the crossover point where grants are no longer load-bearing for index completeness (probably once >500 reference hearts exist and the index is self-sustaining).
- Consider a time-varying split: high grants early (bootstrapping the index), shifting toward higher burn after the kill-metric checkpoint at 18 months.
- Hard floor for insurance reserve (10%) is non-negotiable — it's what makes the Year-3 insurance integration possible.

**Change cost:** rewriting one doc now is free. Arguing with token holders at launch is expensive. Decide before the treasury contract ships.

### D2 — Kill-metric thresholds (<100 reference hearts AND <$1M/month metered volume at 18 months)

Guessed values for "meaningful traction." Both numbers need a defensible derivation before we commit.

**Stress test before ratifying:**
- What's the minimum heart count where the outcome log index produces statistically useful aggregator scores? If it's 50, 100 is too high. If it's 200, 100 is too low.
- What's the monthly volume where L1 metering alone (5 bps) covers ops cost? Below that, the protocol can't fund itself regardless of moat argument. $1M/month × 5 bps = $500/month — that's clearly too low for protocol ops, so the $1M threshold is *traction signal*, not self-sufficiency signal. Name that distinction in the doc.
- Consider a two-tier kill metric: "concerning" at one level, "pivot" at another. Gives an early warning instead of a cliff.
- What does the pivot-target market (Soma-as-compliance-tool for regulated industries) actually look like financially? If the pivot is viable at any scale, the kill metric can be sharper. If the pivot is itself speculative, the kill metric should be looser.

**Change cost:** changing the number is cheap, but naming it publicly and then walking it back costs credibility. Ratify only after modeling.

### D3 — Neutrality stance (no first-party commercial verifier, one carve-out for public-goods verification at cost)

The Moody's-style argument says absolute neutrality is more valuable than any single verifier revenue line. The carve-out exists because open-source supply chain integrity and public dataset integrity are *public goods* that nobody else will fund, and running them at cost doesn't compromise neutrality the way a profit-making verifier would.

**Stress test before ratifying:**
- Does "at cost" actually hold over time, or does it drift toward profit once the infrastructure exists? (Every "at cost" service in history has drifted.)
- Does running any verifier, even at cost, create a precedent that makes it easier for governance to approve profit-making verifiers later?
- Is there a structural separation (separate legal entity, separate keys, separate governance) that makes the carve-out credible to insurance underwriters and regulators in Year 3+?
- The strict-neutrality alternative: ClawNet runs zero verifiers, public-goods verification is funded via ecosystem grants (L treasury line 30%) to independent operators. Cleaner, but slower to stand up.

**Change cost:** adding a verifier later is easy. Removing one after it exists is politically expensive. Default to strict neutrality unless the carve-out has a specific champion.

### D4 — Mandatory public-goods disputer funded by L7.5 non-governable protocol fee

D3 handles the public-goods *verifier* question. D4 is separate and orthogonal: the public-goods *disputer* — the party that continuously recomputes high-value mined blocks and dispute-slashes verifiers who rubber-stamped them — is **not optional**. It is the circuit breaker against buyer-verifier collusion, which is otherwise undetected because the slashing signal in the current model is itself a receipt (recursive, no ground truth).

The original framing treated the disputer role as "anyone can register as a disputer, earn from correct disputes" and assumed market forces would fund continuous coverage. The pressure test (`soma-1-2-adversarial-pressure-test.md` Perspective 1 "Buyer-verifier collusion") exposed that this fails when the buyer *is* the colluding party — there's no external buyer demand for disputes, so the role is underfunded by default and collusion goes undetected.

**Proposed shape:**
- Fixed 10–20% of L5 trust-product fees routed to a disputer funding pool at protocol level. Call it L7.5 — sits above L5 but below the Year-3 insurance (L6) and compliance (L7) layers.
- **Non-governable**: cannot be zeroed out or lowered by $CLAWNET governance. Same rationale as fee floors in L1/L2.
- Disputer is a **role**, not a specific operator. Any party can register, earn from correct disputes, lose bond on incorrect disputes. Same bonding model as L4 verifiers (probably via EigenLayer AVS per D5 below).
- **Target coverage**: every mined block above a USD-equivalent threshold gets at least one independent recomputation within its TTL window. Threshold adjustable by governance; floor non-governable.
- ClawNet does not operate a first-party disputer (preserves D3 neutrality). The pool funds permissionless operators who bid to take coverage shifts.

**Stress test before ratifying:**
- What % actually funds meaningful coverage at Year 1-3 L5 volumes? Model at 10%, 15%, 20% against expected revenue.
- Is "high value" measured USD-equivalent at mine-time, adjusted for buyer identity (higher coverage for non-public-goods buyers)? Needs a formula before code locks in.
- Does the disputer role itself Sybil? Bonded stake + slashing on incorrect disputes should handle this, same as L4 — but the disputer has an asymmetric incentive (only rewarded when it finds something), which changes the Sybil math vs. verifiers.
- Does the non-governable fee conflict with D3 strict neutrality? No — ClawNet is routing protocol fees to a permissionless role, not operating the role.
- Coverage threshold: if set too low, disputer work is unfundable; if set too high, buyer-verifier collusion below the threshold is a safe harbor. Model against real block value distributions.

**Change cost:** making the disputer mandatory later is very hard because governance will resist adding a non-governable fee line. Decide now, encode in the treasury-routing contract on Day 1.

### D5 — EigenLayer AVS as primary L4 bond source (vs. $CLAWNET-only staking)

L4 verifier staking currently requires $CLAWNET-denominated bonds ($5K / $25K / $50K USD-equivalent per tier at TWAP). For Year 1, before $CLAWNET has real secondary-market depth, the total slashable bond pool is capped at whatever $CLAWNET float exists. **That's not enough to bond high-value verification where the false-positive value can be $100K+.** Economic bribery goes undefended (see `soma-1-2-adversarial-pressure-test.md` Perspective 1).

EigenLayer has ~$18B restaked TVL as of 2026-Q2 and EigenVerify already targets AI inference verification. Registering Soma verification as an AVS means verifiers restake ETH instead of $CLAWNET, borrowing from a pool 1000× bigger than $CLAWNET will be in Year 1.

**Proposed shape:**
- **Primary bond source**: EigenLayer restaked ETH via AVS registration. Covers both L4 verifier staking *and* miner bonds for folded-session blocks in `trust-mining-economy.md`.
- **$CLAWNET staking remains** as an optional secondary bond (gives the staker L3 fee discounts + governance weight + L4 signal boost).
- L4 slashing hits the AVS position first, $CLAWNET position second.
- Over time, as $CLAWNET demand matures, the ratio shifts toward $CLAWNET.
- Solana-side: equivalent integration via Jito / Solayer restaking (when we expand beyond Base).

**Stress test before ratifying:**
- Does AVS-native bonding reduce $CLAWNET demand to the point the four-sink model (Stake / Burn / Gas / Credit) breaks? The Stake sink shrinks but doesn't zero — still needed for governance weight and L3 discounts. Model the demand impact.
- What's EigenLayer's actual onboarding friction for a new AVS? Reference: EigenVerify was a multi-month integration. Budget 2-4 months for Soma AVS registration. Phase 1 probably can't wait for it — launch with $CLAWNET-only bonds and migrate primary source to AVS in Phase 1.5.
- Does using EigenLayer constrain Soma to Ethereum L1/L2 for settlement, breaking the chain-neutrality claim in `heart-billing-spine.md`? The heart itself stays chain-neutral; only the bond position is ETH-native. Document this separation explicitly.
- What happens if EigenLayer itself has a security incident? Bond source diversification is a defense — $CLAWNET staking remaining as secondary gives Soma a fallback.

**Change cost:** AVS integration is a months-long commitment. Deciding to pursue it later is fine (Phase 1.5 migration is cheap). Deciding *not* to pursue it after designing the bond system around it is expensive. Make the directional decision now, schedule the work for after Phase 1.

### Ratification process

Before Phase 1 kicks off:
1. Model D1, D2, and D4 with real numbers (even rough ones beat guesses). Especially the L7.5 disputer pool percentage and coverage threshold — these drive treasury-routing contract shape.
2. Pick a position on D3 — strict neutrality or carve-out with structural separation.
3. Pick a direction on D5 — commit to EigenLayer AVS as Phase 1.5 migration target, or reject it and stay $CLAWNET-only. Affects how `verifier-registry.ts` models bond state.
4. Update this doc + `project_fee_model.md` memory + `heart-billing-spine.md` + `trust-mining-economy.md` with the ratified values.
5. Only then write `src/heart/metering.ts` and the treasury routing code.

## Build order

1. `reception-receipt.ts` + tests.
2. `outcome-log.ts` + tests (tamper, replay, gossip round-trip).
3. `reputation-aggregator.ts` + tests with fixture logs.
4. `verifier-registry.ts` + tests.
5. `requires-verification`, `min-trust-score`, `max-recent-failures` caveats + tests.
6. Spec bump to `soma-capabilities/1.2`.
7. `@soma/verification-client` package.
8. `@soma/verifier-sdk` package.
9. Nova reference verifier implementation for one domain (probably x402 response integrity — simplest, closest to Soma Check).
10. First production test: ClawNet as buyer, Nova as verifier, test agent as worker. See `gameplan-post-1-1.md`.
