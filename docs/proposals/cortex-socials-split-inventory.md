# Splitting Cortex out: what the seam actually looks like

Status: **inventory, not a plan.** Read-only survey taken 2026-09-04 against
`main`. It exists to make the extraction PR's description writable, and to
correct one assumption that the extraction was going to be planned around.

Every count below is reproducible from the commands quoted with it.

## The headline: the routers are not a seam

The extraction was expected to start from an existing boundary — two router
functions, `build_cortex_router` (`crates/api/src/lib.rs:417`) and
`build_heyvera_router` (`:754`) — with the crate, database, CI and migration
counter as the parts still to separate.

**That boundary does not exist.** The Cortex router's routes are a strict
subset of the Socials router's:

```sh
awk 'NR>=417 && NR<=753' crates/api/src/lib.rs | grep -oE '\.route\("[^"]+"' | sort -u   # 164
awk 'NR>=754 && NR<=1314' crates/api/src/lib.rs | grep -oE '\.route\("[^"]+"' | sort -u  # 198
```

| | count |
|---|---|
| routes in `build_cortex_router` | 164 |
| routes in `build_heyvera_router` | 198 |
| routes **only** in the Cortex router | **0** |
| routes only in the Socials router | 34 |
| routes in both | 164 |

And of the Cortex router's own 164 routes, **70 are `/v1/social/*`** — 43% of
the "Cortex" router is the Socials API. The remaining 91 are `/api/*` (a mix of
both products) plus three health/metrics endpoints.

So `build_cortex_router` is not "Cortex's router". It is the shared
application, and `build_heyvera_router` is that plus 34 more Socials routes
(Pulse, Vera, projects, extra admin). Nothing today serves Cortex alone.

**Consequence for the extraction:** there is no router to lift. The Cortex
surface has to be *identified* first — route by route — and that identification
is the real work, not the file moves. Budget for it accordingly.

The 34 Socials-only routes are: 11 `/v1/pulse/*`, 2 `/api/vera/*`, 3
`/api/projects*`, 8 `/api/admin/*`, and the rest context/github/keys/social
odds and ends.

## Modules

`crates/api/src` is 76,736 lines across 61 modules. By size and ownership:

**Cortex-owned** — `scheduler.rs`, `ws.rs`, `verification_driver.rs`,
`verification_dispatcher.rs`, `check_runner.rs`, `run_payload.rs`,
`run_stream.rs`, `context_flow.rs`, `context_api.rs`, `worker_key.rs`,
`docker.rs`, `mission_control.rs`, `ecosystem_probe.rs`, `llm_client.rs`,
`cost_estimator.rs`, `budget_enforcer.rs`, `pricing.rs`, `sse.rs`.

**Socials-owned** — `social.rs` (3,268), `integrations.rs` (2,804),
`pulse.rs` (2,280), `messaging.rs` (1,813), `deploy_status.rs` (1,396),
`media.rs` (1,355), `social_policy.rs`, `vera.rs`, `replit.rs`,
`moderation.rs`, `agent_auth.rs`, `conversations.rs`, `notifications.rs`,
`x402.rs`.

**Shared, and the reason this is not a clean cut** — `db.rs` (29,593),
`auth.rs`, `clerk.rs`, `clerk_webhooks.rs`, `user.rs`, `billing.rs`,
`stripe_client.rs`, `ratelimit.rs`, `state.rs`, `routes.rs`, `admin.rs`,
`storage.rs`, `github.rs`, `github_repos.rs`, `credentials.rs`,
`api_keys.rs`, `usage_api.rs`, `metrics.rs`, `validate.rs`, `api_error.rs`,
`crypto.rs`, `key_material.rs`, `lock.rs`, `token_refresh.rs`.

**Soma, fenced** — `soma.rs`, `soma_bridge.rs`, `soma_fence.rs`. Behind the
`soma` feature, off by default, guarded by the `no-default-features` CI job.
Stays in `heyvera`.

## Database

```sh
grep -oE "CREATE TABLE(( IF NOT EXISTS)?) [a-z_]+" crates/api/src/db.rs | awk '{print $NF}' | sort -u | wc -l   # 106
grep -oE "fn migrate_v[0-9]+" crates/api/src/db.rs | sort -uV | tail -1                                          # migrate_v67
```

106 tables, 67 migrations, one shared `schema_version` counter.

- **38 are unambiguously Socials**: everything `social_*` (31 tables), the four
  `pulse_*`, plus `conversations` and `messages`.
- **26 are unambiguously Cortex**: runs, steps, attempts, workers, leases,
  verification, receipts, checks, jobs, routing decisions, context, artifacts,
  bundles, credits, ledger, quotes, prices, catalog, delegations, scopes,
  containers.
- **42 are shared or need a decision.** The ones that matter: `accounts`,
  `user_profiles`, `user_credentials`, `user_api_keys`, `user_budgets`,
  `subscriptions`, `billing_history`, `usage_events`, `promo_codes`,
  `referral_codes`, `code_redemptions`, `audit_log`, `idempotency_keys`,
  `webhook_events`, `integration_*` (4 tables), `github_imports`,
  `project_workspaces`.

Note the `cortex_*` prefixed tables (`cortex_groups`, `cortex_tasks`,
`cortex_task_chats`, `cortex_authority_*`, `cortex_approval_requests`) are
Cortex by name and were counted in the shared bucket by the crude prefix match
above; they belong with Cortex.

Cortex has 0 executed steps and 5 pending steps from May in production, so its
half of this schema can restart at v1 rather than being migrated.

## CI and deploy

| Workflow | Owner |
|---|---|
| `live-model.yml`, `stub-provider-e2e.yml`, `host-db-migration.yml` | **Cortex** |
| `deploy-frontend.yml` | **Socials** — triggers on `heyvera/**` only |
| `heyvera-launch-smoke.yml` | **Socials** |
| `deploy-production.yml` | **Socials** — see below |
| `ci.yml`, `supply-chain.yml`, `automerge.yml`, `add-to-project.yml` | both; trimmed rather than moved |

**`deploy-production.yml` was the open question, and the answer is Socials.**
Its step is still called "Deploy ClawNet", it deploys out of
`/home/<user>/claw-net`, it runs `scripts/deploy.sh` (which builds and rsyncs
the HeyVera SPA), and it health-checks `/v1/social/longform` on port 3001. It
does not deploy Cortex. Cortex deploys through `deploy/cortex-deploy.sh` and
`scripts/deploy-cortex.sh`.

The `claw-net` naming is stale throughout that path and is worth a separate
cleanup; it is not load-bearing for the split.

Cortex-owned Dockerfiles: `Dockerfile`, `Dockerfile.worker`,
`Dockerfile.sandbox`, `Dockerfile.sandbox-provider`, `Dockerfile.sandbox-stub`,
`Dockerfile.runner`, `Dockerfile.egress`.

## What this changes about the extraction

1. **There is no router to lift.** The Cortex HTTP surface must be enumerated
   route by route first. That is the long pole, and it is not a mechanical step.
2. **The shared middle is real.** Auth, Clerk, users, billing, Stripe, rate
   limiting and `AppState` are genuinely used by both. Each needs a decision:
   duplicate into Cortex, or extract to a third crate both depend on.
   Duplicating is faster and defensible while Cortex has no customers.
3. **`db.rs` cannot be split by moving functions.** At 29,593 lines with a
   shared `schema_version` and shared user/billing tables, the Cortex half is
   better rewritten against a fresh v1 schema than carved out — which the
   production state permits, since Cortex has executed nothing.
4. **The history scrub still stands** as described in the tranche 2 plan, and
   is independent of everything above.

## What was not surveyed

Frontend (`cortex/` 25,708 lines of TS/TSX, `heyvera/` separate) beyond
confirming they are separate npm projects with separate CI jobs. `crates/shared`
ownership. Which of the 42 shared tables carry rows that matter. None of these
block writing the extraction PR description; all of them block executing it.
