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

## Tests
`pnpm test` (API integration tests start a disposable Postgres via Testcontainers; Docker must be running).

## Platform admin
```bash
PLATFORM_ADMIN_EMAIL=you@taskop.az PLATFORM_ADMIN_NAME="Your Name" PLATFORM_ADMIN_PASSWORD='a long password' \
  pnpm --filter @taskop/api platform:create-admin
```

## Production database notes
Create the login roles once as a superuser (`taskop_app` with LOGIN; `taskop_platform` with LOGIN BYPASSRLS), then run migrations as the schema owner. Every new table needs its own GRANTs (see `apps/api/drizzle/0002_security.sql`) and, if tenant-owned, RLS.
