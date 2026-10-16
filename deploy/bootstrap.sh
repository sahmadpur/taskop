#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 server (§4 of the deployment plan). Run as root:
#   ssh root@<server> 'bash -s' < deploy/bootstrap.sh
# Safe to re-run. Does: UTC clock, security updates, Docker with log rotation, a firewall (22/80/443),
# key-only SSH, a `deploy` user in the docker group with root's SSH keys, /opt/taskop, swap, cron jobs.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

timedatectl set-timezone UTC

apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl gnupg ufw fail2ban unattended-upgrades > /dev/null

# Docker Engine + compose plugin from Docker's repository.
if ! command -v docker > /dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin > /dev/null
fi
cat > /etc/docker/daemon.json <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" } }
EOF
systemctl restart docker

# The deploy user: runs docker compose in /opt/taskop; logs in with the same keys as root.
id deploy > /dev/null 2>&1 || adduser --disabled-password --gecos '' deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys
sort -u /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys -o /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
install -d -m 750 -o deploy -g deploy /opt/taskop /opt/taskop/backups

# Key-only SSH. Root keeps key login (prohibit-password) so the server stays reachable for maintenance.
cat > /etc/ssh/sshd_config.d/10-taskop.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
sshd -t && systemctl reload ssh

# Firewall: SSH and the web. Docker publishes only Caddy's 80/443, so nothing else is reachable.
ufw default deny incoming > /dev/null
ufw default allow outgoing > /dev/null
ufw allow 22/tcp > /dev/null
ufw allow 80/tcp > /dev/null
ufw allow 443/tcp > /dev/null
ufw allow 443/udp > /dev/null
ufw --force enable > /dev/null

systemctl enable --now fail2ban unattended-upgrades > /dev/null

# 2 GB swap as a cushion against OOM kills during report spikes.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile > /dev/null && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Nightly database backup (03:15 UTC) and a weekly prune of unused images.
cat > /etc/cron.d/taskop <<'EOF'
15 3 * * * deploy /opt/taskop/backup.sh >> /opt/taskop/backups/backup.log 2>&1
30 4 * * 0 root docker image prune -af --filter until=168h > /dev/null
EOF

echo "Bootstrap done: $(docker --version), $(docker compose version)"
