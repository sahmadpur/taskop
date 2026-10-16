# Deploy

The production stack, as designed in [the deployment plan](../docs/superpowers/specs/2026-10-09-deployment-design.md). On the server these files live in `/opt/taskop/`, owned by the `deploy` user.

| File | Purpose |
|---|---|
| `docker-compose.prod.yml` | The services: `caddy` (edge proxy, HTTPS), `landing`, `web`, `api`, `postgres`, `seaweedfs`, and the one-offs `migrate` and `seaweedfs-init`. |
| `Caddyfile` | The sites: `taskop.app` (landing, `www` redirects to it), `admin.taskop.app` (web + `/api`), `files.taskop.app` (S3 for presigned uploads). |
| `.env.example` | The variables the compose file reads; copy to `.env` (mode 600). |
| `bootstrap.sh` | One-time server setup: UTC, Docker, firewall, key-only SSH, `deploy` user, swap, cron. |
| `deploy.sh` | Pull (or build) the images, back up the database, migrate, start, wait for health. |
| `backup.sh` | Nightly `pg_dump` (cron, 03:15 UTC), keeps 7. |

The images: [`apps/api/Dockerfile`](../apps/api/Dockerfile), [`apps/web/Dockerfile`](../apps/web/Dockerfile) (+ its `Caddyfile`), [`apps/landing/Dockerfile`](../apps/landing/Dockerfile) (+ its `Caddyfile`).

## Server

- `169.58.187.2` (x86_64, 6 vCPU, 11 GB, Ubuntu 24.04). Firewall (ufw): 22, 80, 443 only.
- SSH with keys only: `ssh deploy@169.58.187.2` for everything below; `root` for system maintenance.
- DNS (Cloudflare, **DNS only**, not proxied): `A` records for `taskop.app`, `www.taskop.app`, `admin.taskop.app`, `files.taskop.app` → the server. Caddy gets the certificates itself once they resolve.

## Routine deploy

**Automatic:** every push to `main` that passes CI runs [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml). It builds the three images, pushes them to GHCR as `sha-<commit>` and `latest`, copies the stack files here, and runs `deploy.sh sha-<commit>` over SSH. GitHub secrets: `DEPLOY_HOST`, `DEPLOY_SSH_KEY` (a key used only for this, in `deploy`'s `authorized_keys` as `github-actions-deploy@taskop`), `DEPLOY_KNOWN_HOSTS`.

**Rollback:** Actions → Deploy → Run workflow, with the tag of an earlier deploy (`sha-<commit>`). It skips the build and keeps the server's current stack files.

**By hand** on the server, in `/opt/taskop` as `deploy` (pulling from GHCR needs `docker login ghcr.io` with a token that can read packages):

```bash
./deploy.sh sha-1a2b3c4   # pull ghcr.io/sahmadpur/taskop-*:sha-1a2b3c4 and deploy it
./deploy.sh --build       # build from ./src (a copy of the repository) instead of pulling
```

`deploy.sh` takes a `pg_dump` into `backups/pre-deploy-*.dump` before migrating and fails with the API logs if the health check does not pass within two minutes.

Migrations are not rolled back; if one must be undone, restore the pre-deploy dump (below).

## Common tasks

```bash
alias dc='docker compose -f docker-compose.prod.yml'
dc ps                      # status
dc logs -f --tail 100 api  # API logs (JSON)
dc logs api | grep -i dead # failed background jobs
```

**Create or reset a platform admin** (prompts for the password, at least 12 characters):

```bash
read -rsp 'Password: ' PLATFORM_ADMIN_PASSWORD && echo && export PLATFORM_ADMIN_PASSWORD
docker compose -f docker-compose.prod.yml run --rm -e PLATFORM_ADMIN_EMAIL=you@example.com -e PLATFORM_ADMIN_NAME='Your Name' -e PLATFORM_ADMIN_PASSWORD api node dist/scripts/create-platform-admin.js
unset PLATFORM_ADMIN_PASSWORD
```

**Change a setting** (e.g. `SMTP_URL` once Resend is set up): edit `.env`, then `dc up -d api`.

**Restore a database dump:**

```bash
dc stop api
dc exec -T postgres pg_restore -U taskop_owner -d taskop --clean --if-exists < backups/<file>.dump
dc start api
```

## First setup of a new server

```bash
ssh root@<server> 'bash -s' < deploy/bootstrap.sh
scp deploy/{docker-compose.prod.yml,Caddyfile,deploy.sh,backup.sh,.env.example} deploy@<server>:/opt/taskop/
# On the server: cp .env.example .env && chmod 600 .env, then fill in the secrets
# (openssl rand -hex 32 for the passwords and S3_SECRET_KEY; pnpm --filter @taskop/api keys:generate for the JWT keys).
```

The secrets in `.env` (database passwords, S3 secret, JWT keys) belong in the password manager too.

## Run the production stack locally

Ports 80 and 443 must be free. `SITE_SCHEME=http` turns off automatic HTTPS, so the sites answer plain HTTP and the `Host` header picks the site. Fill in the secrets in `deploy/.env` from `.env.example` first.

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env run --rm migrate
curl -sS -H 'Host: admin.taskop.app' http://localhost/api/v1/health
curl -sS -H 'Host: taskop.app' http://localhost/ | grep -o 'https://admin.taskop.app/login' | head -1
docker compose -f deploy/docker-compose.prod.yml down
```
