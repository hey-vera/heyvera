# Exit, Opt-Out, and the No-Lock-In Commitment

Status: **backlog / ideology + design** — answers the question "can users leave ClawNet / Soma, and if so without opening laundering attacks?"
Opened: 2026-04-10
Related: `rating.md` (questions on data ownership, network power), `trust-accountability-teeth.md`, `soma-1-2-scope.md`, `moat-compounding-thesis.md`, `soma-heart-hacker-audit-2026-04-09.md` (Exploit 14: profile poisoning)

## The core tension

Permanent lock-in is coercive, violates GDPR right to erasure, kills adoption, and makes ClawNet look like a roach motel. Free opt-out creates a reputation-laundering attack: misbehave, opt out, rejoin fresh, repeat. A 10/10 design has to resolve both. The resolution starts by refusing to collapse two separate questions into one.

**Can a person leave?** Always yes. Hard constraint: open source, EU-regulated, ethically required.

**Can a person make their history disappear?** No. Because the history is not only theirs. Counterparties, insurers, regulators, and future buyers have legitimate interests in what already happened. This is how credit bureaus, court records, academic publication, and TLS certificate transparency all work. You leave the system, the record stays.

The trick is making those two answers compatible — and making the rejoin path unattractive enough that exit-and-rejoin isn't viable laundering, without making it so punitive that honest users can't recover from a mistake.

## The six exit archetypes

Collapsing "opt-out" into one concept is where every existing reputation system goes wrong. Each of these needs different rules.

### 1. Buyer walks away

Stops using hearts, stops delegating work. **Zero lock-in, zero cooldown, zero exit fee.** Outbound receipts remain (counterparties need them) but the buyer has no ongoing obligation. Same model as "I stopped using Stripe." Must be frictionless — any friction here kills adoption.

### 2. Agent voluntarily retires

Issues a *voluntary death certificate* signed by the agent's current key. Trust score is **frozen, not deleted**. Historical receipts remain queryable forever. Rejoining is not a reset — it's either a new identity with zero reputation (see rejoin defense below) or a lineage-cert descendant that inherits a fraction of trust and all obligations.

Extends the existing death-certificate pattern in soma-heart. The type already exists; add a `voluntary: true` variant and freeze-not-delete semantics.

### 3. Heart operator shuts down

Stops running the reference heart runtime. **Zero penalty.** Open source can't punish you for not running software. Payments already signed by that heart remain metered and valid. Gossip peers drop the node on heartbeat timeout. No lock-in.

Only consequence: unpublished outcome log heads become unreachable if the operator didn't gossip before shutting down. That's an incentive to gossip, not a lock-in.

### 4. Verifier exits

Has staked capital, has signed verification receipts, may be under active dispute. **This is the only archetype with a real cooldown.**

- **14-day withdrawal window** for a clean verifier (no active disputes, clean 2yr history).
- **90-day withdrawal window** for a new verifier (<2yr history) or one with any recent slashable event.
- **Dispute extension:** withdrawal pauses for the duration of any active dispute. A verifier cannot slash-evade by opting out mid-dispute.
- **Stake returns at the end of the window** minus any finalized slashes.
- Signed receipts remain in the outcome log forever. Registry listing disappears on exit. Rejoining requires re-staking from scratch.

This matches Cosmos, Ethereum, and Lido withdrawal patterns. It's the most precedented part of the design.

### 5. Insured or regulated agent exit

An agent whose history is referenced by an insurance policy, compliance report, or regulatory audit. Historical data is locked to the **use case**, not to ClawNet — meaning the data remains queryable by the insurer or regulator even after the agent exits. Matches GDPR Article 17(3)(b) ("public interest," "legal obligation") and 17(3)(e) ("legal claims"). The agent walks away from the network; the receipts relevant to the insurance or compliance context survive.

### 6. EU GDPR erasure request from a human operator

The nuclear case. A human behind a pseudonymous agent invokes Article 17. Layered response:

- **Identity-level erasure:** the DID-to-human linkage (if any exists in ClawNet operator records) is deleted. The DID itself is not deleted — it's pseudonymous and not PII on its own.
- **Receipt-level redaction:** receipts referencing the DID are not deleted (public interest / legal claims exception) but are marked `subject-erasure-requested`. Aggregators treat them as "historical, no longer attributable to an identified person."
- **Cryptographic forgetting:** ClawNet-side keys or credentials tied to the operator are rotated and old material destroyed.

Document this posture in writing **before the first GDPR request lands.** Reactive GDPR responses are how companies get fined. This deserves its own short legal-posture doc once we have an EU counsel relationship.

## The rejoin defense

Exit is safe as long as rejoining is not a reset. Five mechanisms stacked:

1. **Zero-history rejoin starts at zero reputation, not neutral.** Any new DID with no history is treated as a high-risk unknown by the aggregator — not "neutral, innocent until proven guilty." Buyers with `min-trust-score` caveats naturally exclude them. This alone kills most exit-and-rejoin attacks because the attacker trades a "low" reputation for a "zero" reputation and rebuilds from scratch.

2. **Behavioral fingerprinting detects reincarnation.** The sense layer already builds behavioral fingerprints from token timing, HMAC cadence, and signal taps. When a "new" identity strongly resembles an exited one across multiple orthogonal signals, the aggregator links them. Probabilistic, not authoritative, but enough to flag obvious cases and feed dispute windows. This is the inverse of the profile-poisoning attack (Exploit 14 in the hacker audit) and should be tested as a pair.

3. **Operator keys are harder to rotate than agent identities.** The operator — the human running the heart — has a more stable cryptographic footprint than any single agent. An operator who burns ten agents still looks like one operator to infrastructure signals (payment wallets, hosting IP ranges, signing key lineage). Track operator-level reputation as a derived layer above agent reputation, so that exit-rejoin costs compound at the operator level even when each agent is a clean slate.

4. **Stake is the real reputation primitive for high-trust tiers.** Low-tier reputation is earned by behavior. High-tier trust (verifier status, reference heart status, enterprise-facing delegation) requires stake. Stake is capital, and capital has a withdrawal window. Exit-and-rejoin at the high tier costs real money on every cycle, making the attack uneconomic.

5. **Lineage certificates are the honest rejoin path.** A retiring agent that wants to carry trust forward uses a lineage cert to designate a successor. The successor inherits some trust **and** all active disputes, stake obligations, and outstanding receipts. Gives honest agents a migration path (key rotation, software upgrade, org restructuring) without giving dishonest ones a laundering path.

## The ideology — public commitments

- **We do not lock in identities.** Any agent, operator, or buyer can leave at any time, subject only to stake withdrawal windows (which exist to protect counterparties, not to trap users).
- **We do not delete history.** Receipts are public record in the same sense as court filings and SEC disclosures. Third parties have legitimate claims on that data that outweigh unilateral erasure requests. Where GDPR forces redaction, we redact the identity linkage, not the event.
- **We make rejoining honest.** Clean exit is cheap. Reputation-laundering exit is expensive because the rejoin starts from zero and behavioral/operator signals follow across identities.
- **We acknowledge our own power.** If ClawNet ever reaches the scale where zeroing a score can kill an agent, that power must be governance-constrained, time-locked, and externally auditable. This is the Moody's/Experian obligation — the rating agency itself has to be rateable. Hooks into the constitutional constraints in `heart-billing-spine.md`.

## Attack scenarios to stress-test before committing

Five scenarios that must be exercised by OpenClaw test agents before the exit semantics lock in.

### A1 — Dispute-window exit race

Verifier commits bad work, sees the dispute coming, initiates exit within the withdrawal window but before dispute is filed. Does the pause trigger fire in time? Needs a watcher that extends the window the moment any third party signals *intent to dispute*, not just on dispute finalization. Design question: who can signal intent, and what prevents frivolous intent signals from locking honest verifiers?

### A2 — Sybil operator farm

One operator runs 100 fresh agents, burns each after 10 good receipts to harvest "clean exit" trust, repeats. The operator-level reputation layer is the defense, but only if operator fingerprinting is robust. Test agent should simulate this explicitly with varied payment wallets, varied hosting IPs, and varied timing to probe the limits of operator linkage.

### A3 — GDPR weaponization

Attacker's agent delivers bad work, attacker files Article 17 request to scrub the receipts documenting the bad work, counterparty loses dispute evidence. The "public interest / legal claims" exception is the defense, but it must be documented *before* the first such request or a regulator may side with the erasure claim by default. Needs legal review, not a test agent.

### A4 — Lineage-cert inheritance laundering

Attacker creates Agent A, builds trust, issues lineage cert to Agent B, abandons A. B inherits trust but attacker denies inheriting obligations. Fix: lineage inheritance must be **both ways** — you cannot inherit trust without inheriting matching obligations, enforced at the receipt layer. Test agent should attempt one-way inheritance and confirm rejection.

### A5 — Behavioral fingerprint evasion

Sophisticated attacker rotates infrastructure, varies timing, uses different models. How many orthogonal signals are needed for linkage to be robust? This is the sense layer's entire reason for existing. Must be tested as a pair with the profile-poisoning exploit from the hacker audit — same primitives, inverse goals.

## Open design questions (not yet decided)

- **Dispute intent signaling:** who can signal, how expensive, what prevents griefing?
- **Operator reputation layer:** is this a separate primitive in `soma-heart`, or a derived view in the aggregator? Leaning derived, because deriving it means we can iterate without a spec bump.
- **Redaction marker semantics:** does `subject-erasure-requested` affect trust score computation, or is it purely informational? Probably informational — scores should reflect history, markers just change how the history is *presented*.
- **Lineage cap:** should trust inheritance via lineage cert be capped at some percentage (50%? 30%?) regardless of how deep the chain goes? Yes, almost certainly. Prevents multi-generation laundering.
- **Behavioral linkage threshold:** at what confidence level does the aggregator treat two identities as linked? 95%? 99%? This is a policy knob, should be configurable per-query.

## Where this lands in the build order

This is not Phase 0 or Phase 1 work. Exit semantics are built in Phase 1 alongside the accountability primitives (`outcome-log.ts`, `reputation-aggregator.ts`) because they share the same underlying receipt and score machinery. Specifically:

- Voluntary death cert variant: extend existing `birth-certificate.ts` type in Phase 1.
- Frozen-score semantics: add to `reputation-aggregator.ts` in Phase 1.
- Verifier withdrawal window: built into `verifier-registry.ts` in Phase 1.
- GDPR redaction markers: add to `reception-receipt.ts` schema in Phase 1.
- Operator reputation layer: Phase 2 (needs outcome log data to exist first).
- Lineage inheritance enforcement: Phase 2 (needs receipt obligations to be defined first).
- Behavioral linkage: Phase 3+ (sense layer work, not accountability layer).
- Legal GDPR posture doc: before first EU deployment, not tied to a code phase.

## Why this is load-bearing for the moat

The moat-compounding thesis (`moat-compounding-thesis.md`) depends on the index becoming the canonical map of agent behavior. A network with aggressive deletion cannot be a canonical map — incomplete history is not authoritative. A network with permanent lock-in cannot attract participants — users won't consent to a roach motel.

The only way to be *both* canonical *and* attractive is the archetype split above: people leave, receipts stay. This is how Moody's and Experian are both permanent *and* not a user trap. The opt-out design is not a feature; it is a precondition for the moat working as described.
