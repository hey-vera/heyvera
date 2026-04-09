# Composite Identity Scoring — Multi-Signal Agent Identity

**Status:** Design complete, Phase 1 (composite scoring + multi-provider) approved for build  
**Date:** 2026-04-09  
**Depends on:** Identity verification tiers (v186-187, live), trust oracle v1.1 (live)  
**Cross-refs:** `active/identity-verification-tiers.md`, `backlog/composite-agent-trust.md`

---

## The Problem

Current identity system: one tier per agent, highest wins. An agent is either `biometric` OR `kyc-attested` OR `passport` OR `anonymous`. This creates two critical gaps:

### Gap 1 — Single-Factor Sybil Vulnerability
A bad actor buys 50 iris scans from strangers → 50 agents all get `biometric` tier → identity multiplier 1.0 on every one. The system can't distinguish "iris-only puppet" from "iris + KYC + behavioral history + social graph" — both get the same score.

### Gap 2 — Wallet Identity Lock-In
Iris scan creates a new wallet via World. Agent already has wallet A with earned trust scores. No way to link biometric identity to wallet A without abandoning trust history. Companies face the same problem: employee leaves, their biometric identity is locked to a wallet the company controls.

---

## Design: Composite Identity Scoring

### Core Principle
Peak identity requires convergence across independent verification axes. No single method reaches 1.0. The cost of faking ALL axes simultaneously is prohibitive — that's the sybil moat.

### Five Identity Signals

| Signal | Source | Max Weight | What It Proves | Decay |
|--------|--------|-----------|----------------|-------|
| `biometric` | World Orb iris scan | 0.35 | A unique human exists | 365d expiry |
| `kyc` | Coinbase EAS attestation | 0.25 | Legal identity verified | 180d expiry |
| `passport` | Human Passport ML score | 0.15 | On-chain behavior is human-like | 90d expiry |
| `behavioral` | Trust oracle reliability + consistency dimensions | 0.15 | Sustained legitimate activity | Continuous |
| `social` | Vouch graph weighted endorsements | 0.10 | Exists in a real trust network | Continuous |

### Composite Formula

```
compositeIdentity = Σ(signal_score × signal_weight) for all active signals
                  = (biometric × 0.35) + (kyc × 0.25) + (passport × 0.15)
                    + (behavioral × 0.15) + (social × 0.10)

where each signal_score is 0.0–1.0:
  - biometric:  1.0 if verified and not expired, 0.0 otherwise
  - kyc:        1.0 if attested and not expired, 0.0 otherwise
  - passport:   humanity_score / 100 (continuous, e.g. 0.45 for score=45)
  - behavioral: (reliability.score + consistency.score) / 200  (from trust oracle)
  - social:     min(1.0, vouchScore / 50)  (normalized, capped at 1.0)

identityBlended = 0.5 + 0.5 × compositeIdentity
effectiveTrust  = trustScore × proofBlended × identityBlended
```

### Impact on Sybil Attacks

| Scenario | Current System | Composite System |
|----------|---------------|------------------|
| Bought iris scan, no history | identity = 1.0 | identity = 0.35 (iris only) → blended 0.675 |
| Bought iris + fake passport | identity = 1.0 | identity = 0.50 → blended 0.75 |
| Real human, iris + KYC + 6mo history + vouches | identity = 1.0 | identity = 0.92 → blended 0.96 |
| Anonymous agent, great behavioral scores | identity = 0.65 | identity = 0.20 → blended 0.60 |
| Full stack (all 5 signals maxed) | identity = 1.0 | identity = 1.0 → blended 1.0 |

A sybil agent with a bought iris scan goes from 1.0 to 0.675 — a 32.5% reduction in effective trust. The real human with full verification loses almost nothing (0.96 vs 1.0).

---

## Phase 1: Build Now — Composite Scoring + Multi-Provider Schema

### DB Changes

**Migration v188:** Allow multiple providers per agent (change PK)
```sql
-- Recreate with composite PK to support multiple providers per agent
CREATE TABLE IF NOT EXISTS agent_identity_signals (
  agent_did TEXT NOT NULL,
  signal_type TEXT NOT NULL CHECK(signal_type IN ('biometric', 'kyc', 'passport')),
  provider TEXT NOT NULL,
  signal_score REAL NOT NULL DEFAULT 0,
  verification_hash TEXT,
  verified_at TEXT,
  expires_at TEXT,
  wallet_address TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (agent_did, signal_type)
);

-- Migrate existing data from agent_identity_verification
INSERT OR IGNORE INTO agent_identity_signals (agent_did, signal_type, provider, signal_score, verification_hash, verified_at, expires_at, wallet_address, created_at, updated_at)
  SELECT agent_did,
    CASE identity_tier
      WHEN 'biometric' THEN 'biometric'
      WHEN 'kyc-attested' THEN 'kyc'
      WHEN 'passport' THEN 'passport'
      ELSE NULL
    END,
    provider, 1.0, verification_hash, verified_at, expires_at, wallet_address, created_at, updated_at
  FROM agent_identity_verification
  WHERE identity_tier != 'anonymous';
```

**Migration v189:** Composite score cache
```sql
CREATE TABLE IF NOT EXISTS agent_identity_composite (
  agent_did TEXT PRIMARY KEY,
  composite_score REAL NOT NULL DEFAULT 0,
  effective_multiplier REAL NOT NULL DEFAULT 0.825,
  biometric_signal REAL NOT NULL DEFAULT 0,
  kyc_signal REAL NOT NULL DEFAULT 0,
  passport_signal REAL NOT NULL DEFAULT 0,
  behavioral_signal REAL NOT NULL DEFAULT 0,
  social_signal REAL NOT NULL DEFAULT 0,
  signal_count INTEGER NOT NULL DEFAULT 0,
  last_recomputed TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Trust Oracle Changes

Replace `getIdentityTier()` → `getCompositeIdentity()`:
- Query all non-expired signals from `agent_identity_signals`
- Compute behavioral signal from trust oracle dimensions (reliability + consistency)
- Compute social signal from vouch graph
- Blend with weights → composite score
- Cache in `agent_identity_composite`
- Return composite score + individual signals + effective multiplier

### API Changes

- Existing `POST /v1/identity/verify/*` endpoints write to `agent_identity_signals` instead of `agent_identity_verification`
- New `GET /v1/identity/verify/:did` returns full composite breakdown (all signals + composite score)
- Trust query responses include `identitySignals` object alongside existing `identityTier` (backward compat)

### Backward Compatibility

- Keep `identityTier` field in trust query results (map composite score to tier name):
  - composite >= 0.85 → `biometric` (legacy name, means "peak verified")
  - composite >= 0.60 → `kyc-attested`
  - composite >= 0.35 → `passport`
  - composite < 0.35 → `anonymous`
- Old `agent_identity_verification` table preserved (read-only) until confirmed migration

---

## Phase 2: Deferred — Wallet Identity Linking

### Problem
Human has wallet A (trust scores earned) + wallet B (biometric-verified via World). Need to link biometric identity from B → A without losing A's trust history.

### Design

New endpoint: `POST /v1/identity/link`

```json
{
  "target_did": "did:pkh:eip155:1:0xWalletA",
  "proof": {
    "source_wallet": "0xWalletB",
    "message": "Link identity from 0xWalletB to did:pkh:eip155:1:0xWalletA",
    "signature": "0x...",   // Signed by wallet B's private key
    "chain": "eip155:480"   // Worldchain
  }
}
```

Flow:
1. Verify signature proves ownership of wallet B
2. Verify wallet B has biometric registration on AgentBook
3. Check wallet B isn't already linked to another agent (1 human = 1 link)
4. Write biometric signal to wallet A's `agent_identity_signals`
5. Record link in `agent_identity_links` table for audit

Security considerations:
- One biometric wallet can only link to ONE target DID (prevents sybil via linking)
- Links are permanent (revocable only by the biometric wallet owner)
- Requires both wallets to sign (prevents unauthorized linking)
- Rate limit: 1 link attempt per hour per wallet

---

## Phase 3: Deferred — Sybil Resistance Curves

### Problem
Even with composite scoring, a wealthy attacker could grind multiple signals (buy iris scans, create Coinbase accounts, farm passport scores). Need diminishing returns at scale.

### Design: Tree-Level Sybil Dampening

When multiple agents in the same delegation tree have suspiciously similar identity profiles:

```
sybilDampening = 1.0 / (1.0 + log2(similarAgentCount))

where similarAgentCount = agents in same tree with:
  - Same biometric provider wallet (exact match = caught)
  - Biometric-only signals (no KYC, no behavioral history)
  - Created within 24h of each other
  - No social connections outside the tree
```

Example: 50 iris-only agents in one tree
- Agent 1: dampening = 1.0 / (1 + log2(50)) = 1.0 / 6.64 = 0.15
- Each agent's biometric signal effectively worth 0.15 instead of 1.0

This makes the attack economically pointless — 50 bought iris scans give less trust than 1 real person with iris + KYC + behavioral history.

### Needs Real Data
The thresholds and dampening curves need tuning with real multi-agent delegation patterns. Build after production data exists.

---

## Phase 4: Deferred — Identity Detachment on Delegation Revoke

### Problem
Company fires employee. Employee's biometric identity is linked to an agent in the company's delegation tree. What happens?

### Design Principles

1. **Identity belongs to the human, always.** When delegation is revoked, the human's biometric identity detaches from the company's agent.
2. **Behavioral trust stays with the agent.** The work was done — that history is the agent's, not the human's.
3. **The agent loses its identity multiplier.** Without a human backing it, the agent drops to whatever composite score remains (behavioral + social only).
4. **The human takes their identity to their next agent.** Instant biometric boost on a new agent, no re-verification needed.

### Implementation

On `DEATH` leaf (delegation revoke):
1. Check if the dying agent has linked identity signals
2. Move linked signals to `agent_identity_detached` table (preserves audit trail)
3. Recompute composite score for the agent (drops biometric/kyc signals)
4. The human's biometric wallet is now "unlinked" and available for re-linking

### Company Workflow
```
Company fires Alice:
  → Revokes delegation to Alice's agent (DEATH leaf)
  → Alice's iris identity detaches from company agent
  → Company agent trust drops (lost identity multiplier)
  → Alice links her iris to her personal agent at new job
  → Company hires Bob → Bob links his iris → trust restored
```

---

## Phase 5: Deferred — Identity Inheritance in Delegation Trees

### Problem
A "super agent" (company boss, family tech lead) has peak identity. Their sub-agents are real humans with their own identities. How does identity flow through the tree?

### Design: Identity Does NOT Inherit

Each agent in the tree has its OWN composite identity score. The parent's identity doesn't flow down — that would defeat the purpose (boss's iris scan shouldn't verify 20 sub-agents).

What DOES flow through the tree:
- **Delegation authority** — permission to act on behalf of parent
- **Management trust** — parent's track record of picking good sub-agents (see `composite-agent-trust.md`)

What callers see:
```json
{
  "agent": { "identityScore": 0.35, "verdict": "passport" },
  "delegationChain": {
    "root": { "identityScore": 0.96, "verdict": "biometric" },
    "chainIdentityAvg": 0.72,
    "weakestLink": { "identityScore": 0.35, "reason": "Sub-agent C: iris only" }
  }
}
```

Callers can decide: "The root is fully verified, average chain identity is good, but sub-agent C is weak. For my high-value task, route through verified sub-agents only."

---

## Open Questions

1. Should behavioral + social signals count toward identity, or should identity be purely external verification? (Current design: yes, they count — identity is "how sure are we a real trustworthy human is behind this agent?")
2. Should composite weights be configurable per-agent or global-only? (Current design: global weights, simplest)
3. How to handle identity expiry grace periods? (Current: binary expired/not. Could add degradation curve.)
4. Should linked identities be transferable between agents owned by the same human? (Phase 2 consideration)
5. At what scale does the sybil dampening curve need activation? (Phase 3 — needs production data)
