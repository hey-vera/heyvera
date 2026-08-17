# Deploy runbook — Cortex production

The production host is `clawguard`, reachable over Tailscale. Deploys run from
**GitHub Actions**, not from a laptop.

> `deploy/README.md` describes an nginx + `/opt/cortex` + `cortex-api.service`
> topology that **does not exist on the host**. The live unit is
> `/etc/systemd/system/cortex.service`, running as `guardian` from
> `/home/guardian/claw-net`, fronted by **caddy**. Trust this file over that one.

---

## 0. Preflight: refuse to deploy under 10 GB free

**Run this before every deploy. If it prints `REFUSE`, stop.**

```bash
ssh guardian-vps-tail 'avail=$(df --output=avail -BG / | tail -1 | tr -dc "0-9"); \
  used=$(df --output=pcent / | tail -1 | tr -dc "0-9"); \
  echo "free: ${avail}G  used: ${used}%"; \
  [ "$avail" -ge 10 ] && echo "PROCEED" || echo "REFUSE — under 10 GB free"'
```

### Why 10 GB, and why this step exists at all

The deploy **builds Rust on the production host** — the workflow pushes to a
mirror and runs the build remotely. A Rust link step is the single largest
transient disk consumer in the system. Starting one on a nearly-full volume
does not fail cleanly: it either drives the box into swap *while it is serving
production*, or the linker is OOM-killed and leaves a partial artifact.

This gate exists because **the host reached 80% full and nothing was watching**.
It was found by hand, not by an alarm. 10 GB is the floor for one link step plus
headroom for the database and logs; it is deliberately conservative.

This is a documented gate, not yet an automated one. Making it automatic means
adding a preflight step to `.github/workflows/deploy-production.yml` that fails
the job before the build. That has not been done — see "Not yet automated".

---

## 1. Disk reclamation

When preflight says `REFUSE`, reclaim in this order. Stop as soon as you clear
10 GB; do not keep going for tidiness.

### Docker build cache — safe, and usually sufficient

```bash
ssh guardian-vps-tail 'docker system df; docker builder prune -f; df -h /'
```

`docker builder prune` (no `-a`) removes **only unreferenced build cache**. It
does not remove images or containers.

On 2026-08-17 this alone took the root filesystem from **80% used / 16 GB free**
to **37% used / 49 GB free** — 35.5 GB reclaimed in one command.

> Reading `docker system df` afterwards is confusing: the Images total drops
> too (33.4 GB → 6.6 GB). Nothing was deleted. Image size and build cache share
> layers, and the reclaimable figure was being double-counted. Confirm by
> checking the **counts**, which do not change: Images 10, Containers 3.

**Never** use `docker system prune -a` here. It removes images that running
services reference.

### Journals

```bash
ssh guardian-vps-tail 'journalctl --disk-usage'
```

journald is currently **uncapped**; `/etc/systemd/journald.conf` has
`#SystemMaxUse=` commented out, and there is no `journald.conf.d/` directory.

Capping it requires root and is **not** in `guardian`'s NOPASSWD allowlist, so
it cannot be done from an agent session. It needs Josh:

```bash
sudo mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=500M\n' | sudo tee /etc/systemd/journald.conf.d/size.conf
sudo systemctl restart systemd-journald
journalctl --disk-usage
```

**Before capping, check whether a service is crash-looping.** A cap turns a
runaway log into a silently rotating one, which destroys the evidence:

```bash
ssh guardian-vps-tail 'systemctl list-units --failed; \
  systemctl is-active cortex claw-net-node radar-hosted caddy'
```

A unit reporting `activating (auto-restart)` is failing, not starting.

---

## 2. Deploy

`Deploy Production` is `workflow_dispatch` on
`.github/workflows/deploy-production.yml`, branch `main`. It joins the tailnet
with its own credentials, force-pushes to `claw-net.git` on the host as the
`deploy` user, and runs the build there.

Local SSH being unavailable never blocks a deploy — prefer the workflow.

### Do not run `scripts/deploy-cortex.sh`

It does `git reset --hard` + `git clean -fd`, and the **live database is a
tracked file** at `/home/guardian/claw-net/.cortex/cortex.db`. That script
restores the committed dev snapshot over production. To hand-deploy, build in a
separate `git worktree` off `origin/main` and `sudo cp` the binary — that path
never touches the checkout holding the database.

### `CORTEX_SINGLE_NODE=1` is required

The server **exits without it**. The SQLite store is a `Mutex<Connection>` that
two processes do not share, so a second dispatcher grades every delivery twice.

---

## 3. Verify

```bash
ssh guardian-vps-tail 'systemctl is-active cortex; df -h /; \
  journalctl -u cortex -n 30 --no-pager'
```

Confirm free space is still above 10 GB after the build.

---

## Not yet automated

- The preflight in §0 is manual. Automating it = one step in
  `deploy-production.yml` before the build.
- Nothing alarms on disk between deploys. 80% arrived silently once and will
  again.
