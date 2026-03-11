# Chunk 4 — Concurrency & Atomicity

## Audit Summary

After reading the actual code, every original finding was a false positive. The code handles concurrency correctly. One new real bug was found that the original audit missed.

---

### ✅ NOT A BUG — Escrow cron permanent lockout (4.1)
**File:** `src/core/escrow-cron.ts:22-59`

The audit claimed `_running = false` could be missed on throw. Reading the actual code:
```typescript
_running = true;
try {
  // work
} catch (err) {
  logger.error({ err }, 'Escrow expiry check failed');
} finally {
  _running = false;   // ← already in finally
}
```
`_running = false` is inside a `finally` block — it runs regardless of throw. No fix needed.

---

### ✅ NOT A BUG — Skill A/B cron non-atomic promotion (4.2)
**File:** `src/core/skill-ab-cron.ts:75-78`, `src/db/index.ts:1502-1527`

Both paths are atomic:
- **Discard path** (cron lines 75-78): `getDb().transaction(() => { both updates })()` ✓
- **Promote path**: calls `promoteChallenger()` which is wrapped in `db.transaction()` in db/index.ts ✓

Both operations are crash-safe — either all DB updates happen or none do.

---

### ✅ NOT A BUG — Stripe subscription TOCTOU (4.3)
Already cleared in Chunk 1 analysis. Single-process better-sqlite3 serializes the transaction. Safe.

---

### ✅ NOT A BUG — Escrow double-release (4.4)
**File:** `src/db/index.ts:1277-1294`

`releaseEscrow()` reads escrow state inside the transaction, then checks `canTransition(state, 'COMPLETED')`. If already COMPLETED, `canTransition()` returns false (COMPLETED has no valid next states). Since better-sqlite3 transactions are synchronous and serialized at the process level, a concurrent second call will see the updated state. Safe.

---

### ✅ NOT A BUG — Embeddings backoff counter (4.5)
**File:** `src/core/embeddings.ts:31`

`_failCount = 0` is already set on successful model load (line 31). The audit was wrong.

---

### ✅ NOT A BUG — Executor parallel group index mapping (4.7)
**File:** `src/core/executor.ts:234-249`

`group.map((indexStr) => executeStep(...))` creates promises in the same order as `group`. `Promise.allSettled()` preserves this order. `groupResults.forEach((result, i) => { const stepIndex = parseInt(group[i]) })` — position `i` in both arrays corresponds to the same step. Correct.

---

### ✅ NEW REAL BUG FOUND — Stake unlock silent credit loss
**File:** `src/core/stake-unlock-cron.ts:31-33`

```typescript
db.prepare(`UPDATE api_keys SET credits = credits + ? WHERE key = ?`)
  .run(stake.amount_credits, stake.agent_key);
db.prepare(`DELETE FROM stakes WHERE id = ?`).run(stake.id);
```

No check that the credit `UPDATE` affected any rows (`result.changes === 0`). If `agent_key` no longer exists in `api_keys` (deleted externally, or key deactivated and key value changed), the stake is deleted but credits are never restored. The user's staked credits disappear silently.

**Fix:** Check `result.changes`, log a CRITICAL warning if 0 (don't delete the stake — allow admin recovery).

---

## Fixes Implemented

### Fix A — Stake unlock silent credit loss (`src/core/stake-unlock-cron.ts`)
Added `result.changes` check after credit restoration. If the key doesn't exist, log CRITICAL and skip the DELETE (stake remains for admin recovery). If it succeeds, proceed with DELETE as before.
