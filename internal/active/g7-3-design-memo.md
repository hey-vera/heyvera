# G7.3 Design Memo — Rotation Shadow-Check in Middleware

Date: 2026-04-18  
Status: pre-implementation decisions locked; write-up for PR author

---

## Verification baseline

| Claim | Evidence |
|---|---|
| G7.1 in main | `194811e feat(rotation): add inert ClawNetApiKeyBackend and soma-heart dep (#31)` |
| G7.2 in main | `5b09d36 feat(rotation): migration v2 + transactional adoption primitive (G7.2) (#43)` |
| `checkApiKey` shape | `src/middleware/auth.ts:5–21` — reads `env.API_KEYS`, splits on `,`, trims, filters empty; checks `X-API-Key` header; returns 401 on miss |
| `lookupByBearer` signature | `src/core/api-key-rotation.ts:629` — `lookupByBearer(bearer: string, now: number): { identityId: string; expiresAt: number } \| null` |

---

## File scope

**In scope for G7.3:**

- `src/middleware/auth.ts` — shadow-check branch added after the legacy accept/reject decision
- `src/config/index.ts` — one new env var: `ROTATION_SHADOW_CHECK_ENABLED`
- `src/core/api-key-rotation.ts` — no change; used as-is via the singleton
- New file: `src/core/rotation-backend.ts` — module-level singleton (`getRotationBackend()`)
- New test file: `tests/unit/api-key-rotation-middleware.test.ts` — shadow-check unit coverage including flag-off assertion

**Out of scope for G7.3 (tracked in ADR-0006 §4):**

- Authoritative cutover — legacy `api_keys` remains the only accepting/rejecting path
- Admin mint endpoint (`/v1/admin/rotation/*`)
- Wallet rotation (Phase D)
- Historical-lookup grace-window enforcement (`lookupHistoricalCredential`)
- Production rollout ceremony
- Snapshot persistence

---

## Five resolved decisions

### 1. Backend singleton — `getRotationBackend()`

A module-level singleton at `src/core/rotation-backend.ts`, same pattern as `getDb()` in `src/db/index.ts`.

```ts
// src/core/rotation-backend.ts
import { ClawNetApiKeyBackend } from './api-key-rotation';

let _backend: ClawNetApiKeyBackend | null = null;

export function getRotationBackend(): ClawNetApiKeyBackend {
  if (!_backend) _backend = new ClawNetApiKeyBackend();
  return _backend;
}
```

**Rationale:** G7.3 is the first runtime caller. G7.2's adoption wrapper (`rotation-adoption.ts`) allocates a fresh backend per call — harmless there because the `staged` map is irrelevant to adoption. On the hot auth path, allocating per-request is unsafe: two concurrent requests could share `staged` state invisibly. A module-level singleton serializes backend construction and matches the `getDb()` precedent already in the codebase. Carried from G7.2 review note 1.

### 2. Env-key skip

Before calling `lookupByBearer`, check whether the bearer is an env-configured key:

```ts
const envKeys = (env.API_KEYS ?? '')
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean);
if (envKeys.includes(bearer)) {
  logger.info({ shadowCheck: 'skipped' });
  return; // skip shadow-check entirely
}
```

This mirrors the exact split/trim/filter pattern in `checkApiKey` (auth.ts line 11). Env keys are never in the rotation backend; calling `lookupByBearer` on them would always produce a `notAdopted` metric that carries no signal.

### 3. Delegated-key skip

After the env-key check, consult the `delegated_keys` table:

```sql
SELECT 1 FROM delegated_keys WHERE key = ? LIMIT 1
```

If a row exists, log `{ shadowCheck: 'skipped' }` and return. Delegated keys are child scoped-keys issued by root `cn-` accounts; they live only in `delegated_keys`, never in `api_key_rotation_credentials`.

**Open question for PR review:** whether to do the DB lookup unconditionally or first sniff key format (delegated keys may have a distinguishable prefix). The DB lookup is a primary-key point read and adds ~0.1 ms; format sniffing is faster but brittle if the format ever changes. Leave the decision to the PR reviewer — document both options as a comment above the check in the PR.

### 4. Metrics — deferred to structured log only

No Prometheus/StatsD counter in G7.3. A single `logger.info` call with a `shadowCheck` field covers all outcomes:

| Outcome | `shadowCheck` value |
|---|---|
| Legacy accepted, rotation also accepted | `'match'` |
| Legacy accepted, rotation rejected / not-adopted | `'mismatch'` or `'notAdopted'` |
| Bearer not in rotation backend at all | `'notAdopted'` |
| Env-key or delegated-key bearer | `'skipped'` |
| Any thrown error inside the check | `'error'` |

Never log the bearer bytes. Log the outcome string only. A metric exporter can parse `shadowCheck` from structured logs post-G7.3 without touching the middleware again.

### 5. Kill-switch — `ROTATION_SHADOW_CHECK_ENABLED`

Add to `src/config/index.ts` inside `envSchema`:

```ts
ROTATION_SHADOW_CHECK_ENABLED: z.string().optional(),
```

Default absent = off. The middleware checks:

```ts
if (!env.ROTATION_SHADOW_CHECK_ENABLED) return; // zero rotation-backend calls
```

`z.string().optional()` (not `z.boolean()`) means the operator sets `ROTATION_SHADOW_CHECK_ENABLED=true` to enable and removes the var (or leaves it unset) to disable. Flipping the var takes effect at the next request boundary — no redeploy required. Carried from G7.2 review note 2 and ADR-0006 §7 requirement.

A test must assert that with the var absent, `lookupByBearer` is never called (spy/mock or log-capture).

---

## ADR-0006 §7 shadow-check checklist

To be verified during PR review before merge:

- [ ] **Read-only.** Shadow-check branch never writes to `api_key_rotation_*` tables or calls any mutating backend method.
- [ ] **Runs after legacy decision.** The shadow-check block executes inside `checkApiKey` only after `validKeys.includes(providedKey)` has already passed — never on a 401 path.
- [ ] **Counter metrics only; no bearer bytes logged.** `logger.info` carries `shadowCheck` string, not the bearer value.
- [ ] **Skips env keys.** `envKeys.includes(bearer)` check before any rotation call (Decision 2 above).
- [ ] **Skips delegated child keys.** `SELECT 1 FROM delegated_keys WHERE key = ? LIMIT 1` check (Decision 3 above).
- [ ] **Pure no-op when flag off.** `if (!env.ROTATION_SHADOW_CHECK_ENABLED) return` is the first statement in the shadow block. Zero rotation-backend calls with flag absent. Proven by unit test.
- [ ] **Kill-switchable without redeploy.** `ROTATION_SHADOW_CHECK_ENABLED` read from `env` per-request via the config singleton; removing the var from the environment stops the shadow check at the next request.

---

## Carried G7.2 review items — closure status

| Item | Status |
|---|---|
| Backend lifecycle: no per-request allocation | Closed by Decision 1 (`getRotationBackend()` singleton) |
| Default-off kill-switch is a real gate | Closed by Decision 5 (env var + zero-call assertion test) |
| `identityId` collision error type | Not in G7.3 scope — collision surfaces only if adoption retry is exposed to an operator. Track as post-G7.3 if adoption grows an operator-facing surface. |
