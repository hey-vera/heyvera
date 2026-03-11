# Chunk 3 — Database & Performance

## Audit Summary

After reading the actual code, here is the precise status of each finding:

---

### ✅ CONFIRMED CRITICAL — Column name mismatch in cleanupOldSkillMetrics()
**File:** `src/db/index.ts:2222`

Table definition (line 217): column is `timestamp TEXT NOT NULL DEFAULT (datetime('now'))`
Cleanup query (line 2222): `WHERE recorded_at < datetime('now', '-' || ? || ' days')`

`recorded_at` does not exist — the column is `timestamp`. SQLite silently returns 0 rows deleted on an unknown column in a WHERE clause. The retention cron calls this daily and logs `cleanedSkillMetrics: 0` every time, but the table keeps growing.

**Impact:** `skill_metrics` is written on every skill invocation. With active usage, this table will grow to millions of rows. At scale, the indexes on `(skill_id)` and `(skill_id, version)` will slow to a crawl, and daily cleanup cron log output is silently wrong (0 rows deleted, never alarming anyone).

**Fix:** `recorded_at` → `timestamp` on line 2222.

---

### ✅ CONFIRMED — Missing index on skill_metrics(timestamp)
**File:** `src/db/index.ts:220-222`

Existing indexes: `idx_skill_metrics_skill ON skill_metrics(skill_id)` and `idx_skill_metrics_version ON skill_metrics(skill_id, version)`. No index on `timestamp`.

Cleanup query is `DELETE FROM skill_metrics WHERE timestamp < ?` — full table scan on potentially millions of rows. SQLite will lock the table for the entire duration.

**Fix:** Add `CREATE INDEX idx_skill_metrics_timestamp ON skill_metrics(timestamp)` in migration v38.

---

### ✅ CONFIRMED — Missing index on audit_log(timestamp)
**File:** `src/db/index.ts:279`

Existing index: `idx_audit_log_entity ON audit_log(entity_type, entity_id)`. No index on `timestamp`.

`cleanupOldAuditLogs()` does `DELETE FROM audit_log WHERE timestamp < ?` — full table scan. `audit_log` is written on every significant admin/financial action. Could be millions of rows at scale.

**Fix:** Add `CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp)` in migration v38.

---

### ✅ CONFIRMED — Missing index on solana_processed_sigs(processed_at)
**File:** `src/db/index.ts:124-127`

`solana_processed_sigs` has a `processed_at TEXT` column (line 126). Cleanup at line 2229: `WHERE processed_at < ?` — no index on this column.

Table stays small (one row per USDC payment), so full-scan cost is low today. Still worth indexing for consistency and future-proofing.

**Fix:** Add `CREATE INDEX idx_solana_sigs_processed_at ON solana_processed_sigs(processed_at)` in migration v38.

---

### ✅ NOT A BUG — endpoint_health primary key (3.5)
**File:** `src/db/index.ts:409-419`

Migration v29 creates `endpoint_health` with `endpoint_id TEXT PRIMARY KEY` — duplicates are prevented by the DB constraint. The upsert uses `INSERT OR REPLACE` which is idempotent. No issue.

---

### ✅ NOT A BUG — Stale synthesis cache after skill update (3.6)
**File:** `src/core/formatter.ts`, `src/core/seed-skills.ts`

Synthesis cache TTL is only 10 minutes. Official skills only change on server boot (seed pass), not mid-runtime. At most, users see a 10-minute stale analysis after a skill prompt update — and only if they hit the same query. The complexity of embedding skill version in the synthesis cache key is not justified for a 10-min TTL.

---

## Fixes Implemented

### Fix A — Column name bug in cleanupOldSkillMetrics() (`src/db/index.ts:2222`)
Changed `recorded_at` → `timestamp`. Cleanup now actually deletes old rows.

### Fix B — Migration v38: three cleanup indexes (`src/db/index.ts`)
Added indexes on timestamp columns used by all three cleanup functions:
- `idx_skill_metrics_timestamp ON skill_metrics(timestamp)`
- `idx_audit_log_timestamp ON audit_log(timestamp)`
- `idx_solana_sigs_processed_at ON solana_processed_sigs(processed_at)`

These allow DELETE cleanup queries to use index scans instead of full table scans.
