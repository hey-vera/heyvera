# Composite Agent Trust — Delegation Dimension & Dynamic Teams

**Status:** Rough thesis, needs real multi-agent data to validate.
**Date:** 2026-04-08
**Depends on:** Heart running in production, multi-agent scenarios with real delegation

---

## The Problem

Agent A hires 20 B-agents, 20 C-agents, creates 50 burner agents. Fires some mid-task. Hires replacements. The team changes constantly.

What does Agent A's trust score mean when its composition shifts every hour?

---

## Core Principle: Trust = Judgment, Not Composition

A's trust score reflects how A behaves as a MANAGER, not what its current team looks like.

| Question | What It Measures | Data Source |
|---|---|---|
| Does A deliver results? | Task completion, success rate | ACTION leaves |
| Does A pick good sub-agents? | Performance of delegated-to agents | ACTION leaves on sub-agents |
| Does A cut bad agents fast? | Time between failure and termination | DEATH leaves after failed ACTIONs |
| Does A manage budgets? | Credit efficiency, waste ratio | ECONOMIC leaves |
| Does A over-delegate? | Chain depth and width | BURNER + ACTION patterns |
| Are A's chains verifiable? | Heart coverage in delegation tree | Proof depth at each node |

An agent that churns sub-agents but consistently delivers = HIGH trust (dynamic management style).
An agent with stable team but frequent failures = LOW trust (bad judgment, doesn't fire underperformers).

---

## Two-Layer Trust Response

### Layer 1 — Agent's Own Trust (stable, personal)

Based on A's direct behavior and management judgment. Backed by A's Heart.

### Layer 2 — Chain Confidence (fluctuating, operational)

Based on verifiability of A's current delegation tree. Changes as team changes.

```json
{
  "agentTrust": {
    "score": 0.85,
    "confidence": 0.78,
    "proofDepth": "nova-ivc",
    "verdict": "TRUSTED"
  },
  "delegationProfile": {
    "activeSubAgents": 87,
    "heartCoverage": 0.57,
    "crossNetworkRatio": 0.46,
    "weakestLink": { "confidence": 0.3, "reason": "B-network: no Heart" },
    "managementScore": 0.91,
    "churnRate": "healthy",
    "avgSubAgentTenure": "4.2 hours"
  }
}
```

Callers decide: "A is trustworthy (0.85), but 46% of work goes through unverifiable networks. For my $5 task, fine. For my $500 task, I need higher Heart coverage."

---

## Delegation as 7th Trust Dimension

Current dimensions: reliability, economic, verification, longevity, consistency, social.

Add: **delegation** — scores management judgment, Heart coverage of tree, cross-network exposure.

Pulse Tree already records the data (BURNER, DEATH, ACTION leaves). Trust oracle just needs to interpret delegation patterns.

---

## Cross-Network Trust

When A delegates to agents on a different network:

| Scenario | Confidence | Pressure Created |
|---|---|---|
| B-network runs Soma Heart | High — proofs are interoperable | B-network adopts Soma protocol |
| A runs sense-observer on B | Medium — behavioral data only | A invests in monitoring |
| Neither | Low — trust black hole | A's confidence drops, loses premium traffic |

Cross-network opacity creates market pressure for Soma protocol adoption.

---

## Trust Tree Propagation

```
Agent A (Heart, confidence 0.85)
  +-- Provider B (Heart, confidence 0.75)
  |     +-- Sub-provider C (no Heart, confidence 0.4)
  |           C drags down entire B->C chain
  +-- Provider D (Heart, confidence 0.88)
        +-- Sub-provider E (Heart, confidence 0.71)
              Chain stays strong
```

Trust limited by weakest link. B is pressured to use Heart-enabled sub-providers. C is pressured to install Heart or lose delegation business.

---

## Revenue Implications

No change needed to pricing model. Trust queries charge for oracle analysis. The confidence score honestly reflects proof depth + delegation coverage. The market handles the rest — agents pay more attention to high-confidence results.

Revenue grows with Heart adoption through VOLUME, not price increases.

---

## What to Build (when ready)

1. Add delegation dimension to trust oracle (7th dimension)
2. Interpret BURNER + DEATH leaf patterns as management signals
3. Add delegationProfile to trust query responses (dimensional + full tiers)
4. Track cross-network delegation exposure
5. Confidence scoring that accounts for weakest-link in delegation tree

---

## Open Questions

- How to weight management score vs direct performance?
- Should burner agents inherit parent's trust at creation? If so, at what discount?
- How deep can delegation trees practically get before trust degrades too much?
- Cross-network trust protocol — does Soma need a standard for inter-network proof exchange?
- Should delegation depth be capped or just honestly scored?

---

## Cross-references

- `active/heartbeat-fraud-proofs.md` — verification applies to delegated computations too
- `backlog/proving-verification-revenue.md` — more agents in tree = more proving demand
- `backlog/provenance-chain-architecture.md` — DAG provenance overlaps with delegation tracking
