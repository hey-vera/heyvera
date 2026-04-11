# ClawNet Ecosystem Rollout Plan

This is the cleanest rollout order for the three-repo system:

1. `claw-net`
2. `pulse`
3. `Soma`

## Why This Order

### 1. ClawNet first

ClawNet is the production edge:

- main website
- dashboard
- routing
- billing
- future host of the Soma heart integration

If the release and security workflow is not excellent here, the rest of the ecosystem inherits a shaky foundation.

### 2. Pulse second

Pulse is a private product application that will consume ecosystem context and may also consume `soma-heart`.

It should match ClawNet’s operational discipline, but remain independently deployable so marketing automation issues do not become ClawNet outages.

### 3. Soma third

Soma is the open upstream package layer.

It should get an OSS release workflow, not a VPS deploy workflow.
The important outcome is stable published versions for:

- `soma-heart`
- `soma-sense`

## Correct Integration Model

### Soma

- publish versioned packages
- maintain release quality and provenance
- stay independently testable

### ClawNet

- install `soma-heart` from npm
- integrate it as the primary heart/runtime layer
- pin known-good versions

### Pulse

- optionally install `soma-heart` after ClawNet proves the version in production
- avoid taking experimental Soma versions first unless Pulse is intentionally the canary

## Immediate Execution Order

### Stage 1: ClawNet

1. Turn on branch protection and required checks.
2. Create the GitHub `production` environment.
3. Add Tailscale deploy secrets and variables.
4. Start using `Deploy Production` instead of ad hoc shell deploys.
5. After that is stable, move ClawNet from on-host rebuilds to immutable Docker image deploys.

### Stage 2: Pulse

1. Turn on branch protection and required checks.
2. Create the GitHub `production` environment.
3. Add Tailscale deploy secrets and variables.
4. Start using `Deploy Production`.
5. After stability, move Pulse to immutable deploy artifacts or containers.

### Stage 3: Soma

1. Turn on branch protection and required checks.
2. Create the GitHub `npm-release` environment.
3. Configure npm trusted publishing for `soma-heart` and `soma-sense`.
4. Publish intentional versions from GitHub Actions.
5. Make ClawNet consume released `soma-heart` versions first.
6. Make Pulse consume those released versions second.

## Production Adoption Rule

The cleanest rule is:

- `Soma` publishes
- `ClawNet` adopts first
- `Pulse` adopts second

That keeps the main platform as the canonical integration target while still letting Pulse benefit once the package version is proven.

## What We Should Not Do

- do not make Soma the first repo we operationally harden
- do not make ClawNet or Pulse depend on unpublished local Soma tarballs long-term
- do not let production servers silently rebuild from arbitrary branches
- do not keep long-lived deploy or npm publish tokens when OIDC/trusted publishing is available

## Final Target State

- ClawNet: private production app with reviewed GitHub-environment deploys over Tailscale
- Pulse: private production app with the same discipline
- Soma: public package repo with reviewed CI and trusted npm publishing
- ClawNet and Pulse: consume released Soma packages by version, not by local path
