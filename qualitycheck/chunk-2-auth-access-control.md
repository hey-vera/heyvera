# Chunk 2 — Auth & Access Control

## Audit Summary

After reading the actual code, here is the precise status of each finding:

---

### ✅ CONFIRMED BUG — Admin auth inconsistency in marketplace.ts
**File:** `src/routes/marketplace.ts:663-665`

The `PATCH /v1/admin/marketplace/skills/:id/feature` endpoint:
```typescript
const adminKey = c.req.header('X-Admin-Key') ?? c.req.header('X-API-Key');
if (!env.ADMIN_API_KEY || adminKey !== env.ADMIN_API_KEY) {
```

Two problems:
1. Accepts `X-API-Key` header as a fallback — any regular user API key could theoretically pass if it matched `ADMIN_API_KEY` (misconfiguration risk, semantically wrong)
2. Plain string comparison (`!==`) instead of timing-safe equal — susceptible to timing attacks

**Contrast:** `admin.ts` has `safeEqual()` using `crypto.timingSafeEqual()` via SHA-256 hash normalization, and `requireAdmin()` only checks `X-Admin-Key`. The marketplace admin endpoint is inconsistent with the rest.

**Fix:** Extract timing-safe admin check to a shared utility (`src/middleware/admin-auth.ts`). Use it in marketplace.ts. Remove `X-API-Key` fallback.

---

### ✅ CONFIRMED BUG — dashboard.ts duplicates maskApiKey() with a subtle defect
**File:** `src/routes/dashboard.ts:17-21`

Dashboard has its own local `maskApiKey()`:
```typescript
function maskApiKey(key: string): string {
  const prefix = 'cn-';
  const rest = key.startsWith(prefix) ? key.slice(prefix.length) : key;
  if (rest.length <= 8) return key;   // ← returns FULL key if short
  return prefix + rest.slice(0, 4) + '••••••••••••' + rest.slice(-4);
}
```

Line 20: `if (rest.length <= 8) return key` — returns the FULL UNMASKED KEY for short keys. In practice, all generated keys are 51 chars (`cn-` + 48 hex), so this never fires. But it's a latent bug: any non-standard key (legacy or admin-set) would be exposed.

Additionally, the output differs from `utils/mask.ts` (40 bullets vs 4 bullets) — inconsistent display across the product.

**Fix:** Delete the local function. Import `maskApiKey` from `../utils/mask`. Ensure `utils/mask.ts` handles the `cn-` prefix correctly (it currently doesn't strip it — just shows `cn12••••abcd` which is fine).

---

### ✅ CONFIRMED (LOW) — LLM model ID echoed in error
**File:** `src/routes/llm.ts:133`

```typescript
error: `Unknown model: ${model}`,
```

User-supplied `model` string echoed directly into JSON error response. No XSS risk in JSON context, but it's bad practice and leaks that the server validates against an internal list.

**Fix:** Return `'Unknown model'` without echoing the input.

---

### ✅ CONFIRMED (LOW) — Registry max limit 500
**File:** `src/routes/registry.ts:22`

`max(500)` allows returning all 163 endpoints in one request (~150KB JSON). Under API rate limiting this is fine, but it's wasteful.

**Fix:** Lower to `max(100)`.

---

### ✅ NOT A BUG — Clerk webhook free trial (2.2)
`FREE_TRIAL_CREDITS=0` default means the code path that grants free credits is completely skipped (`if (FREE_TRIAL_CREDITS <= 0) return`). Zero active risk. Note: if ever enabled, add a per-Clerk-org rate limit before enabling.

---

### ✅ NOT A BUG — MCP server rate limiting (2.3)
MCP server is a separate process that makes HTTP requests to the ClawNet API with the user's `CLAWNET_API_KEY`. All calls flow through the existing `RATE_LIMIT_PER_MIN=60` middleware and per-key credit deduction. The server itself doesn't need additional rate limiting.

---

### ✅ NOT A BUG — Dashboard claim-session brute force (2.4)
`claim-session` requires `requireClerkAuth` (valid Clerk JWT). An attacker must already be authenticated. Session IDs are randomly generated cryptographic tokens — brute-forcing the 256-bit space is not computationally feasible.

---

## Fixes Implemented

### Fix A — Shared admin auth utility (`src/middleware/admin-auth.ts`)
New file with `requireAdmin(c)` — timing-safe SHA-256 normalized comparison, `X-Admin-Key` only.

### Fix B — marketplace.ts uses shared requireAdmin
Remove `X-API-Key` fallback, replace with `requireAdmin(c)` import.

### Fix C — dashboard.ts removes local maskApiKey
Delete local function. Import from `../utils/mask`. Remove the latent short-key exposure.

### Fix D — llm.ts generic model error message
`'Unknown model'` without echoing user input.

### Fix E — registry.ts max limit 100
`.max(500)` → `.max(100)`.
