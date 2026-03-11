# Chunk 1 — Financial Integrity

## Audit Summary

After reading the actual code, here is the precise status of each finding:

---

### ✅ CONFIRMED BUG — Treasury silent loss
**File:** `src/db/index.ts:1654-1656`

The seller credit at line 1649 correctly checks `sellerResult.changes === 0` and throws. The treasury credit at line 1655 has NO such check — if `clawhub-treasury` is inactive or missing, the platform silently loses 3% of every third-party sale.

**Fix:** Add `result.changes` check matching the seller pattern. Throw inside the transaction so the entire purchase rolls back.

---

### ✅ CONFIRMED BUG — marketplaceRefund swallows errors
**File:** `src/db/index.ts:1716-1718`

```typescript
} catch {
  return { ok: false };   // ← no error message, no logging
}
```

When the refund transaction fails (DB error, treasury key missing), there is zero logging and no error message returned. Debugging a refund failure in production is impossible.

**Fix:** Log the error at CRITICAL level. Return `(err as Error).message`. Update the return type to include `error?: string`.

---

### ✅ CONFIRMED BUG — Misleading refund error message
**File:** `src/routes/marketplace.ts:305-309`

The error message hardcodes `'Skill execution failed. Payment has been refunded.'` even when `refund.ok === false`. A user whose refund silently failed sees a message saying they were refunded — then discovers they weren't. Additionally, a failed refund should log at CRITICAL and alert admin.

**Fix:** Conditionally set error message based on `refund.ok`. Log CRITICAL when `refund.ok === false`.

---

### ✅ NOT A BUG — Stripe pre-flight idempotency (1.2)
**File:** `src/routes/stripe.ts:253-284`

The pre-flight `isStripeEventProcessed()` at line 253 is an optimization. Inside the transaction (line 279), the `INSERT OR IGNORE` + `claimed.changes === 0` check is the real guard. Since better-sqlite3 is synchronous and single-process, transactions are serialized — two concurrent requests will serialize at the transaction boundary, the second getting `claimed.changes === 0` and returning null. **Safe for single-process deployment.** If ever scaled to multiple processes, this becomes a real race condition. Noted for future.

---

### ✅ NOT A BUG — Solana atomicity (1.3)
**File:** `src/routes/solana.ts`

The implementation is correct:
1. `tryClaimSolanaSignature()` atomically claims the signature BEFORE any async work
2. `releaseClaimSolanaSignature()` is called on every non-success path (lines 124, 129, 172, 179)
3. Credit grant is in a `getDb().transaction()` at line 193

There is a theoretical crash window between on-chain verification passing and the DB transaction completing (~microseconds), which would leave the signature claimed but credits not granted. In practice, this requires a process crash at exactly that moment. If it happens, support can manually delete the signature row to allow retry. **Not worth adding complexity — document the recovery procedure.**

---

### ✅ NOT A BUG — Batch partial billing (1.6)
**File:** `src/routes/batch.ts:99-144`

The batch route already does an upfront estimate and credit check (lines 102-120) before execution. Per-query deduction at line 136 is based on actual cost. If actual cost exceeds estimate (which can happen when endpoints have different costs than estimated), a mid-batch query might fail with "Insufficient credits." This is an edge case, not a financial integrity bug. The estimate check prevents the common case of "user can't afford the batch at all." **Low priority — note in UX improvements.**

---

### ✅ NOT A BUG — Revenue share ambiguity (1.7)

Author always earns `credit_cost - 3%`. Charging `MAX(actualCost, skill.credit_cost)` means authors earn based on their listed price, not cost-to-serve. This is intentional marketplace pricing. **Policy documented, no fix needed.**

---

## Fixes Implemented

### Fix A — Treasury validation in `marketplacePurchase()` (`src/db/index.ts`)

Changed treasury credit block to capture result and throw on `changes === 0`, matching the seller pattern.

### Fix B — Error logging and propagation in `marketplaceRefund()` (`src/db/index.ts`)

Added `logger.error(...)` in the catch block. Changed return type to `{ ok: boolean; refundTxId?: string; error?: string }`. Returns `(err as Error).message`.

### Fix C — Honest error message in marketplace purchase route (`src/routes/marketplace.ts`)

Error message now reflects actual refund outcome. Logs CRITICAL when refund fails after execution failure.
