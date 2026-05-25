# ADR-0007: HeyVera Production Backend Foundation

Status: accepted

## Context

HeyVera needs a production backend foundation that is explicit about
runtime ownership, data authority, operational boundaries, and the
limits of supporting infrastructure.

The backend needs to support:

- a durable system of record for user, authorization, and application
  state
- API performance with predictable operational behavior under load
- background work without turning the queue into a second source of
  truth
- externally managed identity while keeping product authorization and
  profile ownership inside HeyVera
- file and media handling without proxying large uploads through the
  application tier
- production telemetry that is useful for latency, failures, and
  rollout safety

The main risk is stack drift: adding extra moving parts or adopting
infrastructure as primary truth where it should remain auxiliary.
HeyVera needs a foundation that is fast to ship, strict enough for
production, and clear about which components are authoritative.

## Decision

HeyVera will use a Rust modular monolith as its production backend
foundation.

The foundation is:

- **runtime shape:** Rust modular monolith
- **HTTP framework:** Axum
- **database access:** `sqlx`
- **system of record:** Postgres
- **cache / rate limit / queue support:** Redis, but only as auxiliary
  infrastructure
- **identity provider:** Clerk
- **application authorization and profile ownership:** HeyVera-owned
  logic and data
- **file/object handling:** object storage through signed uploads
- **observability:** OpenTelemetry

### 1. Rust modular monolith

The backend will ship as a single deployable Rust service with strong
module boundaries inside the codebase.

This means:

- one runtime and deploy surface for the backend
- clear internal modules for domains and infrastructure concerns
- no microservice split unless production behavior later justifies it

The goal is to preserve operational simplicity while keeping enough
internal structure that future extraction remains possible if reality
demands it.

### 2. Axum for the HTTP/runtime layer

Axum is the standard HTTP framework for the backend.

It is accepted because it fits the Rust runtime choice, works cleanly
with typed request handling and middleware, and supports a production
service shape without introducing an unusual framework stack.

### 3. `sqlx` for database access

HeyVera will use raw-SQL-oriented access through `sqlx`, not an ORM.

This keeps schema behavior, query behavior, and migration reality close
to the actual database while still giving compile-time and type-checked
support where applicable.

### 4. Postgres is the source of truth

Postgres is the authoritative store for durable application state.

This includes:

- product data
- user-linked application state
- authorization-relevant records owned by HeyVera
- job state that must survive process or Redis loss

Redis must not become an accidental second database.

### 5. Redis is support infrastructure only

Redis is allowed for:

- caching
- rate limiting
- queue transport / work dispatch

Redis is not the source of truth for durable business state, identity,
authorization, or irreplaceable workflow state. If Redis is flushed or
unavailable, correctness must still derive from Postgres.

### 6. Clerk identity, HeyVera authorization

Clerk is the identity provider for authentication and external identity
lifecycle.

HeyVera still owns:

- profile records needed for application behavior
- authorization policy and roles
- ownership rules over product resources
- any product-specific user state beyond third-party identity claims

This avoids coupling product authorization truth to a third-party
identity surface.

### 7. Object storage through signed uploads

Large file and object upload flows should use signed upload/download
patterns against object storage.

The application should issue scoped signed operations and persist the
resulting object metadata in Postgres. The backend should not become the
default byte proxy for routine uploads.

### 8. OpenTelemetry as the observability baseline

OpenTelemetry is required for traces, metrics, and logs/structured
correlation where supported by the chosen sink.

Production work should assume:

- request tracing across middleware, handlers, DB calls, and background
  jobs
- latency and error metrics for critical paths
- enough correlation to judge rollout safety and incident scope

## Consequences

- HeyVera gets one production backend deployable instead of a premature
  service mesh
- data authority stays legible: Postgres is durable truth, Redis is
  expendable support
- identity integration remains clean without giving Clerk ownership of
  product authorization semantics
- upload-heavy workflows can scale without routing object bytes through
  app servers
- observability is part of the foundation, not deferred until after
  incidents
- the team accepts Rust/Axum/sqlx operational and hiring complexity in
  exchange for stronger runtime discipline, performance, and explicit
  infrastructure boundaries

## Alternatives Considered

### Go

Go was considered because it is a pragmatic backend language with a
strong operational story and simpler team onboarding in many cases.

It was not chosen because the target foundation favors Rust's stricter
type and concurrency guarantees, and the chosen stack is intended to be
opinionated about correctness and long-term runtime discipline rather
than only minimizing initial implementation friction.

Go remains a credible future choice for isolated supporting services if
HeyVera later has a concrete reason to split work by runtime.

### Node

Node was considered because it is fast to iterate with, has a large
ecosystem, and reduces stack diversity for teams already shipping
JavaScript or TypeScript.

It was not chosen because the production foundation here prioritizes a
more constrained runtime model, stronger compile-time guarantees, and a
clear step away from treating application and queue/cache concerns as a
loosely typed operational bundle.

Node is acceptable for non-core surfaces where it is the right tool,
but it is not the chosen foundation for HeyVera's primary production
backend.

## Rollout Implications

- initial backend architecture should be planned as a modular monolith,
  not as services-first infrastructure
- schema design, migrations, and operational runbooks should assume
  Postgres authority from day one
- Redis-backed queues must be designed so retry, recovery, and idempotent
  job handling reconcile against Postgres state
- Clerk integration work must include a durable mapping between Clerk
  identities and HeyVera-owned user/profile/authorization records
- object-storage flows should be built around signed upload/download
  endpoints plus persisted metadata, not direct app-server file piping
- telemetry instrumentation should be present in the first production
  slices so baseline latency and failure data exist before broader
  rollout

