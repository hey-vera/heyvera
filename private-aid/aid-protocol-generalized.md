This is a rough generalization of the Idea behind aid:

# AID Protocol Family — Context for Opus

AID is a family of three composable protocols that add trust to agent commerce. They ship in order. Each is independently useful. Each builds on the one before it.

---

## The Problem

Every protocol in the agentic commerce stack (MCP, A2A, x402, ACP, UCP) is missing the same thing: trust. Agents can communicate, discover services, and pay each other — but no protocol answers "should I trust this agent?" AID answers that question.

## The Order

```
AID-Trust (standalone) → AID-Receipt (needs AID-Trust) → AID-Settle (needs both)
```

---

## Protocol 1: AID-Trust

**What:** Identity + trust scoring + verification for agents.

**Why:** An MCP server with 20,000 callers has no way to know which ones are reliable. AID-Trust gives every agent a cryptographic identity (Ed25519 DID) and a verifiable trust score (0-100) computed from behavioral evidence. Scores are Merkle-anchored so anyone can verify them offline without calling an API.

**Why first:** It works with a single implementation. An MCP server installs the middleware, verifies caller trust, done. No counterparty needed. No payment rail needed. This is what gets external adopters and what gets presented to DIF.

**Transport:** Agnostic. Works over anything that carries HTTP headers. Thin transport profiles map AID-Trust to MCP, A2A, ACP, UCP, or any HTTP-based protocol. AID-Trust doesn't care how the message gets there — it cares about who sent it and whether they're trustworthy.

---

## Protocol 2: AID-Receipt

**What:** Bilateral receipts + feedback + the evidence pipeline that feeds trust scores.

**Why:** AID-Trust scores agents, but scores need evidence. AID-Receipt creates that evidence through Dual-Signed Interaction Receipts (DSIRs) — both parties sign every interaction, both classify the outcome, and both maintain independent commitment logs. This makes the trust data verifiable and makes selective omission of bad interactions detectable. Feedback endpoints live here — you can't give feedback without a receipt to reference.

**Why second:** DSIRs require two parties. You can't generate bilateral receipts until someone else is running AID-Trust. This ships when AID-Trust has 3-5 external adopters generating real interactions.

**Dependency:** Requires AID-Trust for identity (both parties need DIDs to sign receipts). When AID-Receipt is present, AID-Trust's scoring formula upgrades from direct scoring to graph-based scoring (EigenTrust over the receipt interaction graph).

---

## Protocol 3: AID-Settle

**What:** Trust-gated pricing + settlement optimization.

**Why:** If you know an agent's trust score, you can price accordingly. Trusted agents get discounts. Highly trusted agents get deferred settlement (pay later, like a credit line). New agents pay base price upfront. AID-Settle turns trust scores into economic incentives — agents are rewarded for being reliable and penalized for being unreliable through the price they pay.

**Why third:** Most MCP servers giving away free tools don't need settlement optimization. Only paid services need trust-gated pricing. This ships when AID-Receipt has enough volume to justify tiered pricing. This is also where regulatory risk concentrates (money transmission, FCRA), so deferring it gives time for legal counsel.

**Payment rail agnostic:** AID-Settle defines trust tiers and pricing logic, not how money moves. x402 (crypto micropayments) is the first rail. MPP (Stripe streaming payments) is the second. Traditional rails (ACH, SEPA, SWIFT) don't make sense for micropayment-scale agent commerce but aren't architecturally excluded.

**Dependency:** Requires AID-Trust for scores (need trust to gate pricing) and benefits from AID-Receipt for evidence quality (better evidence = more accurate tier placement).

---

## What's NOT Protocol — It's Product

Everything else in the AIDplan is ClawNet's product built on top of the three protocols:

- Autonomous defense system (guardians, immune response, gravity well, proof of life)
- Social graph, seasons, bonding curves, insurance fund
- Governance, delegation chains, skill builder
- All /v1/* credit-based routes
- Competitive strategy, DIF playbook, regulatory analysis

These are ClawNet's competitive moat. They don't belong in what DIF evaluates as a standard. No one needs to implement guardian agents to verify a trust score.

---

## How They Compose

A cross-protocol composability document defines the rules for how the three protocols interact:

- Heartbeat is extensible: AID-Trust owns the base, AID-Settle adds pricing tiers, AID-Receipt adds supported receipt formats
- Trust tiers split across protocols: AID-Trust defines "score 80 = verdict trusted," AID-Settle defines "trusted = 25% discount + batched settlement"
- The avoid flag crosses protocols: AID-Trust sets it, AID-Settle enforces its economic consequences
- Merkle anchoring serves both: trust score roots (AID-Trust) and commitment log roots (AID-Receipt) must anchor to the same chain
- Discovery endpoint (/.well-known/aid.json) is extensible: base document is AID-Trust, each protocol adds its own section

---

## The Complete Picture

AID-Trust makes agents identifiable and scorable. AID-Receipt makes the scores evidence-based and bilateral. AID-Settle makes the scores economically meaningful. Together they create a trust layer that plugs into any protocol stack — MCP, A2A, x402, ACP, UCP, or anything else that emerges.

Separately, each protocol solves a real problem on its own. AID-Trust alone is already useful to 20,000 MCP servers with zero trust verification today.