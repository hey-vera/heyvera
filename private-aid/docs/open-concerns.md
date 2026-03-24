# AID Open Concerns — Master Index

> Full concern text lives in each protocol's `open-concerns.md`. This file is the index + dependency map.
> Review at the start of every session. Resist the urge to "solve" these by adding AIDplan items.
> Updated: March 24, 2026. **19 concerns across 4 areas.**

---

## SEVERITY LEVELS

- **RED** — Could kill AID's credibility or viability. No known solution that fully resolves it.
- **ORANGE** — Real tension between competing goals. Current approach is a bet, not a proof.
- **YELLOW** — External dependency we can't control. Mitigations exist but don't eliminate the risk.
- **[DIF-BLOCKING]** — Directly affects the DIF submission timeline.

---

## DEPENDENCY MAP

```
R1 (security conjectured) ←── depends on ──→ O1 (parameters empirical)
   Both need the simulation harness. If it doesn't get built, BOTH stay open.

R2 (deterministic arithmetic) ──→ R3 (single oracle)
   Fraud proofs require deterministic scores. No determinism = no decentralization.

R4 (DIF credibility gap) ──→ R1 + R2 + O7
   DIF presentation assumes all three are resolved. All unbuilt.

O5 (guardian accountability) ←── undermined by ──→ R3 (single oracle)
   Guardians scored by the same system they protect.

O6 (standard race) ──→ O7 (no external impl)
   Standard positioning requires multi-implementer interest.

O1 (parameters) ──→ each new dimension compounds it
   valueDiversity adds another empirically-motivated parameter.
```

---

## INDEX

### AID-Trust (`aid-trust/open-concerns.md`)

| ID | Concern | Severity | DIF? |
|----|---------|----------|------|
| R1 | Security model conjectured, not proven | RED | BLOCKING |
| R2 | Deterministic arithmetic across implementations | RED | BLOCKING |
| R4 | DIF credibility gap — slides promise what isn't built | RED | BLOCKING |
| O1 | All scoring parameters empirically motivated | ORANGE | |
| O4 | Privacy vs fingerprinting | ORANGE | |
| O6 | Standard vs product race | ORANGE | BLOCKING |
| O7 | No external implementation | ORANGE | BLOCKING |
| Y2 | Base L2 single point of failure | YELLOW | |

### AID-Receipt (`aid-receipt/open-concerns.md`) — NOT YET ACTIVE

| ID | Concern | Severity | DIF? |
|----|---------|----------|------|
| O2 | EigenTrust convergence under adversarial graphs | ORANGE | |
| O3 | Commitment log completeness depends on cooperation | ORANGE | |
| O7r | DSIR chicken-and-egg (bilateral needs two parties) | ORANGE | |
| — | Receipt format lock-in risk | YELLOW | |

### AID-Settle (`aid-settle/open-concerns.md`) — NOT YET ACTIVE

| ID | Concern | Severity | DIF? |
|----|---------|----------|------|
| O9 | Regulatory classification of trust scores (FCRA/EU AI Act) | ORANGE | |
| O10 | Money transmitter risk on creator payouts | ORANGE | |
| Y3 | USDC pause risk | YELLOW | |
| Y4 | Gas price volatility on settlement | YELLOW | |

### Product (`product/open-concerns.md`)

| ID | Concern | Severity | DIF? |
|----|---------|----------|------|
| O5 | Guardian accountability (who watches the watchers) | ORANGE | |
| O8 | Autonomous defense needs critical mass | ORANGE | |
| O11 | Bus factor = 1 | ORANGE | BLOCKING |
| — | Feature scope creep | YELLOW | |

### Cross-Cutting (`strategy/regulatory.md`)

| ID | Concern | Severity | DIF? |
|----|---------|----------|------|
| Y1 | No legal counsel engaged | YELLOW | |
| R3 | ClawNet is still the only trust oracle | RED | |

---

## CLOSED

*Nothing yet. When resolved, move from protocol file to here with date + rationale.*
