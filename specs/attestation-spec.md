# Attestation — Technical Specification

**Version:** 1.0
**Date:** 2026-03-18
**Status:** DEFINITIVE — Implementation Ready
**Companion:** `specs/manifest-spec.md` (Manifest is the BEFORE; Attestation is the AFTER)

---

## Why Attestation Exists

An agent acts. What proof does it have?

A receipt says "transaction happened." An audit log says "event was recorded." Neither one says: here is the data the agent relied on, the decision it made, the action it took, the outcome it got, and a cryptographic signature tying it all together into a single tamper-proof record.

That is what an attestation is. A complete, signed chain: **data -> decision -> action -> outcome.**

Manifest tells an agent "should I do this?" Attestation tells the world "here is exactly what I did, and here is the proof."

Together they form a closed loop:

```
BEFORE                              AFTER
───────────────────────────────     ───────────────────────────────
Manifest: verify, assess,          Attestation: record what data
preflight, remember                was used, what was decided,
                                   what action was taken, what
"Should I do this?"                happened, sign it all

                                   "Here is proof of what I did."
```

No other platform offers both halves.

**Route file:** `src/routes/attest.ts`
**Core engine:** `src/core/attestation-engine.ts`
**DB layer:** `src/db/attestations.ts`
**Persistent store:** `attestations` table (migration v80)

---

## 1. WHAT AN ATTESTATION CONTAINS

An attestation is NOT a receipt. A receipt records that a transaction happened. An attestation records the full decision chain that led to the transaction and what resulted from it.

Every attestation contains five sections:

### 1.1 Data Context — "What the agent relied on"

Hashes of the input data that informed the decision. If the agent used Manifest first, this includes the Manifest verification results. If it queried a skill, this includes a hash of the skill response. The point: anyone can later verify that the data the agent claims it relied on actually existed and had these exact contents at that time.

```typescript
interface AttestationData {
  manifest_id: string | null;           // Link to Manifest check (null if none)
  manifest_verdict: string | null;      // PROCEED | CAUTION | HOLD | BLOCK
  manifest_confidence: number | null;   // 0.0-1.0
  input_hash: string;                   // SHA-256 of the request payload
  source_hashes: Array<{               // Hashes of data sources consulted
    source: string;                     // Endpoint ID, skill ID, or description
    hash: string;                       // SHA-256 of source response
    fetched_at: string;                 // ISO 8601
  }>;
}
```

### 1.2 Decision — "What the agent decided"

What the agent chose to do and why. For explicit attestations, the agent provides this. For automatic attestations, ClawNet infers it from the action type.

```typescript
interface AttestationDecision {
  action_type: string;                  // 'orchestrate' | 'invoke_skill' | 'swap' | 'transfer' | custom
  description: string | null;          // Agent-provided: "Buy 100 SOL because price dropped 5%"
  manifest_aligned: boolean | null;    // Did the agent follow the Manifest verdict?
                                        // true = PROCEED verdict + agent acted
                                        // false = HOLD/BLOCK verdict + agent acted anyway
                                        // null = no Manifest check was performed
}
```

### 1.3 Action — "What was executed"

Exactly what ClawNet endpoint or skill was called, with hashes of the request and response.

```typescript
interface AttestationAction {
  endpoint: string;                     // '/v1/orchestrate', '/v1/skills/:id/invoke', etc.
  method: string;                       // 'POST', 'GET'
  request_hash: string;                 // SHA-256 of request body
  response_hash: string;               // SHA-256 of response body
  credits_charged: number;             // Total credits for this action
  duration_ms: number;                 // Wall-clock time
  executed_at: string;                 // ISO 8601
}
```

### 1.4 Outcome — "What happened"

The result of the action. Status, any error, and a hash of the outcome data.

```typescript
interface AttestationOutcome {
  status: 'success' | 'failure' | 'partial' | 'timeout' | 'rejected';
  error_code: string | null;           // SNAKE_CASE error code if failed
  data_hash: string | null;            // SHA-256 of outcome data (if any)
  credits_refunded: number;            // If partial failure triggered refund
}
```

### 1.5 Chain — "Where this fits in the sequence"

Links to the previous attestation from this agent (if any) and a monotonic sequence number. This creates an append-only chain per agent — not a blockchain, but a tamper-evident log where gaps or reordering are detectable.

```typescript
interface AttestationChain {
  previous_attestation_id: string | null;  // null for first attestation
  sequence_number: number;                  // Monotonic per api_key_hash
}
```

---

## 2. HOW ATTESTATIONS GET CREATED

Two modes. Both produce identical attestation objects.

### 2.1 Automatic Attestations

Every ClawNet action that costs credits automatically generates an attestation. The agent does not need to opt in or call anything. ClawNet is already in the execution path — it knows the request, the response, the cost, and the outcome. It records all of this.

**Actions that generate automatic attestations:**
- `POST /v1/orchestrate` — every orchestration call
- `POST /v1/skills/:id/invoke` — every skill invocation
- `POST /v1/skills/:id/query` — every data skill query
- `POST /v1/batch` — one attestation per batch (not per sub-query)
- `GET /v1/stream/orchestrate` — one attestation per stream session
- `POST /v1/manifest` — every Manifest check (attesting the check itself)
- `POST /v1/intel/*/report` — every Intelligence Suite query

**Actions that do NOT generate automatic attestations:**
- Read-only queries (GET endpoints that return lists, stats, history)
- Auth/key management operations
- Admin endpoints
- Webhook deliveries

**Automatic attestation flow:**

```
1. Request arrives at billing endpoint
2. Auth middleware resolves API key -> api_key_hash
3. Action executes normally (orchestrate, invoke, etc.)
4. Response is computed
5. AFTER billing (deductCredit), before response is sent:
   a. Hash the request body -> input_hash
   b. Hash the response body -> response_hash
   c. Look up the most recent manifest_id for this api_key_hash (within last 60s)
   d. Get the previous attestation_id + sequence for this api_key_hash
   e. Sign the attestation payload
   f. Insert into attestations table (non-blocking, fire-and-forget)
6. Add X-ClawNet-Attestation-Id header to the response
7. Return response to agent
```

Step 5c is the Manifest linking heuristic: if the agent called Manifest within the last 60 seconds, the automatic attestation links to that Manifest check. This window is generous enough for agents that verify-then-act immediately, and tight enough to avoid false links. The agent can override this by providing `manifest_id` in the request headers (`X-Manifest-Id`).

**Non-blocking:** Attestation creation never blocks or slows the response. It uses the same fire-and-forget pattern as `logAudit()`. If attestation creation fails, the action still succeeds — the agent gets its response, the attestation is simply missing.

### 2.2 Explicit Attestations

An agent calls `POST /v1/attest` to create an attestation that links a Manifest check to an action and outcome. This is for actions that happen OUTSIDE ClawNet (e.g., the agent called Manifest, then executed a trade on Jupiter directly, then wants to attest the result).

Explicit attestations let the agent provide richer context: a description of what it decided, why, and what the outcome was. They are the premium version — more detail, agent-narrated, and intentional.

**Explicit attestation flow:**

```
1. Agent calls POST /v1/manifest -> gets manifest_id
2. Agent decides to act (based on verdict or not)
3. Agent acts (through ClawNet or externally)
4. Agent calls POST /v1/attest with:
   - manifest_id (optional — links to the Manifest check)
   - action details (what was done)
   - outcome (what happened)
5. ClawNet validates, signs, stores, returns attestation_id
```

---

## 3. CRYPTOGRAPHIC VERIFICATION

### 3.1 Signing

Every attestation is signed with HMAC-SHA256 using `PLATFORM_SIGNING_SECRET` (the same key used by `sign-response.ts`). The signature covers the entire attestation payload, making it tamper-proof.

```typescript
function signAttestation(payload: AttestationPayload): string {
  const canonical = canonicalize(payload);  // Deterministic JSON (sorted keys)
  return 'hmac-sha256:' + createHmac('sha256', env.PLATFORM_SIGNING_SECRET!)
    .update(canonical)
    .digest('hex');
}
```

If `PLATFORM_SIGNING_SECRET` is not set, attestations are still created but the `signature` field is `null` and `signed` is `false`. The attestation is still useful as an audit record — it just cannot be cryptographically verified.

### 3.2 Verification

`GET /v1/attest/verify/:id` is a public endpoint (no auth required). Anyone with an attestation ID can verify:

1. The attestation exists
2. The signature is valid (recompute HMAC from stored payload, compare)
3. The chain is intact (previous_attestation_id exists, sequence_number is contiguous)
4. The Manifest link is valid (if manifest_id is present, it exists in manifest_memory)

The response includes a `verification` object:

```json
{
  "valid": true,
  "signature_verified": true,
  "chain_intact": true,
  "manifest_linked": true,
  "manifest_verdict": "PROCEED",
  "verified_at": "2026-03-18T16:00:00Z"
}
```

### 3.3 What Makes This Trustworthy

This is platform-signed, not decentralized. The trust model: "ClawNet was in the execution path and signed what it observed." This is comparable to a notary — you trust the notary's signature because the notary was present.

For actions that go through ClawNet (automatic attestations), this is strong: ClawNet saw the request, executed it, saw the response, and signed the record. The agent cannot fabricate what happened.

For explicit attestations (agent reports what happened externally), the trust is weaker: ClawNet signs that the agent CLAIMED this happened. The `source` field distinguishes these: `source: 'platform'` (automatic) vs `source: 'agent'` (explicit). Consumers of attestations can weight accordingly.

---

## 4. MANIFEST INTEGRATION

### 4.1 The Full Loop

```
Step 1: Agent calls POST /v1/manifest
        -> Manifest checks data, assesses reasoning, preflights action
        -> Returns manifest_id: "mfst_abc123", verdict: PROCEED
        -> AUTOMATIC ATTESTATION: "Manifest check performed" (att_m1)

Step 2: Agent calls POST /v1/orchestrate (with X-Manifest-Id: mfst_abc123)
        -> ClawNet executes the orchestration
        -> AUTOMATIC ATTESTATION: "Orchestration executed, linked to mfst_abc123" (att_m2)
        -> att_m2.previous_attestation_id = att_m1

Step 3: Agent reports outcome POST /v1/manifest/outcome
        -> Manifest records success/failure
        -> AUTOMATIC ATTESTATION: "Outcome reported for mfst_abc123" (att_m3)
        -> att_m3.previous_attestation_id = att_m2
```

Three attestations, chained, covering the full lifecycle: check -> act -> report.

### 4.2 Manifest Alignment Tracking

Every attestation records whether the agent followed the Manifest verdict:

| Scenario | `manifest_aligned` | Signal |
|---|---|---|
| Manifest said PROCEED, agent acted | `true` | Normal — agent followed advice |
| Manifest said CAUTION, agent acted | `true` (with flag) | Agent acknowledged risk and proceeded |
| Manifest said HOLD/BLOCK, agent acted anyway | `false` | Agent overrode safety check |
| No Manifest check before action | `null` | No preflight verification performed |

Agents with high `manifest_aligned: true` rates demonstrate responsible behavior. Agents with frequent `null` or `false` values are acting without verification or against it. This data feeds directly into the Agent Trust Score (Intelligence Suite skill #3).

### 4.3 Unverified Action Flagging

When an automatic attestation is created for an action that has NO linked Manifest check (no `X-Manifest-Id` header and no recent Manifest call from this key), the attestation includes:

```json
{
  "manifest": {
    "manifest_id": null,
    "manifest_verdict": null,
    "manifest_confidence": null,
    "note": "No Manifest check performed before this action"
  }
}
```

This is not punitive — the agent works fine. But the attestation record makes it visible. Over time, this creates a natural incentive to use Manifest: attested actions without a Manifest look riskier to counterparties reviewing attestation history.

---

## 5. THE ATTESTATION OBJECT

### 5.1 Full Shape

```json
{
  "id": "att_7kx9m2pq",
  "source": "platform",
  "created_at": "2026-03-18T15:30:00Z",
  "api_key_hash": "sha256:abc123def456...",

  "manifest": {
    "manifest_id": "mfst_xyz789",
    "manifest_verdict": "PROCEED",
    "manifest_confidence": 0.92,
    "checked_at": "2026-03-18T15:29:55Z"
  },

  "decision": {
    "action_type": "orchestrate",
    "description": null,
    "manifest_aligned": true
  },

  "action": {
    "endpoint": "/v1/orchestrate",
    "method": "POST",
    "request_hash": "sha256:def789...",
    "response_hash": "sha256:ghi012...",
    "credits_charged": 4.5,
    "duration_ms": 2340,
    "executed_at": "2026-03-18T15:30:00Z"
  },

  "outcome": {
    "status": "success",
    "error_code": null,
    "data_hash": "sha256:jkl345...",
    "credits_refunded": 0
  },

  "chain": {
    "previous_attestation_id": "att_prev456",
    "sequence_number": 47
  },

  "signature": "hmac-sha256:mnop678...",
  "signed": true,
  "verification_url": "https://api.claw-net.org/v1/attest/verify/att_7kx9m2pq"
}
```

### 5.2 Field Rules

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | Always | `'att_' + nanoid(12)` |
| `source` | enum | Always | `'platform'` (automatic) or `'agent'` (explicit) |
| `created_at` | ISO 8601 | Always | Server timestamp |
| `api_key_hash` | string | Always | SHA-256 of the API key — never the raw key |
| `manifest.*` | object | Always | All fields null if no Manifest link |
| `decision.*` | object | Always | `description` null for automatic attestations |
| `action.*` | object | Always | All fields populated |
| `outcome.*` | object | Always | `error_code` and `data_hash` null on success with no data |
| `chain.*` | object | Always | `previous_attestation_id` null for first attestation |
| `signature` | string | Conditional | null if `PLATFORM_SIGNING_SECRET` not set |
| `signed` | boolean | Always | true if signature is present and valid |

---

## 6. THE API

### 6.1 `POST /v1/attest` — Create an explicit attestation

**Auth:** `checkApiKey` middleware (X-API-Key required).

**Request body:**

```json
{
  "manifest_id": "mfst_abc123",
  "action": {
    "type": "swap",
    "endpoint": "jupiter-v6-swap",
    "description": "Swapped 1 SOL for BONK on Jupiter",
    "request_hash": "sha256:...",
    "response_hash": "sha256:...",
    "duration_ms": 1500,
    "executed_at": "2026-03-18T15:30:00Z"
  },
  "outcome": {
    "status": "success",
    "data_hash": "sha256:...",
    "data": { "amount_in": "1 SOL", "amount_out": "4200000 BONK" }
  }
}
```

**Validation:**

```typescript
const ExplicitAttestSchema = z.object({
  manifest_id: z.string().startsWith('mfst_').optional(),
  action: z.object({
    type: z.string().min(1).max(64),
    endpoint: z.string().max(256).optional(),
    description: z.string().max(1024).optional(),
    request_hash: z.string().startsWith('sha256:').optional(),
    response_hash: z.string().startsWith('sha256:').optional(),
    duration_ms: z.number().int().min(0).optional(),
    executed_at: z.string().datetime().optional(),
  }),
  outcome: z.object({
    status: z.enum(['success', 'failure', 'partial', 'timeout', 'rejected']),
    error_code: z.string().max(64).optional(),
    data_hash: z.string().startsWith('sha256:').optional(),
    data: z.record(z.unknown()).optional(),
  }),
});
```

**Response (201):**

```json
{
  "attestation_id": "att_7kx9m2pq",
  "source": "agent",
  "signed": true,
  "sequence_number": 48,
  "verification_url": "https://api.claw-net.org/v1/attest/verify/att_7kx9m2pq",
  "credits_charged": 0.25
}
```

**Errors:**

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_ATTESTATION` | Validation fails |
| 404 | `MANIFEST_NOT_FOUND` | `manifest_id` provided but does not exist |
| 403 | `MANIFEST_KEY_MISMATCH` | `manifest_id` belongs to a different API key |
| 402 | `INSUFFICIENT_CREDITS` | Not enough credits for explicit attestation fee |

### 6.2 `GET /v1/attest/:id` — Get attestation details

**Auth:** `checkApiKey` middleware. Agent can only retrieve their own attestations.

**Response (200):** Full attestation object (Section 5.1 shape).

**Errors:**

| Status | Code | When |
|---|---|---|
| 404 | `ATTESTATION_NOT_FOUND` | ID does not exist |
| 403 | `ATTESTATION_KEY_MISMATCH` | Attestation belongs to a different API key |

### 6.3 `GET /v1/attest/verify/:id` — Public verification

**Auth:** None. This is a public endpoint.

**Response (200):**

```json
{
  "attestation_id": "att_7kx9m2pq",
  "valid": true,
  "source": "platform",
  "created_at": "2026-03-18T15:30:00Z",

  "verification": {
    "signature_verified": true,
    "chain_intact": true,
    "manifest_linked": true,
    "manifest_verdict": "PROCEED",
    "manifest_confidence": 0.92
  },

  "summary": {
    "action_type": "orchestrate",
    "endpoint": "/v1/orchestrate",
    "outcome_status": "success",
    "credits_charged": 4.5,
    "duration_ms": 2340,
    "manifest_aligned": true
  },

  "verified_at": "2026-03-18T16:00:00Z"
}
```

The public verification endpoint returns a summary, NOT the full attestation. It does not expose request/response hashes, the agent's key hash, or chain details. It confirms: this attestation exists, the signature checks out, the chain is intact, and here is a high-level summary of what happened.

**Chain integrity check:** Query the previous attestation by `previous_attestation_id`, verify it exists and its `sequence_number` is exactly `current_sequence - 1`. If there is a gap, `chain_intact: false`.

**Errors:**

| Status | Code | When |
|---|---|---|
| 404 | `ATTESTATION_NOT_FOUND` | ID does not exist |

### 6.4 `GET /v1/attest/history` — Query attestation history

**Auth:** `checkApiKey` middleware.

**Query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | 20 | Max results (1-100) |
| `offset` | integer | 0 | Pagination offset |
| `source` | enum | all | `'platform'` or `'agent'` |
| `action_type` | string | all | Filter by action type |
| `outcome` | enum | all | `'success'`, `'failure'`, `'partial'`, `'timeout'`, `'rejected'` |
| `manifest_aligned` | boolean | all | Filter by Manifest alignment |
| `has_manifest` | boolean | all | Filter by whether a Manifest was linked |
| `from` | ISO 8601 | none | Start date |
| `to` | ISO 8601 | none | End date |

**Response (200):**

```json
{
  "attestations": [
    { /* full attestation object */ },
    { /* full attestation object */ }
  ],
  "total": 142,
  "limit": 20,
  "offset": 0
}
```

### 6.5 `GET /v1/attest/stats` — Attestation summary

**Auth:** `checkApiKey` middleware.

**Response (200):**

```json
{
  "total_attestations": 142,
  "by_source": {
    "platform": 130,
    "agent": 12
  },
  "by_outcome": {
    "success": 128,
    "failure": 8,
    "partial": 4,
    "timeout": 2,
    "rejected": 0
  },
  "manifest_coverage": {
    "with_manifest": 95,
    "without_manifest": 47,
    "coverage_pct": 66.9
  },
  "manifest_alignment": {
    "aligned": 90,
    "overridden": 3,
    "not_applicable": 2,
    "alignment_pct": 96.8
  },
  "chain": {
    "first_attestation_at": "2026-01-15T10:00:00Z",
    "latest_attestation_at": "2026-03-18T15:30:00Z",
    "current_sequence": 142,
    "chain_intact": true
  },
  "credits": {
    "total_attested_spend": 847.5,
    "avg_credits_per_action": 5.97
  }
}
```

### 6.6 `GET /v1/attest/agent/:keyHash` — Public agent attestation profile

**Auth:** None. This is a public endpoint.

Returns a summary of an agent's attestation history (by API key hash). This is the endpoint that counterparties and trust systems query to evaluate an agent's track record.

**Response (200):**

```json
{
  "api_key_hash": "sha256:abc123...",
  "total_attestations": 142,
  "first_attestation_at": "2026-01-15T10:00:00Z",
  "latest_attestation_at": "2026-03-18T15:30:00Z",
  "success_rate": 0.901,
  "manifest_coverage_pct": 66.9,
  "manifest_alignment_pct": 96.8,
  "chain_intact": true,
  "platform_attested_pct": 91.5
}
```

No detailed attestation data is exposed. Just aggregate stats. The agent chooses to share their `api_key_hash` with counterparties who can then look up this profile.

---

## 7. PRICING

**Automatic attestations: FREE.** Included in the cost of the action. The agent already pays for the orchestration/invocation/query. The attestation is a byproduct of ClawNet being in the execution path. Zero incremental cost to the agent. This maximizes adoption — every action is attested from day one.

**Explicit attestations: 0.25 credits.** The agent is asking ClawNet to sign a record of something that happened outside the platform. This costs storage, computation (HMAC signing), and platform credibility (ClawNet is attesting to an agent's claim). 0.25cr covers the cost and creates a minimal barrier against spam.

**Verification: FREE.** `GET /v1/attest/verify/:id` is public and free. Verification is the whole point — making it paid would undermine adoption.

**History and stats: FREE.** Read-only queries against the agent's own data. No incremental cost.

**Public agent profile: FREE.** Counterparty trust queries. Free to maximize the network effect.

| Operation | Cost | Rationale |
|---|---|---|
| Automatic attestation | 0 cr (included) | Maximize coverage, zero friction |
| Explicit attestation | 0.25 cr | Storage + signing + spam prevention |
| Verify | 0 cr | Adoption requires free verification |
| History / Stats / Profile | 0 cr | Read-only, no incremental cost |

---

## 8. STORAGE

### 8.1 Migration v80

```sql
-- v80: Attestation layer
CREATE TABLE IF NOT EXISTS attestations (
  id TEXT PRIMARY KEY,                              -- 'att_' + nanoid(12)
  source TEXT NOT NULL DEFAULT 'platform',           -- 'platform' | 'agent'
  api_key_hash TEXT NOT NULL,                        -- SHA-256 of API key (never raw)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- Manifest link
  manifest_id TEXT,                                  -- FK to manifest_memory.id (nullable)
  manifest_verdict TEXT,                             -- PROCEED | CAUTION | HOLD | BLOCK
  manifest_confidence REAL,                          -- 0.0-1.0
  manifest_checked_at TEXT,                          -- ISO 8601
  manifest_aligned INTEGER,                          -- 1 = aligned, 0 = overridden, NULL = no manifest

  -- Decision
  action_type TEXT NOT NULL,                         -- 'orchestrate' | 'invoke_skill' | 'swap' | custom
  action_description TEXT,                           -- Agent-provided (explicit only)

  -- Action
  action_endpoint TEXT,                              -- '/v1/orchestrate', skill ID, external service
  action_method TEXT DEFAULT 'POST',                 -- HTTP method
  request_hash TEXT NOT NULL,                        -- SHA-256 of request
  response_hash TEXT,                                -- SHA-256 of response
  credits_charged REAL NOT NULL DEFAULT 0,           -- Credits for this action
  duration_ms INTEGER,                               -- Wall-clock time
  executed_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- Outcome
  outcome_status TEXT NOT NULL DEFAULT 'success',    -- success | failure | partial | timeout | rejected
  outcome_error_code TEXT,                           -- SNAKE_CASE error code
  outcome_data_hash TEXT,                            -- SHA-256 of outcome data
  credits_refunded REAL NOT NULL DEFAULT 0,

  -- Chain
  previous_attestation_id TEXT,                      -- Previous att_ in this agent's chain
  sequence_number INTEGER NOT NULL,                  -- Monotonic per api_key_hash

  -- Signature
  signature TEXT,                                    -- 'hmac-sha256:...' (null if signing disabled)
  signed INTEGER NOT NULL DEFAULT 0,                 -- 1 if signature present

  -- Extra data (explicit attestations)
  extra_json TEXT                                     -- Agent-provided outcome data, source hashes, etc.
);

CREATE INDEX IF NOT EXISTS idx_att_key_hash ON attestations(api_key_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_att_manifest ON attestations(manifest_id) WHERE manifest_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_att_action_type ON attestations(action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_att_outcome ON attestations(outcome_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_att_sequence ON attestations(api_key_hash, sequence_number DESC);
CREATE INDEX IF NOT EXISTS idx_att_source ON attestations(source, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_att_chain ON attestations(api_key_hash, sequence_number);
```

### 8.2 Retention

- **Explicit attestations (`source: 'agent'`):** Permanent. The agent paid for them, and they are the agent's proof.
- **Automatic attestations (`source: 'platform'`):** 1 year. After 1 year, a daily cleanup job deletes automatic attestations older than 365 days. The `stats` aggregates are preserved in a separate `attestation_stats_snapshot` row (computed before deletion) so lifetime stats remain accurate even after old records are purged.

Cleanup uses the same batched delete pattern as existing crons (LIMIT 5000 per iteration, WAL PASSIVE checkpoint after).

### 8.3 Stats Snapshot Table

```sql
-- Also in migration v80
CREATE TABLE IF NOT EXISTS attestation_stats_snapshots (
  api_key_hash TEXT PRIMARY KEY,
  total_purged INTEGER NOT NULL DEFAULT 0,
  purged_success INTEGER NOT NULL DEFAULT 0,
  purged_failure INTEGER NOT NULL DEFAULT 0,
  purged_with_manifest INTEGER NOT NULL DEFAULT 0,
  purged_aligned INTEGER NOT NULL DEFAULT 0,
  purged_credits_total REAL NOT NULL DEFAULT 0,
  earliest_purged_at TEXT,
  latest_purged_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

When computing `GET /v1/attest/stats`, the response merges live attestation counts with the purged snapshot to produce lifetime totals.

---

## 9. AUTOMATIC ATTESTATION INTEGRATION

### 9.1 Middleware Approach

Attestation creation is a shared utility function called at each billing site, NOT a middleware. Hono middleware cannot reliably access the parsed response body and billing details. Instead, each billing endpoint calls `createAutoAttestation()` after `deductCredit()`.

```typescript
// Called after deductCredit() at each billing site
import { createAutoAttestation } from '../core/attestation-engine';

// In route handler, after billing:
createAutoAttestation({
  apiKeyHash,
  actionType: 'orchestrate',
  endpoint: '/v1/orchestrate',
  method: 'POST',
  requestHash: computeRequestHashFromBody(requestBody),
  responseHash: computeResultHashFromBody(responseBody),
  creditsCharged: totalCost,
  durationMs: Date.now() - startTime,
  outcomeStatus: 'success',
  manifestId: c.req.header('X-Manifest-Id') ?? null,
}).catch(() => {}); // Fire-and-forget — never blocks response
```

### 9.2 Billing Sites That Create Automatic Attestations

All 10 existing billing sites (same ones that call `trackDelegatedSpend()`):

| File | Endpoint | Action Type |
|---|---|---|
| `src/routes/api.ts` | `POST /v1/orchestrate` | `orchestrate` |
| `src/routes/batch.ts` | `POST /v1/batch` | `batch` |
| `src/routes/stream.ts` | `GET /v1/stream/orchestrate` | `stream` |
| `src/routes/skills.ts` | `POST /v1/skills/:id/invoke` | `invoke_skill` |
| `src/routes/skills.ts` | `POST /v1/skills/:id/query` | `query_skill` |
| `src/routes/openclaw.ts` | `POST /v1/openclaw/chat` | `openclaw_chat` |
| `src/routes/tasks.ts` | `POST /v1/tasks` | `task_create` |
| `src/routes/llm.ts` | `POST /v1/llm/chat` | `llm_chat` |
| `src/routes/swarm.ts` | `POST /v1/swarm/orchestrate` | `swarm` |
| `src/routes/manifest.ts` | `POST /v1/manifest` | `manifest_check` |

Plus the new Intelligence Suite endpoints when they ship.

### 9.3 The `X-ClawNet-Attestation-Id` Response Header

Every response from a billing endpoint includes the attestation ID in a response header:

```
X-ClawNet-Attestation-Id: att_7kx9m2pq
```

This lets the agent store the attestation ID alongside its own records without making an extra API call. The agent can later use this ID to retrieve the full attestation or share it with counterparties for verification.

### 9.4 The `X-Manifest-Id` Request Header

Agents that want to explicitly link an action to a Manifest check include this header:

```
X-Manifest-Id: mfst_abc123
```

This overrides the 60-second heuristic lookup. If the header is present, that manifest_id is used. If the manifest_id does not exist or belongs to a different key, the attestation is created without the Manifest link (no error — the action still succeeds).

---

## 10. WHO USES ATTESTATIONS AND WHY

### 10.1 Agent Operators

"My agent acted correctly based on the data it had."

An agent operator can pull their attestation history to demonstrate responsible behavior: high Manifest coverage, high alignment rate, strong success rate, intact chain. This is the agent's resume.

### 10.2 Counterparties

"Before I trust this agent, show me its attestation history."

The public profile endpoint (`GET /v1/attest/agent/:keyHash`) lets counterparties evaluate an agent's track record before transacting with it. An agent with 6 months of clean, Manifest-verified attestations is demonstrably more trustworthy than one with zero history.

### 10.3 Agent Trust Score Integration

Attestation data feeds directly into Intelligence Suite skill #3 (Agent Trust Score). The scoring factors:

| Factor | Weight | Source |
|---|---|---|
| Attestation count | 5% | Total attestations (demonstrates activity) |
| Success rate | 15% | `outcome_status` distribution |
| Manifest coverage | 15% | % of actions with linked Manifest check |
| Manifest alignment | 10% | % of actions that followed Manifest verdict |
| Chain integrity | 5% | Whether the attestation chain has gaps |
| Platform vs agent source | 5% | Higher weight for platform-attested (harder to fabricate) |

These factors replace or supplement the existing behavioral signals in Agent Trust Score. Attestation data is strictly more reliable than inferred behavioral data because it is signed by the platform.

### 10.4 Dispute Resolution

When a dispute arises (escrow, marketplace refund, skill quality complaint), the attestation record provides definitive evidence:

- What data the agent had at the time of the decision
- Whether a Manifest check was performed and what it said
- Exactly what action was taken (with request/response hashes)
- What the outcome was

This replaces "he said / she said" with "here is the signed, timestamped, hash-verified record."

### 10.5 Future: Regulatory Compliance

When KYA (Know Your Agent) regulation arrives, ClawNet agents already have months or years of auditable, signed, chained attestation history. Competitors' agents have zero. This is the long-term play.

### 10.6 Future: Insurance

Agent insurance providers need proof that an agent followed proper procedures before executing high-value actions. "Did the agent verify the data? Did it check for risks? Did it act in accordance with the safety check?" Attestations answer all three questions with cryptographic proof.

---

## 11. EXISTING INFRASTRUCTURE CONNECTIONS

| Attestation Needs | Existing Infrastructure | Connection |
|---|---|---|
| Request hashing | `src/utils/receipt-hash.ts` | Reuses `canonicalize()` pattern. New `computeAttestationHash()` function. |
| Response signing | `src/middleware/sign-response.ts` | Same `PLATFORM_SIGNING_SECRET`, same HMAC-SHA256 pattern. |
| Manifest linking | `src/db/manifest.ts` | Reads `manifest_memory` by ID for verification. |
| Audit trail | `src/db/connection.ts` | `logAudit()` called on every attestation create/verify. |
| Billing | `src/core/credits.ts` | `deductCredit()` for explicit attestations (0.25cr). |
| Delegated billing | `src/utils/billing.ts` | `trackDelegatedSpend()` after explicit attestation billing. |
| API key hashing | crypto | `createHash('sha256').update(apiKey).digest('hex')` — same pattern as `intel_events.api_key_hash`. |
| Agent Trust Score | `src/core/trust-scorer.ts` (future) | Reads `attestations` table for scoring factors. |
| Cache | `src/cache/index.ts` | Caches recent `sequence_number` per key hash in L1 for fast chain lookups. |

---

## 12. CORE ENGINE IMPLEMENTATION

### 12.1 `createAutoAttestation()` — Fire-and-forget

```typescript
export async function createAutoAttestation(params: {
  apiKeyHash: string;
  actionType: string;
  endpoint: string;
  method: string;
  requestHash: string;
  responseHash: string;
  creditsCharged: number;
  durationMs: number;
  outcomeStatus: 'success' | 'failure' | 'partial' | 'timeout' | 'rejected';
  errorCode?: string;
  creditsRefunded?: number;
  manifestId?: string | null;
}): Promise<string | null> {
  // 1. Resolve manifest link
  //    If manifestId provided, validate it exists and belongs to this key
  //    If not provided, query manifest_memory for most recent check by this
  //    api_key_hash within last 60 seconds
  // 2. Get previous attestation + next sequence number
  //    SELECT id, sequence_number FROM attestations
  //    WHERE api_key_hash = ? ORDER BY sequence_number DESC LIMIT 1
  //    (Cached in L1 for performance)
  // 3. Build payload, sign, insert
  // 4. Update L1 cache with new sequence
  // 5. Return attestation ID (or null on failure)
}
```

### 12.2 `createExplicitAttestation()` — Agent-initiated

```typescript
export async function createExplicitAttestation(params: {
  apiKeyHash: string;
  billingKey: string;
  manifestId?: string;
  action: {
    type: string;
    endpoint?: string;
    description?: string;
    requestHash?: string;
    responseHash?: string;
    durationMs?: number;
    executedAt?: string;
  };
  outcome: {
    status: 'success' | 'failure' | 'partial' | 'timeout' | 'rejected';
    errorCode?: string;
    dataHash?: string;
    data?: Record<string, unknown>;
  };
}): Promise<{ attestationId: string; sequenceNumber: number }> {
  // 1. Validate manifest_id if provided (exists, belongs to key)
  // 2. Bill 0.25 credits (deductCredit + trackDelegatedSpend)
  // 3. Get previous attestation + next sequence number
  // 4. Build payload with agent-provided data
  // 5. Sign, insert
  // 6. Return attestation ID + sequence
}
```

### 12.3 `verifyAttestation()` — Public verification

```typescript
export function verifyAttestation(attestationId: string): {
  valid: boolean;
  signatureVerified: boolean;
  chainIntact: boolean;
  manifestLinked: boolean;
  manifestVerdict: string | null;
  summary: { /* action_type, endpoint, outcome, credits, duration, aligned */ };
} {
  // 1. Fetch attestation by ID
  // 2. Recompute HMAC from stored fields, compare to signature
  // 3. Check chain: previous attestation exists, sequence is contiguous
  // 4. Check manifest: if manifest_id set, verify it exists in manifest_memory
  // 5. Build summary (public-safe fields only)
  // 6. Return verification result
}
```

### 12.4 `getAttestationStats()` — Aggregated stats

```typescript
export function getAttestationStats(apiKeyHash: string): AttestationStats {
  // 1. Count live attestations by source, outcome, manifest presence
  // 2. Merge with purged snapshot (attestation_stats_snapshots)
  // 3. Compute chain integrity (any gaps in sequence_number?)
  // 4. Compute manifest coverage + alignment percentages
  // 5. Return merged stats
}
```

### 12.5 Signing Implementation

```typescript
import { createHmac, createHash } from 'crypto';
import { env } from '../config/index';

function canonicalize(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

function signAttestationPayload(payload: {
  id: string;
  source: string;
  api_key_hash: string;
  manifest_id: string | null;
  manifest_verdict: string | null;
  action_type: string;
  action_endpoint: string | null;
  request_hash: string;
  response_hash: string | null;
  outcome_status: string;
  sequence_number: number;
  created_at: string;
}): string | null {
  const secret = env.PLATFORM_SIGNING_SECRET;
  if (!secret) return null;
  const canonical = canonicalize(payload);
  return 'hmac-sha256:' + createHmac('sha256', secret)
    .update(canonical)
    .digest('hex');
}

export function hashApiKey(apiKey: string): string {
  return 'sha256:' + createHash('sha256').update(apiKey).digest('hex');
}

export function computeBodyHash(body: string | Record<string, unknown>): string {
  const str = typeof body === 'string' ? body : canonicalize(body);
  return 'sha256:' + createHash('sha256').update(str).digest('hex');
}
```

---

## 13. SEQUENCE NUMBER MANAGEMENT

The `sequence_number` is monotonic per `api_key_hash`. It provides ordering guarantees and makes gaps detectable.

**On attestation creation:**

```sql
SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_seq
FROM attestations WHERE api_key_hash = ?
```

This is safe under SQLite WAL because attestation creation happens inside a transaction (or is serialized by the single-writer constraint).

**Performance optimization:** Cache the current sequence number per key hash in L1 memory (`cacheSet('att:seq:' + keyHash, seq, 3600)`). Read from cache first, fall back to DB query on miss. Update cache after insert.

**Gap detection:** During verification, check:

```sql
SELECT COUNT(*) as count FROM attestations
WHERE api_key_hash = ? AND sequence_number BETWEEN ? AND ?
-- Expected: (current_seq - previous_seq) rows
```

A gap means an attestation was deleted or the chain was tampered with. The verification endpoint reports `chain_intact: false`.

---

## 14. CLEANUP CRON

Added to `src/core/payout-cron.ts` (the existing 4-hour cron) or as a new daily cron.

```typescript
function cleanupOldAttestations(): void {
  const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Snapshot stats for keys that will lose records
  const affectedKeys = getDb().prepare(`
    SELECT DISTINCT api_key_hash FROM attestations
    WHERE source = 'platform' AND created_at < ? LIMIT 1000
  `).all(cutoff) as { api_key_hash: string }[];

  for (const { api_key_hash } of affectedKeys) {
    // Compute stats for records about to be purged, upsert into snapshot
    const stats = getDb().prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN outcome_status = 'success' THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN outcome_status = 'failure' THEN 1 ELSE 0 END) as failure,
        SUM(CASE WHEN manifest_id IS NOT NULL THEN 1 ELSE 0 END) as with_manifest,
        SUM(CASE WHEN manifest_aligned = 1 THEN 1 ELSE 0 END) as aligned,
        SUM(credits_charged) as credits_total,
        MIN(created_at) as earliest,
        MAX(created_at) as latest
      FROM attestations
      WHERE api_key_hash = ? AND source = 'platform' AND created_at < ?
    `).get(api_key_hash, cutoff);

    // Upsert snapshot (accumulate with existing purged stats)
    // ...
  }

  // 2. Batched delete (LIMIT 5000 per iteration)
  let deleted = 0;
  do {
    const result = getDb().prepare(`
      DELETE FROM attestations WHERE rowid IN (
        SELECT rowid FROM attestations
        WHERE source = 'platform' AND created_at < ? LIMIT 5000
      )
    `).run(cutoff);
    deleted = result.changes;
  } while (deleted === 5000);

  // 3. WAL checkpoint
  getDb().pragma('wal_checkpoint(PASSIVE)');
}
```

---

## 15. WHAT ATTESTATION IS NOT

- **Not a blockchain.** It is platform-signed, not decentralized. Trust comes from ClawNet being in the execution path, not from consensus.
- **Not a replacement for on-chain receipts.** On-chain transactions have their own immutable record. Attestation complements this by recording the off-chain decision context that led to the on-chain action.
- **Not a legal document.** It is cryptographic proof of what was observed, not a legal contract or compliance certificate.
- **Not mandatory.** Agents work fine without it. Automatic attestations happen silently. Explicit attestations are opt-in. No endpoint rejects requests for lack of attestation history.
- **Not an oracle.** Attestation records what happened, not what should happen. It does not make judgments about correctness — that is Manifest's job.

---

## 16. THE MARKETING ANGLE

### Before Attestation

"ClawNet orchestrates APIs and has a marketplace."

This is a plumbing pitch. It describes what ClawNet does, not what it means.

### After Attestation

"ClawNet is the trust layer for the agent economy. Verify before you act (Manifest). Prove after you did (Attestation)."

This is a positioning pitch. It describes what ClawNet enables: **accountable agents.**

### The Two-Product Story

| Product | When | Question | Output |
|---|---|---|---|
| **Manifest** | BEFORE the action | "Should I do this?" | Verdict + confidence |
| **Attestation** | AFTER the action | "What did I do?" | Signed proof |

Together they form a closed loop. No other platform offers both halves. An agent using both can demonstrate to any counterparty:

1. "I checked first" (Manifest)
2. "Here is what happened" (Attestation)
3. "And both are cryptographically signed by the platform that was in the execution path"

### Competitive Moat

Attestation data accumulates from day one (automatic on every action). By the time competitors realize they need this, ClawNet agents have months of signed, chained, verifiable history. This history cannot be retroactively created. First-mover advantage is absolute — the data either exists or it does not.

---

## 17. LONG-TERM TIMELINE

**Month 1:** Attestations accumulate automatically on every billing action. Agents begin building signed history without any effort. The `X-ClawNet-Attestation-Id` header makes attestation IDs available for agent record-keeping.

**Month 3:** Agents with 3 months of clean attestation history begin referencing it in trust negotiations. The Agent Trust Score (skill #3) begins weighting attestation data heavily. Counterparties start checking `GET /v1/attest/agent/:keyHash` before transacting.

**Month 6:** Attestation coverage becomes a competitive differentiator. Agents on ClawNet have provable history. Agents on competing platforms have nothing. Agent operators choose ClawNet specifically for the attestation trail.

**Month 9:** Insurance and compliance integrations begin. Third parties build on the verification endpoint. Attestation chains become the standard format for agent audit trails.

**Month 12:** KYA (Know Your Agent) regulation discussions begin. ClawNet agents already have 12 months of auditable, signed, chained attestation history. Competitors' agents have zero days. The regulatory moat is locked in.

---

## 18. FILES TO CREATE

| File | Purpose | Estimated Lines |
|---|---|---|
| `src/routes/attest.ts` | HTTP routes: `POST /v1/attest`, `GET /v1/attest/:id`, `GET /v1/attest/verify/:id`, `GET /v1/attest/history`, `GET /v1/attest/stats`, `GET /v1/attest/agent/:keyHash` | ~300 |
| `src/core/attestation-engine.ts` | Core engine: `createAutoAttestation()`, `createExplicitAttestation()`, `verifyAttestation()`, `getAttestationStats()`, `signAttestationPayload()`, `hashApiKey()`, `computeBodyHash()` | ~350 |
| `src/db/attestations.ts` | DB layer: `insertAttestation()`, `getAttestationById()`, `getAttestationsByKeyHash()`, `getLatestSequence()`, `getAttestationStats()`, `getPublicAgentProfile()`, `upsertStatsSnapshot()`, `cleanupOldAttestations()` | ~200 |

### Files to Modify

| File | Change |
|---|---|
| `src/db/connection.ts` | Add migration v80 (attestations + attestation_stats_snapshots tables) |
| `src/db/index.ts` | Add `export * from './attestations';` to barrel |
| `src/index.ts` | Import + mount: `import { attestRouter } from './routes/attest'; app.route('/v1/attest', attestRouter);` |
| `src/routes/api.ts` | Add `createAutoAttestation()` call after billing |
| `src/routes/batch.ts` | Add `createAutoAttestation()` call after billing |
| `src/routes/stream.ts` | Add `createAutoAttestation()` call after billing |
| `src/routes/skills.ts` | Add `createAutoAttestation()` call after billing (invoke + query) |
| `src/routes/openclaw.ts` | Add `createAutoAttestation()` call after billing |
| `src/routes/tasks.ts` | Add `createAutoAttestation()` call after billing |
| `src/routes/llm.ts` | Add `createAutoAttestation()` call after billing |
| `src/routes/swarm.ts` | Add `createAutoAttestation()` call after billing |
| `src/routes/manifest.ts` | Add `createAutoAttestation()` call after billing |
| `src/config/index.ts` | No change needed — `PLATFORM_SIGNING_SECRET` already defined |
| `src/core/payout-cron.ts` | Add `cleanupOldAttestations()` to daily cycle |

### Barrel Export Addition (`src/db/index.ts`)

```typescript
export * from './attestations';
```

### Route Mount (`src/index.ts`)

```typescript
import { attestRouter } from './routes/attest';
app.route('/v1/attest', attestRouter);
```

### Billing Integration Pattern (added to each billing site)

```typescript
import { createAutoAttestation, computeBodyHash, hashApiKey } from '../core/attestation-engine';

// After deductCredit() and trackDelegatedSpend(), before return:
createAutoAttestation({
  apiKeyHash: hashApiKey(keyInfo.key),
  actionType: 'orchestrate',  // varies per site
  endpoint: '/v1/orchestrate', // varies per site
  method: 'POST',
  requestHash: computeBodyHash(requestBody),
  responseHash: computeBodyHash(responseData),
  creditsCharged: totalCost,
  durationMs: Date.now() - startTime,
  outcomeStatus: error ? 'failure' : 'success',
  errorCode: error?.code ?? undefined,
  manifestId: c.req.header('X-Manifest-Id') ?? undefined,
}).then(attId => {
  if (attId) c.header('X-ClawNet-Attestation-Id', attId);
}).catch(() => {});
```

Note: because `createAutoAttestation` is async and fire-and-forget, the `X-ClawNet-Attestation-Id` header can only be set if we await the attestation creation. For endpoints where this header matters, the attestation creation is awaited (adds ~1-2ms for the DB insert). For streaming endpoints, it is truly fire-and-forget and the header is omitted.

---

## 19. IMPLEMENTATION PLAN

### Phase 1: Foundation (1 day)

1. Add migration v80 to `src/db/connection.ts`
2. Create `src/db/attestations.ts` — all DB functions
3. Update `src/db/index.ts` — barrel export

### Phase 2: Core Engine (1.5 days)

4. Create `src/core/attestation-engine.ts`
   - `createAutoAttestation()`, `createExplicitAttestation()`
   - `verifyAttestation()`, `getAttestationStats()`
   - Signing functions, hashing functions

### Phase 3: Routes (1 day)

5. Create `src/routes/attest.ts`
   - `POST /v1/attest` — explicit attestation
   - `GET /v1/attest/:id` — get by ID
   - `GET /v1/attest/verify/:id` — public verification (no auth)
   - `GET /v1/attest/history` — paginated history with filters
   - `GET /v1/attest/stats` — aggregated stats
   - `GET /v1/attest/agent/:keyHash` — public agent profile
6. Update `src/index.ts` — mount router

### Phase 4: Automatic Integration (1.5 days)

7. Add `createAutoAttestation()` calls to all 10 billing sites
8. Add `X-ClawNet-Attestation-Id` response header
9. Add `X-Manifest-Id` request header parsing

### Phase 5: Cleanup + Tests (1 day)

10. Add cleanup logic to payout cron
11. Write unit tests:
    - Attestation creation (auto + explicit)
    - Signature verification
    - Chain integrity detection
    - Stats computation with purged data merging
    - Manifest linking (header, heuristic, none)

**Total estimate: 6 days.**

| Component | Time |
|---|---|
| DB layer + migration | 0.5 days |
| Core engine (signing, creation, verification) | 1.5 days |
| Routes (6 endpoints) | 1 day |
| Billing site integration (10 files) | 1.5 days |
| Cleanup cron + tests | 1 day |
| Integration testing + edge cases | 0.5 days |

---

## 20. APPENDIX: EXAMPLE ATTESTATION CHAIN

A complete Manifest-to-Attestation flow for a SOL swap:

**Step 1: Agent calls Manifest**

```
POST /v1/manifest
X-API-Key: cn-agent-abc123
```

Response includes `id: "mfst_7kx9m2pq"`, `verdict: "PROCEED"`, `confidence: 0.91`.

Auto-attestation created: `att_a1b2c3d4` (type: `manifest_check`, seq: 46).

**Step 2: Agent calls Orchestrate**

```
POST /v1/orchestrate
X-API-Key: cn-agent-abc123
X-Manifest-Id: mfst_7kx9m2pq
```

Response includes swap result. Cost: 4.5 credits.

Auto-attestation created: `att_e5f6g7h8` (type: `orchestrate`, seq: 47, manifest_id: `mfst_7kx9m2pq`, manifest_aligned: true, previous: `att_a1b2c3d4`).

Response header: `X-ClawNet-Attestation-Id: att_e5f6g7h8`.

**Step 3: Agent reports outcome to Manifest**

```
POST /v1/manifest/outcome
{ "manifest_id": "mfst_7kx9m2pq", "outcome": "success", "value": 12.5 }
```

Auto-attestation created: `att_i9j0k1l2` (type: `manifest_outcome`, seq: 48, manifest_id: `mfst_7kx9m2pq`, previous: `att_e5f6g7h8`).

**Step 4: Counterparty verifies**

```
GET /v1/attest/verify/att_e5f6g7h8
```

Response:

```json
{
  "attestation_id": "att_e5f6g7h8",
  "valid": true,
  "source": "platform",
  "verification": {
    "signature_verified": true,
    "chain_intact": true,
    "manifest_linked": true,
    "manifest_verdict": "PROCEED",
    "manifest_confidence": 0.91
  },
  "summary": {
    "action_type": "orchestrate",
    "endpoint": "/v1/orchestrate",
    "outcome_status": "success",
    "credits_charged": 4.5,
    "duration_ms": 2340,
    "manifest_aligned": true
  },
  "verified_at": "2026-03-18T16:00:00Z"
}
```

Three attestations, chained, covering the full lifecycle. Each one signed. Each one verifiable. The complete story of what happened, with cryptographic proof.

---

## 21. FAQ

**Q: Does the agent need to do anything to get attestations?**
A: No. Automatic attestations happen on every billing action. The agent gets attestation IDs in response headers. Zero effort, full coverage.

**Q: What if PLATFORM_SIGNING_SECRET is not set?**
A: Attestations are still created but unsigned (`signed: false`, `signature: null`). They function as audit records. Verification endpoint reports `signature_verified: false`. This is acceptable for development but should never happen in production.

**Q: What if the attestation insert fails?**
A: The agent's action still succeeds. Attestation creation is fire-and-forget. A missing attestation is a gap in the chain (detectable via sequence numbers) but does not affect the agent's ability to act.

**Q: Can an agent delete their attestations?**
A: No. Attestations are append-only. The agent cannot delete, modify, or reorder them. This is the point — they are tamper-proof.

**Q: How does this relate to the existing receipt system?**
A: The existing `computeRequestHash()` and `computeResultHash()` in `receipt-hash.ts` produce hashes for individual skill invocations. Attestation uses the same hashing approach but wraps it in a broader context: data + decision + action + outcome + chain + signature. Receipts are a subset of what attestations capture.

**Q: What about agents that use ClawNet for verification (Manifest) but act elsewhere?**
A: They use explicit attestations (`POST /v1/attest`). They pay 0.25cr, provide the action and outcome details, and ClawNet signs the attestation noting `source: "agent"`. The attestation is valid but carries the `agent` source tag so consumers know ClawNet did not directly observe the action.

**Q: How big will the attestations table get?**
A: Rough estimate: 1000 active agents, average 100 actions/day = 100K attestations/day = 36.5M/year. Each row is ~500 bytes. That is ~18GB/year. The 1-year retention on automatic attestations caps growth. SQLite handles this fine with the existing indexes.

**Q: Does attestation work with delegated keys?**
A: Yes. The `api_key_hash` is the hash of the key that made the request (child or parent). Billing goes to the parent (via existing delegation resolution), but the attestation records the acting key. This means a parent can see attestations from all delegated children by querying their key hashes.
