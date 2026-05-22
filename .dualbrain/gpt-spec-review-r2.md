# GPT Adversarial Review Round 2 — HeyVera Living Spec

Model: GPT-4.1 (via Codex), 2026-05-20
Score: **6/10** (up from 4/10)

## Original 10 REDs — Status After Patches

| # | Issue | Verdict |
|---|-------|---------|
| 1 | HEAD lives forever vs erasure | PARTIALLY FIXED — moved problem to event log, no deletion model for append-only data |
| 2 | HEAD data boundary | PARTIALLY FIXED — boundary exists but not enforceable, no typed schema |
| 3 | Execution state machine | PARTIALLY FIXED — lifecycle closed, side-effect correctness missing |
| 4 | Timeout/rollback for partial work | PAPERED OVER — financial exposure bounded, execution rollback missing |
| 5 | "No charge on failure" exploit | PARTIALLY FIXED — internal contradiction with old "no refund" language |
| 6 | Cortex vs containers | MOSTLY FIXED — runner needs least-privilege DB/blob credentials |
| 7 | Migration plan | PARTIALLY FIXED — inconsistency between "Rust backend" and "Node.js retiring" |
| 8 | Single binary deployment | MOSTLY FIXED — dev `node` mode is a footgun for untrusted code |
| 9 | VeraAI moat opt-in | PARTIALLY FIXED — metrics baseline works but can't discover new context artifacts |
| 10 | Unified trust score | PARTIALLY FIXED — no weights, calibration, decay, appeal, privacy boundary |

## 3 NEW RED FATAL Issues

11. **Immutable logs vs privacy promises** — append-only ObservationEnvelope + append-only event stores + erasure promises = contradiction without formal retention/erasure model
12. **Postgres job queue at scale** — FOR UPDATE SKIP LOCKED + pg_notify underspecified for 100K users × 30-100 workers/HEAD, no sharding/backpressure
13. **x402 credits contradict no-custody posture** — "platform credit" refunds and "prepaid balance" are stored value, conflicts with "do not custody"

## 7 NEW YELLOW GAP Issues

14. "Every interaction signed through Soma" contradicts Clerk/subscription bypass
15. SomaX402ReceiptV1 schema boundary — protocol-level or app-level?
16. Cost model brittle — fixed routing percentages, no monthly cost envelope, no provider price-change policy
17. Bot detection named not designed — no labels, retraining, false-positive handling
18. Local model feasibility operationally vague
19. Context assembler can violate privacy boundary — assembled context lifetime, provider prompt logging, secret stripping
20. Runner isolation missing artifact ingress/egress controls

## 3 NEW GREEN WEAK Issues

21. Observability missing security/audit invariants
22. Supply-chain controls not tied to release gates
23. Testing strategy missing critical property invariants
