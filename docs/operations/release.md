# ClawNet Secure Release Workflow

Status: canonical


This is the recommended production workflow for ClawNet if we want the release path to be modern, reviewable, and difficult to misuse.

## Target State

- Short-lived feature branches and pull requests into `main`.
- Required CI before merge for both the API and the dashboard.
- Dependency Review and CodeQL enabled on pull requests.
- Dependabot updates dependencies weekly.
- Production deploys happen from GitHub Actions, not from ad hoc VPS shell sessions.
- The deploy job joins the tailnet, reaches the private host, runs `scripts/deploy.sh`, and verifies `/api/deploy-info`.
- The production environment requires human approval before deployment secrets are released.

## GitHub Settings To Enable

1. Protect `main`.
2. Require pull requests before merge.
3. Require at least 1-2 approving reviews.
4. Require status checks to pass before merge.
5. Require linear history and block force-pushes.
6. Enable the `production` environment with required reviewers.
7. Restrict the `production` environment to `main`.

Required status checks:

- `api`
- `dashboard`
- `dependency-review`
- `analyze`

## Production Secrets And Variables

Create these in the GitHub `production` environment:

Secrets:

- `TS_OAUTH_CLIENT_ID`
- `TS_OAUTH_SECRET`

Variables:

- `TAILSCALE_HOST`
- `DEPLOY_USER`
- `PUBLIC_API_URL`

Recommended values:

- `DEPLOY_USER=deploy`
- `PUBLIC_API_URL=https://api.claw-net.org`

## Production Deploy Flow

1. Open a pull request.
2. Wait for CI, Dependency Review, and CodeQL to pass.
3. Review and merge to `main`.
4. Run `Deploy Production` from GitHub Actions.
5. Approve the `production` environment deployment.
6. Verify `https://api.claw-net.org/api/deploy-info`.

## HeyVera Launch Smoke Gate

HeyVera production cutover has an extra public smoke gate because the frontend
origin and API origin can be routed independently:

```bash
HEYVERA_SMOKE_MODE=pre-proxy bash scripts/heyvera-launch-smoke.sh
```

Run this before enabling the Cloudflare Pages `/v1/*` proxy. It is allowed to
find that `api.heyvera.org/v1/health` is not ready yet, but it fails if
`heyvera.org/v1/health` appears to be serving API JSON before the upstream
`api.heyvera.org/v1/health` path is healthy.

After upstream `/v1` exists and the Pages proxy is intentionally enabled, run:

```bash
HEYVERA_SMOKE_MODE=post-proxy bash scripts/heyvera-launch-smoke.sh
```

Post-proxy mode requires both `https://api.heyvera.org/v1/health` and
`https://heyvera.org/v1/health` to return non-HTML 2xx JSON. Do not merge or
enable PR `#231`, or any equivalent Pages `/v1` proxy, before the pre-proxy
gate has a clean result and the upstream `/v1` route is known to be ready.

## Why This Is Stronger

- It stops normal production deploys from depending on one person’s shell habits.
- It makes the deployed branch and commit visible after every release.
- It keeps the runtime host private behind Tailscale.
- It treats deployment approval as an explicit control instead of an implicit ritual.

## Next Step After This

The next jump beyond this workflow is immutable artifact deployment:

- build the Docker image in CI,
- push it to a registry by digest,
- generate provenance/SBOM attestations,
- and have production pull that exact digest instead of rebuilding from Git on the host.

That is the path from "strong modern workflow" to "platform-grade release engineering."
