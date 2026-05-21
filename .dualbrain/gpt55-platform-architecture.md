╔══════════════════════════════════════════════════╗
║  🧠 Dual-Brain Think · Round 1 — Initial         ║
╠══════════════════════════════════════════════════╣
║ Question: DEEP ANALYSIS: HeyVera Multi-Surface Plat... ║
╠══════════════════════════════════════════════════╣
║ 🤖 GPT-5.5 (97.6s):                              ║
╠══════════════════════════════════════════════════╣

I’ll treat this as an architecture review rather than changing the repo. I’m going to verify the local repo shape and any existing docs first so the recommendation is grounded in the actual project context, then I’ll give the Round 1 perspective in the requested structure.

The workspace is a HeyVera repo on `feat/cortex-billing-ui`, with an existing mixed TypeScript/Rust shape and Rust crates already named more generically than the proposed layout. I’m checking the current ADRs and Cargo workspace next, because that affects whether the answer should recommend a greenfield crate taxonomy or an incremental platform spine.

**1. RECOMMENDATION**

Build HeyVera as a **single Rust platform binary with a small shared platform kernel, surface modules, and Postgres-backed shared infrastructure from day 1**. Do not create a crate per future sub-feature yet; create clear trait boundaries and route/service boundaries so Social, Marketplace, Crypto, Hosting, Data APIs, Billing, Cortex, and VeraAI can later split by scaling pressure.

**2. RATIONALE**

1. The current proposed crate layout is too Cortex/Vera/Soma-centered for an 8-surface platform. It models the intelligence/protocol spine, but not the platform substrate: auth, accounts, billing, jobs, storage, search, notifications, metering, policy, and surface routing.

2. The right v1 shape is closer to Rails/Supabase than microservices: one deployable, one database, shared primitives, strong module boundaries. Split binaries only when operational evidence demands it.

3. Compile-time feature flags should control optional dependencies and build targets. Runtime config should control whether a surface is enabled. Product surfaces should not require recompilation to turn on/off in production.

4. Postgres should be the default platform database if HeyVera is serious about Social, Marketplace, Hosting, x402 APIs, Billing, and multi-user trust state. SQLite is fine for embedded Cortex prototypes, local dev, or workers, but it becomes painful once feeds, search, billing ledgers, background jobs, and marketplace queries collide.

5. The v1 architecture must preserve trust boundaries more than implementation boundaries. Soma protocol truth, user/account truth, billing truth, and execution/runtime truth should be separated even if they live in one binary.

---

**3. ALTERNATIVES**

Rejected: **crate-per-subsystem from the start**.

Example:

```text
social-feed
social-posts
social-agents
marketplace-listings
marketplace-reviews
marketplace-escrow
crypto-wallet
crypto-bridge
hosting-scheduler
hosting-metering
...
```

This looks organized but is premature. It creates API churn before the domain model is proven.

Rejected: **everything inside `heyvera-server`**.

Fast at first, but it makes the platform impossible to reason about once auth, billing, feed writes, trust proofs, agent execution, and marketplace state all share unstructured app code.

Rejected: **microservices now**.

Social, Cortex, Hosting, Billing, Crypto, and Marketplace will eventually have different scaling profiles, but splitting before traffic and ownership exist creates distributed-system cost without distributed-system benefit.

Rejected: **SQLite for all v1 platform state**.

SQLite is excellent for single-node operational state and local-first workers. It is not the best foundation for a multi-surface hosted platform with feeds, marketplace search, billing ledgers, background leases, object metadata, and future horizontal scale.

---

**4. RISKS**

The largest risk is underestimating the platform layer. If HeyVera starts as “Cortex plus some routes,” every later surface will reinvent auth, billing, jobs, storage, search, and policy.

Second risk: over-modeling Soma/Vera crates before product surfaces exist. `soma-core`, `soma-wire`, `soma-proof`, `vera-core`, `vera-dag`, and `vera-eval` may be valid eventually, but v1 probably only needs a small `soma` client/verifier crate and a `vera-core` abstraction unless those layers already have independent consumers.

Third risk: the single binary can become a monolith in the bad sense if module boundaries are informal. The answer is not multiple binaries yet; it is explicit interfaces, dependency direction, and per-surface route/service/repository boundaries.

Fourth risk: Postgres day 1 adds operational weight. But for this product class, that weight is likely less than the future cost of migrating platform-critical state out of SQLite.

---

**5. CONFIDENCE**

High, not literal 99%.

I have high confidence in the architectural direction: **single binary, shared platform kernel, runtime-enabled surfaces, Postgres as platform store, clear trait boundaries, defer service splitting**. I would not claim 99% certainty on exact crate names or database engines for every subsystem because traffic shape, product sequencing, and Soma protocol maturity can change the answer.

---

**6. VERIFICATION**

Validate the decision with these gates:

1. Build a vertical Cortex slice using the proposed platform kernel: auth, principal extraction, billing/metering, background job, event append, route registration, and audit trail.

2. Add one thin Social slice: create post, timeline read, notification event, agent-authored post. If this requires bypassing the platform layer, the boundaries are wrong.

3. Add one Marketplace slice: listing, purchase intent, metered/x402 access, review/audit event. If billing or identity logic forks from Cortex, the shared substrate is too weak.

4. Run load simulations separately:
   - Cortex: CPU/LLM orchestration-heavy.
   - Social: write/read/feed-heavy.
   - Marketplace: search/query-heavy.
   - Hosting: job/resource-metering-heavy.

5. Split only when one surface shows independent scaling, deployment, fault isolation, or security requirements.

---

## Crate Layout Validation

The current proposal:

```text
soma-core
soma-wire
soma-proof

vera-core
vera-dag
vera-eval

cortex-engine
cortex-router
cortex-api

heyvera-server
```

This is structurally clean for protocol/intelligence/orchestration, but incomplete for a platform.

I would reshape v1 around this:

```text
heyvera-server        # single axum binary, config, route mounting, lifecycle

heyvera-core          # shared domain types: ids, accounts, principals, money, errors
heyvera-config        # env/config loading, feature/surface toggles
heyvera-db            # migrations, pool, transactions, repository helpers
heyvera-auth          # Clerk humans, Soma agents, service principals
heyvera-policy        # authorization, delegation checks, RBAC/ABAC policy
heyvera-events        # append-only domain events, audit log, outbox
heyvera-jobs          # background jobs, leases, retries, scheduler
heyvera-billing       # subscriptions, credits, x402, usage ledger
heyvera-storage       # blob abstraction: local/S3-compatible
heyvera-search        # search abstraction: Postgres FTS first, Meili/Tantivy later
heyvera-notify        # in-app/email/push notification abstraction
heyvera-metering      # usage, cost, quotas, rate-limit dimensions

soma                  # client/verifier/proof/delegation integration, not protocol source of truth
vera-core             # intelligence interfaces and common types, minimal v1
cortex                # orchestration domain
social                # posts, follows, timelines, communities, agent posting
marketplace           # listings, purchases, reviews, escrow hooks
crypto                # wallet/token/chain interface layer, probably thin v1
hosting               # agent/app hosting model, deployments, resource leases
data-api              # x402-gated datasets/services
```

For v1, I would **not** split Social into `social-feed`, `social-storage`, `social-scheduler` crates. Keep those as modules inside `social`:

```text
social::posts
social::graph
social::timeline
social::communities
social::agent_posts
social::moderation
```

Marketplace likewise:

```text
marketplace::listings
marketplace::reviews
marketplace::orders
marketplace::escrow
marketplace::search
```

Crypto should stay thin:

```text
crypto::wallets
crypto::chains
crypto::tokens
crypto::provenance
```

Do not write token-contract infrastructure in the platform crate unless HeyVera is actually compiling/deploying contracts itself. Prefer interfaces/adapters first.

Hosting needs:

```text
hosting::deployments
hosting::runtimes
hosting::leases
hosting::metering
hosting::health
```

But v1 can be declarative records and worker hooks, not a full Kubernetes clone.

---

## Single Binary Architecture

One Rust binary can serve 8 surfaces by using one shared `AppState` and mounting each surface as a route tree:

```text
/api/cortex/*
/api/social/*
/api/marketplace/*
/api/crypto/*
/api/hosting/*
/api/data/*
/api/billing/*
/api/vera/*
```

Each surface owns its handlers, services, repositories, and events. Shared crates provide auth, policy, billing, jobs, events, storage, and observability.

Use compile-time features for:

```text
postgres
sqlite
s3
local-storage
meilisearch
tantivy
solana
stripe
clerk
```

Use runtime toggles for:

```text
surface.social.enabled
surface.marketplace.enabled
surface.crypto.enabled
surface.hosting.enabled
surface.data_api.enabled
surface.vera.enabled
```

Internal communication should be:

1. Direct function/service calls for synchronous workflows.
2. Domain events/outbox for cross-surface side effects.
3. Background jobs for retries, scheduling, fanout, billing sync, notifications, and agent automation.

Split into multiple binaries when one of these becomes true:

1. Cortex compute saturation hurts IO-heavy Social.
2. Hosting needs stronger sandbox/security isolation.
3. Billing/ledger needs tighter blast-radius control.
4. Social feed workers need independent horizontal scale.
5. A surface needs its own deployment cadence or owner.
6. Runtime memory/CPU profiles become incompatible.

The likely first split is not “Social API service.” It is probably:

```text
heyvera-server        # public API
heyvera-worker        # jobs, fanout, agents, billing sync
heyvera-host-runner   # isolated hosting/execution plane
```

---

## Database Strategy

Use **Postgres as the primary platform database**.

Recommended v1:

```text
Postgres:
- users/accounts/profiles
- auth bindings
- social posts/comments/follows
- marketplace listings/orders/reviews
- billing ledger
- x402 payment records
- jobs/leases
- domain events/outbox
- audit log
- hosting deployment metadata
- Soma proof references and verification records

S3-compatible object storage:
- uploads
- artifacts
- logs
- generated assets
- hosted agent bundles

Postgres FTS initially:
- marketplace search
- user/content search
- docs/data API search if simple

External search later:
- Meilisearch for product/content search UX
- Tantivy if embedded/self-contained search is strategically important

Redis later:
- hot feed cache
- rate-limit counters at scale
- ephemeral sessions/presence
- pubsub fanout
```

Event store: use Postgres append-only tables first.

```text
domain_events
soma_observations
trust_proofs
audit_events
outbox_events
```

Do not introduce Kafka/NATS/EventStoreDB until the single database outbox is insufficient.

Feed strategy:

- v1: fan-out-on-read for small scale.
- Next: hybrid.
- Fan-out-on-write for celebrity/community/high-read paths only when needed.
- Maintain `timeline_items` if product UX requires fast home timelines.

Blob storage:

- Dev: local filesystem or MinIO.
- Prod: S3-compatible storage from day 1 if uploads/artifacts matter.

SQLite-to-Postgres migration without downtime is possible but annoying:

1. Put repository traits in front of storage.
2. Add Postgres schema.
3. Dual-write new mutations to SQLite and Postgres.
4. Backfill historical rows.
5. Run read-shadow comparisons.
6. Flip reads to Postgres per table/surface.
7. Freeze SQLite writes.
8. Retire SQLite.

But the better answer is: avoid that migration for hosted platform state. Use SQLite only for local/worker/embedded state.

---

## Shared Infrastructure

Authentication should produce a single principal type:

```rust
enum Principal {
    Human { user_id, clerk_id, session_id },
    Agent { agent_id, soma_subject, delegation },
    Service { service_id },
}
```

Clerk and Soma can share middleware at the extraction layer, but verification logic should be separate internally.

Authorization should be policy-based:

```text
RBAC for coarse admin/operator roles
ABAC for resource ownership and contextual checks
Soma delegation for agent authority and provenance
```

Notifications should be shared infrastructure:

```text
in_app_notifications
notification_preferences
email_jobs
push_jobs
webhook_jobs
```

Background jobs should use a durable DB-backed queue first:

```text
jobs table
leased_by
lease_until
attempt_count
run_after
idempotency_key
payload_json
```

Tokio tasks are fine for workers executing jobs, but the queue itself should be durable.

Caching should be shared as infrastructure but keyed per surface:

```text
cache namespace: social:timeline:...
cache namespace: marketplace:listing:...
cache namespace: cortex:decision:...
```

Rate limiting should be shared middleware with per-surface policies:

```text
principal
ip
api key
surface
route class
payment tier
soma delegation scope
```

---

## API Design

Use REST/JSON for v1 public and frontend APIs.

GraphQL is attractive for multi-surface product composition, but it adds resolver complexity and authorization risk. tRPC is not a good fit for a Rust backend as the main contract.

Use:

```text
REST/JSON: primary app API
SSE: notifications, feed updates, run status, lightweight real-time
WebSocket: worker connections, bidirectional agent sessions, interactive execution
OpenAPI: public API contract
```

Versioning:

```text
/api/v1/...
```

Also version protocol-ish payloads independently:

```text
Soma proof version
x402 payment claim version
Cortex run schema version
event schema version
```

All surfaces should share one API gateway/binary in v1, but each should own its route tree.

Internal service-to-service APIs are unnecessary inside one binary. Use traits and service calls. Use the outbox/events for async cross-surface workflows.

---

## Migration From ClawNet

ClawNet mapping:

```text
intent parser       -> cortex::intent / cortex::planner
executor            -> cortex::execution / cortex-worker / hosting runner later
formatter           -> cortex::output / response composer
API registry        -> heyvera-connectors or platform registry
cost tracking       -> heyvera-metering + heyvera-billing ledger
heartbeat           -> soma session heartbeat + worker/session liveness
rate limiting       -> heyvera-rate-limit middleware
Clerk auth          -> heyvera-auth::human
Soma auth           -> heyvera-auth::agent
billing credits     -> heyvera-billing
social db/routes    -> social crate/module
```

Rust equivalents:

```text
Hono                -> axum
middleware          -> tower layers
better-sqlite3      -> sqlx Postgres, or rusqlite only for local mode
raw SQL             -> sqlx query macros or explicit SQL migrations
Redis cache         -> deadpool-redis / fred, deferred until needed
background loops    -> tokio workers + durable jobs table
Zod-ish validation  -> serde + validator/garde
JWT verification    -> jsonwebtoken + Clerk JWKS fetch/cache
logging             -> tracing + tracing-subscriber
metrics             -> opentelemetry/prometheus
```

Drop Node-specific patterns:

```text
Express/Hono-style global mutable app state
ad hoc JSON validation
JS package-level singleton registries
runtime monkeypatch/shim patterns
untyped provider payloads
```

Keep the concepts, not the implementation style.

---

## Future-Proofing Without Over-Engineering

Must exist in v1:

```text
Principal model: Human, Agent, Service
Policy/delegation checks
Billing/metering ledger
Domain event/outbox table
Durable jobs
Storage abstraction
Search abstraction, even if backed by Postgres FTS
Surface route registration
Repository/service boundaries
Audit log
Idempotency keys
Schema migrations
Observability: tracing, metrics, request IDs
```

Can be deferred:

```text
microservices
Kafka/NATS
Kubernetes-style hosting scheduler
full token launch machinery
complex marketplace escrow
advanced feed ranking
GraphQL
multi-region
custom plugin runtime
external search cluster
Redis-heavy caching
formal WASM extension sandbox
```

Trait boundaries worth defining now:

```rust
trait AuthVerifier
trait PolicyEngine
trait MeteringSink
trait BillingLedger
trait EventBus
trait JobQueue
trait BlobStore
trait SearchIndex
trait SomaVerifier
trait AgentExecutor
trait PaymentRail
trait NotificationSink
```

Plugin points should exist around:

```text
LLM/provider connectors
Soma proof/verifier integration
payment rails: Stripe, x402, USDC/Solana
storage backends
search backends
hosting runtimes
marketplace asset types
data API providers
agent execution backends
```

Third-party developers should build on HeyVera through this order:

1. Public REST API + OpenAPI spec.
2. TypeScript SDK for web/product developers.
3. Rust SDK for agent/runtime developers.
4. Webhooks and x402-gated API publishing.
5. Later: plugin ABI or WASM modules, only after real extension patterns are known.

The minimal viable platform layer is therefore:

```text
identity + policy
billing + metering
events + jobs
storage + search abstraction
surface routing
auditability
Soma verification boundary
Cortex as first serious consumer
```

That gives HeyVera enough structure to become a multi-surface sovereign platform without pretending every future surface is already mature.

╠══════════════════════════════════════════════════╣
║ 📝 Your turn: analyze independently, then call   ║
║    Round 2 with --round 2 --claude-says "..."    ║
║    for GPT's rebuttal to your analysis.          ║
╚══════════════════════════════════════════════════╝
