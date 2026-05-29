# Soma CredentialRotationController — Vision & Tech Audit

**Status:** brainstorm, not committed roadmap. Captured 2026-04-11.
**Supersedes:** nothing. Companion to `credential-rotation-architecture.md`.
**Audience:** future me, Joshua, anyone inheriting Soma.

This document captures the long-range vision for the rotation primitive
shipped in `soma-heart@0.2.0`, the deeper ideas that could take it from
novel to groundbreaking, and an honest audit of what's already
bulletproof, what needs adopting, and what needs genuinely new work to
make the substrate 10/10 production and future-proof.

---

## 1. What the primitive actually is

A state machine that enforces a small set of invariants over the
lifecycle of a signing key. An identity owns a chain of events —
inception, rotation, delegation, revocation. Each event has to be
signed by the previous key AND by the next key, anchored externally to
a pulse root, witnessed by a party who isn't the signer, and only
becomes "effective" after both the anchor and the witness land. Keys
are short-lived by default. The next key is always pre-committed one
step ahead (KERI-style pre-rotation), so an attacker who steals the
current key cannot redirect the chain to a key they control — they can
only burn the key for whatever's left of its TTL.

The architecturally interesting part is not any single property. KERI
has most of them individually. What's new is packaging them behind a
nine-method `CredentialBackend` interface with pluggable storage, so
any existing surface can adopt the primitive without committing to a
new identifier format, a new wire protocol, or a new PKI. Backend
implements storage; controller implements the invariants; consumer
sees "ed25519 key, rotated safely." This is why ClawNet can slip it
under `cn-...` keys without customers ever noticing a change.

## 2. Near-term value (enabled today, no further invention)

**Compromise window = TTL, not "until someone notices."** Ten-minute
rotation means a VPS disk snapshot gives an attacker ten minutes of
access, not months. Rotation becomes cheaper than exploitation;
classes of attack become economically unviable.

**Point-in-time authority proofs.** "Was credential X effective at
timestamp T?" becomes cryptographically answerable by walking the
chain. Compliance teams will pay real money for this.

**Trust-minimized agent-to-agent handoff.** Issue a ten-minute
credential with a manifest pointing back to your chain; the receiver
verifies against a pulse root they already trust; when it expires
it's dead whether you revoke or not. The "did they remember to
revoke" class of incident disappears.

**Continuous identity over time.** Inception event hash is the
permanent identifier. An agent running for six months has the same
provable identity it had on day one.

## 3. Deeper ideas — ranked by groundbreaking potential

### A. The chain as universal audit-AND-billing spine

Push the chain beyond rotation events. The same dual-sig /
anchored / witnessed structure could carry any agent event: actions
taken, payments made, data accessed, decisions committed. The
cryptographic guarantees are identical.

Connects directly to the 2026-04-10 fee-model pivot to
"heart-as-billing-spine." Chain becomes simultaneously the security
log and the billing log. Providers bill against it, customers dispute
against it, auditors verify against it. One primitive, one source of
truth.

**Why this wins:** compounds two systems you already need into one
primitive you already own. Competitors split audit and billing at
scale and can't unwind; you never did.

### B. Cross-hoster witnessing as decentralized trust without a blockchain

Pulse roots are internal today. But nothing stops two hosters from
cross-referencing each other's pulse roots — ClawNet's pulse root
periodically including Stripe's latest pulse root hash and vice versa,
as a gossip protocol. Events under ClawNet's chain are then implicitly
witnessed by Stripe; tampering is detectable by any peer. Push to N
hosters in a mesh and you have byzantine-fault-tolerant identity
without a blockchain. No gas, no consensus overhead, no L1 dependency.

**Why this wins:** DIDs assume blockchains or static registries.
KERI has witnesses but no mesh. Certificate Transparency has
independent logs but no peer witnessing. A soma-heart gossip layer
would be the first practical decentralized agent PKI. Publishable-
paper novel. Also the biggest execution risk — months of work.

### C. Attenuated rotation for agent swarms

Every delegation event carries a scope; scopes can only shrink from
parent to child. A root agent spawns 1000 sub-agents, each narrower
than its parent, each able to spawn further-narrowed descendants.
Revoking any subtree is one event at the root of that subtree.
Macaroons/biscuits did this for tokens; applying it to a key
management primitive is new. Ties directly into existing Soma
Delegation work.

**Why this wins:** highest near-term utility. Probably the first
extension after ClawNet cutover.

### D. Periodic pulse-root commits to L2 as settlement layer

One cheap transaction per hoster per hour posts the current pulse
root hash to Base. That single tx gives every event anchored under
that pulse root ethereum-grade finality at ~$0.01/hour amortized. The
soma-heart is the aggregator; L1 is the settlement layer. ZK-rollup
pattern applied to identity events instead of financial state.

**Why this wins:** cheapest to ship with highest symbolic credibility.
Perfect for compliance docs — "pulse roots settle on Base, here's the
contract address." EAS on Base is already a claw-net dependency.

### E. Threshold credentials (Tier 2)

3-of-5 keys must co-sign to rotate. Keys distributed across devices
you already own: laptop, phone, hardware token, co-founder, cloud
KMS. Losing one doesn't compromise you; losing one doesn't lock you
out. Multi-sig wallets do this today in a walled-garden way; baking
it into the rotation controller makes it available to any consumer
for free.

**Why this matters:** table stakes for high-assurance users. Not
differentiating alone, but raises the ceiling on who can adopt.

## 4. The groundbreaking reframe

Step all the way back. X.509 PKI is a substrate where identities bind
to keys, keys get issued and revoked, trust roots exist, cross-signing
chains trust between roots, and everything speaks a common format.
Invented in the 80s for servers and humans. Forty years later every
autonomous agent on earth is about to need identity infrastructure
and nobody has built the PKI for them. AID tried, DID methods tried,
KERI tried. None got traction — too heavy, too blockchain-specific,
or too committee-driven.

**The reframe: CredentialRotationController is not a key management
library. It is the kernel of a post-X.509 agent-native PKI.**

- Unit of identity: Merkle-chained event stream, not a certificate
- Freshness: TTL, not CRL lists
- Trust roots: pulse witnesses, not CAs
- Delegation: scope-attenuated by construction
- Backends: pluggable, so existing infrastructure adopts without rewriting
- No single-root-of-trust failure mode (cross-hoster mesh, idea B)

If that's the product, the roadmap reshuffles:

1. ClawNet cutover — proof the primitive survives a real billing surface
2. HeyDATA / Nova — first external proofs of portability
3. Audit+billing spine (A) — defensible moat
4. L2 anchoring (D) — credibility lever
5. Attenuated delegation (C) — agent-swarm primitive
6. Cross-hoster mesh (B) — long-term science prize

This is a reframing, not a new product. Soma becomes "the PKI substrate
every agent platform eventually adopts." Whether it happens depends on
execution and adoption, but the primitive is already strong enough to
make the bet.

---

## 5. Tech audit — bulletproof, adopt, invent

The brainstorm is not the hard part. Making it 10/10 bulletproof and
future-proof requires an honest inventory of what's solid, what we
need to wire in from existing battle-tested tech, and what's
genuinely new work.

### 5.1 Bulletproof today (what we already have)

- ed25519 signing via `@noble/ed25519` / tweetnacl fallback
- SHA-256 hashing
- KERI-style pre-rotation (invariants L1/L2)
- Dual-sig on every rotation event (old key + new key PoP)
- Pulse root anchoring (internal, single-hoster)
- Twelve invariants enforced by controller
- Stage/commit/abort transactional rotation
- One-rotation-in-flight enforcement (tip must be effective before next)

These cover the baseline. They are not enough for 10/10 long-term.

### 5.2 Needs adopting — exists in the wild, wire it in

**Post-quantum signatures (ML-DSA / Dilithium).**
ed25519 is broken by a sufficiently large quantum computer. `@noble/
post-quantum` is already a claw-net dependency. The move: hybrid
signatures — every rotation event signed by BOTH an ed25519 key AND
an ML-DSA key. A break in either alone does not compromise the chain.
This is table stakes for 2030+ bulletproof. Hybrid now, pure-PQ
after migration.

**BLAKE3 hashing (performance-path only).**
SHA-256 stays canonical. BLAKE3 as optional fast-path for chains with
hot write volume. Buys ~10x throughput on modern CPUs with AVX-512
without weakening guarantees.

**Merkle Mountain Ranges (MMR).**
Append-only tree structure with O(log n) inclusion proofs and
efficient batching. Certificate Transparency uses a variant. Replaces
naïve event-list storage with a structure that gives cheap inclusion
proofs for any historical event without rehashing the whole chain.

**Certificate Transparency log math (RFC 6962).**
Inclusion proofs, consistency proofs, audit path verification. Two
decades of battle-testing under adversarial conditions. Our pulse
root IS a CT-style log with extra invariants. Adopting CT's proof
formats gives us proven math instead of reinventing.

**libp2p gossipsub (cross-hoster mesh transport).**
Already a claw-net dependency. This is the transport layer for
Idea B — hosters exchange pulse root hashes over gossipsub topics.
The protocol on top is novel (see §5.3); the transport is proven.

**EAS on Base (L2 anchoring).**
Already a claw-net dependency. One periodic EAS attestation per hour
posts the pulse root hash as an on-chain fact. Cheap, public,
verifiable.

**FROST (Flexible Round-Optimized Schnorr Threshold signing).**
For Tier 2 threshold identities. ed25519-compatible, open-source
implementations exist (`frost-ed25519`). Drops into the primitive as
a new `CredentialBackend` variant without touching the controller.

**SD-JWT (IETF Selective Disclosure JWT).**
Selective disclosure — prove specific properties of a credential
without revealing the full credential. IETF-standardized,
implementations proliferating. BBS+ is the mathematically prettier
alternative but less mature. SD-JWT is the pragmatic pick.

**drand randomness beacon.**
Public verifiable randomness. For fair witness selection and pulse
root ordering — replaces the "hoster picks witnesses" footgun.
Already running in production across multiple orgs.

**W3C VC Data Model 2.0 binding.**
Serialize rotation credentials as Verifiable Credentials so the
existing DID/VC ecosystem can consume them without reinventing.
Interop, not replacement.

### 5.3 Needs inventing — genuinely new work required

These are the research-flavored items. None of them are weekend
projects; each is a design doc + spec + prototype + review cycle.

**Cross-hoster pulse-root gossip protocol.**
The transport exists (libp2p gossipsub). The protocol for how two
hosters cross-reference each other's pulse roots, detect divergence,
and converge without a full consensus algorithm is new. KERI has
witnesses but no mesh. CT has independent logs but no peer
witnessing. Open questions: split-brain handling, witness eviction
rules, what "witnessed by peer H" means cryptographically, how a
consumer weights multi-witness attestations. This is the biggest
prize and the biggest research risk.

**Billing-as-chain-event schema.**
How do you serialize a billing event into a rotation chain such that
dispute resolution can walk the chain and return an authoritative
answer? Needs a canonical schema, ordering rules, a settlement
finality model, and a dispute protocol. Ties directly into
heart-billing-spine work. Without this, Idea A stays aspirational.

**Attenuated scope algebra.**
Formal rules for how a delegated scope shrinks from parent to child.
Macaroons use first-party caveats (string matching). Biscuits use
datalog (expressive but heavy). Neither maps cleanly to rotation
chains. Needs a minimal scope language, composition rules, a
verifier, and test vectors.

**Portable chain export format.**
An agent leaving one hoster for another needs to export its full
chain in a hoster-agnostic format and have the receiving hoster
adopt it as the continuation. Requires a spec — think "KERI-lite
serialization" — including pulse root pointers and witness
attestations from the old hoster. Without this, Soma consumers are
locked in, which kills the PKI-substrate framing.

**Post-compromise forward secrecy for long-lived identities.**
Signal has it for two-party sessions via double ratchet. Rotation
controllers need the analog: after rotation N, a full state
compromise at N cannot recover secrets from rotation N-1. ed25519
doesn't naturally give this. Requires a ratchet construction layered
on top. Academic work exists (KEM ratchets); practical deployment
in an identity context is new.

**Hoster trust bootstrap.**
How does a new consumer decide which hoster to trust initially?
Today the answer is "out-of-band." Better: a small registry
anchored in L1, or a badge system based on hoster operational
history. This is open design space and politically loaded — whoever
controls the bootstrap registry has outsized influence.

**Revocation privacy via cryptographic accumulators.**
Proving "this credential is not revoked" without the verifier
learning anything about other credentials. RSA accumulators and
pairing-based accumulators exist academically; production-grade
implementations are thin. May require bespoke work for efficiency.

### 5.4 Research-adjacent bets — pick one if the core ships

These are wild ideas. Not roadmap items. Listed so we can evaluate
them when the core is stable and we have slack.

- **Verifiable delay functions (VDFs) for pulse-root ordering.** Force
  a minimum real-time delay between pulse roots so hosters cannot
  retroactively reorder events. drand + VDF.
- **Timelock encryption.** Credentials usable only after timestamp T,
  enforced cryptographically. Enables scheduled agents without a
  trusted scheduler.
- **Ring signatures over credential groups.** Prove "some credential
  in this set signed this" without revealing which. Enables
  anonymous agent participation in collective actions.
- **Witness encryption.** Encrypt a payload that can only be
  decrypted by whoever holds a credential satisfying a predicate.
  New delegation semantics. Long shot.
- **FHE over chains.** Run queries over an encrypted chain without
  revealing events. Compliance nirvana, ~10 years out.

---

## 6. Hardening checklist for 10/10 production (near-term)

Separately from the long-range science, these are the operational
items that have to be solid for the primitive to be trusted with
real customer credentials.

- Secret key zeroisation: audit every code path that holds a secret
  key in memory. Confirm fill(0) on finally, confirm no copies.
- Backup material classification: document that any DB backup is
  credential material. Define encryption-at-rest for the
  `api_key_rotation_*` tables. Ties into P0.2 secret-vault work.
- Clock skew handling: define behavior when hoster clock drifts
  beyond TTL tolerance. Refuse? Log and proceed? Panic freeze?
- Replay protection on witness events: ensure witnesses cannot be
  replayed to make a past event "re-effective."
- Panic freeze operational playbook: who has the freeze key, how
  it's triggered, how unfreeze works, how consumers are notified.
- Crypto provider formalization: document which primitives are
  FIPS-reviewed vs. research-grade. Pin provider versions.
- Side-channel review: timing attacks on verify, memory-dump
  attacks on secret key handling, speculative-execution concerns.
- Algorithm agility: how is a new suite introduced without chain
  rupture? Needs a "suite rotation" event type in the chain itself.
- Multi-region hoster deploy: single-VPS single-SQLite is a
  pragmatic start, not a 10/10 endpoint. Plan for multi-region
  replication with strong consistency for the events table.
- Hoster bankruptcy plan: if the hoster disappears, how does an
  agent continue? Answered by §5.3 portable chain export format.

## 7. Known risks & uncertainties

- Cross-hoster witnessing (Idea B) is a research project, not a
  sprint. Biggest prize, biggest risk. Do not commit a ship date.
- Audit-and-billing unification (Idea A) raises the stakes of every
  bug. A corrupted event becomes simultaneously a security incident
  and a billing dispute. Need the operational story before
  customers rely on it.
- The post-X.509 PKI reframe is a positioning bet. If the agent
  world adopts some other substrate first, this framing becomes "a
  thing that almost was." The primitive stays valuable either way.
- Post-quantum migration has a window. Hybrid now buys time, pure-PQ
  migration needs to happen before quantum becomes practical.
  Watching NIST + academic timelines.

## 8. Open questions for future-me

- Is the pulse root a single Merkle root per hoster, or one per
  identity? The §5 assumption is "one per hoster, aggregating many
  identities" but that's not fixed yet.
- Does the chain format version-bump as the suite evolves, or does
  each event carry its own suite tag? The latter is more flexible
  but complicates verifiers.
- Should witness attestations live on the chain, or in a sidecar
  structure? On-chain is simpler; sidecar is more flexible.
- Who pays for the cross-hoster witnessing mesh in Idea B? Hosters
  witness each other for free, or there's a micropayment per witness
  event? (This reconnects to the billing spine.)
- How does identity recovery work if a user loses ALL their devices?
  Tier 2 threshold mitigates but doesn't eliminate. Need a social-
  recovery or escrow path — opens governance questions.

---

## 9. What this document is NOT

- Not a commitment. Ideas A-E are ranked potential, not a roadmap.
- Not a spec. Items in §5.3 each need their own design doc before
  implementation.
- Not a pitch deck. Written for internal clarity, not external sell.
- Not a replacement for `credential-rotation-architecture.md` — that
  file is the operational architecture; this file is the long-range
  vision.
