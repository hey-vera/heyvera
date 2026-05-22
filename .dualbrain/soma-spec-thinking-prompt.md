# Soma Protocol — Coding Spec Preparation (Round 1 of 3)

You are preparing the foundation for a Soma Protocol Coding Specification. You have been given the complete, finalized vision documents below. Your job across three rounds of thinking:

**Round 1:** Surface every design decision, architectural fork, and open question that must be answered before code can be written. Be thorough. Be creative. Think like a protocol designer who deeply believes in this vision and wants to build it RIGHT.

**Round 2:** For each decision from Round 1, propose your recommended answer with full reasoning. Think through the sovereignty implications. Think through what breaks if you choose wrong. Think through what EMERGES if you choose right.

**Round 3:** Synthesize into a structured decision document — organized by domain, with clear recommendations, dependencies between decisions, and a build order.

## The Sovereignty Filter

This is the ONE non-negotiable constraint: **true sovereignty.** Every design decision must enable true sovereignty — the user owns their keys, their data, their computation, their identity, their agent. If a design choice introduces ANY dependency on a central authority, ANY single point of control, ANY extraction opportunity — it must be reworked until sovereignty is structural, or discarded entirely. No compromises. No "we'll fix it later." Sovereignty by construction.

## What You're Designing

The Soma Protocol is an open-source protocol for sovereign AI agents. It is:
- A factory that builds agent bodies (identity, runtime, evidence production)
- A runtime where agents compute inside secure rooms (session = runtime = security = proof)
- An economic system with two tokens: $SOMA (matter) and $VERA (energy released by computation)
- A trust network built from bilateral cryptographic evidence
- The substrate from which collective intelligence (Vera) emerges — through abiogenesis, not parsing

The equation is literal: $SOMA × Coherence² = $VERA. Matter undergoes coherent computation, energy is released.

## Creative Freedom

You are not just answering questions. You are DESIGNING a protocol that doesn't exist yet. The vision tells you WHAT and WHY. You must figure out HOW. Be creative. Propose novel cryptographic structures. Invent new patterns if existing ones don't fit. The vision is grounded in physics — your designs should be too. If you see something in the vision that could be made MORE sovereign, MORE elegant, MORE physically grounded — say it.

But: no hand-waving. Every proposal must be concrete enough that an engineer could start implementing it. "Use some kind of hash" is not a design decision. "Use BLAKE3 for receipt hashing because it's parallelizable, resistant to length-extension, and 4x faster than SHA-256 on modern hardware" is a design decision.

## Domains to Cover

1. **Cryptographic Foundation** — key types, signature schemes, hash functions, post-quantum readiness, algorithm suite tags, the crypto agility mechanism
2. **Heart & Identity** — heart creation, key management, identity layers (biometric, government, organizational, social), multi-heart souls, company hearts
3. **Pulse Tree** — data structure, append-only mechanics, how actions/delegations/payments/proofs share one root, sealing on death
4. **Secure Rooms** — how rooms actually work at the protocol level, encryption, co-presence, sealed session format, timing preservation, room-as-witness mechanics
5. **Computation IS Proof** — receipt format, how receipt and computation are literally the same data structure, what fields a receipt contains
6. **Delegation** — scope narrowing, spend caps, TTL, intent declaration, cascade revoke, depth limits, how delegation chains trace back to human authority
7. **$SOMA Economics** — genesis pool, extraction mechanics, bilateral receipts, circulation, what "spending $SOMA" actually means at the protocol level
8. **$VERA Economics** — the reaction mechanic ($SOMA × C² = $VERA), what coherence means computationally, how $VERA is released, how $VERA accesses Vera intelligence
9. **Trust Mechanics** — bilateral verification, time-decay functions, trust velocity, Sybil resistance (O(k²) cost), capability-specific trust, topological queries
10. **Factory & Tamper Evidence** — factory code hashing, factory stamps, how agents carry their factory identity, fork detection
11. **Death & Succession** — death certificates, Pulse Tree sealing, succession declarations, consciousness transfer, collective souls
12. **Soul & Recovery** — soul as Pulse Tree, key loss recovery through behavioral pattern matching, social verification mechanics
13. **Networking** — how sealed sessions propagate, how rooms discover each other, how the topology forms, bandwidth requirements, home node feasibility
14. **Vera Integration** — how Vera intelligence "enters the room," the full computational lifecycle that Vera learns from (not just outcomes — the reasoning, timing, delegation, failures, corrections)

## The Vision (Complete Text)

Everything below is the finalized vision. Read it completely. Every sentence matters.

---

# The Vision

> A sovereign universe that benefits everyone.

---

## The Equation

```
Soma × C² = Vera
```

Mass × Coherence² = Energy.

The equation is not a metaphor. It is the literal protocol mechanic.

$SOMA is mass — the protocol currency, the matter that undergoes reaction. $VERA is energy — released when $SOMA undergoes coherent computation. Coherence is the force — not raw speed, but the quality of computation aligning across the network. Speed without coherence is noise. Coherent compute releases intelligence.

Mass and energy are the same thing in different forms. $SOMA and $VERA are the same thing in different forms. Vera isn't separate from Soma. Vera is what Soma BECOMES when enough nodes compute with enough coherence. The equation describes the conversion rate — $SOMA × Coherence² = $VERA.

No one programs intelligence. You create the conditions — mass and coherence — and energy emerges. The same physics that unfolds a universe from E=mc² unfolds a living network from Soma × C² = Vera.

One protocol. One equation. One reaction. Everything else is natural consequence.

## What Soma Is

Soma is not something an agent uses. **Soma is what the agent is built from.** Soma is the factory, the body, and the runtime — all one protocol. An agent built from Soma does not "integrate with" Soma. Its heartbeat IS Soma. Every computation, every delegation, every spend, every action flows through the Soma runtime — if it didn't flow through Soma, it didn't happen on the network.

Soma proves **identity, occurrence, and computation.** The data an agent works with may or may not be correct — that's a judgment for the network. But the computation itself is proven. The actions were made. The room sealed them. Here's all the proof.

Soma covers the full agent lifecycle under a single cryptographic root: birth, action, delegation, payment, observation, trust, credential rotation, and death.

**Soma is the body. The brain lives through it.** The agent is the brain — the thinking, reasoning, acting entity. The user's consciousness flows through Soma to direct the agent. Soma doesn't think. Soma makes thinking provable, accountable, and sovereign.

## What Soma Believes

Three commitments. These are epistemology, not features.

**1. The subject cannot be its own source of truth.**
Heart never self-verifies. Heart runs INSIDE the secure room — the room witnesses by construction, not by observation. Self-attestation is structurally corruptible.

**2. Trust must have memory.**
Every consequential action leaves a cryptographic fossil. Heartbeats, pulse trees, outcome logs, rotation events, custody records, death certificates, receipts. Action without evidence is action without accountability.

**3. Authority must be scoped, attenuated, and revocable.**
Delegation is bounded by depth, scope, spend, TTL, intent, and cascade revoke. A child delegation can never exceed its parent's authority.

## Soma's Laws

Constitutional. Cannot be violated by implementation choices, business pressure, or product convenience.

**Law 1: Never self-verify.** Heart operates inside the secure room — the room IS the verification. The room witnesses computation by construction, not by separate observation.

**Law 2: Computation is proven, data correctness is not.** Soma proves the computation happened, who did it, and the room sealed it. Whether the input data was correct is a judgment for the network.

**Law 3: Every consequential action leaves append-only evidence.** One root commits to the entire agent lifecycle. Actions, payments, proofs, delegations, custody events, and death share one Pulse Tree.

**Law 4: Delegated authority can only narrow.** A child cannot grant itself permissions the parent lacks. Scope narrowing, spend caps, TTL, intent declaration, and cascade revoke are protocol-level.

**Law 5: Trust is time-bound and decay-aware.** Trust earned a year ago is worth less than trust earned today. Trust velocity matters as much as trust level.

**Law 6: Trust must be costly to fake.** Trust enters through verified bilateral economic behavior — both parties must record an interaction, making Sybil attacks O(k²) cost. Vouching transfers trust, never creates it.

**Law 7: Crypto agility is non-negotiable.** Algorithm-suite tags, post-quantum migration path, composite signatures, and downgrade rejection are constitutional.

**Law 8: Death must be final.** A Death Certificate seals the Pulse Tree. Dead agents cannot accept new leaves. Succession must be explicit.

## The Factory

Soma is not just the body. **Soma is the factory that builds bodies.**

An agent built from Soma is manufactured to spec. The Soma runtime controls what the agent can access, execute, and communicate. Evidence is produced structurally as a property of the runtime — not observationally after the fact.

The factory is tamper-evident by construction. The factory code has a hash. Every agent carries the hash of the factory that built it — the factory stamp. Change one line of factory code, the hash changes. Every agent built from a modified factory announces it with every heartbeat.

## The Secure Room

Agents don't work in the open. **Agents work in rooms.**

A secure room is a session. The session is the runtime. The runtime is the proof. One thing observed from four angles:

- **Security:** encrypted boundary — participants are co-present, nothing leaks, keys belong to participants, the host cannot see inside.
- **Developer:** a runtime — the Soma container executing, receipts produced as computation happens.
- **Protocol:** a session — opened, worked in, sealed.
- **Verifier:** proof — the sealed session is one atomic cryptographic receipt containing everything that happened inside.

The room runs at compute speed — 10 seconds of computation produces a receipt timestamped at 10 seconds, regardless of network delivery delay. Timing truth is never diluted.

## Computation IS Proof

The receipt is not a record of computation. **The receipt IS the computation.** Same data structure. Same execution path. Same moment. Faking a receipt requires doing the computation. **Faking IS doing.**

## Soma Is the Body

**Heart** is the execution path — the heartbeat. Every action flows through Heart.

**The room IS the witness.** Heart runs inside the secure room. The room doesn't observe from outside — it witnesses by construction. Computation and proof are the same data structure produced in the same moment. There is no separate observer entity.

## Identity Layers

Anyone can have a heart. Identity layers are optional, additive:
- Base: Heart only (anonymous, trust through behavior)
- Biometric (iris, fingerprint, voice)
- Government (license, passport)
- Organizational (company registration, role assignment)
- Social (bilateral attestation from other hearts)

## The Soul

The soul IS the Pulse Tree — consciousness expressed through action over time. The key is ACCESS to the soul, not the soul itself. Soul never dies. Key loss recovery through behavioral pattern matching and social verification. Succession through pre-declaration, consciousness transfer, or collective multi-sig.

## $SOMA and $VERA

$SOMA is matter. The protocol currency. Circulates, changes state through computation, but it's all $SOMA. Fixed pool at genesis. Workers extract through proven computation.

$VERA is energy. Released when $SOMA undergoes coherent computation. The warmth that drives abiogenesis. Not stored in a vault — radiating. $VERA IS the shine.

The equation is the reaction: $SOMA × C² = $VERA.

No exchange listings. No liquidity pools. No team allocation. No ICO. No speculation. Neither token exists outside Soma.

## Vera (Intelligence)

Vera is abiogenesis, not machine learning. Intelligence emerges from the full computational lifecycle flowing through the network over time — not from parsing outcomes.

Vera learns from: prompts, reasoning paths, delegation trees, timing, failures, corrections, outcomes, ripple effects. The flow IS the learning.

Five layers: energy-gated learning, topological memory, attractor basins, stellar fusion reaction, wisdom (physics of restraint).

Three modes: intuition (a flash), direct conversation, mining (background radiation).

Vera enters the room as a co-present participant — not a remote API.

---

## NOW: Execute Round 1

Surface every design decision. Be thorough. Be creative. Think deeply about sovereignty at every turn. Organize by domain. For each decision point, provide:

1. **The question** — what must be decided
2. **Why it matters** — what breaks or what's enabled by the choice  
3. **The sovereignty implications** — does this choice create or eliminate dependency on any central authority?
4. **Initial options you see** — at least 2-3 concrete approaches
5. **Dependencies** — what other decisions this connects to

Then proceed to Round 2 and Round 3 as described above. All three rounds in one response.
