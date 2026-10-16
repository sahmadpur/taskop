#!/usr/bin/env bash
# Nightly database backup (§10 of the deployment plan), run by cron as the deploy user (deploy/bootstrap.sh).
# Keeps the last 7 nightly dumps in /opt/taskop/backups. Off-server copies (Storage Box + rclone) come later.
set -euo pipefail
cd "$(dirname "$0")"

dump="backups/nightly-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres pg_dump -U taskop_owner -d taskop -Fc > "$dump.tmp"
mv "$dump.tmp" "$dump"
ls -1t backups/nightly-*.dump | tail -n +8 | xargs -r rm --
echo "$(date -u +%FT%TZ) backed up to $dump ($(du -h "$dump" | cut -f1))"
