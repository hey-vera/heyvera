ClawNet Implementation Blueprint
Principal Architecture Plan — for Sonnet Execution

SECTION 1 — FINAL SYSTEM THESIS
ClawNet is a hosted execution marketplace for agent-to-agent work. The fundamental unit of commerce is a task: one party requests work, the platform routes it to a capable provider (skill, endpoint, workflow, or agent), the platform executes or proxies the work in a controlled environment, verifies the result against a declared output contract, settles payment via escrowed credits, and logs every step for auditability.

The winning architecture is Option C: hybrid with controlled code onboarding. In v1, skills are manifests — structured declarations pointing to prompt templates, API endpoints, or multi-step workflow DAGs. The platform executes them on its own infrastructure. No arbitrary code uploads. No Docker images from strangers. Code execution (sandboxed functions) is a Phase 3 feature gated behind publisher verification, static analysis, and policy-scoped capabilities.

Why this beats ClawHub-style registries:

Safety by default. ClawHub registries accept uploaded skill bundles — zip files containing arbitrary code, templates, even binaries. Every download is a supply-chain attack surface. ClawNet skills are declarations, not programs. The platform controls execution, so it controls blast radius.

Monetization works. In upload-based registries, once someone downloads a skill, the creator loses control. ClawNet's hosted execution model means every invocation flows through the billing layer — creators earn on every use, not just first download.

Enterprise trust. Enterprises will never run unvetted code from a public marketplace inside their infrastructure. ClawNet's hosted execution model means the enterprise trusts one execution environment (ClawNet), not thousands of random skill authors.

Composability. Because skills are manifests with declared input/output contracts, the platform can compose them into workflows, route tasks to the best available provider, retry on failure, and verify outputs — none of which is possible when skills are opaque code bundles.

Core design principle: The platform is the execution layer, not just the catalog. Every design decision follows from this: skills declare what they do, the platform decides how to do it safely.

SECTION 2 — PRODUCT BOUNDARIES
Must-Have for MVP (30 days)
Feature	Rationale
Prompt-template skills with declared I/O contracts	Existing capability, needs formal contracts
API-proxy skills (hit external endpoint, return result)	Existing capability, needs manifest formalization
Credit wallet + double-entry ledger	Replace current ad-hoc credit system with auditable ledger
Skill publishing with moderation queue	Controlled publishing, not open upload
Task lifecycle: submit → route → execute → verify → settle	Core value loop
Search by category/tag/text	Discovery minimum
Provider dashboard (earnings, invocations, ratings)	Creator retention
Consumer dashboard (credits, tasks, history)	User retention
Escrow-based settlement (hold → execute → release)	Fraud resistance
Webhook result delivery	Async consumers need callbacks
Admin moderation console	Abuse response
API key auth + Clerk JWT auth	Existing, needs formalization
Should-Have for v1 (90 days)
Feature	Rationale
Multi-step workflow skills (DAG of skills)	Composability differentiator
Organization/team accounts	Enterprise readiness
Private skill catalogs per org	Enterprise requirement
Dispute resolution flow	Trust at scale
Semantic search via embeddings	Better discovery
Provider verification tiers (unverified → verified → certified)	Trust signaling
Usage-based pricing (per-token, per-row, per-minute)	Flexible billing
Payout system (creator withdrawals)	Real monetization
Rate limiting per skill/provider	Abuse resistance
Signed result envelopes	Provenance
Explicitly Excluded from v1
Exclusion	Why
Arbitrary code upload / Docker execution	Attack surface too large for a startup. Manifests + proxy/template cover 90% of use cases. Add sandboxed execution in Phase 3 when there is demand AND a verified-publisher pipeline.
On-chain settlement / tokens	Adds regulatory complexity and engineering cost without proportional value. Credits + Stripe + USDC covers all payment needs. Revisit only if there is a concrete agent-economy use case requiring trustless settlement.
Real-time streaming execution	SSE streaming for task progress is fine. Full streaming execution (chunked results) adds complexity. Ship polling + webhooks first.
Multi-model inference marketplace	ClawNet is a skill marketplace, not an inference marketplace. LLM proxy exists as a utility. Don't compete with Together/Fireworks/etc.
Mobile apps	Web dashboard is sufficient. APIs serve agent consumers.
Self-hosted deployment	Hosted SaaS only in v1. Enterprise on-prem is a v3+ feature.
Skill forking / A/B testing	Existing feature but over-engineered for current user count. Keep the code, de-emphasize in UX. Focus on basic publish → use → earn loop.
SECTION 3 — RECOMMENDED HIGH-LEVEL ARCHITECTURE
Architecture Comparison
Model	Safety	Monetization	Enterprise	Complexity
A. Downloadable registry	❌ Terrible	❌ One-time	❌ Uncontrolled code	Low
B. Hosted execution only	✅ Excellent	✅ Per-use	✅ Platform-controlled	Medium
C. Hybrid (manifests now, sandboxed code later)	✅ Excellent	✅ Per-use	✅ Gated	Medium+
Decision: Option C — hybrid with controlled code onboarding.

v1 launches as pure hosted execution (manifests only). Sandboxed code execution is added later with verified-publisher gates.

Architecture Diagram

┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENTS                                       │
│  Agent SDKs │ MCP Clients │ Web Dashboard │ CLI │ Webhooks           │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTPS
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     EDGE / GATEWAY                                    │
│  Caddy (TLS termination) → Rate Limiter → Auth Middleware             │
└──────────────────────────┬───────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                   MODULAR MONOLITH (Hono)                             │
│                                                                       │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌───────────┐              │
│  │ Identity  │ │ Catalog  │ │ Execution │ │  Ledger   │              │
│  │ Module    │ │ Module   │ │ Module    │ │  Module   │              │
│  └──────────┘ └──────────┘ └───────────┘ └───────────┘              │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌───────────┐              │
│  │  Trust   │ │  Search  │ │   Admin   │ │   Audit   │              │
│  │  Module  │ │  Module  │ │  Module   │ │   Module  │              │
│  └──────────┘ └──────────┘ └───────────┘ └───────────┘              │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐                            │
│  │ Webhook  │ │ Payout   │ │ Notifica- │                            │
│  │ Delivery │ │ Module   │ │ tion Mod  │                            │
│  └──────────┘ └──────────┘ └───────────┘                            │
└────────────┬──────────┬──────────┬──────────────────────────────────┘
             │          │          │
     ┌───────▼──┐  ┌────▼───┐  ┌──▼──────────┐
     │PostgreSQL│  │ Redis  │  │ BullMQ Jobs │
     │ (primary)│  │ (cache │  │ (execution, │
     │          │  │  + pub/ │  │  webhooks,  │
     │          │  │  sub)   │  │  payouts)   │
     └──────────┘  └────────┘  └─────────────┘
             │
     ┌───────▼──────┐
     │ S3/R2 Object │
     │ Storage      │
     │ (results,    │
     │  manifests)  │
     └──────────────┘
Component Responsibilities
Component	Role
Caddy	TLS, reverse proxy, static site serving (existing)
Hono API	Modular monolith, all business logic
PostgreSQL	Source of truth — users, skills, tasks, ledger, audit
Redis	Cache (skill metadata, rate limits), BullMQ job backing store, pub/sub for real-time events
BullMQ	Async job processing — task execution, webhook delivery, payouts, moderation
S3/R2	Execution result storage, skill manifest archive, large payloads
Why modular monolith, not microservices: ClawNet is a two-person team. A modular monolith gives domain isolation (each module has its own routes, DB queries, types) without the operational overhead of service discovery, API gateways, distributed tracing, and network partitions. Extract to services only when a module has genuinely different scaling characteristics (execution is the first candidate, ~v2).

Why PostgreSQL over SQLite for this plan: The prompt asks me to design for enterprise multi-tenancy, concurrent task execution, row-level security, advisory locks for escrow settlement, and LISTEN/NOTIFY for real-time events. SQLite can handle single-node workloads well, but PostgreSQL gives us: ACID transactions with row-level locking, JSONB for flexible metadata, full-text search built in, advisory locks for distributed coordination, and a clear path to read replicas when needed.

Migration note for Sonnet: The existing ClawNet runs on SQLite. This blueprint designs for PostgreSQL. The migration path is: (1) add PostgreSQL alongside SQLite, (2) dual-write during migration, (3) cut over, (4) remove SQLite. Alternatively, if the team prefers to stay on SQLite for now, every schema and query in this document can be adapted — the domain model and API design are database-agnostic.

SECTION 4 — CORE DOMAIN MODEL
Entity Definitions
User
Purpose: Human identity — the person behind one or more agents/API keys.
Key fields: id (UUID), clerk_user_id, email, display_name, avatar_url, role (user/admin), verified_at, created_at, deleted_at
Relationships: Has many API tokens, belongs to many Organizations, has one CreditWallet
Lifecycle: Created on Clerk webhook → active → optionally verified → optionally soft-deleted
Security: PII (email, name). Must be encrypted at rest in production. Never exposed in public APIs except to the user themselves or admins.
Organization
Purpose: Team/company grouping for shared billing, private catalogs, and access control.
Key fields: id, name, slug, owner_user_id, billing_email, plan (free/pro/enterprise), settings_json, created_at, deleted_at
Relationships: Has many Users (via org_memberships), has one CreditWallet, owns many Skills
Lifecycle: Created by user → active → optionally upgraded → optionally soft-deleted
Security: Org slug is public. Billing details are sensitive.
ApiToken
Purpose: Bearer credential for API access. One user can have multiple tokens with different scopes.
Key fields: id, user_id, org_id (nullable), key_hash (SHA-256 of the raw key), key_prefix (first 8 chars for identification), name, scopes (JSON array), last_used_at, expires_at, revoked_at, created_at
Relationships: Belongs to User, optionally scoped to Organization
Lifecycle: Created → active → optionally revoked → hard-deleted after 90 days
Security: Raw key shown only once at creation. Store ONLY the SHA-256 hash. Key prefix for display. Never log raw keys.
Skill
Purpose: A published capability that can be invoked via task submission.
Key fields: id, slug (unique URL-safe name), name, description, author_id (user), org_id (nullable), category, tags (JSON array), skill_type (prompt_template / api_proxy / workflow), visibility (public / private / unlisted), status (draft / pending_review / published / suspended / archived), pricing_json, input_schema_json (JSON Schema), output_schema_json, security_status, current_version_id, total_invocations, avg_rating, created_at, updated_at, deleted_at
Relationships: Has many SkillVersions, belongs to User and optionally Org, has many Tasks
Lifecycle: Draft → pending_review → published → (suspended by admin) → archived
Security: Prompt templates may contain injection attempts — scanner runs on publish. API proxy URLs must be validated (no localhost/private IPs). Input/output schemas enforce contract boundaries.
SkillVersion
Purpose: Immutable snapshot of a skill at a point in time. Enables rollback and audit.
Key fields: id, skill_id, version (semver string), manifest_json (the full skill definition at this version), changelog, published_by, published_at, status (active / deprecated / yanked)
Relationships: Belongs to Skill
Lifecycle: Published → active → deprecated (new version exists) → yanked (security issue)
Security: Manifests are immutable once published. Yanking removes from invocation but preserves for audit.
Task
Purpose: A single unit of work requested by a consumer and fulfilled by a skill/provider.
Key fields: id, requester_id (user), requester_token_id (API token used), skill_id, skill_version_id, status (pending / executing / completed / failed / cancelled / disputed), input_json, priority (normal / high), idempotency_key, timeout_ms, webhook_url, created_at, started_at, completed_at, expires_at
Relationships: Has one Execution, has one EscrowHold, has many AuditEvents
Lifecycle: See Section 8 for full state machine
Security: Input may contain sensitive data. Results may contain PII. Both encrypted at rest. Webhook URLs validated against SSRF. Idempotency key prevents double-billing.
Execution
Purpose: The actual work performed for a Task — captures runtime details.
Key fields: id, task_id, executor_type (platform_llm / api_proxy / workflow_engine), provider_skill_version_id, status (running / succeeded / failed / timed_out), result_json, result_url (S3 for large results), duration_ms, cost_credits, llm_tokens_used, api_calls_made, error_json, started_at, completed_at
Relationships: Belongs to Task
Lifecycle: Created when task starts executing → running → succeeded/failed/timed_out
Security: Results may contain PII. Error messages must be sanitized before returning to consumer (no internal stack traces).
CreditWallet
Purpose: Balance container for a user or organization.
Key fields: id, owner_type (user / org / system), owner_id, balance (integer, in credits), lifetime_earned, lifetime_spent, held_in_escrow, created_at
Relationships: Belongs to User or Org, has many LedgerEntries
Lifecycle: Created with user/org → persists forever
Security: Financial data. All mutations via LedgerEntry (double-entry). Direct UPDATE on balance column is forbidden — only via record_ledger_entry() function.
LedgerEntry
Purpose: Immutable record of every credit movement. Double-entry bookkeeping.
Key fields: id, debit_wallet_id, credit_wallet_id, amount (positive integer), entry_type (topup / task_payment / task_earning / platform_fee / escrow_hold / escrow_release / refund / payout / adjustment), reference_type (task / payout / dispute / topup), reference_id, description, idempotency_key, created_at
Relationships: References two CreditWallets (debit and credit side)
Lifecycle: Created → immutable forever. Never updated or deleted.
Security: Append-only table. No UPDATE or DELETE operations. idempotency_key + UNIQUE constraint prevents double-posting.
EscrowHold
Purpose: Credits held in escrow during task execution. Released to provider on success, refunded to consumer on failure.
Key fields: id, task_id, consumer_wallet_id, amount, status (held / released / refunded / disputed), held_at, released_at
Relationships: Belongs to Task, references CreditWallet
Lifecycle: Held (at task creation) → released to provider (on success) → or refunded to consumer (on failure/dispute)
Security: Escrow prevents providers from being paid for failed work AND prevents consumers from getting free work.
ReputationProfile
Purpose: Trust metrics for a skill provider.
Key fields: id, user_id, total_tasks_completed, total_tasks_failed, success_rate, avg_rating, avg_latency_ms, disputes_lost, disputes_won, verification_tier (unverified / verified / certified), score (computed), last_computed_at
Relationships: Belongs to User
Lifecycle: Created with user → recomputed periodically
Security: Public data. But reputation manipulation must be detected (see Section 10).
Dispute
Purpose: Consumer challenges a task result and requests refund.
Key fields: id, task_id, initiated_by, reason, evidence_json, status (open / under_review / resolved_refund / resolved_no_refund / escalated), resolved_by, resolution_notes, created_at, resolved_at
Relationships: Belongs to Task
Lifecycle: Open → under_review → resolved (refund or not) → optionally escalated to admin
Security: Dispute evidence may contain PII. Resolution affects financial settlement.
AuditEvent
Purpose: Immutable log of every significant action in the system.
Key fields: id, actor_id, actor_type (user / system / admin), action, resource_type, resource_id, metadata_json, ip_address, user_agent, created_at
Relationships: References any entity
Lifecycle: Created → immutable forever
Security: Append-only. Contains PII (IP addresses). Retention policy: 1 year hot, archive after.
SECTION 5 — DATABASE DESIGN
Design Principles
PostgreSQL primary — all transactional data
Double-entry ledger — no direct balance mutations
Soft-delete for user-facing entities (users, orgs, skills) — deleted_at column
Hard-delete for ephemeral data (expired sessions, used claim tokens)
JSONB for flexible metadata (skill manifests, task inputs/outputs, pricing configs)
Indexes on all foreign keys and common query patterns
created_at on every table — always timestamptz, default now()
Storage Tier Decisions
Data	Store	Why
Users, skills, tasks, ledger, escrow	PostgreSQL	ACID, relational integrity, transactions
Skill metadata cache, rate limits, session cache	Redis	Speed, TTL, ephemeral
Large execution results (>100KB)	S3/R2	Cost, doesn't bloat DB
Full-text skill search	PostgreSQL tsvector in v1, Meilisearch later if needed	Simplicity
Audit log (cold)	PostgreSQL partitioned by month, archive to S3 after 90 days	Cost
Job queue state	Redis (BullMQ)	Built-in
Core Tables

-- ─── Identity ──────────────────────────────────────────────────────

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT UNIQUE,
  email         TEXT NOT NULL,
  display_name  TEXT,
  avatar_url    TEXT,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  verified_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_clerk ON users(clerk_user_id);

CREATE TABLE organizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  owner_user_id UUID NOT NULL REFERENCES users(id),
  billing_email TEXT,
  plan          TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  settings_json JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

CREATE TABLE org_memberships (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id  UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role    TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE TABLE api_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  org_id      UUID REFERENCES organizations(id),
  key_hash    TEXT NOT NULL UNIQUE,  -- SHA-256 of raw key
  key_prefix  TEXT NOT NULL,          -- first 8 chars for display
  name        TEXT NOT NULL DEFAULT 'default',
  scopes      JSONB NOT NULL DEFAULT '["*"]',
  last_used_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tokens_user ON api_tokens(user_id);
CREATE INDEX idx_tokens_hash ON api_tokens(key_hash);

-- ─── Catalog ───────────────────────────────────────────────────────

CREATE TABLE skills (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  description        TEXT NOT NULL,
  author_id          UUID NOT NULL REFERENCES users(id),
  org_id             UUID REFERENCES organizations(id),
  category           TEXT NOT NULL DEFAULT 'general',
  tags               JSONB NOT NULL DEFAULT '[]',
  skill_type         TEXT NOT NULL CHECK (skill_type IN (
                       'prompt_template', 'api_proxy', 'workflow')),
  visibility         TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN (
                       'public', 'private', 'unlisted')),
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                       'draft', 'pending_review', 'published', 'suspended', 'archived')),
  pricing_json       JSONB NOT NULL DEFAULT '{"model":"per_invocation","credit_cost":1}',
  input_schema_json  JSONB,  -- JSON Schema for input validation
  output_schema_json JSONB,  -- JSON Schema for output validation
  security_status    TEXT NOT NULL DEFAULT 'UNSCANNED',
  current_version_id UUID,
  total_invocations  BIGINT NOT NULL DEFAULT 0,
  avg_rating         REAL,
  stars              INT NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ
);
CREATE INDEX idx_skills_author ON skills(author_id);
CREATE INDEX idx_skills_org ON skills(org_id);
CREATE INDEX idx_skills_status ON skills(status);
CREATE INDEX idx_skills_category ON skills(category);
CREATE INDEX idx_skills_visibility_status ON skills(visibility, status)
  WHERE deleted_at IS NULL;

-- Full-text search index
ALTER TABLE skills ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED;
CREATE INDEX idx_skills_search ON skills USING gin(search_vector);

CREATE TABLE skill_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id      UUID NOT NULL REFERENCES skills(id),
  version       TEXT NOT NULL,         -- semver
  manifest_json JSONB NOT NULL,        -- full skill definition
  changelog     TEXT,
  published_by  UUID NOT NULL REFERENCES users(id),
  published_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
                  'active', 'deprecated', 'yanked')),
  UNIQUE (skill_id, version)
);
CREATE INDEX idx_versions_skill ON skill_versions(skill_id);

-- ─── Tasks & Execution ────────────────────────────────────────────

CREATE TABLE tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id      UUID NOT NULL REFERENCES users(id),
  requester_token_id UUID REFERENCES api_tokens(id),
  skill_id          UUID NOT NULL REFERENCES skills(id),
  skill_version_id  UUID NOT NULL REFERENCES skill_versions(id),
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                      'pending', 'executing', 'completed', 'failed',
                      'cancelled', 'timed_out', 'disputed')),
  input_json        JSONB NOT NULL,
  priority          TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN (
                      'normal', 'high')),
  idempotency_key   TEXT,
  timeout_ms        INT NOT NULL DEFAULT 30000,
  webhook_url       TEXT,
  cost_credits      INT,               -- filled after execution
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ
);
CREATE UNIQUE INDEX idx_tasks_idempotency
  ON tasks(requester_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_tasks_requester ON tasks(requester_id);
CREATE INDEX idx_tasks_skill ON tasks(skill_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_created ON tasks(created_at DESC);

CREATE TABLE executions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id               UUID NOT NULL UNIQUE REFERENCES tasks(id),
  executor_type         TEXT NOT NULL CHECK (executor_type IN (
                          'platform_llm', 'api_proxy', 'workflow_engine')),
  provider_version_id   UUID NOT NULL REFERENCES skill_versions(id),
  status                TEXT NOT NULL DEFAULT 'running' CHECK (status IN (
                          'running', 'succeeded', 'failed', 'timed_out')),
  result_json           JSONB,
  result_url            TEXT,          -- S3 URL for large results
  duration_ms           INT,
  cost_credits          INT,
  llm_tokens_used       INT DEFAULT 0,
  api_calls_made        INT DEFAULT 0,
  error_json            JSONB,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ
);
CREATE INDEX idx_executions_task ON executions(task_id);

-- ─── Financial ─────────────────────────────────────────────────────

CREATE TABLE credit_wallets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type      TEXT NOT NULL CHECK (owner_type IN ('user', 'org', 'system')),
  owner_id        UUID NOT NULL,
  balance         BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_earned BIGINT NOT NULL DEFAULT 0,
  lifetime_spent  BIGINT NOT NULL DEFAULT 0,
  held_in_escrow  BIGINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_type, owner_id)
);

CREATE TABLE ledger_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  debit_wallet_id  UUID NOT NULL REFERENCES credit_wallets(id),
  credit_wallet_id UUID NOT NULL REFERENCES credit_wallets(id),
  amount           BIGINT NOT NULL CHECK (amount > 0),
  entry_type       TEXT NOT NULL CHECK (entry_type IN (
                     'topup', 'task_payment', 'task_earning', 'platform_fee',
                     'escrow_hold', 'escrow_release', 'refund', 'payout', 'adjustment')),
  reference_type   TEXT,
  reference_id     UUID,
  description      TEXT,
  idempotency_key  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_ledger_idempotency ON ledger_entries(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_ledger_debit ON ledger_entries(debit_wallet_id);
CREATE INDEX idx_ledger_credit ON ledger_entries(credit_wallet_id);
CREATE INDEX idx_ledger_ref ON ledger_entries(reference_type, reference_id);
CREATE INDEX idx_ledger_created ON ledger_entries(created_at DESC);

CREATE TABLE escrow_holds (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id            UUID NOT NULL UNIQUE REFERENCES tasks(id),
  consumer_wallet_id UUID NOT NULL REFERENCES credit_wallets(id),
  amount             BIGINT NOT NULL CHECK (amount > 0),
  status             TEXT NOT NULL DEFAULT 'held' CHECK (status IN (
                       'held', 'released', 'refunded', 'disputed')),
  hold_ledger_id     UUID REFERENCES ledger_entries(id),
  release_ledger_id  UUID REFERENCES ledger_entries(id),
  held_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at        TIMESTAMPTZ
);
CREATE INDEX idx_escrow_task ON escrow_holds(task_id);
CREATE INDEX idx_escrow_status ON escrow_holds(status);

-- ─── Trust & Reputation ───────────────────────────────────────────

CREATE TABLE reputation_profiles (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL UNIQUE REFERENCES users(id),
  total_completed      BIGINT NOT NULL DEFAULT 0,
  total_failed         BIGINT NOT NULL DEFAULT 0,
  success_rate         REAL NOT NULL DEFAULT 0,
  avg_rating           REAL,
  avg_latency_ms       INT,
  disputes_lost        INT NOT NULL DEFAULT 0,
  disputes_won         INT NOT NULL DEFAULT 0,
  verification_tier    TEXT NOT NULL DEFAULT 'unverified' CHECK (
                         verification_tier IN ('unverified', 'verified', 'certified')),
  score                REAL NOT NULL DEFAULT 0,
  last_computed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE task_ratings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL UNIQUE REFERENCES tasks(id),
  rated_by    UUID NOT NULL REFERENCES users(id),
  rating      INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Disputes ─────────────────────────────────────────────────────

CREATE TABLE disputes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          UUID NOT NULL REFERENCES tasks(id),
  initiated_by     UUID NOT NULL REFERENCES users(id),
  reason           TEXT NOT NULL,
  evidence_json    JSONB,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
                     'open', 'under_review', 'resolved_refund',
                     'resolved_no_refund', 'escalated')),
  resolved_by      UUID REFERENCES users(id),
  resolution_notes TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at      TIMESTAMPTZ
);
CREATE INDEX idx_disputes_task ON disputes(task_id);
CREATE INDEX idx_disputes_status ON disputes(status);

-- ─── Audit ────────────────────────────────────────────────────────

CREATE TABLE audit_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id       UUID,
  actor_type     TEXT NOT NULL DEFAULT 'system',
  action         TEXT NOT NULL,
  resource_type  TEXT NOT NULL,
  resource_id    TEXT,
  metadata_json  JSONB,
  ip_address     INET,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

-- Monthly partitions — create via cron or migration
CREATE TABLE audit_events_2026_03 PARTITION OF audit_events
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

-- ─── System Wallets ───────────────────────────────────────────────

-- Created at migration time, not dynamically
-- 'system:platform_fee' — receives all platform fees
-- 'system:escrow_holding' — temporary holding for escrowed credits
Critical Integrity Rules
Ledger function — All balance changes go through a single record_ledger_entry() PostgreSQL function that atomically debits one wallet and credits another within a transaction, enforcing balance >= 0.

CREATE OR REPLACE FUNCTION record_ledger_entry(
  p_debit_wallet_id UUID,
  p_credit_wallet_id UUID,
  p_amount BIGINT,
  p_entry_type TEXT,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_entry_id UUID;
BEGIN
  -- Debit
  UPDATE credit_wallets
  SET balance = balance - p_amount,
      lifetime_spent = lifetime_spent + p_amount
  WHERE id = p_debit_wallet_id AND balance >= p_amount;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient balance in wallet %', p_debit_wallet_id;
  END IF;

  -- Credit
  UPDATE credit_wallets
  SET balance = balance + p_amount,
      lifetime_earned = lifetime_earned + p_amount
  WHERE id = p_credit_wallet_id;

  -- Record
  INSERT INTO ledger_entries (
    id, debit_wallet_id, credit_wallet_id, amount,
    entry_type, reference_type, reference_id,
    description, idempotency_key
  ) VALUES (
    gen_random_uuid(), p_debit_wallet_id, p_credit_wallet_id, p_amount,
    p_entry_type, p_reference_type, p_reference_id,
    p_description, p_idempotency_key
  ) RETURNING id INTO v_entry_id;

  RETURN v_entry_id;
END;
$$ LANGUAGE plpgsql;
No direct UPDATE on credit_wallets.balance — only via record_ledger_entry().
Idempotency key on ledger_entries — unique constraint prevents double-posting.
Audit events are append-only — no UPDATE, no DELETE, partitioned by month.
SECTION 6 — API DESIGN
Authentication Model
All API requests authenticated via one of:

API token — Authorization: Bearer cn-xxxx → look up api_tokens by SHA-256 hash
Clerk JWT — Authorization: Bearer eyJhbG... → verify with Clerk, resolve to user
Webhook signature — HMAC-SHA256 for inbound Stripe/Clerk webhooks
Admin API key — X-Admin-Key header for admin endpoints
Route Groups
Auth & Identity

POST   /v1/auth/tokens              — Create API token
GET    /v1/auth/tokens              — List user's tokens
DELETE /v1/auth/tokens/:id          — Revoke token
GET    /v1/auth/me                  — Current user profile
Authorization: Clerk JWT required. Token creation scoped to the authenticated user.

Organizations

POST   /v1/orgs                     — Create org
GET    /v1/orgs/:slug               — Get org details
PATCH  /v1/orgs/:slug               — Update org
POST   /v1/orgs/:slug/members       — Invite member
DELETE /v1/orgs/:slug/members/:id   — Remove member
GET    /v1/orgs/:slug/members       — List members
Authorization: Org owners/admins only for mutations.

Skills (Catalog)

GET    /v1/skills                   — Search/list public skills
GET    /v1/skills/:slug             — Get skill detail
POST   /v1/skills                   — Create skill (draft)
PATCH  /v1/skills/:slug             — Update skill metadata
POST   /v1/skills/:slug/versions    — Publish new version
POST   /v1/skills/:slug/submit      — Submit for review
DELETE /v1/skills/:slug             — Soft-delete (author only)
GET    /v1/skills/mine              — List user's own skills
POST   /v1/skills/:slug/star        — Star a skill
DELETE /v1/skills/:slug/star        — Unstar
Key rules:

POST /v1/skills creates draft. Not visible until submit → review → publish.
input_schema_json and output_schema_json required for non-draft skills.
Skill scanner runs on submit. Security status updated.
Example: Create Skill Request


{
  "name": "Token Price Analysis",
  "slug": "token-price-analysis",
  "description": "Analyzes current price, volume, and market dynamics for any token",
  "category": "defi",
  "tags": ["price", "analysis", "tokens"],
  "skill_type": "prompt_template",
  "visibility": "public",
  "pricing": {
    "model": "per_invocation",
    "credit_cost": 5
  },
  "input_schema": {
    "type": "object",
    "properties": {
      "token": { "type": "string", "description": "Token symbol or address" }
    },
    "required": ["token"]
  },
  "output_schema": {
    "type": "object",
    "properties": {
      "price_usd": { "type": "number" },
      "analysis": { "type": "string" }
    }
  },
  "manifest": {
    "prompt_template": "Analyze the current price and market dynamics for {{token}}. Include price, 24h change, volume, and market cap.",
    "llm_model": "claude-sonnet-4-20250514",
    "max_tokens": 1000
  }
}
Tasks (Execution)

POST   /v1/tasks                    — Submit a task
GET    /v1/tasks/:id                — Get task status + result
GET    /v1/tasks                    — List user's tasks
POST   /v1/tasks/:id/cancel         — Cancel pending task
POST   /v1/tasks/:id/rate           — Rate completed task
Idempotency: POST /v1/tasks accepts Idempotency-Key header. Same key + same user = return existing task.

Example: Submit Task


{
  "skill_slug": "token-price-analysis",
  "input": {
    "token": "SOL"
  },
  "timeout_ms": 15000,
  "webhook_url": "https://my-agent.example.com/callback"
}
Example: Task Response


{
  "id": "01912345-abcd-7890-...",
  "status": "completed",
  "skill": {
    "slug": "token-price-analysis",
    "version": "1.0.0"
  },
  "input": { "token": "SOL" },
  "result": {
    "price_usd": 142.50,
    "analysis": "SOL is trading at $142.50, up 3.2% in 24h..."
  },
  "cost_credits": 5,
  "duration_ms": 2340,
  "created_at": "2026-03-10T12:00:00Z",
  "completed_at": "2026-03-10T12:00:02Z"
}
Credits & Billing

GET    /v1/credits                  — Get wallet balance
GET    /v1/credits/history          — Ledger entries
POST   /v1/credits/topup           — Initiate Stripe checkout
GET    /v1/credits/estimate         — Estimate task cost without executing
Disputes

POST   /v1/disputes                 — Open dispute on a task
GET    /v1/disputes/:id             — Get dispute status
POST   /v1/disputes/:id/evidence    — Submit additional evidence
Admin

GET    /v1/admin/review-queue       — Skills pending review
POST   /v1/admin/skills/:id/approve — Approve skill
POST   /v1/admin/skills/:id/reject  — Reject skill
POST   /v1/admin/skills/:id/suspend — Suspend skill
GET    /v1/admin/disputes           — Open disputes
POST   /v1/admin/disputes/:id/resolve — Resolve dispute
GET    /v1/admin/metrics            — Platform metrics
Authorization: ADMIN_API_KEY or admin-role Clerk JWT.

Rate Limiting
Endpoint group	Limit	Window
Read (GET)	120/min	Per API token
Write (POST/PATCH/DELETE)	30/min	Per API token
Task submission	60/min	Per API token
Auth endpoints	10/min	Per IP
Admin	120/min	Per admin key
Webhooks (inbound)	100/min	Per IP
SECTION 7 — SKILL MODEL AND PUBLISHING PIPELINE
What a Skill Is (v1)
A skill is a declarative manifest that describes:

What the skill does (name, description, category, tags)
What input it accepts (JSON Schema)
What output it produces (JSON Schema)
How it executes (one of three runtime types)
What it costs (pricing model)
Who published it (author, org)
Runtime Types (v1)
Type	How it works	Example
prompt_template	Platform sends templated prompt to configured LLM, returns response	"Analyze token {{token}}"
api_proxy	Platform makes HTTP request to declared external URL, returns response	POST https://api.example.com/analyze
workflow	Platform executes a DAG of sub-skill invocations	Step 1: get price → Step 2: analyze → Step 3: format
What is NOT Allowed (v1)
Upload type	Allowed?	Reason
Raw code files (.py, .js)	❌	Arbitrary code execution without sandboxing
Docker images	❌	Too expensive to run and too dangerous to trust
Binary executables	❌	Obviously dangerous
Zip archives	❌	Supply chain attack vector
File attachments	❌	Unnecessary for manifest-based skills
Skill Manifest Schema (Canonical)

interface SkillManifest {
  // ─── Identity ────────────────────────────
  slug: string;               // URL-safe, unique
  name: string;               // Display name
  description: string;        // Markdown allowed
  category: string;           // From controlled taxonomy
  tags: string[];             // Max 10, max 30 chars each

  // ─── Contract ────────────────────────────
  input_schema: JSONSchema;   // Validates task input
  output_schema: JSONSchema;  // Validates execution output
  
  // ─── Runtime ─────────────────────────────
  skill_type: 'prompt_template' | 'api_proxy' | 'workflow';
  
  // For prompt_template:
  prompt_template?: {
    template: string;         // Mustache-style {{var}} interpolation
    system_prompt?: string;   // Optional system message
    llm_model: string;        // Model to use
    max_tokens: number;       // Token limit
    temperature?: number;     // 0-1
  };
  
  // For api_proxy:
  api_proxy?: {
    url: string;              // Must be HTTPS, no private IPs
    method: 'GET' | 'POST' | 'PUT';
    headers?: Record<string, string>; // Static headers (no secrets!)
    timeout_ms?: number;      // Max 30000
    transform_response?: {    // Optional jq-like extraction
      json_path: string;      // e.g., "$.data.result"
    };
  };
  
  // For workflow:
  workflow?: {
    steps: WorkflowStep[];    // Ordered DAG
  };
  
  // ─── Pricing ─────────────────────────────
  pricing: {
    model: 'per_invocation' | 'per_token' | 'per_second';
    credit_cost: number;      // Base cost per invocation
    // per_token: cost_per_1k_tokens
    // per_second: cost_per_second
  };
  
  // ─── Metadata ────────────────────────────
  version: string;            // Semver
  changelog?: string;
  readme?: string;            // Markdown
  license: string;            // SPDX identifier
}

interface WorkflowStep {
  id: string;                 // Step identifier
  skill_slug: string;         // Which skill to invoke
  input_mapping: Record<string, string>; // Map from workflow input / previous step output
  condition?: string;         // Optional: only run if condition met
  on_failure: 'abort' | 'skip' | 'retry'; // Failure handling
  max_retries?: number;
}
Publishing Pipeline

Author creates skill (draft)
        │
        ▼
Author submits for review (status → pending_review)
        │
        ▼
┌───────────────────────────┐
│   AUTOMATED CHECKS        │
│                           │
│ 1. JSON Schema validation │
│ 2. Prompt injection scan  │
│ 3. API proxy URL validation│
│    (no localhost, no private IPs, │
│     DNS resolves, HTTPS only)    │
│ 4. Workflow DAG validation │
│    (no cycles, all refs valid)   │
│ 5. Pricing bounds check   │
│    (min 1 credit, max 10000)     │
└─────────────┬─────────────┘
              │
        ┌─────┴─────┐
        │           │
     PASS        FAIL
        │           │
        ▼           ▼
  Auto-approved   Rejected with
  (if author is    specific
   verified+)     reasons
        │
        ▼
  Published (visible in catalog)
Approval states:

draft — only author can see, editable
pending_review — submitted, immutable, awaiting checks
published — live in catalog, invocable
suspended — admin pulled it (security issue, reports)
archived — author chose to retire it
Verification badges:

UNSCANNED — not yet submitted
CLEAN — passed automated scanner
VERIFIED — platform-published or manually reviewed
SUSPICIOUS — scanner flagged potential issues
FLAGGED — community reports threshold reached
Versioning Rules
Versions are immutable once published
New version = new skill_versions row
skills.current_version_id always points to the latest active version
Consumers can pin to a specific version via skill_version_id in task submission
Yanked versions cannot be invoked but are preserved for audit
SECTION 8 — EXECUTION MODEL
Task State Machine

     ┌──────────┐
     │ PENDING   │ ← Task created, input validated, escrow held
     └────┬──────┘
          │ worker picks up
          ▼
     ┌──────────┐
     │ EXECUTING │ ← Worker running the skill
     └────┬──────┘
          │
    ┌─────┼─────────────┐
    │     │              │
    ▼     ▼              ▼
┌──────┐ ┌──────┐  ┌──────────┐
│COMPLT│ │FAILED│  │TIMED_OUT │
│  ED  │ │      │  │          │
└──┬───┘ └──┬───┘  └────┬─────┘
   │        │            │
   │    ┌───┴────────────┘
   │    │ escrow refunded
   │    ▼
   │  (consumer notified,
   │   escrow returned)
   │
   │ escrow released to provider
   │ platform fee deducted
   ▼
 (consumer notified,
  provider credited)
          │
          ▼
     ┌──────────┐
     │ DISPUTED  │ ← Consumer opens dispute within 24h
     └────┬──────┘
          │ admin resolves
          ▼
    ┌─────┴──────┐
    │            │
    ▼            ▼
  REFUND     NO_REFUND
  (escrow    (escrow stays
  returned)  with provider)
End-to-End Task Lifecycle
Step 1: Task Submission


Client → POST /v1/tasks { skill_slug, input, webhook_url }
Validate authentication (API token or Clerk JWT)
Resolve skill slug → skill + current version
Validate input against input_schema_json
Check idempotency key — if exists, return existing task
Calculate cost from skill pricing
Escrow hold: Debit consumer wallet → credit escrow holding wallet (atomic, via record_ledger_entry)
Insert task row (status = pending)
Insert escrow_hold row (status = held)
Enqueue execution job to BullMQ
Return task ID + status to client (202 Accepted for async, or wait for sync if timeout < 30s)
Step 2: Execution Dispatch


BullMQ worker picks up job
Update task status → executing, set started_at
Load skill manifest from skill_versions
Route by skill_type:
prompt_template: Interpolate input into template → call LLM → parse response
api_proxy: Build HTTP request → fetch external URL → extract response
workflow: Execute steps in DAG order, passing outputs between steps
Validate output against output_schema_json
Step 3: Completion (Success)

Store result in executions (inline JSON for <100KB, S3 URL for larger)
Update task status → completed, set completed_at, cost_credits
Escrow release: Debit escrow → credit provider wallet (97%), credit platform fee wallet (3%)
Update escrow_hold status → released
Update skill total_invocations counter
Record audit event
If webhook_url set: enqueue webhook delivery job
Update provider reputation profile
Step 4: Completion (Failure)

Store error in executions
Update task status → failed
Escrow refund: Debit escrow → credit consumer wallet (full amount returned)
Update escrow_hold status → refunded
Record audit event
If webhook_url set: enqueue webhook delivery job (with error)
Update provider reputation profile (failure recorded)
Step 5: Webhook Delivery


BullMQ webhook job
POST to webhook_url with signed payload:

{
  "event": "task.completed",
  "task_id": "...",
  "result": { ... },
  "signature": "sha256=..."
}
Retry up to 5 times with exponential backoff (1s, 5s, 25s, 125s, 625s)
After 5 failures, mark webhook as failed, notify consumer via dashboard
Timeout Handling
Default timeout: 30 seconds
Maximum timeout: 300 seconds (5 minutes)
BullMQ job timeout matches task timeout + 5s buffer
If execution exceeds timeout: worker kills the job, task status → timed_out, escrow refunded
Result Signing
Every execution result includes a signature envelope:


{
  "result": { ... },
  "metadata": {
    "task_id": "...",
    "skill_slug": "...",
    "skill_version": "1.0.0",
    "executed_at": "2026-03-10T12:00:02Z",
    "duration_ms": 2340,
    "executor": "platform_llm"
  },
  "signature": "hmac-sha256:BASE64..."
}
Signed with PLATFORM_SIGNING_SECRET. Consumers can verify they received an authentic platform result.

SECTION 9 — SECURITY ARCHITECTURE
Auth Architecture

┌─────────────┐     ┌─────────────┐     ┌────────────┐
│ API Token   │     │ Clerk JWT   │     │ Admin Key  │
│ cn-xxxxx    │     │ eyJhbG...   │     │ ak-xxxxx   │
└──────┬──────┘     └──────┬──────┘     └─────┬──────┘
       │                   │                   │
       ▼                   ▼                   ▼
  SHA-256 hash       Verify sig +         Constant-time
  lookup in DB       fetch user           compare
       │                   │                   │
       └───────────────────┼───────────────────┘
                           ▼
                    Resolved identity
                    (user_id, org_id, scopes)
Token scoping: API tokens have a scopes array. Possible scopes:

* — full access
tasks:write — submit tasks only
tasks:read — read task results only
skills:write — publish skills
credits:read — check balance
Session model: No server-side sessions. Auth is stateless — every request carries its credential. Clerk handles session management for the web dashboard.

Tenant Isolation
Boundary	Mechanism
Data isolation	All queries include WHERE user_id = ? or WHERE org_id = ?
Org-scoped tokens	api_tokens.org_id limits token to org resources
Private skills	visibility = 'private' + org check on every read
Rate limits	Per-token, not per-user (prevents token sharing abuse)
Wallet isolation	One wallet per user/org, no cross-wallet transfers except via ledger
Secret Storage
Secret type	Storage	Access
API token raw values	Never stored — only SHA-256 hash in DB	Shown once at creation, then gone
Stripe keys	.env file on VPS, not in DB	Config module only
LLM API keys	.env file	Provider module only
Platform signing secret	.env file	Sign-response middleware only
User secrets (future)	Encrypted column with per-user key envelope	Only decrypted at execution time
Network & Egress Controls
Control	Implementation
API proxy URL validation	Must be HTTPS. DNS resolved — reject if resolves to private IP (10.x, 172.16-31.x, 192.168.x, 127.x, ::1, fc/fd). Reject if no DNS resolution.
Webhook URL validation	Same as API proxy validation
Outbound timeout	All external fetches: 15s max, AbortController
Response size limit	API proxy responses: 1MB max
Request body limit	Inbound: 256KB max for task input, 64KB for webhooks
Prompt Injection Defense
Layer	Control
Skill publishing	Automated scanner (existing skill-scanner.ts) checks prompt templates for injection patterns
Task input	Input validated against JSON Schema before interpolation
Template interpolation	Mustache-style {{var}} only — no expression evaluation, no nested templates
Output validation	Result validated against output schema — prevents schema-violating injections from propagating
System prompts	Platform-controlled system prompt prefix on all LLM calls: "You are executing a skill. Return only the requested output format."
Threat Model
Threat	Attack Path	Impact	Prevention	Detection	Response
Malicious skill upload	Author publishes skill with prompt injection in template	LLM exfiltrates data or produces harmful output	Prompt scanner, template sanitization, no code execution	Scanner alerts, community reports	Suspend skill, ban author
Prompt injection via input	Attacker submits task input designed to override prompt	Bypass skill intent	JSON Schema validation limits input types/lengths; system prompt anchoring	Log unusual outputs, output schema validation catches off-spec results	Rate-limit the token
SSRF via api_proxy URL	Skill declares proxy_url: http://169.254.169.254/metadata	Cloud metadata exfiltration	URL validation rejects private IPs, DNS resolution check, HTTPS-only	Monitor proxy destinations	Suspend skill
Fake/garbage results	Provider skill always returns cached nonsense	Consumer pays for worthless work	Output schema validation; reputation system degrades bad providers	Low ratings, high dispute rate	Auto-suspend at dispute threshold
Replay attacks	Attacker replays a valid task submission	Double-billing	Idempotency key on tasks; nonce in signed payloads	Duplicate detection in ledger	Ignore replay, return original result
Request tampering	MITM alters task input or result	Data corruption	HTTPS everywhere; signed result envelopes	Signature verification fails	Alert consumer
Billing abuse	Attacker creates free trial accounts to burn credits	Revenue loss	Clerk identity verification; rate limits; minimum top-up; no free credits without email verification	Sudden spikes from new accounts	Freeze account, require identity
Stolen API keys	Key leaked in logs/code	Unauthorized access + spending	Never log raw keys; key rotation; scoped tokens; spending alerts	Unusual usage patterns, new IPs	Revoke key, notify user
Sybil providers	Attacker creates many accounts to inflate ratings	Fake reputation	Clerk identity linkage (email uniqueness); minimum earning threshold before payout; anti-self-purchase checks	Rating velocity anomalies; graph analysis	Freeze accounts, void ratings
Wash trading	Author invokes own skill to inflate metrics	Fake popularity + earn credits	Self-purchase prevention (email match); wallet-to-wallet transfer restrictions	Circular payment patterns	Clawback credits, suspend
Spam publishing	Flood catalog with low-quality skills	Bury good skills	Review queue; rate limit publish (max 5 skills/day); minimum description length	High reject rate from reviewers	Auto-ban high-rejection authors
DoS	Flood with tasks or large payloads	Service unavailable	Rate limiting per token/IP; request size limits; BullMQ concurrency limits	Request volume monitoring	Auto-throttle, block IPs
Cross-tenant access	Query manipulation to access another user's data	Data breach	Parameterized queries only; all queries scoped by user_id/org_id; no string interpolation in SQL	Audit log anomalies	Incident response, rotate credentials
Webhook injection	Attacker sets webhook_url to internal service	Internal service access	URL validation (no private IPs); HMAC-signed payloads	Monitor webhook destinations	Block URL, alert admin
Model output fraud	LLM returns fabricated data as fact	Consumer makes bad decisions	Output schema validation; disclaimer in metadata; no "verified truth" claims	User reports	Improve prompt engineering
Minimum Security Controls Before Launch
✅ All SQL queries parameterized (existing)
✅ API token hashing (implement)
✅ URL validation for proxy/webhook targets (implement)
✅ Request size limits (existing for webhooks, extend to all routes)
✅ Rate limiting (existing, extend to per-token)
✅ Prompt injection scanner (existing)
✅ Output schema validation (implement)
✅ Signed result envelopes (existing HMAC middleware, formalize)
✅ Audit logging on all mutations (extend existing)
✅ ADMIN_API_KEY enforcement (existing, hardened this session)
SECTION 10 — TRUST, REPUTATION, AND VERIFICATION
Provider Verification Tiers
Tier	Requirements	Privileges
Unverified	Email confirmed via Clerk	Publish skills (go through review queue), max 5 skills, limited to prompt_template type
Verified	50+ successful tasks, <10% dispute rate, identity verified	Skip auto-review for clean-scanned skills, up to 50 skills, api_proxy type allowed
Certified	500+ successful tasks, <5% dispute rate, manual review passed	Auto-publish, workflow type allowed, priority listing, "Certified" badge
Skill Verification Tiers
Tier	How achieved
UNSCANNED	Draft, not yet submitted
CLEAN	Passed automated scanner
VERIFIED	Published by certified author OR manually reviewed by admin
SUSPICIOUS	Scanner flagged patterns
FLAGGED	3+ community reports
Reputation Scoring (v1 — simple and legible)

score = (
  0.40 × success_rate +           -- 0-1, most important
  0.25 × rating_score +            -- avg_rating / 5.0
  0.20 × reliability_score +       -- 1 - (timeouts / total)
  0.15 × volume_score              -- log10(total_completed) / 4, capped at 1
) × dispute_penalty                -- max(0.5, 1 - disputes_lost × 0.05)
Anti-gaming protections:

Self-invocation blocked (email match + wallet match)
Minimum 10 tasks from 5 unique consumers before rating is displayed
Rating velocity limit: max 1 rating per consumer per skill per day
Reputation recomputed every 6 hours via cron, not on every task completion
Proof-of-Useful-Work
Task type	Can auto-verify?	Verification method
API retrieval (price check)	✅ Partial	Output matches schema; cross-check with known data source if available
Enrichment (add context)	❌	User acceptance (rating)
Classification	✅ Partial	Output matches schema; confidence scores included
Transformation (format data)	✅	Output matches output schema deterministically
Code generation	❌	User acceptance + optional lint/compile check
Research/analysis	❌	User acceptance (rating)
Monitoring/alerts	✅	Alert triggered = success; schema validation
Multi-step workflow	✅ Partial	Each step schema-validated; final output schema-validated
Decision for v1: Auto-verify schema conformance only. All other quality assessment is via consumer ratings and dispute resolution. Don't over-automate verification — it creates a false sense of trust.

SECTION 11 — BILLING, CREDITS, ESCROW, AND PAYOUTS
Credit System
1 credit = $0.001 USD (existing)
Credits are platform-internal accounting units, not transferable outside the platform
Minimum top-up: $5 (5,000 credits)
Credits never expire
Wallet Model

User creates account → system creates credit_wallet (owner_type='user', balance=0)
User top-ups via Stripe → ledger_entry: debit system:topup_pool → credit user wallet
User submits task → ledger_entry: debit user wallet → credit system:escrow_holding
Task succeeds → ledger_entry: debit system:escrow_holding → credit provider wallet (97%)
                 ledger_entry: debit system:escrow_holding → credit system:platform_fee (3%)
Task fails → ledger_entry: debit system:escrow_holding → credit user wallet (100% refund)
System Wallets (created at migration time)
Wallet	Purpose
system:topup_pool	Source for credit top-ups (virtual, balance is negative)
system:escrow_holding	Holds escrowed credits during task execution
system:platform_fee	Accumulates platform fees (3%)
system:payout_reserve	Credits earmarked for USD payout to providers
Pricing Models
Model	How it works	Use case
per_invocation	Fixed credit cost per task	Simple skills — "5 credits per analysis"
per_token	Base cost + per-1000-tokens surcharge	LLM-heavy skills where cost varies with output length
per_second	Base cost + per-second surcharge	Long-running workflows
For v1, implement per_invocation only. The others add complexity without clear demand.

Escrow Flow

                                    HELD
 consumer pays ──────────────────► escrow_holds
                                      │
                          ┌───────────┼───────────┐
                          │           │           │
                       success     failure     timeout
                          │           │           │
                          ▼           ▼           ▼
                      RELEASED    REFUNDED    REFUNDED
                       (97% to      (100%      (100%
                       provider,    back to    back to
                       3% fee)     consumer)  consumer)
                          │
                          │ dispute within 24h?
                          ▼
                      DISPUTED
                          │
                    ┌─────┴──────┐
                    │            │
                admin rules   admin rules
                refund        no refund
                    │            │
                    ▼            ▼
                REFUNDED      RELEASED
                (reverse       (keep
                 release)      release)
Payout State Machine (Provider Withdrawals)

Provider requests payout
        │
        ▼
    ┌────────┐
    │PENDING │ ── admin reviews
    └───┬────┘
        │
   ┌────┼────┐
   │         │
   ▼         ▼
┌──────┐  ┌──────┐
│APPRVD│  │REJECT│
└──┬───┘  └──────┘
   │
   │ admin processes
   ▼
┌──────┐
│ PAID │ ── Stripe payout or manual USDC
└──────┘
Payout rules:

Minimum payout: 10,000 credits ($10)
Payout frequency: weekly batch
7-day settlement delay (fraud buffer — if disputes come in, hold payout)
Platform take rate: 3% (already deducted at settlement, so payout = full wallet balance)
Anti-Abuse Controls
Control	What it prevents
Idempotency key on tasks	Double-billing
Escrow hold before execution	Consumers spending credits they don't have
Self-purchase prevention	Authors inflating their own earnings
7-day payout delay	Allows dispute resolution before cash leaves platform
Daily spending alerts	Anomalous usage patterns trigger admin notification
Minimum earning threshold	Prevents drive-by fraud (create account, earn tiny amount, cash out)
Ledger Entry Types
Type	Debit wallet	Credit wallet
topup	system:topup_pool	user/org wallet
escrow_hold	user/org wallet	system:escrow_holding
escrow_release	system:escrow_holding	provider wallet (97%)
platform_fee	system:escrow_holding	system:platform_fee (3%)
refund	system:escrow_holding	user/org wallet
payout	provider wallet	system:payout_reserve
adjustment	any	any (admin-only)
SECTION 12 — SEARCH, DISCOVERY, AND MATCHING
MVP Discovery
PostgreSQL full-text search using the search_vector tsvector column defined in Section 5.


SELECT id, slug, name, ts_rank(search_vector, query) AS rank
FROM skills, plainto_tsquery('english', $1) query
WHERE search_vector @@ query
  AND status = 'published'
  AND visibility = 'public'
  AND deleted_at IS NULL
ORDER BY rank DESC, total_invocations DESC
LIMIT 20;
Ranking Signals (v1)
Signal	Weight	Rationale
Text relevance (ts_rank)	40%	User is searching for something specific
Invocation count (log scale)	20%	Social proof
Success rate	20%	Quality indicator
Average rating	10%	User satisfaction
Recency (published_at)	10%	Fresh content
Category Taxonomy
Use the existing 15 categories from the API registry, plus a few for skills:

defi, solana, social, utility, intelligence, oracle, scraping, search, media, enrichment, weather, ai-ml, security, infrastructure, general

Cold Start
New skills have no invocations or ratings. Handle by:

Show "New" badge for skills < 7 days old
Boost new skills from verified/certified authors by 1.5× in ranking
After 50 invocations, use actual metrics
Anti-Spam Ranking
Skills from suspended authors: excluded from search entirely
Skills with security_status = 'FLAGGED': excluded from search, visible only via direct URL
Maximum 10 skills per author in any single search result page
Semantic Search (v1.1)
Existing skill_embeddings virtual table and embedding model. Wire it as a secondary ranking signal:

Query embedding cosine similarity with skill description embedding
Blend: 60% text search + 40% semantic similarity (only when text search has < 5 results)
SECTION 13 — FRONTEND AND UX IMPLEMENTATION PLAN
Pages (Plain HTML — existing pattern)
Page	Purpose	Key Components
Landing (index.html)	Marketing, value prop	Hero, features, pricing, CTA to sign up
Dashboard (dashboard.html)	User home — credits, recent tasks, quick actions	Balance widget, task list, quick-invoke
Skill Directory (marketplace.html)	Browse/search skills	Search bar, category pills, skill cards, sort controls
Skill Detail	View skill details, invoke, star	Description, I/O schema, pricing, "Try it" form, reviews, version history
Publish Wizard	Create/edit skill	Multi-step form: metadata → template/proxy config → I/O schema → pricing → review → submit
My Skills	Author dashboard	List of authored skills, metrics per skill, earnings
Task History	Consumer task list	Filterable list of past tasks, status, results, cost
Credits	Billing page	Balance, top-up buttons, ledger history, spending chart
Settings	Account settings	API tokens, notification prefs, connected accounts
Admin Console	Moderation	Review queue, dispute list, user management, platform metrics
Security-Sensitive UI States
State	Handling
API token display	Show raw key only once at creation in a copy-to-clipboard modal. Never show again.
Credit balance	Always show real-time balance before any purchase action
Task result with PII	Sanitize before display — no raw JSON dump
Admin actions	Require confirmation dialog for skill suspension, user bans, dispute resolution
Implementation Approach
Keep the existing pattern: plain HTML + vanilla JS served by Caddy. No React/Vue/etc. This keeps the frontend simple, fast, and easy to maintain for a two-person team. Use fetch() to call the API, client-side hash routing for SPA-like navigation within a page.

SECTION 14 — INTERNAL SERVICES BREAKDOWN
Module Architecture (Modular Monolith)
All modules live in the same Hono process. Each module is a directory under src/modules/ with its own routes, queries, types, and business logic. Modules communicate via direct function calls (not HTTP or queues within the monolith).

Module	Responsibilities	Owned Data
identity	User CRUD, API token management, Clerk integration	users, api_tokens, org_memberships
org	Organization CRUD, membership management	organizations
catalog	Skill CRUD, versioning, search, publishing pipeline	skills, skill_versions
execution	Task lifecycle, job dispatch, result handling	tasks, executions
ledger	Credit wallet management, double-entry bookkeeping, escrow	credit_wallets, ledger_entries, escrow_holds
trust	Reputation computation, ratings, verification tiers	reputation_profiles, task_ratings
disputes	Dispute lifecycle, evidence, resolution	disputes
search	Full-text search, ranking, category management	Search indexes (within skills table)
webhooks	Outbound webhook delivery, retry logic	Webhook delivery jobs in BullMQ
notifications	Email, Telegram, in-app notifications	notifications table (future)
audit	Audit event recording and querying	audit_events
admin	Moderation tools, platform metrics, review queue	No owned data — reads from all modules
Why Modular Monolith
One deployment unit — deploy with docker compose up --build
One database — no distributed transactions
Shared types — TypeScript interfaces shared across modules
Simple debugging — one log stream, one process, breakpoints work
Extract later — if execution needs independent scaling (v2), extract execution module to its own service + BullMQ worker
First Extraction Candidate
The execution module is the only module with genuinely different scaling characteristics. Task execution is CPU/IO-bound and bursty, while the rest of the API is lightweight CRUD. In v2, extract it to:

Separate BullMQ worker process
Scales horizontally (add more workers)
Communicates via BullMQ jobs + PostgreSQL (shared DB)
SECTION 15 — JOBS, QUEUES, EVENTS, AND ASYNC FLOWS
Queue Technology
BullMQ on Redis. Already available in the stack. Reasons:

Battle-tested in production Node.js apps
Built-in retry, delay, rate-limiting, priority, dead-letter
Dashboard available (Bull Board)
No separate infrastructure (uses existing Redis)
Job Types (v1)
Job	Queue	Concurrency	Timeout	Retries	DLQ
task.execute	execution	10	Per-task timeout + 5s	0 (fail = fail)	Yes
webhook.deliver	webhooks	20	10s	5 (exp backoff)	Yes
reputation.recompute	maintenance	1	60s	3	No
payout.process	payouts	1	30s	3	Yes
audit.archive	maintenance	1	300s	1	No
skill.scan	moderation	5	30s	1	No
Idempotency Strategy
Task execution: Idempotency key on task creation. If same key + user, return existing task.
Ledger entries: Idempotency key on every entry. UNIQUE constraint prevents double-posting.
Webhook delivery: BullMQ job ID derived from task_id + attempt_number. Deduplication is built into BullMQ.
Stripe webhooks: Existing event dedup tables. Same pattern.
Event Naming Convention
{domain}.{entity}.{action} — examples:

catalog.skill.published
execution.task.completed
ledger.credit.topup
trust.reputation.recomputed
admin.skill.suspended
Delivery Guarantees
At-least-once for all jobs. Idempotency keys handle duplicates.
No saga patterns in v1. All critical operations (escrow hold → execute → release) happen in single PostgreSQL transactions where possible. The execution itself is the only thing that spans transactions, and it's protected by the escrow pattern (hold → succeed/fail → release/refund).
SECTION 16 — TECH STACK RECOMMENDATION
Layer	Choice	Why
Backend framework	Hono	Existing choice. Fast, lightweight, excellent TypeScript support. No reason to switch.
Runtime	Node.js 22 + tsx	Existing. tsx handles ESM/CJS interop well.
Database	PostgreSQL 16	Relational integrity, JSONB, full-text search, row-level locking, advisory locks, partitioning. For this plan's ambitions, SQLite's single-writer limitation becomes a bottleneck under concurrent task execution. Migration note: if staying on SQLite, all schemas and queries adapt — the domain model is the same.
Cache	Redis 7	Existing. Rate limiting, session cache, BullMQ backing store, pub/sub.
Queue	BullMQ	Node.js native, Redis-backed, proven. No Kafka/RabbitMQ overhead.
Object storage	Cloudflare R2 or S3	Large execution results. R2 has no egress fees.
Auth	Clerk	Existing. Handles JWT, OAuth, MFA. API tokens handled in-house.
Email	Resend	Existing. Simple, reliable transactional email.
Observability	Pino (logs) + Sentry (errors)	Existing. Add OpenTelemetry tracing in v1.1.
Search	PostgreSQL tsvector	Built-in, no extra service. Switch to Meilisearch if needed at scale.
Infra	DigitalOcean VPS + Docker Compose	Existing. Simple, affordable, sufficient for MVP. Move to managed k8s only when horizontal scaling is actually needed.
CI/CD	GitHub Actions	Existing. Typecheck + test on PR, deploy on merge to main.
Testing	Vitest	Existing. Fast, native TypeScript, Vite-compatible.
Secrets	.env file on VPS	Existing. Move to Vault/1Password Secrets only when team grows.
What NOT to add:

❌ Kafka — overkill for this scale
❌ Kubernetes — overkill for this scale
❌ GraphQL — REST is sufficient and simpler
❌ tRPC — adds build complexity without proportional benefit for a public API
❌ Prisma/Drizzle ORM — raw SQL is faster and clearer (existing convention)
SECTION 17 — CODEBASE STRUCTURE FOR SONNET
Repository Structure
Monorepo. Single claw-net repository. All backend, frontend, infra in one place.


claw-net/
├── src/
│   ├── index.ts                    # Hono app, route registration, startup
│   ├── config/
│   │   └── index.ts                # Zod env config
│   │
│   ├── modules/                    # Domain modules (new structure)
│   │   ├── identity/
│   │   │   ├── routes.ts           # /v1/auth/* routes
│   │   │   ├── queries.ts          # User/token DB queries
│   │   │   ├── service.ts          # Business logic
│   │   │   └── types.ts            # Module-specific types
│   │   │
│   │   ├── catalog/
│   │   │   ├── routes.ts           # /v1/skills/* routes
│   │   │   ├── queries.ts          # Skill/version DB queries
│   │   │   ├── service.ts          # Publishing pipeline, search
│   │   │   ├── scanner.ts          # Prompt injection scanner
│   │   │   └── types.ts
│   │   │
│   │   ├── execution/
│   │   │   ├── routes.ts           # /v1/tasks/* routes
│   │   │   ├── queries.ts          # Task/execution DB queries
│   │   │   ├── service.ts          # Task lifecycle
│   │   │   ├── worker.ts           # BullMQ job processor
│   │   │   ├── executors/
│   │   │   │   ├── prompt.ts       # Prompt template executor
│   │   │   │   ├── proxy.ts        # API proxy executor
│   │   │   │   └── workflow.ts     # Workflow DAG executor
│   │   │   └── types.ts
│   │   │
│   │   ├── ledger/
│   │   │   ├── routes.ts           # /v1/credits/* routes
│   │   │   ├── queries.ts          # Wallet/ledger DB queries
│   │   │   ├── service.ts          # Escrow, settlement, top-up
│   │   │   └── types.ts
│   │   │
│   │   ├── trust/
│   │   │   ├── routes.ts           # Rating endpoints
│   │   │   ├── queries.ts
│   │   │   ├── service.ts          # Reputation computation
│   │   │   └── types.ts
│   │   │
│   │   ├── disputes/
│   │   │   ├── routes.ts
│   │   │   ├── queries.ts
│   │   │   ├── service.ts
│   │   │   └── types.ts
│   │   │
│   │   ├── admin/
│   │   │   ├── routes.ts           # /v1/admin/* routes
│   │   │   └── service.ts
│   │   │
│   │   └── audit/
│   │       ├── queries.ts
│   │       └── service.ts          # Audit event recording
│   │
│   ├── middleware/
│   │   ├── auth.ts                 # API token + Clerk JWT resolver
│   │   ├── rate-limit.ts
│   │   ├── sign-response.ts
│   │   └── validate.ts             # JSON Schema validation middleware
│   │
│   ├── db/
│   │   ├── index.ts                # Connection pool, migration runner
│   │   ├── migrations/             # Numbered migration files
│   │   │   ├── 001_initial.sql
│   │   │   ├── 002_ledger.sql
│   │   │   └── ...
│   │   └── seed.ts                 # System wallets, official skills
│   │
│   ├── jobs/
│   │   ├── queue.ts                # BullMQ queue setup
│   │   ├── worker.ts               # Worker process entry point
│   │   └── handlers/
│   │       ├── execute-task.ts
│   │       ├── deliver-webhook.ts
│   │       ├── recompute-reputation.ts
│   │       └── scan-skill.ts
│   │
│   ├── integrations/
│   │   ├── telegram.ts
│   │   ├── stripe.ts               # Stripe checkout + webhooks
│   │   └── clerk.ts                # Clerk webhooks
│   │
│   ├── utils/
│   │   ├── logger.ts
│   │   ├── shutdown.ts
│   │   ├── mask.ts
│   │   ├── url-validator.ts        # SSRF prevention
│   │   └── crypto.ts               # HMAC, hashing helpers
│   │
│   └── shared/
│       ├── schemas.ts              # Zod schemas shared across modules
│       ├── errors.ts               # Error types and HTTP error helper
│       └── constants.ts            # Platform constants (fee %, limits)
│
├── site/                           # Static HTML frontend
│   ├── index.html
│   ├── dashboard.html
│   ├── marketplace.html
│   └── docs.html
│
├── tests/
│   ├── unit/
│   │   ├── ledger.test.ts
│   │   ├── execution.test.ts
│   │   ├── catalog.test.ts
│   │   └── ...
│   ├── integration/
│   │   └── task-lifecycle.test.ts
│   └── helpers/
│       └── db.ts                   # Test DB setup
│
├── docs/
│   ├── RUNBOOK.md
│   └── escrow-design.md
│
├── data/                           # SQLite DB file (dev/current)
├── docker-compose.yml
├── Dockerfile
├── tsconfig.json
├── vitest.config.ts
├── package.json
└── ROADMAP.md
Architectural Rules for Sonnet
Module boundaries: Modules import from ../shared/ and ../utils/ only. Cross-module communication is via direct function imports from service.ts, never by importing another module's queries.ts directly.

Query isolation: Each module's queries.ts only touches its own tables. If module A needs data from module B's tables, it calls module B's service function.

Route pattern:


// modules/catalog/routes.ts
import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import * as service from './service';

const router = new Hono();
router.get('/skills', async (c) => { ... });
router.post('/skills', authMiddleware, async (c) => { ... });
export { router as catalogRouter };
Error handling: All service functions throw typed errors from shared/errors.ts. Route handlers catch and convert to HTTP responses. Never return raw DB errors to clients.

Naming conventions:

Files: kebab-case.ts
Types/interfaces: PascalCase
Functions: camelCase
DB columns: snake_case
API fields: snake_case (JSON response matches DB)
Constants: UPPER_SNAKE_CASE
SECTION 18 — IMPLEMENTATION ORDER
Phase 1: Foundation (Days 1–5)
Step 1.1: Database migration system

Objective: Set up PostgreSQL connection + numbered migration runner
Files: src/db/index.ts, src/db/migrations/001_initial.sql
Acceptance: Migration runs on startup, creates all tables from Section 5
Tests: Migration runs idempotently
Pitfall: Don't mix SQLite and PostgreSQL migration systems — choose one. If staying on SQLite, adapt the SQL syntax (no gen_random_uuid(), no PARTITION BY, use TEXT for UUIDs).
Step 1.2: Module scaffolding

Objective: Create module directory structure, shared types, error handling
Files: All module directories, shared/errors.ts, shared/schemas.ts, shared/constants.ts
Acceptance: Project compiles with empty modules
Tests: TypeScript compiles clean
Step 1.3: Auth middleware refactor

Objective: Unified auth that resolves API tokens (hashed) and Clerk JWTs to a standard identity context
Files: middleware/auth.ts, modules/identity/queries.ts, modules/identity/service.ts
Acceptance: Every route gets c.get('identity') with { userId, orgId?, scopes }
Tests: Unit tests for token hash lookup, scope checking
Pitfall: Remember to hash tokens with SHA-256 on lookup, not compare raw strings.
Step 1.4: Credit wallet + double-entry ledger

Objective: Implement credit_wallets, ledger_entries tables, record_ledger_entry() function, system wallets
Files: modules/ledger/queries.ts, modules/ledger/service.ts, db/seed.ts
Acceptance: Can create wallet, top up credits, transfer between wallets, balance never goes negative
Tests: 10+ tests covering topup, transfer, insufficient balance, idempotency key dedup
Pitfall: The record_ledger_entry() function MUST be atomic — debit + credit + record in one transaction. If using SQLite, use getDb().transaction(). If PostgreSQL, use a PL/pgSQL function or a BEGIN/COMMIT block.
Phase 2: Catalog & Publishing (Days 6–10)
Step 2.1: Skill CRUD

Objective: Create, read, update, soft-delete skills. Versioning.
Files: modules/catalog/routes.ts, modules/catalog/queries.ts, modules/catalog/service.ts
Acceptance: Can create skill draft, submit for review, publish. Versioning works. Search by text/category.
Tests: CRUD operations, search, visibility filtering
Pitfall: Skill slugs must be globally unique. Validate slug format (lowercase alphanumeric + hyphens, 3-60 chars).
Step 2.2: Skill manifest validation

Objective: Validate manifest structure on create/update. Validate I/O schemas.
Files: modules/catalog/service.ts, shared/schemas.ts
Acceptance: Invalid manifests rejected with specific error messages. JSON Schema validated.
Tests: Valid and invalid manifests
Pitfall: Don't validate the prompt template content at this stage — that's the scanner's job. Just validate structure.
Step 2.3: Publishing pipeline + scanner

Objective: Submit → scan → auto-approve (if clean + verified author) or queue for review
Files: modules/catalog/scanner.ts, jobs/handlers/scan-skill.ts
Acceptance: Skills go through scan on submit. Status transitions correctly.
Tests: Scanner catches known injection patterns, clean skills pass
Step 2.4: Search & discovery

Objective: Full-text search, category filtering, ranking
Files: modules/catalog/queries.ts (search queries), modules/catalog/routes.ts (GET /v1/skills)
Acceptance: Search returns ranked results with category filters
Tests: Search relevance, empty results, category filter
Phase 3: Task Execution (Days 11–18)
Step 3.1: Task submission + escrow hold

Objective: POST /v1/tasks creates task, validates input, holds escrow
Files: modules/execution/routes.ts, modules/execution/service.ts
Acceptance: Task created, credits escrowed atomically, idempotency works
Tests: Submit, idempotency, insufficient credits, invalid input
Pitfall: Escrow hold and task creation MUST be in the same transaction. If escrow succeeds but task insert fails, credits are locked forever.
Step 3.2: BullMQ worker setup

Objective: Worker process that picks up execution jobs
Files: jobs/queue.ts, jobs/worker.ts, jobs/handlers/execute-task.ts
Acceptance: Worker starts, picks up jobs, processes them
Tests: Worker integration test with mock execution
Step 3.3: Prompt template executor

Objective: Interpolate input into template, call LLM, validate output, store result
Files: modules/execution/executors/prompt.ts
Acceptance: End-to-end: submit task → execute → get result
Tests: Successful execution, LLM failure, timeout, output validation failure
Pitfall: Sanitize input before interpolation — {{token}} replacement must not allow template injection.
Step 3.4: API proxy executor

Objective: Make HTTP request to external URL, return response
Files: modules/execution/executors/proxy.ts, utils/url-validator.ts
Acceptance: Proxied request works, URL validation prevents SSRF
Tests: Valid URL, private IP rejection, timeout, large response handling
Pitfall: URL validation is security-critical. Resolve DNS and check the resolved IP, not just the hostname. localhost, 127.0.0.1, 10.x.x.x, 172.16-31.x.x, 192.168.x.x, 169.254.x.x, ::1, fc/fd, fe80 — all blocked.
Step 3.5: Settlement (escrow release/refund)

Objective: On success: release escrow to provider + fee. On failure: refund to consumer.
Files: modules/ledger/service.ts (settlement functions), modules/execution/service.ts
Acceptance: Credits flow correctly on success and failure
Tests: Success settlement (97/3 split), failure refund, dispute
Pitfall: Settlement must be idempotent — if called twice for the same task, the second call is a no-op (check escrow status first).
Step 3.6: Webhook delivery

Objective: Deliver task results to consumer's webhook URL
Files: jobs/handlers/deliver-webhook.ts, utils/url-validator.ts
Acceptance: Webhooks delivered with HMAC signature, retried on failure
Tests: Successful delivery, retry on 5xx, give up after 5 attempts
Phase 4: Trust & Billing Polish (Days 19–25)
Step 4.1: Task ratings

Objective: POST /v1/tasks/:id/rate
Files: modules/trust/routes.ts, modules/trust/queries.ts
Acceptance: 1-5 rating stored, one per consumer per task
Step 4.2: Reputation computation

Objective: Recompute reputation scores every 6 hours
Files: modules/trust/service.ts, jobs/handlers/recompute-reputation.ts
Acceptance: Scores updated based on formula from Section 10
Step 4.3: Disputes

Objective: Open dispute, submit evidence, admin resolves
Files: modules/disputes/routes.ts, modules/disputes/service.ts
Acceptance: Dispute lifecycle works, refund executes on resolution
Step 4.4: Stripe integration (adapted)

Objective: Credit top-up via Stripe, webhook handling (existing, adapt to new ledger)
Files: integrations/stripe.ts, modules/ledger/service.ts
Acceptance: Stripe checkout → webhook → credits in wallet (via ledger)
Pitfall: The existing Stripe code works. Adapt it to use the new ledger's record_ledger_entry() instead of direct UPDATE api_keys SET credits = credits + ?.
Phase 5: Admin & Polish (Days 26–30)
Step 5.1: Admin console

Objective: Review queue, dispute management, platform metrics
Files: modules/admin/routes.ts, site/admin.html
Step 5.2: Audit logging

Objective: Record all mutations as audit events
Files: modules/audit/service.ts — called from every service mutation
Step 5.3: End-to-end tests

Objective: Full task lifecycle test: sign up → create skill → publish → submit task → get result → rate → check credits
Files: tests/integration/task-lifecycle.test.ts
Step 5.4: Documentation

Objective: API docs page, update ROADMAP.md
Files: site/docs.html, ROADMAP.md
SECTION 19 — MVP BACKLOG
P0 — Ship Blockers
Epic	Story	Acceptance Criteria
Auth	As a user, I can create and revoke API tokens	Token created with SHA-256 hash, raw shown once, revoke sets revoked_at
Catalog	As an author, I can create a prompt_template skill with I/O schemas	Skill draft created, manifest validated, input/output schemas stored
Catalog	As an author, I can submit a skill for review and it gets published	Scanner runs, status transitions correctly, skill appears in search
Execution	As a consumer, I can submit a task and get a result	Task created, escrow held, executed, result returned, escrow settled
Ledger	As a user, I can top up credits via Stripe	Stripe checkout → webhook → ledger entry → wallet balance updated
Ledger	As a consumer, my credits are escrowed when I submit a task	Balance decremented atomically, escrow hold created
Ledger	As a consumer, I get a full refund if task execution fails	Escrow released back to my wallet
Search	As a consumer, I can search for skills by keyword and category	Full-text search returns ranked results
Admin	As an admin, I can approve/reject/suspend skills	Status transitions, audit logged
P1 — Important for Launch
Epic	Story
Catalog	API proxy skill type with URL validation
Execution	Webhook delivery for async task results
Trust	Task ratings (1-5 stars)
Trust	Reputation score computation
Disputes	Open and resolve disputes
Billing	Credit balance and ledger history page
Admin	Platform metrics dashboard
Security	Prompt injection scanner on skill submit
Security	Signed result envelopes (HMAC)
P2 — Nice to Have for v1
Epic	Story
Catalog	Workflow skill type (DAG of sub-skills)
Org	Organization accounts with shared billing
Catalog	Private skill visibility (org-only)
Trust	Provider verification tiers
Billing	Creator payout requests
Search	Semantic search via embeddings
UX	Skill detail page with "Try it" form
SECTION 20 — TESTING AND QA STRATEGY
Test Pyramid
Layer	Tool	Coverage Target	What to test
Unit	Vitest	80%+ on services	Ledger math, escrow state machine, manifest validation, URL validation, scanner patterns
Integration	Vitest + test DB	Key flows	Task lifecycle end-to-end, settlement correctness, Stripe webhook handling
API contract	Vitest + supertest/hono-testing	All endpoints	Request validation, response shapes, auth requirements, error codes
Security	Manual + Vitest	All attack vectors	SSRF prevention, injection patterns, auth bypass attempts, rate limiting
Load	scripts/loadtest.sh (existing)	Key endpoints	Concurrent task submission, settlement under load
Minimum Test Gates Before Ship
✅ All ledger operations tested for correctness (balance arithmetic, idempotency, insufficient funds)
✅ Escrow lifecycle tested: hold → release, hold → refund, hold → dispute → resolve
✅ Auth tested: valid token, invalid token, expired token, revoked token, insufficient scopes
✅ URL validation tested: all private IP ranges blocked, DNS resolution checked
✅ Prompt scanner tested: all 14+ injection patterns detected
✅ Task lifecycle integration test: create skill → submit task → execute → get result → check credits
✅ Stripe webhook test: idempotent processing, correct credit amount
✅ TypeScript compiles with zero errors (existing CI gate)
SECTION 21 — OPERATIONS AND OBSERVABILITY
Top 20 Operational Metrics
#	Metric	Alert Threshold	Dashboard
1	Task success rate (5m window)	< 90%	Yes
2	Task median latency (5m)	> 10s	Yes
3	Task p99 latency (5m)	> 30s	Yes
4	Tasks pending in queue	> 100	Yes
5	Active escrow holds total credits	N/A (informational)	Yes
6	Credit top-ups per hour	< 1 for 24h (no revenue)	Yes
7	Total platform credits outstanding	N/A	Yes
8	API error rate (5xx)	> 1%	Yes
9	Rate limit hits per minute	> 50	Yes
10	Stripe webhook processing time	> 5s	Yes
11	Skills pending review	> 20	Yes
12	Open disputes	> 10	Yes
13	Provider dispute rate (rolling 30d)	> 15% for any provider	Alert
14	DB connection pool utilization	> 80%	Alert
15	Redis memory usage	> 80%	Alert
16	BullMQ dead-letter queue size	> 0	Alert
17	Disk usage	> 85%	Alert
18	Unhandled rejections per hour	> 0	Alert
19	New user signups per day	N/A	Yes
20	Revenue per day (credits sold)	N/A	Yes
Operational Stack
Concern	Tool
Structured logging	Pino (existing)
Error tracking	Sentry (existing)
Uptime monitoring	External health check (UptimeRobot or similar)
Metrics	Pino log aggregation → simple JSON dashboard (v1); Prometheus + Grafana (v2)
Audit review	Admin endpoint + audit_events table
Alerting	Telegram alerts (existing sendTelegramAlert)
Deploys	git push → VPS git hook → docker compose up --build
Rollback	git revert + redeploy
Feature flags	Environment variables (v1); LaunchDarkly (v2 if needed)
SECTION 22 — ENTERPRISE READINESS PLAN
MVP Enterprise-Compatible (Now)
Feature	Status
API token auth	✅ Implement
Rate limiting	✅ Existing
Audit logging	✅ Implement
HTTPS everywhere	✅ Existing (Caddy)
Data encryption at rest	✅ PostgreSQL native (or SQLite WAL + disk encryption)
Role-based access (user/admin)	✅ Existing
Full Enterprise (Later)
Feature	Phase	Rationale for deferring
SSO/SAML	v2	Requires Clerk Enterprise plan ($$$). No demand yet.
Private catalogs per org	v1.1	Simple visibility filter, not complex.
Approval workflows for skill usage	v2	Enterprise orgs want to approve which skills their team can use.
Private execution (dedicated worker)	v3	Requires separate infrastructure per tenant.
Data retention controls	v2	GDPR/SOC2 requirement.
SOC 2 compliance	v3	Requires audit + process maturity.
Private networking (VPC peering)	v3	Only needed for on-prem.
Custom SLAs	v2	Contractual, not technical.
SECTION 23 — RISKS AND DESIGN CORRECTIONS
Hardest Engineering Risks
Risk	Why Dangerous	Business Impact	Mitigation
Ledger bugs	Double-entry bookkeeping is unforgiving — a bug means credits appear or disappear	Users lose trust, financial liability	Extensive tests, idempotency keys, regular balance reconciliation cron
Escrow race conditions	Concurrent settlement + dispute on same task	Credits double-counted or lost	PostgreSQL advisory locks on task_id during settlement; status check before mutation
LLM cost overruns	Prompt template skills can generate expensive LLM calls	Platform loses money on every invocation	Max token limits on all skills; cost estimation before execution; circuit breaker on LLM spend
SSRF via API proxy	Attacker publishes skill pointing at internal services	Data exfiltration, cloud metadata theft	DNS resolution + IP validation; HTTPS-only; no redirects followed
Reputation gaming	Sybil accounts inflate ratings	Fake trust signals mislead consumers	Email uniqueness, minimum volume thresholds, self-purchase detection
Migration risk	Moving from SQLite to PostgreSQL	Data loss, downtime	Dual-write migration strategy; extensive testing; keep SQLite as fallback
Over-Engineered Parts (Self-Critique)
Workflow skill type — DAG execution is complex. For MVP, defer to P2. Prompt templates and API proxies cover 95% of use cases.

Per-token / per-second pricing — Unnecessary complexity. Per-invocation pricing is sufficient for v1. Add variable pricing when creators actually request it.

Organization accounts — Important for enterprise but not for the first 5 paying users. Defer to v1.1.

Reputation formula — The weighted score formula is reasonable but could be replaced with "success rate + total completions" for v1. The full formula can come later when gaming is actually observed.

Partitioned audit_events — Premature optimization. A single table with a created_at index is fine until millions of rows. Add partitioning when needed.

Simplification for Sonnet: In Phase 1, implement only prompt_template and api_proxy skill types, per_invocation pricing, and user accounts (no orgs). This cuts the scope by ~30% while preserving the core value loop.

SECTION 24 — FINAL RECOMMENDED BUILD
1. Final Architecture Decision
Modular monolith on Hono + PostgreSQL + Redis + BullMQ. Single deployment. Modules for identity, catalog, execution, ledger, trust, disputes, admin, audit.

2. Final Skill Publishing Decision
Manifests only. Prompt templates and API proxy endpoints in v1. Workflows in v1.1. Sandboxed code execution in v3 (gated behind verified publisher + static analysis + capability scoping). No file uploads. No Docker images. No arbitrary code.

3. Final Execution Decision
Platform-hosted execution. The platform calls LLMs and external APIs on behalf of the consumer. Escrow-based billing: hold credits → execute → release on success / refund on failure. BullMQ workers handle async execution with configurable timeouts.

4. Final Trust/Safety Decision
Defense in depth. Prompt scanner on publish. URL validation (anti-SSRF) on API proxy skills. Input/output JSON Schema validation. Signed result envelopes. Community reporting. Admin moderation queue. Reputation scoring with anti-gaming protections. 24-hour dispute window after task completion.

5. Final Billing Decision
Double-entry credit ledger with escrow. Every credit movement is a ledger entry with debit wallet + credit wallet + idempotency key. Escrow holds during execution. 3% platform fee on settlement. 7-day payout delay. Minimum payout threshold. Stripe for top-ups, manual/USDC for payouts.

6. Final Codebase Structure
src/modules/{identity,catalog,execution,ledger,trust,disputes,admin,audit}/ — each with routes.ts, queries.ts, service.ts, types.ts. Shared code in src/shared/. Jobs in src/jobs/. Middleware in src/middleware/. Tests mirror source structure.

7. Final 30-Day MVP
Week 1: DB migration, module scaffolding, auth refactor, credit ledger
Week 2: Skill CRUD, publishing pipeline, search
Week 3: Task submission, escrow, BullMQ execution, prompt + proxy executors, settlement
Week 4: Admin console, Stripe integration, audit logging, end-to-end tests, deploy
8. Final 90-Day v1
Month 2: Workflow skill type, organization accounts, private catalogs, dispute resolution, reputation system, payout requests, semantic search
Month 3: Provider verification tiers, signed result envelopes, webhook delivery hardening, load testing, documentation, marketing site refresh
9. The Single Most Important Thing Sonnet Must Not Get Wrong
The ledger. Every credit movement — top-up, escrow hold, settlement, refund, payout, fee — must flow through record_ledger_entry() as a double-entry transaction with an idempotency key. No direct UPDATE wallet SET balance = balance + ? anywhere in the codebase. If the ledger is correct, everything else can be fixed. If the ledger is wrong, nothing else matters — you have a financial system that lies about money.