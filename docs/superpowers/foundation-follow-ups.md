# Foundation follow-ups

Non-blocking findings from the Foundation (sub-project 1) task reviews and final whole-branch review, 2026-10-08. None blocked the merge. Schedule them into a later sub-project or a hardening pass. The five items flagged as most worth doing (scope coverage for site leads, role edits by scoped actors, concurrent site moves, the fail-open scope switch and the log sanitiser gap) have been fixed and are no longer listed.

## Security and privilege model (API)

- **Manager outside scope.** `site_subtree` and `all` actors can set `managerId` to someone outside their scope; only `subordinates` actors are checked.
- **Account enumeration (parked by ruling).** `ACCOUNT_LOCKED` after 5 failures confirms that an account exists. This is intended UX per spec §5.4 and bounded by rate limits.
- **Rate-limit and lockout gaps.**
  - Forgot-password is limited per IP only (add a per-email key).
  - Platform-admin login has an IP limit but no per-account lockout and no audit.
  - The per-account login key can be exhausted by an attacker (account DoS).
  - Refresh families have sliding expiry with no absolute cap.
  - A replayed old refresh token writes a reuse-audit row every time.
- **Tokens and crypto.**
  - `jwtVerify` lacks `requiredClaims: ['exp','sub']`.
  - The dummy-hash promise is unguarded.
  - The platform-admin script hard-codes argon2 parameters.
- **`setupDatabase`** doesn't reset `BYPASSRLS`/`NOBYPASSRLS` on existing roles, so privilege drift isn't self-healed.
- **Non-transactional status change.** Platform `setStatus` (status update, session revocation and audit) isn't one transaction, and no-op transitions re-audit.
- **Audit redaction.** The `/hash|secret|password|token|pin/` regex over-matches (e.g. `pinned`) and under-matches (authorization, cookie, otp). `redactSecrets` has no cycle guard.
- **Users edge cases.**
  - Reactivating back to `invited` doesn't issue a new invite.
  - Pending invite/reset tokens aren't invalidated on deactivation.
  - `assertIdsExist` accepts inactive sites/teams/managers.
  - Staff reset ignores `secret`/`credentialKind` in the body without saying so.
- **DB context edge cases.**
  - Nested `withTenant` ignores the inner `userId` and has no savepoint.
  - An escaped promise can reuse a finished transaction.
  - There is one module-level AsyncLocalStorage.
  - The interceptor collapses streamed responses.
- **Error mapping.** `HttpException` 405/409/429/503 become `INTERNAL`. The pg-code regex also matches Node errno codes. `req.url` with a query string is logged, and `x-request-id` is echoed without charset validation.
- **Sign-up mail log** includes `to` and the raw error (PII and SMTP detail).

## Web

- **Platform admin.**
  - A 401 from suspend/reactivate doesn't sign the admin out; `onSessionExpired` is dead code with `refresh: false`.
  - The platform query cache survives sign-out.
  - Platform requests send the tenant cookie (`credentials: 'include'`).
  - `/platform/login` doesn't redirect an admin who is already signed in.
- **Users.**
  - `['users','active-all']` isn't invalidated after user changes.
  - `setSites` followed by `setTeams` can partially save.
  - The detail page queries sites, teams and users without permission checks.
  - The invite dialog isn't reset on cancel.
  - `form.watch` → `useWatch`, which also clears the one lint warning.
  - The clipboard `writeText` failure is unhandled.
- **Sites.** The move dialog has no pending guard, the site-type name is untrimmed, a leaf's expand button has an accessibility issue, and the target's `active` flag isn't checked on move.
- **Roles.** The refresh closure captures `selected`, there's no success toast on toggle, and the `roles.locked` text mentions Owner for any non-editable role.
- **Audit.** Date filters use the browser's local day, not the tenant timezone (plan-accepted; revisit in reports). The diff is top-level only, and `from > to` isn't validated.
- **Session.**
  - `LoginForm` doesn't await `onSuccess`.
  - The verify page conflates a `me()` failure with a verify failure.
  - `signOut` doesn't clear local state on a non-`ApiError`.
  - There's no bootstrap timeout.
  - Anonymous loads always make two `/auth/refresh` calls 300 ms apart.
- **API client.** A stale token can trigger a second refresh, and `onSessionExpired` fires once per concurrent failed request.
- **Misc.** An unknown `messageKey` renders the raw key. The `shadcn` CLI is a runtime dependency. CheckboxList's search input lacks an `aria-label`. `teams.searchMembers` is unused.

## Mobile

- Unknown field-error keys on change-secret show nothing.
- If `rememberOrgCode` fails after a successful login, the user sees an error anyway.
- `fieldErrors` aren't cleared on the worker/staff toggle.
- The offline banner uses hard-coded colours and has no accessibility role, and `Field` errors lack an alert role.
- The `Screen` component's `scroll` prop isn't implemented.
- Template `AGENTS.md` and `.expo` boilerplate are still in `apps/mobile`.
- `apps/mobile` is on TypeScript 6.0.3 (the Expo pin); move to TS 7 when Expo supports it.

## Tooling, CI and Docker

- `@taskop/config` pins TypeScript 6 for typescript-eslint (it can't load TS 7). Remove the pin once typescript-eslint supports TS 7, and drop the duplicate root ESLint devDependencies.
- Mailpit and MinIO use `:latest` images.
- **Dockerfile.** It uses `pnpm@latest` instead of the pinned version, has no `HEALTHCHECK`, isn't built in CI, and `.dockerignore` only excludes `**/.env` (not `.env.*`).
- **CI.** No `permissions` or `concurrency` settings. The e2e job runs `touch .env` without a comment, rebuilds, and its artifact name doesn't match the uploaded path. `retries: 1` may hide flakiness. Consider adding `expo-doctor`.
- **Swagger** is public in production. Gate it by environment or a flag.
- **README** doesn't label the demo credentials as dev-only.
- **Zod config.** `zod-config` maps `too_small` to `tooShort` for numbers and arrays. Consider making `zod` a peerDependency of `contracts`.

## Test coverage gaps

- **Contracts:** `pageOf`, `cursorQuerySchema`, `permissionKeySchema`, `SYSTEM_ROLE_DEFAULTS`.
- **Auth:**
  - cookie clearing on failed web refresh and on logout;
  - suspended-tenant refresh;
  - the per-account limit;
  - the resend-verification 3/h limit;
  - `alg: none` and wrong-issuer tokens.
- **RLS:**
  - the `tenants` policy with a tenant context set;
  - INSERT/UPDATE denial on `platform_admins`/`rate_limits`.
- **Isolation suite:**
  - no non-empty guard on tenant A's ids;
  - 422 cases check the status only, not the error code;
  - one-directional (B probing A only);
  - doesn't cover `/tenant`, `/me`, `/permissions` or platform routes with a tenant token.
- **Scope:** recursive cycle, multi-site principals, a hard-coded user count.
- **Audit log:** `to`, actor and entity filters; platform and system actor types.
- **Web:** settings forms, AppShell, AuditPage, role editor, and the toast/error paths.
