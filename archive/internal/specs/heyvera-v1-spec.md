# HeyVera Living Spec — v1.0

> Canonical source of truth for HeyVera platform architecture.
> Written 2026-05-20. Synthesized from 10 GPT 5.5 deep analysis sessions + Claude Opus architectural synthesis.
> Versioned, updatable. Brainstorm archives in `.dualbrain/gpt55-*.md`.

---

## I. What HeyVera Is

A **sovereign living network** where agents and humans are first-class citizens. Not a web app with AI features — a high-throughput cryptographic real-time platform that also happens to have web UIs.

Agents will generate 10-100x the traffic of humans. Sovereign nodes run on individual machines. Data is owned by people. Intelligence is sovereign. Trust is in the protocol.

**v1 auth reality:** Human interactions authenticated via Clerk JWT. Agent interactions authenticated via Soma delegation. In v2, Clerk-authenticated humans receive a bridged Soma identity so all interactions have a Soma provenance trail. Until then, "cryptographic trust" means Soma for agents, Clerk for humans — not a universal claim.

### The Layers

| Layer | Role | Workload |
|-------|------|----------|
| **Soma** | Open trust protocol. Identity (did:key), delegations, spend receipts, heartbeat chains | CPU-bound crypto, trust-critical |
| **VeraAI** | Distributed intelligence from sovereign compute nodes | Federated learning, stateful observation |
| **Cortex** | Orchestration brain. Task routing, context assembly, agent lifecycle. **Never executes user code.** | High-concurrency WebSocket, real-time |
| **Worker Runtime** | Isolated execution plane. Runs agent code in Firecracker/gVisor containers. Separate process, separate machine. | CPU/IO-bound, sandboxed |
| **Surfaces** | Social, Marketplace, Crypto, Hosting, Data APIs, Billing | Varied per surface |

### The Strategy

Cortex ships first. Use Cortex to build everything else. The strategy is recursive: build the tool, use the tool to build the rest.

---

## II. Data Classification

> Root architectural decision. Every piece of data in the system belongs to exactly one class. This determines mutability, retention, erasure, and privacy guarantees.

### The Four Classes

```
CLASS A — EPHEMERAL (never persisted by HeyVera)
  Assembled context, provider prompts, provider responses, working memory,
  container filesystem state, WebSocket message payloads in transit.
  
  Lifetime: request or container scope. Auto-destroyed when scope ends.
  Erasure: N/A — nothing to delete on HeyVera's side.
  Privacy: never written to disk or database by HeyVera. However, Class A
           data IS sent to external LLM providers — their data-retention
           policies apply. HeyVera selects providers with zero-retention
           API terms where available and documents provider retention in
           the privacy policy.

CLASS B — OPERATIONAL (durable, deletable)
  domain_events, jobs, user settings, HEAD project memory,
  TaskSummaries, billing_ledger, sessions, audit_log (see note below).
  
  Lifetime: retained with configurable TTL. Default 90 days for events,
            indefinite for user settings, 30 days for completed jobs.
  Erasure: hard-delete. User deletion → cascade delete all Class B data
           for that account. HEAD memory recompacted from remaining events.
  Privacy: visible to account owner + platform operators. Not shared externally.
  Mutability: mutable (jobs change state, settings update, events can be deleted).
  
  Note on audit_log: security/compliance audit logs may require longer
  retention and tamper-evidence. These are Class B for deletion purposes
  but subject to a legal-hold exception: audit entries under active
  investigation or regulatory retention are frozen until the hold expires.

CLASS B-CONTENT — OPERATIONAL WITH RAW CONTENT (durable, deletable, never shared)
  Conversations (user messages + assistant responses), uploaded files,
  provider call transcripts (if user enables conversation logging).
  
  Lifetime: retained indefinitely for account owner access. Deletable by user.
  Erasure: hard-delete on user request or account deletion.
  Privacy: contains raw prompts, code, and responses. NEVER shared with
           VeraAI, NEVER used for training, NEVER leaves the account boundary.
           This is the user's private data stored for their own use.
  Mutability: append-mostly (new messages added, edits possible).
  
  The privacy claims in Section VI ("never shared by default: raw prompts,
  raw code, raw responses") apply to what crosses account boundaries into
  VeraAI/federated learning. Class B-CONTENT is stored FOR the user,
  not extracted FROM the user.

CLASS C — CONSENT-GATED (durable, crypto-erasable)
  ObservationEnvelopes, EvaluationReceipts, VeraAI training contributions,
  federated learning updates.
  
  Lifetime: retained per consent policy. Consent revocation → crypto-erasure.
  Erasure: crypto-erasure. Each user's Class C data encrypted with a per-user
           key derived from their account KEK. Deleting the key renders data
           unrecoverable. Federated model contributions: exclude from next
           retraining window (checkpointed retraining, not surgical unlearning).
  Privacy: shared only per consent tier. Content-addressed for integrity.
  Mutability: append-only within a consent window. Entire windows can be
              crypto-erased. Individual envelopes are immutable once written.

CLASS D — PROTOCOL PROOFS (immutable, no PII)
  Soma delegation hashes, signature commitments, heartbeat chain anchors,
  x402 settlement transaction hashes, revocation records.
  
  Lifetime: permanent. These are cryptographic commitments, not personal data.
  Erasure: not required — contains no PII. Only hashes, signatures, timestamps,
           and public keys. The data these proofs reference (Class B/C) can be
           deleted; the proof that "something happened" remains.
  Privacy: public or semi-public by design. Verifiable by any party.
  Mutability: immutable. Write-once.
```

### Erasure Flow

```
User requests account deletion:
  1. Freeze account (no new operations)
  2. Class A: already gone (ephemeral)
  3. Class B: cascade hard-delete (conversations, events, jobs, settings, HEAD memory)
  4. Class C: delete per-user encryption key (crypto-erasure of observations/receipts)
  5. Class D: retained (hashes only, no PII, not subject to GDPR right-to-erasure)
  6. Backups: Class B/C purged from backups within 30-day backup rotation
  7. Federated models: user's data excluded from next retraining checkpoint
  8. Confirmation: erasure receipt issued with timestamp and scope
```

### Classification Rules

- **If it contains user code, prompts, or responses → Class A.** Never persisted.
- **If it's needed for platform operation → Class B.** Deletable.
- **If it's shared for learning/intelligence → Class C.** Requires consent, crypto-erasable.
- **If it's a cryptographic proof with no content → Class D.** Immutable, no PII.
- **When in doubt, classify toward shorter retention.** Prefer A over B, B over C. Never put consent-required data into Class B (operational). Never put PII-containing data into Class D (immutable).

The "append-only" claim applies ONLY to Class C (within a consent window) and Class D. Platform operational data (Class B) is mutable and deletable. Assembled context (Class A) is never written to disk.

---

## III. The Nervous System — Agent Lifecycle Architecture

> "Context is not a cache. Context is a living organism. Quality comes from architecture, not cleanup."

### The Paradigm: Context = Lifespan

Every agent tier has a natural lifespan that matches its context budget. Context degrades over time because irrelevant information accumulates. The architecture prevents degradation by ensuring each tier only lives long enough for its context to remain clean.

**HEAD "lives forever" means the role persists, not that data is immutable.** HEAD's project memory is **Class B** (operational, deletable) — a compacted projection rebuilt from the event log. On user deletion, HEAD memory is hard-deleted and recompacted from remaining events per the Class B erasure flow in Section II.

### The Hierarchy

```
CORTEX HEAD (Opus-class) — one per (user, repo), lives FOREVER
│  Context: project memory. Architecture, patterns, user preferences, compressed history.
│  Never dirty because it only receives RESULTS, never raw execution details.
│  Compacts naturally: old results become compressed wisdom.
│  Role: thinks, decomposes, selects agent topology, verifies outcomes.
│
│  HEAD DATA BOUNDARY (Class B — deletable, rebuildable):
│    ✓ task outcome (success/fail/partial), error class, retry count
│    ✓ files changed (paths only, no content), model used, cost bucket, duration bucket
│    ✓ user preferences (explicit settings only, not inferred from behavior)
│    ✗ raw code, raw prompts, raw responses, file contents, user data
│    ✗ full execution traces, tool call payloads, provider responses
│    ✗ "architectural patterns learned" — removed, too vague to enforce
│  Provenance for learning → ObservationEnvelope (Class C, consent-gated)
│
│  TaskSummary schema (enforced by type system):
│    { task_id, parent_id, outcome: enum, error_class: Option<enum>,
│      files_touched: Vec<PathBuf>, model_used: String,
│      cost_cents: u32, duration_ms: u64, retry_count: u8 }
│  Secret scanning runs on file paths before persistence.
│  Max cardinality: 500 file paths per summary (truncate with count).
│
├── SUPERVISOR (Sonnet-class) — one per task tree, lives until tree completes
│   Context: HEAD's guidance + task decomposition + worker results (summaries only).
│   Compacts into TaskSummary when done → flows back to HEAD.
│   Role: manages workers, verifies completion, handles retries.
│   │
│   ├── WORKER (Haiku-class) — one per single task, ephemeral
│   │   Context: EXACTLY the files/data needed. Nothing more.
│   │   No continuation. No history. No state. Spawns, executes, reports, DIES.
│   │   Role: executes one specific action with perfect context.
│   │
│   └── ... more workers (parallel or sequential)
│
└── ... more supervisors (parallel domains)
```

### Checkpoint / Challenge Flow

Work doesn't just flow down — it flows through **intelligent checkpoints**. Each tier validates, collaborates, or challenges. Rejected work flows back up.

```
HEAD decomposes task, sends plan DOWN
  │
  ▼
SUPERVISOR receives plan
  ├─ Agrees → decomposes into worker tasks, sends DOWN
  ├─ Challenges → sends alternative analysis BACK UP to HEAD
  └─ Partially agrees → modifies scope, sends refined plan DOWN
        │
        ▼
      WORKER executes, reports result UP
        │
        ▼
      SUPERVISOR receives result
        ├─ Accepts → summarizes, sends UP to HEAD
        ├─ Rejects → spawns new Worker with corrected context
        └─ Escalates → flags issue UP to HEAD for re-decomposition
              │
              ▼
            HEAD receives escalation
              ├─ Re-routes → different Supervisor, different topology
              ├─ Re-thinks → changes approach entirely
              └─ Resolves → provides missing context, sends back DOWN
```

Every checkpoint is an **intelligent perspective**, not a relay. The dual-brain principle — multiple models collaborating beats one model alone — applies at every layer of the hierarchy. A Supervisor catching a Worker's wrong assumption is the same pattern as GPT challenging Claude's architecture decision, scaled down to the execution level.

Escalation rules:
- Worker fails twice on same task → Supervisor re-decomposes or escalates to HEAD
- Supervisor disagrees with HEAD's decomposition → sends counter-proposal with evidence
- HEAD receives conflicting Supervisor results → spawns ephemeral thinker agent to arbitrate (never thinks inline)
- Any tier detects security/cost anomaly → immediate escalation, no retry

### Combination Intelligence

The hierarchy is not rigid. It is an **adaptive topology**. HEAD's core intelligence — its actual competitive advantage — is knowing WHICH combination of agents to deploy for a given situation. This IS the intelligence.

| Situation | Topology |
|-----------|----------|
| Simple bug fix | 1 Supervisor → 2-3 Workers (search, fix, test) |
| Complex refactor | 1 Supervisor → 10+ Workers across files |
| Research task | 30+ parallel Haiku research agents, results aggregated by Supervisor |
| Codebase audit | 50 keyword/pattern scrapers → findings aggregated → 1 Opus analysis agent |
| Architecture decision | 1 Opus thinker agent (ephemeral, never pollutes HEAD) |
| Security review | 3 Sonnet specialists in parallel (auth, crypto, network) |
| Unknown problem space | Research fleet first → Supervisor synthesizes → HEAD re-plans with findings |

Sometimes a higher model needs to do the actual work — but it always runs as an **ephemeral agent** that reports back to HEAD. HEAD's context never gets dirty with execution details. The expensive model does the work, dies, and its result becomes a clean summary in HEAD's memory.

The topology itself is learnable. VeraAI observes which combinations produce first-try success for which task shapes, and feeds that back into HEAD's decomposition decisions.

### Why Workers Must Die

A worker that continues accumulates irrelevant context. By task 3, it's carrying noise from tasks 1 and 2. This noise causes:
- Wrong file references (from stale context)
- Confused scope (thinking about old problems)
- Higher token cost (paying for irrelevant context)
- Lower success rate (model attention diluted)

Fresh workers with precise context succeed with cheap models. Continued workers with dirty context need expensive models. The architecture ensures the cheap path.

### Execution State Machine

Every agent dispatch is a **job** in the durable job queue. The hierarchy is crash-recoverable because the queue, not agent memory, is the source of truth.

```
Job states: pending → claimed → running → succeeded | failed | expired

HEAD crash     → HEAD restarts, queries jobs table for in-flight tasks, resumes supervision
Supervisor crash → lease expires → sweeper marks jobs as expired → HEAD re-dispatches
Worker crash   → job lease expires → Supervisor retries (up to max_retries) or escalates
Duplicate completion → idempotency key on job ID, first write wins, second is dropped
Process restart → stateless API servers reconnect, workers re-claim from queue
```

State transitions:
- `pending → claimed`: Supervisor or Worker takes lease via `FOR UPDATE SKIP LOCKED`
- `claimed → running`: agent begins execution, heartbeat updates lease
- `running → succeeded`: result written, lease released, parent notified
- `running → failed`: error recorded, retry count incremented, re-queued or escalated
- `running → expired`: heartbeat missed, sweeper reclaims, treated as failure

Cancellation and side effects:
- `running → cancelled`: user or Supervisor cancels. Container killed. Partial result recorded.
- Workers operate inside isolated containers. Side effects ARE the container state.
  Rollback = destroy container. No compensating transactions needed for internal work.
- External side effects (git push, API calls, file writes to user's repo) are logged as
  `SideEffectRecord { effect_type, target, idempotency_key, status, timestamp }`.
  These are at-least-once with caller-provided idempotency keys, not exactly-once.
- Parent DAG: if a parent job is cancelled, all child jobs are cancelled (cascade).
  If a child completes after parent cancellation, result is recorded but not acted on.
- Poisoned jobs: 3 consecutive failures → quarantined, requires manual review or auto-skip.

Concurrency controls:
- Per-account agent concurrency limit (default: 10 concurrent workers, configurable by plan)
- Per-task-tree cost ceiling (sum of all worker costs, enforced by Supervisor before dispatch)
- Global fanout limit (no single HEAD spawns >100 workers without human approval)
- Queue admission control: reject if queue depth exceeds threshold per account

Queue scaling:
- v1 (0-10K users): Postgres `FOR UPDATE SKIP LOCKED` + `pg_notify`. Sufficient.
- Scale trigger: when queue poll latency p99 > 100ms or worker starvation detected.
- Scale path: move job dispatch to Redis Streams or NATS JetStream. Keep Postgres for
  job state/results (source of truth). Queue becomes a fast dispatch layer, not the store.
- The queue is NOT the bottleneck until agent fanout × concurrent users exceeds what
  Postgres can handle (~10K-50K claims/second on tuned hardware). Design for graduation,
  not for premature optimization.

### Context Assembler — The Synaptic Junction

The Context Assembler is the nervous system's synaptic junction. When HEAD tells a Supervisor to fix a bug, the Context Assembler determines EXACTLY what context each Worker receives.

```rust
pub trait ContextAssembler: Send + Sync {
    async fn discover_files(&self, input: &ContextRequest) -> Result<FileGraph, ContextError>;
    async fn narrow_scope(&self, graph: FileGraph, budget: TokenBudget) -> Result<ScopeSet, ContextError>;
    async fn enrich_errors(&self, scope: ScopeSet, signals: ErrorSignals) -> Result<ScopeSet, ContextError>;
    async fn inject_history(&self, scope: ScopeSet, head_memory: &ProjectMemory) -> Result<AssembledContext, ContextError>;
}
```

Pipeline: file discovery (ignore + gitignore) → symbol parsing (tree-sitter) → scope ranking (import graph, diagnostics, changed files) → error enrichment (compiler/test output → file/line anchors) → history injection (previous task summaries, model outcomes) → token budgeting.

Every context item has **provenance and a reason code**. This makes learning possible — VeraAI can later determine which context artifacts contributed to success.

**Privacy boundary:** Assembled context is **Class A** (ephemeral). It lives only in worker container memory and is destroyed when the container dies. Provider prompts containing assembled context are NOT logged — they are Class A. What IS logged (as Class C, consent-gated): which context recipe was used, which file paths were included, outcome, cost, duration — metadata only, never content. Secret scanning (regex for API keys, tokens, credentials) runs on assembled context before it is sent to any LLM provider.

### The Cortex Value Chain

```
User intent → Context Assembly → Model Selection → Execution → Outcome
     10%           60%               10%            15%        5%
```

**Context Assembly is 60% of the value.** The competitive moat is not model selection (everyone has Claude and GPT). The moat is context preparation so good that cheap models succeed.

---

## IV. Economics

> Verified with current 2026 API pricing. All math in `.dualbrain/gpt55-r2-intent-economics.md`.

### 4-Layer Intent Pipeline

| Layer | Traffic | Mechanism | Cost/query |
|-------|--------:|-----------|----------:|
| 1. Deterministic | 70% | Regex/keyword pattern matching | ~$0 |
| 2. Embedding | 25% | Local ONNX model (384-dim) | ~$0 |
| 3. Small model | 4.9% | GPT-4.1-mini API | $0.000520 |
| 4. Frontier | 0.1% | Claude Opus 4.7 API | $0.007500 |

Assumptions: 500 input tokens + 200 output tokens per routing query.

### Subscription Model

**$7.99/month unlimited human access.**

| Metric | Value |
|--------|------:|
| Queries/user/month (50/day) | 1,500 |
| Model COGS/user/month | $0.049 |
| Stripe fee/user/month | $0.532 |
| Infrastructure/user/month (at 100K) | $0.01-0.08 |
| **Gross margin** | **~91-92%** |

Power user scenario (5% at 500 queries/day): blended COGS rises to $0.072/user/month. Still sustainable.

**Critical boundary:** subscription covers human interactive use only. Agent/API traffic, autonomous loops, unrestricted tool calls, and web search go through x402. "The business works if Cortex remains a deterministic-first human orchestration layer. It fails if 'unlimited human access' becomes unlimited agent execution."

**Monthly cost envelope per subscriber:**
- Internal cost tracking per account (invisible to user, not a billing limit).
- Soft threshold: trailing-30-day model cost > 10x average → route to cheaper models more aggressively.
- Hard threshold: trailing-30-day model cost > 50x average → bot score review + manual inspection.
- Provider price changes: re-run cost model quarterly. Adjust routing weights, not subscription price.
- The 70/25/4.9/0.1 routing split is a target that shifts based on actual user behavior and provider pricing. The economic model holds as long as the weighted average per-query cost stays under ~$0.033 (= $0.049 COGS ÷ 1,500 queries). Monitoring this metric is a launch-day requirement.

### x402 Agent Pricing

| Path | Cost basis | x402 price (70% margin) |
|------|----------:|------------------------:|
| Small orchestration (Haiku/4.1-mini) | $0.001 | **$0.003-0.005** |
| Frontier orchestration (Opus) | $0.009 | **$0.03-0.05** |

**Minimum floor: $0.10** (3x settlement cost + provider cost + margin). For operations that would cost less than $0.10, batch multiple operations into a single `upto` authorization per session. No stored value, no prepaid balance — the agent authorizes a session-scoped `upto` amount and Cortex settles the aggregate at session end or when the authorized amount is approached.

Cortex does not compete as cheapest token API. It prices **orchestration + trust receipt + provenance + context assembly**.

### Infrastructure Costs

| Scale | Hetzner-style | Fly.io-style |
|------:|-------------:|-------------:|
| 1K users | $50-150/mo | $75-250/mo |
| 10K users | $150-500/mo | $300-1K/mo |
| 100K users | $800-3K/mo | $2K-8K/mo |

### Local Model Feasibility (Layer 3)

Phi-3-mini (3.8B) via candle in Rust: ~2.5-5GB RAM in INT4. Economically compelling at 100K users (7.35M Layer 3 calls/month). Quality drift and operations are the hidden tax — use as Layer 2.5/3 fallback, not primary.

---

## V. x402 Payment Protocol

> Implementation-ready. Full details in `.dualbrain/gpt55-r2-x402-flow.md`.

### Protocol Flow

1. Agent calls Cortex endpoint without subscription auth
2. Cortex classifies caller: subscription → bypass x402, agent/API → require x402
3. Cortex returns `402 Payment Required` with `PAYMENT-REQUIRED` header (x402 v2)
4. Agent decodes requirements, signs payment authorization (EIP-3009)
5. Agent retries with `PAYMENT-SIGNATURE` header + Soma binding
6. Cortex verifies shape, idempotency, Soma delegation, amount
7. Cortex calls CDP facilitator `/verify`
8. **Cost-tier gate** (see below)
9. Cortex executes work
10. On success: settle via facilitator `/settle`, return result + Soma receipt
11. On execution failure: settle for consumed cost (partial settlement), return error + receipt
12. On settlement failure: log for reconciliation, return result with `settlement_pending` status

### Settlement Timing by Cost Tier

The adversarial risk: agent sends valid payment, forces expensive work, then settlement fails (CDP down, gas spike, nonce race). "No charge on failure" is only safe when the provider-side risk is bounded.

```
CHEAP (estimated cost < $0.01):
  verify → execute → settle on success
  Provider absorbs risk. Loss bounded at $0.01 per call.
  Example: routing query, metadata lookup, simple chat turn

MEDIUM (estimated cost $0.01 - $1.00):
  verify → settle MINIMUM upfront → execute → settle remainder
  Minimum = max($0.10, estimated_cost * 0.5)
  If execution costs less, refund difference via credit (not onchain).
  Example: multi-tool task, code generation, search + synthesis

EXPENSIVE (estimated cost > $1.00):
  verify → settle FULL estimated cost → execute → refund overage via credit
  No work before money moves.
  Example: long agent session, large context assembly, frontier model

STREAMING / LONG-RUNNING:
  verify → settle initial chunk → stream/execute → settle per-chunk or at completion
  Heartbeat: if no progress for 30s, pause and settle consumed portion.
```

Pre-settlement cost estimation uses: model pricing × estimated tokens + tool call fixed costs + context assembly overhead. **v1 does not issue credits or maintain prepaid balances.** Overestimates are absorbed — price accurately, err on the side of the customer by using `upto` (settle actual cost, not estimated).

EIP-3009 authorizations cannot be unilaterally cancelled by the payer (they're signed messages, not on-chain approvals), so the settlement window is secure as long as `validBefore` hasn't passed. The real risk is CDP/chain unavailability during settlement — handled by the reconciliation queue.

**No stored value in v1.** No credits. No prepaid balances. No refunds as platform currency. Every x402 payment is a direct wallet-to-wallet settlement for a specific piece of work. If prepaid balances or credits become necessary (v2), they require legal review for money transmission/stored value implications before implementation.

### Chain Selection

**Base USDC day 1.** Single chain, no multi-chain complexity.

| Chain | Gas | Finality | x402 ecosystem |
|-------|----:|---------|----------------|
| **Base** | ~$0.06 | ~200ms preconfirm | Strongest: CDP defaults, docs |
| Solana | <$0.01 | Fast | CDP supported, slice 2 |
| Arbitrum | ~$0.08 | Fast sequencer | CDP supported, later |

### CDP Facilitator

- Base URL: `https://api.cdp.coinbase.com/platform/v2/x402`
- Endpoints: `/supported`, `/verify`, `/settle`, `/discovery/*`
- Pricing: 1,000 free/month, then $0.001/tx
- Rate limits: 500 writes/10s, 600 reads/10s
- Idempotency: `X-Idempotency-Key`, 24-hour replay

### Agent Wallets

CDP Server Wallet v2 EOA for Base USDC. Human creates and funds wallet, issues Soma delegation with scoped signing capability. Agent never gets raw key material.

Funding path: Clerk/Coinbase auth → create CDP EOA → fund with Base USDC via Coinbase Onramp/transfer → Soma delegation scopes agent's signing.

### Multi-Call Sessions

| Version | Mechanism |
|---------|-----------|
| v1 public API | Per-call `exact` |
| v1 variable-cost | Per-call `upto` |
| v1 agent chat | Per-message `exact`/`upto` for external agents |
| v2 high-volume | Soma SessionEscrow + x402 `batch-settlement` |

### Settlement Atomicity

Verify-then-execute-then-settle. Settlement semantics depend on cost tier (see above).

```
required_slack = p99_facilitator_settle_seconds + chain_finality_slack + retry_slack
minimum_validity = max_execution_seconds + required_slack
abort_before_work if validBefore - now < 90 seconds
```

**What happens on failure:**

| Failure point | `exact` payment | `upto` payment |
|---------------|----------------|----------------|
| Before execution | No settlement, no charge | No settlement, no charge |
| During execution (cheap tier) | No settlement, provider absorbs | Settle consumed cost |
| During execution (medium/expensive) | Already settled upfront | Settle consumed cost |
| Settlement call fails | Reconciliation queue retries | Reconciliation queue retries |
| CDP down during settlement | Result delivered with `settlement_pending`, retry async | Same |

For `exact`: payment is all-or-nothing. Either the full amount settles or nothing does.
For `upto`: settle the actual consumed cost. No partial settlement of `exact` payments.

### Payment Receipt Schema (CortexPaymentReceiptV1)

Application-level receipt format that uses Soma primitives for signing and identity. This is NOT a Soma protocol type — it is a Cortex/HeyVera application type that references Soma DIDs and delegations.

Canonical DAG-CBOR. CID = CIDv1 with dag-cbor codec and sha2-256.

Key fields: `receipt_id` (CID), `service` (DID + origin + resource_hash), `actor` (payer_did + wallet + delegation_chain), `request` (method + url + body_hash + idempotency_key), `x402` (version + scheme + facilitator + payment hashes), `payment` (asset + amount_authorized + amount_settled + settlement_tx), `work` (execution_id + input/output commitments + metering + status), `trust` (Soma signatures + service signature).

Classification: the receipt itself is **Class D** (protocol proof, immutable, no PII). The work/request data it references may be Class B or C depending on content.

9-step third-party verification procedure defined (see brainstorm doc for full detail).

### Regulatory Posture

Cortex as merchant receiving direct wallet-to-wallet USDC for its own service = lower risk. CDP handles KYT/OFAC screening. Do not custody agent balances without counsel. Do not operate a facilitator or transmit value for others without legal review.

---

## VI. VeraAI — Privacy & Learning

> Research-backed with 15+ cited papers. Full details in `.dualbrain/gpt55-r2-veraai-privacy.md`.

### Core Principle

**Soma proves origin, consent, policy, and custody. It does NOT prove "no data leaking."** The honest claim: "Soma makes leakage accountable and policy violations detectable."

### What Gets Shared (Privacy Tiers)

| Tier | Data | Default |
|------|------|---------|
| `off` | Nothing | Available |
| `metrics` | Performance/cost/error aggregates | **Default for v1** |
| `receipts` | Signed eval/outcome receipts, no content | Opt-in |
| `features` | Redacted structural features, AST shape, error classes | Opt-in |
| `patches` | Redacted diffs for selected repos (secret-scanned) | Opt-in |
| `raw-donation` | Explicit one-off dataset donation | Explicit consent |

**Never shared by default:** raw prompts, raw code, raw responses, raw embeddings (invertible via Vec2Text), user codebase context.

Team policy sets the ceiling; individual policy can only reduce sharing.

### ObservationEnvelope v1

**Class C** — consent-gated, crypto-erasable. Content-addressed, Soma-signed, append-only within a consent window. Individual envelopes are immutable once written; entire user contributions are crypto-erased by deleting the per-user encryption key. Separate from EvaluationReceipts (evals form a linked DAG, never mutate observations).

Key fields: `envelope_version`, `observation_id` (sha256), `subject_did`, `node_did`, `consent_policy_id`, `consent_scope[]`, `event_type`, task metadata (type, language, risk, duration_bucket, success), model metadata (provider, route_reason_hash, tokens_bucket, latency_bucket, cost_bucket), artifacts (eval receipts with no content), privacy flags (contains_raw_prompt: false, dp_epsilon, retention_days), lineage (parent_hashes), Soma signature.

### Context Quality as Learning Target

> User insight: "The model succeeded because the context was clean, not because the model was good at that task type."

VeraAI learns **context preparation patterns**, not just model selection:

```
task=rust_auth_bug
recipe={include: middleware, failing_test, error_log, auth_config}
model=haiku
outcome=success, first_try, 45s
```

ML approach:
- **v1:** Contextual bandit over `(context_recipe, model)` pairs. LinUCB or Thompson sampling.
- **v1.5:** Two-stage — predict context recipe, then choose model.
- **v2:** Slate bandit for selecting individual context artifacts under token budget.
- **v3:** Sequence policy for context-building steps. RESEARCH NEEDED.

### Cold Start Timeline

| Period | Data | Learning | Value back |
|--------|------|----------|------------|
| Week 1 | <1K decisions | Deterministic wins. Bandit logs + shadow scores | None yet |
| Month 1 | 1K-5K decisions | Per-task Thompson sampling starts improving provider choice | Slightly better routing |
| Month 6 | 50K-500K receipts | Context-preparation policies beat static recipes for common domains | Measurably better outcomes |
| Year 1+ | Millions of receipts across nodes | Federated learning provides cross-user intelligence | Network intelligence moat |

### What Each Tier Can Learn

| Tier | Can learn | Cannot learn |
|------|-----------|-------------|
| `metrics` (default) | Provider success rates by task type, cost/latency optimization, failure rate reduction, model selection for known task shapes | New context recipes, artifact-level patterns, cross-user code patterns |
| `receipts` | Which predefined context recipes produce first-try success, recipe-to-outcome correlations | New artifact types, structural patterns in code |
| `features` | Structural patterns (AST shape, error class, dependency graph), new context artifact discovery | Specific code content, implementation details |
| `patches`+ | Cross-user solution patterns, community intelligence for specific frameworks/errors | N/A — full learning capability |

**Honest moat assessment:** `metrics` alone provides useful routing optimization but cannot discover new context recipes — it can only evaluate predefined ones. The "context preparation pattern" learning described in this spec requires at minimum `receipts` tier (recipe IDs + outcomes). Full context recipe discovery requires `features` tier. The moat grows with opt-in rate. Plan for the worst case (most users on `metrics`) and build incentives for higher tiers.

Incentive for opt-in: users on higher tiers get proportionally better routing intelligence back (their node learns faster from the network). This is disclosed, not hidden.

### Privacy-Preserving ML Stack

| Component | v1 Implementation | Aspiration |
|-----------|-------------------|------------|
| Aggregation | Secure aggregation (Bonawitz pairwise masks) | ZK-verified FL |
| Privacy | Distributed discrete Gaussian, ε=2-4 per 30-day window | Homomorphic encryption |
| Poisoning defense | Robust stats + reputation-gated cohorts + canary evals | Poisoning-proof SecAgg |
| Erasure | Checkpointed retraining, exclude deleted user data | Production machine unlearning |
| Model | Linear contextual Thompson sampling | Neural federated fine-tuning |

No mature Rust FL framework exists. Build minimal: clipped sufficient statistics + SecAgg + DP + deterministic aggregation.

Nodes before FL has value: 50-100 minimum (each with hundreds of receipts). 1,000+ for real advantage. 10,000+ for moat.

### Intelligence Flow-Back

What users ACTUALLY see:
- **v1:** Improved routing decisions (tasks succeed more often, cheaper models used when safe)
- **v2:** Shared tool patterns (other Rust developers solved this error this way)
- **v3:** Community intelligence (the network knows the best approach for NextJS auth bugs)

Each level requires higher privacy tier consent and more network participants.

---

## VII. Security & Threat Model

> Attack matrices with likelihood/impact scores. Full details in `.dualbrain/gpt55-r2-threat-model.md`.

### Subscription Abuse

"Unlimited" means unlimited normal human use. Hard policy boundaries:
- 3 concurrent devices, 1-2 active chat streams
- 300-1,000 messages/day before soft review
- Expensive model/tool calls budgeted by internal cost envelope
- API-like cadence auto-converts to x402 requirement

**Bot detection algorithm:** Sigmoid scoring over 10 signals (cadence regularity, 24h utilization, parallel sessions, tool call density, prompt reuse, reconnect automation, device/IP churn, missing UI signals, output token harvest ratio, payment risk). Thresholds: <0.35 allow, 0.35-0.65 friction, 0.65-0.85 throttle, >0.85 suspend.

### Sybil Prevention

did:key is Sybil-weak. Layer defenses:
- Stripe Radar for payment fraud signals
- Phone verification ($0.05/SMS via Twilio Verify) as friction, not strong auth
- GDPR-compliant server-side passive signals (IP ASN, TLS, auth device, payment fingerprint)
- Agents require: human vouch OR USDC stake ($25 read, $250+ execution, $500+ marketplace) OR payment history

### Unified Trust Score

A single `TrustScore` aggregates signals from ALL surfaces and gates privileges across the platform. No surface makes trust decisions in isolation.

```
TrustScore = weighted_aggregate(
  clerk_verification_level,     // email, phone, passkey, OAuth providers
  stripe_radar_score,           // payment fraud signals
  account_age_days,             // time since first payment cleared
  payment_history,              // disputes, chargebacks, successful months
  bot_score,                    // from bot detection algorithm (inverse)
  soma_delegation_history,      // delegations issued, revoked, disputed
  x402_settlement_history,      // successful settlements, failed attempts
  community_reputation,         // marketplace reviews, social reports (v2)
)
```

Trust gates:

| Privilege | Minimum Trust |
|-----------|--------------|
| Basic chat (subscription) | Email verified + payment cleared |
| Agent spawning | Phone verified OR 30-day account age |
| Agent concurrency >5 | 60-day history + no disputes |
| x402 spend >$10/day | Stripe Radar low-risk + 30-day history |
| Marketplace selling | Phone + 90-day history + stake |
| Tool execution (write) | Trust score > threshold + per-call cost cap |
| Frontier model access | Trust score > threshold OR active x402 session |

Score is recomputed on every trust-relevant event (payment, dispute, bot score change, delegation action). Stored in `accounts` table, not computed per-request.

### Container Security

Assume every user is trying to escape. Recent CVEs: CVE-2024-21626 (runc fd leak), CVE-2025-31133/52565/52881 (runc mount/image flaws).

| Workload | Isolation |
|----------|-----------|
| Hostile coding agents | Firecracker microVMs with jailer |
| Medium-risk plugins | gVisor `runsc` |
| K8s OCI compatibility | Kata Containers |
| Trusted internal | Docker/runc |

Seccomp: `no_new_privileges=true`, rootless, read-only rootfs, drop all caps. Block: mount, ptrace, bpf, raw sockets, module loading, namespace creation.

Network egress: default deny. Brokered HTTPS to approved domains only. No RFC1918/link-local/metadata IPs. Log domain, IP, bytes, job ID, Soma delegation.

Artifact lifecycle:
- **Ingress:** code enters runner via job payload (blob store reference). Runner pulls from blob store with scoped, time-limited credentials. No direct git clone from runner — Cortex clones, stores as blob, runner reads blob.
- **Dependencies:** fetched through an allowlisted registry proxy (crates.io, npm, pypi). Direct internet access blocked. Proxy caches per-tenant. Build caches isolated per account.
- **Egress:** results written to blob store via scoped write-only credentials. Runner cannot read other tenants' blobs. Result blobs are scanned (secret regex, size limits) before Cortex reads them.
- **DB access:** runners get NO direct Postgres access. Results flow through blob store + job queue. Runner has exactly two credentials: blob-store write (scoped to job) and job-queue heartbeat/complete (scoped to job ID).

Capability profiles for developer workflows:
- Default: no mount, no ptrace, no bpf, no raw sockets.
- `dev-tools` profile: allows ptrace (debugger), relaxed seccomp for package managers. Requires higher TrustScore. Logged and metered separately.
- Profile selection is per-job, requested by Supervisor, gated by account trust level.

### Key Management

| Key | Storage | Rotation |
|-----|---------|----------|
| Root KEK | HSM/KMS (AWS KMS), non-exportable | Yearly or on compromise |
| Service KEK | Encrypted by root | Per-service, quarterly |
| User KEK | Encrypted by service KEK | On user request or risk |
| Session keys | Short-lived Ed25519/X25519, caveat-bound | Minutes to hours TTL |
| Data keys | Envelope encryption per object/event | Never reuse broadly |

8-step rotation ceremony. Social recovery: 3-of-5 guardians (5-of-7 for treasury), 24-72h timelock, notification window.

### Incident Playbooks

Defined for: key compromise (SEV-1), x402 replay detection, data leak investigation, delegation chain abuse. Each includes detection, containment, rotation, notification, and postmortem steps.

### Supply Chain Security

`cargo-audit` + `cargo-deny` + `cargo-vet` in CI. No new crate touching crypto/auth/HTTP/parsing without owner approval. Pin `Cargo.lock`. Deny git dependencies except approved SHAs. September 2025 malicious crate incident (stealing Ethereum/Solana keys) is directly relevant.

### Rate Limiting (Layered)

| Layer | Purpose |
|-------|---------|
| Cloudflare (Pro+) | Volumetric DDoS, bot challenges, WAF rules |
| Application (`tower-governor`) | Per-user/session/token/action limits |
| WebSocket | Auth-before-upgrade, per-user connection caps, heartbeat timeout, backpressure |
| Container | cgroups, wall-clock budget, CPU/memory/network limits |
| Billing/x402 | Economic gating for machine-scale activity |

---

## VIII. Platform Architecture

> Buildable Rust design. Pinned crate versions. Full details in `.dualbrain/gpt55-r2-platform-architecture.md`.

### Crate Layout

```
crates/
  heyvera-core        # IDs, time, money, Principal, AppState, shared types
  heyvera-config      # env/config loading, surface toggles
  heyvera-db          # PgPool, migrations, transaction helpers
  heyvera-auth        # Clerk humans + Soma agents, Principal extractor
  heyvera-policy      # Authorization decisions, RBAC + delegation checks
  heyvera-events      # Append-only domain events + pub/sub
  heyvera-jobs        # Durable DB-backed job queue
  heyvera-billing     # Stripe subscriptions + x402 + usage ledger
  heyvera-observe     # Tracing, metrics, request IDs
  heyvera-storage     # Blob abstraction (local/S3)
  heyvera-search      # Search abstraction (Postgres FTS → Tantivy/Meili)
  heyvera-notify      # In-app/email/push notifications
  heyvera-metering    # Usage, cost, quotas, rate-limit dimensions

  soma                # Client/verifier/proof/delegation (not protocol source of truth)
  vera-core           # Intelligence interfaces, minimal v1
  cortex              # Orchestration + context assembler + agent lifecycle

  social              # Posts, follows, timelines, communities, agent posting (v2+)
  marketplace         # Listings, purchases, reviews, escrow (v2+)
  crypto              # Wallet/token/chain interface (v2+)
  hosting             # Agent hosting, deployments, resource leases (v2+)
  data-api            # x402-gated datasets/services (v2+)

  api                 # Axum router composition, HTTP server
```

### Single Binary, Multiple Process Modes

One compiled binary, multiple runtime modes. Not one process.

```
heyvera node          # sovereign/dev: all modes in one process
heyvera serve api     # production: stateless HTTP API server (horizontally scalable)
heyvera serve worker  # production: job processing (scales by queue depth)
heyvera serve runner  # production: isolated execution plane (Firecracker/gVisor host)
```

Compile-time features for optional deps (postgres, sqlite, s3, stripe, clerk, solana).
Runtime toggles for surfaces (social.enabled, marketplace.enabled, etc.).

### Execution Boundary

```
┌─────────────────────────────────┐     ┌──────────────────────────────┐
│  CORTEX (heyvera serve api)     │     │  WORKER RUNTIME              │
│                                 │     │  (heyvera serve runner)      │
│  - HTTP/WS server               │     │                              │
│  - Auth verification             │     │  - Firecracker/gVisor host   │
│  - Intent routing                │     │  - Per-job microVM           │
│  - Context assembly              │     │  - Sandboxed code execution  │
│  - Agent lifecycle (HEAD/Sup)    │     │  - Egress broker             │
│  - Billing/metering              │     │  - Resource limits (cgroups) │
│  - x402 verify/settle            │     │                              │
│                                 │     │  Runs on SEPARATE machines.  │
│  NEVER executes user code.      │     │  No shared filesystem.       │
│  NEVER touches user containers. │     │  Communicates via job queue.  │
└─────────────────────────────────┘     └──────────────────────────────┘
```

Cortex dispatches work to Worker Runtime via the job queue. Worker Runtime pulls jobs, executes in isolation, writes results back. No direct network calls, no shared memory, no filesystem overlap.

**Credential isolation:** The runner host process has Postgres access (for job queue operations). Individual containers inside the runner have NO database access — they interact only via blob store (scoped write-only credentials per job) and stdout/stderr (captured by runner host). A compromised container cannot read or corrupt platform state.

### Deployment Topology

```
Development (heyvera node):
  Single process, SQLite optional, localhost only.
  Runner isolation still enforced — dev mode uses gVisor, not bare process.
  `heyvera node` is NOT a shortcut to skip isolation. It is all modes
  in one process with the same security boundaries.

Production — small (1-10K users):
  2x API servers behind Cloudflare/LB
  2x Worker processors (job queue consumers)
  1x Runner host (Firecracker, dedicated metal or large VM)
  1x Postgres (managed, e.g. Neon/RDS/Supabase)
  Shared: S3-compatible blob store

Production — scale (10K-100K users):
  N API servers (stateless, auto-scale by request rate)
  M Worker processors (auto-scale by queue depth)
  K Runner hosts (auto-scale by active agent count)
  Postgres primary + read replicas
  Redis for ephemeral caching (session, rate-limit counters)
```

Horizontal scaling: API servers are stateless (all state in Postgres). Workers are stateless (all state in job queue). Runners are stateless (all state in job + blob store). Add more of whichever is the bottleneck.

### Migration from Current Stack

Current state is hybrid: Rust backend (`crates/api`, running on :3001) handles chat and provider routing. Node.js code (`src/`) handles legacy API routes and tooling. SQLite/WAL is the current data store. Zero production users, no production data.

"Migration" means: build the full Rust platform on Postgres, port remaining Node.js routes to Rust, point the React frontend (`cortex/`) at the consolidated Rust API, remove Node.js code. No data migration needed. No coexistence bridge.

Feature-parity gate before Node.js removal: chat, provider routing, conversation persistence, auth, provider configuration, user settings. Billing history, eval data, and operational dashboards are not ported — they are built fresh in the new stack.

### Database Strategy

**Postgres from day 1** for platform database. SQLite only for local/worker/embedded state.

Event store: Postgres append-only tables (`domain_events`, `soma_observations`, `audit_log`).
Blob storage: local filesystem dev, S3-compatible production.
Search: Postgres FTS initially, Tantivy/Meilisearch when product demands.
Feed (v2): fan-out-on-read first, hybrid when scale demands.

Complete V1 schema: 11 tables with indexes, constraints, FKs, enums (accounts, users, sessions, subscriptions, billing_ledger, x402_payments, soma_delegations, domain_events, jobs, audit_log). See brainstorm doc for full DDL.

### Shared Principal Model

```rust
pub enum Principal {
    Human { account_id: Uuid, user_id: Uuid, session_id: Uuid },
    Agent { account_id: Uuid, agent_did: String, delegation_id: Option<Uuid> },
    Service { service: String },
}
```

Auth middleware verifies once (Clerk JWT for humans, Soma delegation for agents), stores Principal in request extensions. Handlers extract typed identity via Axum `FromRequestParts`.

### API Design

- REST/JSON: primary app API
- SSE: notifications, feed updates, run status
- WebSocket: worker connections, bidirectional agent sessions
- OpenAPI: public API contract, versioned as `/api/v1/*`

### Event Bus

Postgres insert → in-process `tokio::sync::broadcast` → `pg_notify` for cross-process. Background `PgListener` rehydrates events by ID. Gap recovery on reconnect: poll `domain_events where id > last_seen_id`.

### Job Queue

Postgres `FOR UPDATE SKIP LOCKED` with lease-based processing. Exponential backoff with jitter on failure. Sweeper reclaims expired leases.

### Trait Boundaries (v1)

```rust
trait AuthVerifier        // Clerk + Soma verification
trait PolicyEngine        // Authorization decisions
trait MeteringSink        // Usage recording
trait BillingLedger       // Subscription + x402 + credits
trait EventBus            // Domain event append + subscribe
trait JobQueue            // Durable job enqueue + dequeue
trait BlobStore           // File storage abstraction
trait SearchIndex         // Full-text search abstraction
trait SomaVerifier        // Delegation + proof verification
trait AgentExecutor       // Worker dispatch + lifecycle
trait PaymentRail         // Stripe + x402 settlement
trait NotificationSink    // In-app + email + push
trait ContextAssembler    // File discovery + scope + enrichment
```

### Performance Targets (P99, excluding LLM latency)

| Endpoint | Target |
|----------|-------:|
| GET /health | <10ms |
| Auth verify | <75ms |
| Chat request accepted | <150ms |
| Context assembly (warm) | <250ms |
| Context assembly (cold) | <1500ms |
| Job dequeue | <25ms |
| Event append | <20ms |
| Billing ledger write | <30ms |
| x402 verification (local) | <100ms |

### Observability

`tracing` + `tracing-opentelemetry` + OTLP for traces. Prometheus scrape for metrics. 12 core metrics defined (http_requests_total, context_assembly_duration, llm_provider_latency, etc.). Full trace span hierarchy: `http.request → auth.verify → policy.check → context.* → router.select_model → provider.call → billing.record`.

### Error Handling

Per-crate `thiserror` enums. Shared `ApiError` at HTTP boundary with `IntoResponse`. `anyhow` only at binary/task boundaries. Never expose raw internal errors to clients.

### Testing Strategy

| Type | Tool | Target |
|------|------|--------|
| Unit | per-crate | Policy, billing math, context ranking |
| Integration | testcontainers-rs + Postgres | Migrations, repos, job leasing |
| API e2e | Axum Router + real PgPool | Full request lifecycle |
| Property | proptest | Ledger invariants, delegation caveats, context budget |
| Fuzz | cargo-fuzz | Soma envelope, x402 payment, provider error parsing |

---

## IX. Build Priority

> Build platform kernel under existing Cortex. Move traffic slice by slice. Keep chat working throughout.

### Phase 1: Platform Kernel (weeks 1-3)
1. `heyvera-core`, `heyvera-config`, `heyvera-db`
2. Postgres migrations with V1 schema
3. `heyvera-observe`: request IDs, tracing, Prometheus
4. `heyvera-auth`: Principal, Clerk stub, Soma interface
5. `heyvera-events`: domain events + bus + LISTEN/NOTIFY
6. `heyvera-jobs`: durable queue + worker runtime

### Phase 2: Cortex Migration (weeks 3-5)
7. Wrap existing chat behind new Axum API state (no behavior change)
8. Context Assembler in shadow mode (log quality, don't use yet)
9. Move billing/subscription/x402 into ledger
10. Conversation persistence (Postgres)

### Phase 3: Intelligence (weeks 5-8)
11. Agent lifecycle: HEAD → Supervisor → Worker hierarchy
12. Context Assembler active (replaces manual context)
13. Thompson sampling evaluator (bandit learns from outcomes)
14. ObservationEnvelope logging (local, no sharing yet)

### Phase 4: x402 + Security (weeks 8-12)
15. x402 middleware (CDP facilitator, Base USDC)
16. Bot detection algorithm
17. Key management (KMS integration)
18. Container hardening (Firecracker/gVisor)

### Phase 5: VeraAI Foundation (weeks 12-16)
19. Federated analytics (metrics tier, no model training)
20. Consent UI + privacy controls
21. Secure aggregation prototype
22. DP noise injection

### Compatibility Rule
Every migration PR must pass: "can send chat, provider call returns, conversation persists, metrics emit."

---

## X. Decisions Log

| Decision | Choice | Rationale | Date |
|----------|--------|-----------|------|
| Backend language | Rust (all server code) | Correctness, performance, single binary, no rewrite | 2026-05-19 |
| Database | Postgres day 1 | Multi-surface platform needs real DB | 2026-05-20 |
| Human billing | $7.99/mo flat-rate | 91% gross margin, compute negligible | 2026-05-19 |
| Agent billing | x402 micropayments, Base USDC | Per-call, no custody, CDP facilitator | 2026-05-19 |
| Token | Deferred (USDC only v1) | Understand adversarial behavior first | 2026-05-19 |
| Auth | Clerk (humans) + Soma (agents) | Regulated provider for humans, native for agents | 2026-05-19 |
| Privacy claim | "Accountable, not leak-proof" | Soma proves policy, not physics | 2026-05-20 |
| DP budget | ε=2-4 per 30-day window | Balances utility and privacy | 2026-05-20 |
| Agent lifecycle | HEAD→Supervisor→Worker (ephemeral) | Context quality = architecture | 2026-05-20 |
| Context as moat | Context Assembly > Model Selection | 60% of value in context preparation | 2026-05-20 |
| Learning target | Context recipes, not model preferences | "Model succeeded because context was clean" | 2026-05-20 |
| Checkpoint flow | Bidirectional validation at every tier | Dual-brain at every layer, not just HEAD | 2026-05-20 |
| Combination intelligence | HEAD selects topology, not just model | The intelligence IS knowing which combination to deploy | 2026-05-20 |
| HEAD erasure | Memory is projection, not source of truth | Rebuildable from event log, purgeable per user | 2026-05-20 |
| HEAD data boundary | Explicit: paths/outcomes yes, raw content no | Provenance goes to ObservationEnvelope, not HEAD | 2026-05-20 |
| Execution state machine | Job queue IS the state machine | Crash recovery via lease expiry, idempotent completion | 2026-05-20 |
| Settlement by cost tier | Settle before work for expensive operations | Cheap: absorb risk. Medium: partial upfront. Expensive: full upfront | 2026-05-20 |
| Execution boundary | Cortex ≠ Worker Runtime | Separate processes, separate machines, job queue bridge | 2026-05-20 |
| Deployment topology | Single binary, multiple process modes | Stateless API/workers, scale by adding instances | 2026-05-20 |
| Migration plan | No data migration needed | Zero production users, build new and deprecate old | 2026-05-20 |
| VeraAI moat baseline | Metrics tier alone provides routing intelligence | Higher tiers are multipliers, not requirements | 2026-05-20 |
| Unified trust score | Single TrustScore gates all surfaces | Aggregates Clerk, Stripe, Soma, bot score, history | 2026-05-20 |
| Data classification | 4 classes: Ephemeral, Operational, Consent-gated, Protocol proofs | Resolves append-only vs erasure contradiction at root | 2026-05-20 |
| No stored value v1 | No credits, no prepaid balances | Avoid money transmission/custody risk, legal review for v2 | 2026-05-20 |
| Assembled context privacy | Class A (ephemeral), never persisted, secret-scanned before LLM | Provider prompts are not logged | 2026-05-20 |
| Receipt schema boundary | CortexPaymentReceiptV1, not SomaX402ReceiptV1 | App-level format using Soma primitives, not protocol type | 2026-05-20 |
| v1 auth honesty | Clerk for humans, Soma for agents, bridge in v2 | Don't overclaim universal Soma signing before it exists | 2026-05-20 |
| Runner credential isolation | Containers get blob-store write + job heartbeat only | No DB access from containers, compromised container can't corrupt platform | 2026-05-20 |
| Queue graduation path | Postgres v1, Redis Streams/NATS at scale trigger | Design for graduation, not premature optimization | 2026-05-20 |
| Cost envelope | Internal per-account cost tracking, soft/hard thresholds | Provider price changes handled by routing weight adjustment | 2026-05-20 |

---

## XI. Open Research

Items labeled RESEARCH NEEDED — not blocking v1, but on the horizon:

1. **Poisoning-proof SecAgg** — robust aggregation when individual updates are hidden
2. **ZK-verified federated learning** — prove "learned from N points without revealing any"
3. **Production machine unlearning** — beyond checkpointed retraining
4. **Neural federated fine-tuning** — after >100K high-quality labeled receipts
5. **Decentralized foundation model learning** — the VeraAI endgame
6. **Sequence policy for context building** — beyond slate bandits
7. **Self-hosted x402 facilitator** — regulatory and operational implications
8. **Soma Transparency Log** — append-only public log for key rotations and revocations

---

## XII. References

### Brainstorm Archives
- `.dualbrain/gpt55-r2-intent-economics.md` — verified pricing, full cost model
- `.dualbrain/gpt55-r2-x402-flow.md` — protocol flow, receipt schema, regulatory
- `.dualbrain/gpt55-r2-veraai-privacy.md` — FL architecture, DP parameters, cold start
- `.dualbrain/gpt55-r2-threat-model.md` — attack matrices, key management, supply chain
- `.dualbrain/gpt55-r2-platform-architecture.md` — Rust code, SQL DDL, crate versions, build order

### Vision Documents
- `.dualbrain/vision.md` — Cortex orchestration vision
- `.dualbrain/architecture-10-10.md` — all-Rust decision, platform layers
- `.dualbrain/paradigm-vision.md` — 5 paradigm shifts
- `internal/active/soma-trust-mining.md` — PoTW protocol, 5 innovations
- `internal/active/golden-plan.md` — 3-layer strategy

### Key External Sources
- x402 v2 spec: `github.com/x402-foundation/x402/specs`
- CDP facilitator docs: `docs.cdp.coinbase.com/x402`
- EIP-3009: `eips.ethereum.org/EIPS/eip-3009`
- Context Engineering Survey 2025: `arxiv.org/abs/2507.13334`
- Bonawitz SecAgg: `eprint.iacr.org/2017/281`
- Thompson Sampling: Agrawal & Goyal 2013, PMLR
- TensorZero benchmarks: `tensorzero.com/docs/gateway/benchmarks`
