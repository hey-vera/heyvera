# GPT Adversarial Review of HeyVera Living Spec v1.0

Model: GPT-4.1 (via Codex), 2026-05-20
Prompt: Hostile CTO stress test — find holes, contradictions, missing failure modes.

## Score: 4/10

## 10 RED FATAL Issues

1. HEAD "lives FOREVER" vs Section V privacy/erasure — permanent memory conflicts with GDPR deletion, team offboarding, poisoned memory removal
2. HEAD "only receives RESULTS" but context learning needs provenance, file sets, task shape — no boundary defined for what's safe to persist forever
3. Agent hierarchy has no durable execution state machine — crash recovery, duplicate completion, partial retry, conflicting finalization undefined
4. Verify-then-execute-then-settle has no timeout/rollback for partial work (streaming tokens, tool calls, file writes, provider spend consumed before settlement fails)
5. "On failure before settlement: no charge" lets adversaries force expensive work then trigger pre-settlement failure paths
6. "Cortex never executes code" contradicts container security section and container hardening phase
7. "Postgres from day 1" but current stack is SQLite/WAL + Hono — no migration bridge or cutover plan
8. "Single binary" vs separate serve commands — deployment topology, horizontal scaling, failure isolation undefined
9. VeraAI moat depends on cross-node learning but default tier is only `metrics` — no proof users will opt into high-signal tiers
10. No unified identity risk score gates agent privileges across Soma, Clerk, x402, marketplace, and hosting

## 25 YELLOW GAP Issues

11. Soma delegation revocation propagation, freshness, offline verification, network partition handling
12. Clock-skew handling between agent, Cortex, facilitator, chain, and worker nodes
13. Idempotency key scoping undefined (payer? endpoint? body hash? amount? chain?)
14. Settlement finality, reorg handling, "result released before irreversible payment"
15. Agent wallet signing UX, policy enforcement, session expiry, compromised agent containment
16. Sanctions response, blocked funds, audit logs, user appeal, jurisdiction shutdowns
17. Provider rate-limit exhaustion from profitable-on-average $7.99 users during peak
18. Hidden costs: cache-miss assembly, embeddings CPU, tracing, WebSocket fanout, retries
19. Bot detection false positives, subscriber unlimited→x402 conversion contract, slow-roll adversaries
20. $0.10 x402 floor breaks micropayment use cases unless batching is v1
21. No concurrency budget, cancellation model, fanout limit, or cost cap for agent fleets
22. No deterministic tie-breaker or human approval threshold for conflicting supervisor results
23. Context Assembler dependencies (tree-sitter, import graph, diagnostics) not in Phase 1
24. No schema for reason codes, provenance inheritance, negative evidence, context exclusion
25. No correction/dispute/retraction/invalidation flow for EvaluationReceipts
26. Task success is gameable without tests, user acceptance, or delayed outcome checks
27. Bandit learning ignores non-stationarity (providers change models, prices, rate limits)
28. DP composition accounting missing across teams, event types, cohorts, retries
29. SecAgg hides individual updates but poisoning defense needs attribution — contradiction
30. Blocked syscalls (mount, ptrace, bpf) break many real developer workflows
31. Egress broker needs package registries, Git remotes, model APIs, OAuth callbacks
32. No insider threat model for employees with DB, KMS, observability, production shell access
33. Key ceremony operational logistics: approvals, break-glass, lost guardians, quorum capture
34. Postgres LISTEN/NOTIFY payload limits, notification loss, backpressure, capacity model
35. Job queue: no priority lanes, dead-letter, poison job quarantine, tenant isolation

## 5 GREEN WEAK Issues

36. Cold context assembly <1500ms target unsupported for large repos
37. No versioning/compatibility policy for Soma receipts, ObservationEnvelope, event-store migrations
38. Bot detection + container hardening in Phase 4, but abuse controls needed before public access
39. x402 in weeks 8-12, but it affects principal classification, metering, rates, API contracts from day 1
40. Soma Transparency Log as "future research" but revocation depends on it now

## Verdict

> "The vision is internally coherent in places, but the current spec still treats several hard distributed-systems, payment, privacy, and operations problems as implementation details. Those are the parts that cause rewrites."
