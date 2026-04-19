# Proposal: Enable Shadow-Check in Production

Status: proposed
Date: 2026-04-18

## Problem

The shadow-check middleware landed in G7.3 (commit f0344f5) but is default-off (`ROTATION_SHADOW_CHECK_ENABLED` unset). Without enabling it, we collect zero match/mismatch/error data. Post-G7 decisions — authoritative cutover, admin mint — require evidence that the rotation backend resolves bearers correctly. No data = no evidence.

## Why Now

Gate 7 is complete. The shadow-check is the only way to collect that evidence without touching production traffic semantics. Every week it stays off is a week of match data we cannot recover.

## Broad Idea

Set `ROTATION_SHADOW_CHECK_ENABLED=true` in the VPS env file and recreate the API container. The middleware is read-only, runs after legacy auth, never blocks a request, and is kill-switchable with a second env-file edit. This is an operationalization step, not a cutover.

## What 10/10 Looks Like

Seven consecutive days with:
- zero `shadowCheck: 'error'` entries
- 100 % match rate for all adopted test keys
- no observable change in request latency

At that point the counter data constitutes the necessary (not sufficient) evidence for a future cutover proposal.

## Fitness Check

- **vision fit:** yes — shadow-check exists to derisk cutover, enabling it is the designed path
- **real user/operator need:** operator needs match-rate data before committing to cutover
- **security exposure:** none — middleware is read-only, never exposes bearer values in logs, skip path covers env and delegated keys
- **evidence this is needed now:** G7.3 merged, CI green, ADR-0006 §4 lists production rollout as post-Gate-7
- **keep / reshape / pause / remove:** keep — execute the runbook

## Explicit Non-Goals

- No authoritative cutover
- No admin mint
- No snapshot persistence
- No schema changes
- No source code changes

## Security / Reliability Requirements

- **threat model:** none introduced — middleware is already deployed and default-off; enabling only activates logging
- **rollback or recovery:** kill-switch is one env-file edit + `docker compose up -d --no-build`; zero downtime
- **auditability:** all shadow-check events are structured pino log lines; grep-able from Docker logs
- **failure modes:** if the rotation backend throws, the middleware catches, logs `shadowCheck: 'error'`, and passes the request — no user impact

## ADR Needed?

No. ADR-0006 §7 already defines the shadow-check constraints (read-only, after legacy, no-op when off, kill-switchable). This is operationalization of that design.

## Delivery Shape

Single operator action per the runbook at `docs/operations/shadow-check-enable-runbook.md`.

## Open Questions

None. Prerequisites must be verified before enabling (see runbook pre-enable checklist).

## Links

- parent: ADR-0006 §4, §7
- commit: f0344f5 (G7.3 shadow-check middleware)
- runbook: `docs/operations/shadow-check-enable-runbook.md`
