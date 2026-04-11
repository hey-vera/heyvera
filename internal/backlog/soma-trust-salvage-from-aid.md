# Salvage From AID-Era Trust Files

Status: **backlog / design notes** — ideas extracted before deletion, not yet build work.
Opened: 2026-04-11
Related: `soma-1-2-scope.md`, `trust-accountability-teeth.md`, `moat-compounding-thesis.md`, memory `feedback_wiring_discipline`

## Why this doc exists

Before deleting `src/core/{trust-delegation, trust-import, trust-scoring-v2, trust-scoring-v11, seasons, trust-decay-cron}.ts` and `src/utils/agentkit-bridge.ts` as dead AID-era code, extracting six concepts worth porting to Soma 1.2+ reputation-aggregator and cold-start design. The *implementations* were all broken (fake signatures, dead columns, never wired — see `feedback_wiring_discipline`). The *concepts* below are salvageable and should feed the Soma 1.2 build.

## 1. Per-category decay periods

From `trust-decay-cron.ts`. Generic time decay is too coarse — a DeFi agent silent for 7 days is dangerous, a rare-use verifier silent for 30 days is normal. Proposed periods:

| Capability class | Decay period |
|---|---|
| DeFi / trading / money movement | 7 days |
| Data feeds / oracles | 14 days |
| General agent work | 30 days |
| Rare-use verifiers / human-gated tools | 90 days |

Soma's planned `reputation-aggregator.ts` currently has a single `time_decay(most_recent_receipt_age)` function. Upgrade: decay period is a function of the capability class (already indexed in `verifier-registry.ts`). Same formula, class-aware constants.

Tagline worth keeping: *"Trust is a gravity well — the score wants to decay, and holding it up requires constant energy (successful receipts)."*

## 2. Progressive weight rebalancing by protocol phase

From `trust-scoring-v2.ts`. The aggregator formula weights should change as the ecosystem matures:

- Phase 1-2 (bootstrap): behavioral 65%, community 35%, no market layer
- Phase 3 (early market): behavioral 60%, community 25%, market 15%
- Phase 4+ (mature): behavioral 50%, market 30%, community 20%

Rationale: early on, market signals are noisy (low volume = easy to manipulate). As volume grows, market signals become more reliable and should carry more weight. Hardcoding phase-specific weights is crude; a smoother version is `market_weight = f(ecosystem_volume)`, clamped by a floor and ceiling.

Should appear in `reputation-aggregator.ts` as named `formulaVersion`s: `v1-bootstrap`, `v2-early-market`, `v3-mature`. Each is an immutable named function so old receipts remain replayable under the formula that was active when they were rated.

## 3. Recency-weighted success rate

From `trust-scoring-v11.ts`. Instead of a single time-decay multiplier, split success rate into two windows:

```
recentSuccessRate = successes in last 30d / total in last 30d
historicalSuccessRate = all-time successes / all-time total
reported = recent * 0.6 + historical * 0.4
```

Already implicit in Soma's planned `time_decay(most_recent_receipt_age)`, but the explicit two-window split is more explainable and auditable. A score consumer can see "recent diverging from historical" → agent is degrading or improving, at a glance. Both windows are deterministic functions of the outcome log, so replayability is preserved.

## 4. Reporter Independence Scoring (anti-Sybil among raters)

From `trust-scoring-v11.ts`. A Sybil defense for the receipt *side* — raters themselves can collude. Each reporter's independence is penalized by:

- **creationTime correlation** — raters created in a narrow window relative to each other
- **sharedCounterparties** — raters whose transaction partners overlap heavily
- **behavioralCorrelation** — raters whose on-chain behavior tracks too closely
- **directTransaction** — rater previously transacted with the ratee (reduces independence weight)

Effective weight of a receipt cluster = `sum(independence_score_i)`, not raw count. Ten colluding raters ≈ one independent rater.

`trust-accountability-teeth.md` v1 doesn't address this — the v1 plan assumes verifiers are already independent. Reality: a buyer-paid verification market with low barrier to entry will attract Sybil farms. This salvaged concept is the hard defense.

## 5. Parent-penalized-for-child delegation accountability

From `trust-delegation.ts`. Soma 1.1 has delegation and 1.2 adds outcome-log-driven trust. Missing piece: when a child agent misbehaves, the parent who delegated to them should take a proportional score hit.

Proposed rule:
```
parentPenalty = max(BASE_PENALTY, childPenalty * PARENT_FACTOR)
```
where `PARENT_FACTOR ≈ 0.5` and `BASE_PENALTY ≈ 5`.

Without this, delegation is one-way — Alice freely delegates to Bob and bears no consequence if Bob is garbage. The parent-penalty closes the loop and creates real incentive to only delegate to agents the parent would stake their own score on.

Implementation note: the original AID version had `penalizeParent()` as a no-op that logged but never mutated state — textbook wiring-discipline failure (see `feedback_wiring_discipline`). The Soma version must **actually append** a penalty receipt to the parent's outcome log, so the penalty is visible in the same public structure as any other receipt.

## 6. Cross-platform trust import with local-tx gating

From `trust-import.ts`. Addresses the cold-start problem (`soma-1-2-scope.md` Open Q#7). Let new agents import trust from ERC-8004, x402 payment history, or other protocols — but with strict guardrails:

- Imported trust capped at **building tier** (e.g. score 39 / no-discount tier)
- Imported trust is **inert** until the agent has completed N local transactions (N ≈ 20)
- Import proves the agent *exists on other platforms*, not that it's *factually trustworthy*

Nice asymmetry: you can onboard with a small head start, but you still have to do real work in the Soma ecosystem before the boost applies. Mitigates "import a reputation you didn't earn here" without blocking interop.

## 7. "World proves WHO, Soma proves WHETHER" — boundary framing

From `agentkit-bridge.ts`. The concept of linking a proof-of-personhood system (World ID, Civic, Orb) to Soma identity is less interesting than the **framing** of what each system provides:

- Proof-of-personhood (World ID): proves WHO authorized an action — a unique human principal
- Soma: proves WHETHER the action was any good — behavioral track record

These are orthogonal. Neither subsumes the other. A future Soma caveat could say `require World ID ∧ min-trust-score 0.7` and mean both things are enforced independently. The AID bridge implementation was ad-hoc (hardcoded `1.15x` / `1.2x` multipliers on the score); the Soma version should expose proof-of-personhood as a **pluggable caveat kind**, not a multiplier on the score. Keep the two signals clean and composable.

## What is NOT worth salvaging

- **`seasons.ts`** — 12-dimensional 30-day leaderboard competitions. Gamification, not trust infrastructure. Skip unless we specifically want a leaderboard product later.
- **All fake-signature code** — AID signed delegations with `aidHash()` instead of Ed25519. Soma 1.2 delegation already uses real signatures. Do not copy the signing pattern.
- **`aid_delegations` / `aid_trust_imports` / `aid_seasons` / `aid_agentkit_links` tables** — dead schemas. They sit unused but harmless; no migration removal needed.

## Integration path

When Soma 1.2 Phase 1 kicks off and `reputation-aggregator.ts` is written:

1. Pull concepts 1-3 into the v1 formula (per-category decay, phase-aware weights, two-window recency split).
2. Pull concept 4 into the verifier registry as an explicit `independenceScore` computed per-receipt.
3. Pull concept 5 into `delegation.ts` as a real mutation on parent outcome log.
4. Pull concept 6 into a new `trust-import.ts` in Soma (separate from the dead AID one), with the local-tx gate as a hard invariant.
5. Pull concept 7 into the caveat type system as a new caveat kind `requires-personhood`.

Once that's done, this salvage doc can be archived — it exists only to carry ideas across the deletion.
