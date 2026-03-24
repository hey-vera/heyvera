# AID-Receipt — External Feedback

> Community feedback specific to Protocol 2 (DSIRs + commitment logs).

## Addressed in AIDplan (carry forward when extracting)

| Concern | Raised By | Resolution |
|---------|-----------|------------|
| Recency weighting (88% discount blind spot) | rsbasic | Exponential decay 30d half-life in receipt-primary scoring |
| Proof of life / absent owner | rsbasic | Autonomous defense (product), but receipt-level decay signals feed it |

## Open

| Concern | Raised By | Status |
|---------|-----------|--------|
| Feedback endpoint placement | Opus | Confirmed: lives in AID-Receipt (takes receiptId), not AID-Trust |
| External harness validation (receipt layer) | msaleme, rsbasic | Deferred until Protocol 2 development starts |
