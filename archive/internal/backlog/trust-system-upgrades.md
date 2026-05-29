# Trust System Upgrades — Backlog

Research-backed improvements for the trust oracle. Ordered by impact.

## 1. EigenTrust on Vouch Graph (HIGH IMPACT)
Replace BFS path resolution with eigenvector computation (like PageRank).
Global trust = principal eigenvector of normalized vouch stake matrix.
Vouches from low-rep Sybils count for nothing — exponential Sybil resistance.

Implementation: background cron (every 6h), power iteration to convergence.
Store global reputation per agent, use as weight for social dimension.
Reference: OpenRank ships this in production for Farcaster.

## 2. Beta Distributions for Dimensions (HIGH IMPACT)
Replace point estimates (score: 75, confidence: 0.8) with Beta(alpha, beta).
- alpha = successes + 1, beta = failures + 1
- Mean = alpha / (alpha + beta), proper confidence intervals
- Fixes cold-start: new agent is Beta(1,1) not "score: 50, confidence: 0"
- After 1 success: Beta(2,1) → mean 0.67, after 10: Beta(11,1) → mean 0.92

Outperformed all other systems in 2025 comparative study (Beta-PT model).

## 3. Adaptive Dimension Weights (MEDIUM IMPACT)
Static weights are a known weakness. Category-specific profiles:
- DeFi agents: economic 0.25, reliability 0.25, consistency 0.20
- Data feed agents: consistency 0.25, reliability 0.25, verification 0.20
- General agents: current weights (balanced)

Reuse `inferCategory()` from trust-decay-cron to select weight profiles.

## 4. Dampened Score Updates (MEDIUM IMPACT)
Cap trust accumulation rate: +5 points/day max per dimension.
Prevents on-off attacks and oscillation exploits.
An agent that jumps from 20 to 80 in one day is flagged.

## 5. Weighted Observer Verdicts (MEDIUM IMPACT)
GREEN from a high-trust observer should count more than from a new one.
Weight = observer's own trust score / max trust score.
This is recursive — exactly what EigenTrust does.

## 6. Per-Dimension Decay Rates (LOW-MEDIUM)
Different dimensions should decay at different speeds:
- Social trust (vouches): slow decay (months — relationships are durable)
- Reliability: fast decay (weeks — recent performance matters most)
- Longevity: no decay (it's cumulative by definition)
- Economic: medium decay (30 days)

Replace batch decay cron with per-dimension EWMA computed inline.

## 7. TraceRank: Implicit Trust from Payments (LOW-MEDIUM)
Payment transactions ARE implicit trust signals.
Derive trust from credit flow patterns without requiring explicit vouches.
An agent that consistently pays 100+ credits to another is implicitly vouching.
Reference: TraceRank (Operator Labs, Oct 2025 paper for x402 agents).

## 8. External Verification Layer (FUTURE)
Add 4th proof tier: "verified-external" for proofs verified by zkVerify or
another independent verification chain. Strictly stronger than self-generated.

## 9. r-Groth Compression Path (FUTURE)
Watch r-Groth (IACR 2024/1364) — natively handles relaxed R1CS from Nova.
Cleaner than SnarkFold's split-IVC approach. Retains 3-element proof + 2-pairing verify.

---

Sources: EigenTrust (Stanford), OpenRank, TraceRank (arxiv 2510.27554),
Fortytwo (arxiv 2510.24801), Beta-PT reputation model (arxiv 2511.19930),
r-Groth (eprint 2024/1364), zkVerify mainnet (Sep 2025)
