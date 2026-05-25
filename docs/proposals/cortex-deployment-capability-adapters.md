# Cortex Deployment Capability Adapters

Status: proposed

## Problem

Cortex is becoming the operations room for agent-controlled software development. That means deployments cannot stay as invisible side effects of GitHub Actions, Cloudflare Pages, Wrangler, VPS scripts, or human muscle memory.

The current HeyVera/Cortex stack already shows the problem:

- backend production deploy truth flows through GitHub Actions and a VPS deploy script
- Cortex frontend production deploy truth flows through Cloudflare Pages
- `cortex.heyvera.org` serves the Pages app, while frontend API calls go to `https://api.heyvera.org`
- Cloudflare Pages production can lag or cache older assets after code is merged
- agents can verify some backend state, but cannot yet inspect or operate Cloudflare Pages directly

If Cortex is supposed to become a lead developer / operations-room employee, it needs a structured way to inspect, trigger, verify, explain, and roll back deployments. Random CLI shell-outs are not enough.

## Why Now

The operations-room event log and run timeline now exist. The next foundation layer is deciding what a deployment is inside Cortex before adding deeper automation.

This is needed before Cortex can safely offer:

- agent-triggered preview deploys
- agent-triggered production deploys
- Cloudflare Pages or Workers control through Wrangler/API
- cache purge and asset verification
- deployment rollback
- environment-variable and secret drift checks
- team-level operations-room visibility across repos and providers

## Broad Idea

Create deployment adapters as first-class Cortex capabilities.

A deployment adapter is a constrained integration that knows how to operate one deployment surface, such as:

- GitHub Actions workflow dispatch and run inspection
- Cloudflare Pages and Workers through Wrangler or Cloudflare API
- VPS services through deploy scripts, systemd, Caddy, and health checks
- future surfaces like Vercel, Netlify, Fly, Render, Supabase, Neon, or Railway

Adapters do not free-form execute arbitrary commands by default. They expose named operations with explicit inputs, risk level, required approval, audit events, verification contract, and rollback behavior.

Wrangler belongs in this model as the Cloudflare adapter implementation detail. Cortex should know when Wrangler is the right tool, but the user-facing system should be a controlled deployment capability, not "let the agent run Wrangler however it wants."

## What 10/10 Looks Like

A production-ready Cortex deployment system would:

- discover the deployment surfaces for a project and show them in the operations room
- identify source-of-truth branch, build command, output directory, environment, custom domains, and API hostnames
- explain which commit is live on each surface
- trigger preview deploys automatically when policy allows
- request approval for production deploys and high-risk operations
- verify deploy completion using commit, asset hash, health endpoint, smoke test, and user-facing route checks
- record every deploy action in `operations_events`
- attach deployment leases so two agents do not mutate the same production environment at once
- surface drift clearly: merged commit, backend live commit, frontend live bundle, Pages deployment id, cache status
- support rollback from a known previous good deployment
- prevent secrets from being printed or stored in logs

## Fitness Check

- vision fit: strong; deployment control is core to Cortex as an agent-controlled development operations room.
- real user/operator need: strong; the current Cortex deployment path already has Cloudflare/VPS split-brain and public asset drift failure modes.
- security exposure: high; deploys, DNS, env vars, cache purge, and rollback affect production behavior.
- evidence this is needed now: live Cortex had stale frontend assets, backend deployment verification work, and hostname/API-routing ambiguity.
- keep / reshape / pause / remove: keep and reshape into capability adapters with policy gates before adding broad automation.

## Evidence Ledger

- current status: proposal
- upstream dependencies: Soma capability semantics may later provide stronger credential/trust primitives; ClawNet can own adapter policy and first-consumer runtime behavior now.
- missing evidence: provider-specific threat model, credential storage policy, first adapter implementation issue, rollback proof, UI contract.
- blocks current work: yes for agent-controlled production deploys; no for ordinary manual/GitHub deploys.
- next gate: ADR plus first implementation slice for read-only deployment inspection.
- terminal condition: shipped adapters with docs, tests, audit events, policy gates, and verified rollback path for at least one provider.

## Repo Ownership

- protocol truth: Soma owns portable capability/credential semantics if these become cross-product protocol claims.
- platform/runtime truth: ClawNet owns Cortex deployment adapter runtime, policy gates, event schema consumption, and VPS/GitHub/Cloudflare integration.
- product/integration truth: Cortex owns the operations-room UX and user-facing deployment workflows.
- internal-only material: brainstorms about future providers or monetization stay in `internal/` until promoted.

## First Consumer

Cortex should be the first consumer.

The first concrete adapter should target the current Cortex production reality:

- GitHub Actions `Deploy Production` for backend/VPS deployment
- Cloudflare Pages project `cortex` for frontend deployment status and live asset verification
- `api.heyvera.org` as the backend API hostname
- `cortex.heyvera.org` as the frontend app hostname

The first implementation should be read-only inspection plus verification, not mutation.

## Security / Reliability Requirements

- threat model: adapters can mutate production, leak deployment state, alter DNS/cache/env vars, or hide drift if verification is weak.
- rollback or recovery: every mutating adapter operation needs a known rollback strategy or must be marked no-rollback/high-risk.
- auditability: every adapter operation records `operations_events` such as `deploy.inspected`, `deploy.requested`, `deploy.started`, `deploy.verified`, `deploy.failed`, `deploy.rolled_back`, and `cache.purged`.
- failure modes: provider API outage, partial deploy, stale CDN cache, wrong branch, wrong project, missing token scope, secret redaction failure, production approval timeout, rollback target missing.

### Risk Classes

- `read`: inspect deployment status, domains, live commit, workflow runs, Pages deployments.
- `preview_mutation`: trigger preview deploy, create preview URL, run smoke tests.
- `production_mutation`: trigger production deploy, promote preview, restart service, reload Caddy.
- `dangerous_mutation`: edit DNS, update env vars, rotate secrets, purge global cache, delete deployment, rollback production.

### Approval Policy

- `read`: no approval after connection is authorized.
- `preview_mutation`: can be automatic per project policy.
- `production_mutation`: requires explicit policy; default should be approval required.
- `dangerous_mutation`: requires strong approval and a rollback/recovery note.

### Secret Handling

- adapters store references to credentials, not raw secrets in events or chat
- provider tokens must be scoped to minimum required permissions
- logs must redact tokens, env values, auth headers, account ids when needed
- commands must avoid echoing secret-bearing environment

## Delivery Shape

1. Read-only deployment inventory model.
   - Store provider, project, environment, source branch, hostnames, build command, output directory, and verification URLs.

2. Cloudflare Pages read adapter.
   - Inspect Pages project `cortex`, latest production deployment, custom domain, build config, and deployment URL.
   - Verify `cortex.heyvera.org` serves the expected asset bundle.
   - Initial implementation must be read-only and default to `not configured` unless these env vars exist:
     `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_PAGES_PROJECT=cortex`.
   - The adapter should treat Cloudflare Pages as the preferred Cortex frontend truth and only fall back to the VPS static artifact when Pages inspection is unavailable.

3. GitHub Actions read adapter.
   - Inspect latest `Deploy Production` run, head SHA, conclusion, and deploy-info verification result.
   - Initial runtime inspection should be read-only and default to `not configured` unless a GitHub read token is available through `GITHUB_TOKEN` or `GH_TOKEN`.
   - The adapter should report workflow status separately from frontend asset drift; a failed latest workflow is release evidence, not proof that the currently served bundle is stale.

4. Unified deploy status endpoint.
   - Return frontend/backend deploy state for the operations room.
   - Report backend and Cloudflare Pages commit alignment separately from asset drift, because a split deploy can be healthy when both surfaces are intentionally released independently.

5. Operations event integration.
   - Record deploy inspection and verification events.

6. Mutating preview deploy adapter.
   - Trigger safe preview deploys only.

7. Production deploy adapter.
   - Gate with approval, environment lock/lease, verification, and rollback note.

## ADR Needed?

- yes
- this changes Cortex's trust model, production behavior, and release posture

## Open Questions

- Should Cloudflare control use Wrangler CLI, Cloudflare REST API, or both behind one adapter?
- Where should provider credentials live for user-owned projects versus HeyVera-owned infrastructure?
- Should deploy adapter permissions be backed by Soma delegations immediately or by ClawNet policy first?
- What is the minimum useful operations-room UI: deploy status strip, deploy timeline, or full environment map?
- Should production deploys ever be auto-approved for solo users, or should approval always be default?

## Links

- related proposal: `docs/proposals/cortex-operations-room-contract.md`
- related reference: `docs/reference/cortex-operations-room.md`
- related ADR: `docs/decisions/ADR-0002-deploy-via-github-actions.md`
