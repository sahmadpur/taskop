# Taskop

Digital inspections and checklists platform (web + mobile). Monorepo: `apps/api` (NestJS), `apps/web` (React), `apps/mobile` (Expo), `packages/*` (shared contracts, i18n, API client, config).

## Requirements
Node 24+, pnpm 12+, Docker.

## First run
```bash
pnpm install
docker compose up -d
cp apps/api/.env.example apps/api/.env
pnpm --filter @taskop/api keys:generate   # paste both lines into apps/api/.env
pnpm db:setup                             # roles + migrations
pnpm db:seed                              # demo tenant (see output for logins)
pnpm dev
```
- API: http://localhost:3000/api/v1 — docs at http://localhost:3000/api/docs
- Mail catcher (Mailpit): http://localhost:8025
- File storage (SeaweedFS, S3 API): http://localhost:8333, private bucket `taskop-media` (created by `seaweedfs-init`). Dev credentials are in `docker/seaweedfs/s3.json`. If you already have `apps/api/.env`, add the `S3_*` variables from `apps/api/.env.example`; the API will not start without them.
- `apps/api/.env.example` sets `COOKIE_SECURE=false` so the refresh cookie works over plain `http://localhost` (Safari rejects `Secure` cookies there). Production must set `COOKIE_SECURE=true` and serve the API over HTTPS.

## Mobile (Expo)
```bash
cp apps/mobile/.env.example apps/mobile/.env
pnpm --filter @taskop/mobile dev
```
`EXPO_PUBLIC_API_URL` points the app at the API (default `http://localhost:3000`). On a physical phone use your computer's LAN IP, e.g. `http://192.168.1.20:3000`.

Photo and video uploads go straight from the phone to storage. On a physical phone set both `EXPO_PUBLIC_API_URL=http://<mac-lan-ip>:3000` (mobile `.env`) and `S3_PUBLIC_ENDPOINT=http://<mac-lan-ip>:8333` (API `.env`).

## Tests
`pnpm test` (API integration tests start a disposable Postgres via Testcontainers; Docker must be running).

## Platform admin
```bash
PLATFORM_ADMIN_EMAIL=you@taskop.az PLATFORM_ADMIN_NAME="Your Name" PLATFORM_ADMIN_PASSWORD='a long password' \
  pnpm --filter @taskop/api platform:create-admin
```

## Production database notes
Create the login roles once as a superuser (`taskop_app` with LOGIN; `taskop_platform` with LOGIN BYPASSRLS), then run migrations as the schema owner. Every new table needs its own GRANTs (see `apps/api/drizzle/0002_security.sql`) and, if tenant-owned, RLS.
