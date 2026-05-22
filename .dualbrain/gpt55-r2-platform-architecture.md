I’ll verify current crate versions and production patterns first, then synthesize this into a buildable Rust platform design rather than relying on stale ecosystem memory.
The recent signal is consistent: Axum/Tower remains the service spine; `tracing` is still the Rust-native instrumentation API; production export generally goes through OTLP plus Prometheus/Grafana. TensorZero’s public benchmark claims are specifically useful for Cortex because they show Rust gateway overhead targets below 1 ms p99 under high concurrency.
Below is the Round 2 build plan I would hand to an engineer. Crate versions are current as of May 19, 2026. Note: `sqlx` has `0.9.0-alpha.1`, but I would pin stable `0.8.6` for platform work.

Sources used: Axum docs, sqlx docs, thiserror docs, Testcontainers docs, OpenTelemetry Rust docs, TensorZero benchmarks, PostgreSQL LISTEN/NOTIFY docs, and current crates.io metadata. Key references: [Axum 0.8.9](https://docs.rs/axum/latest/axum/), [sqlx 0.8.6](https://docs.rs/sqlx/latest/sqlx/), [PgListener](https://docs.rs/sqlx/latest/sqlx/postgres/struct.PgListener.html), [thiserror 2.0.18](https://docs.rs/thiserror/latest/thiserror/derive.Error.html), [OpenTelemetry Rust](https://opentelemetry.io/docs/languages/rust/), [TensorZero benchmarks](https://www.tensorzero.com/docs/gateway/benchmarks), [Postgres LISTEN/NOTIFY](https://www.postgresql.org/docs/16/libpq-notify.html).

**1. Platform Kernel Rust Design**

Workspace shape:

```text
crates/
  heyvera-core        # ids, time, money, Principal, AppState
  heyvera-config      # env/config loading
  heyvera-db          # PgPool, migrations, transaction helpers
  heyvera-auth        # Clerk/Soma/session verification, Axum extractors
  heyvera-policy      # authorization decisions
  heyvera-events      # domain event append + pub/sub
  heyvera-jobs        # durable job queue
  heyvera-billing     # ledger/subscription/x402 domain
  heyvera-observe     # tracing/metrics/request IDs
  cortex              # orchestration + context assembler
  api                 # Axum router composition
```

Recommended pins:

```toml
axum = "0.8.9"
tower = "0.5.3"
tower-http = { version = "0.6.11", features = ["trace", "request-id", "cors", "timeout", "compression-gzip"] }
tokio = { version = "1.52.3", features = ["rt-multi-thread", "macros", "signal"] }
sqlx = { version = "0.8.6", features = ["runtime-tokio", "tls-rustls-aws-lc-rs", "postgres", "uuid", "time", "json", "migrate"] }
thiserror = "2.0.18"
anyhow = "1.0.102"
tracing = "0.1.44"
tracing-subscriber = "0.3.23"
tracing-opentelemetry = "0.33.0"
opentelemetry = "0.32.0"
opentelemetry-otlp = "0.32.0"
metrics = "0.24.6"
metrics-exporter-prometheus = "0.18.3"
serde = "1.0.228"
serde_json = "1.0.149"
uuid = { version = "1.23.1", features = ["v7", "serde"] }
```

`heyvera-auth` should expose both a Tower middleware and an Axum extractor. Middleware verifies once, stores `Principal` in request extensions; handlers extract typed identity.

```rust
#[derive(Clone, Debug)]
pub enum Principal {
    Human { account_id: Uuid, user_id: Uuid, session_id: Uuid },
    Agent { account_id: Uuid, agent_did: String, delegation_id: Option<Uuid> },
    Service { service: String },
}

pub async fn auth_layer(
    State(state): State<AppState>,
    mut req: Request<Body>,
    next: Next,
) -> Result<Response, ApiError> {
    let principal = state.auth.verify_request(req.headers()).await?;
    req.extensions_mut().insert(principal);
    Ok(next.run(req).await)
}

#[async_trait]
impl<S> FromRequestParts<S> for Principal
where
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        parts.extensions.get::<Principal>()
            .cloned()
            .ok_or(ApiError::unauthorized("missing principal"))
    }
}
```

Use this layering:

```rust
Router::new()
  .route("/api/chat", post(chat))
  .route_layer(middleware::from_fn_with_state(state.clone(), auth_layer))
  .layer(TraceLayer::new_for_http())
  .with_state(state)
```

`heyvera-events` should treat Postgres as durable truth and `LISTEN/NOTIFY` as wakeup acceleration, not as the durable event store.

```rust
pub trait EventBus: Send + Sync {
    async fn append(&self, tx: &mut PgConnection, event: NewDomainEvent) -> Result<Uuid, EventError>;
    async fn publish_after_commit(&self, topic: &str, id: Uuid) -> Result<(), EventError>;
    fn subscribe(&self, topic: &'static str) -> broadcast::Receiver<DomainEvent>;
}
```

Implementation:

- Insert into `domain_events`.
- Emit in-process `tokio::sync::broadcast`.
- Also `pg_notify('domain_events', json_build_object('id', id, 'topic', topic)::text)`.
- Background `PgListener::connect_with(pool)` listens and rehydrates events by ID.
- On listener reconnect, poll `domain_events where id > last_seen_id` to close missed-notify gaps.

`heyvera-jobs` should use Postgres row leases with `FOR UPDATE SKIP LOCKED`. Do not hold DB transactions while executing jobs.

Core dequeue SQL:

```sql
WITH next_job AS (
  SELECT id
  FROM jobs
  WHERE status = 'pending'
    AND run_at <= now()
    AND queue = $1
  ORDER BY priority DESC, run_at ASC, created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE jobs j
SET status = 'running',
    leased_by = $2,
    leased_until = now() + ($3::int || ' seconds')::interval,
    attempts = attempts + 1,
    updated_at = now()
FROM next_job
WHERE j.id = next_job.id
RETURNING j.*;
```

Failure logic:

```text
if attempts < max_attempts:
  status='pending'
  run_at = now() + min(15m, 2^attempts seconds + jitter)
else:
  status='dead'
```

Add a sweeper:

```sql
UPDATE jobs
SET status = 'pending',
    leased_by = NULL,
    leased_until = NULL,
    run_at = now(),
    updated_at = now()
WHERE status = 'running'
  AND leased_until < now();
```

**2. Postgres Schema V1**

Use UUIDv7 from the app. Use append-only ledgers for money and trust-relevant records. Use `jsonb` for provider payloads, but stable top-level columns for query paths.

```sql
CREATE TYPE principal_kind AS ENUM ('human','agent','service');
CREATE TYPE job_status AS ENUM ('pending','running','succeeded','failed','dead','cancelled');
CREATE TYPE subscription_status AS ENUM ('trialing','active','past_due','cancelled','incomplete');
CREATE TYPE payment_status AS ENUM ('pending','settled','failed','refunded');

CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  clerk_user_id text UNIQUE NOT NULL,
  email text,
  display_name text,
  role text NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_account_idx ON users(account_id);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clerk_session_id text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_active_idx ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  stripe_customer_id text,
  stripe_subscription_id text UNIQUE,
  status subscription_status NOT NULL,
  plan_code text NOT NULL,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_account_idx ON subscriptions(account_id);

CREATE TABLE billing_ledger (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  principal_kind principal_kind NOT NULL,
  principal_id text NOT NULL,
  entry_type text NOT NULL,
  amount_usd_micros bigint NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  external_ref text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (amount_usd_micros <> 0)
);
CREATE INDEX billing_ledger_account_time_idx ON billing_ledger(account_id, created_at DESC);
CREATE UNIQUE INDEX billing_ledger_external_ref_idx ON billing_ledger(external_ref) WHERE external_ref IS NOT NULL;

CREATE TABLE x402_payments (
  id uuid PRIMARY KEY,
  account_id uuid REFERENCES accounts(id),
  payer_did text,
  resource_hash text NOT NULL,
  etag text NOT NULL,
  chain text NOT NULL DEFAULT 'solana',
  asset text NOT NULL DEFAULT 'USDC',
  amount_base_units bigint NOT NULL CHECK (amount_base_units > 0),
  tx_signature text UNIQUE,
  status payment_status NOT NULL,
  received_at timestamptz,
  settled_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX x402_resource_idx ON x402_payments(resource_hash, etag);
CREATE INDEX x402_payer_idx ON x402_payments(payer_did, created_at DESC);

CREATE TABLE soma_delegations (
  id uuid PRIMARY KEY,
  account_id uuid REFERENCES accounts(id),
  issuer_did text NOT NULL,
  subject_did text NOT NULL,
  scope text NOT NULL,
  caveats jsonb NOT NULL DEFAULT '{}',
  spend_cap_base_units bigint,
  not_before timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  proof_cid text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX soma_delegations_subject_active_idx
  ON soma_delegations(subject_did, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE domain_events (
  id uuid PRIMARY KEY,
  topic text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  version int NOT NULL,
  actor_kind principal_kind NOT NULL,
  actor_id text NOT NULL,
  payload jsonb NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aggregate_type, aggregate_id, version)
);
CREATE INDEX domain_events_topic_time_idx ON domain_events(topic, occurred_at DESC);
CREATE INDEX domain_events_aggregate_idx ON domain_events(aggregate_type, aggregate_id, version);

CREATE TABLE jobs (
  id uuid PRIMARY KEY,
  queue text NOT NULL,
  kind text NOT NULL,
  status job_status NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL,
  priority int NOT NULL DEFAULT 0,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  run_at timestamptz NOT NULL DEFAULT now(),
  leased_by text,
  leased_until timestamptz,
  last_error text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_poll_idx ON jobs(queue, status, priority DESC, run_at, created_at)
  WHERE status = 'pending';
CREATE INDEX jobs_lease_idx ON jobs(status, leased_until)
  WHERE status = 'running';
CREATE UNIQUE INDEX jobs_idempotency_idx ON jobs(queue, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE audit_log (
  id uuid PRIMARY KEY,
  account_id uuid REFERENCES accounts(id),
  actor_kind principal_kind NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  ip inet,
  user_agent text,
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_account_time_idx ON audit_log(account_id, created_at DESC);
CREATE INDEX audit_actor_time_idx ON audit_log(actor_kind, actor_id, created_at DESC);
```

**3. Context Assembler Design**

This belongs in `crates/cortex/src/context`. Treat it as Cortex’s margin engine.

```rust
pub trait ContextAssembler: Send + Sync {
    async fn discover_files(&self, input: &ContextRequest) -> Result<FileGraph, ContextError>;
    async fn narrow_scope(&self, graph: FileGraph, budget: TokenBudget) -> Result<ScopeSet, ContextError>;
    async fn enrich_errors(&self, scope: ScopeSet, signals: ErrorSignals) -> Result<ScopeSet, ContextError>;
    async fn inject_history(&self, scope: ScopeSet, convo: ConversationId) -> Result<AssembledContext, ContextError>;
}
```

Crates:

```toml
tree-sitter = "0.26.9"
tree-sitter-rust = "0.24.2"
syn = { version = "2.0.117", features = ["full", "visit"] }
ropey = "2.0.0-beta.1" # or stay on 1.x if beta risk is unacceptable
ignore = "0.4"
globset = "0.4"
notify = "9.0.0-rc.4" # only if live file watching is required
tantivy = "0.25"      # local lexical index
tokenizers = "0.22"   # token budgeting
```

Pipeline:

1. `discover_files`: use `ignore` + `.gitignore`; collect candidates by extension, recent edits, imports, test names, diagnostics.
2. `parse_symbols`: use tree-sitter for fast multi-language symbol maps; use `syn` for Rust-specific semantic detail.
3. `narrow_scope`: rank files by direct mention, import graph distance, diagnostics, changed files, tests, and historical usefulness.
4. `enrich_errors`: parse compiler/test output into file/line anchors; pull nearby function/class/module spans, not arbitrary chunks.
5. `inject_history`: retrieve previous task summaries, failing commands, accepted patches, and model outcomes.
6. `budget`: assemble in tiers: exact error spans, directly edited files, symbol dependencies, tests, history summary.

Internal data:

```rust
pub struct AssembledContext {
    pub files: Vec<ContextFile>,
    pub diagnostics: Vec<DiagnosticAnchor>,
    pub history: Vec<HistoryItem>,
    pub token_estimate: usize,
    pub provenance: Vec<ContextSource>,
}
```

The important product rule: every context item must have provenance and a reason code. That makes learning possible later.

**4. Error Handling**

Use per-crate error enums with `thiserror`; use `anyhow` only at binary/task boundaries where recovery is not expected.

```rust
#[derive(thiserror::Error, Debug)]
pub enum AuthError {
    #[error("missing authorization")]
    MissingAuth,
    #[error("invalid session")]
    InvalidSession,
    #[error("soma verification failed: {0}")]
    Soma(String),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}
```

At API boundary, convert domain errors into one shared `ApiError`.

```rust
pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
    pub request_id: Option<String>,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = Json(json!({
            "error": {
                "code": self.code,
                "message": self.message,
                "request_id": self.request_id
            }
        }));
        (self.status, body).into_response()
    }
}
```

Pattern:

- Domain crates expose meaningful typed errors.
- `api` maps them to `ApiError`.
- Background jobs map them to retryable/permanent `JobError`.
- Never expose raw sqlx/provider/Soma verification messages to clients.

**5. Observability**

Production Rust stack in 2025/2026 is still:

- `tracing` for app instrumentation.
- `tracing-subscriber` for local formatting/filtering.
- `tracing-opentelemetry` + `opentelemetry-otlp` for traces.
- Prometheus scrape endpoint for metrics.
- Grafana/Tempo/Loki or managed OTLP backend for collection.

Set request IDs at the edge:

```rust
ServiceBuilder::new()
  .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
  .layer(PropagateRequestIdLayer::x_request_id())
  .layer(TraceLayer::new_for_http())
```

Metrics to define day 1:

```text
http_requests_total{route,method,status}
http_request_duration_seconds{route,method}
jobs_dequeued_total{queue,kind}
jobs_failed_total{queue,kind,reason}
job_runtime_seconds{queue,kind}
context_assembly_duration_seconds{stage}
context_tokens_total{surface,model}
llm_provider_latency_seconds{provider,model}
llm_provider_errors_total{provider,model,code}
billing_ledger_entries_total{entry_type}
x402_payments_total{status,chain}
```

Trace every Cortex request as:

```text
http.request
  auth.verify
  policy.check
  context.discover_files
  context.narrow_scope
  context.enrich_errors
  context.inject_history
  router.select_model
  provider.call
  billing.record
```

**6. Testing**

Use `testcontainers = "0.27.3"` and `testcontainers-modules = "0.15.0"` for Postgres integration tests. Testcontainers’ own docs describe it as Rust integration testing against Docker containers.

Test layers:

```text
unit: pure policy, billing math, context ranking
integration: sqlx migrations + repos + job leasing
api e2e: Axum Router + real PgPool + fake Clerk/Soma/provider
property: proptest for ledger invariants, delegation caveats, context budget
fuzz: cargo-fuzz for parsers, DAG-CBOR/proof envelopes, x402 headers
```

Axum e2e pattern:

```rust
let app = build_router(test_state);
let res = app
  .oneshot(Request::builder()
    .method("POST")
    .uri("/api/chat")
    .header("authorization", "Bearer test")
    .body(Body::from(r#"{"message":"hi"}"#))
    .unwrap())
  .await
  .unwrap();

assert_eq!(res.status(), StatusCode::OK);
```

Property tests:

- Ledger sum never changes under event replay ordering.
- Job dequeue leases one job to one worker.
- Delegation caveats reject expired/spend-over-scope actions.
- Context assembler never exceeds budget and always includes direct error anchors.

Fuzz targets:

```text
fuzz_targets/parse_soma_envelope.rs
fuzz_targets/parse_x402_payment.rs
fuzz_targets/parse_provider_error.rs
fuzz_targets/context_error_log_parser.rs
```

**7. Build Priority**

Do not rewrite Cortex first. Build the platform under it, then move traffic slice by slice.

Order:

1. `heyvera-core`, `heyvera-config`, `heyvera-db`.
2. Postgres migrations with the schema above.
3. `heyvera-observe`: request IDs, tracing, Prometheus endpoint.
4. `heyvera-auth`: `Principal`, Clerk human verification stub, Soma agent verification interface.
5. `heyvera-events`: append-only `domain_events` + in-process bus + `LISTEN/NOTIFY`.
6. `heyvera-jobs`: durable queue and worker runtime.
7. Wrap existing Cortex chat behind new Axum API state without changing behavior.
8. Add context assembler beside existing routing; initially shadow-mode it and log assembled context quality.
9. Move billing/subscription/x402 writes into ledger.
10. Only then split social/marketplace/hosting surfaces.

Compatibility rule: current Cortex chat remains the smoke test. Every migration PR must pass: “can send chat, provider call returns, conversation persists, metrics emit.”

**8. Performance Targets**

Initial P99 targets, excluding third-party LLM latency:

```text
GET /health                         < 10 ms
GET /metrics                        < 50 ms
POST /api/auth/session/verify        < 75 ms
POST /api/chat request accepted      < 150 ms before provider stream starts
Context assembly, warm repo          < 250 ms p99
Context assembly, cold repo          < 1500 ms p99
Job dequeue                          < 25 ms
Event append                         < 20 ms
Billing ledger write                 < 30 ms
x402 payment verification local      < 100 ms, chain-dependent settlement async
SSE/WebSocket first byte             < 100 ms after provider stream starts
```

Bottlenecks to expect:

- Context assembly cold path: filesystem scanning and parsing.
- Provider latency: external and dominant.
- Postgres hot indexes: jobs polling, events by aggregate, audit append volume.
- Tokenization: can become noticeable under agent traffic.
- WebSocket fanout: per-connection buffering and backpressure.

Design responses:

- Cache file graph by repo commit/hash.
- Incrementally update symbol index.
- Use strict context budgets before model selection.
- Keep provider calls out of DB transactions.
- Partition or archive `audit_log` and `domain_events` once volume demands it.
- Use TensorZero’s benchmark as a north star: Rust gateway overhead should be sub-millisecond to low-single-digit milliseconds when hot. TensorZero publicly reports sub-ms overhead even at 10k QPS and `<1ms p99` gateway latency, which is the right class of target for Cortex’s routing layer, though HeyVera’s context assembly will be the heavier component.
