# ClawNet Product — Open Concerns

> Concerns specific to ClawNet product features (not protocol).
> Full text lives here. Master file (docs/open-concerns.md) is the index + dependency map.
> Updated: March 24, 2026.

---

## ORANGE

### O5: Guardian Accountability (Who Watches the Watchers?)

**The problem:** Guardian agents can freeze other agents. Guardian precision tracking (correct_freezes / total_freezes, Opus #9) helps, but guardians can collude or be bribed. The protocol-assigned secondary guardian mitigates single-guardian compromise, but a small guardian pool (say 10) makes collusion between 2-3 plausible.

**What we've proposed:** Anti-concentration rules (max 10%/15%/30%), precision tracking with demotion at <0.8 and removal at <0.5, protocol-assigned rotating secondary guardian.

**Why it's still hard:** "Correct freeze" = "not overturned within appeal window" — but who adjudicates? If guardians adjudicate, circularity. If ClawNet adjudicates, centralization. The precision metric also has a cold-start problem (2/2 = perfect, low confidence).

**The deeper circularity:** Guardians are scored by the same trust system they protect. If the trust oracle is compromised (R3), guardian scores can be manipulated to suppress legitimate guardians.

**What would help:** Guardian staking (economic bond). But that requires a token (catch-22 with R3) or USDC staking (regulatory complexity from O10).

---

### O8: Autonomous Defense System Needs Critical Mass

**The problem:** The 5-layer autonomous defense system is designed for 10K+ agents. At current scale (0 on the protocol path), every layer has minimum viable ecosystem sizes that aren't met:

| Defense Layer | Threshold | Min Agents Required |
|---|---|---|
| Proof of life | 1 agent | Works at any scale |
| Immune response (Level 1: MONITOR) | 3 unique counterparties in 1hr | ~50+ active agents |
| Immune response (Level 3: QUARANTINE) | 10 unique counterparties | ~200+ active agents |
| Guardian anti-concentration (10% cap) | Meaningful with 10+ guardians | ~500+ agents |
| Gravity well scoring | Needs tx volume for decay signals | ~100+ daily active agents |
| EigenTrust Sybil suppression | Needs connected graph | ~500+ with diverse interactions |

At small scale, thresholds are either too sensitive (false positives) or too insensitive (attacks undetected).

**The tension:** Need the defense system for differentiation. Can't validate without scale. Can't get scale without differentiation.

**What would help:** Simulation with synthetic populations. Define minimum viable size per layer. Be explicit at DIF about which layers work at which scale.

---

### O11: Bus Factor = 1 [DIF-BLOCKING]

**The problem:** One-person project. DIF engagement requires sustained multi-week presence: working group calls, spec review comments, interop discussions, building 3-5 allies. The plan says "build allies BEFORE contentious votes."

**Why this is ORANGE:** DIF engagement is imminent, 10/10 plan is 100% unbuilt, DIF submission pending. The single-person constraint is actively blocking parallel workstreams (code + spec reviews + community outreach + DIF calls), not a hypothetical.

**What would help:** Identify the ONE thing only you can do (DIF relationships) and ruthlessly defer everything else. Or find one collaborator for any workstream.

---

## YELLOW

### Feature Scope Creep

**The problem:** The product feature list is enormous (guardians, insurance, social graph, seasons, bonding curves, composite skills, delegation chains, governance, forensics, MCP workflow builder...). Risk of building features that don't contribute to Protocol 1 adoption.

**The discipline:** Every hour on guardians or seasons is an hour not spent on DIF submission or external outreach. Protocol 1 first, product features after adoption.

---

## CLOSED

*Nothing yet.*
