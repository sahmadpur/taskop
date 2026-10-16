# Deploy

The production stack for the Hetzner server, as designed in [the deployment plan](../docs/superpowers/specs/2026-10-09-deployment-design.md). On the server these files live in `/opt/taskop/`.

| File | Purpose |
|---|---|
| `docker-compose.prod.yml` | The services: the `caddy` edge proxy and `landing` (the public page). The product's services follow with the remaining deployment work. |
| `Caddyfile` | The edge proxy's sites: `www.taskop.app` → `taskop.app`, `taskop.app` → the landing container. |
| `.env.example` | The variables the compose file reads; copy to `.env`. |

The landing image itself is defined in [`apps/landing/Dockerfile`](../apps/landing/Dockerfile) (Astro build, then Caddy serving the files with the caching headers from [`apps/landing/Caddyfile`](../apps/landing/Caddyfile)).

## Run the production stack locally

Ports 80 and 443 must be free. `SITE_SCHEME=http` turns off automatic HTTPS, so the sites answer plain HTTP and the `Host` header picks the site:

```bash
printf 'SITE_SCHEME=http\n' > deploy/.env
docker compose -f deploy/docker-compose.prod.yml up -d --build
curl -sS -H 'Host: taskop.app' http://localhost/ | head -c 300
curl -sSI -H 'Host: www.taskop.app' http://localhost/en/   # 308 → https://taskop.app/en/
docker compose -f deploy/docker-compose.prod.yml down
```

Check the Login link points at the platform:

```bash
curl -sS -H 'Host: taskop.app' http://localhost/ | grep -o 'https://admin.taskop.app/login' | head -1
```
