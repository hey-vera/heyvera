# Current Trust Surfaces

Status: canonical

This page records what trust, Soma, orchestration, cache, provider, and payment-related surfaces are present on current `main`. It exists because older docs and internal notes describe several future or fork-era trust-network surfaces as if they were already shipped.

Use this page before creating implementation issues from trust-network, Soma Check, provider, provenance, or payment ideas.

## Verified On Current Main

Verified by targeted repo inspection on 2026-04-16.

| Surface | Current state | Source evidence | Notes |
|---|---|---|---|
| Orchestration API | shipped minimal runtime | `src/routes/api.ts`, `src/core/executor.ts` | `POST /v1/orchestrate` parses a query, executes registry steps, formats a response, logs usage, and uses query-level cache. |
| Endpoint execution | shipped minimal runtime | `src/core/executor.ts`, `src/config/api-registry.ts` | Executes static registry endpoints and caches successful step data. It does not currently attach Soma birth certificates. |
| Cache | shipped minimal runtime | `src/cache/index.ts` | Memory cache plus optional Redis. Current code supports simple TTL, sorted-param keying, and Redis fallback. Advanced cache claims require separate evidence. |
| LLM provider fallback | shipped minimal runtime | `src/providers/llm.ts` | Anthropic/OpenAI/OpenClaw fallback. Current code is not routed through a Soma heart. |
| API-key rotation backend | partial-foundation | `src/core/api-key-rotation.ts` | Implements a Soma credential-rotation backend. It is library/foundation code, not an authoritative auth path. |
| Rotation adoption wrapper | partial-foundation | `src/core/rotation-adoption.ts` | G7.2 adoption primitive exists after PR #43. It has no production caller and does not make rotation authoritative. |
| Soma dependency | partial-foundation | `package.json` | `soma-heart` is declared as a dependency, currently for credential-rotation foundation. |

## Not Verified On Current Main

The following surfaces appear in older docs or internal planning, but their named source files were not present on current `main` during targeted inspection. Treat them as proposal, stale-doc claim, or partial-foundation until a fresh PR supplies source, tests, and updated docs.

| Surface | Referenced paths not found | Planning status |
|---|---|---|
| Soma heart runtime wrapper | `src/core/soma.ts` | not shipped on current `main` |
| Soma provenance middleware | `src/middleware/soma-provenance.ts` | not shipped on current `main` |
| ClawAPIs Soma fetch wrapper | `src/providers/clawapis.ts` | not shipped on current `main` |
| Endpoint catalog/call routes | `src/routes/endpoints.ts` | not shipped on current `main` |
| Soma verdict, receipt, trust, verify routes | `src/routes/soma.ts` | not shipped on current `main` |
| Soma Check routes and telemetry | `src/routes/soma-check.ts`, `src/db/soma-check.ts` | not shipped on current `main` |
| Soma receipts and EAS anchoring | `src/core/soma-receipt.ts`, `src/core/eas-anchor-cron.ts` | not shipped on current `main` |
| Dual-signed provider/platform certs | `src/core/dual-sign.ts`, `src/core/dual-sign-state.ts` | not shipped on current `main` |
| Provider umbrella | `src/routes/providers.ts`, `src/db/providers.ts` | not shipped on current `main` |
| Certified cache | `src/core/cache-certificate.ts` | not shipped on current `main` |
| zkTLS verification | `src/core/zktls.ts` | not shipped on current `main` |
| x402 facilitator pool | `src/providers/x402-facilitator.ts` | not shipped on current `main` |
| Shared Soma crypto-agility utilities | `src/utils/jcs.ts`, `src/utils/crypto-agility.ts`, `src/utils/eas.ts` | not shipped on current `main` |

## Planning Rule

Do not treat an internal note, archived doc, or older canonical overclaim as implementation evidence. Before a trust-network surface becomes build-ready, it needs:

- a current-main source path or accepted proposal;
- security exposure classification;
- upstream Soma/protocol dependency check;
- tests appropriate to the behavior;
- docs that match the actual shipped surface;
- a terminal condition: shipped, rejected, archived, or superseded.

See `internal/active/trust-network-foundation-reconciliation.md` for the active evidence ledger and ordered slice plan.
