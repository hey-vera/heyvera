# Shadow-Check Enable Runbook

Status: canonical
Related: ADR-0006 §7, `docs/proposals/shadow-check-enable.md`

Enables `ROTATION_SHADOW_CHECK_ENABLED` in production to collect match/mismatch
counter data without affecting traffic semantics.

---

## 1. Pre-Enable Checklist

Run all checks before touching the env file.

**1.1 — Verify G7.3 commit is deployed**

```bash
ssh guardian-vps
cd ~/claw-net
git log --oneline -5
# Must see: f0344f5 feat: rotation shadow-check middleware (or the merge commit)
```

**1.2 — Verify CI is green**

Check https://github.com/claw-net/claw-net/actions — `main` branch must be green.

**1.3 — Verify at least one adoption row exists**

```bash
docker compose exec orchestrator node -e "
  const Database = require('better-sqlite3');
  const db = new Database('/app/data/orchestrator.db', { readonly: true });
  const row = db.prepare('SELECT count(*) AS n FROM api_key_rotation_adoption').get();
  console.log('adoption rows:', row.n);
  db.close();
"
# Must be >= 1
```

If zero rows: insert a test adoption row for a known key before continuing.

**1.4 — Verify baseline has zero shadow-check log entries**

```bash
docker compose logs orchestrator | grep shadowCheck
# Must be empty
```

**1.5 — Kill-switch smoke test**

```bash
# Temporarily enable
echo 'ROTATION_SHADOW_CHECK_ENABLED=true' >> ~/claw-net/.env
docker compose up -d --no-build

# Make one request
curl -sS https://api.claw-net.org/v1/orchestrate -H 'X-API-Key: <test-key>'

# Confirm log entry appears
docker compose logs --tail=20 orchestrator | grep shadowCheck

# Disable again
sed -i '/ROTATION_SHADOW_CHECK_ENABLED/d' ~/claw-net/.env
docker compose up -d --no-build

# Confirm log entries stop
curl -sS https://api.claw-net.org/v1/orchestrate -H 'X-API-Key: <test-key>'
docker compose logs --tail=10 orchestrator | grep shadowCheck   # should be empty for the new request
```

If the kill-switch smoke test fails, stop here. Do not proceed.

**1.6 — Run adoption script**

```bash
docker compose exec orchestrator npx tsx scripts/adopt-legacy-keys.ts
```

All cn- keys in the `api_keys` table should show `adopt` or `idem` (idempotent).
If any errors appear, investigate before proceeding.

---

## 2. Enable Procedure

```bash
ssh guardian-vps

# Add the var to the env file (use the preferred path if set up)
echo 'ROTATION_SHADOW_CHECK_ENABLED=true' >> /home/guardian/claw-net/.env
# or: echo 'ROTATION_SHADOW_CHECK_ENABLED=true' >> /etc/claw-net/claw-net.env

# Recreate container (picks up env change, zero-downtime)
cd ~/claw-net
docker compose up -d --no-build

# Verify the API is up
curl -sS https://api.claw-net.org/v1/health | grep -i ok

# Make a test request and confirm shadow-check fires
curl -sS https://api.claw-net.org/v1/orchestrate -H 'X-API-Key: <test-key>'
docker compose logs --tail=20 orchestrator | grep shadowCheck
# Expect: {"shadowCheck":"match"} or {"shadowCheck":"notAdopted"}
```

---

## 3. What to Watch (Log Queries)

Run these periodically after enabling.

```bash
# Match count (bearer found in rotation backend)
docker compose logs orchestrator | grep '"shadowCheck":"match"' | wc -l

# NotAdopted count (bearer not yet adopted — expected for unadopted keys)
docker compose logs orchestrator | grep '"shadowCheck":"notAdopted"' | wc -l

# Skip count (env key or delegated key — expected and healthy)
docker compose logs orchestrator | grep '"shadowCheck":"skipped"' | wc -l

# Error count (rotation backend threw — should be zero)
docker compose logs orchestrator | grep '"shadowCheck":"error"' | wc -l
```

**Interpretation:**
- `error` > 0: rotation backend has runtime issues — investigate immediately.
- `match` = 100 % for adopted test keys: rotation backend is resolving correctly.
- `notAdopted`: expected for keys not yet migrated.
- `skipped`: expected and healthy — env keys and delegated keys always skip.

---

## 4. Kill-Switch Procedure

Use any time you want to disable without a full redeploy.

```bash
ssh guardian-vps

# Remove the var from the env file
sed -i '/ROTATION_SHADOW_CHECK_ENABLED/d' /home/guardian/claw-net/.env
# or from /etc/claw-net/claw-net.env if that's the active file

# Recreate container
cd ~/claw-net
docker compose up -d --no-build

# Confirm: subsequent requests produce no shadow-check log entries
curl -sS https://api.claw-net.org/v1/orchestrate -H 'X-API-Key: <test-key>'
docker compose logs --tail=10 orchestrator | grep shadowCheck   # must be empty
```

No code redeploy required.

---

## 5. Go/No-Go Criteria for Leaving Enabled

Evaluate after 7 days of data.

| Signal | Criterion | Action if failed |
|--------|-----------|------------------|
| Error rate | Zero `shadowCheck: 'error'` entries | Kill-switch, investigate rotation backend |
| Match rate | 100 % for all adopted test keys | Bug — investigate before any cutover work |
| Latency | No observable degradation in request times | Kill-switch, profile middleware |
| Mismatch | No adopted key producing `notAdopted` | Bug — investigate adoption row |

All four must pass to consider the data sufficient for a cutover proposal.

---

## 6. What the Counter Data Tells You

After 7+ clean days:

- **match = 100 % for adopted keys:** rotation backend resolves the same bearers the legacy path accepts. This is necessary (not sufficient) evidence for cutover.
- **notAdopted for an adopted key:** adoption row is missing or stale — fix the adoption record, not the middleware.
- **error > 0:** rotation backend has runtime issues — fix before any cutover work begins.
- **high skip rate:** healthy — env keys and delegated keys are correctly excluded from the rotation path.

To initiate cutover, open a new proposal. This runbook covers data collection only.
