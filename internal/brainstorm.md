# Brainstorm — running log of future ideas across all projects

**Purpose:** single source of truth for things we're NOT building right now but don't want to forget. When we resume building, start here.

**Organized by project.** Cross-reference other strategy docs when relevant.

**Last updated:** 2026-04-04.

---

## ClawNet

### Near-term (unblocked, not prioritized)

- **Telemetry dashboard** — expose `/v1/stats/*` endpoints: per-endpoint usage, cache hit rates, x402 ETag savings, top agents, revenue by endpoint
- **Agent wallets v2** — delegated spend + time-bound budgets + per-endpoint limits
- **Endpoint health SLA** — auto-suspend endpoints with <95% uptime over 24h
- **Multi-region cache** — same certified cache layer, replicated across regions
- **Rate limit marketplace** — let providers sell rate-limit allocation (e.g., "1000 calls/sec premium tier")
- **Webhook subscriptions** — agents subscribe to "notify when endpoint X hash changes"
- **Cost prediction** — agent submits a planned workload, we estimate spend with/without x402 ETag
- **Bulk credit packs** — pre-purchase credits at discount, expire unused after N months
- **Solana-native billing** — USDC deposits via Phantom, direct-to-endpoint settlement, skip our credit layer
- **Promo code engine v2** — referral codes, campaign attribution, A/B testing
- **Provider analytics** — show providers their endpoint performance, consumer demographics, revenue trends

### Future

- **Agent reputation system** — score agents by polling discipline, payment reliability, hit rates; feeds into x402 ETag discount tiers
- **Cross-provider dedup** — multiple providers offering identical data (BTC price) → serve once, credit all providers proportionally
- **Private endpoints** — Clerk-auth-only endpoints for sensitive data
- **MCP-native discovery** — ClawNet as MCP server so Claude Desktop finds endpoints natively
- **Endpoint notebooks** — Jupyter-style notebooks that bundle endpoint calls + analysis, shareable
- **Endpoint composition language** — DSL for chaining endpoints (ETL pipelines via API calls)
- **Treasury diversification** — don't hold all USDC on one wallet; multi-sig, yield-bearing strategies
- **Token launch ($CLAWNET)** — per project_token_economics memory, tiered revenue share

### Open questions

- Should credits be deprecated in favor of direct USDC?
- Should we self-host LLM (for orchestration) vs use OpenAI forever?
- Should orchestration be moved to agents (they pick endpoints) or stay server-side?

---

## Soma

### Near-term (blocked by scale test)

See `internal/scale-test-plan.md` for the 4-phase scaling sequence.

### Post-scale Tier A (must-have for future-readiness)

Per `internal/soma-future-proofing.md`:
1. Complete PQ migration (ML-DSA-65 full implementation, not stub)
2. Event-unit abstraction (rename per-token HMAC → per-event HMAC conceptually)
3. Genome evolution chain (self-modifying agents)
4. Real TEE integration (AWS Nitro end-to-end)

### Post-scale Tier B (strategic positioning)

5. Aggregate signatures / BLS (swarm identity)
6. Agent-lineage DAG (parent-child spawning)
7. Feature-extractor plugin interface (modality-agnostic fingerprinting)
8. Ephemeral heart pattern (just-in-time identity)

### Post-scale Tier C (research-level)

9. ZK-proof primitives (privacy-preserving attestation)
10. On-chain verdict contracts (Solidity reference)
11. Threshold-of-observers verification
12. Trusted-time oracle integration

### Other ideas

- **Soma SDK ports** — Python, Rust, Go, Java soma-heart implementations (currently TypeScript-only)
- **Soma browser extension** — observer runs in browser, verifies any agent you interact with
- **Soma for MCP servers** — every MCP server auto-gets a Soma heart, every MCP client auto-runs sense
- **Soma as a service** — hosted sensorium (for users who can't run it locally)
- **Attack harness extension** — add adversarial ML attacks (gradient-leakage, membership inference)
- **Soma Check v2** — hash commitments on-chain (provider can't backdate "unchanged" lies)

### Known gaps (from audit)

- Dual-sign still dead — needs design work
- Birth cert signing incomplete — Phase 1 shortcut via `_lastBirthCert`, refactor needed
- Provenance policy deferred — cache paths don't produce certs yet

---

## x402 ETag

Full strategy in `internal/x402-etag-strategy.md`. Summary of things not actioned yet:

### Tier 2 — strategic moat
- Claim `x402-etag.org` domain
- Publish spec as IETF informational I-D
- Public registry of enabled endpoints
- Certification badge program
- Edge proxy offering (`etag.clawnet.com`)
- Reference middlewares for every framework

### Tier 3 — protocol family
- x402 Batch (probe many hashes in one call)
- x402 Subscribe (SSE push on hash change)
- x402 Range (pay only for new records in list responses)
- x402 Vary (multi-variant pricing)

### Tier 4 — trust & safety
- Soma cert chain on every hash (cryptographic "can't lie about unchanged")
- TEE-attested ETag (premium tier)
- Dispute/insurance layer (staked USDC)
- On-chain hash commitments

### Tier 5 — data/analytics
- Analytics API (hit rates, freshness, change frequency)
- Agent behavior scoring
- Cross-provider dedup

### Open questions (from strategy doc)
- Drop `X-Soma-Hash` header in v1.0 or keep both forever?
- Authenticate `/check` probe or keep free-public?
- Publish spec before or after clawapis pilot?
- Registry pricing: flat fee vs % of calls?
- Open-source middleware or ClawNet-exclusive?

---

## Pulse

(Referenced in memory — separate repo, different context.)

Per `project_pulse_session_20260330` memory: major build landed (Create, Growth, billing, chat tools, security, OAuth, Brand Intelligence, adaptive preferences). No immediate TODOs surfaced here.

If/when Pulse integrates with ClawNet endpoints: opportunity for Pulse agents to use x402 ETag for efficient polling.

---

## Cross-cutting (applies to multiple projects)

### Infrastructure

- **Multi-node deployment** — scale guardian-vps to a cluster (needed for Soma 1000-heart test)
- **Observability stack** — unified logging/metrics across ClawNet, Pulse, Soma
- **Backup/DR plan** — SQLite WAL is brittle at scale, need real backup strategy
- **CI/CD for Soma** — auto-publish soma-heart/soma-sense on tag, run tests on PR

### Documentation

- **Public Soma docs gaps** (per `project_soma_docs_gaps` memory): API reference, tutorials, migration guide, protocol spec in one place
- **ClawNet public docs** — currently internal; carve out a public subset for providers/agents
- **x402 ETag spec** — publish RFC-style spec at x402-etag.org (Tier 2 item)

### Business / ecosystem

- **Token launch** ($CLAWNET) — per `project_token_economics` memory
- **Partnership pipeline** — clawapis first, then identify next 3-5 paid API providers to pitch
- **Conference strategy** — Coinbase x402 dev event March 2026 (per `project_x402_ecosystem` memory)
- **Market positioning** — Artemis market map (per `project_competitive_landscape`)
- **Gumroad packages** — 6 paid + 10 free (per `project_gumroad_packages`)

### Research

- **Agent economy modeling** — how does agent spend evolve as they scale from 1 → 1M → 1B agents?
- **Identity-privacy tradeoff** — how much identity to reveal for trust vs how little for privacy?
- **Protocol game theory** — what incentive structure keeps providers honest in x402 ETag without TEE?

---

## When we resume building

**Checklist for picking back up:**

1. Re-read this file (brainstorm.md)
2. Re-read `internal/x402-etag-strategy.md` for priorities
3. Re-read `internal/soma-future-proofing.md` for positioning invariants
4. Check task list for pending items (#77 Soma 100-hearts bench, #106-110 x402 ETag Tier 1)
5. Check memory for recent decisions
6. Pick the highest-leverage item from Tier 1 of whichever strategy doc applies

**First three things to do on resume (recommended):**
1. Lock x402-etag.org domain (defensive, 5 minutes)
2. Build 100-hearts Soma scale bench (unblocks everything)
3. USDC telemetry + discovery flag on ClawNet (unblocks clawapis)

---

## Meta — how to keep this doc useful

- Append, don't restructure, until the file gets too long (>500 lines), then split
- Every idea gets one line minimum — capture first, elaborate later
- Cross-reference other docs instead of duplicating content
- When an item moves to "active build," delete it here (it's tracked elsewhere)
- Review this file at start of each new session (reload context)
