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

## 4. Emergency Contacts / Escalation

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
