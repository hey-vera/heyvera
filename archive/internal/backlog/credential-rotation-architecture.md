# Credential Rotation Architecture — battle-test & design

Status: **backlog / architecture** — pending review and ratification before code lands.
Opened: 2026-04-10
Supersedes (partially): `wallet-rotation-architecture.md` — wallet rotation is now one backend of a generic primitive, not a standalone feature.
Related: `wallet-rotation-architecture.md`, `soma-1-2-scope.md`, `secret-scanner.md`, `exit-and-opt-out.md`, Soma `src/heart/key-rotation.ts`.

---

## Why this document exists

During the 2026-04-10 session we committed to building wallet key rotation as a Soma primitive. Then we realized that (a) rotating a single type of credential is a waste of the mechanism — we have at least three credential types that all need the same hardening (heart identity key, EVM settlement key, ClawNet API keys) — and (b) ClawNet's own API keys are the most urgent surface and also the easiest to dogfood.

The result: lift the design up one level of abstraction. Build a generic `CredentialRotationController` in Soma with pluggable backends. Wallet rotation becomes one backend, ClawNet API key rotation becomes another. Any future heart operator plugs in their own backend for their own credential types (webhook secrets, OAuth client secrets, DB passwords, LLM API keys) and gets the same 10/10 guarantees.

Before writing a line of that code, we battle-test the idea. Every question the user asked in the ratification turn gets a deliberate answer, grounded in prior art where it exists, and called out as an open problem where it does not.

**Threat model.** We assume the attacker reads every line of Soma and ClawNet source (open source). We assume they can steal a single live session credential via memory scrape or leak. We assume they can steal backups containing serialized state. We assume they can MITM unauthenticated network traffic. We assume they can publish malicious npm packages and trick a developer into installing them. We assume they can compromise one of N threshold shard holders. We assume a TEE or HSM, if configured, is not compromised. We assume the quantum attacker arrives between 2030 and 2035; therefore any credential issued today must survive "harvest now, decrypt later" in that window.

10/10 in this document means "no known viable attack inside this threat model, and every tradeoff is explicit enough that a heart operator can decide if it applies to them."

---

## 1. Is the idea future-proof?

**Short answer: yes if we get three things right from the start, no if we skip any of them.**

The three things are: algorithm agility, protocol versioning, and anchoring diversity.

### 1a. Algorithm agility

Every credential in the rotation log has an explicit `algorithm` tag. The current primitives all default to Ed25519 (for signing) and secp256k1 (for EVM). Both become broken under a cryptanalytically relevant quantum computer. The NIST PQC standardization process has landed ML-DSA (formerly Dilithium) as the signature replacement, and the IETF LAMPS working group has `draft-ietf-lamps-pq-composite-sigs` in near-final state.

The composite pattern is: concatenate a PQ signature with a traditional signature so that a credential is valid only if **both** verify. Breaking either one alone does not forge the credential. SSH is already using `ssh-mldsa65-ed25519` in production. Akamai is deploying hybrid ML-KEM + X25519 as the default for browser connections in February 2026.

Our controller's `CredentialBackend` interface MUST:

1. Carry an explicit `algorithmSuite` field on every credential: `ed25519`, `secp256k1`, `ed25519+ml-dsa-65`, `secp256k1+ml-dsa-65`, etc.
2. Refuse to verify a credential whose suite is not in its current allowlist. Downgrade attacks to weaker suites are rejected at the verification layer, not left to operator policy.
3. Support rotation *across* suites: a credential issued as `ed25519` can be rotated to `ed25519+ml-dsa-65` in a single rotation event, which is how we migrate the whole system forward when PQ becomes mandatory. The rotation event itself is signed under the old suite (because that is what the parent has), and commits to a public key in the new suite. KERI-style pre-rotation makes this natural.
4. Publish the algorithm migration policy as part of the birth certificate's backend allowlist (see invariant 6). A heart operator can force-migrate by updating the allowlist; old-suite credentials become invalid on that allowlist's next rotation.

**Why this works:** it matches the composite-signature migration pattern that every PKI provider is converging on, and it uses our existing domain-separation hook (C4) to bind the suite into the signing input. An attacker cannot force a downgrade to a weaker suite because the suite is part of what was signed.

### 1b. Protocol versioning

Every rotation event carries a `protocolVersion` field. The controller refuses to process events from a newer protocol version than it understands; it can still *display* them as "unknown, not honored." This means an attacker who compromises a single heart cannot smuggle a malicious future-version event into a fleet of verifiers, because verifiers fail closed on unknown versions.

Versioning is backward compatible: a `v1` verifier honors `v1` events forever. A `v2` verifier honors both `v1` and `v2` events, with `v2` events taking precedence when both exist for the same target. A `v1` verifier that gets a `v2` event sees "unknown protocol version" and falls back to its last known `v1` state. This is how we upgrade a live fleet without downtime.

### 1c. Anchoring diversity

Invariant 3 (rotation events must be anchored before they are effective) has a single-point-of-failure problem if we only anchor into the pulse tree. If ClawNet's pulse tree is down, rotation across the entire fleet is blocked. That is unacceptable for anything calling itself a protocol.

The fix: support multiple anchor targets per deployment. The default anchor is the local pulse tree (fast, free, always available to the operator). An operator may configure secondary anchors:

- **On-chain anchor** (EAS attestation on Base, or a simple contract write). Slow and costs gas but extremely hard to censor. Recommended for operators holding more than $10k worth of credentials under one identity.
- **Peer heart gossip.** Rotation event is broadcast to a set of peer hearts who sign receipts. A rotation is "anchored" when N peer receipts exist. This is the KERI witness model, which has production reference implementations in the identity foundation's work.
- **Transparency log.** A Sigstore-style append-only Merkle log that any third party can monitor. This is how certificate transparency works, and it is how npm supply chain monitoring (Shai-Hulud detection) is now done. We do not need to build our own — we can submit to an existing public transparency log.

A 10/10 deployment uses at least two anchor targets and requires confirmation from both before the rotation is effective. A minimal deployment can use one, but the controller logs a warning and the birth certificate records the anchoring policy so verifiers know what to expect.

**Verdict on future-proof:** yes, conditional on shipping algorithm agility, protocol versioning, and anchoring diversity as part of the first release. If we ship any of the three as "nice to have later", we are locking in the current crypto and the single anchor target and will have to rip them out later under pressure.

---

## 2. Does it provide value?

**Short answer: yes, to four different stakeholder groups, each for a different reason.**

### For heart operators (ClawNet, Nova, HeyDATA, third parties)

Today: every operator holds long-lived `.env` secrets. One leak = total compromise. Rotation is a manual emergency procedure that nobody has practiced.

After: every credential has a TTL, a policy envelope, an audit trail, and a panic button. Rotation is a routine background operation that happens every 24 hours whether anyone is watching or not. The worst case of a leak is "the attacker has the credential for the rest of its TTL" — typically under an hour — and every use of the credential lands in an anchored log.

This is the HashiCorp Vault value proposition applied to heart operators, but *inside* the heart rather than as an external dependency. A heart operator does not need to deploy Vault, configure Kubernetes, train staff. They ship a new version of their heart and rotation is on.

### For agents (the autonomous kind)

Today: agent authentication is either (a) a long-lived API key embedded in the agent's config (insecure) or (b) a token vault service the agent calls every request (latency + central failure point). OAuth 2.1 refresh token rotation is the emerging standard, and it requires a trusted central authority.

After: an agent holds a Tier 1 session credential derived from a Tier 0 identity. The agent can rotate the Tier 1 credential autonomously (it has the derivation material), with every rotation landing in its own heart's pulse tree as a signed event. The agent does not need to call a central service every request, and if the Tier 1 leaks, the worst case is one hour of exposure. Rich Authorization Requests (RAR) style just-in-time scope requests work directly: the agent issues itself a short-TTL session credential scoped to exactly the call it is about to make.

This is the "secure by default" primitive for the agentic commerce narrative. We can truthfully say "an agent built on Soma has no long-lived secrets anywhere in its runtime."

### For end users of agents

Today: if an agent's API key leaks, the user finds out when their monthly bill spikes.

After: an end user never sees a credential. The agent's identity is the stable thing; the credentials underneath rotate invisibly. If the user wants to audit what their agent has done, they read the rotation log and the pulse tree, which are both append-only and anchored.

The value to end users is "you never have to think about this." That is the highest form of security UX.

### For Soma the protocol

Today: Soma's public story is "trust protocol for AI agents". The main differentiator is the heart + observer split and the step-up mechanism. Wallet rotation is on the backlog but not shipped.

After: Soma's story is "trust protocol for AI agents, with a credential rotation primitive you can plug any of your secrets into, anchored in an auditable append-only log, with fail-closed panic semantics." That is a much harder pitch for a competitor to clone because it requires the whole stack (identity + rotation + anchor + panic) to be coherent, not just any one piece.

The value to Soma as a project is that this is the primitive that converts "trust protocol" into "operational infrastructure." Once a heart operator is rotating all of their secrets through Soma, switching away from Soma is a major migration. That is the real moat.

**Verdict on value:** four distinct stakeholder groups each get a clear, articulable benefit. None of the four benefits requires the other three to exist for this group to care.

---

## 3. Does it enable agentic capabilities to work more safely?

**Short answer: yes, in three specific ways that no current option covers cleanly.**

Agentic capabilities today have three credential-adjacent failure modes:

**Failure mode 1: the agent's credential is the agent's identity.** If the API key leaks, the attacker *is* the agent. There is no way to tell a legitimate request from a stolen one because the key is all the authentication the system has.

Our design splits identity from credential. The agent's identity is a did:key that never rotates. Credentials are derived under that identity, rotate every hour, and each one has a unique policy envelope. An attacker who steals a credential gets the credential, not the identity. The heart can rotate the credential out of existence and the agent's identity, reputation, and delegations are untouched.

**Failure mode 2: granting "broad" permissions to an agent is the only option.** OAuth 2.0 scopes are coarse. An agent that needs to make one payment of $10 usually has to hold a credential that can make *any* payment. Rich Authorization Requests (RAR) in OAuth 2.1 is the standards track answer but adoption is early.

Our design supports just-in-time scoped credentials natively. The agent's Tier 0 can issue a Tier 1 with `{policy: {maxAmount: 10_000_000, allowedTargets: ['0xabc...'], validUntil: now + 60_000}}` and hand that to the downstream call. The Tier 1 is a one-use, one-minute, one-target credential. If it leaks, the blast radius is mathematically bounded. Every issuance lands in the rotation log, so a human auditor can see exactly what the agent spent on what.

This is the same model SPIFFE uses for workload identity (short-lived SVIDs with scope), but extended to arbitrary credential types.

**Failure mode 3: an agent cannot safely delegate to another agent.** When Agent A wants Agent B to do a task on A's behalf, A either hands its full credential to B (total trust) or asks an orchestration platform to do it (no autonomy). There is no middle ground where A hands B a scoped, auditable, revocable credential without going through a central authority.

Our design already has delegation (`src/heart/delegation.ts` in Soma). The credential rotation primitive extends delegation: a rotation event can be a *delegation rotation*, where Agent A issues Agent B a derived credential that is scoped by caveats and TTL. B rotates that credential under its own policy, but A retains revocation authority. If A wants to cancel delegation to B, A publishes a rotation event that effectively kills the derived credential; B's next use fails.

This is the multi-agent orchestration primitive that safe agentic commerce has been missing. Not "can I give another agent access?" but "can I give another agent access safely, auditably, with a hard kill switch, without a central authority?"

**One specific enablement the design unlocks:** an agent-of-agents scenario. A top-level orchestrator has a heart. It spawns three worker agents, each a forked heart. Each worker gets a lineage certificate from the orchestrator plus a Tier 0 credential derived from the orchestrator's Tier 0. Each worker rotates its own Tier 1 credentials for its own tasks. The orchestrator can revoke any worker's entire credential family by publishing one signed event. The workers continue to rotate until the revocation reaches them, at which point the next rotation attempt fails and the worker halts. All of this lands in a single audit trail anchored in the orchestrator's pulse tree.

**Verdict on agentic safety:** yes, and specifically enables things that are currently hard or impossible without a trusted third party.

---

## 4. Can it handle millions of users?

**Short answer: yes at the protocol level, but the scaling math has sharp edges that must be designed for before the first release.**

Let us do the math. Assume one million agents, each with one Tier 0 identity, each with an average of five active Tier 1 credentials at any given time, each Tier 1 rotating every hour.

- Rotation events per day: 1M × 5 × 24 = 120M events per day = ~1,400 events per second
- Each event is signed (one Ed25519 signature, ~1ms on modern hardware) = ~1,400 signatures per second
- Each event is hashed and appended to the rotation log (one hash, one append, ~100µs) = ~140ms per second of work
- Each event is anchored into the pulse tree (one leaf, one DB write, ~1ms with WAL) = ~1.4s per second of work — already saturating one writer
- Each event is optionally anchored into a transparency log (one network round-trip, 10-50ms) = needs batching or async

The pulse tree writer saturates at ~1,000 anchors/sec on a single machine. Above that we need partitioning. The clean partition is by agent DID: each agent's rotation log is independent, so the pulse tree can be sharded by DID prefix with no cross-shard coordination for rotation. The sharding math is already a solved problem (consistent hashing); what we need is for the design to *permit* it, not force everything through a single pulse tree.

**Design requirement derived from this math:** the `CredentialRotationController` MUST NOT assume a single global pulse tree. It must accept a `PulseTreeResolver` that, given an identity, returns the pulse tree instance for that identity. This lets a large deployment shard the pulse tree by identity and route rotations to the right shard.

The log itself grows linearly. At 120M events/day, one year of retention is 43 billion events. At ~200 bytes per event (event payload + hash chain), that is 8.6 TB of raw event data per year. Manageable on modern storage but not free. Pruning policy is needed:

- Events for expired credentials (TTL past) can be compacted into a "summary event" after 90 days.
- The hash chain is preserved but the full event payloads are replaced with hash references to cold storage.
- Verifiers that need to audit an old event fetch it from cold storage on demand, paying a latency cost but not a storage cost.
- The summary-event pattern is how certificate transparency logs handle historical data.

**Design requirement:** the log format MUST permit compaction without breaking the hash chain. This means the compaction produces a new log entry that commits to the pre-compaction chain tip plus the new compacted state, not a destructive rewrite. Anyone who has the pre-compaction state can still verify against it.

**Verification throughput.** A verifier checking "is credential X currently valid?" needs to consult the rotation log for X's lineage. Naive implementation: walk the chain. Optimized implementation: maintain a per-identity "current tip" cache, invalidate on new events. Verification is then O(1) in the common case.

For a fleet serving one million rps of verification queries (x402 settlement, MCP tool calls, agent payments), the verifier cache needs to handle ~1M reads/sec against a working set of ~1M identities. That fits in a single Redis instance today; at ten million rps we need a sharded cache. Redis cluster solves that.

**Cold start.** A new verifier joining the network needs to sync the current state of all identities it cares about. Option A: download the full log tail (expensive but correct). Option B: download a signed "state commitment" that summarizes the current state, then only fetch deltas (cheap but depends on trusting the commitment signer — which is the heart operator, which the verifier already trusts). KERI does this with "receipt chains" and it works. We copy the pattern.

**Design requirement:** the controller MUST support signed state commitments that let a new verifier bootstrap from "nothing" to "current" in O(1) state transfer, at the cost of trusting the commitment signer (the heart itself) for the history. This is the same cost certificate transparency auditors pay and they have accepted it for a decade.

**DoS resistance.** An attacker spams a heart with rotation requests, hoping to either (a) exhaust the pulse tree writer or (b) force the heart to burn signatures. Mitigation:

- Rate limit per identity: no more than N rotations per hour. Default N = 10, configurable.
- If the rate limit is exceeded, the controller does not fail the request — it triggers a panic freeze for that identity. The assumption is that exceeding 10 rotations/hour legitimately is impossible; exceeding it means someone is trying to rotate you to death. Fail closed.
- Rate limit applies per identity, not per machine. An attacker cannot rate-limit you out by hammering from a thousand IPs because the rate limit counts against the identity, not the connection.

**Verdict on scale:** the design can handle millions of agents at 1,400 events/sec with proper pulse tree sharding, Redis-backed verifier caches, compaction after 90 days, and signed state commitments for cold starts. Ten million agents works the same way with more shards. Hundred million agents needs a global pulse tree federation, which is out of scope for the first release but the design permits it because the controller is already pulse-tree-agnostic.

---

## 5. Can it be exploited for trust violation or malicious entry?

**Short answer: there are eleven specific attack paths I can think of. The design closes nine of them structurally. The remaining two need explicit mitigations that must be part of the first release.**

### A1. Supply chain compromise of a backend

A malicious `@soma/evm-backend@1.2.3` gets published after a maintainer's npm token is phished (this is Shai-Hulud, September 2025, $12M drained across 18 packages in 16 minutes).

**Closed by invariant 6:** backends are loaded from a signed allowlist in the birth certificate. The allowlist contains the hash of the expected backend bundle, not just the package name and version. If an attacker publishes a malicious version, the hash does not match and the loader refuses. The birth certificate is signed by the heart's identity key at inception; changing the allowlist requires a rotation event signed under the current identity, which is itself anchored.

**Residual risk:** if the attacker compromises the heart's identity key, they can rewrite the allowlist. This is the "stolen bootstrap" scenario, which is covered by threshold requirements (invariant 1). To rewrite the allowlist, the attacker needs threshold consensus, not just one stolen key.

### A2. Phishing of an EIP-7702 authorization tuple

The largest real-world exploitation of a primitive adjacent to ours in 2025: $12M drained from 15,000 wallets via phishing of EIP-7702 authorization tuples. Over 90% of EIP-7702 delegations observed on-chain are linked to malicious contracts.

**Closed by invariant 5 (PoP) and invariant 4 (threshold panic):** the EVM backend cannot accept an authorization tuple without a live proof-of-possession from the user's Tier 0. An attacker who phishes a signed tuple still cannot use it because they do not hold the Tier 0 to produce the PoP. If the user notices and panics, invariant 4 ensures they can freeze their identity with threshold consensus even if the phisher now holds one of their shards.

**Residual risk:** a user who signs an authorization tuple AND provides the PoP AND the panic freeze is not triggered. This is the "user was completely fooled" case and no technical control stops it. We mitigate socially: UI in the controller that displays authorization tuples in plain English before signing, with a red warning if the target contract is not in the user's historical approval list. This is the same mitigation WalletConnect is converging on.

### A3. Storage collision between EIP-7702 delegations

Known attack: delegate an EOA to contract A with storage layout X, then re-delegate to contract B with storage layout Y. The storage from A pollutes the namespace of B, creating undefined behavior.

**Closed by invariant 7 (backend isolation):** each EVM backend instance pins its target implementation contract. The rotation event for a new EVM session key does not re-delegate the EOA to a new contract; it issues a new ERC-7579 session key under the same pinned implementation. The delegation target is set once, at initial EIP-7702 authorization time, and never changes under normal operation. A rotation that requires a new implementation is a bootstrap-level event, requiring threshold consensus.

### A4. Cross-chain replay of authorization tuples

EIP-7702 authorization signatures are chain-agnostic by default, which means a tuple valid on Ethereum mainnet is also valid on Optimism, Base, Arbitrum — any chain the EOA exists on.

**Closed by domain separation (C4 pattern, extended):** the EVM backend's signing domain includes `${protocol}/evm/${chainId}/v${version}`. A signature produced for chain 1 cannot be replayed on chain 8453 because the chain ID is part of the signed input and the verifier on chain 8453 computes a different expected input.

### A5. Race condition during rotation

An attacker uses a credential at the same millisecond as the heart is rotating it out. One code path sees the old state and accepts the use; another sees the new state and the rotation landed. The attacker wins.

**Closed by transactional anchoring:** the controller wraps `verify(credential) → anchor-check(credential)` in a single atomic read against the pulse tree state. The pulse tree write that installs the new rotation happens in a separate transaction. An attacker whose request arrives before the rotation transaction commits sees the old state (which is still valid); an attacker whose request arrives after sees the new state (which rejects their credential). There is no "in-between" window because the atomic read is either before or after the commit, never straddling it.

**Residual risk:** clock skew between the attacker's request processing and the rotation processing. If the attacker can time their request within the processing window of the rotation, they get ambiguous behavior. Mitigation: use the rotation log's sequence number, not wall clock time, as the ordering primitive. Sequence numbers are monotonic and unambiguous.

### A6. Rollback attack via backup restore

An attacker with access to the operator's backup restores an older state of the rotation log, "un-rotating" a compromised credential. The old credential is now valid again.

**Closed by anchoring diversity (section 1c):** rollback only works if the attacker can roll back *all* anchor targets. Rolling back the operator's local pulse tree is possible. Rolling back an on-chain anchor is impossible. Rolling back peer heart receipts requires compromising the peers. Rolling back a transparency log requires compromising the log operators.

A 10/10 deployment uses at least two anchor targets including one that the operator does not control, so a single-operator rollback is detected by the cross-check.

### A7. Denial of rotation

An attacker floods the heart with rotation requests (valid signatures, valid derivations) to exhaust CPU or pulse tree capacity.

**Closed by rate limiting (section 4):** the controller rate-limits rotations per identity. Exceeding the rate limit triggers a panic freeze rather than a soft fail. An attacker who wants to DoS an identity can only succeed in freezing it, at which point the operator is alerted and assembles threshold consensus to restore.

**Residual risk:** the panic freeze becomes the DoS vector. Someone who wants to freeze you can exhaust your rate limit deliberately. Mitigation: rate limits apply only to externally-initiated rotations; internally-scheduled rotations run on a separate, non-rate-limited path that cannot be triggered from outside. This closes the loop.

### A8. Downgrade to weaker algorithm

An attacker finds a weakness in Ed25519 (or has a quantum computer) and presents old credentials that were signed under Ed25519, hoping a verifier still honors them.

**Closed by algorithm agility (section 1a):** the controller's allowlist specifies the active algorithm suite. Credentials signed under removed suites are rejected at verification. A heart operator who wants to drop Ed25519 updates the allowlist via a rotation event; the moment that rotation is anchored, old Ed25519 credentials become invalid fleet-wide.

### A9. Log poisoning via gossip

If the rotation log is gossiped between peer hearts, an attacker can inject events into the gossip stream, hoping a verifier will accept them without checking the signature.

**Closed by the existing hash chain and signature verification from C3:** every event is signed by the claimed issuer, and the chain is hash-linked. An attacker can send garbage over gossip, but a receiving verifier rejects garbage before it hits the log. This is the same defense the revocation log already has.

### A10. Malicious CI/CD pipeline modifying the allowlist

An attacker compromises the heart's CI/CD and pushes a new allowlist with their own backend implementation included.

**Closed by invariant 6 + human ceremony:** the allowlist is signed by the heart's identity key at inception and modifiable only via a threshold-signed rotation event. A compromised CI/CD cannot produce threshold consensus without compromising the shard holders, which by construction are not on CI/CD infrastructure.

**Residual risk:** the operator's development workstation is compromised and holds one of the shards. Threshold is there specifically to survive one compromised shard. If more than one shard is on the same workstation, the operator has violated their own threshold discipline. The controller logs a warning if it detects this at configuration time.

### A11. Social engineering of panic freeze to lock out the operator

An attacker tricks the operator's second-party shard holder into triggering a panic freeze when no actual compromise has occurred. The operator is locked out until they can assemble threshold again, during which time the attacker may have time to do something else.

**Partially closed by invariant 4 + delayed recovery:** panic freeze is triggerable with threshold consensus, but unfreezing requires the SAME threshold consensus. If the operator can assemble threshold to unfreeze, they can also see who triggered the freeze (it is in the rotation log, signed). If the trigger was malicious, the operator knows which shard holder to distrust.

**Residual risk:** the window between the malicious freeze and the operator regaining control is a real vulnerability. Mitigation: the freeze event is not immediate — it takes effect after a configurable challenge period (default 1 hour). During that period, any threshold-authorized party can cancel the freeze. This gives the operator a window to react. For high-stakes deployments the operator can set challenge period to zero and accept the lockout risk; for low-stakes deployments a 1-hour challenge period is the sane default.

This is the one mitigation that did not exist in my earlier seven invariants. Adding it as invariant 8 (challenge period for destructive operations).

**Two attack paths needing explicit mitigation in the first release:**

1. **A2 (phishing fooling a user who provides PoP):** we mitigate with UI warnings, not cryptographic prevention. This is a *documented* residual risk, not a bug. The EVM backend MUST ship with a reference UI that displays authorization tuples in plain English and refuses to sign if the target is unknown. Heart operators that build their own UI take responsibility for equivalent protection.
2. **A11 (malicious panic freeze):** invariant 8 (challenge period) is added. The default challenge period is 1 hour. The operator can override per deployment.

Everything else is closed structurally by the invariants. The nine closed paths are closed by design, not policy — an operator cannot turn them off by accident.

**Verdict on exploitability:** two residual risks, both documented, both mitigated with explicit controls in the first release. The remaining nine attack paths are closed by the invariants and cannot be re-opened without rewriting the interface.

---

## 6. How should it flow through Soma?

Every rotation is an event in the same sense that a revocation is an event. The flow reuses three primitives that already exist in Soma:

1. **Heart identity signing.** The rotation event is signed by the heart's current identity key (the did:key that gates everything else). This ties every rotation to an accountable identity. If the key itself is what is rotating, the signature is under the old key and commits to the new key, KERI-style. This is already how `src/heart/key-rotation.ts` works.

2. **Append-only hash chain.** The rotation log is a hash-chained append-only structure, same pattern as `src/heart/revocation-log.ts`. Every event includes the previous event's hash. Gaps or reorderings are detectable.

3. **Pulse tree anchoring.** Every rotation produces a leaf in the heart's pulse tree (ROTATE or similar type). This is the local anchor that makes invariant 3 (synchronous anchoring) work. The pulse tree is already append-only with cryptographic commitment, so anchoring is one existing leaf type.

New pieces the flow adds:

4. **Credential backends.** A new module `src/heart/credential-rotation.ts` that holds the generic controller. It imports no ClawNet code and knows nothing about specific credential types. It exposes a `CredentialBackend` interface that credential-type-specific adapters implement.

5. **Backend allowlist in birth certificate.** The birth certificate grows a new field: `allowedCredentialBackends: { name: string, hash: string }[]`. At heart startup, the controller loads only backends whose hashes match the allowlist. Loading any other backend is an error.

6. **Policy envelopes.** Each credential carries a `CredentialPolicy` object: TTL, scope, rate envelope, allowed actions. Backends interpret policies for their own credential types. The controller checks TTL generically before delegating to backend-specific checks.

7. **Delayed-effect events.** Rotation events and panic freeze events may have a `effectiveAt` timestamp later than `issuedAt`. The controller holds events in a pending state until `effectiveAt`. This supports invariant 8 (challenge period).

The flow for a single rotation:

```
1. Agent calls: controller.rotate(identity, credentialId, newCredential)
2. Controller calls: backend.generate(parent, index) → derived credential
3. Controller builds rotation event: { sequence, previous, new pubkey, policy, ... }
4. Controller signs event under heart identity key
5. Controller appends event to in-memory log (hash-chained)
6. Controller writes event to pulse tree (anchor) in one atomic tx
7. Controller broadcasts event to secondary anchors (async, best-effort)
8. Once secondary anchors confirm, controller marks event as "fully anchored"
9. Backend.verify() on the new credential returns true
10. Old credential is marked expired at `effectiveAt`
```

The flow for a challenge-period panic freeze:

```
1. Shard holder 1 and 2 co-sign a panic event (threshold reached)
2. Controller builds freeze event with effectiveAt = now + 1h
3. Controller signs, appends to log, anchors into pulse tree
4. Shard holders are notified
5. Window opens: any threshold-authorized party can cancel
   5a. Cancel requires its own threshold-signed cancel event
   5b. Cancel event is also appended and anchored
6. At effectiveAt, if no cancel has been seen, freeze is applied
7. All credentials under the frozen identity fail verification from this point
8. Unfreeze requires another threshold-signed event + challenge period
```

**The critical design principle:** every effect on the system passes through a signed, anchored, append-only event. There is no "silently modify state" path. This is what makes public code review meaningful — an auditor reading the source can convince themselves that every state transition is visible in the log.

---

## 7. Other things to think about

Things I considered that did not fit cleanly above but must be addressed before the first code release.

### 7a. Clock skew and signed time

If credentials have TTLs measured in local wall clock, clock skew between hearts becomes a real bug. SPIFFE handles this with issuance-time slack (SVIDs are issued slightly in the past). We should do better: tie TTLs to Soma's existing time oracle (`src/heart/time-oracle.ts`), which already produces signed time readings. A credential's `validUntil` is a signed-time value; verifiers compare against their own signed-time reading, which is anchored to the same oracle.

### 7b. Reputation continuity across rotation

If a credential is rotated, the reputation of the old one must carry to the new one, or operators will refuse to rotate voluntarily. Since our identity is stable and credentials are derived, reputation attaches to the identity, not the credential. This is already how the `vouchGraph` in ClawNet works — it keys on DID, not API key. The credential rotation primitive leaves this invariant untouched.

### 7c. Delegation chain cascade on parent rotation

If A delegates to B, and A rotates its Tier 1 credential, what happens to B's delegation? Two options:

- **Cascade:** B's delegation is implicitly revoked because it was issued under the old Tier 1. B must request a new delegation under A's new Tier 1. Safe but disruptive.
- **Persist:** B's delegation survives rotation because it was verified against A's *identity*, not A's specific credential. Continuity but weaker isolation.

We pick **persist** as the default because it matches how delegations work today (`src/heart/delegation.ts` verifies against DID, not against the issuing credential). Operators who want cascade can issue delegations with a `bindToCredential: true` flag, which ties the delegation's validity to a specific parent credential. This is configurable per delegation at issuance time.

### 7d. Backup and recovery when all shards are lost

If an operator loses all threshold shards, there is by design no recovery path — that is what "threshold" means. We acknowledge this as the price of 10/10 and provide two defenses:

1. **Shard ceremony guidance.** Documentation that tells operators to distribute shards across at least three distinct environments (personal device, hardware token, sealed cold backup). Losing all three simultaneously requires a house fire AND a stolen laptop AND a forgotten safe deposit box, which is a realistic risk only for solo operators with no contingency planning.
2. **Optional delayed recovery via secondary threshold.** An operator may configure a secondary threshold (M-of-P, different set of shard holders) that can recover a Tier 0 after a 30-day challenge window during which the primary threshold can cancel. This is how Bitcoin time-locked recovery wallets work. It trades 30 days of vulnerability for recoverability. Opt-in per deployment.

### 7e. Insider attack by a developer on the heart

A developer with commit access to the heart's source can ship a new version that deliberately weakens rotation. Mitigations:

- **Reproducible builds.** The backend bundle hashes in the allowlist are reproducible from source. A developer can verify that a given bundle matches a given commit. Operators who want to be paranoid run reproducible builds and check.
- **Multi-signature commits.** For production deployments, the heart's release tag is signed by multiple maintainers. A single rogue developer cannot ship a release. This is how Sigstore's own releases work.
- **Transparency log.** All releases are published to a transparency log that third parties monitor. A surprise release triggers alerts. Same pattern as Rekor for npm supply chain monitoring.

None of these are in the first release. They are the trust story we tell as the project matures. For the first release, the mitigation is "the heart maintainer is trusted" and we document it.

### 7f. Quantum timeline

Assume a cryptanalytically relevant quantum computer appears in 2030-2035. A credential issued today with Ed25519 could be "harvested now, decrypted later." For session credentials with 1-hour TTL, this is irrelevant — by the time a quantum computer exists, the credential has been expired for years and reveals nothing. For Tier 0 identity keys, it matters because the identity is long-lived.

The mitigation: Tier 0 identity keys ship as composite signatures from the first release (`ed25519+ml-dsa-65`). The ML-DSA half survives the quantum transition; the Ed25519 half provides defense in depth against ML-DSA being broken (which has happened before with Rainbow). The signing cost is higher but Tier 0 signs rarely (only rotation events and panic events), so the amortized cost is acceptable.

Tier 1 session credentials can remain Ed25519-only for now because their TTL is short enough that quantum post-compromise is irrelevant.

### 7g. Peer heart federation

If ClawNet and Nova both run hearts, do they honor each other's credentials? Yes via delegation, but cross-heart rotation events need a gossip protocol. The existing Soma gossip plans (`src/heart/gossip.ts`) apply to revocations; we extend the same gossip to rotation events. This requires peer hearts to accept rotation events signed by another heart's identity, which they already do for revocations. No new gossip work is needed beyond adding rotation events to the gossip message types.

### 7h. Zero-knowledge scope proofs

A long-term direction: a credential can be presented with a zero-knowledge proof that it satisfies a policy without revealing the full credential. An agent proves "I have a credential that allows payment up to $10 to address 0xabc" without revealing the credential itself. This would be a ZK circuit over our credential structure. It is out of scope for the first release but the design should not foreclose it — the credential format should be ZK-friendly (small field sizes, no branching logic in verification).

---

## 8. Revised invariants — the final eight

Promoting the earlier seven to eight after the battle test surfaced the challenge period gap.

1. **Threshold for Tier 0.** `bootstrap()` refuses single-party seeds in production mode. Default 2-of-3 FROST Ed25519 or Pedersen VSS secp256k1.
2. **Session credentials are always derived, never imported.** No API accepts "register this existing secret as a credential." Every credential has cryptographic lineage back to a threshold-signed bootstrap event.
3. **Rotation events must be anchored before taking effect.** Primary anchor in the local pulse tree, secondary anchors per deployment policy (on-chain, peer gossip, transparency log). At least one primary and one secondary required for 10/10.
4. **Panic freeze requires threshold consensus.** Not stealable with one session key. Triggerable with bootstrap-level consensus.
5. **Proof of possession is mandatory per use.** Every backend implements `verifyProofOfPossession(credential, nonce, signedTime)` and the controller calls it on every verification. Stolen serialized state is useless without the live PoP.
6. **Backends loaded from a signed allowlist in the birth certificate.** No dynamic loading, no runtime package resolution. Changing the allowlist is itself a rotation event.
7. **Backends are isolated from each other.** Controller is the only point of coordination. No cross-backend callbacks, shared state, or events. Type system enforces.
8. **Destructive operations have a challenge period.** Panic freeze, bootstrap rotation, and allowlist changes take effect only after a configurable delay during which threshold-authorized parties can cancel. Default 1 hour, configurable per deployment (including zero for high-stakes deployments that accept lockout risk).

All eight are non-negotiable contracts of the interface. If the code ships with any one of them as optional, the resulting system is not 10/10.

---

## 9. Scope for the first release

**In scope — must ship:**

- `src/heart/credential-rotation.ts` in Soma with all eight invariants enforced.
- Ed25519 identity backend as the reference implementation, replacing the current `key-rotation.ts` (which is not wired into runtime anyway).
- `ClawNetApiKeyBackend` in `claw-net/src/core/api-key-rotation.ts`, implementing the Soma interface against the `api_keys` table.
- ClawNet `checkApiKey` middleware cutover to use the new backend.
- Migration path for existing `cn-...` keys: treated as Tier 0 identities with a single non-rotating Tier 1 child until the customer opts into rotation.
- Reproducible test suite including the eleven attack paths from section 5.
- CI grep check in Soma for `/clawnet|cn-[a-f0-9]|clawapis/i` to enforce protocol purity (per `feedback_soma_purity.md`).
- ARCHITECTURE.md in Soma stating the purity rule in plain English.

**Deferred — will ship later:**

- `@soma/evm-backend` for x402 settlement key rotation with EIP-7702 + ERC-7579.
- On-chain anchor target (EAS attestation).
- Transparency log anchor target (Sigstore-style Rekor).
- Composite ML-DSA signatures for Tier 0.
- Delayed-recovery secondary threshold.
- Cross-heart gossip of rotation events.
- ZK scope proofs.
- Reference UI for EIP-7702 authorization tuple display.

Deferring EVM backend is the biggest scope cut. It is deferred because EIP-7702 + ERC-7579 + EAS + on-chain anchoring is a multi-week effort, and the ClawNet API key backend gives us the dogfood and the primitive without it. Once the generic controller is proven against the API key backend, adding EVM is a matter of implementing the interface, not redesigning it.

---

## 10. Open decisions that need ratification

Before code starts:

1. **Threshold choice for Tier 0.** FROST Ed25519 (RFC 9591, newer, fewer rounds, DoS needs authenticated transport) or Pedersen VSS secp256k1 (older, battle-tested, works with existing wallet tooling). **Recommendation:** FROST Ed25519 for identity keys (we already use Ed25519 everywhere), Pedersen VSS for EVM secp256k1 keys when we add the EVM backend. Mixing is fine because the two backends are isolated per invariant 7.

2. **Default challenge period for destructive operations.** 1 hour (recommended) or 15 minutes (faster recovery but tighter reaction window) or 24 hours (slower but safer). **Recommendation:** 1 hour default, operator override per deployment.

3. **Default rate limit for rotations.** 10/hour per identity (recommended) or 5/hour (stricter) or 30/hour (looser for high-churn agents). **Recommendation:** 10/hour default, per-identity override stored in the birth certificate.

4. **Panic shard holders for ClawNet specifically.** Three options:
   - **a)** User alone, three personal devices. Simple, single human control, risk of total loss.
   - **b)** User plus one trusted second party with a sealed offline shard. Recoverable if user loses all devices, adds one social dependency.
   - **c)** User plus time-locked recovery via secondary threshold after 30-day challenge window. Best of both but more implementation work.
   - **Recommendation for the very first ClawNet deployment:** (a) because we need to ship; document the upgrade path to (c) as a follow-up, and give users the `bootstrap()` API to reconfigure later.

5. **Should the existing `src/heart/key-rotation.ts` be deleted or kept during migration?** The existing module implements KERI-style pre-rotation for identity keys but is not wired into runtime. **Recommendation:** delete it and start fresh inside the generic controller. There is no production caller to break, and keeping it means two parallel rotation mechanisms confusing future readers.

---

## 11. References

### KERI
- [Key Event Receipt Infrastructure (KERI)](https://weboftrust.github.io/ietf-keri/draft-ssmith-keri.html) — the design doc for pre-rotation.
- [KID0005 — Next Key Commitment](https://identity.foundation/keri/kids/kid0005Comment.html) — pre-rotation commentary.
- [draft-ssmith-keri](https://datatracker.ietf.org/doc/draft-ssmith-keri/) — IETF draft.

### FROST and threshold
- [RFC 9591 — FROST](https://datatracker.ietf.org/doc/html/rfc9591) — the threshold Schnorr protocol we target for Tier 0 Ed25519.
- [Ensuring the Secure Use of the FROST Protocol — Least Authority](https://leastauthority.com/blog/ensuring-the-secure-use-of-the-frost-protocol/) — deployment pitfalls.
- [Threshold Cryptography II: Unidentifiability — CertiK](https://www.certik.com/resources/blog/threshold-cryptography-ii-unidentifiability-in-decentralized-frost) — known gotchas.

### Shamir timing and VSS
- [CVE-2023-25000 — HashiCorp Vault Shamir timing attack](https://vulert.com/vuln-db/go-github-com-hashicorp-vault-69428) — the exact bug we must avoid.
- [Feldman's Verifiable Secret Sharing — ZKDocs](https://www.zkdocs.com/docs/zkdocs/protocol-primitives/verifiable-secret-sharing/) — detecting dealer cheating.
- [privy-io/shamir-secret-sharing](https://github.com/privy-io/shamir-secret-sharing) — the closest thing to a constant-time JS reference implementation.

### EIP-7702 security
- [EIP-7702 Phishing Attack (arXiv 2512.12174)](https://arxiv.org/html/2512.12174v1) — the attack paper.
- [EIP-7702 Attack Surfaces — Nethermind](https://www.nethermind.io/blog/eip-7702-attack-surfaces-what-developers-should-know) — developer guidance.
- [EIP-7702 Security Considerations — Halborn](https://www.halborn.com/blog/post/eip-7702-security-considerations) — audit perspective.

### Supply chain
- [Widespread Supply Chain Compromise Impacting npm Ecosystem — CISA](https://www.cisa.gov/news-events/alerts/2025/09/23/widespread-supply-chain-compromise-impacting-npm-ecosystem) — the 2025 incident landscape.
- [Shai-Hulud Worm Compromises npm Ecosystem — Unit 42](https://unit42.paloaltonetworks.com/npm-supply-chain-attack/) — the worm analysis.
- [Catching Malicious Package Releases with Rekor — OpenSSF](https://openssf.org/blog/2025/12/19/catching-malicious-package-releases-using-a-transparency-log/) — transparency log defense.

### SPIFFE/SPIRE (workload identity reference)
- [Zero to Trusted: SPIFFE and SPIRE, Demystified](https://www.spletzer.com/2025/03/zero-to-trusted-spiffe-and-spire-demystified/) — how short-lived credentials are done in practice.
- [Machine Identity: mTLS + SPIFFE Zero Trust Guide — 2026](https://petronellatech.com/blog/machine-identity-is-the-new-perimeter-mtls-spiffe-for-zero-trust/) — the 2026 state of the art.
- [Establishing Workload Identity for Zero Trust CI/CD (arXiv 2504.14760)](https://arxiv.org/html/2504.14760v1) — academic treatment.

### Post-quantum migration
- [Composite ML-DSA for X.509 PKI](https://lamps-wg.github.io/draft-composite-sigs/draft-ietf-lamps-pq-composite-sigs.html) — the draft standard for hybrid signatures.
- [Post-Quantum Cryptography Authentication Migration Guide 2026](https://securityboulevard.com/2026/03/post-quantum-cryptography-for-authentication-the-enterprise-migration-guide-2026/) — enterprise roadmap.
- [Digital Signatures: Traditional Vs. Post-Quantum — Akamai](https://www.akamai.com/blog/security/digital-signatures-traditional-post-quantum-cryptographic) — production deployment perspective.

### AI agent authentication
- [From Auth to Action: The Complete Guide to Secure AI Agent Infrastructure — Composio](https://composio.dev/blog/secure-ai-agent-infrastructure-guide) — the 2026 state of the art for agents.
- [draft-klrc-aiagent-auth — IETF](https://datatracker.ietf.org/doc/draft-klrc-aiagent-auth/) — the standards track for agent auth.
- [How to Handle Token Refresh for AI Agents in Production — Scalekit](https://www.scalekit.com/blog/how-handle-token-refresh-ai-agents) — operational patterns.

### OAuth 2.1 and rotation
- [RFC 9700 — OAuth 2.0 Security Best Practices](https://datatracker.ietf.org/doc/rfc9700/) — the authoritative source.
- [Refresh Token Rotation — Auth0](https://dev.auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation) — family revocation mechanics.
- [Token Replay Attacks — WorkOS](https://workos.com/blog/token-replay-attacks) — why rotation matters.

### Transparency logs
- [Certificate Transparency](https://certificate.transparency.dev/howctworks/) — the reference for append-only verifiable logs.
- [Sigstore Security Model](https://docs.sigstore.dev/about/security/) — applied to code signing.
- [What 2025 Holds for Certificate Transparency](https://blog.transparency.dev/what-2025-holds-for-certificate-transparency-and-the-transparencydev-ecosystem) — tile-based logs as the future.

### HashiCorp Vault
- [Dynamic secrets — Vault](https://developer.hashicorp.com/vault/tutorials/db-credentials/database-secrets) — the pattern of credentials that do not exist until requested.
- [Automated secrets rotation — HCP](https://developer.hashicorp.com/hcp/docs/vault-secrets/auto-rotation) — rotation semantics.

---

## 11b. Concrete secret inventory — what the primitive must cover

Walked every `claw-net/src/**` reference on 2026-04-10. Every secret currently in `.env.example` falls into one of four classes.

### Class A — Soma-native (primitive issues and owns the credential)

| Env var / table | What it does | Live path | Backend |
|---|---|---|---|
| `PLATFORM_SIGNING_SECRET` | HKDF seed for ClawNet's Ed25519 *platform heart identity* — signs every outbound Soma dual-sign and response. Single root of trust for the platform's signed-response story. | `src/utils/ed25519-signer.ts:46` | ClawNet identity backend (Tier 0 = seed, Tier 1 = rotating session key under the same stable DID) |
| `CLAWNET_API_KEY` (env) | ClawNet's own `cn-…` used by the MCP server to self-reference. "Service account." | `src/mcp/server.ts:32`, `src/mcp/x402-mcp-transport.ts:77` | `ClawNetApiKeyBackend`, service-account policy envelope |
| `ADMIN_API_KEY` | Timing-safe gate for `/v1/admin/*`. Generated during the same session window as the leak; rotate regardless. | `src/routes/admin.ts` | `ClawNetApiKeyBackend`, admin policy envelope (narrower `allowedTargets`, shorter TTL, stronger panic triggers) |
| `api_keys` table rows | Every customer `cn-…` including the leaked `cn-59bf…`. | `src/db/api-keys.ts`, `checkApiKey` middleware | `ClawNetApiKeyBackend`, customer policy envelope |

**One backend, four policy envelopes.** The backend does not change per env var — only the policy row attached to each `api_identity` row does.

### Class B — Custody keys (primitive rotates session keys under a stable address)

| Env var | What it does | Live path | Backend |
|---|---|---|---|
| `SOLANA_PRIVATE_KEY` = `PLATFORM_PAYOUT_PRIVATE_KEY` | Single bs58 key for x402 outbound *and* creator USDC payouts. `isSimulationMode = !env.SOLANA_PRIVATE_KEY` — if this is present on the VPS, the key is signing real txs. | `src/providers/x402-client.ts:14`, `src/utils/solana-payout.ts:50`, `src/core/payout-cron.ts`, `src/core/anchor-cron.ts:65`, `src/utils/wallet-pool.ts:66` | `SolanaSessionKeyBackend` (P1 — Solana has no EIP-7702 equivalent; needs a separate design pass, probably "generate a new burner keypair per rotation window and transfer balance forward") |
| `EVM_PRIVATE_KEY` | Base chain wallet for EAS attestation anchoring, x402 Base auto-split payouts, schema registration. | `src/utils/eas.ts:70`, `src/utils/evm-payout.ts:35`, `src/core/eas-anchor-cron.ts:106` | `EvmSessionKeyBackend` — EIP-7702 delegated EOA + ERC-7579 session key module, per the original wallet-rotation doc |

**Status check the operator must run on the VPS** (I cannot SSH):

```bash
grep -cE '^(SOLANA_PRIVATE_KEY|PLATFORM_PAYOUT_PRIVATE_KEY|EVM_PRIVATE_KEY|PLATFORM_SIGNING_SECRET)=' .env
```

If this returns >0, those keys are live in production and every day without the primitive is a day of unbounded blast radius. The same grep should run against shell history, PM2 logs, and the systemd journal to make sure none of them leaked through a crash trace.

### Class C — Third-party secrets (primitive vaults and enforces TTL but cannot mint)

These are issued by external providers; Soma cannot generate them. The primitive still provides (a) encrypted storage instead of `.env` plaintext, (b) policy envelope enforcement at the middleware, (c) TTL-based rotation alarms that page the operator when the secret is past its rotation window, (d) rotation log entries when the operator pastes in a new value from the provider's dashboard.

`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET`, `RESEND_API_KEY`, `TELEGRAM_BOT_TOKEN`.

Backend: `ExternalSecretVaultBackend`. Thin — no HKDF derivation path, no on-chain anchor, just "store this, alarm when TTL expires, log every read, fail closed on panic freeze." Still a large security win versus plaintext env files.

### Class D — Dead / non-secret (delete or ignore)

- `TREASURY_SWEEP_WALLET` — confirmed harmless dead config, already in VPS-pending notes to remove.
- `X402_RECIPIENT_ADDRESS` — public address, not a secret.

### Coverage priority

| Class | Backend | First release | Why |
|---|---|---|---|
| A | `ClawNetApiKeyBackend` | **Yes** — dogfood target | Highest leverage: fixes the actual leak surface, tests the primitive on our own traffic |
| B (EVM) | `EvmSessionKeyBackend` | Yes | EIP-7702 path already designed; real settlement key hardening |
| B (Solana) | `SolanaSessionKeyBackend` | No — P1 | Needs separate design; Solana account model is different |
| C | `ExternalSecretVaultBackend` | Thin version yes | Low complexity, high operator ergonomics win |
| D | — | Delete | Reduce attack surface |

### Pre-build lockdown checklist (operator actions that do not require the primitive)

These are things that can land today and are prerequisites either way:

1. Rotate `cn-59bf…` in the `api_keys` table (P0.1).
2. Rotate `ADMIN_API_KEY` — generated in the same session window as the leak, cannot be assumed uncompromised.
3. Audit VPS `.env` for which Class B keys are actually present. If `SOLANA_PRIVATE_KEY` or `EVM_PRIVATE_KEY` is live, treat every existing signed tx as "the key could have been exposed if any other secret in that env file ever leaked" — these are the blast-radius cases.
4. Delete `TREASURY_SWEEP_WALLET` from `.env`.
5. Confirm `PLATFORM_SIGNING_SECRET` is unique to production and not shared with any dev or staging environment. A shared signing seed means every dev machine is a forgery vector.
6. Ship `@soma/secret-scanner` (P0.2) before building anything else — the leak that triggered this whole design would have been caught by the scanner, and the next one will be too.
7. Add the Soma purity CI grep check (`/clawnet|cn-[a-f0-9]|clawapis/i` against `Soma/src/**`) so nothing regresses while the primitive is being built.

---

## 13. Research revision pass — 2026-04-10

After the first draft of this document, a targeted research pass against production key-rotation systems surfaced flaws that change the invariant list and the default TTL. This section records what changed and why. It supersedes any conflicting language earlier in the document; when in doubt, this section wins.

### 13a. Twelve golden ideas adopted

1. **KERI pre-rotation.** Every rotation event publishes the hash of the next Tier 1 public key, not just the current one. An attacker who reveals or captures the current session key learns nothing about its successor. Digest-based, so post-quantum secure by default. GLEIF vLEI runs this in production. Becomes invariant 9.
2. **Teleport 5-phase CA rotation state machine.** `init → update_verifiers → promote → update_producers → standby → revoked`. A rotation is not complete until phase 4 with positive verifier acknowledgment. Prevents the Cloudflare R2 failure mode (see 13c).
3. **Tink "primary vs. accepted" keyset model.** At any instant a backend holds exactly one *primary* Tier 1 (mints signatures) and zero-or-more *accepted* Tier 1s (verifies incoming signatures, does not mint). This is the concrete implementation of the overlap window the original draft hand-waved.
4. **Sigstore Fulcio "if TTL is short enough, revocation is optional".** Fulcio issues 10-minute certificates and does not support revocation. The lesson is to push TTL so low that revocation becomes an optimization rather than a correctness requirement. Default Tier 1 TTL shrinks from 1 hour to 10 minutes (see D7 below).
5. **OAuth 2.1 / RFC 9700 refresh-token family reuse detection.** The Tier 0 → Tier 1 mint is analogous to an OAuth refresh exchange. Rule: single-use minting credential; any replay revokes the entire family and forces re-bootstrap from threshold. Solves replay-across-rotations without any side-channel detection.
6. **Certificate Transparency tile logs with witness cosignatures.** Rotation log stored as tiles; independent witnesses cosign tile roots; consumers sample witnesses to detect log forks. Chrome is completing CT migration to static-CT-API by end of 2025. Fork detection comes for free.
7. **Signal SPQR ratchet state (post-compromise security).** This is the architecturally largest change. Pure HKDF derivation from Tier 0 has *zero* post-compromise security: once Tier 0 leaks, every future Tier 1 derived from it is predictable. Signal solved this with durable ratchet state that mixes fresh entropy into each derivation. Adapted for our case:
   ```
   Tier1_n = HKDF(Tier0, ratchet_state_n, info, salt)
   ratchet_state_n = HKDF(ratchet_state_{n-1}, ephemeral_random_n)
   ```
   The ephemeral random is published to the rotation log (it is not secret). Even if Tier 0 leaks, the attacker needs *both* Tier 0 and the durable ratchet state to derive `Tier1_{n+1}`. Ratchet state is anchored in the pulse tree so it is recoverable from the log, not just from Tier 0. Becomes invariant 10.
8. **Macaroon-shaped Tier 1 credentials with attenuable caveats.** A Tier 1 is not a bare bearer token; it is a macaroon with baseline caveats (`validFrom`, `validUntil`, `allowedTargets`, `allowedSelectors`) that the holder can further attenuate before delegating. Attenuation is cryptographically one-way, so a leaked attenuated token cannot escalate. Fly.io has run macaroons in production for years. This also gives first-class capability delegation, matching the multi-agent primitives roadmap.
9. **Node secure memory discipline.** Use `crypto.createSecretKey()` / `KeyObject` for Tier 0 seed material, not raw `Buffer`. `KeyObject` instances sit in OpenSSL-managed memory and are not subject to JS GC sampling. `.fill(0)` every intermediate buffer. Ship systemd with `LimitCORE=0`, and `ulimit -c 0` in the deploy script. Fresh CVEs (CVE-2025-55131, uninitialized memory) show this remains a real attack surface in Node today.
10. **Kill the legacy path in the same commit — SLSA / axios 2026 lesson.** When migrating `checkApiKey` to the rotation primitive, the old static `cn-…` path must be deleted from the code in the same commit, not hidden behind a feature flag. The axios compromise of March 2026 (83M weekly downloads, full supply-chain RAT) happened despite SLSA Level 2 provenance because a single legacy classic token bypassed every new cryptographic control. A dual-path regime is an active attack surface. Becomes invariant 11.
11. **Verify-before-revoke — Cloudflare R2 March 2025 lesson.** The R2 incident (1h 7min outage; 100% writes, 35% reads failed) occurred because rotation deleted old credentials before verifying the new credentials had propagated to the gateway service. Revocation of an old Tier 1 must require either (a) explicit propagation ack from every subscribed verifier or (b) elapsed grace TTL. If neither condition is met, rotation fails closed into "old key stays in accepted state" rather than proceeding to revoke. Becomes invariant 12.
12. **Panic freeze quorum.** The single-trigger panic freeze from the original draft is a DoS weapon. Require M-of-N operator signatures for freeze, with automatic lift after 4 hours and loud alarms at 1, 2, 3, and 3.5 hours. Tightens invariant 4 (which previously allowed single-operator freeze).

### 13b. Ten flaws in the first-draft architecture

| # | Flaw | Fix |
|---|---|---|
| 1 | No post-compromise security (pure HKDF is predictable once Tier 0 leaks) | Invariant 10 — ratchet state |
| 2 | No pre-rotation commitment (KERI-vulnerable) | Invariant 9 — pre-rotation |
| 3 | No verification gate before revoke (Cloudflare R2 pattern) | Invariant 12 — verify before revoke |
| 4 | Single-phase rotation (production shape is 5-phase) | Teleport state machine |
| 5 | No log fork detection (consumers trust issuer's head blindly) | CT tile log + independent witnesses |
| 6 | Legacy path coexistence (would repeat axios) | Invariant 11 — no legacy path |
| 7 | Panic freeze is DoS-able | Quorum + auto-lift |
| 8 | Naive secret memory handling in Node | KeyObject + LimitCORE + fill(0) discipline |
| 9 | 1-hour TTL default is 6× too long | Default 10 minutes (D7) |
| 10 | Tier 1 as bare bearer token is wrong shape | Macaroon with attenuable caveats |

### 13c. Twelve invariants (supersedes the earlier list of eight)

1. **Threshold mandatory for Tier 0.** No single party can reconstruct the Tier 0 seed. FROST or Pedersen VSS, minimum t=2 of n=3.
2. **Session credentials always derived, never imported.** A Tier 1 that was not produced by the controller is not a valid Tier 1.
3. **Rotation events anchored before effect.** A Tier 1 does not become primary until its rotation event is anchored in the log and the log head is published.
4. **Panic freeze requires M-of-N quorum.** Single-party freeze is forbidden. Freeze auto-lifts after 4 hours with alarms; intentional extended freeze requires re-quorum.
5. **Proof-of-possession mandatory per use.** Every request using a Tier 1 carries a fresh signature over `(nonce, timestamp, request_digest, session_key_id, heartbeat_index)`. Replay across rotations is detectable by verifying the session_key_id is still accepted at the witnessed timestamp.
6. **Backends come from a signed allowlist in the birth certificate.** A heart's birth cert enumerates which backends it will ever use. Adding a backend is a protocol event, not a config change.
7. **Backends are isolated.** Zero cross-backend code knowledge. A custody backend cannot read the API-key backend's state and vice versa.
8. **Challenge period for destructive operations.** Default 1 hour. Operator can tighten per-deployment but cannot disable. Applies to revocation, freeze-extension, and policy-widening operations.
9. **Pre-rotation.** Every rotation event commits to the hash of the next Tier 1 public key. Validators replay rotation events to verify the chain. A skipped rotation is a protocol violation.
10. **Post-compromise security via durable ratchet state.** Tier 1 derivation mixes in ratchet state anchored in the pulse tree. An attacker who captures Tier 0 at time t can derive Tier 1s at times ≤ t but cannot derive Tier 1 at t+1 without also holding the log-anchored ratchet state at time t.
11. **No legacy path.** When rotation lands for a credential surface, the old static auth path is deleted from the code in the same commit, not flagged off. Coexistence is forbidden.
12. **Verify before revoke.** Revocation of an old Tier 1 requires positive propagation ack from all subscribed verifiers *or* elapsed grace TTL. Fails closed: stays in accepted state on verification failure rather than proceeding to revoke.

### 13d. New open decisions

**D6 — Ratchet state durability.** The ratchet state is load-bearing for post-compromise security. Losing it (VPS wipe, DB corruption) breaks the chain and forces re-bootstrap from Tier 0 threshold. Is that acceptable, or do we need off-site ratchet backups? **Lean:** acceptable. Losing ratchet state is functionally equivalent to losing Tier 0, and the threshold shards are already the backup story. Double-backing-up the ratchet state just doubles the exfiltration surface.

**D7 — Default TTL.** Fulcio = 10 min. Cloudflare Access service tokens = 1 year. Our answer per class:
- **Class A (Soma-native, our own credentials):** default 10 minutes. Cross-service propagation for Pulse/ClawNet is cheap enough at this TTL given that the mint path is a single HTTP round trip.
- **Class B (custody keys):** default 1 hour. On-chain rotation is expensive enough (gas, EAS attestation) that 10 minutes would cost more than the blast radius saved.
- **Class C (third-party vaulted where we cannot mint):** default 24 hours for TTL alarms. We cannot mint these, only alarm on staleness.
Operator can override per-identity row, never below a minimum floor of 1 minute.

### 13e. Research sources

Adopted patterns come from:

- KERI pre-rotation: [KID0005 commentary](https://identity.foundation/keri/kids/kid0005Comment.html), [security Q&A](https://identity.foundation/keri/docs/Q-and-A-Security.html)
- Tink keyset handles: [rotation docs](https://developers.google.com/tink/managing-key-rotation), [keyset design](https://developers.google.com/tink/design/keysets)
- Certificate Transparency tile logs: [2025 roadmap](https://blog.transparency.dev/what-2025-holds-for-certificate-transparency-and-the-transparencydev-ecosystem)
- Teleport 5-phase CA rotation: [rotation docs](https://goteleport.com/docs/zero-trust-access/management/security/ca-rotation/), [short-lived certificates](https://goteleport.com/learn/infrastructure-identity/what-are-short-lived-certificates/)
- TLS 1.3 Extended Key Update: [draft-ietf-tls-extended-key-update-11](https://datatracker.ietf.org/doc/draft-ietf-tls-extended-key-update/)
- Macaroons: [Fly.io operationalizing](https://fly.io/blog/operationalizing-macaroons/), [Fly.io escalated quickly postmortem](https://fly.io/blog/macaroons-escalated-quickly/)
- Node secure memory: [Node.js issue #30956](https://github.com/nodejs/node/issues/30956), [CVE-2025-55131](https://www.indusface.com/blog/cve-2025-55131-uninitialized-memory-vulnerability/)
- Sigstore Fulcio: [security model](https://github.com/sigstore/fulcio/blob/main/docs/security-model.md), [Sigstore security](https://docs.sigstore.dev/about/security/)
- Axios March 2026 supply chain: [analysis](https://earezki.com/ai-news/2026-04-04-npm-provenance-and-slsa-the-supply-chain-hygiene-baseline-every-team-needs-in-2026/), [Elastic Security Labs](https://www.elastic.co/security-labs/axios-one-rat-to-rule-them-all)
- Signal SPQR: [blog](https://signal.org/blog/spqr/), [NIST PQC slides](https://csrc.nist.gov/csrc/media/events/2025/sixth-pqc-standardization-conference/post-quantum%20ratcheting%20for%20signal.pdf)
- OAuth 2.1 / RFC 9700 family reuse detection: [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html), [WorkOS summary](https://workos.com/blog/oauth-best-practices)
- Cloudflare R2 rotation incident March 2025: [postmortem](https://blog.cloudflare.com/cloudflare-incident-march-21-2025/), [Oasis analysis](https://www.oasis.security/blog/dont-look-back-in-anger-how-cloudflares-outage-highlights-the-need-for-safer-rotations)

---

## 12. Next steps

In order, after ratification:

1. Finish P0.3 deep audits in Soma (Bonus tweetnacl→node:crypto, Deep-1 constant-time Shamir, Deep-2 birth cert parent hash) — these are prerequisites for the new primitive.
2. Delete `src/heart/key-rotation.ts` (no wiring to break).
3. Implement `src/heart/credential-rotation.ts` with the eight invariants and the `CredentialBackend` interface.
4. Implement the Ed25519 identity backend in Soma as the reference.
5. Write the CI grep check for ClawNet-in-Soma. Add `Soma/ARCHITECTURE.md` purity rule.
6. Implement `claw-net/src/core/api-key-rotation.ts` against the Soma interface.
7. Migrate `checkApiKey` middleware in ClawNet to the new backend.
8. Cut over a test account first, then the live `cn-...` keys behind a flag.
9. Once stable, start `@soma/evm-backend` as the second real consumer.

### 9a. Cutover addendum — shadow-adopt-cutover sequence (2026-04-11)

The "single-commit cutover" framing in step 7 above turned out to be
too aggressive once the `ClawNetApiKeyBackend` shipped and we actually
read `src/middleware/auth.ts` end-to-end. The existing middleware
resolves a lot more per-request than just "is this key valid": it
reads `api_keys.email / credits / credits_used / amount_paid`, resolves
`getDelegationInfo` for parent/child sub-keys with spend limits and
budget counters, loads `getProviderForApiKey` for provider-scoped keys,
and enforces `getHardBudgetLock` with monthly spend. The rotation
backend only knows `{identityId, expiresAt}`. A single-commit cutover
would either lose all of that billing context or require a monster
migration with real risk to live customer billing.

Revised sequence, preserving invariant 11 (no legacy path) at the
**end state** without a reckless flip:

**Phase 1 — Shadow adoption (safe, reversible).**
- New table `api_key_rotation_adoptions` joining `api_keys.key` →
  rotation `identityId`.
- New admin route `POST /v1/admin/rotation/adopt` that takes an
  existing `cn-...` key, creates a Soma identity for it, and incepts
  a rotation credential whose bearer is the existing key string.
- `checkApiKey` gains a *shadow check*: when an adopted key comes in
  it ALSO calls `backend.lookupByBearer()` and logs any disagreement
  with the legacy path. Legacy path still wins every decision.
- Metrics counters for shadow agreements / disagreements.
- Run against own (operator) keys for a few days, confirm zero
  divergence under real traffic.

**Phase 2 — Authoritative adoption (one key at a time).**
- Flip a per-key flag: for adopted keys, the rotation backend becomes
  authoritative for identity lookup; `api_keys` row becomes
  billing-only context (credits, delegation, provider scope).
- Requires extending `lookupByBearer` (or a join helper) to return
  the billing context as well, without leaking ClawNet types back
  into Soma — the join lives in claw-net, not in soma-heart.
- Rollback per-key is still possible by clearing the flag.

**Phase 3 — Legacy deletion (invariant 11 satisfied).**
- Once 100% of live keys are adopted and authoritative for some
  cooling period, delete the legacy static-key code path from
  `checkApiKey` in a single commit. This is the "kill the legacy
  path" commit invariant 11 requires — it just lands at the end of
  the sequence, not the start.

The vision behind why this sequence is worth the extra steps rather
than a rip-and-replace is in `soma-rotation-controller-vision.md`.

Everything in this doc is proposal-grade until the user ratifies the twelve invariants (§13c) and the seven open decisions (§10 D1–D5, §13d D6–D7). Once ratified, the doc becomes the spec and the build follows. See §14 for the ratified locks.

---

## 14. Ratified decisions — 2026-04-10

All seven open decisions are locked as follows. Each lock records the choice, the rationale for "safest and best," and any operator hooks that remain configurable.

### D1 — Tier 0 threshold protocol

**Lock:** FROST Ed25519 (RFC 9591) for the identity backend. Secp256k1 threshold deferred to the future EVM custody backend and not in scope for MVP.

**Why:**
- Soma is Ed25519-native everywhere — identity DIDs, birth certs, heartbeats, key-escrow. FROST produces signatures that are byte-for-byte indistinguishable from single-signer Ed25519, so every existing verifier keeps working with zero changes.
- RFC 9591 is IETF-final; no moving target.
- Known DoS-via-malicious-coordinator mitigated by the existing assumption of authenticated transport between heart processes.
- Invariant 7 (backend isolation) keeps the future EVM backend's secp256k1 threshold choice from polluting the identity layer.

**Deferred:** when the EVM custody backend ships, pick between DKLs23, CGGMP21, or Pedersen-VSS on its own merits. Not blocking MVP.

### D2 — Default challenge period for destructive operations

**Lock:** 1 hour default. Hard floor 15 minutes (operator cannot shrink below). Operator can lengthen freely.

**Why:**
- Sits above realistic alert-delivery latency (PagerDuty + human wake-up can easily eat 5–10 minutes).
- Matches industry norms: GitHub branch protection override ≈ 1h, Vault sealed-unseal re-auth ≈ 1h.
- 24h gives a compromised operator a full day of unblocked mischief; 15m makes on-call humanly unrealistic; 1h is the Goldilocks point.
- The hard floor prevents a compromised config push from setting the period to zero.

**Applies to:** revocation, freeze-extension, policy-widening, allowlist additions.

### D3 — Default rotation rate limit

**Lock:** 10/hour per identity, token-bucket with burst of 3. Operator override per-identity allowed, minimum 2/hour.

**Why:**
- Class A TTL is 10 minutes → organic baseline is 6 rotations/hour/identity. 10/hour gives ~40% headroom for retries and staggered rekeys.
- 5/hour would break normal operation.
- 30/hour opens a rotation-flap DoS that exhausts threshold signer availability.
- The 2/hour floor preserves the invariant even under operator misconfiguration.

### D4 — ClawNet panic shard policy

**Lock:** bootstrap default is (a) user alone across three personal devices. The `bootstrap()` API writes a 90-day calendar reminder to upgrade to (c) time-locked secondary threshold. No forced action — a single-operator deployment must not be able to lock itself out.

**Why:**
- (c) is the correct long-term answer, but it is a pure-software upgrade that can land later without breaking bootstrap.
- (b) requires a trusted second party we do not have in 2026-04.
- (a) ships today with single-operator control and documented upgrade path.
- The 90-day reminder is a nag, not a freeze: forcing action on a single-operator deployment creates its own lockout risk (user away from all devices on day 91).

**Operator-visible:** the primitive exposes `reconfigurePanicShards(newPolicy)` which takes the system through a rotation event, so the upgrade from (a) to (c) is a protocol-level operation with full auditability.

### D5 — Existing `src/heart/key-rotation.ts`

**Lock (revised 2026-04-10 after code audit):** retain `KeyHistory` as the internal KERI pre-rotation log primitive; demote it from a user-facing API to an internal building block that the `ed25519-identity` backend wraps. The `CredentialRotationController` becomes the only user-facing rotation API.

**Why the revision:**
- Pre-ratification the assumption was "no runtime callers." Actual audit shows `KeyHistory` is re-exported from `src/heart/index.ts`, has a live test suite (`tests/heart/key-rotation.test.ts`), an attack test (`tests/attacks/07-stolen-key-rotation.test.ts`), a benchmark, an example, and public documentation. Deleting it on day one would break all of the above without replacing their functionality, because the new controller sits at a higher level of abstraction (backends, TTLs, challenge periods) and doesn't reimplement the underlying chain semantics.
- The KERI pre-rotation primitive in `KeyHistory` is exactly the shape we need underneath the `ed25519-identity` backend. Re-implementing it would introduce a second chain format for no benefit.
- Invariant 11 (no legacy path) is preserved at the level that matters: after the controller lands, no user-facing rotation call goes through `KeyHistory` directly. The `heart/index.ts` re-export is removed as part of the controller commit, so `KeyHistory` becomes a private implementation detail reachable only via the backend.

**Migration rule:** `KeyHistory` is *not* deleted but *sealed* — removed from the `src/heart/index.ts` barrel, its tests kept as unit tests of the internal primitive, its example and bench updated to go through the new controller in a follow-up commit. Any future rotation change lands in the controller, never in `KeyHistory` directly.

### D6 — Ratchet state durability

**Lock:** no off-site ratchet backup. Losing ratchet state forces re-bootstrap via Tier 0 threshold, and this is the documented recovery procedure.

**Why:**
- Invariant 10 says a captured Tier 0 plus a captured ratchet state breaks post-compromise security. Backing the ratchet state off-site doubles the exfiltration surface and degrades invariant 10 to exactly "threshold Tier 0 alone" — the whole ratchet buys nothing.
- Recovery is already solved: the ratchet state is reconstructible from replaying the anchored rotation-event log plus a live-only ephemeral. If both are lost, the correct response is Tier 0 threshold re-bootstrap, which is the same procedure used for any total-compromise event.
- There is no scenario where "ratchet backup" is right but "threshold re-bootstrap" is wrong.

**Operator-visible:** `recoverFromRatchetLoss()` is an alias for the standard threshold re-bootstrap flow, so the incident runbook has one entry point.

### D7 — Default TTL per credential class

**Lock:**
| Class | Description | Default TTL | Floor |
|-------|-------------|-------------|-------|
| A | Soma-native mint path (heart identity sessions, internal API keys) | **10 minutes** | 1 minute |
| B | Custody keys anchored on-chain (EVM, Solana) | **1 hour** | 5 minutes |
| C | Third-party secrets we cannot mint (Clerk, Stripe, OpenAI) | **24 hours** (alarm-only) | 1 hour |

**Why:**
- Class A matches Fulcio's 10-minute cert lifetime — industry reference for short-lived credentials with cheap mint paths. Mint is one HTTP round trip so cross-service propagation is affordable at this TTL.
- Class B TTL is governed by anchoring cost. Gas + EAS attestation per rotation makes 10-minute rotation uneconomical, and the blast-radius delta between 10m and 1h is small because custody operations already go through a separate attestation path that catches exfiltration within minutes.
- Class C is not rotated by the primitive — we cannot mint these credentials — so the TTL is an *alarm threshold*. At 24h without a fresh observation, the primitive pages the operator.
- The per-class floors prevent an operator from setting TTL = 0 (which would break the mint loop) or degrading Class C alarms below daily granularity.

**Operator-visible:** each identity row can override its default TTL within its class, never below its class floor.

---

### Additional locks from the same pass

Three implementation details that came up during the D1–D7 brainstorm and that the spec must pin before code lands:

**L1 — Pre-rotation commitment content.** Every rotation event commits to `sha256(nextPublicKey || nextAlgorithmSuite || nextBackendId)`, not just `nextPublicKey`. Binding the full "next credential manifest" closes a cross-suite confusion attack where an adversary who obtains one future private key could reuse its pubkey under a different suite or backend.

**L2 — Rotation event signing authority.** Rotation events are signed under the **old** Tier 1 key (matching KERI's "prior key authorizes the next" semantics). The new key only signs its first proof-of-possession, which is recorded alongside the event. This makes rotation events verifiable by anyone who has seen the previous event in the chain, without needing the new key to be known in advance.

**L3 — Anchor order.** A rotation event becomes effective only after `(a)` it is written to the local rotation log, `(b)` its hash is published in the next pulse-tree root, `(c)` the pulse tree is witnessed by at least one external observer. Until all three, the old Tier 1 remains primary. This is verify-before-revoke (invariant 12) made concrete.

With D1–D7 and L1–L3 locked, the spec is frozen and the build can start. The benchmark suite we run at the end of the first implementation will be measured against exactly these numbers.
