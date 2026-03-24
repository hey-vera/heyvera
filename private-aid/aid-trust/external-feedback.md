# AID-Trust — External Feedback

> Community feedback specific to Protocol 1 (trust scoring + identity + verification).
> Extracted from external-feedback-tracker.md on March 24, 2026.

## Addressed

| Concern | Raised By | Resolution |
|---------|-----------|------------|
| Hard vs soft input framing | toplyr-narfur #6, msaleme #5 | Section A.5.1 Input Integrity Model |
| Local policy weightings | toplyr-narfur #4 | Section A.5.2 Local Policy Overlay |
| OATR composability | FransDevelopment | Added to competitive table, maps to verificationTier |
| Testing DID isolation | rsbasic | Section A.8 testing DID note |
| Value diversity signal | rsbasic | Phase 3 candidate (deferred) |
| Cold-start policy discovery | toplyr-narfur #4 | Section C.4 heartbeat extension |
| Sybil resistance | msaleme, rsbasic | counterpartyDiversity, graph analysis, mutual decay |
| Nonce scope | toplyr-narfur #2 | Per-provider, 5-min window |
| Score portability | toplyr-narfur #3 | Deterministic by design |
| Fail-closed default | rsbasic | Middleware fail-closed, degraded modes |

## Open

| Concern | Raised By | Status |
|---------|-----------|--------|
| External harness validation | msaleme, rsbasic, AIWG | Committed but not yet executed |
