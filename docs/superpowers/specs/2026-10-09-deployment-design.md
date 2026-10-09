# Taskop — Deployment Plan

- **Date:** 2026-10-09
- **Status:** Decisions recorded; implementation starts once all sub-projects are finished
- **Covers:** Backend (API + Postgres + file storage), web admin, mobile builds (iOS + Android)
- **Builds on:** `docs/superpowers/specs/2026-10-07-foundation-design.md` (roles, RLS, config), `docs/superpowers/specs/2026-10-09-scheduling-assignment-design.md` (pg-boss)

## 1. Decisions

| Topic | Decision |
|---|---|
| When | **Once, at the end of all sub-projects.** No interim deployments: the first deploy is the full product. During development everything runs locally, and the mobile app is tested on your own phone with development builds over the local network. |
| Environments | **Production only**, plus local development. There is no separate staging server. Early testers use the production server with a test tenant (§3). |
| Hosting | **Own VPS on Hetzner Cloud.** Chosen over Railway (2–5× the cost for an always-on setup) and Contabo (weaker reliability). |
| Server | Hetzner **Arm** server, **4 vCPU / 6 GB RAM / 80 GB SSD**, Ubuntu 24.04, EU location (Falkenstein, Nuremberg or Helsinki). All images must be built for `linux/arm64`. |
| Deploy method | **Docker Compose + Caddy** on the server. **GitHub Actions** builds the images, pushes them to GitHub's container registry (GHCR) and deploys over SSH. No Coolify or Dokploy. |
| Repository | **Make `sahmadpur/taskop` private** (it is public today). |
| Domain | **`taskop.app`**. The `.app` domain requires HTTPS in every browser; Caddy provides it automatically. |
| URLs | **`taskop.app`**: the public landing page (`www.taskop.app` redirects to it). **`admin.taskop.app`**: the product. Caddy serves the web app at `/` and proxies `/api/*` to the API; the mobile app also calls the API here. This matches the web client, which already calls `/api/v1` on its own origin, so no CORS or cross-site cookie changes are needed. |
| File storage | **SeaweedFS**, self-hosted on the same server (and locally in place of MinIO). It is used through the S3 API, so a move to Hetzner Object Storage later only changes config and copies the data. **Not MinIO**: its Community Edition is archived and no longer publishes images. |
| Email | **Resend** (SMTP), sending from your domain with SPF and DKIM. Mailpit stays for local development. |
| Mobile builds | **Local builds** with `eas build --local` on a free Expo account. No paid Expo plan. `eas submit` uploads to TestFlight and Google Play internal testing. |
| Bundle ID | **`az.taskop.app`** on iOS and Android (confirmed; already in `apps/mobile/app.json`). |

## 2. Timeline

1. **Sub-projects 3 to the last one:** no deployment work, but keep new code deployable: config in environment variables, no hard-coded URLs, S3-style storage code.
2. **Sub-project 4:** add SeaweedFS and the upload code (presigned URLs) and set the video limits (§8). Test the mobile app on your own phone with development builds pointed at your Mac over the local network.
3. **Sub-project 6:** push notifications need real-device builds and the APNs and FCM credentials (§12). Set those up then, still without a server.
4. **After the last sub-project:** carry out this plan. Set up the server, CI/CD and DNS, run a test restore from backup (§10), and ship the first iOS and Android builds to internal testers. Then start the pilot.
5. **Before the pilot:** the data-residency question answered (§13).

**Trade-off:** waiting until the end means problems that only show on a real server (HTTPS, cookies behind a proxy, background jobs on a real clock, store review) appear late, all at once. Plan for one to two weeks of deployment and fixing at the end. The checks in §3 and the internal-tester phase are there to catch them before real users do.

## 3. Running without staging

With a single environment, every deploy reaches real users. To keep that safe:

- **CI must pass before deploying:** lint, typecheck, unit and integration tests, and Playwright end-to-end tests.
- **A test tenant in production** ("Taskop Test") for checking each release on the real server. Real customers are never used for testing.
- **Back up the database before migrating:** each deploy takes a `pg_dump` before running migrations.
- **Migrations add before they remove.** Add new columns and tables first, and drop old ones in a later release. A few seconds of downtime while the API restarts is acceptable.
- **Rollback:** images are tagged with the git commit, so redeploying an earlier tag rolls the code back. Migrations are not rolled back automatically; recover from the pre-deploy dump if needed.
- **Mobile releases go to internal testers first** (TestFlight and Play internal testing) before any public release.

If the pilot grows, a staging stack can be added as a second Compose project on the same server.

## 4. Server

- **Hetzner Cloud Arm server**, 4 vCPU / 6 GB / 80 GB, Ubuntu 24.04 LTS, system clock in **UTC**. The app converts times to each tenant's timezone itself.
- **Hetzner Cloud Firewall:** allow only TCP 22, 80 and 443 (and UDP 443 for HTTP/3). Postgres and SeaweedFS are never exposed to the internet.
- **Hetzner server backups** enabled (daily snapshots).
- **Hardening:** SSH key login only; root and password login disabled; a non-root `deploy` user in the `docker` group; automatic security updates (`unattended-upgrades`); optionally fail2ban.
- **Directory layout:** `/opt/taskop/` holds `docker-compose.prod.yml`, `Caddyfile`, `.env` (mode `600`) and `backups/`.
- **Docker:** container log rotation (`json-file`, max-size 10m, max-file 5) and a weekly image prune.

### Expected resource use (early pilot)

| Service | RAM |
|---|---|
| Postgres 18 | ~0.5–1 GB |
| API (NestJS + pg-boss) | ~0.3–0.5 GB |
| Caddy + web static files | ~50 MB |
| SeaweedFS | ~0.2–0.5 GB |
| **Total** | **~1.5–2.5 GB of 6 GB** |

## 5. Runtime layout

```
                       internet
                          │  :80 / :443
                    ┌─────▼─────┐
                    │   Caddy   │  automatic HTTPS (Let's Encrypt)
                    └─┬───┬───┬─┘
     taskop.app       │   │   │  admin.taskop.app
   ┌──────────────────▼┐  │  ┌▼────────────────────────────┐
   │ landing page files│  │  │ /* → web app files           │
   └───────────────────┘  │  │      (SPA fallback)          │
                          │  └──────────────────────────────┘
       admin.taskop.app   │
       /api/*       ┌─────▼──┐
                    │  API   │
                    │ NestJS │
                    │+pg-boss│
                    └─┬────┬─┘
                      │    │ S3 API
             ┌────────▼┐  ┌▼──────────┐
             │Postgres │  │ SeaweedFS │   (both on the internal Docker network only)
             │   18    │  │  (S3)     │
             └─────────┘  └───────────┘
```

- **`docker-compose.prod.yml`** services: `caddy`, `api`, `postgres`, `seaweedfs`, and a one-off `migrate` that runs `node dist/db/scripts/setup.js`.
- **The landing page** (`taskop.app`) is a static site that Caddy serves from the same server. How it is built is still open (§13).
- **The web app** is built with Vite. Its `dist/` is baked into a small Caddy-based image (`taskop-web`), so Caddy serves the files directly.
- **pg-boss runs inside the API process** (sub-project 3). One API container is enough. pg-boss locks jobs in Postgres, so a second replica later would be safe.
- **Health check:** `GET /api/v1/health`, used by Docker, the deploy script and the uptime monitor.
- **Presigned photo and video uploads:** phones need a public URL for storage. Caddy exposes SeaweedFS's S3 endpoint on its own host, e.g. `files.taskop.app` (exact routing decided in sub-project 4; signed URLs include the host name).

## 6. Database

- The `postgres:18` image (multi-arch) with a named volume, reachable only on the internal network.
- **Roles:** the same roles as local development, created by the existing setup script:
  - `taskop_owner`: runs migrations and owns the schema and the `pgboss` schema.
  - `taskop_app`: the API's runtime connection, subject to row-level security.
  - `taskop_platform`: platform-admin access.
- **Migrations:** the deploy runs `docker compose run --rm migrate` before restarting the API. It calls `setupDatabase()`, which ensures the roles exist and then runs the Drizzle migrations from `apps/api/drizzle`.
- **First platform admin:** a one-off run of `create-platform-admin` on the server after the first deploy. It needs a compiled `dist/` entry point, since the production image has no `tsx`.

## 7. Configuration and secrets

`/opt/taskop/.env` on the server, mode `600`, with a copy in your password manager. It is never committed (this matters even more while the repo is public).

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3000` (internal) |
| `DATABASE_OWNER_URL` / `DATABASE_APP_URL` / `DATABASE_PLATFORM_URL` | `postgres://…@postgres:5432/taskop` with strong random passwords |
| `APP_DB_PASSWORD` / `PLATFORM_DB_PASSWORD` | random, 32+ characters |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | generated once with `pnpm --filter @taskop/api keys:generate` |
| `WEB_URL` | `https://admin.taskop.app` |
| `SMTP_URL` | Resend SMTP (`smtps://resend:<api-key>@smtp.resend.com:465`) |
| `MAIL_FROM` | `Taskop <no-reply@taskop.app>` |
| `COOKIE_SECURE` | `true` |
| `TRUST_PROXY` | `true` (behind Caddy) |
| `LOG_LEVEL` | `info` |
| `S3_ENDPOINT` / `S3_PUBLIC_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_FORCE_PATH_STYLE` | added in sub-project 4 |

**GitHub Actions secrets:** `DEPLOY_SSH_KEY` (a key used only for deploying), `DEPLOY_HOST`, `DEPLOY_USER`. GHCR uses the built-in `GITHUB_TOKEN`. On the server, the `deploy` user logs in to GHCR with a read-only token.

## 8. File storage (SeaweedFS)

- **Local:** replace the `minio` service in `docker-compose.yml` with SeaweedFS (`weed server -s3`, official multi-arch image). This happens in sub-project 4, alongside the first upload code.
- **Server:** the same image, data in a named volume on the 80 GB disk. If the disk fills, attach a Hetzner Volume and move SeaweedFS's data there.
- **API code:** the AWS SDK v3 S3 client, configured only through environment variables. Phones upload directly to storage using presigned URLs; the API never handles the file data.
- **Questions for sub-project 4's design:**
  - Maximum video length and resolution, and compression on the phone (a minute of 1080p is about 100 MB).
  - Photo resize and quality before upload.
  - A disk-usage alert (§10).
  - How long files are kept.
- **Later option:** Hetzner Object Storage. Change the S3 variables and copy the bucket with `rclone`.

## 9. Build and CI/CD

**Workflow `deploy.yml`, triggered on push to `main`:**

1. **Check:** `pnpm install`, then lint, typecheck and test (the integration tests use a Postgres service container), then Playwright end-to-end tests.
2. **Build images:** `taskop-api` and `taskop-web`, for `linux/arm64`, tagged `sha-<commit>` and `latest`, pushed to `ghcr.io/sahmadpur/…`.
3. **Deploy over SSH:**
   - `docker compose pull`
   - `pg_dump` (pre-deploy backup)
   - `docker compose run --rm migrate`
   - `docker compose up -d`
   - wait for `/api/v1/health` to answer
   - `docker image prune`
4. **If the health check fails:** the job fails and prints the API logs. Roll back manually by redeploying the previous `sha-` tag (a `workflow_dispatch` input).

**Building Arm images from a private repo.** GitHub's native Arm runners may not be included for private repos on your plan, so the Dockerfiles are written so this doesn't matter:

- The TypeScript and Vite build stages run on the **build machine's own architecture** (`FROM --platform=$BUILDPLATFORM`). The output is plain JavaScript and static files, the same on any architecture.
- Only the final stage targets `linux/arm64` under QEMU emulation. It just installs production dependencies with `pnpm deploy --prod`. The one compiled package, `@node-rs/argon2`, downloads a ready-made Arm binary, so this step stays fast.
- If GitHub's Arm runners turn out to be available, switch `runs-on: ubuntu-24.04-arm` and drop QEMU.
- GitHub Actions minutes on a private repo come from the plan's monthly allowance. Check usage after the first few weeks.

**Dockerfiles:**
- `apps/api/Dockerfile`: multi-stage, `node:24-slim` base, runs as a non-root user, `CMD node --enable-source-maps dist/main.js`, includes `drizzle/` for migrations.
- `apps/web/Dockerfile`: Vite build, then copies `dist/` into a `caddy` image.

## 10. Backups and monitoring

**Backups**
- **Hetzner server backups:** daily snapshots of the whole server (Hetzner keeps the last 7).
- **Database:** a nightly `pg_dump -Fc` (cron on the server). Keep 7 copies locally and 30 days off the server on a **Hetzner Storage Box**, synced with `rclone` or `rsync`.
- **Files:** a nightly `rclone sync` of the SeaweedFS bucket to the Storage Box.
- **Restore test:** restore the database dump and the files onto a temporary server **before the pilot**, then once a quarter.

**Monitoring**
- **Uptime:** an external monitor on `https://admin.taskop.app/api/v1/health` (UptimeRobot or Better Stack free tier) that emails or pings you.
- **Disk:** a cron script alerts at 80% disk use, and also reports a failed nightly backup (through healthchecks.io's free tier or a Resend email).
- **Logs:** the API logs JSON with pino to Docker's rotated logs, read with `docker compose logs`. A log service can come later if needed.
- **Job failures:** pg-boss dead-letter jobs are logged at error level (sub-project 3). Check them with `docker compose logs api | grep -i dead`. Alerting can come later.

## 11. Email (Resend)

- Create a Resend account and verify `taskop.app`: add Resend's **SPF and DKIM** DNS records, plus a **DMARC** record (`p=none` to start).
- Send from `no-reply@taskop.app`. The free tier covers invites and password resets during the pilot.
- Before the pilot, send a test invite to Gmail and Outlook inboxes and confirm it doesn't land in spam.

## 12. Mobile apps

**Build setup**
- **Expo account:** free. Builds run on your Mac with `eas build --local`, and uploads use `eas submit`.
- **`apps/mobile/eas.json` profiles:**
  - `development`: dev client, local API.
  - `preview`: internal distribution against `https://admin.taskop.app`.
  - `production`: store builds against `https://admin.taskop.app`.
- **API URL:** `EXPO_PUBLIC_API_URL=https://admin.taskop.app` for the preview and production profiles. The API base path stays `/api/v1`.
- **Version numbers:** `version` set in `app.json`; build numbers increased automatically by EAS (`autoIncrement`).
- **Mac requirements:**
  - iOS: Xcode, with the `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` workaround.
  - Android: Android Studio (SDK) and JDK 17.

**iOS**
- Register bundle ID `az.taskop.app` and create the app in App Store Connect.
- EAS manages signing certificates (stored on the free account) or a local `credentials.json`.
- `eas submit -p ios` uploads to **TestFlight**. Add internal testers (up to 100) without App Review.

**Android**
- Create the app in Play Console with package `az.taskop.app`, and set up the **Internal testing** track.
- **The first `.aab` must be uploaded by hand in Play Console.** After that, `eas submit -p android` works with a Play service-account key.
- **Keep a backup of the Android upload keystore** in your password manager. If it's lost, Google Play support has to reset it, and updates are blocked until then.

**Later (sub-project 6):** push notifications need an **APNs key** (Apple) and **FCM credentials** (Firebase/Google), plus Expo push or direct sending. These get added to secrets then.

## 13. Open questions

| # | Question | Needed by |
|---|---|---|
| 1 | **Data residency:** do Azerbaijani clients require personal data stored in-country? This could rule out Hetzner's EU locations for production. | Before the pilot (ask the client early) |
| 2 | **Video limits:** maximum length and resolution, and whether to compress on the phone. | Sub-project 4 design |
| 3 | **The public host for presigned uploads** (`files.taskop.app` vs a path on `admin.taskop.app`). | Sub-project 4 design |
| 4 | **Is GitHub's native Arm runner available on the private repo?** If not, use the QEMU fallback (§9). | First CI run |
| 5 | **Uptime and alert tools:** UptimeRobot vs Better Stack, healthchecks.io vs email only. | Deployment |
| 6 | **Landing page:** what builds it (a separate static site in the monorepo, e.g. `apps/landing`, vs a hosted site builder) and whether it lives on the same server. The plan assumes static files served by Caddy. | Before launch |

## 14. Your checklist (needs your accounts)

- [ ] Make the GitHub repo private.
- [ ] Hetzner: create the project and the Arm server (4 vCPU / 6 GB / 80 GB, Ubuntu 24.04, EU), add your SSH key, set up the Cloud Firewall (22/80/443), enable backups.
- [ ] Hetzner: order a Storage Box (smallest size) for off-server backups.
- [ ] DNS: `A` and `AAAA` records for `taskop.app`, `www.taskop.app` and `admin.taskop.app` (and `files.taskop.app` if chosen) pointing at the server.
- [ ] Resend: create an account, verify the domain (SPF, DKIM, DMARC records), create an API key.
- [ ] Expo: create a free account.
- [ ] App Store Connect: register `az.taskop.app` and create the app record.
- [ ] Play Console: create the app and the internal testing track, upload the first `.aab` by hand when it's ready.
- [ ] Password manager: store the server `.env`, the JWT keys, the DB passwords and the Android upload keystore.

## 15. Implementation work (Claude, after the last sub-project)

1. `apps/api/Dockerfile` and `apps/web/Dockerfile` (multi-stage, arm64 final stage, non-root).
2. Compiled entry points for the setup and `create-platform-admin` scripts in the production image.
3. `deploy/` folder:
   - `docker-compose.prod.yml` and `Caddyfile`
   - `.env.example.prod`
   - `bootstrap.sh`: server hardening, Docker, `deploy` user, log rotation, cron jobs
   - `backup.sh`: `pg_dump`, `rclone` to the Storage Box, retention
   - `restore.md`: restore steps
4. `.github/workflows/ci.yml` (checks on pull requests) and `deploy.yml` (build, push, migrate, deploy, health check, manual rollback input).
5. `apps/mobile/eas.json` with development, preview and production profiles, and the API URL per profile.
6. A runbook in `README` or `deploy/README.md`: first deploy, routine deploy, rollback, restore, creating a platform admin, rotating secrets.
7. A test tenant seed for production smoke checks.
