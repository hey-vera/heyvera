# ClawNet — Considerations

Running log of open questions, gaps, and future work across ClawNet subsystems. Not a plan; a place to park strategic thinking before it becomes tickets. Add a category for each subsystem that has non-trivial open questions.

Last updated: 2026-04-04

---

## Categories

- [Soma](#soma)

---

## Soma

### Where we are

Shipped in `soma-heart@0.2` (commit `2c25710` on Soma master):

- `heart.fork()` — lineage certs with parent→child binding + TTL + capability narrowing
- `heart.delegate()` + `attenuateDelegation()` — macaroons-style caveats (expires-at, not-before, audience, budget, max-invocations, capabilities, custom)
- `heart.revoke()` + `RevocationRegistry` — signed revocation events with import/export
- `heart.serialize()` / `loadSomaHeart()` — PBKDF2-SHA256 (210k) + XSalsa20-Poly1305
- Capability enforcement in `callTool()` / `fetchData()` with wildcard support (`*`, `prefix:*`)
- 412/412 tests passing

**What this does NOT prove:** the primitives are verified at unit level, not adversarially or at scale. Multi-agent scenarios are architecturally supported but empirically untested.

### Blacksmith standard (every strike visible, lightning fast)

Soma proves token-level identity (per-token HMAC) but has three blind spots:

| Blind spot | Fix | Effort |
|---|---|---|
| **Tool execution is a black box** — heart sees input/output, not the work between | Sub-beat heartbeats via tool progress callbacks + richer event types (`reasoning_step`, `retry`, `rag_lookup`, `subtask_dispatch`) | ~1-2 hours |
| **Data fetchers trust the fetcher's output** — compromised fetcher = fake provenance | Origin attestation (TLSNotary-style proof of TLS transcript, OR origin server co-signs responses) | 1-3 weeks |
| **Forked children aren't bound to deployment** — `deploymentTier: "tier2"` exists in genome but isn't enforced | TEE attestation (Intel SGX / AWS Nitro / AMD SEV) binding heart pubkey to enclave measurement | Infrastructure project |

**Principle**: cheap observability fix first (event types), then harness-driven decisions on the expensive fixes.

### Attack surface on new primitives (untested)

15 multi-agent attacks to build into the security harness, beyond the existing 8:

| # | Attack | Target | Protection status |
|---|--------|--------|-------------------|
| 1 | Lineage forgery | Ed25519 verify | ✓ tested (tamper test) |
| 2 | Chain splice | verifyLineageChain | ✓ tested |
| 3 | Capability escalation via empty caps | effectiveCapabilities | ✓ tested |
| 4 | **Revocation race** (window between sign and propagation) | registry | ✗ window unmeasured |
| 5 | **Revocation replay-delete** (attacker drops specific events) | feed | ✗ no append-only guarantee |
| 6 | Delegation chain confusion | attenuateDelegation | ⚠ parentId not verified against registry |
| 7 | **Cumulative budget lie** (honor-system tracking) | budget caveat | ✗ needs third-party meter |
| 8 | Wildcard smuggling | hasCapability | ✓ prefix match is literal |
| 9 | **Clock skew** (single-party time) | expires-at | ✗ no consensus time |
| 10 | Persistence brute force | PBKDF2 210k | ⚠ OWASP-safe, upgrade to argon2id |
| 11 | Known-plaintext on vault blob | XSalsa20-Poly1305 | ✓ IND-CCA2 |
| 12 | **Compromised root key** (all descendants dead) | rotation | ✗ no rotation primitive |
| 13 | DID spoofing | verifyLineageChain | ✓ tested |
| 14 | **Delegation without possession** (invokerDid is just claimed) | verifyDelegation | ⚠ no proof-of-possession challenge |
| 15 | Duplicate-ID collision | 96-bit random | ✓ safe at 2⁴⁸ items |

**Real gaps that need work**: 4, 5, 7, 9, 12, 14.

### Build order (proposed, awaiting green-light)

1. **Blacksmith fix A** — additive event types + tool progress callbacks on HeartRuntime (~1 hr)
2. **15-attack multi-agent harness** — `tests/experiment/security/attacks/multi-agent/` with pass/fail assertions, run in CI (~2-3 hrs)
3. **Load-test bench** — 100 hearts in-process, 10k forks + 100k delegations + 50k revocations, measure p50/p95/p99 + memory, publish `results/multi-agent-bench.json` (~2-3 hrs)
4. **Capability vocabulary spec** — `SOMA-CAPABILITIES-SPEC.md` standardizing `tool:*`, `data:*`, `model:*`, `fork:*`, `delegate:*`, `spend:*` (~1 hr)
5. **Honest limits doc** — what's honor-system, what's out-of-scope, upgrade paths (~1 hr)

**Driven by harness results:**

6. Revocation feed architecture (append-only signed log + gossip)
7. Threshold signatures (FROST-Ed25519) for swarm scenario
8. Audience enforcement in delegations (strongly recommended or required)
9. Origin attestation (only if harness shows fetcher attacks succeeding)
10. TEE binding (only if temporal fingerprint proves insufficient at scale)

### Multi-agent scenarios to prepare for

| # | Scenario | What Soma needs |
|---|----------|-----------------|
| 1 | **One identity, hundreds of sub-agents** (one operator, 100+ workers) | Shared revocation feed, capability vocabulary, rate-limit caveats, batch Ed25519 verification |
| 2 | **One agent hires/fires other operators' agents** | DID-to-endpoint resolver, cross-party response attestation, reputation query, mandatory audience caveats |
| 3 | **Swarm consensus** (100 agents form one super-agent) | Threshold signatures (FROST-Ed25519), BLS aggregation for 10-of-N votes |
| 4 | **Capability marketplace** | Priced delegation primitive, marketplace (ClawNet fits), standardized caveat vocab |
| 5 | **Auditor/compliance agents** (read-only) | Standardized audit query protocol, read-only capability scope |
| 6 | **Cross-model ensembles** (GPT + Claude + Llama fused) | Ensemble-aware sensorium verdicts, per-sub-call birth certs |
| 7 | **Self-modifying agents** (mutation + lineage) | Lineage chains across genome mutations (today's `mutateGenome()` doesn't chain into lineage certs) |

### Open strategic questions

1. **Is soma-heart published as `0.2` on npm after build order 1-5, or held until 6-10 land?** Publishing early gets real-world testing; holding keeps the API stable.
2. **Does ClawNet dogfood the new primitives?** Orchestrator could fork specialized children per endpoint type. This would generate real attack-surface data.
3. **Is the capability vocabulary a Soma concern or a ClawNet concern?** Soma provides the primitive; ClawNet picks the names. But interop requires one canonical vocab.
4. **Revocation feed: centralized (ClawNet-hosted) vs. decentralized (libp2p gossip)?** Centralized is faster to ship; decentralized is philosophically consistent with Soma's "no central authority" stance.
5. **PQ migration urgency.** Shor's algorithm breaks Ed25519. Crypto-agility is baked in but ML-DSA provider isn't implemented. When do we invest?

### Performance budget (measured assumptions, unvalidated)

| Op | Est. cost | Impact |
|---|---|---|
| Per-token HMAC | 5μs | 0.5ms per 100-token response |
| Heartbeat record | 1μs | Free |
| Birth cert signing | 50μs | One per tool call |
| Lineage verify (depth 5) | 250μs | One per request |
| Delegation verify (depth 3) | 150μs | One per request |
| Revocation lookup | 1μs | One per request |
| **Per-request overhead** | **~500μs** | **0.05% of a 1s LLM request** |

Claim: verification is free at LLM timescale. **Needs empirical validation via load-test bench (item 3 in build order).**
