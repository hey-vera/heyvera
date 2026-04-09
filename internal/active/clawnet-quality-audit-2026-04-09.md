# ClawNet Quality Audit — 2026-04-09

Full-spectrum audit: security, architecture, performance, trust system, payments, Soma integration.

---

## Severity Guide

| Level | Meaning |
|-------|---------|
| **CRITICAL** | Silently broken or exploitable now |
| **HIGH** | Wrong behavior, data corruption risk, or security gap |
| **MEDIUM** | Performance issue, dead code, or future risk |
| **LOW** | Code quality, minor inconsistency |

---

## 1. CRITICAL — Fix Immediately

### 1.1 `attestation_stats.owner_key` Does Not Exist (Trust System Dead)

**Files:** `trust-decay-cron.ts`, `trust-delegation.ts`, `trust-import.ts`, `trust-scoring-v2.ts`, `trust-scoring-v11.ts`, `seasons.ts`

The `attestation_stats` table (migration v80) has `api_key_hash TEXT PRIMARY KEY`. There is no `owner_key` column — no migration ever adds one. Six files query `WHERE owner_key = ?`, all wrapped in try/catch, all silently return nothing.

**Impact:**
- Trust never decays (the "gravity well" is disconnected)
- Trust delegation scores are always 0 (parent score lookup fails)
- Trust imports can't verify local transaction counts
- Trust scoring v2/v11 return empty results
- Seasons leaderboards are empty

**Fix:** Add migration: `ALTER TABLE attestation_stats ADD COLUMN owner_key TEXT` + backfill from `aid_keys` join, or refactor all queries to join through `aid_keys.owner_key → attestation_stats.api_key_hash` mapping.

### 1.2 Trust Delegation "Signature" Is Not Cryptographic

**File:** `trust-delegation.ts:108-109`

```typescript
const sigInput = `${parentDid}:${childDid}:${inheritancePct}:${expiresAt}`;
const signature = aidHash(sigInput);
```

This is a hash, not a signature. Anyone who knows a parent's DID can forge a delegation — they just hash the same string. No private key is involved.

**Impact:** Any agent can claim to be delegated by any other agent and inherit their trust score.

**Fix:** Sign with parent's Ed25519 key via `nacl.sign.detached()`, store and verify the real signature.

### 1.3 Checkpoint Always Reports 100% Success Rate

**File:** `soma-checkpoint.ts:133`

```typescript
const successCount = actionCount; // all appended actions are successful
```

Every checkpoint hardcodes `successCount = actionCount`. The checkpoint hash commits to this false data. Observers verifying checkpoint chains see fabricated 100% success rates.

**Impact:** Behavioral checkpoints are meaningless as trust evidence — every agent looks perfect.

**Fix:** Track actual success/failure in `pulse_tree_leaves` (add a `success` boolean column) and count real successes.

---

## 2. HIGH — Fix Soon

### 2.1 API Key Masking Bypass in Billing Receipts

**File:** `db/credits.ts:158,203`

```typescript
const masked = key.slice(0, 6) + '...' + key.slice(-4);
```

Two locations use raw `.slice()` instead of `maskApiKey()` from `utils/mask.ts`. CLAUDE.md explicitly flags this as a critical gotcha. The `maskApiKey()` function handles edge cases (short keys, undefined). Raw `.slice()` on a short or malformed key could expose the full key in logs/DB.

**Fix:** Replace both with `maskApiKey(key)`.

### 2.2 Trust Import Accepts Unverified `proofData`

**File:** `trust-import.ts:70`

The `proofData` parameter is accepted but never validated — no signature verification, no on-chain lookup, no API call to the claimed source. An agent can claim any score from any platform with fabricated proof.

**Impact:** Agents can instantly bootstrap to score 39 with zero real external reputation.

**Fix:** Already documented as planned (Innovation 4 in soma-trust-mining.md). Until then, consider disabling the endpoint or requiring admin approval.

### 2.3 Dead Agent Can Still Append to Pulse Tree

**File:** `soma-heartbeat.ts:188`

The `appendLeaf()` function has no check for agent death status. A dead agent (with a death certificate on the tree) can continue appending leaves, producing valid heartbeats and checkpoints after death.

**Impact:** Death certificates are unenforceable — zombie agents accumulate trust.

**Fix:** Add `isAgentDead(agentDid)` check at the top of `appendLeaf()` that queries for a `PULSE_TYPE.DEATH` leaf.

### 2.4 Burner Nonce Reuse After Revocation

**File:** `burner-agent.ts:124`

```typescript
const nonce = activeCount; // Simple incrementing nonce
```

Nonce is based on the count of **active** burners. After revoking burner #3 (active count drops to 2), the next burner gets nonce 2 — identical derivation path, identical keypair as the revoked one.

**Impact:** Revoked burner's keys are reborn in a new burner. If the revoked key was compromised, the new burner inherits the compromise.

**Fix:** Use a monotonic counter stored in DB (total ever created, not active count).

### 2.5 Bond Economics Dead Branch (Tier 3)

**File:** `bond-economics.ts:88`

```typescript
const bondAmount = round6(Math.max(creditsCost * 20, creditsCost * 0.1));
```

`creditsCost * 20` is always > `creditsCost * 0.1` for any positive value. The `0.1` branch never executes. The comment says "max(20x call cost, 10% of value)" — but both arms use `creditsCost`, not separate "call cost" vs "value at risk" variables.

**Fix:** Clarify intent. If "10% of value" means something different from call cost, use the correct variable.

### 2.6 LLM Pricing Prompt Has Wrong Credit-to-USD Ratio

**File:** `pricing.ts:463`

```typescript
parts.push(`...Each credit ≈ $0.0005 API cost.`);
```

System-wide rate is 1 credit = $0.001 (defined in `config/index.ts:65`, documented everywhere). The LLM sees $0.0005 — half the real price. This makes the LLM think budgets are 2x larger than they actually are, leading to plans that overspend.

**Fix:** Change to `$0.001`.

### 2.7 21 Concurrent Crons on Single Process

**File:** `index.ts:568-589`

21 `setInterval` timers + 4 additional `setInterval` calls elsewhere (MCP, XMTP, Telegram, keep-warm). All running on a single Node.js event loop on a VPS. No staggering, no jitter, no coordination.

**Impact:** Cron thundering herd — multiple crons fire simultaneously, compete for the single SQLite write connection. Under load this creates WAL checkpoint delays and GC pressure.

**Fix:** Add random jitter to intervals. Consider a lightweight job scheduler that serializes DB-heavy crons. Long-term: move infrequent crons to a separate process.

---

## 3. MEDIUM — Improve When Touching

### 3.1 `cache_access_log` Write Amplification

Every cache access (hit or miss) inserts a row into `cache_access_log`. On a busy day this table grows by tens of thousands of rows. The cleanup query uses a correlated subquery:

```sql
DELETE FROM cache_access_log WHERE rowid IN
  (SELECT rowid FROM cache_access_log WHERE created_at < ...)
```

**Fix:** Use direct `DELETE WHERE created_at < ?` (no subquery needed). Add `LIMIT` to batch deletes and avoid long write locks.

### 3.2 Soma Wallet Verification Uses Wrong Key Domain

**File:** `soma-wallet.ts`

The `verifyWalletBinding()` function verifies using the root public key but the signature is created with the domain-separated signing key (`deriveFromRoot(root, 'sign')`). Verification will always fail because the keys don't match.

**Fix:** Verify against the signing public key, not the root public key.

### 3.3 Conservation of Trust Only Applies to 1/6 Dimensions

The vouch graph implements conservation (COST_FACTOR=1.3, DECAY_FACTOR=0.6) — net trust destruction per vouch. But this only affects the "social" dimension (weight 0.10 in the oracle). The other 5 dimensions (reliability, economic, verification, longevity, consistency — 90% of the score) are earned freely with no conservation constraint.

**Impact:** Conservation is mostly cosmetic. An attacker can farm 90% of their trust score through dimensions that have no cost.

**Fix:** Either extend conservation to cover high-weight dimensions, or acknowledge this is by design and adjust the weights.

### 3.4 Circular Vouch Detection Only Catches Direct Reciprocals

**File:** `vouch-graph.ts`

The circular discount check only catches A→B→A. It misses A→B→C→A (3-node ring) or larger rings that launder trust at scale.

**Fix:** BFS/DFS cycle detection up to depth 3-4 before applying vouch.

### 3.5 Sybil Signal 30-Day Windows Are Gameable

**File:** `sybil-signal.ts`

All 4 sybil signals use `datetime('now', '-30 days')`. An attacker who spreads their Sybil activity evenly across 31+ days completely evades detection. The signals also have generous thresholds (counterparty concentration only triggers at >10 entries, feedback reciprocity only at >=3 feedback).

**Fix:** Use sliding windows of multiple durations (7d, 30d, 90d). Combine short-term spikes with long-term patterns.

### 3.6 `owner_key` Leaked in Logs

**File:** `trust-decay-cron.ts:107`

```typescript
ownerKey: agent.owner_key.slice(0, 8),
```

Uses `.slice()` instead of `maskApiKey()`. While `owner_key` is not directly an API key, using raw `.slice()` is inconsistent with the project's masking policy.

### 3.7 In-Memory State Not Recoverable

The pulse tree cache (`_treeCache` in soma-heartbeat.ts) and various module-level maps are lost on process restart. The trees are rebuilt from DB on next access, but any in-flight operations at crash time could leave inconsistent state between the tree peaks and leaf records.

**Fix:** Ensure tree reconstruction verifies leaf-to-peak consistency on load.

### 3.8 `trust-scoring-v2` and `trust-scoring-v11` Are Unreachable

Both files query the non-existent `owner_key` column and are likely dead code paths. If the main trust oracle has been updated to not use them, they should be removed. If they're intended to be active, they inherit the Critical 1.1 bug.

### 3.9 O(n) Cache Eviction

Cache eviction iterates all cached entries to find the least valuable one. As cache grows, this becomes a bottleneck during write operations.

**Fix:** Maintain a min-heap or sorted index by access time/value.

### 3.10 `Math.random()` in IDs

**File:** `trust-import.ts:108`

```typescript
const id = `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
```

`Math.random()` is not cryptographically secure. While these IDs aren't security tokens, using `nanoid()` (already a dependency, used everywhere else) would be consistent.

---

## 4. LOW — Note for Future

### 4.1 zauth Discovery Cron Hits 404

**File:** `core/zauth-discovery.ts`

Already documented in memory (`project_zauth_dead_code.md`). The cron runs every cycle, makes HTTP requests to zauthx402.com/api/* which returns 404. Wastes cycles and logs errors.

### 4.2 X402 USDC Per Credit Inconsistency

`x402-skills.ts:9` documents the rate as `$0.0005` while `config/index.ts:65` sets the default as `$0.001`. The x402 skills route may be using a different rate than the rest of the system.

### 4.3 `penalizeParent()` Logs But Doesn't Actually Penalize

**File:** `trust-delegation.ts:173-188`

The function logs a warning and creates an audit log entry, but never actually modifies the parent's trust score. The penalty amount is calculated but not applied to any database record.

### 4.4 Hardcoded Longevity Dimension Placeholder

**File:** `trust-oracle.ts`

The longevity dimension returns `0.5` as a placeholder for all agents (verified in prior audit). This means all agents get the same longevity score regardless of actual age.

---

## 5. Security Positives (What's Working Well)

These patterns are done right — don't regress:

- **Atomic credit deduction** — `deductCredit()` uses `UPDATE WHERE credits >= ?` (no read-then-write race)
- **Timing-safe API key comparison** — `timingSafeEqual` in auth middleware
- **Parameterized SQL everywhere** — no string interpolation in queries
- **`round6()` for all credit math** — consistent floating-point handling
- **Audit logging** — `logAudit()` calls on all sensitive operations
- **WAL mode SQLite** — concurrent reads don't block writes
- **Burner agent bond economics** — real Sybil resistance via credit cost
- **Checkpoint hash chains** — tamper-evident behavioral history (once success counting is fixed)
- **Nova IVC graceful degradation** — proof generation failures don't block operations
- **JCS canonical serialization** — deterministic JSON for signature inputs

---

## 6. Fix Priority Matrix

| # | Issue | Severity | Effort | Priority |
|---|-------|----------|--------|----------|
| 1.1 | `owner_key` column missing | CRITICAL | 2h | **P0** |
| 1.2 | Trust delegation fake signature | CRITICAL | 1h | **P0** |
| 1.3 | Checkpoint 100% success hardcode | CRITICAL | 2h | **P0** |
| 2.1 | `.slice()` instead of `maskApiKey()` | HIGH | 10min | **P1** |
| 2.6 | Wrong credit ratio in LLM prompt | HIGH | 5min | **P1** |
| 2.3 | Dead agent still appends leaves | HIGH | 30min | **P1** |
| 2.4 | Burner nonce reuse | HIGH | 30min | **P1** |
| 2.5 | Bond Tier 3 dead branch | HIGH | 15min | **P1** |
| 2.2 | Trust import unverified proof | HIGH | Design | **P2** |
| 2.7 | Cron thundering herd | HIGH | 2h | **P2** |
| 3.2 | Soma wallet wrong verification key | MEDIUM | 30min | **P2** |
| 3.3 | Conservation only 1/6 dimensions | MEDIUM | Design | **P2** |
| 3.1 | Cache log write amplification | MEDIUM | 1h | **P3** |
| 3.4 | Circular vouch depth-1 only | MEDIUM | 1h | **P3** |
| 3.5 | Sybil signal window gaming | MEDIUM | 2h | **P3** |
| 4.3 | `penalizeParent()` is a no-op | LOW | 30min | **P3** |
| 4.1 | zauth 404 cron | LOW | 10min | **P3** |

---

## 7. Architecture Notes

### Single-Process Sustainability

21 crons + HTTP server + MCP transports + bot integrations on one Node.js process is getting dense. Currently sustainable on the VPS, but approaching the point where a single runaway cron (e.g., cache warming doing 50+ HTTP calls) can starve the HTTP server's event loop.

**Recommendation:** Not urgent, but start planning for a worker process split (crons + bots in one process, HTTP in another). Both can share the same SQLite file via WAL.

### SQLite WAL Scalability

Current design is correct for single-VPS deployment. WAL handles concurrent reads well. The main risk is long-running write transactions (like bulk cache log cleanup) that delay WAL checkpoints. The `cache_access_log` cleanup (3.1) is the biggest offender.

### Trust System Coherence

The trust system has grown organically across multiple files (`trust-oracle.ts`, `trust-scoring-v2.ts`, `trust-scoring-v11.ts`, `trust-delegation.ts`, `trust-import.ts`, `trust-decay-cron.ts`, `vouch-graph.ts`, `sybil-signal.ts`). Several of these are unreachable due to the `owner_key` bug. Before fixing 1.1, audit which scoring paths are actually called from routes and deprecate dead ones.
