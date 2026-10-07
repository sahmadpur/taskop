# Taskop — Sub-project 1: Foundation — Design Spec

- **Date:** 2026-10-07
- **Status:** Draft for review
- **Source requirements:** `docs/PS Checkly 20293009 v05.pdf` (product document; the product is named **Taskop**, not "Checkly")

## 1. Context

Taskop is a multi-tenant SaaS for digital inspections and checklists. Owners, admins and managers use a **web app** to configure their organisation, build checklists, schedule them and monitor results. Field workers use a **mobile app** (iOS + Android) to execute checklists with live photo/video evidence, offline.

The full platform is delivered as nine sub-projects, each with its own spec → plan → implementation cycle:

| # | Sub-project | Main requirement refs |
|---|---|---|
| **1** | **Foundation** — tenancy, auth, users, roles, sites (this spec) | FR-01–05, FR-26 (partial), NFR-05, NFR-07, NFR-12–14 |
| 2 | Checklist builder & templates | FR-06–08, FR-24 |
| 3 | Scheduling & assignment | FR-09, BR-12, BR-13 |
| 4 | Mobile execution, offline sync, evidence, problems | FR-10–13, BR-11, NFR-06.04–05, NFR-08.04–05 |
| 5 | Tasks | FR-14 |
| 6 | Notifications | FR-15, NFR-11 |
| 7 | Monitoring, dashboards, reports, export | FR-16–18 |
| 8 | Audit & corrections | FR-19, FR-26 |
| 9 | KPI/targets, attendance, subscriptions | FR-20–22, BR-01 |

### Constraints and decisions

- **Developer:** one person builds and runs everything. Fewer moving parts beats theoretical flexibility.
- **Stack:** TypeScript end to end, using the latest stable versions at implementation time (the plan checks current versions on npm):
  - Monorepo: pnpm workspaces + Turborepo
  - API: NestJS + PostgreSQL + Drizzle ORM
  - Web: React + Vite
  - Mobile: React Native with Expo
- **Tenancy:** one shared database. Every tenant-owned row has a `tenant_id`, and PostgreSQL Row-Level Security (RLS) enforces the tenant boundary. A customer who later needs a dedicated or on-premise setup gets a separate deployment of the same codebase.
- **Login model:** workers sign in with an admin-created username plus a PIN or password. Managers, admins and owners sign in with email plus password.
- **Auth:** built in-house (no auth library or hosted provider).
- **Hosting:** not decided yet. Everything is containerised (Docker) so the app can move between hosts, including a local Azerbaijani provider if data-residency rules (NFR-14.01) require it.

## 2. Goals and non-goals

**Goals.** At the end of this sub-project:

1. A new customer can sign up on the web, verify their email and become the Owner of a new tenant.
2. Admins can configure the org settings, site types, a site tree, teams and roles (built-in and custom).
3. Admins can create worker accounts, invite staff by email, assign role, manager, teams and sites, and deactivate or reactivate users.
4. Workers can log in on mobile with org code + username + PIN, see a placeholder home screen, change their PIN and log out.
5. Every sensitive change is written to an append-only audit log, and admins can browse it.
6. The tests prove that no tenant can read or write another tenant's data.
7. Taskop staff can list tenants and suspend or reactivate one.

**Non-goals** (later sub-projects or later phases):

- Checklists, scheduling, tasks, notifications and reports
- 2FA screens (the database already has room for it)
- Phone/SMS login
- Billing and subscription limits
- File uploads
- Languages other than Azerbaijani (all text uses translation keys, so adding one is simply new translation files)

## 3. Architecture

```
taskop/
├─ apps/
│  ├─ api/        NestJS REST API (OpenAPI docs)
│  ├─ web/        React + Vite SPA
│  └─ mobile/     Expo (Expo Router)
├─ packages/
│  ├─ contracts/  Zod schemas + inferred types for every request/response, error codes, permission keys
│  ├─ i18n/       translation resources (az), shared formatting helpers
│  └─ config/     shared tsconfig / eslint / prettier presets
├─ docker-compose.yml   Postgres, Mailpit, MinIO (for local development)
└─ docs/
```

- **One API**, organised as a modular monolith. NestJS modules: `auth`, `tenant`, `sites`, `teams`, `roles`, `users`, `audit`, `platform`, `mail`, `db`.
- **`packages/contracts`** is the single source of truth for API shapes:
  - The API validates request bodies, query parameters and responses against these Zod schemas, and generates its OpenAPI docs from them.
  - The web and mobile apps import the same schemas for form validation and typed API clients.
- **No other runtime services in this sub-project.** There is no Redis: rate-limit counters and the permission cache live in Postgres or in process memory (see §5.4 and §6). MinIO is in the Docker Compose file only to prepare for sub-project 4.

## 4. Data model

Rules that apply to every table:

- IDs are **UUIDv7** (sortable by creation time and can be generated offline).
- Timestamps are `timestamptz`, stored in UTC.
- Tenant-owned tables have `tenant_id uuid not null`, an index that starts with `tenant_id`, and an RLS policy `tenant_id = current_setting('app.tenant_id')::uuid` with `FORCE ROW LEVEL SECURITY`.
- Users, sites, teams and roles are never deleted; they are deactivated through a `status` or `active` field. The only things ever deleted are join-table rows such as team membership and site assignments.

### 4.1 Tables

**`tenants`** (RLS uses the policy `id = current_setting('app.tenant_id')::uuid`, so the app account can only see and change its own tenant row. Sign-up creates the new tenant's ID up front and sets `app.tenant_id` to it before inserting. Worker login looks up `org_code` through `taskop_platform`.)
- `id`, `name`
- `org_code`: unique, lowercase, 3–32 characters from `[a-z0-9-]`
- `timezone`: IANA name, default `Asia/Baku`
- `locale`: default `az`
- `status`: `active` | `suspended`
- `created_at`, `updated_at`

**`site_types`**
- `id`, `tenant_id`, `name`, `sort_order`, `active`
- Seeded for every new tenant: Filial (Branch), Zona (Zone), Bölmə (Section), Yoxlama nöqtəsi (Inspection point). The tenant can rename these and add more.

**`sites`**
- `id`, `tenant_id`
- `parent_id`: nullable; null means a top-level site
- `type_id` → `site_types`
- `name`, `address` (nullable), `active`
- `path ltree`: the materialised path of IDs, kept up to date by the service when a site is created or moved
- A GiST index on `path`.
- A site can't be moved under its own descendant. Deactivating a site doesn't change its children automatically: the UI warns, and the admin decides.

**`teams`**: `id`, `tenant_id`, `name`, `description`, `active`.

**`user_teams`**: `tenant_id`, `user_id`, `team_id`; primary key (`user_id`, `team_id`).

**`roles`**
- `id`, `tenant_id`, `name`
- `system_key`: nullable; one of `owner` | `admin` | `manager` | `worker` | `auditor`
- `data_scope`: `all` | `site_subtree` | `subordinates` | `own`
- `editable` (bool), `active`, `version` (int, incremented on every change)

**`role_permissions`**: `tenant_id`, `role_id`, `permission_key`; primary key (`role_id`, `permission_key`).

**`users`**
- `id`, `tenant_id`, `full_name`, `job_title` (nullable)
- `manager_id` → `users`, nullable. A user can't be their own manager, and the API rejects any change that would create a cycle.
- `role_id` → `roles`
- `kind`: `worker` | `staff`
- `email`: nullable. Required for `staff`. Must be **unique across all tenants**, compared case-insensitively (`citext`).
- `username`: nullable. Required for `worker`. Unique within its tenant (`unique (tenant_id, lower(username))`).
- `phone`: nullable, contact info only
- `credential_hash`: argon2id
- `credential_kind`: `password` | `pin`. Staff always use `password`; workers may use either.
- `email_verified_at`, `last_login_at`
- `failed_login_count`, `locked_until`
- `totp_secret_enc`: nullable, reserved for 2FA
- `status`: `active` | `deactivated` | `invited`
- `created_at`, `updated_at`

**`user_sites`**: `tenant_id`, `user_id`, `site_id`; primary key (`user_id`, `site_id`).

**`sessions`**
- `id`, `tenant_id`, `user_id`
- `family_id`: shared by every refresh token in one login chain
- `refresh_token_hash`: SHA-256
- `client`: `web` | `mobile`
- `user_agent`, `ip`
- `expires_at`, `revoked_at`, `replaced_by`
- `created_at`

**`auth_tokens`** (one-time tokens)
- `id`, `tenant_id`, `user_id`
- `purpose`: `email_verify` | `invite` | `password_reset`
- `token_hash`, `expires_at`, `used_at`

**`audit_log`** (append-only)
- `id`, `tenant_id`
- `actor_user_id`: nullable, null for system actions
- `actor_platform_admin_id`: nullable
- `action`: for example `user.created`, `user.deactivated`, `role.permissions_changed`, `auth.login_failed`
- `entity_type`, `entity_id`
- `before jsonb`, `after jsonb`
- `ip`, `user_agent`
- `occurred_at`
- The app account gets `INSERT` and `SELECT` only. `UPDATE` and `DELETE` are revoked (NFR-07.03).

**`platform_admins`** (not under RLS; only the platform account can access it)
- `id`, `email`, `credential_hash`, `full_name`, `active`, `created_at`

### 4.2 Permission keys (Foundation)

Permission keys are defined in code in `packages/contracts`. Later sub-projects add their own keys (for example `checklists.create`, `reports.view`).

| Key | Allows |
|---|---|
| `tenant.manage` | Edit org settings |
| `sites.view` / `sites.manage` | View / edit site types and the site tree |
| `teams.view` / `teams.manage` | View / edit teams and team membership |
| `users.view` / `users.manage` | View / create, edit, deactivate users and reset their credentials |
| `roles.view` / `roles.manage` | View / edit roles and their permissions |
| `audit.view` | Browse the audit log |

### 4.3 Built-in roles

Built-in roles are seeded for every new tenant.

| Role | Scope | Foundation permissions | Editable |
|---|---|---|---|
| Owner | `all` | all keys | No |
| Admin | `all` | all keys | Permissions yes; it can't be deleted |
| Manager | `site_subtree` | `sites.view`, `teams.view`, `users.view` | Yes |
| Worker | `own` | none | Yes |
| Auditor | `all` | `sites.view`, `users.view`, `audit.view` | Yes |

Custom roles start with no permissions and scope `own`.

Each tenant must always have at least one active Owner:
- The API refuses to deactivate the last Owner or to change the last Owner's role.
- Only an Owner can give the Owner role to someone else.

### 4.4 Data scope semantics

`ScopeService.forUser(principal)` returns a filter that the list and detail queries for users (and, later, for checklists and results) apply:

- **`all`:** no extra filter.
- **`site_subtree`:** rows linked to any site whose `path` is under one of the user's `user_sites`. For users, this means users who have at least one site in that subtree.
- **`subordinates`:** the user and everyone who reports to them, directly or indirectly, found with a recursive query on `manager_id`.
- **`own`:** only the user themselves.

Scope only limits rows that a permission already allows; it never grants access on its own. Example: a Manager with `users.view` and scope `site_subtree` sees only the users at their sites.

## 5. Authentication

### 5.1 Endpoints

All endpoints are under `/api/v1/auth`.

| Endpoint | Input | Notes |
|---|---|---|
| `POST /signup` | org name, org code, owner full name, email, password | Creates the tenant, seeds site types and roles, creates the Owner (`status=active`, email not verified), sends a verification email. Done in one transaction. |
| `POST /verify-email` | token | Sets `email_verified_at`. Until the email is verified, the Owner can log in but sees a banner, and invites are blocked. |
| `POST /login/staff` | email, password, client | Looks up the user by email across all tenants (using the platform account, read-only for this lookup), then continues inside that tenant's context. |
| `POST /login/worker` | org code, username, secret, client | Looks up the tenant by `org_code`, then the user by username within that tenant. |
| `POST /refresh` | refresh token (from the cookie on web, from the request body on mobile) | Replaces the refresh token with a new one. |
| `POST /logout` | — | Cancels the current session. |
| `POST /invite/accept` | token, password | Sets the password and changes the user from `invited` to `active`. |
| `POST /password/forgot` | email | Always responds 200, so the endpoint doesn't reveal whether an email exists. Staff only. |
| `POST /password/reset` | token, new password | Cancels all of the user's sessions. |
| `POST /credential/change` | current secret, new secret | For the logged-in user. Cancels the user's other sessions. |

Login fails if the tenant is `suspended` or the user isn't `active`. The error shown to the user is the same generic message for a wrong secret, an unknown user or a deactivated account. The audit log records the specific reason.

### 5.2 Tokens and sessions

- **Access token:** a JWT signed with EdDSA (Ed25519) that lasts 15 minutes. It contains `sub` (user ID), `tid` (tenant ID), `rid` (role ID), `rv` (role version) and `kind`.
- **Refresh token:** 32 random bytes, sent to the client as base64url; only its SHA-256 hash is stored.
  - Web sessions last 7 days, mobile sessions 30 days. Every refresh restarts that period.
  - **Web:** the refresh token sits in a `HttpOnly; Secure; SameSite=Strict` cookie scoped to the path `/api/v1/auth`. The access token is kept in memory only.
  - **Mobile:** both tokens are stored in Expo SecureStore.
- **Rotation:** every refresh issues a new token and marks the old one as `replaced_by`. If an already-replaced token is presented again, the API cancels the whole `family_id` chain and records `auth.refresh_reuse_detected` in the audit log.
- **Deactivating a user** or **resetting their credential** cancels all of that user's sessions. Their existing access token keeps working for at most 15 minutes. A role change increments `roles.version`, so tokens with an old `rv` get their permissions reloaded (see §6).

### 5.3 Credential rules

- Hashing: argon2id, with parameters set in config (starting point: 19 MiB of memory, 2 iterations, parallelism 1, per the OWASP baseline).
- Passwords: at least 10 characters, at most 128. No rules about character types.
- PINs: exactly 6 digits. Obvious sequences such as `123456` and `000000` are rejected.

### 5.4 Brute-force protection

- **Per account:** after 5 failed logins in a row, `locked_until` is set to now + 15 minutes. A successful login resets the counter. Admins can unlock an account early through credential reset.
- **Per IP and per endpoint:** a fixed-window rate limit of 20 login attempts per minute per IP, plus 10 per minute per `org_code + username`. The counters live in a Postgres `rate_limits` table so they keep working if more than one API instance runs.
- A locked or rate-limited request returns `429` with `retryAfterSeconds`. Both apps show "try again in N minutes".

## 6. Request pipeline

1. **`AuthGuard`** checks the JWT and builds `principal = { userId, tenantId, roleId, roleVersion, kind }`. Public routes are marked `@Public()`.
2. **`TenantContextInterceptor`** opens a Drizzle transaction on the app connection and runs `SET LOCAL app.tenant_id = $tid, app.user_id = $uid`. It stores that transaction in `AsyncLocalStorage`, so every repository call during the request uses it automatically. The transaction commits on success and rolls back on any error.
3. **`PermissionGuard`** reads `@RequirePermission(...keys)` from the route and checks the principal's role permissions. Role permissions are cached in process memory per `(roleId, version)`; an `rv` mismatch reloads them. The guard also rejects requests if the tenant is suspended, checked through the same cache with a 60-second lifetime.
4. **Services** apply `ScopeService` filters (§4.4) to their queries.
5. **`AuditService.record(...)`** runs inside the same transaction, so the audit entry is saved only if the change is saved.

**Database accounts:**

| Account | Used by | Privileges |
|---|---|---|
| `taskop_owner` | migrations only | owns the schema |
| `taskop_app` | the API, for all tenant requests | DML on tenant tables. RLS is forced. No `UPDATE`/`DELETE` on `audit_log`. |
| `taskop_platform` | the `platform` module and the cross-tenant login lookup | `BYPASSRLS`. Used only through a separately injected connection. |

## 7. API surface (beyond auth)

All endpoints are under `/api/v1`, use JSON, and validate input and output against the Zod contracts. List endpoints use cursor-based pagination (`?cursor=&limit=`, default 50, maximum 200) and endpoint-specific filters.

| Resource | Endpoints | Permission |
|---|---|---|
| Tenant | `GET /tenant`, `PATCH /tenant` | any logged-in user / `tenant.manage` |
| Site types | `GET, POST /site-types`, `PATCH /site-types/:id` | `sites.view` / `sites.manage` |
| Sites | `GET /sites` (flat list with `path`; the client builds the tree), `POST /sites`, `PATCH /sites/:id`, `POST /sites/:id/move` | `sites.view` / `sites.manage` |
| Teams | `GET, POST /teams`, `PATCH /teams/:id`, `PUT /teams/:id/members` | `teams.view` / `teams.manage` |
| Roles | `GET /roles`, `GET /permissions` (key catalogue with i18n labels), `POST /roles`, `PATCH /roles/:id`, `PUT /roles/:id/permissions` | `roles.view` / `roles.manage` |
| Users | `GET /users` (filter by status, role, team, site, search), `GET /users/:id`, `POST /users/workers`, `POST /users/invite`, `PATCH /users/:id`, `POST /users/:id/deactivate`, `POST /users/:id/reactivate`, `POST /users/:id/reset-credential`, `PUT /users/:id/sites`, `PUT /users/:id/teams` | `users.view` / `users.manage`, with scope applied |
| Me | `GET /me` (profile, role, permissions, tenant) | any logged-in user |
| Audit | `GET /audit-log` (filter by actor, action, entity, date range) | `audit.view` |
| Platform | `POST /platform/auth/login`, `GET /platform/tenants`, `POST /platform/tenants/:id/suspend`, `POST /platform/tenants/:id/reactivate` | platform admin token (separate JWT audience) |

**Actions written to the audit log in this sub-project:**
- Every create, update, deactivate or reactivate of users, roles, role permissions, sites, site types, teams and tenant settings
- Credential resets
- Successful and failed logins
- Refresh-token reuse detection
- Tenant suspension and reactivation

**Error format** (every error response):

```json
{ "error": { "code": "USER_USERNAME_TAKEN", "messageKey": "errors.user.usernameTaken", "fields": { "username": "errors.user.usernameTaken" }, "retryAfterSeconds": null } }
```

Error codes are defined as an enum in `packages/contracts`. The clients translate `messageKey`, and form libraries map `fields` onto the matching inputs. Unexpected errors return `INTERNAL` with a `requestId`; the details go to the logs only.

## 8. Web app

- **Libraries:**
  - React + Vite
  - TanStack Router (type-safe routes) and TanStack Query
  - Tailwind CSS + shadcn/ui
  - react-hook-form + Zod resolvers using the `contracts` schemas
  - i18next
- **Layout:** a sidebar shell modelled on the mockup on p. 21 of the product document. Only Foundation menu items are visible. A menu item is shown only if the user has the permission for it (FR-25.04 / NFR-02.03).
- **Screens:**
  - Sign-up, email verification, login, accept invite, forgot/reset password
  - Org settings (name, timezone; locale fixed to `az` for now)
  - Site types list and site tree editor: expand and collapse, add a child, rename, change type, deactivate, and move via a "move to…" dialog. Drag-and-drop is not required.
  - Teams list with a member picker
  - Roles list and role editor: name, data scope, and a permission grid grouped by area
  - Users list (filters, search) and user editor: details, role, manager, teams, sites, status actions, credential reset that shows a generated PIN once
  - Audit log viewer with filters and a before/after diff view
  - Platform admin: login and a tenants list with suspend/reactivate (a separate route group)
- **Auth handling:** the access token lives in memory. A single shared refresh request runs when the token is about to expire or when the API returns 401. If refresh fails, the user is sent to the login page.

## 9. Mobile app

- **Libraries:** Expo (latest SDK), Expo Router, TanStack Query, i18next, Expo SecureStore.
- **Screens:**
  - Login: org code, username, PIN. The org code is remembered after the first successful login and can be changed.
  - Home: a placeholder in the layout of the mockup on p. 20 that greets the user by name. The checklist widgets are empty placeholders until sub-project 4.
  - Profile: name, role, tenant, change PIN/password, logout.
- Staff (managers) can also log in on mobile with email + password, using a toggle on the login screen.
- **Token handling:** automatic refresh. When offline, the app keeps the user logged in using cached profile data. Offline *execution* is built in sub-project 4.

## 10. Internationalisation and time

- All user-facing text in both apps and in API error message keys comes from `packages/i18n`. Azerbaijani (`az`) is the only complete language for now. The structure supports adding `en`, `ru` and `tr` later (NFR-12.02).
- Dates, times and numbers are formatted with `Intl` using the tenant's locale and timezone (NFR-12.03, NFR-13.02). The API always sends ISO-8601 UTC.

## 11. Local development, CI and operations

- **Docker Compose:** Postgres (latest stable, with `ltree` and `citext`), Mailpit, MinIO.
- **Commands:** `pnpm dev` starts the API, web and Expo dev server through Turborepo. `pnpm db:migrate` and `pnpm db:seed` set up a demo tenant with sample sites, users and roles.
- **Migrations:** Drizzle Kit migrations, plus hand-written SQL migrations for RLS policies, database accounts and grants, which are versioned in the same folder.
- **Configuration:** environment variables are validated with Zod when the API starts, and it refuses to start if any are missing.
- **Logging:** structured JSON logs with `requestId`, `tenantId` and `userId` in every line. Secrets and credentials are never logged.
- **Deployment:** a Dockerfile for the API and a static build for the web app. The mobile app builds with EAS. Choosing a production host is out of scope.
- **CI:** GitHub Actions runs install → lint → type-check → unit tests → integration tests (Postgres via Testcontainers) → web build.

## 12. Testing

- **API unit tests (Vitest):**
  - credential rules
  - token rotation and reuse detection
  - scope filter building
  - site path maintenance and cycle prevention
  - manager cycle prevention
  - the last-Owner protections
- **API integration tests (Vitest + Testcontainers Postgres):** run against a real database with migrations and RLS applied.
  - **Tenant isolation suite:** seed two tenants, then for every endpoint check that tenant B's token can't read, list, update or reference tenant A's records, including by guessing IDs. In addition, a direct SQL test confirms that `taskop_app` with no `app.tenant_id` set sees zero rows.
  - **Scope suite:** a Manager with `site_subtree` scope sees only users at their sites, and `subordinates` returns everyone below the user in the reporting chain.
  - **Auth flows:** sign-up → verify → login; worker login; account lockout; rate limiting; refresh rotation; reuse detection; deactivation cancels sessions.
  - **Audit:** each listed action writes exactly one entry with correct before/after values. `UPDATE` or `DELETE` on `audit_log` fails for `taskop_app`.
- **Web:** component tests (Vitest + Testing Library) for the permission grid, site tree editor and user editor. One Playwright end-to-end test: sign-up → create a site → create a worker → log out → log back in as admin and see the worker in the list.
- **Mobile:** unit tests for the auth store and refresh logic, plus a login screen render test (Jest + React Native Testing Library, the Expo default).

## 13. Requirement traceability

| Requirement | Where it's covered |
|---|---|
| FR-01.01–06 | Web + mobile apps (§8, §9). Store publishing happens when the app has real features (sub-project 4). |
| FR-02.01–02 | Sign-up (§5.1) |
| FR-02.03–04 | Worker accounts and staff invites (§5.1, §7) |
| FR-02.05–06 | `tenant_id` on every user; role and permissions (§4) |
| FR-03.01–03 | Tenant settings, site types, site tree (§4.1, §7) |
| FR-03.04 | Site IDs are ready for checklists to reference (sub-project 2) |
| FR-04.01–11 | Users module (§4.1, §7, §8) |
| FR-05.02–04 | Roles, permission keys, scopes (§4.2–4.4) |
| FR-25.01–04 | Permission-driven menus; `GET /me` (§7, §8) |
| FR-26.01–03 | Audit log, foundation part (§4.1, §7) |
| NFR-05.01–05 | TLS at deployment, argon2id, permission checks, RLS, scope (§5, §6) |
| NFR-05.06 | Reserved `totp_secret_enc` column; screens later |
| NFR-07.01–03 | Audit log contents and append-only grants (§4.1, §6) |
| NFR-12.01–03, NFR-13.01–02 | i18n and time handling (§10) |
| NFR-14.02 | RLS (§4, §6, §12) |

## 14. Open items for later sub-projects (not blockers)

- Production hosting provider and data-residency decision (NFR-14.01, NFR-09)
- Offline sync approach: a custom sync API or a Postgres sync engine (sub-project 4)
- Object storage provider for evidence files (sub-project 4)
- Push notification provider: Expo Push or FCM/APNs directly (sub-project 6)
