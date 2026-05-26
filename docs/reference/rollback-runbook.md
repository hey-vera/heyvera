# Rollback Runbook

Procedures for recovering from a bad deploy, bad migration, or feature emergency.

---

## 1. Rollback a Bad Deploy

### Revert to the previous commit

```bash
# Find the last known-good commit
git log --oneline -10

# Revert to it (creates a new commit — safe for CI)
git revert HEAD --no-edit

# Or hard-reset to a specific SHA (only for emergency hotfix branches, not main)
git reset --hard <last-known-good-sha>

# Push the fix
git push origin main
```

Cloudflare Pages auto-deploys on every push to `main`. Once the push lands, the deploy triggers automatically — typically within 2 minutes.

### Rollback to a specific Cloudflare Pages deployment

1. Open the [Cloudflare Pages dashboard](https://dash.cloudflare.com) → heyvera.org → Deployments.
2. Find the last successful deployment.
3. Click the `...` menu → **Rollback to this deployment**.

This promotes the old build without requiring a git push. The live site updates immediately.

---

## 2. Rollback a Bad Migration (SQLite)

All migrations are additive by design (add columns, add tables). However, if a migration introduced bad data or a schema problem:

### Pre-deploy backup (standard procedure)

Before any deployment that includes a migration, take a snapshot of the DB file:

```bash
# On the server (or via SSH/Replit shell):
cp /data/cortex.db /data/cortex.db.backup-$(date +%Y%m%d-%H%M%S)
```

### Restore from backup

```bash
# Stop the server first (or it will hold a write lock)
systemctl stop cortex-api   # or kill the Replit process

# Restore
cp /data/cortex.db.backup-20241201-120000 /data/cortex.db

# Restart
systemctl start cortex-api
```

### Undo an additive column (ALTER TABLE ADD COLUMN)

SQLite does not support `DROP COLUMN` in versions below 3.35. For modern SQLite:

```sql
-- Connect via sqlite3
sqlite3 /data/cortex.db

-- Check the version
SELECT sqlite_version();

-- For SQLite >= 3.35:
ALTER TABLE social_posts DROP COLUMN deleted_at;

-- For older SQLite, you must recreate the table (backup first).
```

In practice, leaving an unused column is safer than a live schema mutation. Coordinate with the on-call engineer before attempting.

---

## 3. Disable Features via Environment Flags

The backend respects these environment variables for graceful feature control. Set them in the Replit Secrets panel or deployment config and restart the process.

| Variable | Default | Purpose |
|---|---|---|
| `CORTEX_JSON_LOGS` | `false` | `true` = JSON structured logs (production) |
| `CORTEX_BILLING_ENFORCED` | `false` | `true` = hard-block users over usage limits |
| `CORTEX_FREE_DAILY_COST_LIMIT` | `2.0` | Free-tier daily cost cap (USD) |
| `CORTEX_FREE_DAILY_STEP_LIMIT` | `20` | Free-tier daily step cap |
| `CORTEX_FREE_MONTHLY_COST_LIMIT` | `20.0` | Free-tier monthly cost cap (USD) |
| `CORTEX_ALLOWED_ORIGINS` | (permissive) | Comma-separated CORS origin allowlist |
| `CLERK_SECRET_KEY` | (none) | Remove to disable auth entirely (dev only) |

To disable billing enforcement immediately:

```bash
# Unset or set to false
CORTEX_BILLING_ENFORCED=false
# Then restart the API process
```

---

## 4. Incident Response

### Escalation steps

1. **Detect** — Alert fires (PagerDuty/Uptime Robot) or user report lands in #ops.
2. **Triage** — Check `/v1/health` and `/v1/ready`. Determine blast radius: one user, one feature, or all users?
3. **Fix** — Apply the matching remediation below. Prefer reversible actions first (feature flag, rollback) over surgery.
4. **Verify** — Confirm the fix with the verification steps for that scenario. Check `/v1/health` returns `200`.
5. **Postmortem** — Post a brief summary to #ops: what broke, when, why, and what changes to prevent recurrence.

---

### Common failure scenarios

#### DB corruption (SQLite WAL issues, locked database)

**Symptoms:** API returns `500` on any write endpoint; logs show `database is locked`, `disk I/O error`, or `SQLITE_CORRUPT`; WAL file unusually large.

**Diagnosis:**
```bash
# Check WAL size (healthy: <100MB; bloated: multiple GB)
ls -lh /home/deploy/cortex-data/cortex.db-wal

# Integrity check (safe read-only operation)
sqlite3 /home/deploy/cortex-data/cortex.db "PRAGMA integrity_check;"

# Look for lock holder
lsof /home/deploy/cortex-data/cortex.db
```

**Remediation:**
```bash
# 1. Stop the server to release locks
systemctl stop cortex-api

# 2. Checkpoint the WAL back into the main db (if db is intact)
sqlite3 /home/deploy/cortex-data/cortex.db "PRAGMA wal_checkpoint(TRUNCATE);"

# 3. If integrity_check reports errors, restore from last backup:
cp /home/deploy/cortex-data/cortex.db /home/deploy/cortex-data/cortex.db.corrupted-$(date +%Y%m%d-%H%M%S)
gunzip -c /home/deploy/cortex-data/backups/cortex-<LATEST>.db.gz > /home/deploy/cortex-data/cortex.db

# 4. Restart
systemctl start cortex-api
```

**Verify:** `curl http://localhost:3402/v1/health` returns `200`; write a test record via API.

---

#### Auth outage (Clerk down, JWKS cache expired)

**Symptoms:** All authenticated requests return `401`; logs show `Failed to fetch JWKS`, `JWT verification failed`, or `clock skew too large`.

**Diagnosis:**
```bash
# Check Clerk status
curl -s https://status.clerk.com/api/v2/summary.json | jq '.status.description'

# Check if JWKS endpoint is reachable from the server
curl -v https://<your-clerk-frontend-api>/.well-known/jwks.json

# Check server clock drift (Clerk rejects tokens >5 min skew)
date -u && curl -sI https://api.clerk.com | grep -i date
```

**Remediation:**
- **Clerk is down:** No code fix possible. Monitor [status.clerk.com](https://status.clerk.com). Set `CLERK_SECRET_KEY` to empty to disable auth enforcement in dev; do not do this in production. ETA: Clerk SLA is 99.9%.
- **JWKS cache expired:** Restart the API process to force a fresh JWKS fetch. The backend caches JWKS on startup.
- **Clock skew:** Sync NTP: `sudo timedatectl set-ntp true && sudo timedatectl`.

**Verify:** A valid Clerk JWT returns `200` from a protected endpoint.

---

#### Storage failure (R2/S3 unreachable, presigned URLs failing)

**Symptoms:** File uploads/downloads return `5xx`; presigned URLs return `403` or `RequestExpired`; logs show `connection refused` or `timeout` to storage endpoint.

**Diagnosis:**
```bash
# Confirm R2/S3 reachability
curl -I https://<account-id>.r2.cloudflarestorage.com

# Check presigned URL expiry config (default should be 3600s)
grep -r "presigned\|expires_in" crates/

# Confirm credentials are still valid
aws s3 ls s3://<bucket>/ --no-sign-request   # or with credentials
```

**Remediation:**
- **R2/S3 provider outage:** Monitor [Cloudflare status](https://www.cloudflarestatus.com) / AWS status. No code fix; serve cached content where possible.
- **Expired presigned URLs:** These are time-limited by design. Re-request a fresh presigned URL from the API. If the API itself can't generate them (bad credentials), rotate the R2/S3 API token in the Replit Secrets panel and restart.
- **CORS misconfiguration:** Check the bucket CORS policy allows the heyvera.org origin for `GET`/`PUT`.

**Verify:** Upload a test file and confirm the presigned GET URL returns `200`.

---

#### Rate limiter exhaustion (legitimate traffic spike)

**Symptoms:** Users see `429 Too Many Requests`; logs show rate limit hits across many distinct IPs; traffic spike visible in Cloudflare analytics.

**Diagnosis:**
```bash
# Count 429s in last 10 minutes
grep "429\|rate.limit" /var/log/cortex-api.log | tail -200

# Check if it's one IP or distributed (bot vs. real spike)
grep "429" /var/log/cortex-api.log | awk '{print $5}' | sort | uniq -c | sort -rn | head -20
```

**Remediation:**
- **Legitimate spike (launch, press, viral):** Temporarily raise rate limits via env vars and restart. Coordinate with @steve before changing production limits.
- **Bot/scraper:** Block offending IP ranges at the Cloudflare WAF level (no code deploy needed).
- **Misconfigured limits:** If the limit is set too low by mistake, fix the env var and restart.

**Verify:** Spot-check that normal user requests succeed; confirm `/v1/health` returns `200`.

---

#### Backend crash loop (OOM, panic, migration failure)

**Symptoms:** Process exits repeatedly; systemd shows `Active: activating (auto-restart)`; logs end abruptly with `SIGSEGV`, `thread 'main' panicked`, `OOM`, or a migration error.

**Diagnosis:**
```bash
# Check recent exits
journalctl -u cortex-api -n 100 --no-pager

# Confirm OOM kill
dmesg | grep -i "killed process" | tail -5

# Check last migration applied
sqlite3 /home/deploy/cortex-data/cortex.db "SELECT * FROM _sqlx_migrations ORDER BY installed_on DESC LIMIT 5;"
```

**Remediation:**
- **OOM:** Increase the server's memory limit or identify the leaking endpoint. As a stop-gap, `CORTEX_FREE_DAILY_STEP_LIMIT` can reduce workload. Restart the process.
- **Panic (Rust):** The panic message in logs points to the exact file/line. If it's reproducible, revert to the last known-good commit and push. If it's a one-off, restart.
- **Migration failure:** The migration that failed will be logged by name. Do NOT re-run automatically — inspect the migration SQL, fix the data or schema manually, then mark it applied:
  ```sql
  -- Only after manually applying the SQL:
  INSERT INTO _sqlx_migrations (version, description, installed_on, success, checksum, execution_time)
  VALUES (<version>, '<desc>', datetime('now'), 1, X'<checksum>', 0);
  ```
  Or restore from the pre-migration backup (safest option).

**Verify:** Process stays up for 5+ minutes with no restarts; `curl http://localhost:3402/v1/health` returns `200`; check `journalctl -u cortex-api -f` for stability.

---

## 5. Emergency Contacts / Escalation

| Level | Contact | When |
|---|---|---|
| On-call engineer | Check the #ops Slack channel | Any production incident |
| Database emergency | @platform-team | Data loss, corruption, or migration failure |
| Billing/Stripe issues | Stripe dashboard + @steve | Payment processing failures |
| Auth (Clerk) outage | [Clerk status page](https://status.clerk.com) | Auth failures across all users |

### Incident checklist

1. Confirm the scope — is it one user, a feature, or all users?
2. Check `/v1/health` and `/v1/ready` endpoints first.
3. Check Cloudflare Pages build logs for deploy errors.
4. Check the server logs: `RUST_LOG=debug` + `CORTEX_JSON_LOGS=true`.
5. If a bad migration: stop writes, backup DB, then restore.
6. If a bad code deploy: revert git commit and push, or rollback via Cloudflare dashboard.
7. Post a brief incident summary to #ops after resolution.
