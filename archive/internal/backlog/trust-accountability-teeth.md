# Soma Trust Accountability — Putting Teeth in the System

Status: **backlog / design** — not yet built. Foundational for Soma 1.2.
Opened: 2026-04-10
Related: `soma-1-2-scope.md`, `soma-1-2-adversarial-pressure-test.md`, `trust-mining-economy.md`, `soma-trust-salvage-from-aid.md`, `wallet-rotation-architecture.md`, `rating.md`, Soma `src/heart/delegation.ts`

## The missing loop

Soma 1.1 shipped delegation, step-up, and caveats. An agent can be given a capability, can prove it's still authorized, and can be stopped at invocation time. **But nothing in 1.1 punishes an agent that does bad work.** A compromised or malicious agent can burn a credential until its TTL expires, and the only consequences are whatever the caveats statically blocked.

This is a gap with real cost: without a feedback loop from *outcome* to *future authority*, Soma has **no teeth.** Trust becomes a one-way ratchet — easy to grant, impossible to lose.

The loop we're missing:

```
action → outcome → signed reception receipt → score update → future delegation gating
```

Every arrow needs a primitive. 1.1 only has the first.

## The primitives we need

### 1. Reception receipt (`src/heart/reception-receipt.ts`)

A signed rating over an action digest, issued by someone other than the agent who did the work.

```typescript
interface ReceptionReceipt {
  protocol: 'soma-receipt/1';
  actionDigest: string;      // hash of the action being rated
  agentDid: string;          // who did the work
  ratedBy: string;           // did of the rater
  outcome: 'success' | 'partial' | 'failed' | 'harmful';
  severity: number;          // 0..1 — how load-bearing was this action
  evidence: string;          // opaque hash or URI pointing to proof
  ratedAt: number;
  signature: string;         // ratedBy signs over canonical(receipt minus signature)
}
```

Receipts are not the agent rating themselves. They come from an independent party: either the buyer who paid for the work, or a verification service the buyer delegated to (see `soma-1-2-scope.md` for buyer-paid verification market).

### 2. Outcome log (`src/heart/outcome-log.ts`)

Append-only hash-chained log of reception receipts, mirroring the pattern already shipped in `src/heart/revocation-log.ts`. Each agent's heart maintains its own outcome log; heads are gossipable and anchorable.

Critical property: **the outcome log is public.** Anyone can recompute an agent's score from the log, which means any claim the reputation aggregator makes is falsifiable by replay. This is the answer to the "who audits the auditor" question in `rating.md` — deterministic recomputation from a public log means no auditor can lie silently.

### 3. Reputation aggregator (`src/heart/reputation-aggregator.ts`)

Pure function: `(OutcomeLog, now) → TrustScore`. Deterministic, bounded, replayable. No hidden state, no ML, no black box — the score is a named formula so a reviewer can argue with it.

Starting formula (deliberately simple):

```
score = weighted_success_rate(last_N_receipts)
      * time_decay(most_recent_receipt_age)
      * severity_weight(mean_severity)
      - harmful_penalty(count_of_harmful_in_window)
```

All parameters public, all receipts public, all computations reproducible.

### 4. Verifier registry (`src/heart/verifier-registry.ts`)

Not every DID can rate every agent. The verifier registry tracks which verifiers are trusted for which capability classes. A verifier is itself scored by an outcome log — **it's turtles, but they terminate** because the buyer is the ultimate rater of "did this verification actually save me from bad work." See `soma-1-2-scope.md` for how this avoids infinite regress.

## New caveats that use the loop

Once the primitives exist, delegation gets real teeth via new caveats (full scope in `soma-1-2-scope.md`):

- `min-trust-score` — refuses invocation unless the agent's score is above N.
- `max-recent-failures` — refuses invocation if the outcome log shows more than K failures in window W.
- `requires-verification` — every invocation triggers an async verification callout whose receipt lands in the outcome log.

## Walkthrough: VPS deploy with teeth

This is what accountability looks like mechanically. Imagine Alice delegates `ssh:exec` to worker agent Bob to do a deploy.

**Setup.**
```
Alice → Bob
capabilities: ["ssh:exec"]
caveats:
  - host-allowlist: ["deploy.clawnet.app"]
  - command-allowlist: [prefix: ["git", "pull"], prefix: ["npm", "run", "build"]]
  - min-trust-score: 0.7
  - requires-verification:
      verifierDid: did:key:zNova
      verificationCapability: tool:verify:deploy
      mode: async
  - expires-at: 1h
```

**Happy path.** Bob runs the deploy, actions produce heartbeats, heartbeats get anchored. Nova (verifier) recomputes the expected effect of each action against the live VPS state and signs a reception receipt marking each action `success`. The receipts land in Bob's outcome log. Bob's score stays at 0.95. Next deploy Alice hands him, the `min-trust-score` caveat passes.

**Sad path.** Bob was compromised. He runs `git pull` fine, then runs `npm run build` but also tries to exfiltrate `.env`. Nova's verifier inspects post-state, detects an unexpected read, and signs a `harmful` receipt with severity 0.9. The outcome log appends it; the reputation aggregator drops Bob's score to 0.4. Alice's *next* delegation to Bob (or to anyone using Bob's DID) fails the `min-trust-score` caveat. Bob is effectively fired by math.

**Edge: Bob tries to drop the bad receipt.** Can't. Outcome log is hash-chained and heads are gossiped. Omitting a receipt changes the head hash; any observer with the receipt can challenge. Bob cannot rewrite history without being caught.

**Edge: Nova tries to favor Bob.** Can't silently — the verification is deterministic and the evidence hash is in the receipt. Any third party can rerun the verification from the evidence and produce a counter-receipt that contradicts Nova's. Nova's own verifier score drops in its own outcome log. The market rates verifiers that lie.

## What this does NOT solve

- **Pre-reputation cold start.** A fresh agent has no history; `min-trust-score` can't gate them without some bootstrap (conservative defaults, a grace delegation with `requires-stepup` on every action, or a human approval per action for the first N runs).
- **Buyer-verifier collusion (the big one).** If the buyer commissions the verifier and the verifier rubber-stamps, the slashing signal is itself another receipt — recursive, no ground truth. **The real defense is a continuously-funded public-goods disputer that independently recomputes high-value mined blocks and slashes verifiers who signed bad receipts.** This must be funded at protocol level (see `soma-1-2-scope.md` D4 — mandatory disputer funded by L7.5 non-governable fee) because the buyer won't pay for it and the verifier has anti-incentive to fund it. 1.3 also ships multi-verifier quorum caveats, but the disputer is the mandatory circuit breaker, not the quorum.
- **Outcome log head equivocation.** Nothing in the current design forces a heart to publish the same outcome log head to every observer. A ClawNet-hosted heart could publish head A to Alice and head B to Bob, serving a different history to each. Current defense is "sense observers as separate parties" which is advisory, not enforced. Real defense is protocol-level slashing on caught equivocation, with outcome log heads anchored to a neutral clock (L1 beacon or Base block hash) before any mined block can cite them. **Undesigned as of 2026-04-11** — see `soma-1-2-adversarial-pressure-test.md` Perspective 1 for the full attack description and `trust-mining-economy.md` "Outcome log head anchoring" for the proposed fix on the mining side.
- **Fault attribution in reception receipts.** Current `ReceptionReceipt.outcome` is one of `success/partial/failed/harmful` — but it doesn't say *whose fault*. If I call a tool and the tool returns malformed data and I surface it correctly, the outcome is judged bad and my score drops — wrongly. Receipts need a `fault_attribution: 'agent' | 'tool' | 'upstream' | 'unknown'` field so downstream flake doesn't silently reputation-cost the calling agent. **Undesigned as of 2026-04-11** — add to the `ReceptionReceipt` interface before Phase 1 locks the wire format.
- **Verifier collusion at scale below disputer coverage.** For low-value mined blocks below the disputer's coverage threshold, collusion remains undetected. Mitigation: multi-verifier quorum caveats in 1.3, deterministic recomputation for high-stakes work.
- **Privacy of the outcome log.** Public logs leak behavioral patterns. Future work: selective-disclosure proofs over outcome logs (zk-friendly score derivation). Near-term partial mitigation for mined blocks: opt-in pseudonymous `requestingDid` — see `trust-mining-economy.md` for the proposed field.
- **Faked evidence.** A verifier is only as good as the evidence it inspects. For VPS work, that means TEE-attested post-state snapshots. For content generation, that means content-addressed inputs and outputs. Domain-specific.
- **Security-through-obscurity leaks.** Per-category decay constants, aggregator `formulaVersion` thresholds, and Reporter Independence Scoring formula parameters (salvaged concept 4) are each places where "the attacker doesn't know the number" silently creeps back. Every such parameter must be either deterministic over public data or documented as a public parameter the attacker can optimize against. See memory `feedback_soma_open_source_threat_model`.

## Build order

1. `reception-receipt.ts` — types, canonical signing, verification. Small, self-contained.
2. `outcome-log.ts` — clone of `revocation-log.ts` structure, append-only, hash-chained, tamper-evident tests.
3. `reputation-aggregator.ts` — pure function, fully tested with fixture logs.
4. `verifier-registry.ts` — track trusted verifiers per capability class.
5. New caveats in `delegation.ts`: `min-trust-score`, `max-recent-failures`, `requires-verification`.
6. Spec bump to `soma-capabilities/1.2`.
7. Reference verifier implementation (Nova) — see `soma-1-2-scope.md`.
8. First production test: ClawNet + Nova walkthrough from the "sad path" above, but with a test agent.
