# Taskop Foundation — Part 1: Monorepo, Contracts & API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pnpm/Turborepo monorepo, the shared `@taskop/contracts` and `@taskop/i18n` packages, and the complete Foundation REST API (tenancy, auth, users, roles, sites, teams, audit, platform admin) with RLS-enforced tenant isolation.

**Architecture:** NestJS modular monolith on PostgreSQL via Drizzle ORM. Every request that has a logged-in user runs inside one transaction that sets `app.tenant_id`, so Row-Level Security filters every query. Request/response shapes live in `packages/contracts` (Zod) and are shared with the web and mobile apps (Parts 2 and 3).

**Tech Stack:** Node 24, pnpm 12, Turborepo 2, TypeScript 7, NestJS 12 (Express), nestjs-zod 5 + Zod 4, Drizzle ORM 0.45 + drizzle-kit, PostgreSQL 18 (`ltree`, `citext`), `@node-rs/argon2`, `jose` (EdDSA JWT), nodemailer, nestjs-pino, Vitest 5 + unplugin-swc, Testcontainers, supertest.

**Spec:** `docs/superpowers/specs/2026-10-07-foundation-design.md`

**This plan is Part 1 of 3:**
- Part 1 (this file): monorepo, contracts, i18n base, API.
- Part 2: `docs/superpowers/plans/2026-10-07-foundation-2-web.md`: API client package + web app.
- Part 3: `docs/superpowers/plans/2026-10-07-foundation-3-mobile.md`: Expo mobile app.

## Global Constraints

- Product name in every user-visible string and identifier is **Taskop** (never "Checkly"). Package scope `@taskop/*`.
- Latest stable versions: always install with `pnpm add <pkg>@latest` (never copy old version numbers). Versions verified on 2026-10-07: pnpm 12.9, turbo 2.11, typescript 7.0, @nestjs/core 12.1, drizzle-orm 0.45, zod 4.6, nestjs-zod 5.5, vitest 5.0, jose 6.2, @node-rs/argon2 2.2. If an installed library's API differs from code in this plan, adapt to the installed version and note it in the commit message.
- Node ≥ 24 (`require(esm)` is relied on: the CommonJS API imports ESM workspace packages).
- IDs are UUIDv7; timestamps are `timestamptz` (UTC); API sends ISO-8601 UTC strings.
- Every tenant-owned table: `tenant_id uuid not null`, RLS `FORCE`d with policy on `nullif(current_setting('app.tenant_id', true), '')::uuid`; relations between tenant-owned tables use composite `(tenant_id, x_id)` foreign keys.
- Users, sites, teams, roles are never deleted (deactivate only).
- DB accounts: `taskop_owner` (migrations), `taskop_app` (API, RLS forced, no UPDATE/DELETE on `audit_log`), `taskop_platform` (`BYPASSRLS`, platform module + pre-auth lookups only).
- Access token: EdDSA JWT, 15 min, claims `sub, tid, rid, rv, kind, sid`, audience `taskop-app`. Refresh: opaque `<tenantId>.<43 base64url chars>`, SHA-256 stored, rotation, reuse detection; web 7 days (cookie `taskop_rt`, `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`), mobile 30 days (body).
- argon2id (OWASP baseline 19 MiB / 2 iterations / parallelism 1, configurable). Passwords 10–128 chars. PINs exactly 6 digits, weak sequences rejected.
- Lockout: 5 consecutive failures → 15 min. Rate limits: 20 login attempts/min per IP, 10/min per account key; 429 with `retryAfterSeconds`.
- Error body for every error: `{ "error": { "code", "messageKey", "fields", "retryAfterSeconds", "requestId" } }`; `messageKey = "errors." + code`; field messages are i18n keys.
- All user-facing text is i18n keys; Azerbaijani (`az`) is the only locale. Default timezone `Asia/Baku`.
- No Redis or other runtime services beyond Postgres (MinIO only sits in docker-compose for later).

## Review Focus

The five uncovered input classes most likely to bite users, with the task that pins each:

1. **Concurrent refresh with the same token** (two browser tabs, or app resume + in-flight request): expected to keep the user logged in, not trip reuse detection. A 30-second grace window returns 401 without revoking the family. Pinned in Task 10 (`reuse within grace window does not revoke the family`).
2. **Case/whitespace/Unicode in identifiers**: ` ACME ` org code, `Elvin` vs `elvin` username, `Owner@X.az` vs `owner@x.az` email: expected to be treated as the same identity; Azerbaijani letters in usernames rejected with a clear field error. Pinned in Task 3 (schemas), Task 9 (email duplicate), Task 10 (login normalization), Task 17 (username duplicate + `əli`).
3. **Manager with `site_subtree` scope but no sites assigned**: expected to see only themselves, never the whole tenant. Pinned in Task 13.
4. **Self-destructive admin actions** (deactivating yourself, changing your own role, a non-owner demoting the owner, granting permissions you don't hold): expected to be refused with a specific error. Pinned in Task 17.
5. **Login/credential errors that are 401 but not "session expired"** (`INVALID_CREDENTIALS` on change-PIN with the wrong current PIN): expected to show the error, never trigger a refresh/logout loop. Pinned in Task 12 (API returns `INVALID_CREDENTIALS`, not `UNAUTHENTICATED`) and Part 2 Task W1 (client refreshes only on `UNAUTHENTICATED`).

---

## File Structure

```
taskop/
├─ package.json, pnpm-workspace.yaml, turbo.json, .prettierrc, .prettierignore, .gitignore, .npmrc
├─ docker-compose.yml
├─ .github/workflows/ci.yml
├─ packages/
│  ├─ config/        tsconfig.base.json, tsconfig.lib.json, eslint.js
│  ├─ contracts/src/ zod-config.ts, errors.ts, permissions.ts, credentials.ts, common.ts,
│  │                 auth.ts, tenant.ts, sites.ts, teams.ts, roles.ts, users.ts, audit.ts, platform.ts, index.ts
│  └─ i18n/src/      index.ts, format.ts, az/{index,common,errors}.ts   (UI namespaces added in Parts 2–3)
└─ apps/api/
   ├─ .swcrc, vitest.config.ts, drizzle.config.ts, tsconfig.json, Dockerfile, .env.example
   ├─ drizzle/                         SQL migrations (0000_extensions, 0001_init, 0002_security)
   ├─ src/
   │  ├─ main.ts, app.module.ts, app.setup.ts
   │  ├─ config/config.ts, config/config.module.ts
   │  ├─ common/  app-error.ts, error.filter.ts, pg-errors.ts, request.ts, request-context.ts,
   │  │           decorators.ts, parse-id.pipe.ts, scope.service.ts, common.module.ts, logger.ts, sql.ts
   │  ├─ db/      schema.ts, column-types.ts, db.service.ts, db.module.ts, audit.service.ts,
   │  │           tenant-context.interceptor.ts, setup.ts, scripts/setup.ts, scripts/seed.ts
   │  ├─ mail/    mailer.ts, templates.ts, mail.module.ts
   │  ├─ auth/    crypto/{password-hasher,token.service,opaque-token,secret-generator}.ts,
   │  │           rate-limit.service.ts, one-time-token.service.ts, session.service.ts, me.service.ts,
   │  │           login-lookup.ts, auth.service.ts, credential.service.ts, principal-loader.ts,
   │  │           auth.guard.ts, permission.guard.ts, cookies.ts, auth.controller.ts, me.controller.ts,
   │  │           dto.ts, auth.module.ts
   │  ├─ tenancy/ bootstrap.ts, tenant.{controller,service}.ts, site-types.{controller,service}.ts,
   │  │           sites.{controller,service}.ts, dto.ts, tenancy.module.ts
   │  ├─ roles/   permission-resolver.ts, roles.{controller,service}.ts, dto.ts, roles.module.ts
   │  ├─ teams/   teams.{controller,service}.ts, dto.ts, teams.module.ts
   │  ├─ users/   users.{controller,service}.ts, user-mapper.ts, dto.ts, users.module.ts
   │  ├─ audit-log/ audit-log.{controller,service}.ts, dto.ts, audit-log.module.ts
   │  ├─ platform/  platform.{controller,service}.ts, platform.guard.ts, dto.ts, platform.module.ts
   │  ├─ health/health.controller.ts
   │  └─ scripts/generate-keys.ts, scripts/create-platform-admin.ts
   └─ test/  global-setup.ts, app.ts, fixtures.ts, memory-mailer.ts, owner-db.ts, *.test.ts
```

---

### Task 1: Monorepo scaffold, shared config, local services

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.npmrc`, `.prettierrc`, `.prettierignore`, `docker-compose.yml`
- Modify: `.gitignore`
- Create: `packages/config/package.json`, `packages/config/tsconfig.base.json`, `packages/config/tsconfig.lib.json`, `packages/config/eslint.js`

**Interfaces:**
- Produces: `@taskop/config/tsconfig.base.json`, `@taskop/config/tsconfig.lib.json`, `@taskop/config/eslint` (flat config array). Root scripts `dev, build, lint, typecheck, test, db:setup, db:seed`.

- [ ] **Step 1: Install pnpm 12 globally and verify**

Run: `npm install -g pnpm@latest && pnpm -v`
Expected: prints `12.x.x`.

- [ ] **Step 2: Create root files**

`package.json`:
```json
{
  "name": "taskop",
  "private": true,
  "packageManager": "pnpm@12.9.1",
  "engines": { "node": ">=24" },
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "db:setup": "pnpm --filter @taskop/api db:setup",
    "db:seed": "pnpm --filter @taskop/api db:seed",
    "format": "prettier --write ."
  }
}
```
(Set `packageManager` to the exact version printed in Step 1.)

`pnpm-workspace.yaml`:
```yaml
packages:
  - apps/*
  - packages/*
```

`turbo.json`:
```json
{
  "$schema": "https://turborepo.com/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "dev": { "dependsOn": ["^build"], "cache": false, "persistent": true },
    "typecheck": { "dependsOn": ["^build"] },
    "lint": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"], "cache": false }
  }
}
```

`.npmrc`:
```
auto-install-peers=true
```

`.prettierrc`:
```json
{ "singleQuote": true, "trailingComma": "all", "printWidth": 110 }
```

`.prettierignore`:
```
dist
.turbo
pnpm-lock.yaml
apps/api/drizzle/meta
```

Replace `.gitignore` with:
```
.DS_Store
node_modules/
dist/
.turbo/
coverage/
.env
.env.*
!.env.example
*.tsbuildinfo
playwright-report/
test-results/
.expo/
```

- [ ] **Step 3: Create `packages/config`**

`packages/config/package.json`:
```json
{
  "name": "@taskop/config",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./tsconfig.base.json": "./tsconfig.base.json",
    "./tsconfig.lib.json": "./tsconfig.lib.json",
    "./eslint": "./eslint.js"
  }
}
```

`packages/config/tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "sourceMap": true
  }
}
```

`packages/config/tsconfig.lib.json` (ESM libraries):
```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "outDir": "${configDir}/dist",
    "rootDir": "${configDir}/src"
  },
  "include": ["${configDir}/src"],
  "exclude": ["${configDir}/src/**/*.test.ts"]
}
```

`packages/config/eslint.js`:
```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig(
  { ignores: ['**/dist/**', '**/.turbo/**', '**/coverage/**', '**/drizzle/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
```

Install shared dev tools at the root and in config:
```bash
pnpm add -w -D turbo@latest typescript@latest prettier@latest eslint@latest @eslint/js@latest typescript-eslint@latest
pnpm --filter @taskop/config add eslint@latest @eslint/js@latest typescript-eslint@latest
```
If pnpm prints "Ignored build scripts", run `pnpm approve-builds` and approve `@swc/core` and `esbuild` whenever they appear (now or in later tasks).

- [ ] **Step 4: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_DB: taskop
      POSTGRES_USER: taskop_owner
      POSTGRES_PASSWORD: owner_dev_password
    ports: ['5432:5432']
    volumes: ['pgdata:/var/lib/postgresql']
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U taskop_owner -d taskop']
      interval: 5s
      timeout: 3s
      retries: 10
  mailpit:
    image: axllent/mailpit:latest
    ports: ['1025:1025', '8025:8025']
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: taskop
      MINIO_ROOT_PASSWORD: taskop_dev_password
    ports: ['9000:9000', '9001:9001']
    volumes: ['miniodata:/data']
volumes:
  pgdata: {}
  miniodata: {}
```

- [ ] **Step 5: Verify**

Run: `pnpm install && docker compose up -d && docker compose ps`
Expected: install succeeds; `postgres` shows `healthy`, `mailpit` and `minio` `running`. (If port 5432 is taken locally, stop the other Postgres or change the host port to `5433:5432` and use 5433 in `.env` files.)

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json .npmrc .prettierrc .prettierignore .gitignore docker-compose.yml packages/config pnpm-lock.yaml
git commit -m "chore: scaffold Taskop monorepo with shared config and local services"
```

---

### Task 2: `@taskop/contracts` core — Zod error keys, error codes, permissions, credential rules

**Files:**
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/eslint.config.js`, `packages/contracts/vitest.config.ts`
- Create: `packages/contracts/src/zod-config.ts`, `src/errors.ts`, `src/permissions.ts`, `src/credentials.ts`, `src/common.ts`, `src/index.ts`
- Test: `packages/contracts/src/credentials.test.ts`, `src/errors.test.ts`

**Interfaces:**
- Produces (all exported from `@taskop/contracts`):
  - `ErrorCode` (const object + type), `ERROR_HTTP_STATUS: Record<ErrorCode, number>`, `errorMessageKey(code): string`, `errorBodySchema`, `ErrorBody`
  - `PERMISSION_GROUPS`, `PermissionKey`, `ALL_PERMISSIONS`, `permissionKeySchema`, `DATA_SCOPES`, `DataScope`, `dataScopeSchema`, `SYSTEM_ROLE_KEYS`, `SystemRoleKey`, `systemRoleKeySchema`, `SYSTEM_ROLE_DEFAULTS`
  - `isWeakPin(pin): boolean`, `pinSchema`, `passwordSchema`, `secretSchemaFor(kind)`, `credentialKindSchema`, `CredentialKind`, `orgCodeSchema`, `usernameSchema`, `emailSchema`
  - `idSchema`, `isoDateTimeSchema`, `cursorQuerySchema`, `pageOf(item)`, `Page<T>`
  - Side effect on import: `z.config({ customError })` so every default Zod message is an i18n key (`errors.validation.*`).

- [ ] **Step 1: Package setup**

`packages/contracts/package.json`:
```json
{
  "name": "@taskop/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "files": ["dist"],
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch --preserveWatchOutput",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint .",
    "test": "vitest run"
  }
}
```

`packages/contracts/tsconfig.json`:
```json
{ "extends": "@taskop/config/tsconfig.lib.json" }
```

`packages/contracts/eslint.config.js`:
```js
import base from '@taskop/config/eslint';
export default base;
```

`packages/contracts/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
```

Run:
```bash
pnpm --filter @taskop/contracts add zod@latest
pnpm --filter @taskop/contracts add -D vitest@latest typescript@latest eslint@latest "@taskop/config@workspace:*"
```

- [ ] **Step 2: Write the failing tests**

`packages/contracts/src/credentials.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { emailSchema, isWeakPin, orgCodeSchema, passwordSchema, pinSchema, usernameSchema } from './index.js';

describe('isWeakPin', () => {
  it.each(['000000', '111111', '123456', '654321', '234567', '987654', '123123', '112233', '121212'])(
    'flags %s as weak',
    (pin) => expect(isWeakPin(pin)).toBe(true),
  );
  it.each(['482915', '730184', '102938'])('accepts %s', (pin) => expect(isWeakPin(pin)).toBe(false));
});

describe('pinSchema', () => {
  it('requires exactly 6 digits', () => {
    expect(pinSchema.safeParse('12345').error?.issues[0]?.message).toBe('errors.validation.pinFormat');
    expect(pinSchema.safeParse('12a456').error?.issues[0]?.message).toBe('errors.validation.pinFormat');
  });
  it('rejects weak pins with a dedicated key', () => {
    expect(pinSchema.safeParse('123456').error?.issues[0]?.message).toBe('errors.validation.pinWeak');
  });
  it('accepts a strong pin', () => expect(pinSchema.parse('482915')).toBe('482915'));
});

describe('passwordSchema', () => {
  it('enforces 10..128 characters', () => {
    expect(passwordSchema.safeParse('short').error?.issues[0]?.message).toBe('errors.validation.passwordLength');
    expect(passwordSchema.safeParse('x'.repeat(129)).error?.issues[0]?.message).toBe(
      'errors.validation.passwordLength',
    );
    expect(passwordSchema.parse('long enough pw')).toBe('long enough pw');
  });
});

describe('identifier normalisation', () => {
  it('trims and lowercases org codes', () => expect(orgCodeSchema.parse('  ACME-1 ')).toBe('acme-1'));
  it('rejects org codes with invalid characters', () =>
    expect(orgCodeSchema.safeParse('acme_1').error?.issues[0]?.message).toBe('errors.validation.orgCode'));
  it('trims and lowercases usernames', () => expect(usernameSchema.parse(' Elvin.M ')).toBe('elvin.m'));
  it('rejects Azerbaijani letters in usernames', () =>
    expect(usernameSchema.safeParse('əli').error?.issues[0]?.message).toBe('errors.validation.username'));
  it('trims and lowercases emails', () => expect(emailSchema.parse(' Owner@Acme.AZ ')).toBe('owner@acme.az'));
  it('rejects invalid emails', () =>
    expect(emailSchema.safeParse('not-an-email').error?.issues[0]?.message).toBe('errors.validation.email'));
});
```

`packages/contracts/src/errors.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ERROR_HTTP_STATUS, ErrorCode, errorMessageKey } from './index.js';

describe('errors', () => {
  it('maps every code to an HTTP status', () => {
    for (const code of Object.values(ErrorCode)) expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
  });
  it('builds message keys', () => expect(errorMessageKey('NOT_FOUND')).toBe('errors.NOT_FOUND'));
});

describe('global zod error keys', () => {
  it('turns default messages into i18n keys', () => {
    const s = z.object({ name: z.string().min(1), age: z.number().max(3), tag: z.string() });
    const issues = s.safeParse({ name: '', age: 10 }).error!.issues;
    const byPath = Object.fromEntries(issues.map((i) => [i.path.join('.'), i.message]));
    expect(byPath).toEqual({
      name: 'errors.validation.required',
      age: 'errors.validation.tooLong',
      tag: 'errors.validation.required',
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @taskop/contracts test`
Expected: FAIL — cannot resolve `./index.js`.

- [ ] **Step 4: Implement**

`packages/contracts/src/zod-config.ts`:
```ts
import { z } from 'zod';

// Every default Zod message becomes an i18n key, so API field errors and client form
// errors are always translatable. Schema-specific `error` params take precedence.
z.config({
  customError: (iss) => {
    switch (iss.code) {
      case 'invalid_type':
        return iss.input === undefined || iss.input === null
          ? 'errors.validation.required'
          : 'errors.validation.invalid';
      case 'too_small':
        return iss.origin === 'string' && iss.minimum === 1
          ? 'errors.validation.required'
          : 'errors.validation.tooShort';
      case 'too_big':
        return 'errors.validation.tooLong';
      default:
        return 'errors.validation.invalid';
    }
  },
});
```

`packages/contracts/src/errors.ts`:
```ts
import { z } from 'zod';

export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  RATE_LIMITED: 'RATE_LIMITED',
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  REFERENCE_NOT_FOUND: 'REFERENCE_NOT_FOUND',
  ORG_CODE_TAKEN: 'ORG_CODE_TAKEN',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  USERNAME_TAKEN: 'USERNAME_TAKEN',
  TOKEN_INVALID: 'TOKEN_INVALID',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  LAST_OWNER: 'LAST_OWNER',
  OWNER_ROLE_RESTRICTED: 'OWNER_ROLE_RESTRICTED',
  ROLE_NOT_EDITABLE: 'ROLE_NOT_EDITABLE',
  ROLE_IN_USE: 'ROLE_IN_USE',
  ROLE_ESCALATION: 'ROLE_ESCALATION',
  SITE_CYCLE: 'SITE_CYCLE',
  MANAGER_CYCLE: 'MANAGER_CYCLE',
  SELF_MODIFICATION: 'SELF_MODIFICATION',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_LOCKED: 429,
  RATE_LIMITED: 429,
  TENANT_SUSPENDED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  REFERENCE_NOT_FOUND: 422,
  ORG_CODE_TAKEN: 409,
  EMAIL_TAKEN: 409,
  USERNAME_TAKEN: 409,
  TOKEN_INVALID: 400,
  EMAIL_NOT_VERIFIED: 403,
  LAST_OWNER: 409,
  OWNER_ROLE_RESTRICTED: 403,
  ROLE_NOT_EDITABLE: 409,
  ROLE_IN_USE: 409,
  ROLE_ESCALATION: 403,
  SITE_CYCLE: 409,
  MANAGER_CYCLE: 409,
  SELF_MODIFICATION: 409,
  INTERNAL: 500,
};

export const errorMessageKey = (code: ErrorCode): string => `errors.${code}`;

export const errorBodySchema = z.object({
  error: z.object({
    code: z.enum(ErrorCode),
    messageKey: z.string(),
    fields: z.record(z.string(), z.string()).nullable(),
    retryAfterSeconds: z.number().int().nullable(),
    requestId: z.string().nullable(),
  }),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;
```

`packages/contracts/src/permissions.ts`:
```ts
import { z } from 'zod';

export const PERMISSION_GROUPS = [
  { group: 'tenant', keys: ['tenant.manage'] },
  { group: 'sites', keys: ['sites.view', 'sites.manage'] },
  { group: 'teams', keys: ['teams.view', 'teams.manage'] },
  { group: 'users', keys: ['users.view', 'users.manage'] },
  { group: 'roles', keys: ['roles.view', 'roles.manage'] },
  { group: 'audit', keys: ['audit.view'] },
] as const;

export type PermissionKey = (typeof PERMISSION_GROUPS)[number]['keys'][number];
export const ALL_PERMISSIONS: readonly PermissionKey[] = PERMISSION_GROUPS.flatMap((g) => g.keys);
export const permissionKeySchema = z.enum(ALL_PERMISSIONS as [PermissionKey, ...PermissionKey[]]);

export const DATA_SCOPES = ['all', 'site_subtree', 'subordinates', 'own'] as const;
export type DataScope = (typeof DATA_SCOPES)[number];
export const dataScopeSchema = z.enum(DATA_SCOPES);

export const SYSTEM_ROLE_KEYS = ['owner', 'admin', 'manager', 'worker', 'auditor'] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];
export const systemRoleKeySchema = z.enum(SYSTEM_ROLE_KEYS);

export interface SystemRoleDefault {
  name: string;
  dataScope: DataScope;
  permissions: readonly PermissionKey[];
  editable: boolean;
}

// Owner always has every permission at runtime (resolved in code), even for keys added later.
export const SYSTEM_ROLE_DEFAULTS: Record<SystemRoleKey, SystemRoleDefault> = {
  owner: { name: 'Owner', dataScope: 'all', permissions: ALL_PERMISSIONS, editable: false },
  admin: { name: 'Admin', dataScope: 'all', permissions: ALL_PERMISSIONS, editable: true },
  manager: { name: 'Manager', dataScope: 'site_subtree', permissions: ['sites.view', 'teams.view', 'users.view'], editable: true },
  worker: { name: 'Worker', dataScope: 'own', permissions: [], editable: true },
  auditor: { name: 'Auditor', dataScope: 'all', permissions: ['sites.view', 'users.view', 'audit.view'], editable: true },
};
```

`packages/contracts/src/credentials.ts`:
```ts
import { z } from 'zod';

export const credentialKindSchema = z.enum(['password', 'pin']);
export type CredentialKind = z.infer<typeof credentialKindSchema>;

const WEAK_PINS = new Set(['123123', '112233', '121212', '696969', '101010', '111222', '159753']);

export function isWeakPin(pin: string): boolean {
  if (!/^\d{6}$/.test(pin)) return false;
  if (WEAK_PINS.has(pin)) return true;
  if (/^(\d)\1{5}$/.test(pin)) return true;
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]!);
  return steps.every((s) => s === 1) || steps.every((s) => s === -1);
}

export const pinSchema = z
  .string()
  .regex(/^\d{6}$/, { error: 'errors.validation.pinFormat' })
  .refine((p) => !isWeakPin(p), { error: 'errors.validation.pinWeak' });

export const passwordSchema = z
  .string()
  .min(10, { error: 'errors.validation.passwordLength' })
  .max(128, { error: 'errors.validation.passwordLength' });

export const secretSchemaFor = (kind: CredentialKind) => (kind === 'pin' ? pinSchema : passwordSchema);

export const orgCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$/, { error: 'errors.validation.orgCode' });

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, { error: 'errors.validation.username' });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, { error: 'errors.validation.email' })
  .pipe(z.email({ error: 'errors.validation.email' }));
```

`packages/contracts/src/common.ts`:
```ts
import { z } from 'zod';

export const idSchema = z.uuid();
export const isoDateTimeSchema = z.iso.datetime();

export const cursorQuerySchema = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.uuid().nullable() });

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
```

`packages/contracts/src/index.ts`:
```ts
import './zod-config.js';

export * from './errors.js';
export * from './permissions.js';
export * from './credentials.js';
export * from './common.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @taskop/contracts test && pnpm --filter @taskop/contracts build`
Expected: all tests PASS; `packages/contracts/dist/index.js` and `index.d.ts` exist.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts pnpm-lock.yaml
git commit -m "feat(contracts): add error codes, permissions, credential rules and zod i18n keys"
```

---

### Task 3: `@taskop/contracts` resource schemas

**Files:**
- Create: `packages/contracts/src/auth.ts`, `tenant.ts`, `sites.ts`, `teams.ts`, `roles.ts`, `users.ts`, `audit.ts`, `platform.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/resources.test.ts`

**Interfaces:**
- Consumes: Task 2 exports.
- Produces (schemas, plus `type XInput = z.input<…>` for inputs and `type X = z.infer<…>` for DTOs):
  - auth: `clientSchema` (`'web'|'mobile'`), `signupInputSchema`, `loginStaffInputSchema`, `loginWorkerInputSchema`, `refreshInputSchema`, `verifyEmailInputSchema`, `inviteAcceptInputSchema`, `forgotPasswordInputSchema`, `resetPasswordInputSchema`, `changeCredentialInputSchema`, `meSchema`/`Me`, `loginResultSchema`/`LoginResult`
  - tenant: `timezoneSchema`, `tenantDtoSchema`/`TenantDto`, `updateTenantInputSchema`
  - sites: `siteTypeDtoSchema`/`SiteTypeDto`, `createSiteTypeInputSchema`, `updateSiteTypeInputSchema`, `siteDtoSchema`/`SiteDto`, `createSiteInputSchema`, `updateSiteInputSchema`, `moveSiteInputSchema`
  - teams: `teamDtoSchema`/`TeamDto`, `createTeamInputSchema`, `updateTeamInputSchema`, `setTeamMembersInputSchema`
  - roles: `roleDtoSchema`/`RoleDto`, `createRoleInputSchema`, `updateRoleInputSchema`, `setRolePermissionsInputSchema`, `permissionCatalogSchema`/`PermissionCatalog`
  - users: `userStatusSchema`, `userKindSchema`, `userDtoSchema`/`UserDto`, `userListQuerySchema`, `createWorkerInputSchema`, `inviteStaffInputSchema`, `updateUserInputSchema`, `setUserSitesInputSchema`, `setUserTeamsInputSchema`, `resetCredentialInputSchema`, `userWithSecretSchema`/`UserWithSecret`
  - audit: `auditEntryDtoSchema`/`AuditEntryDto`, `auditListQuerySchema`
  - platform: `platformLoginInputSchema`, `platformLoginResultSchema`/`PlatformLoginResult`, `platformTenantDtoSchema`/`PlatformTenantDto`, `platformTenantListQuerySchema`

- [ ] **Step 1: Write the failing test**

`packages/contracts/src/resources.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  createWorkerInputSchema,
  loginWorkerInputSchema,
  meSchema,
  timezoneSchema,
  userListQuerySchema,
} from './index.js';

const id = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f';

describe('createWorkerInputSchema', () => {
  const base = { fullName: 'Elvin Məmmədov', username: 'Elvin', roleId: id };
  it('defaults to pin credentials and empty assignments', () => {
    expect(createWorkerInputSchema.parse(base)).toMatchObject({
      username: 'elvin',
      credentialKind: 'pin',
      siteIds: [],
      teamIds: [],
    });
  });
  it('validates a provided secret against the credential kind', () => {
    const r = createWorkerInputSchema.safeParse({ ...base, secret: '123456' });
    expect(r.error?.issues[0]).toMatchObject({ path: ['secret'], message: 'errors.validation.pinWeak' });
  });
  it('accepts a password when kind is password', () => {
    expect(
      createWorkerInputSchema.parse({ ...base, credentialKind: 'password', secret: 'a long password' }).secret,
    ).toBe('a long password');
  });
});

describe('loginWorkerInputSchema', () => {
  it('normalises org code and username without enforcing formats', () => {
    expect(
      loginWorkerInputSchema.parse({ orgCode: ' ACME ', username: ' Elvin ', secret: 'x', client: 'mobile' }),
    ).toMatchObject({ orgCode: 'acme', username: 'elvin' });
  });
});

describe('userListQuerySchema', () => {
  it('coerces limit and defaults to 50', () => {
    expect(userListQuerySchema.parse({}).limit).toBe(50);
    expect(userListQuerySchema.parse({ limit: '10' }).limit).toBe(10);
    expect(userListQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });
});

describe('timezoneSchema', () => {
  it('accepts IANA zones and rejects unknown ones', () => {
    expect(timezoneSchema.parse('Asia/Baku')).toBe('Asia/Baku');
    expect(timezoneSchema.safeParse('Mars/Base').error?.issues[0]?.message).toBe('errors.validation.timezone');
  });
});

describe('meSchema', () => {
  it('parses a full profile', () => {
    expect(
      meSchema.parse({
        user: { id, fullName: 'A B', jobTitle: null, kind: 'staff', email: 'a@b.az', username: null, emailVerified: true, credentialKind: 'password' },
        role: { id, name: 'Owner', systemKey: 'owner', dataScope: 'all' },
        permissions: ['users.view'],
        tenant: { id, name: 'Acme', orgCode: 'acme', timezone: 'Asia/Baku', locale: 'az' },
      }).role.systemKey,
    ).toBe('owner');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @taskop/contracts test`
Expected: FAIL — `createWorkerInputSchema` is not exported.

- [ ] **Step 3: Implement the schemas**

`packages/contracts/src/auth.ts`:
```ts
import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common.js';
import { credentialKindSchema, emailSchema, orgCodeSchema, passwordSchema } from './credentials.js';
import { dataScopeSchema, permissionKeySchema, systemRoleKeySchema } from './permissions.js';

export const clientSchema = z.enum(['web', 'mobile']);
export type Client = z.infer<typeof clientSchema>;

const loginIdentifier = z.string().trim().toLowerCase().min(1).max(254);
const tokenString = z.string().min(10).max(512);

export const signupInputSchema = z.object({
  orgName: z.string().trim().min(2).max(120),
  orgCode: orgCodeSchema,
  fullName: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: passwordSchema,
  client: clientSchema,
});
export type SignupInput = z.input<typeof signupInputSchema>;

export const loginStaffInputSchema = z.object({
  email: loginIdentifier,
  password: z.string().min(1).max(128),
  client: clientSchema,
});
export type LoginStaffInput = z.input<typeof loginStaffInputSchema>;

export const loginWorkerInputSchema = z.object({
  orgCode: loginIdentifier,
  username: loginIdentifier,
  secret: z.string().min(1).max(128),
  client: clientSchema,
});
export type LoginWorkerInput = z.input<typeof loginWorkerInputSchema>;

export const refreshInputSchema = z.object({ refreshToken: tokenString.optional() });
export type RefreshInput = z.input<typeof refreshInputSchema>;

export const verifyEmailInputSchema = z.object({ token: tokenString });
export type VerifyEmailInput = z.input<typeof verifyEmailInputSchema>;

export const inviteAcceptInputSchema = z.object({ token: tokenString, password: passwordSchema, client: clientSchema });
export type InviteAcceptInput = z.input<typeof inviteAcceptInputSchema>;

export const forgotPasswordInputSchema = z.object({ email: loginIdentifier });
export type ForgotPasswordInput = z.input<typeof forgotPasswordInputSchema>;

export const resetPasswordInputSchema = z.object({ token: tokenString, password: passwordSchema });
export type ResetPasswordInput = z.input<typeof resetPasswordInputSchema>;

export const changeCredentialInputSchema = z.object({
  currentSecret: z.string().min(1).max(128),
  newSecret: z.string().min(1).max(128),
});
export type ChangeCredentialInput = z.input<typeof changeCredentialInputSchema>;

export const meSchema = z.object({
  user: z.object({
    id: idSchema,
    fullName: z.string(),
    jobTitle: z.string().nullable(),
    kind: z.enum(['worker', 'staff']),
    email: z.string().nullable(),
    username: z.string().nullable(),
    emailVerified: z.boolean(),
    credentialKind: credentialKindSchema.nullable(),
  }),
  role: z.object({ id: idSchema, name: z.string(), systemKey: systemRoleKeySchema.nullable(), dataScope: dataScopeSchema }),
  permissions: z.array(permissionKeySchema),
  tenant: z.object({ id: idSchema, name: z.string(), orgCode: z.string(), timezone: z.string(), locale: z.string() }),
});
export type Me = z.infer<typeof meSchema>;

export const loginResultSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: isoDateTimeSchema,
  refreshToken: z.string().nullable(),
  me: meSchema,
});
export type LoginResult = z.infer<typeof loginResultSchema>;
```

`packages/contracts/src/tenant.ts`:
```ts
import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common.js';

export const timezoneSchema = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { error: 'errors.validation.timezone' },
);

export const tenantDtoSchema = z.object({
  id: idSchema,
  name: z.string(),
  orgCode: z.string(),
  timezone: z.string(),
  locale: z.string(),
  status: z.enum(['active', 'suspended']),
  createdAt: isoDateTimeSchema,
});
export type TenantDto = z.infer<typeof tenantDtoSchema>;

export const updateTenantInputSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  timezone: timezoneSchema.optional(),
});
export type UpdateTenantInput = z.input<typeof updateTenantInputSchema>;
```

`packages/contracts/src/sites.ts`:
```ts
import { z } from 'zod';
import { idSchema } from './common.js';

export const siteTypeDtoSchema = z.object({ id: idSchema, name: z.string(), sortOrder: z.number().int(), active: z.boolean() });
export type SiteTypeDto = z.infer<typeof siteTypeDtoSchema>;

export const createSiteTypeInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
export type CreateSiteTypeInput = z.input<typeof createSiteTypeInputSchema>;

export const updateSiteTypeInputSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  active: z.boolean().optional(),
});
export type UpdateSiteTypeInput = z.input<typeof updateSiteTypeInputSchema>;

export const siteDtoSchema = z.object({
  id: idSchema,
  parentId: idSchema.nullable(),
  typeId: idSchema,
  name: z.string(),
  address: z.string().nullable(),
  active: z.boolean(),
  path: z.string(),
  depth: z.number().int(),
});
export type SiteDto = z.infer<typeof siteDtoSchema>;

export const createSiteInputSchema = z.object({
  parentId: idSchema.nullable(),
  typeId: idSchema,
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(300).nullable().optional(),
});
export type CreateSiteInput = z.input<typeof createSiteInputSchema>;

export const updateSiteInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  typeId: idSchema.optional(),
  address: z.string().trim().max(300).nullable().optional(),
  active: z.boolean().optional(),
});
export type UpdateSiteInput = z.input<typeof updateSiteInputSchema>;

export const moveSiteInputSchema = z.object({ parentId: idSchema.nullable() });
export type MoveSiteInput = z.input<typeof moveSiteInputSchema>;
```

`packages/contracts/src/teams.ts`:
```ts
import { z } from 'zod';
import { idSchema } from './common.js';

export const teamDtoSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  active: z.boolean(),
  memberIds: z.array(idSchema),
});
export type TeamDto = z.infer<typeof teamDtoSchema>;

export const createTeamInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
});
export type CreateTeamInput = z.input<typeof createTeamInputSchema>;

export const updateTeamInputSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().optional(),
});
export type UpdateTeamInput = z.input<typeof updateTeamInputSchema>;

export const setTeamMembersInputSchema = z.object({ userIds: z.array(idSchema).max(1000) });
export type SetTeamMembersInput = z.input<typeof setTeamMembersInputSchema>;
```

`packages/contracts/src/roles.ts`:
```ts
import { z } from 'zod';
import { idSchema } from './common.js';
import { dataScopeSchema, permissionKeySchema, systemRoleKeySchema } from './permissions.js';

export const roleDtoSchema = z.object({
  id: idSchema,
  name: z.string(),
  systemKey: systemRoleKeySchema.nullable(),
  dataScope: dataScopeSchema,
  editable: z.boolean(),
  active: z.boolean(),
  permissions: z.array(permissionKeySchema),
  userCount: z.number().int(),
});
export type RoleDto = z.infer<typeof roleDtoSchema>;

export const createRoleInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  dataScope: dataScopeSchema,
  permissions: z.array(permissionKeySchema).default([]),
});
export type CreateRoleInput = z.input<typeof createRoleInputSchema>;

export const updateRoleInputSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  dataScope: dataScopeSchema.optional(),
  active: z.boolean().optional(),
});
export type UpdateRoleInput = z.input<typeof updateRoleInputSchema>;

export const setRolePermissionsInputSchema = z.object({ permissions: z.array(permissionKeySchema) });
export type SetRolePermissionsInput = z.input<typeof setRolePermissionsInputSchema>;

export const permissionCatalogSchema = z.array(z.object({ group: z.string(), keys: z.array(permissionKeySchema) }));
export type PermissionCatalog = z.infer<typeof permissionCatalogSchema>;
```

`packages/contracts/src/users.ts`:
```ts
import { z } from 'zod';
import { cursorQuerySchema, idSchema, isoDateTimeSchema } from './common.js';
import { credentialKindSchema, emailSchema, secretSchemaFor, usernameSchema } from './credentials.js';
import { systemRoleKeySchema } from './permissions.js';

export const userStatusSchema = z.enum(['active', 'deactivated', 'invited']);
export const userKindSchema = z.enum(['worker', 'staff']);

export const userDtoSchema = z.object({
  id: idSchema,
  fullName: z.string(),
  jobTitle: z.string().nullable(),
  kind: userKindSchema,
  email: z.string().nullable(),
  username: z.string().nullable(),
  phone: z.string().nullable(),
  status: userStatusSchema,
  credentialKind: credentialKindSchema.nullable(),
  role: z.object({ id: idSchema, name: z.string(), systemKey: systemRoleKeySchema.nullable() }),
  managerId: idSchema.nullable(),
  managerName: z.string().nullable(),
  siteIds: z.array(idSchema),
  teamIds: z.array(idSchema),
  lastLoginAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type UserDto = z.infer<typeof userDtoSchema>;

export const userListQuerySchema = cursorQuerySchema.extend({
  status: userStatusSchema.optional(),
  kind: userKindSchema.optional(),
  roleId: idSchema.optional(),
  teamId: idSchema.optional(),
  siteId: idSchema.optional(),
  q: z.string().trim().max(100).optional(),
});
export type UserListQuery = z.input<typeof userListQuerySchema>;

const profileFields = {
  fullName: z.string().trim().min(2).max(120),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  roleId: idSchema,
  managerId: idSchema.nullable().optional(),
  siteIds: z.array(idSchema).max(500).default([]),
  teamIds: z.array(idSchema).max(500).default([]),
};

export const createWorkerInputSchema = z
  .object({
    ...profileFields,
    username: usernameSchema,
    credentialKind: credentialKindSchema.default('pin'),
    secret: z.string().max(128).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.secret) return;
    const r = secretSchemaFor(v.credentialKind).safeParse(v.secret);
    if (!r.success) {
      ctx.addIssue({ code: 'custom', path: ['secret'], message: r.error.issues[0]?.message ?? 'errors.validation.invalid' });
    }
  });
export type CreateWorkerInput = z.input<typeof createWorkerInputSchema>;

export const inviteStaffInputSchema = z.object({ ...profileFields, email: emailSchema });
export type InviteStaffInput = z.input<typeof inviteStaffInputSchema>;

export const updateUserInputSchema = z.object({
  fullName: profileFields.fullName.optional(),
  jobTitle: profileFields.jobTitle,
  phone: profileFields.phone,
  roleId: idSchema.optional(),
  managerId: idSchema.nullable().optional(),
  username: usernameSchema.optional(),
});
export type UpdateUserInput = z.input<typeof updateUserInputSchema>;

export const setUserSitesInputSchema = z.object({ siteIds: z.array(idSchema).max(500) });
export type SetUserSitesInput = z.input<typeof setUserSitesInputSchema>;

export const setUserTeamsInputSchema = z.object({ teamIds: z.array(idSchema).max(500) });
export type SetUserTeamsInput = z.input<typeof setUserTeamsInputSchema>;

export const resetCredentialInputSchema = z.object({
  credentialKind: credentialKindSchema.optional(),
  secret: z.string().max(128).optional(),
});
export type ResetCredentialInput = z.input<typeof resetCredentialInputSchema>;

export const userWithSecretSchema = z.object({ user: userDtoSchema, generatedSecret: z.string().nullable() });
export type UserWithSecret = z.infer<typeof userWithSecretSchema>;
```

`packages/contracts/src/audit.ts`:
```ts
import { z } from 'zod';
import { cursorQuerySchema, idSchema, isoDateTimeSchema } from './common.js';

export const auditEntryDtoSchema = z.object({
  id: idSchema,
  actor: z.object({
    type: z.enum(['user', 'platform_admin', 'system']),
    id: idSchema.nullable(),
    name: z.string().nullable(),
  }),
  action: z.string(),
  entityType: z.string(),
  entityId: idSchema.nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  ip: z.string().nullable(),
  occurredAt: isoDateTimeSchema,
});
export type AuditEntryDto = z.infer<typeof auditEntryDtoSchema>;

export const auditListQuerySchema = cursorQuerySchema.extend({
  actorUserId: idSchema.optional(),
  action: z.string().trim().max(100).optional(),
  entityType: z.string().trim().max(50).optional(),
  entityId: idSchema.optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});
export type AuditListQuery = z.input<typeof auditListQuerySchema>;
```

`packages/contracts/src/platform.ts`:
```ts
import { z } from 'zod';
import { cursorQuerySchema, idSchema, isoDateTimeSchema } from './common.js';

export const platformLoginInputSchema = z.object({
  email: z.string().trim().toLowerCase().min(3).max(254),
  password: z.string().min(1).max(128),
});
export type PlatformLoginInput = z.input<typeof platformLoginInputSchema>;

export const platformLoginResultSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: isoDateTimeSchema,
  admin: z.object({ id: idSchema, email: z.string(), fullName: z.string() }),
});
export type PlatformLoginResult = z.infer<typeof platformLoginResultSchema>;

export const platformTenantDtoSchema = z.object({
  id: idSchema,
  name: z.string(),
  orgCode: z.string(),
  status: z.enum(['active', 'suspended']),
  userCount: z.number().int(),
  createdAt: isoDateTimeSchema,
});
export type PlatformTenantDto = z.infer<typeof platformTenantDtoSchema>;

export const platformTenantListQuerySchema = cursorQuerySchema.extend({ q: z.string().trim().max(100).optional() });
export type PlatformTenantListQuery = z.input<typeof platformTenantListQuerySchema>;
```

Replace `packages/contracts/src/index.ts`:
```ts
import './zod-config.js';

export * from './errors.js';
export * from './permissions.js';
export * from './credentials.js';
export * from './common.js';
export * from './auth.js';
export * from './tenant.js';
export * from './sites.js';
export * from './teams.js';
export * from './roles.js';
export * from './users.js';
export * from './audit.js';
export * from './platform.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @taskop/contracts test && pnpm --filter @taskop/contracts build && pnpm --filter @taskop/contracts lint`
Expected: all PASS, build and lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): add resource schemas for auth, tenancy, users, roles, teams, audit, platform"
```

---

### Task 4: `@taskop/i18n` base — Azerbaijani common/error strings and formatting

**Files:**
- Create: `packages/i18n/package.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`
- Create: `packages/i18n/src/index.ts`, `src/format.ts`, `src/az/index.ts`, `src/az/common.ts`, `src/az/errors.ts`
- Test: `packages/i18n/src/i18n.test.ts`

**Interfaces:**
- Consumes: `ErrorCode` from `@taskop/contracts`.
- Produces: `resources` (`{ az: { translation: az } }` for i18next), `az` object, `DEFAULT_LOCALE = 'az'`, `intlLocale(locale)`, `formatDateTime(iso, { locale, timeZone })`, `formatDate(iso, { locale, timeZone })`. Translation keys: `common.*`, `errors.<ErrorCode>`, `errors.NETWORK`, `errors.validation.{required,invalid,tooShort,tooLong,email,username,orgCode,pinFormat,pinWeak,passwordLength,timezone}`. Interpolations: `errors.ACCOUNT_LOCKED`/`RATE_LIMITED` use `{{minutes}}`, `errors.INTERNAL` uses `{{requestId}}`.
- Parts 2 and 3 add namespaces by creating `src/az/<ns>.ts` and adding them to `src/az/index.ts`.

- [ ] **Step 1: Package setup**

`packages/i18n/package.json`:
```json
{
  "name": "@taskop/i18n",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "files": ["dist"],
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch --preserveWatchOutput",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint .",
    "test": "vitest run"
  }
}
```
`tsconfig.json`, `eslint.config.js`, `vitest.config.ts`: identical to `packages/contracts` (Task 2 Step 1).

Run:
```bash
pnpm --filter @taskop/i18n add "@taskop/contracts@workspace:*"
pnpm --filter @taskop/i18n add -D vitest@latest typescript@latest eslint@latest "@taskop/config@workspace:*"
```

- [ ] **Step 2: Write the failing test**

`packages/i18n/src/i18n.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@taskop/contracts';
import { az, formatDate, formatDateTime } from './index.js';

describe('az translations', () => {
  it('has a message for every API error code', () => {
    for (const code of Object.values(ErrorCode)) expect(az.errors[code], code).toBeTypeOf('string');
  });
  it('has every validation key used by contracts', () => {
    for (const k of ['required', 'invalid', 'tooShort', 'tooLong', 'email', 'username', 'orgCode', 'pinFormat', 'pinWeak', 'passwordLength', 'timezone'] as const) {
      expect(az.errors.validation[k], k).toBeTypeOf('string');
    }
  });
});

describe('formatting', () => {
  it('formats in the tenant timezone', () => {
    expect(formatDateTime('2026-10-07T10:00:00Z', { locale: 'az', timeZone: 'Asia/Baku' })).toContain('14:00');
  });
  it('formats dates', () => {
    expect(formatDate('2026-10-07T22:30:00Z', { locale: 'az', timeZone: 'Asia/Baku' })).toContain('2026');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @taskop/i18n test`
Expected: FAIL — cannot resolve `./index.js`.

- [ ] **Step 4: Implement**

`packages/i18n/src/az/common.ts`:
```ts
export default {
  appName: 'Taskop',
  save: 'Yadda saxla',
  cancel: 'Ləğv et',
  create: 'Yarat',
  add: 'Əlavə et',
  edit: 'Redaktə et',
  deactivate: 'Deaktiv et',
  reactivate: 'Aktiv et',
  active: 'Aktiv',
  inactive: 'Deaktiv',
  loading: 'Yüklənir…',
  search: 'Axtar',
  actions: 'Əməliyyatlar',
  back: 'Geri',
  next: 'Növbəti',
  confirm: 'Təsdiqlə',
  yes: 'Bəli',
  no: 'Xeyr',
  none: 'Yoxdur',
  close: 'Bağla',
  retry: 'Yenidən cəhd et',
  noResults: 'Nəticə tapılmadı',
  loadMore: 'Daha çox yüklə',
  status: 'Status',
  name: 'Ad',
  saved: 'Yadda saxlanıldı',
  copy: 'Kopyala',
  copied: 'Kopyalandı',
  all: 'Hamısı',
} as const;
```

`packages/i18n/src/az/errors.ts`:
```ts
export default {
  VALIDATION_FAILED: 'Daxil edilən məlumatları yoxlayın.',
  UNAUTHENTICATED: 'Sessiyanın müddəti bitib. Yenidən daxil olun.',
  INVALID_CREDENTIALS: 'Giriş məlumatları yanlışdır.',
  ACCOUNT_LOCKED: 'Hesab müvəqqəti bloklanıb. {{minutes}} dəqiqədən sonra yenidən cəhd edin.',
  RATE_LIMITED: 'Çox sayda cəhd edildi. {{minutes}} dəqiqədən sonra yenidən cəhd edin.',
  TENANT_SUSPENDED: 'Təşkilatın hesabı dayandırılıb. Taskop dəstəyi ilə əlaqə saxlayın.',
  FORBIDDEN: 'Bu əməliyyat üçün icazəniz yoxdur.',
  NOT_FOUND: 'Məlumat tapılmadı.',
  REFERENCE_NOT_FOUND: 'Seçilmiş element tapılmadı və ya aktiv deyil.',
  ORG_CODE_TAKEN: 'Bu təşkilat kodu artıq istifadə olunur.',
  EMAIL_TAKEN: 'Bu e-poçt ünvanı artıq qeydiyyatdan keçib.',
  USERNAME_TAKEN: 'Bu istifadəçi adı artıq mövcuddur.',
  TOKEN_INVALID: 'Keçid etibarsızdır və ya müddəti bitib.',
  EMAIL_NOT_VERIFIED: 'Əvvəlcə e-poçt ünvanınızı təsdiqləyin.',
  LAST_OWNER: 'Təşkilatda ən azı bir aktiv sahib qalmalıdır.',
  OWNER_ROLE_RESTRICTED: 'Sahib rolu ilə bağlı dəyişiklikləri yalnız sahib edə bilər.',
  ROLE_NOT_EDITABLE: 'Bu rol dəyişdirilə bilməz.',
  ROLE_IN_USE: 'Bu rol istifadəçilərə təyin olunub.',
  ROLE_ESCALATION: 'Özünüzdə olmayan icazələri verə bilməzsiniz.',
  SITE_CYCLE: 'Obyekt öz alt obyektinin altına köçürülə bilməz.',
  MANAGER_CYCLE: 'Bu rəhbər təyinatı dövri tabeçilik yaradır.',
  SELF_MODIFICATION: 'Bu əməliyyatı öz hesabınıza tətbiq edə bilməzsiniz.',
  INTERNAL: 'Gözlənilməz xəta baş verdi. Sorğu ID: {{requestId}}',
  NETWORK: 'Serverlə əlaqə qurulmadı. İnternet bağlantınızı yoxlayın.',
  validation: {
    required: 'Bu xana mütləqdir.',
    invalid: 'Yanlış dəyər.',
    tooShort: 'Dəyər çox qısadır.',
    tooLong: 'Dəyər çox uzundur.',
    email: 'Düzgün e-poçt ünvanı daxil edin.',
    username: 'İstifadəçi adı 3–32 simvol olmalı, yalnız latın hərfləri, rəqəmlər, nöqtə, alt xətt və tire ola bilər.',
    orgCode: 'Təşkilat kodu 3–32 simvol olmalı, yalnız latın hərfləri, rəqəmlər və tire ola bilər.',
    pinFormat: 'PIN 6 rəqəmdən ibarət olmalıdır.',
    pinWeak: 'Bu PIN çox sadədir. Başqa PIN seçin.',
    passwordLength: 'Şifrə 10–128 simvol olmalıdır.',
    timezone: 'Yanlış saat qurşağı.',
  },
} as const;
```

`packages/i18n/src/az/index.ts`:
```ts
import common from './common.js';
import errors from './errors.js';

export const az = { common, errors } as const;
export type Translations = typeof az;
```

`packages/i18n/src/format.ts`:
```ts
const INTL_LOCALES: Record<string, string> = { az: 'az-Latn-AZ', en: 'en-GB', ru: 'ru-RU', tr: 'tr-TR' };

export const intlLocale = (locale: string): string => INTL_LOCALES[locale] ?? locale;

export interface FormatOptions {
  locale: string;
  timeZone: string;
}

export function formatDateTime(iso: string, { locale, timeZone }: FormatOptions): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
    new Date(iso),
  );
}

export function formatDate(iso: string, { locale, timeZone }: FormatOptions): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'medium', timeZone }).format(new Date(iso));
}
```

`packages/i18n/src/index.ts`:
```ts
import { az } from './az/index.js';

export { az };
export type { Translations } from './az/index.js';
export * from './format.js';

export const DEFAULT_LOCALE = 'az';
export const resources = { az: { translation: az } } as const;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @taskop/i18n test && pnpm --filter @taskop/i18n build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/i18n pnpm-lock.yaml
git commit -m "feat(i18n): add Azerbaijani common and error strings with timezone-aware formatting"
```

---

### Task 5: API skeleton — config, error format, logging, health

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/.swcrc`, `apps/api/vitest.config.ts`, `apps/api/eslint.config.js`, `apps/api/.env.example`
- Create: `apps/api/src/main.ts`, `src/app.module.ts`, `src/app.setup.ts`
- Create: `apps/api/src/config/config.ts`, `src/config/config.module.ts`
- Create: `apps/api/src/common/app-error.ts`, `src/common/pg-errors.ts`, `src/common/error.filter.ts`, `src/common/request.ts`, `src/common/request-context.ts`, `src/common/decorators.ts`, `src/common/parse-id.pipe.ts`, `src/common/logger.ts`
- Create: `apps/api/src/health/health.controller.ts`
- Create: `apps/api/test/app.ts`, `apps/api/test/memory-mailer.ts` (stub mailer is filled in Task 9; create the file now with the class)
- Test: `apps/api/src/config/config.test.ts`, `src/common/error.filter.test.ts`, `test/health.test.ts`

**Interfaces:**
- Consumes: `@taskop/contracts` (`ErrorCode`, `ERROR_HTTP_STATUS`, `errorMessageKey`, `PermissionKey`, `DataScope`, `SystemRoleKey`).
- Produces:
  - `loadConfig(env): AppConfig`, `APP_CONFIG` injection token, `ConfigModule.forRoot(config)` (global).
  - `class AppError extends Error { code; fields: Record<string,string>|null; retryAfterSeconds: number|null; get status(): number }` with constructor `(code: ErrorCode, opts?: { fields?; retryAfterSeconds?; message? })`.
  - `toAppError(e: unknown): AppError`, `AllExceptionsFilter`, `pgErrorOf(e): PgErrorLike | null`, `UNIQUE_CONSTRAINT_ERRORS`.
  - `interface Principal { userId; tenantId; roleId; roleVersion; systemRoleKey: SystemRoleKey|null; sessionId; kind: 'worker'|'staff'; dataScope: DataScope; permissions: ReadonlySet<PermissionKey>; emailVerified: boolean }`, `interface AppRequest extends express.Request { id?: string; principal?: Principal }`.
  - `requestContextMiddleware`, `currentRequestMeta(): { ip: string | null; userAgent: string | null }`.
  - Decorators: `Public()`, `IS_PUBLIC_KEY`, `RequirePermission(...keys)`, `REQUIRED_PERMISSIONS_KEY`, `CurrentPrincipal()`.
  - `ParseIdPipe` (invalid UUID → `NOT_FOUND`).
  - `AppModule.forRoot(config)`, `configureApp(app, config)`.
  - Test helper `createTestApp(overrides?: Record<string,string>): Promise<TestApp>` where `TestApp = { app; http: supertest agent factory; config; mailer: MemoryMailer; close(): Promise<void> }`.

- [ ] **Step 1: Package setup**

`apps/api/package.json`:
```json
{
  "name": "@taskop/api",
  "version": "0.0.0",
  "private": true,
  "files": ["dist", "drizzle"],
  "scripts": {
    "build": "swc src -d dist --strip-leading-paths --config-file .swcrc",
    "dev": "pnpm build && (swc src -d dist --strip-leading-paths --config-file .swcrc --watch & node --env-file=.env --enable-source-maps --watch-path=dist dist/main.js)",
    "start": "node --enable-source-maps dist/main.js",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:setup": "tsx --env-file=.env src/db/scripts/setup.ts",
    "db:seed": "tsx --env-file=.env src/db/scripts/seed.ts",
    "keys:generate": "tsx src/scripts/generate-keys.ts",
    "platform:create-admin": "tsx --env-file=.env src/scripts/create-platform-admin.ts"
  }
}
```

`apps/api/tsconfig.json`:
```json
{
  "extends": "@taskop/config/tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test", "vitest.config.ts", "drizzle.config.ts"]
}
```

`apps/api/.swcrc`:
```json
{
  "$schema": "https://swc.rs/schema.json",
  "sourceMaps": true,
  "jsc": {
    "parser": { "syntax": "typescript", "decorators": true },
    "transform": { "legacyDecorator": true, "decoratorMetadata": true },
    "target": "es2023",
    "keepClassNames": true
  },
  "module": { "type": "commonjs" },
  "exclude": [".*\\.test\\.ts$"]
}
```

`apps/api/vitest.config.ts`:
```ts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    swc.vite({
      tsconfigFile: false,
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2023',
        keepClassNames: true,
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    pool: 'forks',
  },
});
```
(If Nest DI fails in tests with "can't resolve dependencies … at index [0]", decorator metadata is not being emitted: make sure Vite's built-in TS transform is disabled for `.ts` files by the swc plugin; with Vite 8 add `oxc: false` to the config root.)

`apps/api/eslint.config.js`:
```js
import base from '@taskop/config/eslint';
export default base;
```

`apps/api/.env.example`:
```
NODE_ENV=development
PORT=3000
DATABASE_OWNER_URL=postgres://taskop_owner:owner_dev_password@localhost:5432/taskop
DATABASE_APP_URL=postgres://taskop_app:app_dev_password@localhost:5432/taskop
DATABASE_PLATFORM_URL=postgres://taskop_platform:platform_dev_password@localhost:5432/taskop
APP_DB_PASSWORD=app_dev_password
PLATFORM_DB_PASSWORD=platform_dev_password
# Generate with: pnpm --filter @taskop/api keys:generate
JWT_PRIVATE_KEY=
JWT_PUBLIC_KEY=
WEB_URL=http://localhost:5173
SMTP_URL=smtp://localhost:1025
MAIL_FROM=Taskop <no-reply@taskop.local>
COOKIE_SECURE=true
TRUST_PROXY=false
LOG_LEVEL=info
```

Install:
```bash
pnpm --filter @taskop/api add @nestjs/common@latest @nestjs/core@latest @nestjs/platform-express@latest @nestjs/swagger@latest reflect-metadata@latest rxjs@latest nestjs-zod@latest zod@latest nestjs-pino@latest pino-http@latest pino@latest cookie-parser@latest uuidv7@latest "@taskop/contracts@workspace:*"
pnpm --filter @taskop/api add -D @nestjs/testing@latest @swc/cli@latest @swc/core@latest unplugin-swc@latest vitest@latest supertest@latest @types/supertest@latest @types/node@latest @types/express@latest @types/cookie-parser@latest pino-pretty@latest tsx@latest typescript@latest eslint@latest "@taskop/config@workspace:*"
```

- [ ] **Step 2: Write the failing tests**

`apps/api/src/config/config.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const valid = {
  DATABASE_APP_URL: 'postgres://a:b@localhost:5432/taskop',
  DATABASE_PLATFORM_URL: 'postgres://c:d@localhost:5432/taskop',
  JWT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
  JWT_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\\nabc\\n-----END PUBLIC KEY-----',
  WEB_URL: 'http://localhost:5173',
  SMTP_URL: 'smtp://localhost:1025',
  MAIL_FROM: 'Taskop <no-reply@taskop.local>',
};

describe('loadConfig', () => {
  it('applies defaults and unescapes PEM newlines', () => {
    const c = loadConfig(valid);
    expect(c.PORT).toBe(3000);
    expect(c.COOKIE_SECURE).toBe(true);
    expect(c.ARGON2_MEMORY_KIB).toBe(19456);
    expect(c.JWT_PRIVATE_KEY).toContain('\nabc\n');
  });
  it('parses booleans', () => expect(loadConfig({ ...valid, COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false));
  it('names missing variables', () => {
    expect(() => loadConfig({ ...valid, DATABASE_APP_URL: undefined })).toThrow(/DATABASE_APP_URL/);
  });
});
```

`apps/api/src/common/error.filter.test.ts`:
```ts
import { NotFoundException } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import '@taskop/contracts';
import { AppError } from './app-error';
import { toAppError } from './error.filter';

describe('toAppError', () => {
  it('passes AppError through', () => {
    const e = new AppError('SITE_CYCLE');
    expect(toAppError(e)).toBe(e);
    expect(e.status).toBe(409);
  });

  it('maps zod validation errors to field keys', () => {
    const r = z.object({ name: z.string().min(2) }).safeParse({ name: 'a' });
    const mapped = toAppError(new ZodValidationException(r.error!));
    expect(mapped.code).toBe('VALIDATION_FAILED');
    expect(mapped.fields).toEqual({ name: 'errors.validation.tooShort' });
  });

  it('maps wrapped unique violations by constraint name', () => {
    const mapped = toAppError({ message: 'query failed', cause: { code: '23505', constraint: 'users_email_uq' } });
    expect(mapped.code).toBe('EMAIL_TAKEN');
    expect(mapped.fields).toEqual({ email: 'errors.EMAIL_TAKEN' });
  });

  it('maps foreign key violations', () => {
    expect(toAppError({ cause: { code: '23503' } }).code).toBe('REFERENCE_NOT_FOUND');
  });

  it('maps Nest HTTP exceptions', () => {
    expect(toAppError(new NotFoundException()).code).toBe('NOT_FOUND');
  });

  it('hides unknown errors', () => {
    expect(toAppError(new Error('boom')).code).toBe('INTERNAL');
  });
});
```

`apps/api/test/health.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';

describe('health and error format', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('GET /api/v1/health returns ok', async () => {
    const res = await t.http().get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toBeTypeOf('string');
  });

  it('unknown routes use the standard error body', async () => {
    const res = await t.http().get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', messageKey: 'errors.NOT_FOUND', fields: null });
    expect(res.body.error.requestId).toBeTypeOf('string');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @taskop/api test`
Expected: FAIL — modules `./config`, `./app-error`, `./app` not found.

- [ ] **Step 4: Implement config**

`apps/api/src/config/config.ts`:
```ts
import { z } from 'zod';
import '@taskop/contracts';

export const APP_CONFIG = Symbol('APP_CONFIG');

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_APP_URL: z.url(),
  DATABASE_PLATFORM_URL: z.url(),
  JWT_PRIVATE_KEY: z.string().min(1),
  JWT_PUBLIC_KEY: z.string().min(1),
  WEB_URL: z.url(),
  SMTP_URL: z.url(),
  MAIL_FROM: z.string().min(3),
  COOKIE_SECURE: z.stringbool().default(true),
  TRUST_PROXY: z.stringbool().default(false),
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(1024).default(19456),
  ARGON2_ITERATIONS: z.coerce.number().int().min(1).default(2),
  RL_LOGIN_IP_PER_MIN: z.coerce.number().int().min(1).default(20),
  RL_LOGIN_ACCOUNT_PER_MIN: z.coerce.number().int().min(1).default(10),
  RL_SIGNUP_IP_PER_HOUR: z.coerce.number().int().min(1).default(10),
  RL_FORGOT_IP_PER_HOUR: z.coerce.number().int().min(1).default(10),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const c = result.data;
  return {
    ...c,
    JWT_PRIVATE_KEY: c.JWT_PRIVATE_KEY.replace(/\\n/g, '\n'),
    JWT_PUBLIC_KEY: c.JWT_PUBLIC_KEY.replace(/\\n/g, '\n'),
  };
}
```

`apps/api/src/config/config.module.ts`:
```ts
import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from './config';

@Global()
@Module({})
export class ConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return { module: ConfigModule, providers: [{ provide: APP_CONFIG, useValue: config }], exports: [APP_CONFIG] };
  }
}
```

- [ ] **Step 5: Implement common building blocks**

`apps/api/src/common/app-error.ts`:
```ts
import { ERROR_HTTP_STATUS, type ErrorCode } from '@taskop/contracts';

export class AppError extends Error {
  readonly fields: Record<string, string> | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    readonly code: ErrorCode,
    opts: { fields?: Record<string, string>; retryAfterSeconds?: number; message?: string } = {},
  ) {
    super(opts.message ?? code);
    this.fields = opts.fields ?? null;
    this.retryAfterSeconds = opts.retryAfterSeconds ?? null;
  }

  get status(): number {
    return ERROR_HTTP_STATUS[this.code];
  }
}
```

`apps/api/src/common/pg-errors.ts`:
```ts
import type { ErrorCode } from '@taskop/contracts';

export interface PgErrorLike {
  code: string;
  constraint?: string;
}

/** Drizzle wraps driver errors; walk the `cause` chain to find the pg error. */
export function pgErrorOf(e: unknown): PgErrorLike | null {
  let current: unknown = e;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const c = current as { code?: unknown; cause?: unknown };
    if (typeof c.code === 'string' && /^[0-9A-Z]{5}$/.test(c.code)) return c as PgErrorLike;
    current = c.cause;
  }
  return null;
}

export const UNIQUE_CONSTRAINT_ERRORS: Record<string, { code: ErrorCode; field: string }> = {
  tenants_org_code_uq: { code: 'ORG_CODE_TAKEN', field: 'orgCode' },
  users_email_uq: { code: 'EMAIL_TAKEN', field: 'email' },
  users_tenant_username_uq: { code: 'USERNAME_TAKEN', field: 'username' },
};
```

`apps/api/src/common/error.filter.ts`:
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { errorMessageKey } from '@taskop/contracts';
import type { Response } from 'express';
import { ZodSerializationException, ZodValidationException } from 'nestjs-zod';
import type { ZodError } from 'zod';
import { AppError } from './app-error';
import { pgErrorOf, UNIQUE_CONSTRAINT_ERRORS } from './pg-errors';
import type { AppRequest } from './request';

export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof ZodValidationException) {
    const fields: Record<string, string> = {};
    for (const issue of (e.getZodError() as ZodError).issues) {
      const key = issue.path.map(String).join('.') || '_';
      fields[key] ??= issue.message.startsWith('errors.') ? issue.message : 'errors.validation.invalid';
    }
    return new AppError('VALIDATION_FAILED', { fields });
  }
  if (e instanceof ZodSerializationException) return new AppError('INTERNAL');
  if (e instanceof HttpException) {
    const status = e.getStatus();
    if (status === 404) return new AppError('NOT_FOUND');
    if (status === 401) return new AppError('UNAUTHENTICATED');
    if (status === 403) return new AppError('FORBIDDEN');
    if (status === 400 || status === 413 || status === 415) return new AppError('VALIDATION_FAILED');
    return new AppError('INTERNAL');
  }
  const pg = pgErrorOf(e);
  if (pg?.code === '23505') {
    const mapped = UNIQUE_CONSTRAINT_ERRORS[pg.constraint ?? ''];
    if (mapped) return new AppError(mapped.code, { fields: { [mapped.field]: errorMessageKey(mapped.code) } });
  }
  if (pg?.code === '23503') return new AppError('REFERENCE_NOT_FOUND');
  return new AppError('INTERNAL');
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<AppRequest>();
    const res = http.getResponse<Response>();
    const requestId = req.id ? String(req.id) : null;
    const err = toAppError(exception);
    if (err.code === 'INTERNAL') {
      this.logger.error({ err: exception, requestId }, 'Unhandled error');
    }
    if (err.retryAfterSeconds) res.setHeader('Retry-After', String(err.retryAfterSeconds));
    res.status(err.status).json({
      error: {
        code: err.code,
        messageKey: errorMessageKey(err.code),
        fields: err.fields,
        retryAfterSeconds: err.retryAfterSeconds,
        requestId,
      },
    });
  }
}
```

`apps/api/src/common/request.ts`:
```ts
import type { DataScope, PermissionKey, SystemRoleKey } from '@taskop/contracts';
import type { Request } from 'express';

export interface Principal {
  userId: string;
  tenantId: string;
  roleId: string;
  roleVersion: number;
  systemRoleKey: SystemRoleKey | null;
  sessionId: string;
  kind: 'worker' | 'staff';
  dataScope: DataScope;
  permissions: ReadonlySet<PermissionKey>;
  emailVerified: boolean;
}

export interface AppRequest extends Request {
  id?: string;
  principal?: Principal;
}
```

`apps/api/src/common/request-context.ts`:
```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

const storage = new AsyncLocalStorage<RequestMeta>();

export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const userAgent = req.headers['user-agent'];
  storage.run({ ip: req.ip ?? null, userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : null }, next);
}

export function currentRequestMeta(): RequestMeta {
  return storage.getStore() ?? { ip: null, userAgent: null };
}
```

`apps/api/src/common/decorators.ts`:
```ts
import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@taskop/contracts';
import { AppError } from './app-error';
import type { AppRequest, Principal } from './request';

export const IS_PUBLIC_KEY = 'taskop:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const REQUIRED_PERMISSIONS_KEY = 'taskop:requiredPermissions';
export const RequirePermission = (...keys: PermissionKey[]) => SetMetadata(REQUIRED_PERMISSIONS_KEY, keys);

export const CurrentPrincipal = createParamDecorator((_data: unknown, ctx: ExecutionContext): Principal => {
  const principal = ctx.switchToHttp().getRequest<AppRequest>().principal;
  if (!principal) throw new AppError('UNAUTHENTICATED');
  return principal;
});
```

`apps/api/src/common/parse-id.pipe.ts`:
```ts
import { Injectable, PipeTransform } from '@nestjs/common';
import { AppError } from './app-error';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ParseIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID_RE.test(value)) throw new AppError('NOT_FOUND');
    return value.toLowerCase();
  }
}
```

`apps/api/src/common/logger.ts`:
```ts
import type { Params } from 'nestjs-pino';
import { uuidv7 } from 'uuidv7';
import type { AppConfig } from '../config/config';
import type { AppRequest } from './request';

export function loggerParams(config: AppConfig): Params {
  return {
    pinoHttp: {
      level: config.LOG_LEVEL,
      genReqId: (req, res) => {
        const header = req.headers['x-request-id'];
        const id = typeof header === 'string' && header.length > 0 && header.length <= 100 ? header : uuidv7();
        res.setHeader('x-request-id', id);
        return id;
      },
      customProps: (req) => {
        const p = (req as AppRequest).principal;
        return p ? { tenantId: p.tenantId, userId: p.userId } : {};
      },
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
    },
  };
}
```

- [ ] **Step 6: Implement app module, setup, health, main**

`apps/api/src/health/health.controller.ts`:
```ts
import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
```

`apps/api/src/app.module.ts`:
```ts
import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/error.filter';
import { loggerParams } from './common/logger';
import type { AppConfig } from './config/config';
import { ConfigModule } from './config/config.module';
import { HealthController } from './health/health.controller';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(config), LoggerModule.forRoot(loggerParams(config))],
      controllers: [HealthController],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    };
  }
}
```

`apps/api/src/app.setup.ts`:
```ts
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { requestContextMiddleware } from './common/request-context';
import type { AppConfig } from './config/config';

export function configureApp(app: INestApplication, config: AppConfig): void {
  const express = app as NestExpressApplication;
  if (config.TRUST_PROXY) express.set('trust proxy', 1);
  express.disable('x-powered-by');
  app.useLogger(app.get(Logger));
  app.use(cookieParser());
  app.use(requestContextMiddleware);
  app.setGlobalPrefix('api/v1');
}
```

`apps/api/src/main.ts`:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadConfig } from './config/config';

async function bootstrap(): Promise<void> {
  const config = loadConfig(process.env);
  const app = await NestFactory.create(AppModule.forRoot(config), { bufferLogs: true });
  configureApp(app, config);
  app.enableShutdownHooks();
  await app.listen(config.PORT);
}

void bootstrap();
```

- [ ] **Step 7: Implement the test harness**

`apps/api/test/memory-mailer.ts`:
```ts
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export class MemoryMailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }

  lastTo(to: string): MailMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === to.toLowerCase());
  }

  /** Extracts the `token=` query value from the most recent mail to `to`. */
  tokenFor(to: string): string {
    const mail = this.lastTo(to);
    const match = mail?.text.match(/token=([^\s&]+)/);
    if (!match?.[1]) throw new Error(`No token mail for ${to}`);
    return decodeURIComponent(match[1]);
  }
}
```

`apps/api/test/app.ts`:
```ts
import 'reflect-metadata';
import { generateKeyPairSync } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { type AppConfig, loadConfig } from '../src/config/config';
import { MemoryMailer } from './memory-mailer';

export interface TestApp {
  app: INestApplication;
  http: () => ReturnType<typeof request>;
  config: AppConfig;
  mailer: MemoryMailer;
  close: () => Promise<void>;
}

const keys = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

export function testEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'test',
    DATABASE_APP_URL: 'postgres://taskop_app:app@localhost:1/taskop',
    DATABASE_PLATFORM_URL: 'postgres://taskop_platform:platform@localhost:1/taskop',
    JWT_PRIVATE_KEY: keys.privateKey,
    JWT_PUBLIC_KEY: keys.publicKey,
    WEB_URL: 'http://localhost:5173',
    SMTP_URL: 'smtp://localhost:1025',
    MAIL_FROM: 'Taskop <no-reply@taskop.test>',
    COOKIE_SECURE: 'false',
    ARGON2_MEMORY_KIB: '1024',
    ARGON2_ITERATIONS: '1',
    RL_LOGIN_IP_PER_MIN: '100000',
    RL_LOGIN_ACCOUNT_PER_MIN: '100000',
    RL_SIGNUP_IP_PER_HOUR: '100000',
    RL_FORGOT_IP_PER_HOUR: '100000',
    LOG_LEVEL: 'silent',
    ...overrides,
  };
}

export async function createTestApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  const config = loadConfig(testEnv(overrides));
  const mailer = new MemoryMailer();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, config);
  await app.init();
  return {
    app,
    http: () => request(app.getHttpServer()),
    config,
    mailer,
    close: () => app.close(),
  };
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm --filter @taskop/api test && pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api build`
Expected: config, filter and health tests PASS; typecheck clean; `apps/api/dist/main.js` exists.

- [ ] **Step 9: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): add NestJS skeleton with config validation, error format, logging and health"
```

---

### Task 6: Database schema, migrations, DB roles, RLS — with Testcontainers harness

**Files:**
- Create: `apps/api/src/db/column-types.ts`, `src/db/schema.ts`, `src/db/setup.ts`, `src/db/scripts/setup.ts`, `apps/api/drizzle.config.ts`
- Create (generated + hand-written): `apps/api/drizzle/0000_extensions.sql`, `drizzle/0001_init.sql`, `drizzle/0002_security.sql`, `drizzle/meta/*`
- Create: `apps/api/test/global-setup.ts`, `apps/api/test/owner-db.ts`
- Modify: `apps/api/vitest.config.ts` (add `globalSetup`), `apps/api/test/app.ts` (real DB URLs)
- Test: `apps/api/test/rls.test.ts`

**Interfaces:**
- Produces:
  - Drizzle tables exported from `src/db/schema.ts`: `tenants, siteTypes, sites, teams, userTeams, roles, rolePermissions, users, userSites, sessions, authTokens, auditLog, platformAdmins, rateLimits` and enums `tenantStatus, userKind, userStatus, credentialKind, dataScope, systemRoleKey, sessionClient, authTokenPurpose`.
  - Named unique constraints used by `UNIQUE_CONSTRAINT_ERRORS`: `tenants_org_code_uq`, `users_email_uq`, `users_tenant_username_uq`.
  - `setupDatabase({ ownerUrl, appPassword, platformPassword }): Promise<void>` (creates/updates the two login roles, runs migrations).
  - Test: `inject('db')` → `{ ownerUrl, appUrl, platformUrl }`; `ownerQuery(sql, params?)` helper in `test/owner-db.ts`.

- [ ] **Step 1: Install DB dependencies**

```bash
pnpm --filter @taskop/api add drizzle-orm@latest pg@latest
pnpm --filter @taskop/api add -D drizzle-kit@latest @types/pg@latest @testcontainers/postgresql@latest
```

- [ ] **Step 2: Write the schema**

`apps/api/src/db/column-types.ts`:
```ts
import { customType } from 'drizzle-orm/pg-core';

export const ltree = customType<{ data: string }>({ dataType: () => 'ltree' });
export const citext = customType<{ data: string }>({ dataType: () => 'citext' });
```

`apps/api/src/db/schema.ts`:
```ts
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { citext, ltree } from './column-types';

export const tenantStatus = pgEnum('tenant_status', ['active', 'suspended']);
export const userKind = pgEnum('user_kind', ['worker', 'staff']);
export const userStatus = pgEnum('user_status', ['active', 'deactivated', 'invited']);
export const credentialKind = pgEnum('credential_kind', ['password', 'pin']);
export const dataScope = pgEnum('data_scope', ['all', 'site_subtree', 'subordinates', 'own']);
export const systemRoleKey = pgEnum('system_role_key', ['owner', 'admin', 'manager', 'worker', 'auditor']);
export const sessionClient = pgEnum('session_client', ['web', 'mobile']);
export const authTokenPurpose = pgEnum('auth_token_purpose', ['email_verify', 'invite', 'password_reset']);

const id = () => uuid('id').primaryKey().$defaultFn(() => uuidv7());
const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id);
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow();

export const tenants = pgTable('tenants', {
  id: id(),
  name: text('name').notNull(),
  orgCode: text('org_code').notNull().unique('tenants_org_code_uq'),
  timezone: text('timezone').notNull().default('Asia/Baku'),
  locale: text('locale').notNull().default('az'),
  status: tenantStatus('status').notNull().default('active'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const siteTypes = pgTable(
  'site_types',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique('site_types_tenant_id_uq').on(t.tenantId, t.id)],
);

export const sites = pgTable(
  'sites',
  {
    id: id(),
    tenantId: tenantId(),
    parentId: uuid('parent_id'),
    typeId: uuid('type_id').notNull(),
    name: text('name').notNull(),
    address: text('address'),
    active: boolean('active').notNull().default(true),
    path: ltree('path').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('sites_tenant_id_uq').on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.parentId], foreignColumns: [t.tenantId, t.id], name: 'sites_parent_fk' }),
    foreignKey({ columns: [t.tenantId, t.typeId], foreignColumns: [siteTypes.tenantId, siteTypes.id], name: 'sites_type_fk' }),
    index('sites_path_gist').using('gist', t.path),
    index('sites_tenant_idx').on(t.tenantId),
  ],
);

export const teams = pgTable(
  'teams',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    description: text('description'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('teams_tenant_id_uq').on(t.tenantId, t.id)],
);

export const roles = pgTable(
  'roles',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    systemKey: systemRoleKey('system_key'),
    dataScope: dataScope('data_scope').notNull(),
    editable: boolean('editable').notNull().default(true),
    active: boolean('active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('roles_tenant_id_uq').on(t.tenantId, t.id), unique('roles_tenant_system_key_uq').on(t.tenantId, t.systemKey)],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    tenantId: tenantId(),
    roleId: uuid('role_id').notNull(),
    permissionKey: text('permission_key').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionKey] }),
    foreignKey({ columns: [t.tenantId, t.roleId], foreignColumns: [roles.tenantId, roles.id], name: 'role_permissions_role_fk' }),
  ],
);

export const users = pgTable(
  'users',
  {
    id: id(),
    tenantId: tenantId(),
    fullName: text('full_name').notNull(),
    jobTitle: text('job_title'),
    managerId: uuid('manager_id'),
    roleId: uuid('role_id').notNull(),
    kind: userKind('kind').notNull(),
    email: citext('email').unique('users_email_uq'),
    username: text('username'),
    phone: text('phone'),
    credentialHash: text('credential_hash'),
    credentialKind: credentialKind('credential_kind'),
    emailVerifiedAt: ts('email_verified_at'),
    lastLoginAt: ts('last_login_at'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: ts('locked_until'),
    totpSecretEnc: text('totp_secret_enc'),
    status: userStatus('status').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('users_tenant_id_uq').on(t.tenantId, t.id),
    unique('users_tenant_username_uq').on(t.tenantId, t.username),
    foreignKey({ columns: [t.tenantId, t.managerId], foreignColumns: [t.tenantId, t.id], name: 'users_manager_fk' }),
    foreignKey({ columns: [t.tenantId, t.roleId], foreignColumns: [roles.tenantId, roles.id], name: 'users_role_fk' }),
    check('users_username_lower', sql`${t.username} = lower(${t.username})`),
    check(
      'users_kind_identity',
      sql`(${t.kind} = 'staff' and ${t.email} is not null) or (${t.kind} = 'worker' and ${t.username} is not null)`,
    ),
    index('users_tenant_idx').on(t.tenantId),
  ],
);

export const userTeams = pgTable(
  'user_teams',
  {
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    teamId: uuid('team_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.teamId] }),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id], name: 'user_teams_user_fk' }),
    foreignKey({ columns: [t.tenantId, t.teamId], foreignColumns: [teams.tenantId, teams.id], name: 'user_teams_team_fk' }),
  ],
);

export const userSites = pgTable(
  'user_sites',
  {
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    siteId: uuid('site_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.siteId] }),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id], name: 'user_sites_user_fk' }),
    foreignKey({ columns: [t.tenantId, t.siteId], foreignColumns: [sites.tenantId, sites.id], name: 'user_sites_site_fk' }),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    familyId: uuid('family_id').notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull().unique('sessions_refresh_token_hash_uq'),
    client: sessionClient('client').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    replacedBy: uuid('replaced_by'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id], name: 'sessions_user_fk' }),
    index('sessions_user_idx').on(t.userId),
    index('sessions_family_idx').on(t.familyId),
  ],
);

export const authTokens = pgTable(
  'auth_tokens',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    purpose: authTokenPurpose('purpose').notNull(),
    tokenHash: text('token_hash').notNull().unique('auth_tokens_token_hash_uq'),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
  },
  (t) => [foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id], name: 'auth_tokens_user_fk' })],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    tenantId: tenantId(),
    actorUserId: uuid('actor_user_id'),
    actorPlatformAdminId: uuid('actor_platform_admin_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
  },
  (t) => [index('audit_log_tenant_time_idx').on(t.tenantId, t.occurredAt)],
);

export const platformAdmins = pgTable('platform_admins', {
  id: id(),
  email: citext('email').notNull().unique('platform_admins_email_uq'),
  credentialHash: text('credential_hash').notNull(),
  fullName: text('full_name').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  expiresAt: ts('expires_at').notNull(),
});
```

`apps/api/drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_OWNER_URL ?? 'postgres://taskop_owner:owner_dev_password@localhost:5432/taskop',
  },
});
```

- [ ] **Step 3: Generate migrations (extensions → tables → security)**

Run, in order, from `apps/api`:
```bash
pnpm drizzle-kit generate --custom --name=extensions
pnpm drizzle-kit generate --name=init
pnpm drizzle-kit generate --custom --name=security
```
Expected: `drizzle/0000_extensions.sql` (empty), `drizzle/0001_init.sql` (CREATE TYPE / CREATE TABLE statements, `"path" ltree`, `"email" citext`, the composite FKs, the GiST index), `drizzle/0002_security.sql` (empty), plus `drizzle/meta/_journal.json`.

Fill `drizzle/0000_extensions.sql`:
```sql
CREATE EXTENSION IF NOT EXISTS ltree;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;
```

Fill `drizzle/0002_security.sql`:
```sql
-- Tenant isolation. nullif() turns the '' left behind by a finished SET LOCAL into NULL,
-- so a pooled connection with no tenant set sees zero rows instead of erroring.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tenants
  USING (id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['site_types','sites','teams','roles','role_permissions','users','user_teams','user_sites','sessions','auth_tokens','audit_log']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t);
  END LOOP;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO taskop_app, taskop_platform;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, site_types, sites, teams, roles, role_permissions, users, user_teams, user_sites, sessions, auth_tokens TO taskop_app, taskop_platform;
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_log TO taskop_app, taskop_platform;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_admins, rate_limits TO taskop_platform;
```
Note for future migrations: every new table needs an explicit `GRANT` here-style in its own migration, plus RLS if tenant-owned.

- [ ] **Step 4: Write `setupDatabase` and the CLI script**

`apps/api/src/db/setup.ts`:
```ts
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export interface SetupOptions {
  ownerUrl: string;
  appPassword: string;
  platformPassword: string;
}

async function ensureLoginRole(client: pg.Client, name: string, password: string, bypassRls: boolean) {
  const exists = await client.query('select 1 from pg_roles where rolname = $1', [name]);
  const pw = client.escapeLiteral(password);
  if (exists.rowCount === 0) {
    await client.query(`create role ${name} login password ${pw}${bypassRls ? ' bypassrls' : ''}`);
  } else {
    await client.query(`alter role ${name} with login password ${pw}`);
  }
}

/** Creates the app/platform login roles (needs a superuser in dev/test) and applies all migrations. */
export async function setupDatabase(opts: SetupOptions): Promise<void> {
  const client = new pg.Client({ connectionString: opts.ownerUrl });
  await client.connect();
  try {
    await ensureLoginRole(client, 'taskop_app', opts.appPassword, false);
    await ensureLoginRole(client, 'taskop_platform', opts.platformPassword, true);
  } finally {
    await client.end();
  }
  const db = drizzle(opts.ownerUrl);
  try {
    await migrate(db, { migrationsFolder: path.resolve(__dirname, '../../drizzle') });
  } finally {
    await db.$client.end();
  }
}
```

`apps/api/src/db/scripts/setup.ts`:
```ts
import { setupDatabase } from '../setup';

const { DATABASE_OWNER_URL, APP_DB_PASSWORD, PLATFORM_DB_PASSWORD } = process.env;
if (!DATABASE_OWNER_URL || !APP_DB_PASSWORD || !PLATFORM_DB_PASSWORD) {
  throw new Error('DATABASE_OWNER_URL, APP_DB_PASSWORD and PLATFORM_DB_PASSWORD are required');
}

setupDatabase({ ownerUrl: DATABASE_OWNER_URL, appPassword: APP_DB_PASSWORD, platformPassword: PLATFORM_DB_PASSWORD })
  .then(() => console.log('Database ready'))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
```

- [ ] **Step 5: Testcontainers global setup and helpers**

`apps/api/test/global-setup.ts`:
```ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { setupDatabase } from '../src/db/setup';

declare module 'vitest' {
  export interface ProvidedContext {
    db: { ownerUrl: string; appUrl: string; platformUrl: string };
  }
}

function withCredentials(url: string, user: string, password: string): string {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  return u.toString();
}

export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('taskop')
    .withUsername('taskop_owner')
    .withPassword('owner')
    .start();
  const ownerUrl = container.getConnectionUri();
  await setupDatabase({ ownerUrl, appPassword: 'app', platformPassword: 'platform' });
  project.provide('db', {
    ownerUrl,
    appUrl: withCredentials(ownerUrl, 'taskop_app', 'app'),
    platformUrl: withCredentials(ownerUrl, 'taskop_platform', 'platform'),
  });
  return async () => {
    await container.stop();
  };
}
```

`apps/api/test/owner-db.ts`:
```ts
import pg from 'pg';
import { inject } from 'vitest';

let pool: pg.Pool | null = null;

/** Superuser query helper for test setup/assertions (bypasses RLS). */
export async function ownerQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  pool ??= new pg.Pool({ connectionString: inject('db').ownerUrl, max: 2 });
  return pool.query<T>(text, params);
}
```

Modify `apps/api/vitest.config.ts` — add to `test`:
```ts
    globalSetup: ['test/global-setup.ts'],
```

Modify `apps/api/test/app.ts` — in `testEnv`, replace the two placeholder DB URLs so tests use the container:
```ts
import { inject } from 'vitest';
// …inside testEnv():
    DATABASE_APP_URL: inject('db').appUrl,
    DATABASE_PLATFORM_URL: inject('db').platformUrl,
```

- [ ] **Step 6: Write the failing RLS test**

`apps/api/test/rls.test.ts`:
```ts
import pg from 'pg';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { ownerQuery } from './owner-db';

const A = uuidv7();
const B = uuidv7();
const typeA = uuidv7();
const typeB = uuidv7();
let app: pg.Client;

async function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  await app.query('begin');
  try {
    await app.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn();
    await app.query('commit');
    return result;
  } catch (e) {
    await app.query('rollback');
    throw e;
  }
}

describe('row-level security', () => {
  beforeAll(async () => {
    await ownerQuery("insert into tenants (id, name, org_code) values ($1, 'A', $2), ($3, 'B', $4)", [
      A, `rls-a-${A.slice(-8)}`, B, `rls-b-${B.slice(-8)}`,
    ]);
    await ownerQuery("insert into site_types (id, tenant_id, name) values ($1, $2, 'Type A'), ($3, $4, 'Type B')", [
      typeA, A, typeB, B,
    ]);
    app = new pg.Client({ connectionString: inject('db').appUrl });
    await app.connect();
  });
  afterAll(() => app.end());

  it('returns no rows without a tenant context', async () => {
    expect((await app.query('select * from site_types')).rowCount).toBe(0);
    expect((await app.query('select * from tenants')).rowCount).toBe(0);
  });

  it('only shows the current tenant rows', async () => {
    const rows = await asTenant(A, async () => (await app.query('select id from site_types')).rows);
    expect(rows.map((r) => r.id)).toEqual([typeA]);
  });

  it('returns no rows (not an error) after the tenant transaction ends', async () => {
    await asTenant(A, async () => undefined);
    expect((await app.query('select * from site_types')).rowCount).toBe(0);
  });

  it('rejects writes into another tenant', async () => {
    await expect(
      asTenant(A, () => app.query("insert into site_types (id, tenant_id, name) values ($1, $2, 'x')", [uuidv7(), B])),
    ).rejects.toThrow(/row-level security/);
  });

  it('composite foreign keys block cross-tenant references', async () => {
    await expect(
      asTenant(B, () =>
        app.query("insert into sites (id, tenant_id, type_id, name, path) values ($1, $2, $3, 'x', 'x')", [uuidv7(), B, typeA]),
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('forbids updating or deleting audit_log', async () => {
    await expect(asTenant(A, () => app.query('update audit_log set action = action'))).rejects.toThrow(/permission denied/);
    await expect(asTenant(A, () => app.query('delete from audit_log'))).rejects.toThrow(/permission denied/);
  });

  it('forbids reading platform_admins and rate_limits', async () => {
    await expect(app.query('select * from platform_admins')).rejects.toThrow(/permission denied/);
    await expect(app.query('select * from rate_limits')).rejects.toThrow(/permission denied/);
  });
});
```

- [ ] **Step 7: Run tests**

Run (Docker must be running): `pnpm --filter @taskop/api test`
Expected: `rls.test.ts` PASS (7 tests); earlier tests still PASS. If a test fails, fix the schema/migration — do not weaken the test.

- [ ] **Step 8: Verify against docker-compose Postgres**

```bash
cp apps/api/.env.example apps/api/.env
pnpm db:setup
```
Expected: `Database ready`. (`db:setup` only needs the DB variables; JWT keys are generated in Task 21.)

- [ ] **Step 9: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): add database schema, RLS policies, DB roles and Testcontainers harness"
```

---

### Task 7: Tenant-scoped transactions, request interceptor, audit service

**Files:**
- Create: `apps/api/src/db/db.service.ts`, `src/db/db.module.ts`, `src/db/audit.service.ts`, `src/db/tenant-context.interceptor.ts`, `src/common/sql.ts`
- Modify: `apps/api/src/app.module.ts` (import `DbModule`)
- Test: `apps/api/test/db-context.test.ts`

**Interfaces:**
- Consumes: `APP_CONFIG`, schema tables, `currentRequestMeta()`, `AppRequest`.
- Produces:
  - `type Db = NodePgDatabase<typeof schema>`; `type Tx` (transaction handle); `type Executor = Db | Tx`.
  - `class DbService { readonly app: Db; readonly platform: Db; withTenant<T>(tenantId: string, userId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T>; tx(): Tx; context(): { tenantId: string; userId: string | null } }`.
  - `class AuditService { record(e: AuditEvent): Promise<void>; recordAsPlatform(e: AuditEvent & { tenantId: string; actorPlatformAdminId: string }): Promise<void> }` with `interface AuditEvent { action: string; entityType: string; entityId?: string | null; before?: unknown; after?: unknown; actorUserId?: string | null }`.
  - `redactSecrets(value: unknown): unknown`.
  - `TenantContextInterceptor` (registered as `APP_INTERCEPTOR` in `DbModule`).
  - `escapeLike(s: string): string` in `common/sql.ts`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/db-context.test.ts`:
```ts
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/config';
import { AuditService, redactSecrets } from '../src/db/audit.service';
import { DbService } from '../src/db/db.service';
import { auditLog, siteTypes, tenants } from '../src/db/schema';
import { testEnv } from './app';
import { ownerQuery } from './owner-db';

describe('DbService.withTenant', () => {
  let db: DbService;
  const A = uuidv7();
  const B = uuidv7();

  beforeAll(async () => {
    db = new DbService(loadConfig(testEnv()));
    await ownerQuery("insert into tenants (id, name, org_code) values ($1, 'A', $2), ($3, 'B', $4)", [
      A, `ctx-a-${A.slice(-8)}`, B, `ctx-b-${B.slice(-8)}`,
    ]);
  });
  afterAll(() => db.onModuleDestroy());

  it('scopes reads and writes to the tenant', async () => {
    await db.withTenant(A, null, (tx) => tx.insert(siteTypes).values({ tenantId: A, name: 'Only A' }));
    const seenByB = await db.withTenant(B, null, (tx) => tx.select().from(siteTypes));
    expect(seenByB).toEqual([]);
    const seenByA = await db.withTenant(A, null, (tx) => tx.select().from(siteTypes));
    expect(seenByA.map((r) => r.name)).toContain('Only A');
  });

  it('exposes the transaction and context to nested code', async () => {
    await db.withTenant(A, 'u1', async (tx) => {
      expect(db.tx()).toBe(tx);
      expect(db.context()).toEqual({ tenantId: A, userId: 'u1' });
      await db.withTenant(A, 'u1', async (inner) => expect(inner).toBe(tx));
    });
  });

  it('refuses to nest a different tenant', async () => {
    await expect(db.withTenant(A, null, () => db.withTenant(B, null, async () => 1))).rejects.toThrow(/different tenant/);
  });

  it('rolls back on error', async () => {
    await expect(
      db.withTenant(A, null, async (tx) => {
        await tx.insert(siteTypes).values({ tenantId: A, name: 'rolled back' });
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');
    const rows = await db.withTenant(A, null, (tx) => tx.select().from(siteTypes).where(eq(siteTypes.name, 'rolled back')));
    expect(rows).toEqual([]);
  });

  it('throws when tx() is used outside a tenant transaction', () => {
    expect(() => db.tx()).toThrow(/No tenant transaction/);
  });

  it('platform connection bypasses RLS', async () => {
    const rows = await db.platform.select({ id: tenants.id }).from(tenants);
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([A, B]));
  });
});

describe('AuditService', () => {
  let db: DbService;
  let audit: AuditService;
  const A = uuidv7();

  beforeAll(async () => {
    db = new DbService(loadConfig(testEnv()));
    audit = new AuditService(db);
    await ownerQuery("insert into tenants (id, name, org_code) values ($1, 'A', $2)", [A, `aud-${A.slice(-8)}`]);
  });
  afterAll(() => db.onModuleDestroy());

  it('records an entry in the current tenant with the current user as actor', async () => {
    const actor = uuidv7();
    await db.withTenant(A, actor, () =>
      audit.record({ action: 'thing.done', entityType: 'thing', entityId: actor, after: { name: 'x', credentialHash: 'h' } }),
    );
    const [row] = await db.withTenant(A, null, (tx) => tx.select().from(auditLog).where(eq(auditLog.action, 'thing.done')));
    expect(row).toMatchObject({ tenantId: A, actorUserId: actor, entityType: 'thing', after: { name: 'x' } });
  });

  it('redacts secret-looking keys recursively', () => {
    expect(redactSecrets({ a: 1, password: 'p', nested: { refreshToken: 't', ok: true }, list: [{ secret: 's' }] })).toEqual({
      a: 1,
      nested: { ok: true },
      list: [{}],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @taskop/api test db-context`
Expected: FAIL — `../src/db/db.service` not found.

- [ ] **Step 3: Implement**

`apps/api/src/db/db.service.ts`:
```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/config';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Executor = Db | Tx;

interface TenantStore {
  tx: Tx;
  tenantId: string;
  userId: string | null;
}

const storage = new AsyncLocalStorage<TenantStore>();

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly app: Db;
  readonly platform: Db;
  private readonly pools: pg.Pool[];

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const appPool = new pg.Pool({ connectionString: config.DATABASE_APP_URL, max: 20 });
    const platformPool = new pg.Pool({ connectionString: config.DATABASE_PLATFORM_URL, max: 5 });
    this.pools = [appPool, platformPool];
    this.app = drizzle(appPool, { schema });
    this.platform = drizzle(platformPool, { schema });
  }

  /** Runs `fn` in a transaction where RLS sees `tenantId`. Re-uses an enclosing transaction for the same tenant. */
  async withTenant<T>(tenantId: string, userId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const current = storage.getStore();
    if (current) {
      if (current.tenantId !== tenantId) throw new Error('Cannot open a transaction for a different tenant');
      return fn(current.tx);
    }
    return this.app.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.tenant_id', ${tenantId}, true), set_config('app.user_id', ${userId ?? ''}, true)`,
      );
      return storage.run({ tx, tenantId, userId }, () => fn(tx));
    });
  }

  tx(): Tx {
    const current = storage.getStore();
    if (!current) throw new Error('No tenant transaction in scope');
    return current.tx;
  }

  context(): { tenantId: string; userId: string | null } {
    const current = storage.getStore();
    if (!current) throw new Error('No tenant transaction in scope');
    return { tenantId: current.tenantId, userId: current.userId };
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.pools.map((p) => p.end()));
  }
}
```

`apps/api/src/db/audit.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { currentRequestMeta } from '../common/request-context';
import { DbService } from './db.service';
import { auditLog } from './schema';

export interface AuditEvent {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  actorUserId?: string | null;
}

const SECRET_KEY = /hash|secret|password|token|pin/i;

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !SECRET_KEY.test(k))
        .map(([k, v]) => [k, redactSecrets(v)]),
    );
  }
  return value;
}

@Injectable()
export class AuditService {
  constructor(private readonly db: DbService) {}

  /** Writes inside the current tenant transaction, so it commits or rolls back with the change. */
  async record(e: AuditEvent): Promise<void> {
    const { tenantId, userId } = this.db.context();
    const meta = currentRequestMeta();
    await this.db.tx().insert(auditLog).values({
      tenantId,
      actorUserId: e.actorUserId === undefined ? userId : e.actorUserId,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      before: e.before === undefined ? null : redactSecrets(e.before),
      after: e.after === undefined ? null : redactSecrets(e.after),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  async recordAsPlatform(e: AuditEvent & { tenantId: string; actorPlatformAdminId: string }): Promise<void> {
    const meta = currentRequestMeta();
    await this.db.platform.insert(auditLog).values({
      tenantId: e.tenantId,
      actorPlatformAdminId: e.actorPlatformAdminId,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      before: e.before === undefined ? null : redactSecrets(e.before),
      after: e.after === undefined ? null : redactSecrets(e.after),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }
}
```
(The `pin` pattern also matches e.g. `pinned`; no Foundation field uses such names.)

`apps/api/src/db/tenant-context.interceptor.ts`:
```ts
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { from, lastValueFrom, Observable } from 'rxjs';
import type { AppRequest } from '../common/request';
import { DbService } from './db.service';

/** Wraps every authenticated handler in one tenant transaction (commit on success, rollback on error). */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly db: DbService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const principal = ctx.switchToHttp().getRequest<AppRequest>().principal;
    if (!principal) return next.handle();
    return from(
      this.db.withTenant(principal.tenantId, principal.userId, () =>
        lastValueFrom(next.handle(), { defaultValue: undefined }),
      ),
    );
  }
}
```

`apps/api/src/db/db.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditService } from './audit.service';
import { DbService } from './db.service';
import { TenantContextInterceptor } from './tenant-context.interceptor';

@Global()
@Module({
  providers: [DbService, AuditService, { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor }],
  exports: [DbService, AuditService],
})
export class DbModule {}
```

`apps/api/src/common/sql.ts`:
```ts
/** Escapes LIKE/ILIKE wildcards so user search text is matched literally. */
export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);
```

Modify `apps/api/src/app.module.ts`: add `DbModule` to `imports` (after `LoggerModule.forRoot(...)`):
```ts
import { DbModule } from './db/db.module';
// imports: [ConfigModule.forRoot(config), LoggerModule.forRoot(loggerParams(config)), DbModule],
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @taskop/api test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): add tenant-scoped transactions, request interceptor and audit service"
```

---

### Task 8: Security primitives — hashing, JWT, opaque tokens, generated secrets, rate limiting

**Files:**
- Create: `apps/api/src/auth/crypto/password-hasher.ts`, `src/auth/crypto/token.service.ts`, `src/auth/crypto/opaque-token.ts`, `src/auth/crypto/secret-generator.ts`, `src/auth/rate-limit.service.ts`
- Test: `apps/api/src/auth/crypto/crypto.test.ts`, `apps/api/test/rate-limit.test.ts`

**Interfaces:**
- Consumes: `APP_CONFIG`, `DbService`, `rateLimits`, `AppError`, `isWeakPin`.
- Produces:
  - `class PasswordHasher { hash(secret: string): Promise<string>; verify(hash: string | null, secret: string): Promise<boolean> }` (null hash → spends equal time on a dummy hash, returns false).
  - `interface AccessClaims { sub: string; tid: string; rid: string; rv: number; kind: 'worker'|'staff'; sid: string }`; `ACCESS_TOKEN_TTL_MS = 15 min`; `PLATFORM_TOKEN_TTL_MS = 8 h`; `class TokenService { signAccess(c): Promise<{ token: string; expiresAt: Date }>; verifyAccess(token): Promise<AccessClaims | null>; signPlatform(adminId): Promise<{ token; expiresAt }>; verifyPlatform(token): Promise<{ sub: string } | null> }`.
  - `generateOpaqueToken(tenantId): string`, `hashOpaqueToken(token): string`, `parseOpaqueToken(token): { tenantId: string } | null`.
  - `generatePin(): string` (6 digits, never weak), `generatePassword(): string` (14 chars).
  - `class RateLimitService { consume(key: string, limit: number, windowSeconds: number): Promise<void> }` → throws `AppError('RATE_LIMITED', { retryAfterSeconds })`.

- [ ] **Step 1: Install**

```bash
pnpm --filter @taskop/api add @node-rs/argon2@latest jose@latest
```

- [ ] **Step 2: Write the failing tests**

`apps/api/src/auth/crypto/crypto.test.ts`:
```ts
import { isWeakPin } from '@taskop/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../config/config';
import { testEnv } from '../../../test/app';
import { generateOpaqueToken, hashOpaqueToken, parseOpaqueToken } from './opaque-token';
import { PasswordHasher } from './password-hasher';
import { generatePassword, generatePin } from './secret-generator';
import { TokenService } from './token.service';


const config = loadConfig(testEnv());
const claims = { sub: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f', tid: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e60', rid: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e61', rv: 3, kind: 'staff' as const, sid: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e62' };

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher(config);
  it('verifies the right secret only', async () => {
    const h = await hasher.hash('correct horse');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await hasher.verify(h, 'correct horse')).toBe(true);
    expect(await hasher.verify(h, 'wrong')).toBe(false);
  });
  it('returns false for a missing hash', async () => expect(await hasher.verify(null, 'x')).toBe(false));
});

describe('TokenService', () => {
  const tokens = new TokenService(config);
  afterEach(() => vi.useRealTimers());

  it('round-trips access claims', async () => {
    const { token, expiresAt } = await tokens.signAccess(claims);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(await tokens.verifyAccess(token)).toEqual(claims);
  });
  it('rejects tampered tokens', async () => {
    const { token } = await tokens.signAccess(claims);
    expect(await tokens.verifyAccess(token.slice(0, -2) + 'xx')).toBeNull();
  });
  it('keeps app and platform audiences apart', async () => {
    const { token } = await tokens.signPlatform(claims.sub);
    expect(await tokens.verifyAccess(token)).toBeNull();
    expect(await tokens.verifyPlatform(token)).toEqual({ sub: claims.sub });
    const app = await tokens.signAccess(claims);
    expect(await tokens.verifyPlatform(app.token)).toBeNull();
  });
  it('rejects expired tokens', async () => {
    const { token } = await tokens.signAccess(claims);
    vi.useFakeTimers({ now: Date.now() + 16 * 60_000 });
    expect(await tokens.verifyAccess(token)).toBeNull();
  });
});

describe('opaque tokens', () => {
  it('embeds the tenant and hashes deterministically', () => {
    const t = generateOpaqueToken(claims.tid);
    expect(parseOpaqueToken(t)).toEqual({ tenantId: claims.tid });
    expect(hashOpaqueToken(t)).toBe(hashOpaqueToken(t));
    expect(hashOpaqueToken(t)).toHaveLength(64);
  });
  it('rejects malformed tokens', () => {
    expect(parseOpaqueToken('nope')).toBeNull();
    expect(parseOpaqueToken('not-a-uuid.' + 'a'.repeat(43))).toBeNull();
    expect(parseOpaqueToken(claims.tid + '.short')).toBeNull();
  });
});

describe('generated secrets', () => {
  it('pins are 6 digits and never weak', () => {
    for (let i = 0; i < 500; i++) {
      const pin = generatePin();
      expect(pin).toMatch(/^\d{6}$/);
      expect(isWeakPin(pin)).toBe(false);
    }
  });
  it('passwords are 14 characters', () => expect(generatePassword()).toMatch(/^[A-Za-z0-9]{14}$/));
});
```
(`testEnv()` reads the Testcontainers URLs via `inject('db')`; the global setup runs for every test file, including these unit tests under `src/`. No database connection is opened here.)

`apps/api/test/rate-limit.test.ts`:
```ts
import { uuidv7 } from 'uuidv7';
import { afterAll, describe, expect, it } from 'vitest';
import { RateLimitService } from '../src/auth/rate-limit.service';
import { loadConfig } from '../src/config/config';
import { DbService } from '../src/db/db.service';
import { testEnv } from './app';

describe('RateLimitService', () => {
  const db = new DbService(loadConfig(testEnv()));
  const limiter = new RateLimitService(db);
  afterAll(() => db.onModuleDestroy());

  it('allows up to the limit then throws RATE_LIMITED with retryAfterSeconds', async () => {
    const key = `test:${uuidv7()}`;
    await limiter.consume(key, 2, 60);
    await limiter.consume(key, 2, 60);
    await expect(limiter.consume(key, 2, 60)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    try {
      await limiter.consume(key, 2, 60);
    } catch (e) {
      expect((e as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
      expect((e as { retryAfterSeconds: number }).retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });

  it('counts keys independently', async () => {
    await limiter.consume(`test:${uuidv7()}`, 1, 60);
    await expect(limiter.consume(`test:${uuidv7()}`, 1, 60)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @taskop/api test crypto rate-limit`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement**

`apps/api/src/auth/crypto/password-hasher.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { APP_CONFIG, type AppConfig } from '../../config/config';

@Injectable()
export class PasswordHasher {
  private readonly dummyHash: Promise<string>;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.dummyHash = this.hash('taskop-timing-equaliser');
  }

  /** argon2id (the library default algorithm) with configured cost. */
  hash(secret: string): Promise<string> {
    return hash(secret, {
      memoryCost: this.config.ARGON2_MEMORY_KIB,
      timeCost: this.config.ARGON2_ITERATIONS,
      parallelism: 1,
    });
  }

  async verify(storedHash: string | null, secret: string): Promise<boolean> {
    if (!storedHash) {
      await verify(await this.dummyHash, secret).catch(() => false);
      return false;
    }
    try {
      return await verify(storedHash, secret);
    } catch {
      return false;
    }
  }
}
```

`apps/api/src/auth/crypto/token.service.ts`:
```ts
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { importPKCS8, importSPKI, jwtVerify, SignJWT, type CryptoKey } from 'jose';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../config/config';

export const ACCESS_TOKEN_TTL_MS = 15 * 60_000;
export const PLATFORM_TOKEN_TTL_MS = 8 * 60 * 60_000;
const ISSUER = 'taskop';
const APP_AUDIENCE = 'taskop-app';
const PLATFORM_AUDIENCE = 'taskop-platform';

export interface AccessClaims {
  sub: string;
  tid: string;
  rid: string;
  rv: number;
  kind: 'worker' | 'staff';
  sid: string;
}

const accessPayload = z.object({
  sub: z.uuid(),
  tid: z.uuid(),
  rid: z.uuid(),
  rv: z.number().int(),
  kind: z.enum(['worker', 'staff']),
  sid: z.uuid(),
});

@Injectable()
export class TokenService implements OnModuleInit {
  private readonly keys: Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.keys = Promise.all([importPKCS8(config.JWT_PRIVATE_KEY, 'EdDSA'), importSPKI(config.JWT_PUBLIC_KEY, 'EdDSA')]).then(
      ([privateKey, publicKey]) => ({ privateKey, publicKey }),
    );
    this.keys.catch(() => undefined); // surfaced by onModuleInit
  }

  async onModuleInit(): Promise<void> {
    await this.keys;
  }

  async signAccess(c: AccessClaims): Promise<{ token: string; expiresAt: Date }> {
    const { privateKey } = await this.keys;
    const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);
    const token = await new SignJWT({ tid: c.tid, rid: c.rid, rv: c.rv, kind: c.kind, sid: c.sid })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setSubject(c.sub)
      .setIssuer(ISSUER)
      .setAudience(APP_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(privateKey);
    return { token, expiresAt };
  }

  async verifyAccess(token: string): Promise<AccessClaims | null> {
    const payload = await this.verify(token, APP_AUDIENCE);
    const parsed = accessPayload.safeParse(payload);
    return parsed.success ? parsed.data : null;
  }

  async signPlatform(adminId: string): Promise<{ token: string; expiresAt: Date }> {
    const { privateKey } = await this.keys;
    const expiresAt = new Date(Date.now() + PLATFORM_TOKEN_TTL_MS);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'EdDSA' })
      .setSubject(adminId)
      .setIssuer(ISSUER)
      .setAudience(PLATFORM_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(privateKey);
    return { token, expiresAt };
  }

  async verifyPlatform(token: string): Promise<{ sub: string } | null> {
    const payload = await this.verify(token, PLATFORM_AUDIENCE);
    const parsed = z.object({ sub: z.uuid() }).safeParse(payload);
    return parsed.success ? { sub: parsed.data.sub } : null;
  }

  private async verify(token: string, audience: string): Promise<unknown> {
    const { publicKey } = await this.keys;
    try {
      const { payload } = await jwtVerify(token, publicKey, {
        issuer: ISSUER,
        audience,
        algorithms: ['EdDSA'],
        clockTolerance: 5,
      });
      return payload;
    } catch {
      return null;
    }
  }
}
```

`apps/api/src/auth/crypto/opaque-token.ts`:
```ts
import { createHash, randomBytes } from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `<tenantId>.<32 random bytes base64url>`: the tenant prefix lets lookups run under RLS. */
export function generateOpaqueToken(tenantId: string): string {
  return `${tenantId}.${randomBytes(32).toString('base64url')}`;
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function parseOpaqueToken(token: string): { tenantId: string } | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const tenantId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!UUID_RE.test(tenantId) || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  return { tenantId };
}
```

`apps/api/src/auth/crypto/secret-generator.ts`:
```ts
import { randomInt } from 'node:crypto';
import { isWeakPin } from '@taskop/contracts';

export function generatePin(): string {
  for (;;) {
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    if (!isWeakPin(pin)) return pin;
  }
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export function generatePassword(length = 14): string {
  return Array.from({ length }, () => ALPHABET[randomInt(0, ALPHABET.length)]).join('');
}
```

`apps/api/src/auth/rate-limit.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { lt, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { DbService } from '../db/db.service';
import { rateLimits } from '../db/schema';

/** Fixed-window counters in Postgres, so limits hold across API instances. */
@Injectable()
export class RateLimitService {
  constructor(private readonly db: DbService) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<void> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const expiresAt = new Date(windowStart + windowMs);
    const [row] = await this.db.platform
      .insert(rateLimits)
      .values({ key: `${key}:${windowStart}`, count: 1, expiresAt })
      .onConflictDoUpdate({ target: rateLimits.key, set: { count: sql`${rateLimits.count} + 1` } })
      .returning({ count: rateLimits.count });
    if (Math.random() < 0.01) {
      void this.db.platform.delete(rateLimits).where(lt(rateLimits.expiresAt, new Date())).catch(() => undefined);
    }
    if ((row?.count ?? 0) > limit) {
      throw new AppError('RATE_LIMITED', { retryAfterSeconds: Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000)) });
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @taskop/api test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): add argon2 hashing, EdDSA tokens, opaque tokens, secret generation and rate limiting"
```

---

### Task 9: Tenant bootstrap, mailer, sessions, `Me`, sign-up and email verification

**Files:**
- Create: `apps/api/src/tenancy/bootstrap.ts`, `src/roles/permission-resolver.ts`
- Create: `apps/api/src/mail/mailer.ts`, `src/mail/templates.ts`, `src/mail/mail.module.ts`
- Create: `apps/api/src/auth/one-time-token.service.ts`, `src/auth/session.service.ts`, `src/auth/me.service.ts`, `src/auth/cookies.ts`, `src/auth/auth.service.ts`, `src/auth/auth.controller.ts`, `src/auth/dto.ts`, `src/auth/auth.module.ts`
- Modify: `apps/api/src/app.module.ts` (import `MailModule`, `AuthModule`), `apps/api/test/app.ts` (override `MAILER`)
- Create: `apps/api/test/fixtures.ts`
- Test: `apps/api/test/auth-signup.test.ts`

**Interfaces:**
- Consumes: Tasks 5–8.
- Produces:
  - `seedTenantDefaults(tx: Executor, tenantId: string): Promise<Record<SystemRoleKey, string>>` (4 site types + 5 roles + permissions).
  - `loadRolePermissions(tx: Executor, role: { id: string; systemKey: SystemRoleKey | null }): Promise<PermissionKey[]>` (owner → `ALL_PERMISSIONS`).
  - `MAILER` token, `interface Mailer { send(m: MailMessage): Promise<void> }`, `interface MailMessage { to; subject; text }`, `SmtpMailer`; templates `verifyEmailMail`, `inviteMail`, `passwordResetMail`.
  - `class OneTimeTokenService { create(input: { tenantId; userId; purpose; ttlMs }): Promise<string>; consume(raw: string, purpose): Promise<{ userId: string }> }` (both run inside the current tenant tx; `consume` throws `TOKEN_INVALID`).
  - `SESSION_TTL_MS = { web: 7 days, mobile: 30 days }`; `class SessionService { create(input: { tenantId; userId; client; familyId? }): Promise<{ sessionId: string; refreshToken: string }>; revokeAllForUser(userId: string, exceptSessionId?: string): Promise<void> }`.
  - `class MeService { load(userId: string): Promise<Me> }` (current tenant tx).
  - `REFRESH_COOKIE = 'taskop_rt'`, `setRefreshCookie(res, token, config)`, `clearRefreshCookie(res, config)`.
  - `class AuthService { signup(input): Promise<IssuedLogin>; verifyEmail(token): Promise<void>; issueLogin(user: { id; tenantId; roleId; kind }, client): Promise<IssuedLogin> }` where `interface IssuedLogin { result: LoginResult; refreshToken: string; client: Client }`.
  - Endpoints: `POST /api/v1/auth/signup` (201, LoginResult), `POST /api/v1/auth/verify-email` (204).
  - Fixtures: `uniq(prefix)`, `signupTenant(t, overrides?)` → `{ orgCode, email, password, tenantId, ownerId, accessToken, me }`, `bearer(token)`.

- [ ] **Step 1: Install**

```bash
pnpm --filter @taskop/api add nodemailer@latest
pnpm --filter @taskop/api add -D @types/nodemailer@latest
```

- [ ] **Step 2: Write fixtures and the failing test**

`apps/api/test/fixtures.ts`:
```ts
import { randomBytes } from 'node:crypto';
import type { LoginResult, Me } from '@taskop/contracts';
import { expect } from 'vitest';
import type { TestApp } from './app';

export const uniq = (prefix: string) => `${prefix}-${randomBytes(4).toString('hex')}`;
export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export interface SignedUpTenant {
  orgCode: string;
  email: string;
  password: string;
  tenantId: string;
  ownerId: string;
  accessToken: string;
  me: Me;
}

export async function signupTenant(t: TestApp, overrides: Record<string, unknown> = {}): Promise<SignedUpTenant> {
  const orgCode = uniq('org');
  const body = {
    orgName: 'Acme MMC',
    orgCode,
    fullName: 'Elvin Əhmədov',
    email: `${orgCode}@example.az`,
    password: 'owner password 1',
    client: 'mobile',
    ...overrides,
  };
  const res = await t.http().post('/api/v1/auth/signup').send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const result = res.body as LoginResult;
  return {
    orgCode: String(body.orgCode),
    email: String(body.email).toLowerCase(),
    password: String(body.password),
    tenantId: result.me.tenant.id,
    ownerId: result.me.user.id,
    accessToken: result.accessToken,
    me: result.me,
  };
}
```

`apps/api/test/auth-signup.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS } from '@taskop/contracts';
import { createTestApp, type TestApp } from './app';
import { signupTenant, uniq } from './fixtures';
import { ownerQuery } from './owner-db';

describe('POST /auth/signup', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('creates the tenant, its defaults and an Owner, and logs in (mobile)', async () => {
    const s = await signupTenant(t);
    expect(s.me.role.systemKey).toBe('owner');
    expect(s.me.permissions.sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(s.me.user.emailVerified).toBe(false);
    expect(s.me.tenant).toMatchObject({ orgCode: s.orgCode, timezone: 'Asia/Baku', locale: 'az' });

    const types = await ownerQuery('select name from site_types where tenant_id = $1 order by sort_order', [s.tenantId]);
    expect(types.rows.map((r) => r.name)).toEqual(['Filial', 'Zona', 'Bölmə', 'Yoxlama nöqtəsi']);
    const roles = await ownerQuery('select system_key from roles where tenant_id = $1', [s.tenantId]);
    expect(roles.rows.map((r) => r.system_key).sort()).toEqual(['admin', 'auditor', 'manager', 'owner', 'worker']);
    const audit = await ownerQuery('select action from audit_log where tenant_id = $1', [s.tenantId]);
    expect(audit.rows.map((r) => r.action)).toEqual(expect.arrayContaining(['tenant.created', 'user.created']));
  });

  it('returns the refresh token in the body for mobile and as a cookie for web', async () => {
    const orgCode = uniq('org');
    const mobile = await t.http().post('/api/v1/auth/signup').send({
      orgName: 'M', orgCode, fullName: 'Mobile User', email: `${orgCode}@m.az`, password: 'long password 1', client: 'mobile',
    });
    expect(mobile.body.refreshToken).toBeTypeOf('string');
    expect(mobile.headers['set-cookie']).toBeUndefined();

    const orgCode2 = uniq('org');
    const web = await t.http().post('/api/v1/auth/signup').send({
      orgName: 'W', orgCode: orgCode2, fullName: 'Web User', email: `${orgCode2}@w.az`, password: 'long password 1', client: 'web',
    });
    expect(web.body.refreshToken).toBeNull();
    const cookie = String(web.headers['set-cookie']);
    expect(cookie).toContain('taskop_rt=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('rejects a taken org code', async () => {
    const s = await signupTenant(t);
    const res = await t.http().post('/api/v1/auth/signup').send({
      orgName: 'X', orgCode: s.orgCode.toUpperCase(), fullName: 'Other', email: `${uniq('e')}@x.az`, password: 'long password 1', client: 'web',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'ORG_CODE_TAKEN', fields: { orgCode: 'errors.ORG_CODE_TAKEN' } });
  });

  it('treats emails case-insensitively when checking duplicates', async () => {
    const s = await signupTenant(t);
    const res = await t.http().post('/api/v1/auth/signup').send({
      orgName: 'X', orgCode: uniq('org'), fullName: 'Other', email: `  ${s.email.toUpperCase()} `, password: 'long password 1', client: 'web',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('returns field-level validation keys', async () => {
    const res = await t.http().post('/api/v1/auth/signup').send({
      orgName: 'X', orgCode: 'a', fullName: 'Other', email: 'bad', password: 'short', client: 'web',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.fields).toMatchObject({
      orgCode: 'errors.validation.orgCode',
      email: 'errors.validation.email',
      password: 'errors.validation.passwordLength',
    });
  });
});

describe('POST /auth/verify-email', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('verifies once with the mailed token', async () => {
    const s = await signupTenant(t);
    const token = t.mailer.tokenFor(s.email);
    expect((await t.http().post('/api/v1/auth/verify-email').send({ token })).status).toBe(204);
    const row = await ownerQuery('select email_verified_at from users where id = $1', [s.ownerId]);
    expect(row.rows[0]?.email_verified_at).not.toBeNull();

    const again = await t.http().post('/api/v1/auth/verify-email').send({ token });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('TOKEN_INVALID');
  });

  it('rejects garbage tokens', async () => {
    const res = await t.http().post('/api/v1/auth/verify-email').send({ token: 'garbage-token-value' });
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @taskop/api test auth-signup`
Expected: FAIL — 404 on `/api/v1/auth/signup`.

- [ ] **Step 4: Implement bootstrap and permission resolver**

`apps/api/src/tenancy/bootstrap.ts`:
```ts
import { SYSTEM_ROLE_DEFAULTS, SYSTEM_ROLE_KEYS, type SystemRoleKey } from '@taskop/contracts';
import type { Executor } from '../db/db.service';
import { rolePermissions, roles, siteTypes } from '../db/schema';

export const DEFAULT_SITE_TYPES = ['Filial', 'Zona', 'Bölmə', 'Yoxlama nöqtəsi'] as const;

/** Seeds site types and the five built-in roles for a new tenant. Must run in that tenant's context. */
export async function seedTenantDefaults(tx: Executor, tenantId: string): Promise<Record<SystemRoleKey, string>> {
  await tx.insert(siteTypes).values(DEFAULT_SITE_TYPES.map((name, i) => ({ tenantId, name, sortOrder: i })));
  const roleIds = {} as Record<SystemRoleKey, string>;
  for (const key of SYSTEM_ROLE_KEYS) {
    const def = SYSTEM_ROLE_DEFAULTS[key];
    const [role] = await tx
      .insert(roles)
      .values({ tenantId, name: def.name, systemKey: key, dataScope: def.dataScope, editable: def.editable })
      .returning({ id: roles.id });
    roleIds[key] = role!.id;
    if (def.permissions.length > 0) {
      await tx.insert(rolePermissions).values(def.permissions.map((permissionKey) => ({ tenantId, roleId: role!.id, permissionKey })));
    }
  }
  return roleIds;
}
```

`apps/api/src/roles/permission-resolver.ts`:
```ts
import { ALL_PERMISSIONS, type PermissionKey, type SystemRoleKey } from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import type { Executor } from '../db/db.service';
import { rolePermissions } from '../db/schema';

const KNOWN = new Set<string>(ALL_PERMISSIONS);

export async function loadRolePermissions(
  tx: Executor,
  role: { id: string; systemKey: SystemRoleKey | null },
): Promise<PermissionKey[]> {
  if (role.systemKey === 'owner') return [...ALL_PERMISSIONS];
  const rows = await tx.select({ key: rolePermissions.permissionKey }).from(rolePermissions).where(eq(rolePermissions.roleId, role.id));
  return rows.map((r) => r.key).filter((k): k is PermissionKey => KNOWN.has(k));
}
```

- [ ] **Step 5: Implement the mailer**

`apps/api/src/mail/mailer.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../config/config';

export const MAILER = Symbol('MAILER');

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

@Injectable()
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.transport = nodemailer.createTransport(config.SMTP_URL);
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.config.MAIL_FROM, ...message });
  }
}
```

`apps/api/src/mail/templates.ts`:
```ts
import type { MailMessage } from './mailer';

const link = (webUrl: string, path: string, token: string) => `${webUrl}${path}?token=${encodeURIComponent(token)}`;

export function verifyEmailMail(p: { to: string; fullName: string; webUrl: string; token: string }): MailMessage {
  return {
    to: p.to,
    subject: 'Taskop — e-poçt ünvanınızı təsdiqləyin',
    text: `Salam, ${p.fullName}!\n\nTaskop hesabınızı aktivləşdirmək üçün e-poçt ünvanınızı təsdiqləyin:\n${link(p.webUrl, '/verify-email', p.token)}\n\nKeçid 72 saat etibarlıdır.`,
  };
}

export function inviteMail(p: { to: string; fullName: string; orgName: string; webUrl: string; token: string }): MailMessage {
  return {
    to: p.to,
    subject: `Taskop — ${p.orgName} təşkilatına dəvət`,
    text: `Salam, ${p.fullName}!\n\nSizi Taskop-da "${p.orgName}" təşkilatına dəvət ediblər. Şifrənizi təyin etmək üçün keçidə daxil olun:\n${link(p.webUrl, '/accept-invite', p.token)}\n\nKeçid 7 gün etibarlıdır.`,
  };
}

export function passwordResetMail(p: { to: string; fullName: string; webUrl: string; token: string }): MailMessage {
  return {
    to: p.to,
    subject: 'Taskop — şifrənin bərpası',
    text: `Salam, ${p.fullName}!\n\nŞifrənizi yeniləmək üçün keçidə daxil olun:\n${link(p.webUrl, '/reset-password', p.token)}\n\nKeçid 1 saat etibarlıdır. Bu sorğunu siz etməmisinizsə, məktubu nəzərə almayın.`,
  };
}
```

`apps/api/src/mail/mail.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { MAILER, SmtpMailer } from './mailer';

@Global()
@Module({ providers: [{ provide: MAILER, useClass: SmtpMailer }], exports: [MAILER] })
export class MailModule {}
```

Modify `apps/api/test/app.ts` — override the mailer in `createTestApp`:
```ts
import { MAILER } from '../src/mail/mailer';
// replace the compile line with:
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
    .overrideProvider(MAILER)
    .useValue(mailer)
    .compile();
```

- [ ] **Step 6: Implement tokens, sessions, Me, cookies**

`apps/api/src/auth/one-time-token.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { DbService } from '../db/db.service';
import { authTokens } from '../db/schema';
import { generateOpaqueToken, hashOpaqueToken } from './crypto/opaque-token';

export type OneTimePurpose = 'email_verify' | 'invite' | 'password_reset';

export const ONE_TIME_TTL_MS: Record<OneTimePurpose, number> = {
  email_verify: 72 * 3600_000,
  invite: 7 * 24 * 3600_000,
  password_reset: 3600_000,
};

@Injectable()
export class OneTimeTokenService {
  constructor(private readonly db: DbService) {}

  async create(input: { tenantId: string; userId: string; purpose: OneTimePurpose }): Promise<string> {
    const raw = generateOpaqueToken(input.tenantId);
    await this.db.tx().insert(authTokens).values({
      tenantId: input.tenantId,
      userId: input.userId,
      purpose: input.purpose,
      tokenHash: hashOpaqueToken(raw),
      expiresAt: new Date(Date.now() + ONE_TIME_TTL_MS[input.purpose]),
    });
    return raw;
  }

  /** Marks the token used and returns its user. Must run inside the token's tenant transaction. */
  async consume(raw: string, purpose: OneTimePurpose): Promise<{ userId: string }> {
    const [row] = await this.db
      .tx()
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(authTokens.tokenHash, hashOpaqueToken(raw)),
          eq(authTokens.purpose, purpose),
          isNull(authTokens.usedAt),
          gt(authTokens.expiresAt, new Date()),
        ),
      )
      .returning({ userId: authTokens.userId });
    if (!row) throw new AppError('TOKEN_INVALID');
    return row;
  }
}
```

`apps/api/src/auth/session.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { currentRequestMeta } from '../common/request-context';
import { DbService } from '../db/db.service';
import { sessions } from '../db/schema';
import { generateOpaqueToken, hashOpaqueToken } from './crypto/opaque-token';

export type Client = 'web' | 'mobile';
export const SESSION_TTL_MS: Record<Client, number> = { web: 7 * 24 * 3600_000, mobile: 30 * 24 * 3600_000 };

@Injectable()
export class SessionService {
  constructor(private readonly db: DbService) {}

  async create(input: { tenantId: string; userId: string; client: Client; familyId?: string }): Promise<{
    sessionId: string;
    refreshToken: string;
  }> {
    const meta = currentRequestMeta();
    const refreshToken = generateOpaqueToken(input.tenantId);
    const [row] = await this.db
      .tx()
      .insert(sessions)
      .values({
        tenantId: input.tenantId,
        userId: input.userId,
        familyId: input.familyId ?? uuidv7(),
        refreshTokenHash: hashOpaqueToken(refreshToken),
        client: input.client,
        userAgent: meta.userAgent,
        ip: meta.ip,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS[input.client]),
      })
      .returning({ id: sessions.id });
    return { sessionId: row!.id, refreshToken };
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<void> {
    await this.db
      .tx()
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(sessions.userId, userId), isNull(sessions.revokedAt), exceptSessionId ? ne(sessions.id, exceptSessionId) : undefined),
      );
  }
}
```

`apps/api/src/auth/me.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import type { Me } from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { DbService } from '../db/db.service';
import { roles, tenants, users } from '../db/schema';
import { loadRolePermissions } from '../roles/permission-resolver';

@Injectable()
export class MeService {
  constructor(private readonly db: DbService) {}

  async load(userId: string): Promise<Me> {
    const tx = this.db.tx();
    const [row] = await tx
      .select({ user: users, role: roles, tenant: tenants })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .where(eq(users.id, userId));
    if (!row) throw new AppError('UNAUTHENTICATED');
    const permissions = await loadRolePermissions(tx, row.role);
    return {
      user: {
        id: row.user.id,
        fullName: row.user.fullName,
        jobTitle: row.user.jobTitle,
        kind: row.user.kind,
        email: row.user.email,
        username: row.user.username,
        emailVerified: row.user.emailVerifiedAt !== null,
        credentialKind: row.user.credentialKind,
      },
      role: { id: row.role.id, name: row.role.name, systemKey: row.role.systemKey, dataScope: row.role.dataScope },
      permissions,
      tenant: {
        id: row.tenant.id,
        name: row.tenant.name,
        orgCode: row.tenant.orgCode,
        timezone: row.tenant.timezone,
        locale: row.tenant.locale,
      },
    };
  }
}
```

`apps/api/src/auth/cookies.ts`:
```ts
import type { Response } from 'express';
import type { AppConfig } from '../config/config';
import { SESSION_TTL_MS } from './session.service';

export const REFRESH_COOKIE = 'taskop_rt';
const COOKIE_PATH = '/api/v1/auth';

export function setRefreshCookie(res: Response, token: string, config: AppConfig): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'strict',
    path: COOKIE_PATH,
    maxAge: SESSION_TTL_MS.web,
  });
}

export function clearRefreshCookie(res: Response, config: AppConfig): void {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: config.COOKIE_SECURE, sameSite: 'strict', path: COOKIE_PATH });
}
```

- [ ] **Step 7: Implement AuthService (sign-up, verify, issueLogin), DTOs, controller, module**

`apps/api/src/auth/dto.ts`:
```ts
import {
  changeCredentialInputSchema,
  forgotPasswordInputSchema,
  inviteAcceptInputSchema,
  loginResultSchema,
  loginStaffInputSchema,
  loginWorkerInputSchema,
  meSchema,
  refreshInputSchema,
  resetPasswordInputSchema,
  signupInputSchema,
  verifyEmailInputSchema,
} from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class SignupDto extends createZodDto(signupInputSchema) {}
export class LoginStaffDto extends createZodDto(loginStaffInputSchema) {}
export class LoginWorkerDto extends createZodDto(loginWorkerInputSchema) {}
export class RefreshDto extends createZodDto(refreshInputSchema) {}
export class VerifyEmailDto extends createZodDto(verifyEmailInputSchema) {}
export class InviteAcceptDto extends createZodDto(inviteAcceptInputSchema) {}
export class ForgotPasswordDto extends createZodDto(forgotPasswordInputSchema) {}
export class ResetPasswordDto extends createZodDto(resetPasswordInputSchema) {}
export class ChangeCredentialDto extends createZodDto(changeCredentialInputSchema) {}
export class LoginResultDto extends createZodDto(loginResultSchema) {}
export class MeDto extends createZodDto(meSchema) {}
```

`apps/api/src/auth/auth.service.ts`:
```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { LoginResult } from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { AppError } from '../common/app-error';
import { currentRequestMeta } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { roles, tenants, users } from '../db/schema';
import { MAILER, type Mailer, type MailMessage } from '../mail/mailer';
import { verifyEmailMail } from '../mail/templates';
import { seedTenantDefaults } from '../tenancy/bootstrap';
import { parseOpaqueToken } from './crypto/opaque-token';
import { PasswordHasher } from './crypto/password-hasher';
import { TokenService } from './crypto/token.service';
import type { SignupDto } from './dto';
import { MeService } from './me.service';
import { OneTimeTokenService } from './one-time-token.service';
import { RateLimitService } from './rate-limit.service';
import { type Client, SessionService } from './session.service';

export interface IssuedLogin {
  result: LoginResult;
  refreshToken: string;
  client: Client;
}

export interface LoginSubject {
  id: string;
  tenantId: string;
  roleId: string;
  kind: 'worker' | 'staff';
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly oneTime: OneTimeTokenService,
    private readonly me: MeService,
    private readonly rateLimit: RateLimitService,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async signup(input: SignupDto): Promise<IssuedLogin> {
    await this.rateLimit.consume(`signup:ip:${currentRequestMeta().ip}`, this.config.RL_SIGNUP_IP_PER_HOUR, 3600);
    const tenantId = uuidv7();
    const userId = uuidv7();
    const credentialHash = await this.hasher.hash(input.password);
    let verifyToken = '';
    const issued = await this.db.withTenant(tenantId, userId, async (tx) => {
      const [tenant] = await tx.insert(tenants).values({ id: tenantId, name: input.orgName, orgCode: input.orgCode }).returning();
      const roleIds = await seedTenantDefaults(tx, tenantId);
      await tx.insert(users).values({
        id: userId,
        tenantId,
        fullName: input.fullName,
        roleId: roleIds.owner,
        kind: 'staff',
        email: input.email,
        credentialHash,
        credentialKind: 'password',
        status: 'active',
      });
      verifyToken = await this.oneTime.create({ tenantId, userId, purpose: 'email_verify' });
      await this.audit.record({ action: 'tenant.created', entityType: 'tenant', entityId: tenantId, after: tenant });
      await this.audit.record({
        action: 'user.created',
        entityType: 'user',
        entityId: userId,
        after: { fullName: input.fullName, email: input.email, role: 'owner', kind: 'staff' },
      });
      return this.issueLogin({ id: userId, tenantId, roleId: roleIds.owner, kind: 'staff' }, input.client);
    });
    await this.sendMail(verifyEmailMail({ to: input.email, fullName: input.fullName, webUrl: this.config.WEB_URL, token: verifyToken }));
    return issued;
  }

  async verifyEmail(token: string): Promise<void> {
    const parsed = parseOpaqueToken(token);
    if (!parsed) throw new AppError('TOKEN_INVALID');
    await this.db.withTenant(parsed.tenantId, null, async (tx) => {
      const { userId } = await this.oneTime.consume(token, 'email_verify');
      await tx.update(users).set({ emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, userId));
      await this.audit.record({ action: 'user.email_verified', entityType: 'user', entityId: userId, actorUserId: userId });
    });
  }

  /** Creates a session and access token. Must run inside the subject's tenant transaction. */
  async issueLogin(subject: LoginSubject, client: Client, familyId?: string): Promise<IssuedLogin> {
    const tx = this.db.tx();
    const [role] = await tx.select({ version: roles.version }).from(roles).where(eq(roles.id, subject.roleId));
    const { sessionId, refreshToken } = await this.sessions.create({ tenantId: subject.tenantId, userId: subject.id, client, familyId });
    const { token, expiresAt } = await this.tokens.signAccess({
      sub: subject.id,
      tid: subject.tenantId,
      rid: subject.roleId,
      rv: role?.version ?? 1,
      kind: subject.kind,
      sid: sessionId,
    });
    const me = await this.me.load(subject.id);
    return {
      result: {
        accessToken: token,
        accessTokenExpiresAt: expiresAt.toISOString(),
        refreshToken: client === 'mobile' ? refreshToken : null,
        me,
      },
      refreshToken,
      client,
    };
  }

  /** Mail failures are logged, never surfaced: the user-facing action already succeeded. */
  async sendMail(message: MailMessage): Promise<void> {
    try {
      await this.mailer.send(message);
    } catch (err) {
      this.logger.error({ err, to: message.to }, 'Failed to send mail');
    }
  }
}
```

`apps/api/src/auth/auth.controller.ts`:
```ts
import { Body, Controller, HttpCode, Inject, Post, Res } from '@nestjs/common';
import { ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import type { LoginResult } from '@taskop/contracts';
import type { Response } from 'express';
import { Public } from '../common/decorators';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { type IssuedLogin, AuthService } from './auth.service';
import { setRefreshCookie } from './cookies';
import { LoginResultDto, SignupDto, VerifyEmailDto } from './dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('signup')
  @ApiCreatedResponse({ type: LoginResultDto })
  async signup(@Body() body: SignupDto, @Res({ passthrough: true }) res: Response): Promise<LoginResult> {
    return this.respond(await this.auth.signup(body), res);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(204)
  async verifyEmail(@Body() body: VerifyEmailDto): Promise<void> {
    await this.auth.verifyEmail(body.token);
  }

  private respond(issued: IssuedLogin, res: Response): LoginResult {
    if (issued.client === 'web') setRefreshCookie(res, issued.refreshToken, this.config);
    return issued.result;
  }
}
```

`apps/api/src/auth/auth.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordHasher } from './crypto/password-hasher';
import { TokenService } from './crypto/token.service';
import { MeService } from './me.service';
import { OneTimeTokenService } from './one-time-token.service';
import { RateLimitService } from './rate-limit.service';
import { SessionService } from './session.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordHasher, TokenService, SessionService, OneTimeTokenService, MeService, RateLimitService],
  exports: [AuthService, PasswordHasher, TokenService, SessionService, OneTimeTokenService, MeService, RateLimitService],
})
export class AuthModule {}
```

Modify `apps/api/src/app.module.ts` imports to:
```ts
imports: [ConfigModule.forRoot(config), LoggerModule.forRoot(loggerParams(config)), DbModule, MailModule, AuthModule],
```
(with `import { MailModule } from './mail/mail.module';` and `import { AuthModule } from './auth/auth.module';`).

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm --filter @taskop/api test`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): add tenant sign-up with defaults, sessions, email verification and mailer"
```

---

### Task 10: Staff & worker login, lockout, rate limits, refresh rotation with reuse detection

**Files:**
- Create: `apps/api/src/auth/login-lookup.ts`
- Modify: `apps/api/src/auth/auth.service.ts` (add `sessionId` to `IssuedLogin`; add `loginStaff`, `loginWorker`, `refresh`), `src/auth/auth.controller.ts` (3 endpoints), `src/auth/auth.module.ts` (provide `LoginLookup`)
- Modify: `apps/api/test/fixtures.ts` (add `createUserDirect`, `loginWorker`, `loginStaff`)
- Test: `apps/api/test/auth-login.test.ts`

**Interfaces:**
- Consumes: Tasks 8–9.
- Produces:
  - `interface LoginCandidate { id; tenantId; roleId; kind; status; credentialHash: string|null; failedLoginCount: number; lockedUntil: Date|null; tenantStatus: 'active'|'suspended' }`; `class LoginLookup { staffByEmail(email): Promise<LoginCandidate|null>; worker(orgCode, username): Promise<LoginCandidate|null> }` (platform connection, read-only).
  - `IssuedLogin` gains `sessionId: string`.
  - `AuthService.loginStaff(input)`, `AuthService.loginWorker(input)`, `AuthService.refresh(rawToken: string | undefined): Promise<IssuedLogin>`; constants `MAX_FAILED_LOGINS = 5`, `LOCK_MS = 15 min`, `REFRESH_GRACE_MS = 30 s`.
  - Endpoints: `POST /auth/login/staff`, `POST /auth/login/worker`, `POST /auth/refresh` (all 200 `LoginResult`).
  - Fixtures: `createUserDirect(t, tenantId, opts)` → `{ id, username, email, secret }`; `loginWorker(t, orgCode, username, secret, client?)`; `loginStaff(t, email, password, client?)` → `LoginResult`.

- [ ] **Step 1: Add fixtures**

Append to `apps/api/test/fixtures.ts`:
```ts
import type { SystemRoleKey } from '@taskop/contracts';
import { and, eq } from 'drizzle-orm';
import { PasswordHasher } from '../src/auth/crypto/password-hasher';
import { DbService } from '../src/db/db.service';
import { roles, users } from '../src/db/schema';

export interface DirectUserOptions {
  kind?: 'worker' | 'staff';
  roleKey?: SystemRoleKey;
  roleId?: string;
  username?: string;
  email?: string;
  secret?: string | null;
  credentialKind?: 'pin' | 'password';
  status?: 'active' | 'deactivated' | 'invited';
  fullName?: string;
  managerId?: string | null;
  emailVerified?: boolean;
}

/** Inserts a user straight into the DB (bypassing the Users API, which arrives in Task 17). */
export async function createUserDirect(t: TestApp, tenantId: string, opts: DirectUserOptions = {}) {
  const db = t.app.get(DbService);
  const hasher = t.app.get(PasswordHasher);
  const kind = opts.kind ?? 'worker';
  const credentialKind = opts.credentialKind ?? (kind === 'worker' ? 'pin' : 'password');
  const secret = opts.secret === undefined ? (credentialKind === 'pin' ? '482915' : 'staff password 1') : opts.secret;
  const username = kind === 'worker' ? (opts.username ?? uniq('w')).toLowerCase() : null;
  const email = kind === 'staff' ? (opts.email ?? `${uniq('s')}@example.az`).toLowerCase() : null;
  const credentialHash = secret ? await hasher.hash(secret) : null;
  const id = await db.withTenant(tenantId, null, async (tx) => {
    let roleId = opts.roleId;
    if (!roleId) {
      const [role] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.tenantId, tenantId), eq(roles.systemKey, opts.roleKey ?? (kind === 'worker' ? 'worker' : 'admin'))));
      roleId = role!.id;
    }
    const [row] = await tx
      .insert(users)
      .values({
        tenantId,
        fullName: opts.fullName ?? 'Test User',
        roleId,
        kind,
        username,
        email,
        credentialHash,
        credentialKind: secret ? credentialKind : null,
        status: opts.status ?? 'active',
        managerId: opts.managerId ?? null,
        emailVerifiedAt: opts.emailVerified ? new Date() : null,
      })
      .returning({ id: users.id });
    return row!.id;
  });
  return { id, username, email, secret: secret ?? '' };
}

export async function loginWorker(t: TestApp, orgCode: string, username: string, secret: string, client = 'mobile') {
  const res = await t.http().post('/api/v1/auth/login/worker').send({ orgCode, username, secret, client });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as LoginResult;
}

export async function loginStaff(t: TestApp, email: string, password: string, client = 'mobile') {
  const res = await t.http().post('/api/v1/auth/login/staff').send({ email, password, client });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as LoginResult;
}
```
(Merge the new imports into the import block at the top of the file.)

- [ ] **Step 2: Write the failing test**

`apps/api/test/auth-login.test.ts`:
```ts
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { createUserDirect, loginStaff, loginWorker, signupTenant } from './fixtures';
import { ownerQuery } from './owner-db';

describe('login', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('logs staff in by email, ignoring case and whitespace', async () => {
    const s = await signupTenant(t);
    const r = await loginStaff(t, `  ${s.email.toUpperCase()} `, s.password);
    expect(r.me.user.id).toBe(s.ownerId);
  });

  it('logs workers in with org code + username + PIN, normalising both identifiers', async () => {
    const s = await signupTenant(t);
    const w = await createUserDirect(t, s.tenantId, { username: 'elvin' });
    const r = await loginWorker(t, ` ${s.orgCode.toUpperCase()} `, 'Elvin', w.secret);
    expect(r.me.user).toMatchObject({ id: w.id, kind: 'worker', username: 'elvin' });
    expect(r.refreshToken).toBeTypeOf('string');
  });

  it('gives the same error for wrong secret, unknown user and deactivated user', async () => {
    const s = await signupTenant(t);
    const w = await createUserDirect(t, s.tenantId);
    const d = await createUserDirect(t, s.tenantId, { status: 'deactivated' });
    const attempts = [
      { orgCode: s.orgCode, username: w.username, secret: '000001' },
      { orgCode: s.orgCode, username: 'nobody', secret: w.secret },
      { orgCode: s.orgCode, username: d.username, secret: d.secret },
      { orgCode: 'no-such-org', username: w.username, secret: w.secret },
    ];
    for (const a of attempts) {
      const res = await t.http().post('/api/v1/auth/login/worker').send({ ...a, client: 'mobile' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    }
    const failed = await ownerQuery("select after from audit_log where tenant_id = $1 and action = 'auth.login_failed'", [s.tenantId]);
    expect(failed.rows.map((r) => r.after.reason).sort()).toEqual(['bad_secret', 'inactive']);
  });

  it('locks the account for 15 minutes after 5 consecutive failures', async () => {
    const s = await signupTenant(t);
    const w = await createUserDirect(t, s.tenantId);
    const attempt = (secret: string) =>
      t.http().post('/api/v1/auth/login/worker').send({ orgCode: s.orgCode, username: w.username, secret, client: 'mobile' });
    for (let i = 0; i < 4; i++) expect((await attempt('000001')).body.error.code).toBe('INVALID_CREDENTIALS');
    const fifth = await attempt('000001');
    expect(fifth.status).toBe(429);
    expect(fifth.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(fifth.body.error.retryAfterSeconds).toBeGreaterThan(880);
    expect((await attempt(w.secret)).body.error.code).toBe('ACCOUNT_LOCKED');

    await ownerQuery("update users set locked_until = now() - interval '1 second' where id = $1", [w.id]);
    expect((await attempt(w.secret)).status).toBe(200);
    const row = await ownerQuery('select failed_login_count, locked_until from users where id = $1', [w.id]);
    expect(row.rows[0]).toMatchObject({ failed_login_count: 0, locked_until: null });
  });

  it('refuses login for a suspended tenant after correct credentials', async () => {
    const s = await signupTenant(t);
    await ownerQuery("update tenants set status = 'suspended' where id = $1", [s.tenantId]);
    const res = await t.http().post('/api/v1/auth/login/staff').send({ email: s.email, password: s.password, client: 'web' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TENANT_SUSPENDED');
  });
});

describe('login rate limiting', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ RL_LOGIN_IP_PER_MIN: '3', TRUST_PROXY: 'true' });
  });
  afterAll(() => t.close());

  it('limits attempts per IP', async () => {
    const ip = `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
    const attempt = () =>
      t.http().post('/api/v1/auth/login/staff').set('X-Forwarded-For', ip).send({ email: 'x@y.az', password: 'x', client: 'web' });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBeDefined();
  });
});

describe('refresh', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const refresh = (refreshToken: string) => t.http().post('/api/v1/auth/refresh').send({ refreshToken });

  it('rotates the refresh token', async () => {
    const s = await signupTenant(t);
    const first = await loginStaff(t, s.email, s.password);
    const res = await refresh(first.refreshToken!);
    expect(res.status).toBe(200);
    expect(res.body.refreshToken).not.toBe(first.refreshToken);
    expect(res.body.me.user.id).toBe(s.ownerId);
  });

  it('reuse within the grace window fails without revoking the family', async () => {
    const s = await signupTenant(t);
    const first = await loginStaff(t, s.email, s.password);
    const second = await refresh(first.refreshToken!);
    expect((await refresh(first.refreshToken!)).status).toBe(401);
    expect((await refresh(second.body.refreshToken)).status).toBe(200);
  });

  it('reuse after the grace window revokes the whole family', async () => {
    const s = await signupTenant(t);
    const first = await loginStaff(t, s.email, s.password);
    const second = await refresh(first.refreshToken!);
    await ownerQuery("update sessions set revoked_at = now() - interval '60 seconds' where replaced_by is not null and user_id = $1", [s.ownerId]);
    const reuse = await refresh(first.refreshToken!);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('UNAUTHENTICATED');
    expect((await refresh(second.body.refreshToken)).status).toBe(401);
    const audit = await ownerQuery("select 1 from audit_log where tenant_id = $1 and action = 'auth.refresh_reuse_detected'", [s.tenantId]);
    expect(audit.rowCount).toBe(1);
  });

  it('works from the web cookie and sets a new cookie', async () => {
    const s = await signupTenant(t);
    const login = await t.http().post('/api/v1/auth/login/staff').send({ email: s.email, password: s.password, client: 'web' });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const res = await t.http().post('/api/v1/auth/refresh').set('Cookie', cookie).send({});
    expect(res.status).toBe(200);
    expect(res.body.refreshToken).toBeNull();
    expect(String(res.headers['set-cookie'])).toContain('taskop_rt=');
  });

  it('fails for deactivated users and expired sessions', async () => {
    const s = await signupTenant(t);
    const w = await createUserDirect(t, s.tenantId);
    const a = await loginWorker(t, s.orgCode, w.username!, w.secret);
    await ownerQuery("update users set status = 'deactivated' where id = $1", [w.id]);
    expect((await refresh(a.refreshToken!)).status).toBe(401);

    const b = await loginStaff(t, s.email, s.password);
    await ownerQuery("update sessions set expires_at = now() - interval '1 second' where user_id = $1", [s.ownerId]);
    expect((await refresh(b.refreshToken!)).status).toBe(401);
  });

  it('rejects malformed tokens', async () => {
    expect((await refresh('nonsense-token')).body.error.code).toBe('UNAUTHENTICATED');
    expect((await t.http().post('/api/v1/auth/refresh').send({})).status).toBe(401);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @taskop/api test auth-login`
Expected: FAIL — 404 on `/api/v1/auth/login/worker`.

- [ ] **Step 4: Implement `LoginLookup`**

`apps/api/src/auth/login-lookup.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { tenants, users } from '../db/schema';

export interface LoginCandidate {
  id: string;
  tenantId: string;
  roleId: string;
  kind: 'worker' | 'staff';
  status: 'active' | 'deactivated' | 'invited';
  credentialHash: string | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  tenantStatus: 'active' | 'suspended';
}

const candidateColumns = {
  id: users.id,
  tenantId: users.tenantId,
  roleId: users.roleId,
  kind: users.kind,
  status: users.status,
  credentialHash: users.credentialHash,
  failedLoginCount: users.failedLoginCount,
  lockedUntil: users.lockedUntil,
  tenantStatus: tenants.status,
};

/** Pre-auth lookups by globally unique keys. Uses the platform connection (tenant unknown yet). */
@Injectable()
export class LoginLookup {
  constructor(private readonly db: DbService) {}

  async staffByEmail(email: string): Promise<LoginCandidate | null> {
    const [row] = await this.db.platform
      .select(candidateColumns)
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .where(and(eq(users.email, email), eq(users.kind, 'staff')));
    return row ?? null;
  }

  async worker(orgCode: string, username: string): Promise<LoginCandidate | null> {
    const [row] = await this.db.platform
      .select(candidateColumns)
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .where(and(eq(tenants.orgCode, orgCode), eq(users.username, username), eq(users.kind, 'worker')));
    return row ?? null;
  }
}
```

- [ ] **Step 5: Extend `AuthService`**

In `apps/api/src/auth/auth.service.ts`:

1. Change `IssuedLogin` to:
```ts
export interface IssuedLogin {
  result: LoginResult;
  refreshToken: string;
  sessionId: string;
  client: Client;
}
```
and in `issueLogin` return `sessionId` alongside `refreshToken`:
```ts
    return {
      result: { accessToken: token, accessTokenExpiresAt: expiresAt.toISOString(), refreshToken: client === 'mobile' ? refreshToken : null, me },
      refreshToken,
      sessionId,
      client,
    };
```

2. Add constants and imports at the top:
```ts
import { and, isNull } from 'drizzle-orm';
import { sessions } from '../db/schema';
import { hashOpaqueToken } from './crypto/opaque-token';
import type { LoginStaffDto, LoginWorkerDto } from './dto';
import { type LoginCandidate, LoginLookup } from './login-lookup';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MS = 15 * 60_000;
export const REFRESH_GRACE_MS = 30_000;

const secondsUntil = (d: Date) => Math.max(1, Math.ceil((d.getTime() - Date.now()) / 1000));
```

3. Add `private readonly lookup: LoginLookup` to the constructor parameters.

4. Add these methods to the class:
```ts
  async loginStaff(input: LoginStaffDto): Promise<IssuedLogin> {
    await this.limitLogin(`staff:${input.email}`);
    return this.completeLogin(await this.lookup.staffByEmail(input.email), input.password, input.client);
  }

  async loginWorker(input: LoginWorkerDto): Promise<IssuedLogin> {
    await this.limitLogin(`worker:${input.orgCode}:${input.username}`);
    return this.completeLogin(await this.lookup.worker(input.orgCode, input.username), input.secret, input.client);
  }

  async refresh(rawToken: string | undefined): Promise<IssuedLogin> {
    const parsed = rawToken ? parseOpaqueToken(rawToken) : null;
    if (!rawToken || !parsed) throw new AppError('UNAUTHENTICATED');
    // Revocations must commit, so failures are returned from the transaction and thrown after it.
    const outcome = await this.db.withTenant(parsed.tenantId, null, async (tx) => {
      const [session] = await tx
        .select()
        .from(sessions)
        .where(eq(sessions.refreshTokenHash, hashOpaqueToken(rawToken)))
        .for('update');
      if (!session) return null;
      const now = Date.now();
      if (session.replacedBy) {
        if (session.revokedAt && now - session.revokedAt.getTime() < REFRESH_GRACE_MS) return null;
        await tx
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(sessions.familyId, session.familyId), isNull(sessions.revokedAt)));
        await this.audit.record({
          action: 'auth.refresh_reuse_detected',
          entityType: 'session',
          entityId: session.id,
          actorUserId: session.userId,
        });
        return null;
      }
      if (session.revokedAt || session.expiresAt.getTime() <= now) return null;
      const [user] = await tx
        .select({ id: users.id, tenantId: users.tenantId, roleId: users.roleId, kind: users.kind, status: users.status, tenantStatus: tenants.status })
        .from(users)
        .innerJoin(tenants, eq(tenants.id, users.tenantId))
        .where(eq(users.id, session.userId));
      if (!user || user.status !== 'active' || user.tenantStatus !== 'active') {
        await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, session.id));
        return null;
      }
      const issued = await this.issueLogin(user, session.client, session.familyId);
      await tx.update(sessions).set({ revokedAt: new Date(), replacedBy: issued.sessionId }).where(eq(sessions.id, session.id));
      return issued;
    });
    if (!outcome) throw new AppError('UNAUTHENTICATED');
    return outcome;
  }

  private async limitLogin(accountKey: string): Promise<void> {
    const ip = currentRequestMeta().ip ?? 'unknown';
    await this.rateLimit.consume(`login:ip:${ip}`, this.config.RL_LOGIN_IP_PER_MIN, 60);
    await this.rateLimit.consume(`login:acct:${accountKey}`, this.config.RL_LOGIN_ACCOUNT_PER_MIN, 60);
  }

  private async completeLogin(row: LoginCandidate | null, secret: string, client: Client): Promise<IssuedLogin> {
    if (!row) {
      await this.hasher.verify(null, secret);
      throw new AppError('INVALID_CREDENTIALS');
    }
    if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
      throw new AppError('ACCOUNT_LOCKED', { retryAfterSeconds: secondsUntil(row.lockedUntil) });
    }
    const valid = await this.hasher.verify(row.credentialHash, secret);
    if (!valid || row.status !== 'active') {
      const lockedUntil = await this.recordFailure(row, valid ? 'inactive' : 'bad_secret');
      if (lockedUntil) throw new AppError('ACCOUNT_LOCKED', { retryAfterSeconds: secondsUntil(lockedUntil) });
      throw new AppError('INVALID_CREDENTIALS');
    }
    if (row.tenantStatus !== 'active') throw new AppError('TENANT_SUSPENDED');
    return this.db.withTenant(row.tenantId, row.id, async (tx) => {
      await tx.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, row.id));
      await this.audit.record({ action: 'auth.login_succeeded', entityType: 'user', entityId: row.id, after: { client } });
      return this.issueLogin(row, client);
    });
  }

  /** Counts a bad secret toward the lockout; returns the lock expiry if this failure locked the account. */
  private async recordFailure(row: LoginCandidate, reason: 'bad_secret' | 'inactive'): Promise<Date | null> {
    return this.db.withTenant(row.tenantId, null, async (tx) => {
      let lockedUntil: Date | null = null;
      if (reason === 'bad_secret') {
        const lockExpired = row.lockedUntil !== null && row.lockedUntil.getTime() <= Date.now();
        const count = (lockExpired ? 0 : row.failedLoginCount) + 1;
        lockedUntil = count >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MS) : null;
        await tx.update(users).set({ failedLoginCount: count, lockedUntil }).where(eq(users.id, row.id));
      }
      await this.audit.record({
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: row.id,
        actorUserId: null,
        after: { reason, locked: lockedUntil !== null },
      });
      return lockedUntil;
    });
  }
```

- [ ] **Step 6: Add endpoints and provider**

In `apps/api/src/auth/auth.controller.ts` add (imports: `Req` from `@nestjs/common`, `ApiOkResponse`, `AppRequest` from `../common/request`, `clearRefreshCookie`, `REFRESH_COOKIE` from `./cookies`, `LoginStaffDto`, `LoginWorkerDto`, `RefreshDto` from `./dto`):
```ts
  @Public()
  @Post('login/staff')
  @HttpCode(200)
  @ApiOkResponse({ type: LoginResultDto })
  async loginStaff(@Body() body: LoginStaffDto, @Res({ passthrough: true }) res: Response): Promise<LoginResult> {
    return this.respond(await this.auth.loginStaff(body), res);
  }

  @Public()
  @Post('login/worker')
  @HttpCode(200)
  @ApiOkResponse({ type: LoginResultDto })
  async loginWorker(@Body() body: LoginWorkerDto, @Res({ passthrough: true }) res: Response): Promise<LoginResult> {
    return this.respond(await this.auth.loginWorker(body), res);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOkResponse({ type: LoginResultDto })
  async refresh(@Body() body: RefreshDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response): Promise<LoginResult> {
    const cookieToken = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    try {
      return this.respond(await this.auth.refresh(body.refreshToken ?? cookieToken), res);
    } catch (e) {
      if (!body.refreshToken && cookieToken) clearRefreshCookie(res, this.config);
      throw e;
    }
  }
```
In `auth.module.ts` add `LoginLookup` to `providers`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @taskop/api test`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(api): add staff/worker login with lockout, rate limits and refresh rotation"
```

---

### Task 11: Auth guard, permission guard, `GET /me`, logout, resend verification

**Files:**
- Create: `apps/api/src/auth/principal-loader.ts`, `src/auth/auth.guard.ts`, `src/auth/permission.guard.ts`, `src/auth/me.controller.ts`
- Modify: `apps/api/src/auth/auth.controller.ts` (logout, resend), `src/auth/auth.service.ts` (`logout`, `resendVerification`), `src/auth/auth.module.ts` (guards as `APP_GUARD`, `MeController`)
- Test: `apps/api/test/auth-guard.test.ts`, `apps/api/src/auth/permission.guard.test.ts`

**Interfaces:**
- Consumes: `TokenService.verifyAccess`, `loadRolePermissions`, `Principal`, decorators.
- Produces:
  - `class PrincipalLoader { load(claims: AccessClaims): Promise<Principal> }`: reads the user's **current** role/status/tenant status on every request (deactivation and role changes apply immediately, stronger than the spec's 15-minute window); permission sets cached per `roleId:version`.
  - Global guards in order: `AuthGuard` (sets `req.principal`; skips `@Public()`), `PermissionGuard` (checks `@RequirePermission`).
  - `GET /api/v1/me` → `Me`. `POST /api/v1/auth/logout` → 204 (revokes the current session, clears cookie). `POST /api/v1/auth/verify-email/resend` → 204.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/auth/permission.guard.test.ts`:
```ts
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { PermissionGuard } from './permission.guard';

function ctx(principal: unknown): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ principal }) }),
  } as unknown as ExecutionContext;
}
const reflector = (keys: string[] | undefined) => ({ getAllAndOverride: () => keys }) as unknown as Reflector;

describe('PermissionGuard', () => {
  it('allows routes without requirements', () => {
    expect(new PermissionGuard(reflector(undefined)).canActivate(ctx({ permissions: new Set() }))).toBe(true);
  });
  it('allows when every key is held', () => {
    expect(new PermissionGuard(reflector(['users.view'])).canActivate(ctx({ permissions: new Set(['users.view', 'x']) }))).toBe(true);
  });
  it('throws FORBIDDEN when a key is missing', () => {
    expect(() =>
      new PermissionGuard(reflector(['users.view', 'users.manage'])).canActivate(ctx({ permissions: new Set(['users.view']) })),
    ).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });
});
```

`apps/api/test/auth-guard.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { bearer, createUserDirect, loginStaff, loginWorker, signupTenant } from './fixtures';
import { ownerQuery } from './owner-db';

describe('authentication guard and /me', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('rejects missing and invalid tokens', async () => {
    expect((await t.http().get('/api/v1/me')).body.error.code).toBe('UNAUTHENTICATED');
    expect((await t.http().get('/api/v1/me').set(bearer('garbage'))).status).toBe(401);
  });

  it('returns the current profile', async () => {
    const s = await signupTenant(t);
    const res = await t.http().get('/api/v1/me').set(bearer(s.accessToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(s.me);
  });

  it('blocks a deactivated user immediately, even with a valid access token', async () => {
    const s = await signupTenant(t);
    const w = await createUserDirect(t, s.tenantId);
    const login = await loginWorker(t, s.orgCode, w.username!, w.secret);
    await ownerQuery("update users set status = 'deactivated' where id = $1", [w.id]);
    expect((await t.http().get('/api/v1/me').set(bearer(login.accessToken))).status).toBe(401);
  });

  it('blocks a suspended tenant', async () => {
    const s = await signupTenant(t);
    await ownerQuery("update tenants set status = 'suspended' where id = $1", [s.tenantId]);
    const res = await t.http().get('/api/v1/me').set(bearer(s.accessToken));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TENANT_SUSPENDED');
  });

  it('reflects role permission changes on the next request', async () => {
    const s = await signupTenant(t);
    const m = await createUserDirect(t, s.tenantId, { kind: 'staff', roleKey: 'manager' });
    const login = await loginStaff(t, m.email!, m.secret);
    expect(login.me.permissions).toContain('users.view');
    await ownerQuery(
      "delete from role_permissions where permission_key = 'users.view' and role_id = (select id from roles where tenant_id = $1 and system_key = 'manager')",
      [s.tenantId],
    );
    await ownerQuery("update roles set version = version + 1 where tenant_id = $1 and system_key = 'manager'", [s.tenantId]);
    const me = await t.http().get('/api/v1/me').set(bearer(login.accessToken));
    expect(me.body.permissions).not.toContain('users.view');
  });
});

describe('logout and resend verification', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('logout revokes the session so refresh fails', async () => {
    const s = await signupTenant(t);
    const login = await loginStaff(t, s.email, s.password);
    expect((await t.http().post('/api/v1/auth/logout').set(bearer(login.accessToken))).status).toBe(204);
    expect((await t.http().post('/api/v1/auth/refresh').send({ refreshToken: login.refreshToken })).status).toBe(401);
  });

  it('resends the verification email once per call (rate limited) and is a no-op when verified', async () => {
    const s = await signupTenant(t);
    const before = t.mailer.sent.length;
    expect((await t.http().post('/api/v1/auth/verify-email/resend').set(bearer(s.accessToken))).status).toBe(204);
    expect(t.mailer.sent.length).toBe(before + 1);
    await t.http().post('/api/v1/auth/verify-email').send({ token: t.mailer.tokenFor(s.email) });
    expect((await t.http().post('/api/v1/auth/verify-email/resend').set(bearer(s.accessToken))).status).toBe(204);
    expect(t.mailer.sent.length).toBe(before + 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @taskop/api test auth-guard permission.guard`
Expected: FAIL — `/api/v1/me` 404 and `./permission.guard` missing.

- [ ] **Step 3: Implement loader and guards**

`apps/api/src/auth/principal-loader.ts`:
```ts
import { Injectable } from '@nestjs/common';
import type { PermissionKey } from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { roles, tenants, users } from '../db/schema';
import { loadRolePermissions } from '../roles/permission-resolver';
import type { AccessClaims } from './crypto/token.service';

@Injectable()
export class PrincipalLoader {
  private readonly permissionCache = new Map<string, ReadonlySet<PermissionKey>>();

  constructor(private readonly db: DbService) {}

  async load(claims: AccessClaims): Promise<Principal> {
    return this.db.withTenant(claims.tid, claims.sub, async (tx) => {
      const [row] = await tx
        .select({
          status: users.status,
          kind: users.kind,
          emailVerifiedAt: users.emailVerifiedAt,
          roleId: roles.id,
          roleVersion: roles.version,
          systemKey: roles.systemKey,
          dataScope: roles.dataScope,
          tenantStatus: tenants.status,
        })
        .from(users)
        .innerJoin(roles, eq(roles.id, users.roleId))
        .innerJoin(tenants, eq(tenants.id, users.tenantId))
        .where(eq(users.id, claims.sub));
      if (!row || row.status !== 'active') throw new AppError('UNAUTHENTICATED');
      if (row.tenantStatus !== 'active') throw new AppError('TENANT_SUSPENDED');
      const cacheKey = `${row.roleId}:${row.roleVersion}`;
      let permissions = this.permissionCache.get(cacheKey);
      if (!permissions) {
        permissions = new Set(await loadRolePermissions(tx, { id: row.roleId, systemKey: row.systemKey }));
        if (this.permissionCache.size > 1000) this.permissionCache.clear();
        this.permissionCache.set(cacheKey, permissions);
      }
      return {
        userId: claims.sub,
        tenantId: claims.tid,
        roleId: row.roleId,
        roleVersion: row.roleVersion,
        systemRoleKey: row.systemKey,
        sessionId: claims.sid,
        kind: row.kind,
        dataScope: row.dataScope,
        permissions,
        emailVerified: row.emailVerifiedAt !== null,
      };
    });
  }
}
```

`apps/api/src/auth/auth.guard.ts`:
```ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../common/app-error';
import { IS_PUBLIC_KEY } from '../common/decorators';
import type { AppRequest } from '../common/request';
import { TokenService } from './crypto/token.service';
import { PrincipalLoader } from './principal-loader';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly principals: PrincipalLoader,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new AppError('UNAUTHENTICATED');
    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED');
    req.principal = await this.principals.load(claims);
    return true;
  }
}
```

`apps/api/src/auth/permission.guard.ts`:
```ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@taskop/contracts';
import { AppError } from '../common/app-error';
import { REQUIRED_PERMISSIONS_KEY } from '../common/decorators';
import type { AppRequest } from '../common/request';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(REQUIRED_PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;
    const principal = ctx.switchToHttp().getRequest<AppRequest>().principal;
    if (!principal || !required.every((k) => principal.permissions.has(k))) throw new AppError('FORBIDDEN');
    return true;
  }
}
```

`apps/api/src/auth/me.controller.ts`:
```ts
import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Me } from '@taskop/contracts';
import { CurrentPrincipal } from '../common/decorators';
import type { Principal } from '../common/request';
import { MeDto } from './dto';
import { MeService } from './me.service';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  @ApiOkResponse({ type: MeDto })
  get(@CurrentPrincipal() p: Principal): Promise<Me> {
    return this.me.load(p.userId);
  }
}
```

- [ ] **Step 4: Logout and resend**

Add to `AuthService` (imports: `Principal` from `../common/request`):
```ts
  /** Runs inside the request's tenant transaction (authenticated route). */
  async logout(p: Principal): Promise<void> {
    await this.db
      .tx()
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, p.sessionId), isNull(sessions.revokedAt)));
    await this.audit.record({ action: 'auth.logout', entityType: 'session', entityId: p.sessionId });
  }

  async resendVerification(p: Principal): Promise<void> {
    if (p.emailVerified) return;
    await this.rateLimit.consume(`verify-resend:${p.userId}`, 3, 3600);
    const [user] = await this.db.tx().select({ email: users.email, fullName: users.fullName }).from(users).where(eq(users.id, p.userId));
    if (!user?.email) return;
    const token = await this.oneTime.create({ tenantId: p.tenantId, userId: p.userId, purpose: 'email_verify' });
    await this.sendMail(verifyEmailMail({ to: user.email, fullName: user.fullName, webUrl: this.config.WEB_URL, token }));
  }
```

Add to `AuthController` (imports: `CurrentPrincipal`, `ApiBearerAuth`, `Principal`):
```ts
  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentPrincipal() p: Principal, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(p);
    clearRefreshCookie(res, this.config);
  }

  @ApiBearerAuth()
  @Post('verify-email/resend')
  @HttpCode(204)
  async resendVerification(@CurrentPrincipal() p: Principal): Promise<void> {
    await this.auth.resendVerification(p);
  }
```

Update `apps/api/src/auth/auth.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { PasswordHasher } from './crypto/password-hasher';
import { TokenService } from './crypto/token.service';
import { LoginLookup } from './login-lookup';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { OneTimeTokenService } from './one-time-token.service';
import { PermissionGuard } from './permission.guard';
import { PrincipalLoader } from './principal-loader';
import { RateLimitService } from './rate-limit.service';
import { SessionService } from './session.service';

@Module({
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    PasswordHasher,
    TokenService,
    SessionService,
    OneTimeTokenService,
    MeService,
    RateLimitService,
    LoginLookup,
    PrincipalLoader,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [AuthService, PasswordHasher, TokenService, SessionService, OneTimeTokenService, MeService, RateLimitService],
})
export class AuthModule {}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @taskop/api test`
Expected: all PASS (health stays public via `@Public()`).

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add auth and permission guards, /me, logout and verification resend"
```

---

### Task 12: Password reset, credential change, invite acceptance

**Files:**
- Create: `apps/api/src/auth/credential.service.ts`
- Modify: `apps/api/src/auth/auth.controller.ts` (4 endpoints), `src/auth/auth.module.ts` (provide/export `CredentialService`)
- Modify: `apps/api/test/fixtures.ts` (add `issueInvite`)
- Test: `apps/api/test/auth-credentials.test.ts`

**Interfaces:**
- Consumes: `AuthService.issueLogin`, `AuthService.sendMail`, `OneTimeTokenService`, `SessionService.revokeAllForUser`, `LoginLookup.staffByEmail`, `PasswordHasher`, `RateLimitService`, `secretSchemaFor`.
- Produces:
  - `class CredentialService { forgotPassword(email): Promise<void>; resetPassword(token, password): Promise<void>; changeCredential(p: Principal, input): Promise<void>; acceptInvite(input): Promise<IssuedLogin>; issueInvite(input: { tenantId; userId; email; fullName }): Promise<void> }` (`issueInvite` runs inside the current tenant tx; used by Users in Task 17).
  - Endpoints: `POST /auth/password/forgot` (204), `POST /auth/password/reset` (204), `POST /auth/invite/accept` (200 LoginResult), `POST /auth/credential/change` (204, authenticated). A wrong current secret returns `INVALID_CREDENTIALS` (never `UNAUTHENTICATED`) so clients don't treat it as an expired session.
  - Fixture `issueInvite(t, tenantId)` → `{ userId, email, token }`.

- [ ] **Step 1: Add the fixture**

Append to `apps/api/test/fixtures.ts` (add import of `OneTimeTokenService` from `../src/auth/one-time-token.service`):
```ts
export async function issueInvite(t: TestApp, tenantId: string) {
  const u = await createUserDirect(t, tenantId, { kind: 'staff', roleKey: 'manager', status: 'invited', secret: null });
  const token = await t.app
    .get(DbService)
    .withTenant(tenantId, null, () => t.app.get(OneTimeTokenService).create({ tenantId, userId: u.id, purpose: 'invite' }));
  return { userId: u.id, email: u.email!, token };
}
```

- [ ] **Step 2: Write the failing test**

`apps/api/test/auth-credentials.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { bearer, createUserDirect, issueInvite, loginStaff, loginWorker, signupTenant } from './fixtures';
import { ownerQuery } from './owner-db';

describe('password reset', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('always answers 204 and only mails known staff', async () => {
    const before = t.mailer.sent.length;
    expect((await t.http().post('/api/v1/auth/password/forgot').send({ email: 'nobody@nowhere.az' })).status).toBe(204);
    expect(t.mailer.sent.length).toBe(before);
  });

  it('resets the password, revokes sessions and burns the token', async () => {
    const s = await signupTenant(t);
    const session = await loginStaff(t, s.email, s.password);
    await t.http().post('/api/v1/auth/password/forgot').send({ email: s.email.toUpperCase() });
    const token = t.mailer.tokenFor(s.email);
    expect((await t.http().post('/api/v1/auth/password/reset').send({ token, password: 'brand new password' })).status).toBe(204);
    await loginStaff(t, s.email, 'brand new password');
    expect((await t.http().post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken })).status).toBe(401);
    const again = await t.http().post('/api/v1/auth/password/reset').send({ token, password: 'another password 1' });
    expect(again.body.error.code).toBe('TOKEN_INVALID');
  });

  it('rejects expired reset tokens', async () => {
    const s = await signupTenant(t);
    await t.http().post('/api/v1/auth/password/forgot').send({ email: s.email });
    const token = t.mailer.tokenFor(s.email);
    await ownerQuery("update auth_tokens set expires_at = now() - interval '1 second' where user_id = $1", [s.ownerId]);
    expect((await t.http().post('/api/v1/auth/password/reset').send({ token, password: 'brand new password' })).body.error.code).toBe(
      'TOKEN_INVALID',
    );
  });
});

describe('credential change', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('returns INVALID_CREDENTIALS (not UNAUTHENTICATED) for a wrong current secret', async () => {
    const s = await signupTenant(t);
    const w = await createUserDirect(t, s.tenantId);
    const login = await loginWorker(t, s.orgCode, w.username!, w.secret);
    const res = await t.http().post('/api/v1/auth/credential/change').set(bearer(login.accessToken)).send({ currentSecret: '000001', newSecret: '730184' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('validates the new secret against the user credential kind', async () => {
    const s = await signupTenant(t);
    const w = await createUserDirect(t, s.tenantId);
    const login = await loginWorker(t, s.orgCode, w.username!, w.secret);
    const res = await t.http().post('/api/v1/auth/credential/change').set(bearer(login.accessToken)).send({ currentSecret: w.secret, newSecret: '123456' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields).toEqual({ newSecret: 'errors.validation.pinWeak' });
  });

  it('changes the PIN, keeps the current session and revokes the others', async () => {
    const s = await signupTenant(t);
    const w = await createUserDirect(t, s.tenantId);
    const other = await loginWorker(t, s.orgCode, w.username!, w.secret);
    const current = await loginWorker(t, s.orgCode, w.username!, w.secret);
    const res = await t.http().post('/api/v1/auth/credential/change').set(bearer(current.accessToken)).send({ currentSecret: w.secret, newSecret: '730184' });
    expect(res.status).toBe(204);
    await loginWorker(t, s.orgCode, w.username!, '730184');
    expect((await t.http().post('/api/v1/auth/refresh').send({ refreshToken: other.refreshToken })).status).toBe(401);
    expect((await t.http().post('/api/v1/auth/refresh').send({ refreshToken: current.refreshToken })).status).toBe(200);
  });
});

describe('invite acceptance', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('activates the invited user, verifies the email and logs in', async () => {
    const s = await signupTenant(t);
    const inv = await issueInvite(t, s.tenantId);
    const res = await t.http().post('/api/v1/auth/invite/accept').send({ token: inv.token, password: 'invited password 1', client: 'mobile' });
    expect(res.status).toBe(200);
    expect(res.body.me.user).toMatchObject({ id: inv.userId, emailVerified: true });
    await loginStaff(t, inv.email, 'invited password 1');
    const again = await t.http().post('/api/v1/auth/invite/accept').send({ token: inv.token, password: 'invited password 1', client: 'mobile' });
    expect(again.body.error.code).toBe('TOKEN_INVALID');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @taskop/api test auth-credentials`
Expected: FAIL — 404 on `/api/v1/auth/password/forgot`.

- [ ] **Step 4: Implement `CredentialService`**

`apps/api/src/auth/credential.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { secretSchemaFor } from '@taskop/contracts';
import { and, eq } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import type { Principal } from '../common/request';
import { currentRequestMeta } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { tenants, users } from '../db/schema';
import { inviteMail, passwordResetMail } from '../mail/templates';
import { type IssuedLogin, AuthService } from './auth.service';
import { parseOpaqueToken } from './crypto/opaque-token';
import { PasswordHasher } from './crypto/password-hasher';
import type { ChangeCredentialDto, InviteAcceptDto } from './dto';
import { LoginLookup } from './login-lookup';
import { OneTimeTokenService } from './one-time-token.service';
import { RateLimitService } from './rate-limit.service';
import { SessionService } from './session.service';

@Injectable()
export class CredentialService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly hasher: PasswordHasher,
    private readonly oneTime: OneTimeTokenService,
    private readonly sessions: SessionService,
    private readonly lookup: LoginLookup,
    private readonly rateLimit: RateLimitService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async forgotPassword(email: string): Promise<void> {
    await this.rateLimit.consume(`forgot:ip:${currentRequestMeta().ip}`, this.config.RL_FORGOT_IP_PER_HOUR, 3600);
    const candidate = await this.lookup.staffByEmail(email);
    if (!candidate || candidate.status !== 'active') return;
    const mail = await this.db.withTenant(candidate.tenantId, null, async (tx) => {
      const [user] = await tx.select({ fullName: users.fullName }).from(users).where(eq(users.id, candidate.id));
      const token = await this.oneTime.create({ tenantId: candidate.tenantId, userId: candidate.id, purpose: 'password_reset' });
      return passwordResetMail({ to: email, fullName: user?.fullName ?? '', webUrl: this.config.WEB_URL, token });
    });
    await this.auth.sendMail(mail);
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const parsed = parseOpaqueToken(token);
    if (!parsed) throw new AppError('TOKEN_INVALID');
    const credentialHash = await this.hasher.hash(password);
    await this.db.withTenant(parsed.tenantId, null, async (tx) => {
      const { userId } = await this.oneTime.consume(token, 'password_reset');
      await tx
        .update(users)
        .set({ credentialHash, credentialKind: 'password', failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
        .where(eq(users.id, userId));
      await this.sessions.revokeAllForUser(userId);
      await this.audit.record({ action: 'user.password_reset', entityType: 'user', entityId: userId, actorUserId: userId });
    });
  }

  /** Authenticated route: runs inside the request's tenant transaction. */
  async changeCredential(p: Principal, input: ChangeCredentialDto): Promise<void> {
    const tx = this.db.tx();
    const [user] = await tx
      .select({ credentialHash: users.credentialHash, credentialKind: users.credentialKind })
      .from(users)
      .where(eq(users.id, p.userId));
    if (!user || !(await this.hasher.verify(user.credentialHash, input.currentSecret))) {
      throw new AppError('INVALID_CREDENTIALS');
    }
    const kind = user.credentialKind ?? 'password';
    const check = secretSchemaFor(kind).safeParse(input.newSecret);
    if (!check.success) {
      throw new AppError('VALIDATION_FAILED', { fields: { newSecret: check.error.issues[0]?.message ?? 'errors.validation.invalid' } });
    }
    await tx
      .update(users)
      .set({ credentialHash: await this.hasher.hash(input.newSecret), updatedAt: new Date() })
      .where(eq(users.id, p.userId));
    await this.sessions.revokeAllForUser(p.userId, p.sessionId);
    await this.audit.record({ action: 'user.credential_changed', entityType: 'user', entityId: p.userId });
  }

  async acceptInvite(input: InviteAcceptDto): Promise<IssuedLogin> {
    const parsed = parseOpaqueToken(input.token);
    if (!parsed) throw new AppError('TOKEN_INVALID');
    const credentialHash = await this.hasher.hash(input.password);
    return this.db.withTenant(parsed.tenantId, null, async (tx) => {
      const { userId } = await this.oneTime.consume(input.token, 'invite');
      const [user] = await tx
        .update(users)
        .set({ credentialHash, credentialKind: 'password', status: 'active', emailVerifiedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(users.id, userId), eq(users.status, 'invited')))
        .returning();
      if (!user || user.kind !== 'staff') throw new AppError('TOKEN_INVALID');
      await this.audit.record({ action: 'user.invite_accepted', entityType: 'user', entityId: userId, actorUserId: userId });
      return this.auth.issueLogin(user, input.client);
    });
  }

  /** Creates an invite token and mails it. Runs inside the current tenant transaction. */
  async issueInvite(input: { tenantId: string; userId: string; email: string; fullName: string }): Promise<void> {
    const [tenant] = await this.db.tx().select({ name: tenants.name }).from(tenants).where(eq(tenants.id, input.tenantId));
    const token = await this.oneTime.create({ tenantId: input.tenantId, userId: input.userId, purpose: 'invite' });
    await this.auth.sendMail(
      inviteMail({ to: input.email, fullName: input.fullName, orgName: tenant?.name ?? '', webUrl: this.config.WEB_URL, token }),
    );
  }
}
```
An invite whose user was deactivated before acceptance matches no row (the `status = 'invited'` condition), so it throws `TOKEN_INVALID` and the token consumption rolls back.

- [ ] **Step 5: Endpoints and module**

Add to `AuthController` (constructor gains `private readonly credentials: CredentialService`; imports `ForgotPasswordDto`, `ResetPasswordDto`, `InviteAcceptDto`, `ChangeCredentialDto`):
```ts
  @Public()
  @Post('password/forgot')
  @HttpCode(204)
  async forgot(@Body() body: ForgotPasswordDto): Promise<void> {
    await this.credentials.forgotPassword(body.email);
  }

  @Public()
  @Post('password/reset')
  @HttpCode(204)
  async reset(@Body() body: ResetPasswordDto): Promise<void> {
    await this.credentials.resetPassword(body.token, body.password);
  }

  @Public()
  @Post('invite/accept')
  @HttpCode(200)
  @ApiOkResponse({ type: LoginResultDto })
  async acceptInvite(@Body() body: InviteAcceptDto, @Res({ passthrough: true }) res: Response): Promise<LoginResult> {
    return this.respond(await this.credentials.acceptInvite(body), res);
  }

  @ApiBearerAuth()
  @Post('credential/change')
  @HttpCode(204)
  async changeCredential(@CurrentPrincipal() p: Principal, @Body() body: ChangeCredentialDto): Promise<void> {
    await this.credentials.changeCredential(p, body);
  }
```
In `auth.module.ts` add `CredentialService` to `providers` and `exports`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @taskop/api test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): add password reset, credential change and invite acceptance"
```

---

### Task 13: Data-scope filters

**Files:**
- Create: `apps/api/src/common/scope.service.ts`, `src/common/common.module.ts`
- Modify: `apps/api/src/app.module.ts` (import `CommonModule`)
- Test: `apps/api/test/scope.test.ts`

**Interfaces:**
- Consumes: `Principal`, `users`, `userSites`, `sites`.
- Produces: `class ScopeService { usersFilter(p: Pick<Principal, 'userId' | 'dataScope'>): SQL | undefined }`: always includes the user themselves; `site_subtree` with no sites → only themselves; `subordinates` follows `manager_id` recursively (cycle-safe via `UNION`). `CommonModule` (global) exports `ScopeService`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/scope.test.ts`:
```ts
import type { DataScope } from '@taskop/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ScopeService } from '../src/common/scope.service';
import { DbService } from '../src/db/db.service';
import { sites, siteTypes, userSites, users } from '../src/db/schema';
import { createTestApp, type TestApp } from './app';
import { createUserDirect, signupTenant } from './fixtures';

describe('ScopeService.usersFilter', () => {
  let t: TestApp;
  let db: DbService;
  const scope = new ScopeService();
  let tenantId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    t = await createTestApp();
    db = t.app.get(DbService);
    const s = await signupTenant(t);
    tenantId = s.tenantId;
    ids.owner = s.ownerId;
    for (const name of ['manager', 'managerNoSites', 'w1', 'w2', 'boss', 'mid', 'leaf']) {
      ids[name] = (await createUserDirect(t, tenantId, { fullName: name })).id;
    }
    await db.withTenant(tenantId, null, async (tx) => {
      const [type] = await tx.select().from(siteTypes).limit(1);
      const label = (id: string) => id.replaceAll('-', '');
      const insertSite = async (name: string, parentPath: string | null, parentId: string | null) => {
        const { uuidv7 } = await import('uuidv7');
        const id = uuidv7();
        const path = parentPath ? `${parentPath}.${label(id)}` : label(id);
        await tx.insert(sites).values({ id, tenantId, parentId, typeId: type!.id, name, path });
        return { id, path };
      };
      const a = await insertSite('A', null, null);
      const a1 = await insertSite('A1', a.path, a.id);
      const b = await insertSite('B', null, null);
      await tx.insert(userSites).values([
        { tenantId, userId: ids.manager!, siteId: a.id },
        { tenantId, userId: ids.w1!, siteId: a1.id },
        { tenantId, userId: ids.w2!, siteId: b.id },
      ]);
      const { eq } = await import('drizzle-orm');
      await tx.update(users).set({ managerId: ids.boss! }).where(eq(users.id, ids.mid!));
      await tx.update(users).set({ managerId: ids.mid! }).where(eq(users.id, ids.leaf!));
    });
  });
  afterAll(() => t.close());

  const visible = (userId: string, dataScope: DataScope) =>
    db.withTenant(tenantId, null, async (tx) => {
      const rows = await tx.select({ id: users.id }).from(users).where(scope.usersFilter({ userId, dataScope }));
      return rows.map((r) => r.id).sort();
    });

  it('site_subtree shows users at the manager sites and below, plus self', async () => {
    expect(await visible(ids.manager!, 'site_subtree')).toEqual([ids.manager!, ids.w1!].sort());
  });

  it('site_subtree with no sites shows only self', async () => {
    expect(await visible(ids.managerNoSites!, 'site_subtree')).toEqual([ids.managerNoSites!]);
  });

  it('subordinates follows the reporting chain', async () => {
    expect(await visible(ids.boss!, 'subordinates')).toEqual([ids.boss!, ids.mid!, ids.leaf!].sort());
    expect(await visible(ids.mid!, 'subordinates')).toEqual([ids.mid!, ids.leaf!].sort());
  });

  it('own shows only self and all shows everyone', async () => {
    expect(await visible(ids.w2!, 'own')).toEqual([ids.w2!]);
    expect((await visible(ids.owner!, 'all')).length).toBe(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @taskop/api test scope`
Expected: FAIL — `../src/common/scope.service` not found.

- [ ] **Step 3: Implement**

`apps/api/src/common/scope.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { eq, or, type SQL, sql } from 'drizzle-orm';
import { users } from '../db/schema';
import type { Principal } from './request';

@Injectable()
export class ScopeService {
  /** Restricts a query on `users` to the rows the principal's data scope allows. */
  usersFilter(p: Pick<Principal, 'userId' | 'dataScope'>): SQL | undefined {
    switch (p.dataScope) {
      case 'all':
        return undefined;
      case 'own':
        return eq(users.id, p.userId);
      case 'subordinates':
        return sql`${users.id} in (
          with recursive chain as (
            select u.id from users u where u.id = ${p.userId}
            union
            select u.id from users u join chain c on u.manager_id = c.id
          ) select id from chain)`;
      case 'site_subtree':
        return or(
          eq(users.id, p.userId),
          sql`exists (
            select 1 from user_sites us
            join sites s on s.id = us.site_id
            where us.user_id = ${users.id}
              and exists (
                select 1 from user_sites mine
                join sites ms on ms.id = mine.site_id
                where mine.user_id = ${p.userId} and s.path <@ ms.path))`,
        );
    }
  }
}
```

`apps/api/src/common/common.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { ScopeService } from './scope.service';

@Global()
@Module({ providers: [ScopeService], exports: [ScopeService] })
export class CommonModule {}
```
Add `CommonModule` to `AppModule` imports.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @taskop/api test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): add data-scope filters for users (all, site subtree, subordinates, own)"
```

---

### Task 14: Tenant settings, site types and the site tree

**Files:**
- Create: `apps/api/src/tenancy/dto.ts`, `src/tenancy/tenant.service.ts`, `src/tenancy/tenant.controller.ts`, `src/tenancy/site-types.service.ts`, `src/tenancy/site-types.controller.ts`, `src/tenancy/sites.service.ts`, `src/tenancy/sites.controller.ts`, `src/tenancy/tenancy.module.ts`
- Modify: `apps/api/src/app.module.ts` (import `TenancyModule`), `apps/api/test/fixtures.ts` (add `as`, `roleIdOf`, `siteTypeIdOf`)
- Test: `apps/api/test/sites.test.ts`

**Interfaces:**
- Consumes: `DbService`, `AuditService`, `RequirePermission`, `ParseIdPipe`, contracts schemas.
- Produces:
  - `toTenantDto(row): TenantDto`, `toSiteDto(row): SiteDto`, `siteLabel(id): string` (UUID without hyphens, a valid ltree label).
  - Endpoints: `GET /tenant` (any user), `PATCH /tenant` (`tenant.manage`); `GET /site-types` (`sites.view`), `POST /site-types`, `PATCH /site-types/:id` (`sites.manage`); `GET /sites` (`sites.view`, flat list ordered by `path`), `POST /sites`, `PATCH /sites/:id`, `POST /sites/:id/move` (`sites.manage`).
  - Fixtures: `as(t, token)` → `{ get, post, patch, put }` supertest helpers with bearer auth; `roleIdOf(tenantId, systemKey)`; `siteTypeIdOf(tenantId, name?)`.

- [ ] **Step 1: Add fixtures**

Append to `apps/api/test/fixtures.ts`:
```ts
import { ownerQuery } from './owner-db';

export function as(t: TestApp, token: string) {
  return {
    get: (url: string) => t.http().get(url).set(bearer(token)),
    post: (url: string, body: object = {}) => t.http().post(url).set(bearer(token)).send(body),
    patch: (url: string, body: object = {}) => t.http().patch(url).set(bearer(token)).send(body),
    put: (url: string, body: object = {}) => t.http().put(url).set(bearer(token)).send(body),
  };
}

export async function roleIdOf(tenantId: string, systemKey: SystemRoleKey): Promise<string> {
  const r = await ownerQuery<{ id: string }>('select id from roles where tenant_id = $1 and system_key = $2', [tenantId, systemKey]);
  return r.rows[0]!.id;
}

export async function siteTypeIdOf(tenantId: string, name = 'Filial'): Promise<string> {
  const r = await ownerQuery<{ id: string }>('select id from site_types where tenant_id = $1 and name = $2', [tenantId, name]);
  return r.rows[0]!.id;
}
```

- [ ] **Step 2: Write the failing test**

`apps/api/test/sites.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { as, createUserDirect, loginStaff, loginWorker, signupTenant, siteTypeIdOf } from './fixtures';
import { ownerQuery } from './owner-db';

describe('tenant settings', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('reads and updates name and timezone, with audit', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    expect((await owner.get('/api/v1/tenant')).body).toMatchObject({ orgCode: s.orgCode, timezone: 'Asia/Baku' });
    const bad = await owner.patch('/api/v1/tenant', { timezone: 'Mars/Base' });
    expect(bad.body.error.fields).toEqual({ timezone: 'errors.validation.timezone' });
    const ok = await owner.patch('/api/v1/tenant', { name: 'Acme Group', timezone: 'Europe/Istanbul' });
    expect(ok.body).toMatchObject({ name: 'Acme Group', timezone: 'Europe/Istanbul' });
    const audit = await ownerQuery("select before, after from audit_log where tenant_id = $1 and action = 'tenant.updated'", [s.tenantId]);
    expect(audit.rows[0]).toMatchObject({ before: { timezone: 'Asia/Baku' }, after: { timezone: 'Europe/Istanbul' } });
  });

  it('only tenant.manage may update', async () => {
    const s = await signupTenant(t);
    const w = await createUserDirect(t, s.tenantId);
    const login = await loginWorker(t, s.orgCode, w.username!, w.secret);
    expect((await as(t, login.accessToken).get('/api/v1/tenant')).status).toBe(200);
    expect((await as(t, login.accessToken).patch('/api/v1/tenant', { name: 'Hacked' })).body.error.code).toBe('FORBIDDEN');
  });
});

describe('site types and sites', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('manages site types', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const created = await owner.post('/api/v1/site-types', { name: 'Anbar', sortOrder: 10 });
    expect(created.status).toBe(201);
    const updated = await owner.patch(`/api/v1/site-types/${created.body.id}`, { active: false });
    expect(updated.body.active).toBe(false);
    const list = await owner.get('/api/v1/site-types');
    expect(list.body.map((x: { name: string }) => x.name)).toEqual(['Filial', 'Zona', 'Bölmə', 'Yoxlama nöqtəsi', 'Anbar']);
  });

  it('builds a tree and moves subtrees, updating descendant paths', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const typeId = await siteTypeIdOf(s.tenantId);
    const a = (await owner.post('/api/v1/sites', { parentId: null, typeId, name: 'Filial A' })).body;
    const a1 = (await owner.post('/api/v1/sites', { parentId: a.id, typeId, name: 'Zona A1', address: 'Bakı' })).body;
    const a11 = (await owner.post('/api/v1/sites', { parentId: a1.id, typeId, name: 'Bölmə A1.1' })).body;
    const b = (await owner.post('/api/v1/sites', { parentId: null, typeId, name: 'Filial B' })).body;
    expect(a11).toMatchObject({ parentId: a1.id, depth: 2 });

    const moved = await owner.post(`/api/v1/sites/${a1.id}/move`, { parentId: b.id });
    expect(moved.body).toMatchObject({ parentId: b.id, depth: 1 });
    const list = (await owner.get('/api/v1/sites')).body as Array<{ id: string; path: string; depth: number }>;
    const child = list.find((x) => x.id === a11.id)!;
    expect(child.path.startsWith(moved.body.path + '.')).toBe(true);
    expect(child.depth).toBe(2);

    const toRoot = await owner.post(`/api/v1/sites/${a1.id}/move`, { parentId: null });
    expect(toRoot.body).toMatchObject({ parentId: null, depth: 0 });
  });

  it('refuses to move a site under itself or its descendant', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const typeId = await siteTypeIdOf(s.tenantId);
    const a = (await owner.post('/api/v1/sites', { parentId: null, typeId, name: 'A' })).body;
    const a1 = (await owner.post('/api/v1/sites', { parentId: a.id, typeId, name: 'A1' })).body;
    expect((await owner.post(`/api/v1/sites/${a.id}/move`, { parentId: a1.id })).body.error.code).toBe('SITE_CYCLE');
    expect((await owner.post(`/api/v1/sites/${a.id}/move`, { parentId: a.id })).body.error.code).toBe('SITE_CYCLE');
  });

  it('rejects inactive or foreign site types', async () => {
    const s = await signupTenant(t);
    const other = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const foreignType = await siteTypeIdOf(other.tenantId);
    expect((await owner.post('/api/v1/sites', { parentId: null, typeId: foreignType, name: 'X' })).status).toBe(422);
    const inactive = (await owner.post('/api/v1/site-types', { name: 'Old' })).body;
    await owner.patch(`/api/v1/site-types/${inactive.id}`, { active: false });
    expect((await owner.post('/api/v1/sites', { parentId: null, typeId: inactive.id, name: 'X' })).body.error.code).toBe(
      'REFERENCE_NOT_FOUND',
    );
  });

  it('enforces sites.view / sites.manage', async () => {
    const s = await signupTenant(t);
    const w = await createUserDirect(t, s.tenantId);
    const worker = as(t, (await loginWorker(t, s.orgCode, w.username!, w.secret)).accessToken);
    expect((await worker.get('/api/v1/sites')).status).toBe(403);
    const m = await createUserDirect(t, s.tenantId, { kind: 'staff', roleKey: 'manager' });
    const manager = as(t, (await loginStaff(t, m.email!, m.secret)).accessToken);
    expect((await manager.get('/api/v1/sites')).status).toBe(200);
    const typeId = await siteTypeIdOf(s.tenantId);
    expect((await manager.post('/api/v1/sites', { parentId: null, typeId, name: 'X' })).status).toBe(403);
  });

  it('returns 404 for unknown or malformed ids', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    expect((await owner.patch('/api/v1/sites/not-a-uuid', { name: 'x' })).status).toBe(404);
    expect((await owner.patch('/api/v1/sites/0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f', { name: 'x' })).status).toBe(404);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @taskop/api test sites`
Expected: FAIL — 404 on `/api/v1/tenant`.

- [ ] **Step 4: Implement DTOs and services**

`apps/api/src/tenancy/dto.ts`:
```ts
import {
  createSiteInputSchema,
  createSiteTypeInputSchema,
  moveSiteInputSchema,
  siteDtoSchema,
  siteTypeDtoSchema,
  tenantDtoSchema,
  updateSiteInputSchema,
  updateSiteTypeInputSchema,
  updateTenantInputSchema,
} from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class UpdateTenantDto extends createZodDto(updateTenantInputSchema) {}
export class TenantResponse extends createZodDto(tenantDtoSchema) {}
export class CreateSiteTypeDto extends createZodDto(createSiteTypeInputSchema) {}
export class UpdateSiteTypeDto extends createZodDto(updateSiteTypeInputSchema) {}
export class SiteTypeResponse extends createZodDto(siteTypeDtoSchema) {}
export class CreateSiteDto extends createZodDto(createSiteInputSchema) {}
export class UpdateSiteDto extends createZodDto(updateSiteInputSchema) {}
export class MoveSiteDto extends createZodDto(moveSiteInputSchema) {}
export class SiteResponse extends createZodDto(siteDtoSchema) {}
```

`apps/api/src/tenancy/tenant.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import type { TenantDto } from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { tenants } from '../db/schema';
import type { UpdateTenantDto } from './dto';

export function toTenantDto(t: typeof tenants.$inferSelect): TenantDto {
  return {
    id: t.id,
    name: t.name,
    orgCode: t.orgCode,
    timezone: t.timezone,
    locale: t.locale,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
  };
}

@Injectable()
export class TenantService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<TenantDto> {
    const { tenantId } = this.db.context();
    const [row] = await this.db.tx().select().from(tenants).where(eq(tenants.id, tenantId));
    return toTenantDto(row!);
  }

  async update(input: UpdateTenantDto): Promise<TenantDto> {
    const { tenantId } = this.db.context();
    const before = await this.get();
    const [row] = await this.db
      .tx()
      .update(tenants)
      .set({ name: input.name, timezone: input.timezone, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId))
      .returning();
    const after = toTenantDto(row!);
    await this.audit.record({ action: 'tenant.updated', entityType: 'tenant', entityId: tenantId, before, after });
    return after;
  }
}
```

`apps/api/src/tenancy/site-types.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import type { SiteTypeDto } from '@taskop/contracts';
import { asc, eq } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { siteTypes } from '../db/schema';
import type { CreateSiteTypeDto, UpdateSiteTypeDto } from './dto';

const toDto = (r: typeof siteTypes.$inferSelect): SiteTypeDto => ({ id: r.id, name: r.name, sortOrder: r.sortOrder, active: r.active });

@Injectable()
export class SiteTypesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<SiteTypeDto[]> {
    const rows = await this.db.tx().select().from(siteTypes).orderBy(asc(siteTypes.sortOrder), asc(siteTypes.name));
    return rows.map(toDto);
  }

  async create(input: CreateSiteTypeDto): Promise<SiteTypeDto> {
    const { tenantId } = this.db.context();
    const [row] = await this.db.tx().insert(siteTypes).values({ tenantId, name: input.name, sortOrder: input.sortOrder }).returning();
    const dto = toDto(row!);
    await this.audit.record({ action: 'site_type.created', entityType: 'site_type', entityId: dto.id, after: dto });
    return dto;
  }

  async update(id: string, input: UpdateSiteTypeDto): Promise<SiteTypeDto> {
    const tx = this.db.tx();
    const [existing] = await tx.select().from(siteTypes).where(eq(siteTypes.id, id));
    if (!existing) throw new AppError('NOT_FOUND');
    const [row] = await tx
      .update(siteTypes)
      .set({ name: input.name, sortOrder: input.sortOrder, active: input.active })
      .where(eq(siteTypes.id, id))
      .returning();
    const dto = toDto(row!);
    await this.audit.record({ action: 'site_type.updated', entityType: 'site_type', entityId: id, before: toDto(existing), after: dto });
    return dto;
  }
}
```

`apps/api/src/tenancy/sites.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import type { SiteDto } from '@taskop/contracts';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { AppError } from '../common/app-error';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { sites, siteTypes } from '../db/schema';
import type { CreateSiteDto, MoveSiteDto, UpdateSiteDto } from './dto';

export const siteLabel = (id: string): string => id.replaceAll('-', '');

export function toSiteDto(r: typeof sites.$inferSelect): SiteDto {
  return {
    id: r.id,
    parentId: r.parentId,
    typeId: r.typeId,
    name: r.name,
    address: r.address,
    active: r.active,
    path: r.path,
    depth: r.path.split('.').length - 1,
  };
}

const isSameOrDescendant = (candidatePath: string, ancestorPath: string) =>
  candidatePath === ancestorPath || candidatePath.startsWith(`${ancestorPath}.`);

@Injectable()
export class SitesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<SiteDto[]> {
    const rows = await this.db.tx().select().from(sites).orderBy(asc(sites.path));
    return rows.map(toSiteDto);
  }

  async create(input: CreateSiteDto): Promise<SiteDto> {
    const { tenantId } = this.db.context();
    await this.requireActiveType(input.typeId);
    const parent = input.parentId ? await this.find(input.parentId, 'REFERENCE_NOT_FOUND') : null;
    const id = uuidv7();
    const [row] = await this.db
      .tx()
      .insert(sites)
      .values({
        id,
        tenantId,
        parentId: parent?.id ?? null,
        typeId: input.typeId,
        name: input.name,
        address: input.address ?? null,
        path: parent ? `${parent.path}.${siteLabel(id)}` : siteLabel(id),
      })
      .returning();
    const dto = toSiteDto(row!);
    await this.audit.record({ action: 'site.created', entityType: 'site', entityId: id, after: dto });
    return dto;
  }

  async update(id: string, input: UpdateSiteDto): Promise<SiteDto> {
    const existing = await this.find(id, 'NOT_FOUND');
    if (input.typeId && input.typeId !== existing.typeId) await this.requireActiveType(input.typeId);
    const [row] = await this.db
      .tx()
      .update(sites)
      .set({ name: input.name, typeId: input.typeId, address: input.address, active: input.active, updatedAt: new Date() })
      .where(eq(sites.id, id))
      .returning();
    const dto = toSiteDto(row!);
    await this.audit.record({ action: 'site.updated', entityType: 'site', entityId: id, before: toSiteDto(existing), after: dto });
    return dto;
  }

  async move(id: string, input: MoveSiteDto): Promise<SiteDto> {
    const tx = this.db.tx();
    const node = await this.find(id, 'NOT_FOUND');
    const parent = input.parentId ? await this.find(input.parentId, 'REFERENCE_NOT_FOUND') : null;
    if (parent && isSameOrDescendant(parent.path, node.path)) throw new AppError('SITE_CYCLE');
    const oldPath = node.path;
    const newPath = parent ? `${parent.path}.${siteLabel(node.id)}` : siteLabel(node.id);
    const [row] = await tx
      .update(sites)
      .set({ parentId: parent?.id ?? null, path: newPath, updatedAt: new Date() })
      .where(eq(sites.id, id))
      .returning();
    await tx
      .update(sites)
      .set({
        path: sql`${newPath}::ltree || subpath(${sites.path}, nlevel(${oldPath}::ltree))`,
        updatedAt: new Date(),
      })
      .where(and(sql`${sites.path} <@ ${oldPath}::ltree`, ne(sites.id, id)));
    const dto = toSiteDto(row!);
    await this.audit.record({
      action: 'site.moved',
      entityType: 'site',
      entityId: id,
      before: { parentId: node.parentId },
      after: { parentId: dto.parentId },
    });
    return dto;
  }

  private async find(id: string, missing: 'NOT_FOUND' | 'REFERENCE_NOT_FOUND') {
    const [row] = await this.db.tx().select().from(sites).where(eq(sites.id, id));
    if (!row) throw new AppError(missing);
    return row;
  }

  private async requireActiveType(typeId: string): Promise<void> {
    const [type] = await this.db
      .tx()
      .select({ id: siteTypes.id })
      .from(siteTypes)
      .where(and(eq(siteTypes.id, typeId), eq(siteTypes.active, true)));
    if (!type) throw new AppError('REFERENCE_NOT_FOUND');
  }
}
```

- [ ] **Step 5: Implement controllers and module**

`apps/api/src/tenancy/tenant.controller.ts`:
```ts
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { TenantDto } from '@taskop/contracts';
import { RequirePermission } from '../common/decorators';
import { TenantResponse, UpdateTenantDto } from './dto';
import { TenantService } from './tenant.service';

@ApiTags('tenant')
@ApiBearerAuth()
@Controller('tenant')
export class TenantController {
  constructor(private readonly tenant: TenantService) {}

  @Get()
  @ApiOkResponse({ type: TenantResponse })
  get(): Promise<TenantDto> {
    return this.tenant.get();
  }

  @Patch()
  @RequirePermission('tenant.manage')
  @ApiOkResponse({ type: TenantResponse })
  update(@Body() body: UpdateTenantDto): Promise<TenantDto> {
    return this.tenant.update(body);
  }
}
```

`apps/api/src/tenancy/site-types.controller.ts`:
```ts
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { SiteTypeDto } from '@taskop/contracts';
import { RequirePermission } from '../common/decorators';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { CreateSiteTypeDto, SiteTypeResponse, UpdateSiteTypeDto } from './dto';
import { SiteTypesService } from './site-types.service';

@ApiTags('sites')
@ApiBearerAuth()
@Controller('site-types')
export class SiteTypesController {
  constructor(private readonly types: SiteTypesService) {}

  @Get()
  @RequirePermission('sites.view')
  @ApiOkResponse({ type: [SiteTypeResponse] })
  list(): Promise<SiteTypeDto[]> {
    return this.types.list();
  }

  @Post()
  @RequirePermission('sites.manage')
  create(@Body() body: CreateSiteTypeDto): Promise<SiteTypeDto> {
    return this.types.create(body);
  }

  @Patch(':id')
  @RequirePermission('sites.manage')
  update(@Param('id', ParseIdPipe) id: string, @Body() body: UpdateSiteTypeDto): Promise<SiteTypeDto> {
    return this.types.update(id, body);
  }
}
```

`apps/api/src/tenancy/sites.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { SiteDto } from '@taskop/contracts';
import { RequirePermission } from '../common/decorators';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { CreateSiteDto, MoveSiteDto, SiteResponse, UpdateSiteDto } from './dto';
import { SitesService } from './sites.service';

@ApiTags('sites')
@ApiBearerAuth()
@Controller('sites')
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  @Get()
  @RequirePermission('sites.view')
  @ApiOkResponse({ type: [SiteResponse] })
  list(): Promise<SiteDto[]> {
    return this.sites.list();
  }

  @Post()
  @RequirePermission('sites.manage')
  create(@Body() body: CreateSiteDto): Promise<SiteDto> {
    return this.sites.create(body);
  }

  @Patch(':id')
  @RequirePermission('sites.manage')
  update(@Param('id', ParseIdPipe) id: string, @Body() body: UpdateSiteDto): Promise<SiteDto> {
    return this.sites.update(id, body);
  }

  @Post(':id/move')
  @HttpCode(200)
  @RequirePermission('sites.manage')
  move(@Param('id', ParseIdPipe) id: string, @Body() body: MoveSiteDto): Promise<SiteDto> {
    return this.sites.move(id, body);
  }
}
```

`apps/api/src/tenancy/tenancy.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { SiteTypesController } from './site-types.controller';
import { SiteTypesService } from './site-types.service';
import { SitesController } from './sites.controller';
import { SitesService } from './sites.service';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

@Module({
  controllers: [TenantController, SiteTypesController, SitesController],
  providers: [TenantService, SiteTypesService, SitesService],
})
export class TenancyModule {}
```
Add `TenancyModule` to `AppModule` imports.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @taskop/api test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): add tenant settings, site types and site tree with subtree moves"
```

---

### Task 15: Teams

**Files:**
- Create: `apps/api/src/teams/dto.ts`, `src/teams/teams.service.ts`, `src/teams/teams.controller.ts`, `src/teams/teams.module.ts`
- Create: `apps/api/src/common/ids-exist.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/teams.test.ts`

**Interfaces:**
- Produces:
  - `assertIdsExist(tx: Executor, table: PgTable, idColumn: PgColumn, ids: string[]): Promise<void>` → throws `REFERENCE_NOT_FOUND` if any id isn't visible in the current tenant (used again by Users).
  - Endpoints: `GET /teams` (`teams.view`), `POST /teams`, `PATCH /teams/:id`, `PUT /teams/:id/members` (`teams.manage`); `TeamDto.memberIds`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/teams.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { as, createUserDirect, loginWorker, signupTenant } from './fixtures';

describe('teams', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('creates, updates and lists teams with members', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const w1 = await createUserDirect(t, s.tenantId);
    const w2 = await createUserDirect(t, s.tenantId);
    const team = (await owner.post('/api/v1/teams', { name: 'Təmizlik', description: 'Səhər növbəsi' })).body;
    expect(team).toMatchObject({ name: 'Təmizlik', active: true, memberIds: [] });
    const members = await owner.put(`/api/v1/teams/${team.id}/members`, { userIds: [w1.id, w2.id, w1.id] });
    expect(members.body.memberIds.sort()).toEqual([w1.id, w2.id].sort());
    await owner.put(`/api/v1/teams/${team.id}/members`, { userIds: [w2.id] });
    const updated = await owner.patch(`/api/v1/teams/${team.id}`, { name: 'Təmizlik qrupu', active: false });
    expect(updated.body).toMatchObject({ name: 'Təmizlik qrupu', active: false, memberIds: [w2.id] });
    expect((await owner.get('/api/v1/teams')).body).toHaveLength(1);
  });

  it('rejects members from another tenant', async () => {
    const s = await signupTenant(t);
    const other = await signupTenant(t);
    const foreign = await createUserDirect(t, other.tenantId);
    const owner = as(t, s.accessToken);
    const team = (await owner.post('/api/v1/teams', { name: 'X' })).body;
    expect((await owner.put(`/api/v1/teams/${team.id}/members`, { userIds: [foreign.id] })).status).toBe(422);
  });

  it('forbids workers', async () => {
    const s = await signupTenant(t);
    const w = await createUserDirect(t, s.tenantId);
    const worker = as(t, (await loginWorker(t, s.orgCode, w.username!, w.secret)).accessToken);
    expect((await worker.get('/api/v1/teams')).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @taskop/api test teams`
Expected: FAIL — 404.

- [ ] **Step 3: Implement**

`apps/api/src/common/ids-exist.ts`:
```ts
import { inArray } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Executor } from '../db/db.service';
import { AppError } from './app-error';

/** RLS hides other tenants' rows, so a count mismatch means a foreign or unknown id. */
export async function assertIdsExist(tx: Executor, table: PgTable, idColumn: PgColumn, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const rows = await tx.select({ id: idColumn }).from(table).where(inArray(idColumn, unique));
  if (rows.length !== unique.length) throw new AppError('REFERENCE_NOT_FOUND');
}
```

`apps/api/src/teams/dto.ts`:
```ts
import { createTeamInputSchema, setTeamMembersInputSchema, teamDtoSchema, updateTeamInputSchema } from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class CreateTeamDto extends createZodDto(createTeamInputSchema) {}
export class UpdateTeamDto extends createZodDto(updateTeamInputSchema) {}
export class SetTeamMembersDto extends createZodDto(setTeamMembersInputSchema) {}
export class TeamResponse extends createZodDto(teamDtoSchema) {}
```

`apps/api/src/teams/teams.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import type { TeamDto } from '@taskop/contracts';
import { asc, eq, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { assertIdsExist } from '../common/ids-exist';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { teams, users, userTeams } from '../db/schema';
import type { CreateTeamDto, SetTeamMembersDto, UpdateTeamDto } from './dto';

@Injectable()
export class TeamsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<TeamDto[]> {
    return this.select().orderBy(asc(teams.name));
  }

  async create(input: CreateTeamDto): Promise<TeamDto> {
    const { tenantId } = this.db.context();
    const [row] = await this.db
      .tx()
      .insert(teams)
      .values({ tenantId, name: input.name, description: input.description ?? null })
      .returning({ id: teams.id });
    const dto = await this.get(row!.id);
    await this.audit.record({ action: 'team.created', entityType: 'team', entityId: dto.id, after: dto });
    return dto;
  }

  async update(id: string, input: UpdateTeamDto): Promise<TeamDto> {
    const before = await this.get(id);
    await this.db
      .tx()
      .update(teams)
      .set({ name: input.name, description: input.description, active: input.active, updatedAt: new Date() })
      .where(eq(teams.id, id));
    const after = await this.get(id);
    await this.audit.record({ action: 'team.updated', entityType: 'team', entityId: id, before, after });
    return after;
  }

  async setMembers(id: string, input: SetTeamMembersDto): Promise<TeamDto> {
    const { tenantId } = this.db.context();
    const tx = this.db.tx();
    const before = await this.get(id);
    const userIds = [...new Set(input.userIds)];
    await assertIdsExist(tx, users, users.id, userIds);
    await tx.delete(userTeams).where(eq(userTeams.teamId, id));
    if (userIds.length) await tx.insert(userTeams).values(userIds.map((userId) => ({ tenantId, userId, teamId: id })));
    const after = await this.get(id);
    await this.audit.record({
      action: 'team.members_changed',
      entityType: 'team',
      entityId: id,
      before: { memberIds: before.memberIds },
      after: { memberIds: after.memberIds },
    });
    return after;
  }

  private select() {
    return this.db
      .tx()
      .select({
        id: teams.id,
        name: teams.name,
        description: teams.description,
        active: teams.active,
        memberIds: sql<string[]>`coalesce((select array_agg(ut.user_id::text order by ut.user_id) from user_teams ut where ut.team_id = ${teams.id}), '{}')`,
      })
      .from(teams)
      .$dynamic();
  }

  private async get(id: string): Promise<TeamDto> {
    const [row] = await this.select().where(eq(teams.id, id));
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }
}
```

`apps/api/src/teams/teams.controller.ts`:
```ts
import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { TeamDto } from '@taskop/contracts';
import { RequirePermission } from '../common/decorators';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { CreateTeamDto, SetTeamMembersDto, TeamResponse, UpdateTeamDto } from './dto';
import { TeamsService } from './teams.service';

@ApiTags('teams')
@ApiBearerAuth()
@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  @RequirePermission('teams.view')
  @ApiOkResponse({ type: [TeamResponse] })
  list(): Promise<TeamDto[]> {
    return this.teams.list();
  }

  @Post()
  @RequirePermission('teams.manage')
  create(@Body() body: CreateTeamDto): Promise<TeamDto> {
    return this.teams.create(body);
  }

  @Patch(':id')
  @RequirePermission('teams.manage')
  update(@Param('id', ParseIdPipe) id: string, @Body() body: UpdateTeamDto): Promise<TeamDto> {
    return this.teams.update(id, body);
  }

  @Put(':id/members')
  @RequirePermission('teams.manage')
  setMembers(@Param('id', ParseIdPipe) id: string, @Body() body: SetTeamMembersDto): Promise<TeamDto> {
    return this.teams.setMembers(id, body);
  }
}
```

`apps/api/src/teams/teams.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

@Module({ controllers: [TeamsController], providers: [TeamsService] })
export class TeamsModule {}
```
Add `TeamsModule` to `AppModule` imports.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @taskop/api test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): add teams with membership management"
```

---

### Task 16: Roles and the permission catalogue

**Files:**
- Create: `apps/api/src/roles/dto.ts`, `src/roles/roles.service.ts`, `src/roles/roles.controller.ts`, `src/roles/roles.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/roles.test.ts`

**Interfaces:**
- Consumes: `loadRolePermissions`, `Principal`, `PERMISSION_GROUPS`.
- Produces:
  - `assertNoEscalation(p: Principal, permissions: readonly PermissionKey[]): void` (throws `ROLE_ESCALATION`), exported from `roles.service.ts` and reused by Users.
  - Endpoints: `GET /roles` (`roles.view`; includes `permissions`, `userCount` = active+invited users), `GET /permissions` (`roles.view`), `POST /roles`, `PATCH /roles/:id`, `PUT /roles/:id/permissions` (`roles.manage`). Every change increments `roles.version`.
  - Rules: Owner role → `ROLE_NOT_EDITABLE` for any change; other system roles can't be renamed or deactivated (`ROLE_NOT_EDITABLE`); deactivating a role with active/invited users → `ROLE_IN_USE`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/roles.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { as, createUserDirect, loginStaff, roleIdOf, signupTenant } from './fixtures';

describe('roles', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('lists built-in roles with permissions and user counts', async () => {
    const s = await signupTenant(t);
    const roles = (await as(t, s.accessToken).get('/api/v1/roles')).body as Array<{ systemKey: string; userCount: number; permissions: string[] }>;
    expect(roles.map((r) => r.systemKey).sort()).toEqual(['admin', 'auditor', 'manager', 'owner', 'worker']);
    expect(roles.find((r) => r.systemKey === 'owner')).toMatchObject({ userCount: 1 });
    expect(roles.find((r) => r.systemKey === 'manager')!.permissions.sort()).toEqual(['sites.view', 'teams.view', 'users.view']);
  });

  it('returns the permission catalogue', async () => {
    const s = await signupTenant(t);
    const catalog = (await as(t, s.accessToken).get('/api/v1/permissions')).body;
    expect(catalog[0]).toEqual({ group: 'tenant', keys: ['tenant.manage'] });
  });

  it('creates and edits custom roles, bumping the version', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const role = (await owner.post('/api/v1/roles', { name: 'Supervisor', dataScope: 'subordinates', permissions: ['users.view'] })).body;
    expect(role).toMatchObject({ name: 'Supervisor', systemKey: null, editable: true, permissions: ['users.view'], userCount: 0 });
    const perms = await owner.put(`/api/v1/roles/${role.id}/permissions`, { permissions: ['users.view', 'teams.view'] });
    expect(perms.body.permissions.sort()).toEqual(['teams.view', 'users.view']);
    const renamed = await owner.patch(`/api/v1/roles/${role.id}`, { name: 'Senior supervisor', dataScope: 'site_subtree' });
    expect(renamed.body).toMatchObject({ name: 'Senior supervisor', dataScope: 'site_subtree' });
  });

  it('protects the Owner role and system role names', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const ownerRole = await roleIdOf(s.tenantId, 'owner');
    expect((await owner.put(`/api/v1/roles/${ownerRole}/permissions`, { permissions: [] })).body.error.code).toBe('ROLE_NOT_EDITABLE');
    const managerRole = await roleIdOf(s.tenantId, 'manager');
    expect((await owner.patch(`/api/v1/roles/${managerRole}`, { name: 'Boss' })).body.error.code).toBe('ROLE_NOT_EDITABLE');
    expect((await owner.patch(`/api/v1/roles/${managerRole}`, { active: false })).body.error.code).toBe('ROLE_NOT_EDITABLE');
    expect((await owner.patch(`/api/v1/roles/${managerRole}`, { dataScope: 'subordinates' })).status).toBe(200);
  });

  it('refuses to deactivate a role in use', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const role = (await owner.post('/api/v1/roles', { name: 'Custom', dataScope: 'own' })).body;
    await createUserDirect(t, s.tenantId, { roleId: role.id });
    expect((await owner.patch(`/api/v1/roles/${role.id}`, { active: false })).body.error.code).toBe('ROLE_IN_USE');
  });

  it('blocks granting permissions the actor does not hold', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const roleAdmin = (await owner.post('/api/v1/roles', { name: 'Role admin', dataScope: 'all', permissions: ['roles.view', 'roles.manage'] })).body;
    const u = await createUserDirect(t, s.tenantId, { kind: 'staff', roleId: roleAdmin.id });
    const actor = as(t, (await loginStaff(t, u.email!, u.secret)).accessToken);
    const res = await actor.post('/api/v1/roles', { name: 'Sneaky', dataScope: 'all', permissions: ['audit.view'] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ROLE_ESCALATION');
  });

  it('permission changes take effect on the next request', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const m = await createUserDirect(t, s.tenantId, { kind: 'staff', roleKey: 'manager' });
    const manager = as(t, (await loginStaff(t, m.email!, m.secret)).accessToken);
    expect((await manager.get('/api/v1/sites')).status).toBe(200);
    await owner.put(`/api/v1/roles/${await roleIdOf(s.tenantId, 'manager')}/permissions`, { permissions: ['users.view'] });
    expect((await manager.get('/api/v1/sites')).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @taskop/api test roles`
Expected: FAIL — 404.

- [ ] **Step 3: Implement**

`apps/api/src/roles/dto.ts`:
```ts
import {
  createRoleInputSchema,
  permissionCatalogSchema,
  roleDtoSchema,
  setRolePermissionsInputSchema,
  updateRoleInputSchema,
} from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class CreateRoleDto extends createZodDto(createRoleInputSchema) {}
export class UpdateRoleDto extends createZodDto(updateRoleInputSchema) {}
export class SetRolePermissionsDto extends createZodDto(setRolePermissionsInputSchema) {}
export class RoleResponse extends createZodDto(roleDtoSchema) {}
export class PermissionCatalogResponse extends createZodDto(permissionCatalogSchema) {}
```

`apps/api/src/roles/roles.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { PERMISSION_GROUPS, type PermissionCatalog, type PermissionKey, type RoleDto } from '@taskop/contracts';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import type { Principal } from '../common/request';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { rolePermissions, roles, users } from '../db/schema';
import type { CreateRoleDto, SetRolePermissionsDto, UpdateRoleDto } from './dto';
import { loadRolePermissions } from './permission-resolver';

export function assertNoEscalation(p: Principal, permissions: readonly PermissionKey[]): void {
  if (permissions.some((k) => !p.permissions.has(k))) throw new AppError('ROLE_ESCALATION');
}

@Injectable()
export class RolesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  catalog(): PermissionCatalog {
    return PERMISSION_GROUPS.map((g) => ({ group: g.group, keys: [...g.keys] }));
  }

  async list(): Promise<RoleDto[]> {
    const rows = await this.db.tx().select().from(roles).orderBy(asc(roles.createdAt));
    return Promise.all(rows.map((r) => this.toDto(r)));
  }

  async create(p: Principal, input: CreateRoleDto): Promise<RoleDto> {
    const permissions = [...new Set(input.permissions)];
    assertNoEscalation(p, permissions);
    const tx = this.db.tx();
    const [row] = await tx.insert(roles).values({ tenantId: p.tenantId, name: input.name, dataScope: input.dataScope }).returning();
    if (permissions.length) {
      await tx.insert(rolePermissions).values(permissions.map((permissionKey) => ({ tenantId: p.tenantId, roleId: row!.id, permissionKey })));
    }
    const dto = await this.toDto(row!);
    await this.audit.record({ action: 'role.created', entityType: 'role', entityId: dto.id, after: dto });
    return dto;
  }

  async update(id: string, input: UpdateRoleDto): Promise<RoleDto> {
    const tx = this.db.tx();
    const existing = await this.find(id);
    if (!existing.editable) throw new AppError('ROLE_NOT_EDITABLE');
    if (existing.systemKey && ((input.name !== undefined && input.name !== existing.name) || input.active === false)) {
      throw new AppError('ROLE_NOT_EDITABLE');
    }
    if (input.active === false && existing.active && (await this.countUsers(id)) > 0) throw new AppError('ROLE_IN_USE');
    const before = await this.toDto(existing);
    const [row] = await tx
      .update(roles)
      .set({ name: input.name, dataScope: input.dataScope, active: input.active, version: sql`${roles.version} + 1`, updatedAt: new Date() })
      .where(eq(roles.id, id))
      .returning();
    const after = await this.toDto(row!);
    await this.audit.record({ action: 'role.updated', entityType: 'role', entityId: id, before, after });
    return after;
  }

  async setPermissions(p: Principal, id: string, input: SetRolePermissionsDto): Promise<RoleDto> {
    const tx = this.db.tx();
    const existing = await this.find(id);
    if (!existing.editable) throw new AppError('ROLE_NOT_EDITABLE');
    const permissions = [...new Set(input.permissions)];
    assertNoEscalation(p, permissions);
    const before = await loadRolePermissions(tx, existing);
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
    if (permissions.length) {
      await tx.insert(rolePermissions).values(permissions.map((permissionKey) => ({ tenantId: p.tenantId, roleId: id, permissionKey })));
    }
    const [row] = await tx
      .update(roles)
      .set({ version: sql`${roles.version} + 1`, updatedAt: new Date() })
      .where(eq(roles.id, id))
      .returning();
    await this.audit.record({
      action: 'role.permissions_changed',
      entityType: 'role',
      entityId: id,
      before: { permissions: before },
      after: { permissions },
    });
    return this.toDto(row!);
  }

  private async find(id: string) {
    const [row] = await this.db.tx().select().from(roles).where(eq(roles.id, id));
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  private async countUsers(roleId: string): Promise<number> {
    const [row] = await this.db
      .tx()
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.roleId, roleId), inArray(users.status, ['active', 'invited'])));
    return row?.n ?? 0;
  }

  private async toDto(r: typeof roles.$inferSelect): Promise<RoleDto> {
    return {
      id: r.id,
      name: r.name,
      systemKey: r.systemKey,
      dataScope: r.dataScope,
      editable: r.editable,
      active: r.active,
      permissions: await loadRolePermissions(this.db.tx(), r),
      userCount: await this.countUsers(r.id),
    };
  }
}
```

`apps/api/src/roles/roles.controller.ts`:
```ts
import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { PermissionCatalog, RoleDto } from '@taskop/contracts';
import { CurrentPrincipal, RequirePermission } from '../common/decorators';
import { ParseIdPipe } from '../common/parse-id.pipe';
import type { Principal } from '../common/request';
import { CreateRoleDto, PermissionCatalogResponse, RoleResponse, SetRolePermissionsDto, UpdateRoleDto } from './dto';
import { RolesService } from './roles.service';

@ApiTags('roles')
@ApiBearerAuth()
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  @RequirePermission('roles.view')
  @ApiOkResponse({ type: PermissionCatalogResponse })
  catalog(): PermissionCatalog {
    return this.roles.catalog();
  }

  @Get('roles')
  @RequirePermission('roles.view')
  @ApiOkResponse({ type: [RoleResponse] })
  list(): Promise<RoleDto[]> {
    return this.roles.list();
  }

  @Post('roles')
  @RequirePermission('roles.manage')
  create(@CurrentPrincipal() p: Principal, @Body() body: CreateRoleDto): Promise<RoleDto> {
    return this.roles.create(p, body);
  }

  @Patch('roles/:id')
  @RequirePermission('roles.manage')
  update(@Param('id', ParseIdPipe) id: string, @Body() body: UpdateRoleDto): Promise<RoleDto> {
    return this.roles.update(id, body);
  }

  @Put('roles/:id/permissions')
  @RequirePermission('roles.manage')
  setPermissions(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string, @Body() body: SetRolePermissionsDto): Promise<RoleDto> {
    return this.roles.setPermissions(p, id, body);
  }
}
```

`apps/api/src/roles/roles.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({ controllers: [RolesController], providers: [RolesService], exports: [RolesService] })
export class RolesModule {}
```
Add `RolesModule` to `AppModule` imports.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @taskop/api test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): add roles with permission catalogue, escalation guard and system-role protection"
```

---

### Task 17: Users — workers, staff invites, profile, status, credentials, assignments

**Files:**
- Create: `apps/api/src/users/dto.ts`, `src/users/user-mapper.ts`, `src/users/users.service.ts`, `src/users/users.controller.ts`, `src/users/users.module.ts`
- Modify: `apps/api/src/auth/credential.service.ts` (add `issuePasswordReset`), `apps/api/src/app.module.ts`
- Test: `apps/api/test/users.test.ts`

**Interfaces:**
- Consumes: `ScopeService`, `assertIdsExist`, `assertNoEscalation`, `loadRolePermissions`, `PasswordHasher`, `SessionService`, `CredentialService.issueInvite`, `generatePin`, `generatePassword`, `escapeLike`.
- Produces:
  - `selectUsers(tx)` (query builder joining role + manager, aggregating `siteIds`/`teamIds`), `toUserDto(row): UserDto`.
  - `CredentialService.issuePasswordReset(input: { tenantId; userId; email; fullName }): Promise<void>` (inside current tenant tx).
  - `class UsersService` with `list, get, createWorker, inviteStaff, update, deactivate, reactivate, resetCredential, setSites, setTeams` (all take `p: Principal` first).
  - Endpoints (scope applied to every read and to the target of every write):
    - `GET /users`, `GET /users/:id` (`users.view`)
    - `POST /users/workers` (201 `UserWithSecret`), `POST /users/invite` (201 `UserDto`), `PATCH /users/:id`, `POST /users/:id/deactivate`, `POST /users/:id/reactivate`, `POST /users/:id/reset-credential` (`UserWithSecret`), `PUT /users/:id/sites`, `PUT /users/:id/teams` (`users.manage`)
  - Rules: self → `SELF_MODIFICATION` for role change, deactivate, reset-credential; owner role assignment or changes to an owner user require an owner actor (`OWNER_ROLE_RESTRICTED`); granting a role with permissions the actor lacks → `ROLE_ESCALATION`; last active owner protected (`LAST_OWNER`); manager cycles → `MANAGER_CYCLE`; invites require the actor's verified email (`EMAIL_NOT_VERIFIED`); deactivation revokes all sessions.

- [ ] **Step 1: Write the failing test**

`apps/api/test/users.test.ts`:
```ts
import { ALL_PERMISSIONS } from '@taskop/contracts';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '../src/common/request';
import { DbService } from '../src/db/db.service';
import { UsersService } from '../src/users/users.service';
import { createTestApp, type TestApp } from './app';
import { as, createUserDirect, loginStaff, loginWorker, roleIdOf, signupTenant, siteTypeIdOf } from './fixtures';

describe('users', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  async function verified() {
    const s = await signupTenant(t);
    await t.http().post('/api/v1/auth/verify-email').send({ token: t.mailer.tokenFor(s.email) });
    return { s, owner: as(t, s.accessToken) };
  }

  it('creates a worker with a generated PIN that works for login', async () => {
    const { s, owner } = await verified();
    const res = await owner.post('/api/v1/users/workers', {
      fullName: 'Elvin Məmmədov',
      username: 'Elvin.M',
      roleId: await roleIdOf(s.tenantId, 'worker'),
      jobTitle: 'Təmizlikçi',
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ username: 'elvin.m', kind: 'worker', status: 'active', credentialKind: 'pin', role: { systemKey: 'worker' } });
    expect(res.body.generatedSecret).toMatch(/^\d{6}$/);
    await loginWorker(t, s.orgCode, 'elvin.m', res.body.generatedSecret);
  });

  it('validates usernames and provided PINs', async () => {
    const { s, owner } = await verified();
    const roleId = await roleIdOf(s.tenantId, 'worker');
    const weak = await owner.post('/api/v1/users/workers', { fullName: 'A B', username: 'ali', roleId, secret: '123456' });
    expect(weak.body.error.fields).toEqual({ secret: 'errors.validation.pinWeak' });
    const az = await owner.post('/api/v1/users/workers', { fullName: 'A B', username: 'əli', roleId });
    expect(az.body.error.fields).toEqual({ username: 'errors.validation.username' });
    await owner.post('/api/v1/users/workers', { fullName: 'A B', username: 'ali', roleId });
    const dup = await owner.post('/api/v1/users/workers', { fullName: 'C D', username: 'ALI', roleId });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ code: 'USERNAME_TAKEN', fields: { username: 'errors.USERNAME_TAKEN' } });
  });

  it('invites staff only after the actor verified their email, and the invite can be accepted', async () => {
    const s = await signupTenant(t);
    const managerRole = await roleIdOf(s.tenantId, 'manager');
    const body = { fullName: 'Leyla Quliyeva', email: `${uniqEmail()}`, roleId: managerRole };
    const blocked = await as(t, s.accessToken).post('/api/v1/users/invite', body);
    expect(blocked.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    await t.http().post('/api/v1/auth/verify-email').send({ token: t.mailer.tokenFor(s.email) });
    const invited = await as(t, s.accessToken).post('/api/v1/users/invite', body);
    expect(invited.status).toBe(201);
    expect(invited.body).toMatchObject({ status: 'invited', kind: 'staff' });
    const accept = await t.http().post('/api/v1/auth/invite/accept').send({ token: t.mailer.tokenFor(body.email), password: 'leyla password 1', client: 'web' });
    expect(accept.status).toBe(200);
    expect((await as(t, s.accessToken).post('/api/v1/users/invite', body)).body.error.code).toBe('EMAIL_TAKEN');
  });

  it('filters and paginates the list', async () => {
    const { s, owner } = await verified();
    const roleId = await roleIdOf(s.tenantId, 'worker');
    for (const name of ['Nərmin Əliyeva', 'Orxan Həsənov', 'Nigar Səfərli']) {
      await owner.post('/api/v1/users/workers', { fullName: name, username: name.split(' ')[0]!.toLowerCase().replace(/[^a-z]/g, 'x'), roleId });
    }
    const search = await owner.get('/api/v1/users?q=orxan');
    expect(search.body.items.map((u: { fullName: string }) => u.fullName)).toEqual(['Orxan Həsənov']);
    const byKind = await owner.get('/api/v1/users?kind=worker');
    expect(byKind.body.items).toHaveLength(3);
    const page1 = await owner.get('/api/v1/users?limit=2');
    expect(page1.body.items).toHaveLength(2);
    const page2 = await owner.get(`/api/v1/users?limit=2&cursor=${page1.body.nextCursor}`);
    expect(page2.body.items).toHaveLength(2);
    expect(page2.body.nextCursor).toBeNull();
    const wildcard = await owner.get('/api/v1/users?q=%25');
    expect(wildcard.body.items).toHaveLength(0);
  });

  it('applies the manager site scope to reads and writes', async () => {
    const { s, owner } = await verified();
    const typeId = await siteTypeIdOf(s.tenantId);
    const a = (await owner.post('/api/v1/sites', { parentId: null, typeId, name: 'A' })).body;
    const a1 = (await owner.post('/api/v1/sites', { parentId: a.id, typeId, name: 'A1' })).body;
    const b = (await owner.post('/api/v1/sites', { parentId: null, typeId, name: 'B' })).body;
    const scopedRole = (await owner.post('/api/v1/roles', { name: 'Site lead', dataScope: 'site_subtree', permissions: ['users.view', 'users.manage'] })).body;
    const roleId = await roleIdOf(s.tenantId, 'worker');
    const inA = (await owner.post('/api/v1/users/workers', { fullName: 'In A', username: 'in-a', roleId, siteIds: [a1.id] })).body.user;
    const inB = (await owner.post('/api/v1/users/workers', { fullName: 'In B', username: 'in-b', roleId, siteIds: [b.id] })).body.user;
    const lead = await createUserDirect(t, s.tenantId, { kind: 'staff', roleId: scopedRole.id });
    await owner.put(`/api/v1/users/${lead.id}/sites`, { siteIds: [a.id] });
    const leadApi = as(t, (await loginStaff(t, lead.email!, lead.secret)).accessToken);

    const ids = (await leadApi.get('/api/v1/users')).body.items.map((u: { id: string }) => u.id).sort();
    expect(ids).toEqual([inA.id, lead.id].sort());
    expect((await leadApi.get(`/api/v1/users/${inB.id}`)).status).toBe(404);
    expect((await leadApi.patch(`/api/v1/users/${inB.id}`, { fullName: 'Changed' })).status).toBe(404);
    expect((await leadApi.patch(`/api/v1/users/${inA.id}`, { fullName: 'Changed' })).status).toBe(200);
  });

  it('requires users.manage for writes', async () => {
    const { s } = await verified();
    const m = await createUserDirect(t, s.tenantId, { kind: 'staff', roleKey: 'manager' });
    const manager = as(t, (await loginStaff(t, m.email!, m.secret)).accessToken);
    const res = await manager.post('/api/v1/users/workers', { fullName: 'X Y', username: 'xy', roleId: await roleIdOf(s.tenantId, 'worker') });
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('prevents manager cycles', async () => {
    const { s, owner } = await verified();
    const roleId = await roleIdOf(s.tenantId, 'worker');
    const a = (await owner.post('/api/v1/users/workers', { fullName: 'A A', username: 'aa', roleId })).body.user;
    const b = (await owner.post('/api/v1/users/workers', { fullName: 'B B', username: 'bb', roleId, managerId: a.id })).body.user;
    expect(b.managerName).toBe('A A');
    expect((await owner.patch(`/api/v1/users/${a.id}`, { managerId: b.id })).body.error.code).toBe('MANAGER_CYCLE');
    expect((await owner.patch(`/api/v1/users/${a.id}`, { managerId: a.id })).body.error.code).toBe('MANAGER_CYCLE');
    expect((await owner.patch(`/api/v1/users/${b.id}`, { managerId: null })).body.managerId).toBeNull();
  });

  it('refuses self-destructive and privilege-escalating changes', async () => {
    const { s, owner } = await verified();
    expect((await owner.post(`/api/v1/users/${s.ownerId}/deactivate`)).body.error.code).toBe('SELF_MODIFICATION');
    expect((await owner.patch(`/api/v1/users/${s.ownerId}`, { roleId: await roleIdOf(s.tenantId, 'admin') })).body.error.code).toBe(
      'SELF_MODIFICATION',
    );

    const admin = await createUserDirect(t, s.tenantId, { kind: 'staff', roleKey: 'admin', emailVerified: true });
    const adminApi = as(t, (await loginStaff(t, admin.email!, admin.secret)).accessToken);
    const w = await createUserDirect(t, s.tenantId);
    expect((await adminApi.patch(`/api/v1/users/${w.id}`, { roleId: await roleIdOf(s.tenantId, 'owner') })).body.error.code).toBe(
      'OWNER_ROLE_RESTRICTED',
    );
    expect((await adminApi.post(`/api/v1/users/${s.ownerId}/deactivate`)).body.error.code).toBe('OWNER_ROLE_RESTRICTED');

    const limited = (await owner.post('/api/v1/roles', { name: 'HR', dataScope: 'all', permissions: ['users.view', 'users.manage'] })).body;
    const hr = await createUserDirect(t, s.tenantId, { kind: 'staff', roleId: limited.id });
    const hrApi = as(t, (await loginStaff(t, hr.email!, hr.secret)).accessToken);
    expect((await hrApi.patch(`/api/v1/users/${w.id}`, { roleId: await roleIdOf(s.tenantId, 'admin') })).body.error.code).toBe(
      'ROLE_ESCALATION',
    );
  });

  it('keeps at least one active owner (service-level guard)', async () => {
    const { s } = await verified();
    const synthetic: Principal = {
      userId: uuidv7(),
      tenantId: s.tenantId,
      roleId: await roleIdOf(s.tenantId, 'owner'),
      roleVersion: 1,
      systemRoleKey: 'owner',
      sessionId: uuidv7(),
      kind: 'staff',
      dataScope: 'all',
      permissions: new Set(ALL_PERMISSIONS),
      emailVerified: true,
    };
    await expect(
      t.app.get(DbService).withTenant(s.tenantId, synthetic.userId, () => t.app.get(UsersService).deactivate(synthetic, s.ownerId)),
    ).rejects.toMatchObject({ code: 'LAST_OWNER' });
  });

  it('deactivation revokes access immediately and reactivation restores it', async () => {
    const { s, owner } = await verified();
    const w = await createUserDirect(t, s.tenantId);
    const login = await loginWorker(t, s.orgCode, w.username!, w.secret);
    expect((await owner.post(`/api/v1/users/${w.id}/deactivate`)).body.status).toBe('deactivated');
    expect((await as(t, login.accessToken).get('/api/v1/me')).status).toBe(401);
    expect((await t.http().post('/api/v1/auth/refresh').send({ refreshToken: login.refreshToken })).status).toBe(401);
    expect((await owner.post(`/api/v1/users/${w.id}/reactivate`)).body.status).toBe('active');
    await loginWorker(t, s.orgCode, w.username!, w.secret);
  });

  it('resets worker PINs and mails staff a reset link', async () => {
    const { s, owner } = await verified();
    const w = await createUserDirect(t, s.tenantId);
    const reset = await owner.post(`/api/v1/users/${w.id}/reset-credential`);
    expect(reset.body.generatedSecret).toMatch(/^\d{6}$/);
    expect((await t.http().post('/api/v1/auth/login/worker').send({ orgCode: s.orgCode, username: w.username, secret: w.secret, client: 'mobile' })).status).toBe(401);
    await loginWorker(t, s.orgCode, w.username!, reset.body.generatedSecret);

    const chosen = await owner.post(`/api/v1/users/${w.id}/reset-credential`, { credentialKind: 'password', secret: 'worker password 1' });
    expect(chosen.body.generatedSecret).toBeNull();
    expect(chosen.body.user.credentialKind).toBe('password');

    const staff = await createUserDirect(t, s.tenantId, { kind: 'staff', roleKey: 'manager' });
    const staffReset = await owner.post(`/api/v1/users/${staff.id}/reset-credential`);
    expect(staffReset.body.generatedSecret).toBeNull();
    expect(t.mailer.lastTo(staff.email!)?.subject).toContain('şifrənin bərpası');
  });

  it('assigns sites and teams, rejecting foreign ids', async () => {
    const { s, owner } = await verified();
    const other = await signupTenant(t);
    const typeId = await siteTypeIdOf(s.tenantId);
    const site = (await owner.post('/api/v1/sites', { parentId: null, typeId, name: 'S' })).body;
    const team = (await owner.post('/api/v1/teams', { name: 'T' })).body;
    const w = await createUserDirect(t, s.tenantId);
    expect((await owner.put(`/api/v1/users/${w.id}/sites`, { siteIds: [site.id] })).body.siteIds).toEqual([site.id]);
    expect((await owner.put(`/api/v1/users/${w.id}/teams`, { teamIds: [team.id] })).body.teamIds).toEqual([team.id]);
    const foreignSite = (await as(t, other.accessToken).post('/api/v1/sites', { parentId: null, typeId: await siteTypeIdOf(other.tenantId), name: 'F' })).body;
    expect((await owner.put(`/api/v1/users/${w.id}/sites`, { siteIds: [foreignSite.id] })).status).toBe(422);
  });
});

function uniqEmail() {
  return `${uuidv7().slice(-12)}@example.az`;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @taskop/api test users`
Expected: FAIL — 404 on `/api/v1/users/workers`.

- [ ] **Step 3: Add `issuePasswordReset` to `CredentialService`**

Add to `apps/api/src/auth/credential.service.ts`:
```ts
  /** Admin-triggered staff reset: mails a reset link. Runs inside the current tenant transaction. */
  async issuePasswordReset(input: { tenantId: string; userId: string; email: string; fullName: string }): Promise<void> {
    const token = await this.oneTime.create({ tenantId: input.tenantId, userId: input.userId, purpose: 'password_reset' });
    await this.auth.sendMail(passwordResetMail({ to: input.email, fullName: input.fullName, webUrl: this.config.WEB_URL, token }));
  }
```

- [ ] **Step 4: Implement DTOs and the mapper**

`apps/api/src/users/dto.ts`:
```ts
import {
  createWorkerInputSchema,
  inviteStaffInputSchema,
  pageOf,
  resetCredentialInputSchema,
  setUserSitesInputSchema,
  setUserTeamsInputSchema,
  updateUserInputSchema,
  userDtoSchema,
  userListQuerySchema,
  userWithSecretSchema,
} from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class UserListQueryDto extends createZodDto(userListQuerySchema) {}
export class CreateWorkerDto extends createZodDto(createWorkerInputSchema) {}
export class InviteStaffDto extends createZodDto(inviteStaffInputSchema) {}
export class UpdateUserDto extends createZodDto(updateUserInputSchema) {}
export class SetUserSitesDto extends createZodDto(setUserSitesInputSchema) {}
export class SetUserTeamsDto extends createZodDto(setUserTeamsInputSchema) {}
export class ResetCredentialDto extends createZodDto(resetCredentialInputSchema) {}
export class UserResponse extends createZodDto(userDtoSchema) {}
export class UserPageResponse extends createZodDto(pageOf(userDtoSchema)) {}
export class UserWithSecretResponse extends createZodDto(userWithSecretSchema) {}
```

`apps/api/src/users/user-mapper.ts`:
```ts
import type { SystemRoleKey, UserDto } from '@taskop/contracts';
import { eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Executor } from '../db/db.service';
import { roles, users } from '../db/schema';

const manager = alias(users, 'manager');

export function selectUsers(tx: Executor) {
  return tx
    .select({
      user: users,
      roleName: roles.name,
      roleSystemKey: roles.systemKey,
      managerName: manager.fullName,
      siteIds: sql<string[]>`coalesce((select array_agg(us.site_id::text order by us.site_id) from user_sites us where us.user_id = ${users.id}), '{}')`,
      teamIds: sql<string[]>`coalesce((select array_agg(ut.team_id::text order by ut.team_id) from user_teams ut where ut.user_id = ${users.id}), '{}')`,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .leftJoin(manager, eq(manager.id, users.managerId))
    .$dynamic();
}

export interface UserRow {
  user: typeof users.$inferSelect;
  roleName: string;
  roleSystemKey: SystemRoleKey | null;
  managerName: string | null;
  siteIds: string[];
  teamIds: string[];
}

export function toUserDto(r: UserRow): UserDto {
  const u = r.user;
  return {
    id: u.id,
    fullName: u.fullName,
    jobTitle: u.jobTitle,
    kind: u.kind,
    email: u.email,
    username: u.username,
    phone: u.phone,
    status: u.status,
    credentialKind: u.credentialKind,
    role: { id: u.roleId, name: r.roleName, systemKey: r.roleSystemKey },
    managerId: u.managerId,
    managerName: r.managerName,
    siteIds: r.siteIds,
    teamIds: r.teamIds,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}
```

- [ ] **Step 5: Implement `UsersService`**

`apps/api/src/users/users.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { type Page, secretSchemaFor, type UserDto, type UserWithSecret } from '@taskop/contracts';
import { and, asc, eq, gt, ilike, or, type SQL, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { CredentialService } from '../auth/credential.service';
import { PasswordHasher } from '../auth/crypto/password-hasher';
import { generatePassword, generatePin } from '../auth/crypto/secret-generator';
import { SessionService } from '../auth/session.service';
import { AppError } from '../common/app-error';
import { assertIdsExist } from '../common/ids-exist';
import type { Principal } from '../common/request';
import { ScopeService } from '../common/scope.service';
import { escapeLike } from '../common/sql';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { roles, sites, teams, users, userSites, userTeams } from '../db/schema';
import { loadRolePermissions } from '../roles/permission-resolver';
import { assertNoEscalation } from '../roles/roles.service';
import type { CreateWorkerDto, InviteStaffDto, ResetCredentialDto, UpdateUserDto, UserListQueryDto } from './dto';
import { selectUsers, toUserDto } from './user-mapper';

@Injectable()
export class UsersService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionService,
    private readonly credentials: CredentialService,
  ) {}

  async list(p: Principal, q: UserListQueryDto): Promise<Page<UserDto>> {
    const conditions: (SQL | undefined)[] = [this.scope.usersFilter(p)];
    if (q.status) conditions.push(eq(users.status, q.status));
    if (q.kind) conditions.push(eq(users.kind, q.kind));
    if (q.roleId) conditions.push(eq(users.roleId, q.roleId));
    if (q.teamId) conditions.push(sql`exists (select 1 from user_teams ut where ut.user_id = ${users.id} and ut.team_id = ${q.teamId})`);
    if (q.siteId) conditions.push(sql`exists (select 1 from user_sites us where us.user_id = ${users.id} and us.site_id = ${q.siteId})`);
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      conditions.push(or(ilike(users.fullName, like), ilike(users.username, like), ilike(users.email, like)));
    }
    if (q.cursor) conditions.push(gt(users.id, q.cursor));
    const rows = await selectUsers(this.db.tx())
      .where(and(...conditions))
      .orderBy(asc(users.id))
      .limit(q.limit + 1);
    const items = rows.slice(0, q.limit).map(toUserDto);
    return { items, nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null };
  }

  async get(p: Principal, id: string): Promise<UserDto> {
    const [row] = await selectUsers(this.db.tx()).where(and(eq(users.id, id), this.scope.usersFilter(p)));
    if (!row) throw new AppError('NOT_FOUND');
    return toUserDto(row);
  }

  async createWorker(p: Principal, input: CreateWorkerDto): Promise<UserWithSecret> {
    await this.assertAssignableRole(p, input.roleId, null);
    await this.assertProfileRefs(null, input.managerId ?? null, input.siteIds, input.teamIds);
    const generatedSecret = input.secret ? null : input.credentialKind === 'pin' ? generatePin() : generatePassword();
    const secret = input.secret ?? generatedSecret!;
    const id = uuidv7();
    await this.db
      .tx()
      .insert(users)
      .values({
        id,
        tenantId: p.tenantId,
        fullName: input.fullName,
        jobTitle: input.jobTitle ?? null,
        phone: input.phone ?? null,
        roleId: input.roleId,
        managerId: input.managerId ?? null,
        kind: 'worker',
        username: input.username,
        credentialHash: await this.hasher.hash(secret),
        credentialKind: input.credentialKind,
        status: 'active',
      });
    await this.replaceSites(p.tenantId, id, input.siteIds);
    await this.replaceTeams(p.tenantId, id, input.teamIds);
    const user = await this.load(id);
    await this.audit.record({ action: 'user.created', entityType: 'user', entityId: id, after: user });
    return { user, generatedSecret };
  }

  async inviteStaff(p: Principal, input: InviteStaffDto): Promise<UserDto> {
    if (!p.emailVerified) throw new AppError('EMAIL_NOT_VERIFIED');
    await this.assertAssignableRole(p, input.roleId, null);
    await this.assertProfileRefs(null, input.managerId ?? null, input.siteIds, input.teamIds);
    const id = uuidv7();
    await this.db
      .tx()
      .insert(users)
      .values({
        id,
        tenantId: p.tenantId,
        fullName: input.fullName,
        jobTitle: input.jobTitle ?? null,
        phone: input.phone ?? null,
        roleId: input.roleId,
        managerId: input.managerId ?? null,
        kind: 'staff',
        email: input.email,
        status: 'invited',
      });
    await this.replaceSites(p.tenantId, id, input.siteIds);
    await this.replaceTeams(p.tenantId, id, input.teamIds);
    await this.credentials.issueInvite({ tenantId: p.tenantId, userId: id, email: input.email, fullName: input.fullName });
    const user = await this.load(id);
    await this.audit.record({ action: 'user.invited', entityType: 'user', entityId: id, after: user });
    return user;
  }

  async update(p: Principal, id: string, input: UpdateUserDto): Promise<UserDto> {
    const before = await this.get(p, id);
    if (input.roleId && input.roleId !== before.role.id) {
      if (id === p.userId) throw new AppError('SELF_MODIFICATION');
      await this.assertAssignableRole(p, input.roleId, before);
      if (before.role.systemKey === 'owner') await this.assertNotLastOwner(id);
    }
    if (input.managerId) await this.assertProfileRefs(id, input.managerId, [], []);
    if (input.username !== undefined && before.kind !== 'worker') {
      throw new AppError('VALIDATION_FAILED', { fields: { username: 'errors.validation.invalid' } });
    }
    await this.db
      .tx()
      .update(users)
      .set({
        fullName: input.fullName,
        jobTitle: input.jobTitle,
        phone: input.phone,
        roleId: input.roleId,
        managerId: input.managerId,
        username: input.username,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));
    const after = await this.load(id);
    await this.audit.record({ action: 'user.updated', entityType: 'user', entityId: id, before, after });
    return after;
  }

  async deactivate(p: Principal, id: string): Promise<UserDto> {
    if (id === p.userId) throw new AppError('SELF_MODIFICATION');
    const before = await this.get(p, id);
    if (before.role.systemKey === 'owner') {
      if (p.systemRoleKey !== 'owner') throw new AppError('OWNER_ROLE_RESTRICTED');
      await this.assertNotLastOwner(id);
    }
    if (before.status === 'deactivated') return before;
    await this.db.tx().update(users).set({ status: 'deactivated', updatedAt: new Date() }).where(eq(users.id, id));
    await this.sessions.revokeAllForUser(id);
    const after = await this.load(id);
    await this.audit.record({ action: 'user.deactivated', entityType: 'user', entityId: id, before, after });
    return after;
  }

  async reactivate(p: Principal, id: string): Promise<UserDto> {
    const before = await this.get(p, id);
    if (before.role.systemKey === 'owner' && p.systemRoleKey !== 'owner') throw new AppError('OWNER_ROLE_RESTRICTED');
    if (before.status !== 'deactivated') return before;
    const status = before.credentialKind === null ? 'invited' : 'active';
    await this.db
      .tx()
      .update(users)
      .set({ status, failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(users.id, id));
    const after = await this.load(id);
    await this.audit.record({ action: 'user.reactivated', entityType: 'user', entityId: id, before, after });
    return after;
  }

  async resetCredential(p: Principal, id: string, input: ResetCredentialDto): Promise<UserWithSecret> {
    if (id === p.userId) throw new AppError('SELF_MODIFICATION');
    const before = await this.get(p, id);
    if (before.role.systemKey === 'owner' && p.systemRoleKey !== 'owner') throw new AppError('OWNER_ROLE_RESTRICTED');
    if (before.kind === 'staff') {
      await this.credentials.issuePasswordReset({ tenantId: p.tenantId, userId: id, email: before.email!, fullName: before.fullName });
      await this.audit.record({ action: 'user.password_reset_requested', entityType: 'user', entityId: id });
      return { user: before, generatedSecret: null };
    }
    const kind = input.credentialKind ?? before.credentialKind ?? 'pin';
    if (input.secret) {
      const check = secretSchemaFor(kind).safeParse(input.secret);
      if (!check.success) {
        throw new AppError('VALIDATION_FAILED', { fields: { secret: check.error.issues[0]?.message ?? 'errors.validation.invalid' } });
      }
    }
    const generatedSecret = input.secret ? null : kind === 'pin' ? generatePin() : generatePassword();
    const secret = input.secret ?? generatedSecret!;
    await this.db
      .tx()
      .update(users)
      .set({
        credentialHash: await this.hasher.hash(secret),
        credentialKind: kind,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));
    await this.sessions.revokeAllForUser(id);
    await this.audit.record({ action: 'user.credential_reset', entityType: 'user', entityId: id, after: { credentialKind: kind } });
    return { user: await this.load(id), generatedSecret };
  }

  async setSites(p: Principal, id: string, siteIds: string[]): Promise<UserDto> {
    const before = await this.get(p, id);
    await assertIdsExist(this.db.tx(), sites, sites.id, siteIds);
    await this.replaceSites(p.tenantId, id, siteIds);
    const after = await this.load(id);
    await this.audit.record({ action: 'user.sites_changed', entityType: 'user', entityId: id, before: { siteIds: before.siteIds }, after: { siteIds: after.siteIds } });
    return after;
  }

  async setTeams(p: Principal, id: string, teamIds: string[]): Promise<UserDto> {
    const before = await this.get(p, id);
    await assertIdsExist(this.db.tx(), teams, teams.id, teamIds);
    await this.replaceTeams(p.tenantId, id, teamIds);
    const after = await this.load(id);
    await this.audit.record({ action: 'user.teams_changed', entityType: 'user', entityId: id, before: { teamIds: before.teamIds }, after: { teamIds: after.teamIds } });
    return after;
  }

  /** Unscoped load, used after writes the actor was already authorised for. */
  private async load(id: string): Promise<UserDto> {
    const [row] = await selectUsers(this.db.tx()).where(eq(users.id, id));
    if (!row) throw new AppError('NOT_FOUND');
    return toUserDto(row);
  }

  private async assertAssignableRole(p: Principal, roleId: string, target: UserDto | null): Promise<void> {
    const tx = this.db.tx();
    const [role] = await tx.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.active, true)));
    if (!role) throw new AppError('REFERENCE_NOT_FOUND');
    if ((role.systemKey === 'owner' || target?.role.systemKey === 'owner') && p.systemRoleKey !== 'owner') {
      throw new AppError('OWNER_ROLE_RESTRICTED');
    }
    assertNoEscalation(p, await loadRolePermissions(tx, role));
  }

  private async assertProfileRefs(userId: string | null, managerId: string | null, siteIds: string[], teamIds: string[]): Promise<void> {
    const tx = this.db.tx();
    if (managerId) {
      if (managerId === userId) throw new AppError('MANAGER_CYCLE');
      await assertIdsExist(tx, users, users.id, [managerId]);
      if (userId) {
        const result = await tx.execute(sql`
          with recursive up as (
            select id, manager_id from users where id = ${managerId}
            union
            select u.id, u.manager_id from users u join up on u.id = up.manager_id
          ) select 1 from up where id = ${userId} limit 1`);
        if (result.rows.length > 0) throw new AppError('MANAGER_CYCLE');
      }
    }
    await assertIdsExist(tx, sites, sites.id, siteIds);
    await assertIdsExist(tx, teams, teams.id, teamIds);
  }

  private async assertNotLastOwner(excludingUserId: string): Promise<void> {
    const owners = await this.db
      .tx()
      .select({ id: users.id })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(roles.systemKey, 'owner'), eq(users.status, 'active')))
      .for('update', { of: users });
    if (!owners.some((o) => o.id !== excludingUserId)) throw new AppError('LAST_OWNER');
  }

  private async replaceSites(tenantId: string, userId: string, siteIds: string[]): Promise<void> {
    const tx = this.db.tx();
    await tx.delete(userSites).where(eq(userSites.userId, userId));
    const unique = [...new Set(siteIds)];
    if (unique.length) await tx.insert(userSites).values(unique.map((siteId) => ({ tenantId, userId, siteId })));
  }

  private async replaceTeams(tenantId: string, userId: string, teamIds: string[]): Promise<void> {
    const tx = this.db.tx();
    await tx.delete(userTeams).where(eq(userTeams.userId, userId));
    const unique = [...new Set(teamIds)];
    if (unique.length) await tx.insert(userTeams).values(unique.map((teamId) => ({ tenantId, userId, teamId })));
  }
}
```

- [ ] **Step 6: Implement controller and module**

`apps/api/src/users/users.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Page, UserDto, UserWithSecret } from '@taskop/contracts';
import { CurrentPrincipal, RequirePermission } from '../common/decorators';
import { ParseIdPipe } from '../common/parse-id.pipe';
import type { Principal } from '../common/request';
import {
  CreateWorkerDto,
  InviteStaffDto,
  ResetCredentialDto,
  SetUserSitesDto,
  SetUserTeamsDto,
  UpdateUserDto,
  UserListQueryDto,
  UserPageResponse,
  UserResponse,
  UserWithSecretResponse,
} from './dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('users.view')
  @ApiOkResponse({ type: UserPageResponse })
  list(@CurrentPrincipal() p: Principal, @Query() q: UserListQueryDto): Promise<Page<UserDto>> {
    return this.users.list(p, q);
  }

  @Get(':id')
  @RequirePermission('users.view')
  @ApiOkResponse({ type: UserResponse })
  get(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string): Promise<UserDto> {
    return this.users.get(p, id);
  }

  @Post('workers')
  @RequirePermission('users.manage')
  @ApiCreatedResponse({ type: UserWithSecretResponse })
  createWorker(@CurrentPrincipal() p: Principal, @Body() body: CreateWorkerDto): Promise<UserWithSecret> {
    return this.users.createWorker(p, body);
  }

  @Post('invite')
  @RequirePermission('users.manage')
  @ApiCreatedResponse({ type: UserResponse })
  invite(@CurrentPrincipal() p: Principal, @Body() body: InviteStaffDto): Promise<UserDto> {
    return this.users.inviteStaff(p, body);
  }

  @Patch(':id')
  @RequirePermission('users.manage')
  update(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string, @Body() body: UpdateUserDto): Promise<UserDto> {
    return this.users.update(p, id, body);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermission('users.manage')
  deactivate(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string): Promise<UserDto> {
    return this.users.deactivate(p, id);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @RequirePermission('users.manage')
  reactivate(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string): Promise<UserDto> {
    return this.users.reactivate(p, id);
  }

  @Post(':id/reset-credential')
  @HttpCode(200)
  @RequirePermission('users.manage')
  @ApiOkResponse({ type: UserWithSecretResponse })
  resetCredential(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string, @Body() body: ResetCredentialDto): Promise<UserWithSecret> {
    return this.users.resetCredential(p, id, body);
  }

  @Put(':id/sites')
  @RequirePermission('users.manage')
  setSites(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string, @Body() body: SetUserSitesDto): Promise<UserDto> {
    return this.users.setSites(p, id, body.siteIds);
  }

  @Put(':id/teams')
  @RequirePermission('users.manage')
  setTeams(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string, @Body() body: SetUserTeamsDto): Promise<UserDto> {
    return this.users.setTeams(p, id, body.teamIds);
  }
}
```

`apps/api/src/users/users.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({ imports: [AuthModule], controllers: [UsersController], providers: [UsersService], exports: [UsersService] })
export class UsersModule {}
```
Add `UsersModule` to `AppModule` imports.

Note: `POST /users/:id/reset-credential` with an empty body must still validate: supertest's `.send({})` from the `as()` helper always sends `{}`, and `resetCredentialInputSchema` accepts it.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @taskop/api test`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(api): add users module with worker creation, staff invites, scoped management and safeguards"
```

---

### Task 18: Audit log read API

**Files:**
- Create: `apps/api/src/audit-log/dto.ts`, `src/audit-log/audit-log.service.ts`, `src/audit-log/audit-log.controller.ts`, `src/audit-log/audit-log.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/audit-log.test.ts`

**Interfaces:**
- Produces: `GET /api/v1/audit-log` (`audit.view`) → `Page<AuditEntryDto>`, newest first (cursor = last id, `id < cursor`). Filters: `actorUserId`, `action`, `entityType`, `entityId`, `from`, `to`. Actor `type`: `platform_admin` if `actor_platform_admin_id` set, `user` if `actor_user_id` set, else `system`; `name` is the user's full name (null for platform/system; the web app labels platform actors "Taskop dəstəyi").

- [ ] **Step 1: Write the failing test**

`apps/api/test/audit-log.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { as, createUserDirect, loginStaff, loginWorker, signupTenant } from './fixtures';

describe('GET /audit-log', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('lists entries newest first with actor names and filters', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    await owner.post('/api/v1/teams', { name: 'Audit me' });
    const all = (await owner.get('/api/v1/audit-log')).body;
    expect(all.items[0]).toMatchObject({ action: 'team.created', actor: { type: 'user', id: s.ownerId, name: 'Elvin Əhmədov' } });
    expect(all.items[0].after).toMatchObject({ name: 'Audit me' });

    const filtered = (await owner.get('/api/v1/audit-log?action=tenant.created')).body;
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0].actor.type).toBe('user');

    const page = (await owner.get('/api/v1/audit-log?limit=1')).body;
    const next = (await owner.get(`/api/v1/audit-log?limit=1&cursor=${page.nextCursor}`)).body;
    expect(next.items[0].id < page.items[0].id).toBe(true);

    const future = (await owner.get(`/api/v1/audit-log?from=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`)).body;
    expect(future.items).toHaveLength(0);
  });

  it('allows auditors and blocks workers', async () => {
    const s = await signupTenant(t);
    const a = await createUserDirect(t, s.tenantId, { kind: 'staff', roleKey: 'auditor' });
    expect((await as(t, (await loginStaff(t, a.email!, a.secret)).accessToken).get('/api/v1/audit-log')).status).toBe(200);
    const w = await createUserDirect(t, s.tenantId);
    expect((await as(t, (await loginWorker(t, s.orgCode, w.username!, w.secret)).accessToken).get('/api/v1/audit-log')).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @taskop/api test audit-log`
Expected: FAIL — 404.

- [ ] **Step 3: Implement**

`apps/api/src/audit-log/dto.ts`:
```ts
import { auditEntryDtoSchema, auditListQuerySchema, pageOf } from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class AuditListQueryDto extends createZodDto(auditListQuerySchema) {}
export class AuditPageResponse extends createZodDto(pageOf(auditEntryDtoSchema)) {}
```

`apps/api/src/audit-log/audit-log.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import type { AuditEntryDto, Page } from '@taskop/contracts';
import { and, desc, eq, gte, lt, lte, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DbService } from '../db/db.service';
import { auditLog, users } from '../db/schema';
import type { AuditListQueryDto } from './dto';

const actor = alias(users, 'actor');

@Injectable()
export class AuditLogService {
  constructor(private readonly db: DbService) {}

  async list(q: AuditListQueryDto): Promise<Page<AuditEntryDto>> {
    const conditions: (SQL | undefined)[] = [];
    if (q.actorUserId) conditions.push(eq(auditLog.actorUserId, q.actorUserId));
    if (q.action) conditions.push(eq(auditLog.action, q.action));
    if (q.entityType) conditions.push(eq(auditLog.entityType, q.entityType));
    if (q.entityId) conditions.push(eq(auditLog.entityId, q.entityId));
    if (q.from) conditions.push(gte(auditLog.occurredAt, new Date(q.from)));
    if (q.to) conditions.push(lte(auditLog.occurredAt, new Date(q.to)));
    if (q.cursor) conditions.push(lt(auditLog.id, q.cursor));
    const rows = await this.db
      .tx()
      .select({ entry: auditLog, actorName: actor.fullName })
      .from(auditLog)
      .leftJoin(actor, eq(actor.id, auditLog.actorUserId))
      .where(and(...conditions))
      .orderBy(desc(auditLog.id))
      .limit(q.limit + 1);
    const items = rows.slice(0, q.limit).map(({ entry, actorName }): AuditEntryDto => ({
      id: entry.id,
      actor: entry.actorPlatformAdminId
        ? { type: 'platform_admin', id: entry.actorPlatformAdminId, name: null }
        : entry.actorUserId
          ? { type: 'user', id: entry.actorUserId, name: actorName }
          : { type: 'system', id: null, name: null },
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: entry.ip,
      occurredAt: entry.occurredAt.toISOString(),
    }));
    return { items, nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null };
  }
}
```

`apps/api/src/audit-log/audit-log.controller.ts`:
```ts
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuditEntryDto, Page } from '@taskop/contracts';
import { RequirePermission } from '../common/decorators';
import { AuditLogService } from './audit-log.service';
import { AuditListQueryDto, AuditPageResponse } from './dto';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-log')
export class AuditLogController {
  constructor(private readonly auditLog: AuditLogService) {}

  @Get()
  @RequirePermission('audit.view')
  @ApiOkResponse({ type: AuditPageResponse })
  list(@Query() q: AuditListQueryDto): Promise<Page<AuditEntryDto>> {
    return this.auditLog.list(q);
  }
}
```

`apps/api/src/audit-log/audit-log.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';

@Module({ controllers: [AuditLogController], providers: [AuditLogService] })
export class AuditLogModule {}
```
Add `AuditLogModule` to `AppModule` imports.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @taskop/api test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): add audit log read endpoint with filters and actor names"
```

---

### Task 19: Platform admin — login, tenant list, suspend/reactivate

**Files:**
- Create: `apps/api/src/platform/dto.ts`, `src/platform/platform.guard.ts`, `src/platform/platform.service.ts`, `src/platform/platform.controller.ts`, `src/platform/platform.module.ts`, `apps/api/src/scripts/create-platform-admin.ts`
- Modify: `apps/api/src/common/request.ts` (add `platformAdminId?: string`), `apps/api/src/app.module.ts`
- Test: `apps/api/test/platform.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/v1/platform/auth/login` (public, rate-limited) → `PlatformLoginResult` (8-hour token, audience `taskop-platform`, no refresh).
  - `PlatformGuard` (verifies platform token + active admin; sets `req.platformAdminId`). Routes are `@Public()` for the app `AuthGuard`, so app tokens are never accepted there and platform tokens are rejected by app routes.
  - `GET /api/v1/platform/tenants?q=&cursor=&limit=` → `Page<PlatformTenantDto>`; `POST /api/v1/platform/tenants/:id/suspend` and `/reactivate` → `PlatformTenantDto`. Suspension revokes all tenant sessions and writes an audit entry with `actor_platform_admin_id`.
  - Script `pnpm --filter @taskop/api platform:create-admin` (env `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_NAME`, `PLATFORM_ADMIN_PASSWORD`; upsert).

- [ ] **Step 1: Write the failing test**

`apps/api/test/platform.test.ts`:
```ts
import { hash } from '@node-rs/argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { as, signupTenant, uniq } from './fixtures';
import { ownerQuery } from './owner-db';

describe('platform admin', () => {
  let t: TestApp;
  let token: string;
  const email = `${uniq('admin')}@taskop.az`;

  beforeAll(async () => {
    t = await createTestApp();
    await ownerQuery("insert into platform_admins (id, email, credential_hash, full_name) values (gen_random_uuid(), $1, $2, 'Support')", [
      email,
      await hash('platform password 1', { memoryCost: 1024, timeCost: 1, parallelism: 1 }),
    ]);
    const res = await t.http().post('/api/v1/platform/auth/login').send({ email, password: 'platform password 1' });
    expect(res.status).toBe(200);
    token = res.body.accessToken;
  });
  afterAll(() => t.close());

  it('rejects wrong credentials', async () => {
    const res = await t.http().post('/api/v1/platform/auth/login').send({ email, password: 'wrong' });
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('keeps platform and tenant tokens apart', async () => {
    const s = await signupTenant(t);
    expect((await as(t, s.accessToken).get('/api/v1/platform/tenants')).status).toBe(401);
    expect((await as(t, token).get('/api/v1/me')).status).toBe(401);
  });

  it('lists tenants with user counts and search', async () => {
    const s = await signupTenant(t);
    const res = await as(t, token).get(`/api/v1/platform/tenants?q=${s.orgCode}`);
    expect(res.body.items).toEqual([expect.objectContaining({ id: s.tenantId, orgCode: s.orgCode, status: 'active', userCount: 1 })]);
  });

  it('suspends and reactivates a tenant', async () => {
    const s = await signupTenant(t);
    const suspended = await as(t, token).post(`/api/v1/platform/tenants/${s.tenantId}/suspend`);
    expect(suspended.body.status).toBe('suspended');
    expect((await as(t, s.accessToken).get('/api/v1/me')).body.error.code).toBe('TENANT_SUSPENDED');
    const audit = await ownerQuery("select actor_platform_admin_id from audit_log where tenant_id = $1 and action = 'tenant.suspended'", [s.tenantId]);
    expect(audit.rows[0]?.actor_platform_admin_id).toBeTruthy();
    await as(t, token).post(`/api/v1/platform/tenants/${s.tenantId}/reactivate`);
    const login = await t.http().post('/api/v1/auth/login/staff').send({ email: s.email, password: s.password, client: 'web' });
    expect(login.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @taskop/api test platform`
Expected: FAIL — 404.

- [ ] **Step 3: Implement**

Modify `apps/api/src/common/request.ts` — add to `AppRequest`:
```ts
  platformAdminId?: string;
```

`apps/api/src/platform/dto.ts`:
```ts
import { pageOf, platformLoginInputSchema, platformLoginResultSchema, platformTenantDtoSchema, platformTenantListQuerySchema } from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class PlatformLoginDto extends createZodDto(platformLoginInputSchema) {}
export class PlatformLoginResponse extends createZodDto(platformLoginResultSchema) {}
export class PlatformTenantListQueryDto extends createZodDto(platformTenantListQuerySchema) {}
export class PlatformTenantResponse extends createZodDto(platformTenantDtoSchema) {}
export class PlatformTenantPageResponse extends createZodDto(pageOf(platformTenantDtoSchema)) {}
```

`apps/api/src/platform/platform.guard.ts`:
```ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { TokenService } from '../auth/crypto/token.service';
import { AppError } from '../common/app-error';
import type { AppRequest } from '../common/request';
import { DbService } from '../db/db.service';
import { platformAdmins } from '../db/schema';

@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly db: DbService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const header = req.headers.authorization;
    const claims = header?.startsWith('Bearer ') ? await this.tokens.verifyPlatform(header.slice(7)) : null;
    if (!claims) throw new AppError('UNAUTHENTICATED');
    const [admin] = await this.db.platform
      .select({ id: platformAdmins.id })
      .from(platformAdmins)
      .where(and(eq(platformAdmins.id, claims.sub), eq(platformAdmins.active, true)));
    if (!admin) throw new AppError('UNAUTHENTICATED');
    req.platformAdminId = admin.id;
    return true;
  }
}
```

`apps/api/src/platform/platform.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Page, PlatformLoginResult, PlatformTenantDto } from '@taskop/contracts';
import { and, asc, eq, gt, ilike, isNull, or, type SQL, sql } from 'drizzle-orm';
import { PasswordHasher } from '../auth/crypto/password-hasher';
import { TokenService } from '../auth/crypto/token.service';
import { RateLimitService } from '../auth/rate-limit.service';
import { AppError } from '../common/app-error';
import { currentRequestMeta } from '../common/request-context';
import { escapeLike } from '../common/sql';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { platformAdmins, sessions, tenants } from '../db/schema';
import type { PlatformLoginDto, PlatformTenantListQueryDto } from './dto';

const userCount = sql<number>`(select count(*)::int from users u where u.tenant_id = ${tenants.id})`;

@Injectable()
export class PlatformService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly rateLimit: RateLimitService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async login(input: PlatformLoginDto): Promise<PlatformLoginResult> {
    await this.rateLimit.consume(`platform-login:ip:${currentRequestMeta().ip}`, this.config.RL_LOGIN_IP_PER_MIN, 60);
    const [admin] = await this.db.platform.select().from(platformAdmins).where(eq(platformAdmins.email, input.email));
    const valid = await this.hasher.verify(admin?.active ? admin.credentialHash : null, input.password);
    if (!admin || !valid) throw new AppError('INVALID_CREDENTIALS');
    const { token, expiresAt } = await this.tokens.signPlatform(admin.id);
    return { accessToken: token, accessTokenExpiresAt: expiresAt.toISOString(), admin: { id: admin.id, email: admin.email, fullName: admin.fullName } };
  }

  async listTenants(q: PlatformTenantListQueryDto): Promise<Page<PlatformTenantDto>> {
    const conditions: (SQL | undefined)[] = [];
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      conditions.push(or(ilike(tenants.name, like), ilike(tenants.orgCode, like)));
    }
    if (q.cursor) conditions.push(gt(tenants.id, q.cursor));
    const rows = await this.db.platform
      .select({ tenant: tenants, userCount })
      .from(tenants)
      .where(and(...conditions))
      .orderBy(asc(tenants.id))
      .limit(q.limit + 1);
    const items = rows.slice(0, q.limit).map((r) => this.toDto(r.tenant, r.userCount));
    return { items, nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null };
  }

  async setStatus(adminId: string, tenantId: string, status: 'active' | 'suspended'): Promise<PlatformTenantDto> {
    const [before] = await this.db.platform.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!before) throw new AppError('NOT_FOUND');
    const [row] = await this.db.platform
      .update(tenants)
      .set({ status, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId))
      .returning({ tenant: tenants, userCount });
    if (status === 'suspended') {
      await this.db.platform
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.tenantId, tenantId), isNull(sessions.revokedAt)));
    }
    await this.audit.recordAsPlatform({
      tenantId,
      actorPlatformAdminId: adminId,
      action: status === 'suspended' ? 'tenant.suspended' : 'tenant.reactivated',
      entityType: 'tenant',
      entityId: tenantId,
      before: { status: before.status },
      after: { status },
    });
    return this.toDto(row!.tenant, row!.userCount);
  }

  private toDto(t: typeof tenants.$inferSelect, count: number): PlatformTenantDto {
    return { id: t.id, name: t.name, orgCode: t.orgCode, status: t.status, userCount: count, createdAt: t.createdAt.toISOString() };
  }
}
```
(If your Drizzle version rejects a SQL expression inside `.returning({...})`, return `tenants` only and re-select with `userCount` afterwards.)

`apps/api/src/platform/platform.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Page, PlatformLoginResult, PlatformTenantDto } from '@taskop/contracts';
import { Public } from '../common/decorators';
import { ParseIdPipe } from '../common/parse-id.pipe';
import type { AppRequest } from '../common/request';
import { PlatformLoginDto, PlatformLoginResponse, PlatformTenantListQueryDto, PlatformTenantPageResponse, PlatformTenantResponse } from './dto';
import { PlatformGuard } from './platform.guard';
import { PlatformService } from './platform.service';

@ApiTags('platform')
@Public()
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(private readonly platform: PlatformService) {}

  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ type: PlatformLoginResponse })
  login(@Body() body: PlatformLoginDto): Promise<PlatformLoginResult> {
    return this.platform.login(body);
  }
}

@ApiTags('platform')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformGuard)
@Controller('platform/tenants')
export class PlatformTenantsController {
  constructor(private readonly platform: PlatformService) {}

  @Get()
  @ApiOkResponse({ type: PlatformTenantPageResponse })
  list(@Query() q: PlatformTenantListQueryDto): Promise<Page<PlatformTenantDto>> {
    return this.platform.listTenants(q);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @ApiOkResponse({ type: PlatformTenantResponse })
  suspend(@Req() req: AppRequest, @Param('id', ParseIdPipe) id: string): Promise<PlatformTenantDto> {
    return this.platform.setStatus(req.platformAdminId!, id, 'suspended');
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @ApiOkResponse({ type: PlatformTenantResponse })
  reactivate(@Req() req: AppRequest, @Param('id', ParseIdPipe) id: string): Promise<PlatformTenantDto> {
    return this.platform.setStatus(req.platformAdminId!, id, 'active');
  }
}
```

`apps/api/src/platform/platform.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformAuthController, PlatformTenantsController } from './platform.controller';
import { PlatformGuard } from './platform.guard';
import { PlatformService } from './platform.service';

@Module({ imports: [AuthModule], controllers: [PlatformAuthController, PlatformTenantsController], providers: [PlatformService, PlatformGuard] })
export class PlatformModule {}
```
Add `PlatformModule` to `AppModule` imports.

`apps/api/src/scripts/create-platform-admin.ts`:
```ts
import { hash } from '@node-rs/argon2';
import { drizzle } from 'drizzle-orm/node-postgres';
import { platformAdmins } from '../db/schema';

async function main(): Promise<void> {
  const { DATABASE_PLATFORM_URL, PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_NAME, PLATFORM_ADMIN_PASSWORD } = process.env;
  if (!DATABASE_PLATFORM_URL || !PLATFORM_ADMIN_EMAIL || !PLATFORM_ADMIN_NAME || !PLATFORM_ADMIN_PASSWORD) {
    throw new Error('DATABASE_PLATFORM_URL, PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_NAME and PLATFORM_ADMIN_PASSWORD are required');
  }
  if (PLATFORM_ADMIN_PASSWORD.length < 12) throw new Error('PLATFORM_ADMIN_PASSWORD must be at least 12 characters');
  const db = drizzle(DATABASE_PLATFORM_URL);
  const credentialHash = await hash(PLATFORM_ADMIN_PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  await db
    .insert(platformAdmins)
    .values({ email: PLATFORM_ADMIN_EMAIL.trim().toLowerCase(), fullName: PLATFORM_ADMIN_NAME, credentialHash })
    .onConflictDoUpdate({ target: platformAdmins.email, set: { fullName: PLATFORM_ADMIN_NAME, credentialHash, active: true } });
  await db.$client.end();
  console.log(`Platform admin ${PLATFORM_ADMIN_EMAIL} is ready`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @taskop/api test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): add platform admin login, tenant list and suspension"
```

---

### Task 20: Tenant isolation suite

**Files:**
- Test: `apps/api/test/isolation.test.ts`

**Interfaces:**
- Consumes: every endpoint from Tasks 9–19. No production code is expected to change; if a case fails, fix the service (never the test).

- [ ] **Step 1: Write the test**

`apps/api/test/isolation.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { as, createUserDirect, roleIdOf, signupTenant, siteTypeIdOf, type SignedUpTenant } from './fixtures';
import { ownerQuery } from './owner-db';

describe('tenant isolation', () => {
  let t: TestApp;
  let A: SignedUpTenant;
  let B: SignedUpTenant;
  const a: Record<string, string> = {};
  const b: Record<string, string> = {};

  beforeAll(async () => {
    t = await createTestApp();
    A = await signupTenant(t);
    B = await signupTenant(t);
    const apiA = as(t, A.accessToken);
    a.type = await siteTypeIdOf(A.tenantId);
    a.site = (await apiA.post('/api/v1/sites', { parentId: null, typeId: a.type, name: 'A site' })).body.id;
    a.team = (await apiA.post('/api/v1/teams', { name: 'A team' })).body.id;
    a.role = (await apiA.post('/api/v1/roles', { name: 'A role', dataScope: 'own' })).body.id;
    a.worker = (await createUserDirect(t, A.tenantId, { username: 'shared-name' })).id;
    b.type = await siteTypeIdOf(B.tenantId);
    b.worker = (await createUserDirect(t, B.tenantId, { username: 'b-worker' })).id;
    b.team = (await as(t, B.accessToken).post('/api/v1/teams', { name: 'B team' })).body.id;
    b.workerRole = await roleIdOf(B.tenantId, 'worker');
  });
  afterAll(() => t.close());

  const notFound = () => [
    ['PATCH', () => `/api/v1/sites/${a.site}`, { name: 'x' }],
    ['POST', () => `/api/v1/sites/${a.site}/move`, { parentId: null }],
    ['PATCH', () => `/api/v1/site-types/${a.type}`, { name: 'x' }],
    ['PATCH', () => `/api/v1/teams/${a.team}`, { name: 'x' }],
    ['PUT', () => `/api/v1/teams/${a.team}/members`, { userIds: [] }],
    ['PATCH', () => `/api/v1/roles/${a.role}`, { name: 'xx' }],
    ['PUT', () => `/api/v1/roles/${a.role}/permissions`, { permissions: [] }],
    ['GET', () => `/api/v1/users/${a.worker}`, undefined],
    ['PATCH', () => `/api/v1/users/${a.worker}`, { fullName: 'Hacked Name' }],
    ['POST', () => `/api/v1/users/${a.worker}/deactivate`, {}],
    ['POST', () => `/api/v1/users/${a.worker}/reactivate`, {}],
    ['POST', () => `/api/v1/users/${a.worker}/reset-credential`, {}],
    ['PUT', () => `/api/v1/users/${a.worker}/sites`, { siteIds: [] }],
    ['PUT', () => `/api/v1/users/${a.worker}/teams`, { teamIds: [] }],
  ] as const;

  it.each(notFound().map((c) => [c[0], c[1], c[2]] as const))('%s on a foreign id returns 404', async (method, url, body) => {
    const api = as(t, B.accessToken);
    const path = url();
    const res =
      method === 'GET' ? await api.get(path) : method === 'POST' ? await api.post(path, body) : method === 'PUT' ? await api.put(path, body) : await api.patch(path, body);
    expect(res.status, `${method} ${path}`).toBe(404);
  });

  it('rejects foreign ids inside request bodies with 422', async () => {
    const api = as(t, B.accessToken);
    const cases = [
      await api.post('/api/v1/sites', { parentId: null, typeId: a.type, name: 'x' }),
      await api.post('/api/v1/sites', { parentId: a.site, typeId: b.type, name: 'x' }),
      await api.put(`/api/v1/teams/${b.team}/members`, { userIds: [a.worker] }),
      await api.put(`/api/v1/users/${b.worker}/sites`, { siteIds: [a.site] }),
      await api.put(`/api/v1/users/${b.worker}/teams`, { teamIds: [a.team] }),
      await api.patch(`/api/v1/users/${b.worker}`, { managerId: a.worker }),
      await api.post('/api/v1/users/workers', { fullName: 'X Y', username: 'xy-iso', roleId: a.role }),
      await api.post('/api/v1/users/workers', { fullName: 'X Y', username: 'xy-iso2', roleId: b.workerRole, siteIds: [a.site] }),
    ];
    for (const res of cases) expect(res.status, JSON.stringify(res.body)).toBe(422);
  });

  it('lists never include the other tenant', async () => {
    const api = as(t, B.accessToken);
    const aIds = new Set(Object.values(a));
    for (const url of ['/api/v1/sites', '/api/v1/site-types', '/api/v1/teams', '/api/v1/roles']) {
      const ids = ((await api.get(url)).body as Array<{ id: string }>).map((x) => x.id);
      expect(ids.filter((id) => aIds.has(id)), url).toEqual([]);
    }
    for (const url of ['/api/v1/users?limit=200', '/api/v1/audit-log?limit=200']) {
      const items = (await api.get(url)).body.items as Array<{ id: string; entityId?: string }>;
      expect(items.filter((x) => aIds.has(x.id) || (x.entityId && aIds.has(x.entityId))), url).toEqual([]);
    }
  });

  it('worker login cannot cross tenants', async () => {
    const res = await t.http().post('/api/v1/auth/login/worker').send({ orgCode: B.orgCode, username: 'shared-name', secret: '482915', client: 'mobile' });
    expect(res.status).toBe(401);
  });

  it('left tenant A untouched', async () => {
    const site = await ownerQuery('select name from sites where id = $1', [a.site]);
    expect(site.rows[0]?.name).toBe('A site');
    const worker = await ownerQuery('select full_name, status from users where id = $1', [a.worker]);
    expect(worker.rows[0]).toMatchObject({ full_name: 'Test User', status: 'active' });
  });
});
```

- [ ] **Step 2: Run the suite**

Run: `pnpm --filter @taskop/api test isolation`
Expected: PASS. Any failure is a real isolation bug — fix the offending service.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/isolation.test.ts
git commit -m "test(api): add tenant isolation suite across all endpoints"
```

---

### Task 21: Seed data, key generation, OpenAPI docs, Docker image, CI, README

**Files:**
- Create: `apps/api/src/scripts/generate-keys.ts`, `apps/api/src/db/scripts/seed.ts`, `apps/api/Dockerfile`, `.dockerignore`, `.github/workflows/ci.yml`, `README.md`
- Modify: `apps/api/src/app.setup.ts` (Swagger)
- Test: `apps/api/test/openapi.test.ts`

**Interfaces:**
- Produces: OpenAPI UI at `/api/docs`, JSON at `/api/docs-json`; `pnpm --filter @taskop/api keys:generate` prints `JWT_PRIVATE_KEY=`/`JWT_PUBLIC_KEY=` lines (PEM with `\n` escapes); `pnpm db:seed` creates the demo tenant `demo` (idempotent); CI workflow running lint → typecheck → test → build.

- [ ] **Step 1: Write the failing test**

`apps/api/test/openapi.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';

describe('OpenAPI', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('serves the document with the Foundation paths', async () => {
    const res = await t.http().get('/api/docs-json');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining(['/api/v1/auth/signup', '/api/v1/users', '/api/v1/sites', '/api/v1/roles', '/api/v1/audit-log']),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @taskop/api test openapi`
Expected: FAIL — 404.

- [ ] **Step 3: Add Swagger**

In `apps/api/src/app.setup.ts` add at the end of `configureApp` (imports: `DocumentBuilder`, `SwaggerModule` from `@nestjs/swagger`; `cleanupOpenApiDoc` from `nestjs-zod`):
```ts
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('Taskop API').setVersion('1.0').addBearerAuth().build(),
  );
  SwaggerModule.setup('api/docs', app, cleanupOpenApiDoc(document));
```

- [ ] **Step 4: Key generator and seed**

`apps/api/src/scripts/generate-keys.ts`:
```ts
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const escape = (pem: string) => pem.trim().replace(/\n/g, '\\n');
console.log(`JWT_PRIVATE_KEY="${escape(privateKey)}"`);
console.log(`JWT_PUBLIC_KEY="${escape(publicKey)}"`);
```

`apps/api/src/db/scripts/seed.ts`:
```ts
import { hash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { uuidv7 } from 'uuidv7';
import { siteLabel } from '../../tenancy/sites.service';
import { seedTenantDefaults } from '../../tenancy/bootstrap';
import * as schema from '../schema';

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

async function main(): Promise<void> {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('DATABASE_OWNER_URL is required');
  const db = drizzle(url, { schema });
  const [existing] = await db.select().from(schema.tenants).where(eq(schema.tenants.orgCode, 'demo'));
  if (existing) {
    console.log('Demo tenant already exists');
    await db.$client.end();
    return;
  }
  const tenantId = uuidv7();
  await db.transaction(async (tx) => {
    await tx.insert(schema.tenants).values({ id: tenantId, name: 'Demo MMC', orgCode: 'demo' });
    const roleIds = await seedTenantDefaults(tx, tenantId);
    const [branchType] = await tx.select().from(schema.siteTypes).where(eq(schema.siteTypes.name, 'Filial'));
    const [zoneType] = await tx.select().from(schema.siteTypes).where(eq(schema.siteTypes.name, 'Zona'));
    const site = async (name: string, typeId: string, parent?: { id: string; path: string }) => {
      const id = uuidv7();
      const path = parent ? `${parent.path}.${siteLabel(id)}` : siteLabel(id);
      await tx.insert(schema.sites).values({ id, tenantId, parentId: parent?.id ?? null, typeId, name, path });
      return { id, path };
    };
    const office = await site('Baş ofis', branchType!.id);
    const warehouse = await site('Anbar №1', branchType!.id);
    await site('Qəbul zonası', zoneType!.id, warehouse);

    const ownerId = uuidv7();
    await tx.insert(schema.users).values({
      id: ownerId, tenantId, fullName: 'Demo Sahib', roleId: roleIds.owner, kind: 'staff',
      email: 'owner@demo.taskop.az', credentialHash: await hash('DemoPassword123', ARGON), credentialKind: 'password',
      status: 'active', emailVerifiedAt: new Date(),
    });
    const managerId = uuidv7();
    await tx.insert(schema.users).values({
      id: managerId, tenantId, fullName: 'Leyla Quliyeva', roleId: roleIds.manager, kind: 'staff',
      email: 'manager@demo.taskop.az', credentialHash: await hash('DemoPassword123', ARGON), credentialKind: 'password',
      status: 'active', emailVerifiedAt: new Date(), managerId: ownerId,
    });
    await tx.insert(schema.userSites).values({ tenantId, userId: managerId, siteId: warehouse.id });
    for (const [username, fullName, siteId] of [
      ['elvin', 'Elvin Məmmədov', warehouse.id],
      ['nigar', 'Nigar Səfərli', office.id],
    ] as const) {
      const id = uuidv7();
      await tx.insert(schema.users).values({
        id, tenantId, fullName, roleId: roleIds.worker, kind: 'worker', username,
        credentialHash: await hash('482915', ARGON), credentialKind: 'pin', status: 'active', managerId,
      });
      await tx.insert(schema.userSites).values({ tenantId, userId: id, siteId });
    }
  });
  await db.$client.end();
  console.log('Demo tenant "demo" created.');
  console.log('  Owner:   owner@demo.taskop.az / DemoPassword123');
  console.log('  Manager: manager@demo.taskop.az / DemoPassword123');
  console.log('  Workers: org code "demo", usernames elvin / nigar, PIN 482915');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
```
(The seed runs as the owner superuser, so RLS doesn't block inserts without `app.tenant_id`.)

- [ ] **Step 5: Dockerfile and CI**

`apps/api/Dockerfile`:
```dockerfile
FROM node:24-alpine AS build
RUN npm install -g pnpm@latest
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@taskop/api...
RUN pnpm --filter @taskop/api deploy --prod --legacy /out

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out .
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/main.js"]
```
(If your pnpm version rejects `--legacy`, remove it and add `injectWorkspacePackages: true` under a `deploy`-only config, or run `pnpm deploy` per the pnpm docs for your version.)

`.dockerignore`:
```
node_modules
**/node_modules
**/dist
.turbo
.git
docs
**/.env
```

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
  pull_request:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```
(Testcontainers uses the Docker daemon available on `ubuntu-latest`.)

- [ ] **Step 6: README**

`README.md`:
````markdown
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
````

- [ ] **Step 7: Verify everything**

```bash
pnpm --filter @taskop/api test
pnpm lint && pnpm typecheck && pnpm build
pnpm --filter @taskop/api keys:generate   # paste into apps/api/.env
pnpm db:setup && pnpm db:seed
pnpm --filter @taskop/api dev   # in another terminal:
curl -s localhost:3000/api/v1/health
curl -s -X POST localhost:3000/api/v1/auth/login/worker -H 'content-type: application/json' \
  -d '{"orgCode":"demo","username":"elvin","secret":"482915","client":"mobile"}'
```
Expected: all tests PASS; lint/typecheck/build clean; health returns `{"status":"ok"}`; worker login returns a `LoginResult` with `me.user.fullName = "Elvin Məmmədov"`. Optionally `docker build -f apps/api/Dockerfile -t taskop-api .` succeeds.

- [ ] **Step 8: Commit**

```bash
git add apps/api .dockerignore .github README.md
git commit -m "chore: add seed data, key generation, OpenAPI docs, API Dockerfile, CI and README"
```
