# ClawNet VPS Hardening

This is the recommended production layout for running ClawNet on a Linux VPS with Docker Compose while minimizing secret exposure and limiting damage from bad commands or compromised processes.

## Target Architecture

- SSH access uses keys only.
- Root SSH login is disabled.
- A dedicated `deploy` user owns deployments and the repo checkout.
- A separate `app` user owns runtime data where practical.
- Production secrets live outside the repo at `/etc/claw-net/claw-net.env`.
- The reverse proxy terminates TLS and forwards only the required traffic.
- The host firewall allows only SSH, HTTP, and HTTPS by default.
- Containers and services run with the least privilege available.

## Why This Helps

- Bad commands have less reach because the service is not running as root.
- Secrets are not sitting in the repo checkout where editors, shells, and assistants are more likely to touch them.
- SSH brute force and password attacks are sharply reduced.
- Deployment becomes repeatable instead of relying on memory.
- Recovery is faster because the layout is predictable.

## Host Layout

```text
/home/deploy/claw-net            repo checkout
/etc/claw-net/claw-net.env       production secrets
/var/www/claw-net                static site files
/var/backups/claw-net            database backups
```

## Accounts

- `deploy`: owns the git checkout and runs deploy commands
- `app`: optional dedicated runtime user for non-container services and owned data paths

If you stay on Docker Compose, the main win is still keeping secrets out of the checkout and keeping SSH/sudo restricted.

## SSH Hardening

Recommended `sshd` settings:

```text
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
ChallengeResponseAuthentication no
X11Forwarding no
AllowUsers deploy
```

After changing SSH settings, verify a second session can still log in before closing the first one.

## Firewall

Allow only:

- `22/tcp` for SSH
- `80/tcp` for HTTP
- `443/tcp` for HTTPS

Only open extra ports if ClawNet truly needs them externally.

## Secret Storage

Preferred production secret file:

```text
/etc/claw-net/claw-net.env
```

Permissions:

```bash
sudo chown root:root /etc/claw-net/claw-net.env
sudo chmod 600 /etc/claw-net/claw-net.env
```

The deploy script in this repo prefers that external file automatically.

## Protection Against Malicious Commands

There is no perfect protection, but this is the modern practical stack:

- do not run the app as root
- keep secrets out of the repo checkout
- restrict `sudo`
- use SSH keys with passphrases
- disable password auth
- enable `fail2ban`
- prefer narrow firewall rules
- avoid shared writable directories
- log and back up regularly

For stronger isolation, consider:

- AppArmor or SELinux
- rootless containers where practical
- separate VPSes for especially sensitive workloads
- systemd credentials or Docker secrets for the most sensitive values

## Modern Secret Options

From strongest to simpler:

1. systemd credentials
2. Docker secrets
3. external env file in `/etc/claw-net/`
4. repo-local `.env`

For the current ClawNet setup, the external env file is the best low-friction upgrade.

## Deployment Flow

1. Work locally
2. Run lint/build/tests
3. Push to GitHub
4. SSH to the VPS as `deploy`
5. Run the deploy script
6. Verify health and logs

## Verification Checklist

```bash
ssh deploy@your-vps
sudo ss -tulpn
sudo ufw status
sudo fail2ban-client status sshd
ls -l /etc/claw-net/claw-net.env
cd /home/deploy/claw-net
bash scripts/deploy.sh
docker compose ps
docker compose logs --tail=100
curl -I https://api.claw-net.org/health
```

## Rollout Order

1. Create `deploy` user and install SSH keys
2. Disable password auth and root SSH login
3. Turn on the firewall
4. Install Docker, Compose, Caddy, and fail2ban
5. Create `/etc/claw-net/claw-net.env`
6. Move the repo to `/home/deploy/claw-net`
7. Run deploy and verify
