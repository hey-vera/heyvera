#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root on the VPS."
  exit 1
fi

DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_USER="${APP_USER:-app}"
DEPLOY_HOME="/home/${DEPLOY_USER}"
APP_HOME="/home/${APP_USER}"
REPO_DIR="${REPO_DIR:-${DEPLOY_HOME}/claw-net}"
ENV_DIR="/etc/claw-net"
ENV_FILE="${ENV_DIR}/claw-net.env"
BACKUP_DIR="/var/backups/claw-net"
WWW_DIR="/var/www/claw-net"

echo "[packages] Installing base packages..."
apt-get update
apt-get install -y \
  ca-certificates \
  curl \
  fail2ban \
  git \
  ufw \
  unattended-upgrades

if ! id "${DEPLOY_USER}" >/dev/null 2>&1; then
  echo "[users] Creating deploy user ${DEPLOY_USER}..."
  adduser --disabled-password --gecos "" "${DEPLOY_USER}"
fi

if ! id "${APP_USER}" >/dev/null 2>&1; then
  echo "[users] Creating app user ${APP_USER}..."
  adduser --disabled-password --gecos "" "${APP_USER}"
fi

echo "[dirs] Creating application directories..."
mkdir -p "${ENV_DIR}" "${BACKUP_DIR}" "${WWW_DIR}" "${REPO_DIR}"
chown root:root "${ENV_DIR}"
chmod 755 "${ENV_DIR}"
touch "${ENV_FILE}"
chown root:root "${ENV_FILE}"
chmod 600 "${ENV_FILE}"
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${REPO_DIR}" "${WWW_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${BACKUP_DIR}"

echo "[ssh] Ensuring .ssh directory exists for ${DEPLOY_USER}..."
install -d -m 700 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${DEPLOY_HOME}/.ssh"
touch "${DEPLOY_HOME}/.ssh/authorized_keys"
chown "${DEPLOY_USER}:${DEPLOY_USER}" "${DEPLOY_HOME}/.ssh/authorized_keys"
chmod 600 "${DEPLOY_HOME}/.ssh/authorized_keys"

echo "[sshd] Writing hardening config..."
cat >/etc/ssh/sshd_config.d/99-claw-net-hardening.conf <<EOF
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
X11Forwarding no
AllowUsers ${DEPLOY_USER}
EOF

echo "[fail2ban] Enabling SSH protection..."
cat >/etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled = true
bantime = 1h
findtime = 10m
maxretry = 5
EOF

echo "[firewall] Configuring ufw..."
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "[updates] Enabling unattended upgrades..."
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "[services] Restarting ssh and fail2ban..."
systemctl restart ssh
systemctl enable fail2ban
systemctl restart fail2ban

cat <<EOF

Bootstrap complete.

Next steps:
1. Add your SSH public key to ${DEPLOY_HOME}/.ssh/authorized_keys
2. Put production secrets into ${ENV_FILE}
3. Clone the repo into ${REPO_DIR} as ${DEPLOY_USER}
4. Install Docker, Docker Compose, and Caddy if not already present
5. Run the deploy script as ${DEPLOY_USER}

EOF
