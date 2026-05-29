**1. Soma’s Soul**

Soma believes trust is not a claim. Trust is an earned, witnessed, revocable, time-bound property of computation.

Its core thesis appears most clearly in [soma-future-proofing.md]:

> “Identity = cryptographic attestation of a computation, verified by a sovereign observer.”

That sentence is the soul. Not “identity = account,” not “identity = wallet,” not “identity = human KYC,” not “identity = keypair.” Identity is the observable continuity of a behaving computational being, and it is only meaningful when verified by someone other than itself.

Three philosophical commitments recur across the corpus:

1. **The subject cannot be its own source of truth.**  
   [soma-future-proofing.md] says: “Heart never self-verifies; sense never runs in-process with heart.” This is not an implementation detail. It is Soma’s epistemology. Soma assumes self-attestation is structurally corruptible.

2. **Trust must have memory.**  
   Heartbeats, pulse trees, outcome logs, rotation logs, custody logs, death certificates, receipts, and mined trust blocks are all versions of one idea: action should leave a cryptographic fossil. [soma-computation-witness.md] calls this “metabolism”: “the proof IS the computation.”

3. **Authority must be scoped, attenuated, and revocable.**  
   [soma-delegation-spec.md] makes delegation bounded by depth, scope, spend, TTL, intent, and cascade revoke. Soma does not believe in handing agents “the parent’s full API key.” It believes agency must be delegated like fire: useful only when contained.

What would be lost if Soma were described as “just a signing library” is the entire moral architecture. A signing library says, “this key signed this message.” Soma says, “this actor was born, acted, delegated, paid, accessed data, was observed, earned or lost trust, rotated credentials, and may die, all under a chain of accountable evidence.”

**2. How The Thinking Evolved**

The earliest shape is “prove origin.” Birth certificates, HMACs, per-token or per-event attestations, signed receipts. That stage is still present in [soma-future-proofing.md], which admits the initial language was too LLM-specific: “The NAME ‘per-token HMAC’ bakes in the LLM assumption.” The idea survived, but transformed into “per-computation-event HMAC.”

Then the thinking moved from **origin** to **lifecycle**. [soma-computation-witness.md] is the turning point. Soma stops being a wrapper around outputs and becomes the “metabolic core” of the agent. This is where the single Pulse Tree appears: one append-only structure for actions, payments, checkpoints, proofs, wallets, burner agents, death. The idea that stuck: one root should commit to the whole agent life.

Then the thinking moved from **lifecycle** to **economics**. [soma-delegation-spec.md], [soma-trust-mining.md], and [trust-system-hacker-audit-2026-04-09.md] realize that cryptographic truth is not enough. Agents can behave “honestly” in the narrow sense while farming trust. This is where bilateral commitment, conservation of trust, identity scoring, minimum economic weight, and observer reputation enter.

Then the thinking moved from **trust score** to **trust market**. [soma-1-2-scope.md] reframes Soma as buyer-paid verification and an off-chain aggregation layer over ERC-8004. That is a major evolution: Soma stops trying to own every registry and instead becomes the interpreter of raw trust signals.

Several ideas were abandoned or demoted:

- **Single-factor biometric identity** was demoted. [identity-verification-tiers.md] initially says “one human = one biometric verification,” but [composite-identity-scoring.md] explicitly corrects this: “Single iris scan alone gives 0.35/1.0 instead of 1.0/1.0.”
- **Soma Check revenue extraction** was abandoned. [archive/soma-check-billing.md] says the old 90/10 model was superseded and “code now gives 100% to provider.”
- **Hard delegation depth limits** are conflicted. [soma-delegation-spec.md] uses max depth. [soma-future-proofing.md] later says “No hard depth limit” and prefers soft warning + SNARK compression. This is not fully reconciled.
- **ClawNet as “already best implementation”** was corrected. [soma-readiness-strategy.md] says bluntly: “ClawNet is a solid billing platform with Soma hooks.”

The strongest transformation: Soma began as attested provenance and became a theory of accountable agency.

**3. Soma’s Laws**

**Law 1: The actor never self-verifies.**  
Most clearly stated in [soma-future-proofing.md]: “Observer sovereignty: verification stays on the verifier’s side.” Also: “Heart never self-verifies.” This law forbids collapsing Heart and Sense into one trust domain.

**Law 2: Origin is not truth.**  
[soma-security-audit-2026-04-09.md] flags “Heart presence auto-sets verification flags” as a high severity flaw because it violates “origin is not truth.” A Soma signature proves source, not correctness.

**Law 3: Every consequential action must leave append-only evidence.**  
[soma-computation-witness.md] states “one root = entire agent state.” [soma-custody.md] extends this to data access and deletion. [credential-rotation-architecture.md] says “every effect on the system passes through a signed, anchored, append-only event.”

**Law 4: Delegated authority can only narrow.**  
[soma-delegation-spec.md]: “A child cannot grant itself permissions the parent lacks.” Scope narrowing, spend caps, TTL, intent, and cascade revoke are constitutional, not optional.

**Law 5: Trust is time-bound and decay-aware.**  
[soma-future-proofing.md] emphasizes temporal scale and long-horizon identity. [soma-trust-salvage-from-aid.md] says “Trust is a gravity well.” Scores, credentials, receipts, and proofs all need freshness bounds.

**Law 6: Trust must be costly to fake.**  
[soma-trust-mining.md] says trust enters through “verified bilateral economic behavior.” [trust-system-hacker-audit-2026-04-09.md] attacks current dimensions precisely because cheap actions can farm trust. The law exists even where implementation lags.

**Law 7: Crypto agility is non-negotiable.**  
[soma-future-proofing.md]: “Crypto-agility: Non-negotiable.” [credential-rotation-architecture.md] extends this into algorithm-suite tags, PQ migration, composite signatures, and downgrade rejection.

**Law 8: Death must be final unless explicitly succeeded.**  
[soma-computation-witness.md] defines a Death Certificate leaf that “seals the tree.” [soma-security-audit-2026-04-09.md] flags “Dead Agent Trees Accept New Leaves” as critical because it violates this law.

**4. What Is Unique To Soma**

Soma’s uniqueness is not did:key. It is the composition.

A competitor would need to independently invent:

- **Heart/Sense separation as a trust epistemology**, not just a runtime architecture.
- **A universal lifecycle tree** where action, economy, proof, wallet derivation, custody, delegation, and death share one root. [soma-computation-witness.md] says this explicitly: “All event types, one root, one proof.”
- **Proof-as-computation.** The idea that Heart is “metabolism, not observer” is Soma’s deepest primitive.
- **Trust as bilateral evidence, not unilateral logs.** [soma-trust-mining.md] calls this “double-entry bookkeeping for trust.”
- **Delegation with spend caps, branch caps, cascade revoke, and intent as first-class protocol fields.** [soma-delegation-spec.md] calls this the first standard with “spend-bounded delegation + cascade revoke + intent declaration.”
- **Agent death and succession as protocol events.** Most systems revoke keys. Soma models mortality.
- **Custody as pulse evidence.** [soma-custody.md] proves data acceptance, access, and crypto-shredding as lifecycle leaves.
- **Trust aggregation as a replayable evidence market.** [soma-1-2-scope.md] and [trust-mining-economy.md] move beyond “score API” toward mined, folded, freshness-bound trust blocks.

Soma is not another identity system because identity is only one axis. It is trying to be the accountability substrate for autonomous computation.

**5. Contradictions**

The corpus has real conflicts.

**Delegation depth conflict.**  
[soma-delegation-spec.md] enforces `max_depth`. [soma-future-proofing.md] later says “No hard depth limit” because future agent topologies may be deeper than expected. This needs resolution: protocol-level hard caps vs implementation-level soft limits.

**Nova is claimed live but elsewhere missing.**  
[soma-computation-witness.md] says “Ship Nova folding from day one.” [soma-trust-mining.md] says “Nova IVC (live), Groth16 (live).” But [soma-security-audit-2026-04-09.md] says “Nova IVC Does Not Exist.” This is the biggest credibility contradiction.

**ClawNet implementation claims are stale.**  
[soma-readiness-strategy.md] says multiple layers are shipped or partially live. [trust-network-foundation-reconciliation.md] says named files like `src/routes/soma.ts`, `src/core/soma-receipt.ts`, `src/core/dual-sign.ts`, and `src/routes/soma-check.ts` were not found on current `main`. The docs overclaim relative to source reality.

**Soma Check revenue model reversed.**  
[archive/soma-check-billing.md] says 90/10 or 95/5. Its archive header says provider now gets 100% and ClawNet gets $0 from routing. Any doc still relying on Soma Check routing revenue is stale.

**Identity tiers vs composite identity.**  
[identity-verification-tiers.md] still presents biometric as multiplier 1.0 and calls it “ultimate Sybil defense.” [composite-identity-scoring.md] supersedes that: biometric alone is only 0.35 signal. The old rhetoric is stronger than the later model permits.

**Heart as metabolism vs Heart as signer.**  
[soma-computation-witness.md] says all work flows through Heart. [soma-security-audit-2026-04-09.md] says ClawNet calls upstream providers directly and then signs: “Heart is a signing module, not a compute runtime.” This is a philosophical and implementation gap.

**Conservation of trust vs current trust dimensions.**  
[soma-trust-mining.md] says trust enters through verified bilateral economic behavior. [trust-system-hacker-audit-2026-04-09.md] shows 5 of 6 dimensions create trust from cheap or free behavior. The doctrine is ahead of the implementation.

**6. Soma And Everything Else**

**Cortex / agent runtime layer.**  
No dedicated Cortex doc appears in this corpus, but by inference Cortex-like orchestration depends on Soma for identity, delegation, receipts, and execution accountability. Without Soma, orchestration becomes ordinary API routing: useful but unverifiable.

**VeraAI / HeyVera.**  
Soma is the trust substrate under HeyVera’s agents. If VeraAI acts for users, Soma answers: who authorized the agent, what scope did it have, did it act inside that scope, what evidence exists, and should future authority be reduced? Without Soma, VeraAI becomes an LLM product with conventional logs and broad secrets.

**x402.**  
Soma wraps x402 with trust semantics. [soma-check-header-spec.md] makes conditional payment freshness compatible with HTTP and x402 rails. [soma-delegation-spec.md] adds spend-bounded agent delegation to x402-like payment flows. Without Soma, x402 moves money but does not prove the payer’s delegated intent, freshness, or trustworthiness.

**Marketplace.**  
The marketplace depends on Soma for discovery ranking, trust scores, provider verification, delegation safety, receipts, and dispute evidence. [soma-horizon.md] describes labor markets, credit ratings, and discovery protocols all built on Soma primitives. Without Soma, marketplace ranking collapses to claims, reviews, and payment history.

**ClawNet.**  
ClawNet is the runtime/platform consumer. It enforces policy, routes calls, handles billing, and can be the first implementation. But [trust-network-foundation-reconciliation.md] is clear: ClawNet owns runtime truth, Soma owns protocol truth. Without Soma, ClawNet is still a billing/orchestration platform, but loses the “verified trust network” thesis.

**Pulse.**  
Pulse should consume Soma/ClawNet trust, not define protocol truth. The reconciliation doc explicitly says “Do not do Pulse work here.” Without Soma, Pulse has to invent its own trust model or rely on ordinary app auth.

**7. What Is Missing**

The missing definitive answer is:

**Is Soma primarily a runtime, a protocol, an evidence format, or a market?**

The documents point in all four directions.

- Runtime: [soma-computation-witness.md] says Heart is the metabolic core.
- Protocol: [soma-future-proofing.md] says architecture-independent identity layer.
- Evidence format: [soma-1-2-scope.md] reframes Soma as aggregator over ERC-8004 signals.
- Market: [trust-mining-economy.md] says buyers commission mining sessions and public trust blocks.

A definitive Soma vision document needs to resolve that hierarchy.

I would need four decisions to write it:

1. **What is the minimum Soma object?** A Heart? A pulse root? A receipt? A DID? A runtime-wrapped computation?
2. **What is mandatory vs optional?** Are Nova proofs, bilateral commitment, Sense observers, and outcome logs required for “Soma-compliant,” or are they tiers?
3. **Where does protocol truth live?** The docs say Soma owns protocol truth, but many concrete specs live in ClawNet `internal/`. The canonical public spec boundary needs to be named.
4. **What is the first non-negotiable product promise?** “Agents can safely delegate spend”? “Every action has evidence”? “Trust scores are replayable”? “Human-rooted agent authority”? Soma cannot lead with all of them at once.

My synthesis: Soma’s soul is **sovereign, witnessed accountability for autonomous computation**. Its danger is overclaiming ahead of implementation. Its promise is enormous precisely because it refuses to treat identity as a login problem. It treats identity as a life lived under evidence.
