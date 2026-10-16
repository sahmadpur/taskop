#!/usr/bin/env bash
# Deploys the stack in /opt/taskop (§9 of the deployment plan). Run on the server as the deploy user:
#   ./deploy.sh <tag>      pull ghcr.io/sahmadpur/taskop-*:<tag> (e.g. sha-1a2b3c4), then deploy it
#   ./deploy.sh --build    build the images from ./src (a checkout of the repository), then deploy them
# Steps: images → pre-deploy pg_dump → migrate → up -d → wait for the API health check → prune old images.
set -euo pipefail
cd "$(dirname "$0")"

compose() { docker compose -f docker-compose.prod.yml --env-file .env "$@"; }
mode=${1:?usage: deploy.sh <tag> | --build}

set_images() {
  for name in landing web api; do
    key="$(echo "$name" | tr a-z A-Z)_IMAGE"
    sed -i "s|^$key=.*|$key=$1/taskop-$name:$2|" .env
  done
}

if [ "$mode" = "--build" ]; then
  set_images local build
  # The checkout's own copy of the compose file, whose build contexts ("..") point at the checkout.
  docker compose -f src/deploy/docker-compose.prod.yml --env-file .env build landing web api
else
  set_images ghcr.io/sahmadpur "$mode"
  compose pull landing web api
fi

mkdir -p backups
if compose ps --status running postgres --quiet | grep -q .; then
  dump="backups/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ).dump"
  compose exec -T postgres pg_dump -U taskop_owner -d taskop -Fc > "$dump"
  echo "Database backed up to $dump"
fi

compose up -d postgres seaweedfs
compose run --rm migrate
compose up -d --remove-orphans

echo "Waiting for the API health check…"
for _ in $(seq 1 60); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q api)" 2>/dev/null || true)
  if [ "$status" = "healthy" ]; then
    echo "API healthy"
    ls -1t backups/pre-deploy-*.dump 2>/dev/null | tail -n +15 | xargs -r rm --
    docker image prune -f > /dev/null
    exit 0
  fi
  sleep 2
done
echo "API did not become healthy:" >&2
compose logs --tail 100 api >&2
exit 1
