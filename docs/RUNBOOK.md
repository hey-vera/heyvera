# ClawNet Runbook

Operations reference for on-call and production incidents.

---

## Table of Contents
1. [SQLite Lock / Database Busy](#1-sqlite-lock--database-busy)
2. [Mesh Node Crash / P2P Failure](#2-mesh-node-crash--p2p-failure)
3. [Escrow Timeout / Stuck Escrow](#3-escrow-timeout--stuck-escrow)
4. [API Server Unresponsive](#4-api-server-unresponsive)
5. [Redis Down / Cache Miss Storm](#5-redis-down--cache-miss-storm)
6. [High Credit Deduction Failures](#6-high-credit-deduction-failures)
7. [Stripe / Solana Webhook Failures](#7-stripe--solana-webhook-failures)
8. [Disk Full](#8-disk-full)
9. [Database Restore From Backup](#9-database-restore-from-backup)
10. [Verify Production Mode (Not Simulation)](#10-verify-production-mode-not-simulation)
11. [Credit Accounting Drift](#11-credit-accounting-drift)

---

## 1. SQLite Lock / Database Busy

**Symptom:** API returns 500 errors; logs show `SQLITE_BUSY` or `database is locked`.

**Why it happens:** WAL mode handles most concurrency, but a long-running read transaction or a stuck process holding a write lock can block writes.

### Diagnosis
```bash
# SSH into VPS
ssh guardian-vps

# Check open file handles on the DB
lsof | grep orchestrator.db

# Check WAL file size — if huge, a checkpoint is overdue
ls -lh ~/claw-net/data/orchestrator.db*

# Recent error logs
docker compose logs --tail=100 api | grep -i "sqlite\|busy\|lock"
```

### Resolution

**Option A — Restart API container (safest, < 5s downtime):**
```bash
cd ~/claw-net
docker compose restart api
```
Restarting closes all DB connections; SQLite will auto-checkpoint the WAL on next open.

**Option B — Force WAL checkpoint without restart:**
```bash
docker compose exec api node -e "
  const Database = require('better-sqlite3');
  const db = new Database('/app/data/orchestrator.db');
  db.pragma('wal_checkpoint(TRUNCATE)');
  console.log('Checkpoint done');
  db.close();
"
```

**Option C — If a zombie process holds the lock:**
```bash
lsof | grep orchestrator.db   # find the PID
kill -9 <PID>
docker compose restart api
```

### Prevention
- The app runs `PRAGMA journal_mode = WAL` on startup — do not change this.
- Never run raw `sqlite3` CLI against the live DB while the API is running.
- Schedule periodic checkpoints via cron if WAL grows > 100 MB.

---

## 2. Mesh Node Crash / P2P Failure

**Symptom:** `GET /v1/mesh/peers` returns `{ nodeId: null }`. Logs show `Mesh node stopped` or libp2p errors.

**Why it happens:** libp2p can crash on bad peer data, port conflicts, or upstream library bugs. The graceful-shutdown hook sets `node = null` on any unhandled rejection.

### Diagnosis
```bash
docker compose logs --tail=50 api | grep -i "mesh\|libp2p\|peer"

# Check TCP port 4001
ss -tlnp | grep 4001
```

### Resolution

**Restart the API** — `startMeshNode()` is called in the startup sequence:
```bash
cd ~/claw-net
docker compose restart api
```

**If port 4001 is already in use:**
```bash
ss -tlnp | grep 4001          # find PID
kill -9 <PID>
docker compose restart api
```

**If the mesh keeps crashing (persistent libp2p bug):**
Disable the mesh node temporarily by setting `MESH_DISABLED=true` in `.env`:
```bash
echo 'MESH_DISABLED=true' >> ~/claw-net/.env
docker compose restart api
```
Then add a guard in `src/index.ts`:
```typescript
if (!process.env.MESH_DISABLED) await startMeshNode();
```
Open a GitHub issue to track the libp2p bug before re-enabling.

**Open firewall port** (if not already done after deploy):
```bash
sudo ufw allow 4001/tcp
sudo ufw status
```

---

## 3. Escrow Timeout / Stuck Escrow

**Symptom:** An escrow is in `FUNDED` or `WORK_IN_PROGRESS` state past its deadline with no action from either party.

**Why it happens:** No automatic timeout job runs yet — escrows stay open until a party acts or an admin intervenes.

### Finding stuck escrows

```bash
docker compose exec api node -e "
  const Database = require('better-sqlite3');
  const db = new Database('/app/data/orchestrator.db', { readonly: true });
  const stuck = db.prepare(\`
    SELECT id, hirer_id, worker_id, amount_credits, state, created_at, deadline
    FROM escrows
    WHERE state IN ('FUNDED','WORK_IN_PROGRESS')
      AND (deadline IS NULL OR deadline < datetime('now'))
    ORDER BY created_at ASC
  \`).all();
  console.log(JSON.stringify(stuck, null, 2));
  db.close();
"
```

### Resolution options

**A — Refund hirer (escrow expired, no work delivered):**
```bash
curl -X POST https://api.claw-net.org/v1/escrow/<ID>/refund \
  -H "Authorization: Bearer <ADMIN_KEY>"
```

**B — Force-resolve via SQL (last resort, log it):**
```bash
docker compose exec api node -e "
  const Database = require('better-sqlite3');
  const db = new Database('/app/data/orchestrator.db');
  // Refund to hirer
  db.transaction(() => {
    const esc = db.prepare('SELECT * FROM escrows WHERE id = ?').get('<ID>');
    db.prepare('UPDATE api_keys SET credits = credits + ? WHERE clerk_user_id = ?')
      .run(esc.amount_credits, esc.hirer_id);
    db.prepare(\"UPDATE escrows SET state = 'REFUNDED', completed_at = datetime('now') WHERE id = ?\")
      .run('<ID>');
  })();
  console.log('Refunded');
  db.close();
"
```

**Document it:** Log the escrow ID, reason, and action taken in `docs/incident-log.md`.

### Prevention
Add a cron job to auto-refund expired escrows (add to roadmap Chunk 15+):
```sql
UPDATE escrows
SET state = 'REFUNDED'
WHERE state = 'FUNDED'
  AND deadline < datetime('now');
```

---

## 4. API Server Unresponsive

**Symptom:** UptimeRobot alerts on `/v1/health`; all requests time out.

### Diagnosis
```bash
ssh guardian-vps
docker compose ps          # check container status
docker compose logs --tail=50 api
```

### Resolution

**Container crashed — restart:**
```bash
cd ~/claw-net
docker compose up -d api
```

**OOM killed** (check `docker inspect`):
```bash
docker inspect claw-net-api-1 | grep -A5 OOMKilled
# If true:
docker stats --no-stream      # check memory usage
# Consider adding swap or upgrading VPS
```

**Stuck process — full restart:**
```bash
docker compose down
docker compose up -d
```

---

## 5. Redis Down / Cache Miss Storm

**Symptom:** API is slow but not down; logs show `Redis connection refused` or `ECONNREFUSED`.

### Diagnosis
```bash
docker compose ps redis
docker compose logs redis --tail=20
```

### Resolution
```bash
docker compose restart redis
```

The app handles Redis failures gracefully — it falls through to SQLite/live API calls. Performance degrades but correctness is maintained.

**If Redis data is corrupted:**
```bash
docker compose stop redis
docker volume rm claw-net_redis_data   # clears all cache — data is ephemeral
docker compose up -d redis
```

---

## 6. High Credit Deduction Failures

**Symptom:** Many `deductCredit` calls return `false`; users report "insufficient credits" despite having funded accounts.

### Diagnosis
```bash
# Check a specific key
docker compose exec api node -e "
  const Database = require('better-sqlite3');
  const db = new Database('/app/data/orchestrator.db', { readonly: true });
  const row = db.prepare('SELECT key, credits, credits_used, active FROM api_keys WHERE key = ?').get('<KEY>');
  console.log(row);
  db.close();
"
```

**Look for negative credits (should never happen):**
```bash
docker compose exec api node -e "
  const Database = require('better-sqlite3');
  const db = new Database('/app/data/orchestrator.db', { readonly: true });
  const rows = db.prepare('SELECT key, credits FROM api_keys WHERE credits < 0').all();
  console.log(rows);
  db.close();
"
```

### Resolution
- If credits are correct, this is expected behaviour (user ran out).
- If credits are negative (bug): manually correct and file an incident report.
- If `active = 0` is the cause: re-activate via Clerk dashboard or SQL.

---

## 7. Stripe / Solana Webhook Failures

**Symptom:** Users pay but credits don't appear. Stripe dashboard shows webhook failures.

### Diagnosis
1. Check Stripe dashboard → Developers → Webhooks → Recent deliveries
2. Check logs: `docker compose logs api | grep -i "stripe\|webhook"`
3. Verify `STRIPE_WEBHOOK_SECRET` in `.env` matches Stripe dashboard

**Solana:**
```bash
docker compose logs api | grep -i "solana\|usdc\|signature"
```

### Resolution

**Re-deliver Stripe event** from the Stripe dashboard (safe — idempotent via `stripe_processed_sessions` table).

**Manual credit top-up (if webhook can't be re-delivered):**
```bash
curl -X POST https://api.claw-net.org/v1/admin/topup \
  -H "Authorization: Bearer <ADMIN_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"key": "<API_KEY>", "credits": 5000}'
```

**Verify `.env` webhook secret:**
```bash
grep STRIPE_WEBHOOK_SECRET ~/claw-net/.env
```

---

## 8. Disk Full

**Symptom:** DB writes fail; logs show `SQLITE_FULL` or `no space left on device`.

### Diagnosis
```bash
df -h
du -sh ~/claw-net/data/*
docker system df
```

### Resolution

**Clean Docker build cache:**
```bash
docker system prune -f
```

**Truncate old logs:**
```bash
# Docker logs (if not using log rotation)
truncate -s 0 $(docker inspect --format='{{.LogPath}}' claw-net-api-1)
```

**Archive old orchestration rows (keep last 30 days):**
```bash
docker compose exec api node -e "
  const Database = require('better-sqlite3');
  const db = new Database('/app/data/orchestrator.db');
  const result = db.prepare(\"DELETE FROM orchestrations WHERE timestamp < datetime('now', '-30 days')\").run();
  console.log('Deleted rows:', result.changes);
  db.close();
"
```

**Add disk monitoring** (cron on VPS):
```bash
# /etc/cron.d/disk-alert
0 * * * * root df / | awk 'NR==2{if($5+0>85) print "DISK "$5" used"}' | mail -s "VPS disk alert" ops@claw-net.org
```

---

## General Escalation Path

1. Restart the affected container (`docker compose restart <service>`)
2. Check logs (`docker compose logs --tail=100 <service>`)
3. Check UptimeRobot status page
4. If data integrity is at risk — **stop writes first, investigate second**
5. Post incident summary in `docs/incident-log.md`

---

## 9. Database Restore From Backup

**Symptom:** DB corruption, accidental deletion, or data loss.

### Diagnosis
```bash
ssh guardian-vps
ls -lh ~/backups/orchestrator_*.db.gz | tail -5
```

### Fix
```bash
# Stop the API to prevent writes during restore
docker compose stop orchestrator

# Restore latest backup
LATEST=$(ls -t ~/backups/orchestrator_*.db.gz | head -1)
gunzip -c "$LATEST" > /home/guardian/claw-net/data/orchestrator.db.restore
mv /home/guardian/claw-net/data/orchestrator.db /home/guardian/claw-net/data/orchestrator.db.broken
mv /home/guardian/claw-net/data/orchestrator.db.restore /home/guardian/claw-net/data/orchestrator.db

# Verify integrity
sqlite3 /home/guardian/claw-net/data/orchestrator.db "PRAGMA integrity_check;"

# Restart
docker compose start orchestrator
docker compose logs -f orchestrator
```

---

## 10. Verify Production Mode (Not Simulation)

**Symptom:** Users report answers look generic / identical regardless of query. `/v1/health` shows `simulationMode: true`.

### Diagnosis
```bash
ssh guardian-vps
grep CLAWAPIS_API_KEY /home/guardian/claw-net/.env
docker compose exec orchestrator env | grep CLAWAPIS
```

### Fix
```bash
# Add/update CLAWAPIS_API_KEY in .env
echo "CLAWAPIS_API_KEY=your_key_here" >> /home/guardian/claw-net/.env
docker compose up -d --no-build
# Verify
curl -s https://api.claw-net.org/v1/health | grep simulationMode
```

**simulationMode must be `false` in production.**

---

## 11. Credit Accounting Drift

**Symptom:** `GET /v1/admin/reconcile` shows non-zero `drift`.

### Diagnosis
```bash
curl -H "X-Admin-Key: $ADMIN_KEY" https://api.claw-net.org/v1/admin/reconcile
```
Drift = `expectedCirculating - totalGranted`. Positive drift means credits appeared from nowhere. Negative drift means credits were lost.

### Fix
1. Check `audit_log` table for recent anomalies
2. Check for failed DB transactions that may have partially applied
3. Check if `tryClaimSolanaSignature` or `claimStripeSession` had any duplicate grants
4. If drift < 100 credits, it may be floating point rounding in revenue share — monitor
5. If drift > 1000 credits, treat as incident — investigate before allowing new payments

---

## 12. Stripe Webhook Secret Rotation

Rotate `STRIPE_WEBHOOK_SECRET` and `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` **quarterly** (every 3 months) to limit exposure window if a secret leaks.

### Steps

**1. Generate a new secret in the Stripe Dashboard**
- Go to [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks)
- Click the webhook endpoint → **Roll secret**
- Copy the new `whsec_...` value

**2. Update VPS `.env` (hot-swap — no downtime)**
```bash
ssh guardian-vps
nano /home/guardian/claw-net/.env
# Update: STRIPE_WEBHOOK_SECRET=whsec_newvalue
# If subscription webhook: STRIPE_SUBSCRIPTION_WEBHOOK_SECRET=whsec_newvalue
```

**3. Restart to pick up new secret**
```bash
cd ~/claw-net
docker compose up -d --no-build
```

**4. Verify**
```bash
# Make a test payment in Stripe Dashboard → Developers → Webhooks → Send test event
docker compose logs api | grep "Stripe webhook received"
```

### Notes
- Stripe supports a brief overlap window (~10 minutes) where both old and new secrets are valid during a roll — no dropped webhooks.
- If you suspect a leaked secret, roll immediately and check the Stripe Dashboard for unauthorized replays.
- Record rotation date in this file below:

| Date | Rotated by | Scope |
|---|---|---|
| (first rotation) | — | — |

---

## 13. Admin Action Audit Trail

All credit movements are logged to the `audit_log` table via `logAudit()`. Admin payout updates are also logged.

### Query recent admin actions
```bash
docker compose exec api node -e "
  const Database = require('better-sqlite3');
  const db = new Database('/app/data/orchestrator.db', { readonly: true });
  const rows = db.prepare(\"SELECT * FROM audit_log WHERE actor_id = 'admin' ORDER BY id DESC LIMIT 50\").all();
  console.table(rows);
  db.close();
"
```

### Query credit movements for a specific key
```bash
docker compose exec api node -e "
  const Database = require('better-sqlite3');
  const db = new Database('/app/data/orchestrator.db', { readonly: true });
  const rows = db.prepare(\"SELECT * FROM audit_log WHERE entity_id = '<API_KEY>' ORDER BY id DESC LIMIT 20\").all();
  console.table(rows);
  db.close();
"
```

### Actions logged
| Action | Trigger |
|---|---|
| `CREDIT_DEDUCT` | Every orchestration call |
| `CREDIT_TOPUP` | Stripe checkout, USDC payment, subscription renewal |
| `CREDIT_GRANT` | New API key creation |
| `STAKE_LOCK` | Credits staked on a skill |
| `STAKE_UNLOCK` | Stake returned after timeout |
| `PAYOUT_STATUS` | Admin updates a creator payout |
