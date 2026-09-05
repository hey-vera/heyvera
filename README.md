# HeyVera Monorepo

Two products, one Rust backend.

## Start here

- **[AGENTS.md](AGENTS.md)** — what to know before changing anything. Short.
- **[STATE.md](STATE.md)** — what is true now, and who each open thing waits on.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — how a change actually lands. Auto-merge,
  the required checks, `--all-targets`, the shared migration counter.

## Structure

```
cortex/            cortex.heyvera.org (AI coding platform)
  plan/VISION.md   what Cortex is and who for (scope, not status)
  plan/CREDITS.md  what a credit is — the metering decision
  src/             React frontend

heyvera/           heyvera.org (social platform)
  src/             React frontend

crates/            Rust backend (shared, serves both products)
  api/             HTTP API server (port 3001) — both products' routes
  core/            domain types, protocol, verification contract
  engine/          routing, scoring, and the verifier's verdict arithmetic
  worker/          sandboxed execution: worktree, container, egress
  context/         repo map, symbol index, retrieval
  egress/          the mediator a sandbox's only route out goes through
  cortex-server/   Cortex binary
  heyvera-server/  Socials binary
  shared/          types both products use
  tui/             terminal client
  soma*/           fenced behind the `soma` feature, OFF by default

deploy/            deployment scripts and service files
scripts/           build, setup, deploy scripts
docs/              architecture specs and proposals
archive/           old code and docs (reference only, do not build from)
```

## Quick Start

```bash
# Backend
cargo build --release
# CORTEX_SINGLE_NODE=1 is required — the verification dispatcher refuses to
# start without it, because the SQLite store is a Mutex<Connection> and two
# dispatchers grade every delivery twice.
CORTEX_SINGLE_NODE=1 CORTEX_ADMIN_EMAILS="you@email.com" ./target/release/cortex-server

# Cortex frontend
cd cortex && npm install && npm run dev

# HeyVera frontend
cd heyvera && npm install && npm run dev
```

## Deploy

```bash
# VPS backend
scripts/deploy-cortex.sh

# Frontends auto-deploy via Cloudflare Pages on push
```

## Key Docs

- Product vision: [cortex/plan/VISION.md](cortex/plan/VISION.md) — scope and positioning
- Credit unit & metering: [cortex/plan/CREDITS.md](cortex/plan/CREDITS.md) — read before touching billing
- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — **see the 2026-08-02 amendment at the top before relying on any section**
- Operations Room: [docs/reference/cortex-operations-room.md](docs/reference/cortex-operations-room.md)
- CLI auth setup: [docs/operations/cli-auth-setup.md](docs/operations/cli-auth-setup.md)
