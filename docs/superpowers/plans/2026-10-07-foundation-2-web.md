# Taskop Foundation — Part 2: API Client & Web App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@taskop/api-client` (typed client with single-flight token refresh, shared by web and mobile) and the Taskop web app: sign-up/login flows, the permission-driven shell, org settings, sites, teams, roles, users, audit log, and the platform-admin pages.

**Architecture:** React SPA (Vite) talking to the Part 1 API through a Vite dev proxy (`/api` → `localhost:3000`), so the refresh cookie stays same-origin. Session state lives in a tiny external store (`useSyncExternalStore`); server data in TanStack Query; forms use react-hook-form with the same Zod schemas the API validates with. Pages are thin wrappers around router-free components so the components can be unit-tested.

**Tech Stack:** React 19, Vite 8, TypeScript 7, TanStack Router (code-based routes) + TanStack Query 5, Tailwind CSS 4 + shadcn/ui, react-hook-form 7 + @hookform/resolvers 5, i18next + react-i18next, lucide-react, sonner, Vitest 5 + Testing Library + jsdom, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-07-foundation-design.md`. **Depends on:** Part 1 (`docs/superpowers/plans/2026-10-07-foundation-1-api.md`) complete.

## Global Constraints

- All Part 1 Global Constraints apply (Taskop naming, latest versions via `pnpm add <pkg>@latest`, i18n keys only, Azerbaijani only, error body format).
- Every user-visible string comes from `@taskop/i18n` (`packages/i18n/src/az/<namespace>.ts`). New namespaces are registered in `packages/i18n/src/az/index.ts`.
- The client refreshes tokens **only** on error code `UNAUTHENTICATED` (never on `INVALID_CREDENTIALS`).
- The web app never stores tokens in `localStorage`/`sessionStorage`: access token in memory; refresh token is the API's `HttpOnly` cookie.
- Menu items and actions are shown only when the user holds the needed permission (FR-25.04 / NFR-02.03).
- Dates are shown with `formatDateTime` in the tenant's timezone.
- Layout works down to 1024 px width (admin tool); forms remain usable at 768 px.

## Review Focus

1. **Two tabs refreshing at once** (same cookie): expected to stay logged in. Pinned in Task W1 (`retries a web refresh once after a 401`), relying on the API's 30-second grace window.
2. **Wrong current password on the settings page** (`INVALID_CREDENTIALS`, HTTP 401): expected to show the error, not log out. Pinned in Task W1 (`does not refresh on INVALID_CREDENTIALS`).
3. **Session expiry while a form is open** (refresh fails): expected to land on the login page with a `redirect` back. Pinned in Task W3 (`AppShell redirects to login when the session ends`).
4. **Moving a site into its own subtree from the UI**: expected to be impossible to choose. Pinned in Task W4 (`move targets exclude the site and its descendants`).
5. **Granting permissions you don't hold from the role editor**: expected to be disabled in the UI (the API also refuses). Pinned in Task W6 (`disables keys the actor does not hold`).

---

## File Structure

```
packages/api-client/src/  errors.ts, client.ts, endpoints.ts, index.ts, client.test.ts
packages/i18n/src/az/     auth.ts, nav.ts, settings.ts, sites.ts, teams.ts, roles.ts, users.ts, audit.ts, platform.ts
apps/web/
├─ index.html, vite.config.ts, tsconfig.json, eslint.config.js, components.json, playwright.config.ts
├─ e2e/foundation.spec.ts
└─ src/
   ├─ main.tsx, router.tsx, styles.css
   ├─ lib/        i18n.ts, session.ts, query.ts, errors.ts, format.ts, utils.ts (shadcn)
   ├─ components/ ui/* (shadcn), text-field.tsx, native-select.tsx, form-error.tsx, logo.tsx,
   │              page-header.tsx, confirm-button.tsx, checkbox-list.tsx
   ├─ layouts/    auth-layout.tsx, app-shell.tsx, verify-email-banner.tsx
   ├─ features/
   │  ├─ auth/     login-form.tsx, login-page.tsx, signup-page.tsx, verify-email-page.tsx,
   │  │            forgot-password-page.tsx, reset-password-page.tsx, accept-invite-page.tsx
   │  ├─ home/     home-page.tsx
   │  ├─ settings/ settings-page.tsx, org-settings-form.tsx, change-password-form.tsx
   │  ├─ sites/    queries.ts, tree.ts, site-types-panel.tsx, site-tree.tsx, site-form-dialog.tsx, move-site-dialog.tsx, sites-page.tsx
   │  ├─ teams/    queries.ts, team-dialog.tsx, teams-page.tsx
   │  ├─ roles/    queries.ts, permission-grid.tsx, role-editor.tsx, roles-page.tsx
   │  ├─ users/    queries.ts, user-labels.ts, users-page.tsx, create-worker-dialog.tsx, invite-staff-dialog.tsx,
   │  │            secret-dialog.tsx, user-detail-page.tsx, user-profile-form.tsx, user-assignments.tsx
   │  ├─ audit/    audit-page.tsx, audit-diff.tsx
   │  └─ platform/ platform-session.ts, platform-login-page.tsx, platform-tenants-page.tsx
   └─ test/       setup.ts, render.tsx
```

---

### Task W1: `@taskop/api-client`

**Files:**
- Create: `packages/api-client/package.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`
- Create: `packages/api-client/src/errors.ts`, `src/client.ts`, `src/endpoints.ts`, `src/index.ts`
- Test: `packages/api-client/src/client.test.ts`

**Interfaces:**
- Consumes: `@taskop/contracts` schemas and input types.
- Produces:
  - `class ApiError extends Error { status: number; code: ErrorCode | 'NETWORK'; messageKey: string; fields: Record<string,string> | null; retryAfterSeconds: number | null; requestId: string | null; static network(): ApiError }`
  - `interface TokenStore { getAccessToken(): string | null; save(t: { accessToken: string; refreshToken: string | null }): Promise<void>; getRefreshToken(): Promise<string | null>; clear(): Promise<void> }`, `memoryTokenStore(): TokenStore`
  - `class ApiClient { constructor(opts: ApiClientOptions); request<T>(method, path, opts?: RequestOptions<T>): Promise<T>; refresh(): Promise<LoginResult | null> }` with `ApiClientOptions { baseUrl; client: 'web'|'mobile'; tokenStore; refresh?: boolean; onSessionExpired?(): void; onRefreshed?(r: LoginResult): void; fetch?: typeof fetch; refreshRetryDelayMs?: number }`, `RequestOptions<T> { body?; query?; schema?: ZodType<T>; auth?: boolean }`
  - `createTaskopApi(client)` → `TaskopApi` with groups `auth, me, tenant, siteTypes, sites, teams, roles, users, audit`; `createPlatformApi(client)` → `PlatformApi` with `login`, `tenants.{list,suspend,reactivate}`.

- [ ] **Step 1: Package setup**

`packages/api-client/package.json`:
```json
{
  "name": "@taskop/api-client",
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
`tsconfig.json`:
```json
{ "extends": "@taskop/config/tsconfig.lib.json", "compilerOptions": { "lib": ["ES2023", "DOM"] } }
```
`eslint.config.js` and `vitest.config.ts`: same as `packages/contracts`.

```bash
pnpm --filter @taskop/api-client add zod@latest "@taskop/contracts@workspace:*"
pnpm --filter @taskop/api-client add -D vitest@latest typescript@latest eslint@latest "@taskop/config@workspace:*"
```

- [ ] **Step 2: Write the failing test**

`packages/api-client/src/client.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, createTaskopApi, memoryTokenStore, type TokenStore } from './index.js';

const id = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f';
const me = {
  user: { id, fullName: 'A B', jobTitle: null, kind: 'staff', email: 'a@b.az', username: null, emailVerified: true, credentialKind: 'password' },
  role: { id, name: 'Owner', systemKey: 'owner', dataScope: 'all' },
  permissions: [],
  tenant: { id, name: 'Acme', orgCode: 'acme', timezone: 'Asia/Baku', locale: 'az' },
};
const loginResult = (token: string, refreshToken: string | null = null) => ({
  accessToken: token,
  accessTokenExpiresAt: '2026-10-07T10:00:00.000Z',
  refreshToken,
  me,
});
const json = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const err = (status: number, code: string) =>
  json(status, { error: { code, messageKey: `errors.${code}`, fields: null, retryAfterSeconds: null, requestId: 'r1' } });

function setup(handler: (url: string, init: RequestInit) => Response | Promise<Response>, client: 'web' | 'mobile' = 'web', store: TokenStore = memoryTokenStore()) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => handler(url, init));
  const onSessionExpired = vi.fn();
  const api = new ApiClient({ baseUrl: '/api/v1', client, tokenStore: store, fetch: fetchMock as unknown as typeof fetch, onSessionExpired, refreshRetryDelayMs: 0 });
  return { api, fetchMock, onSessionExpired, store };
}

describe('ApiClient', () => {
  it('sends the bearer token and parses with the schema', async () => {
    const store = memoryTokenStore();
    await store.save({ accessToken: 'a1', refreshToken: null });
    const { api, fetchMock } = setup(() => json(200, me), 'web', store);
    const result = await createTaskopApi(api).me();
    expect(result.tenant.orgCode).toBe('acme');
    expect((fetchMock.mock.calls[0]![1].headers as Record<string, string>).Authorization).toBe('Bearer a1');
  });

  it('refreshes once on UNAUTHENTICATED and retries, sharing one refresh across concurrent calls', async () => {
    let refreshes = 0;
    const { api } = setup((url, init) => {
      if (url.endsWith('/auth/refresh')) {
        refreshes++;
        return json(200, loginResult('fresh'));
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer fresh' ? json(200, me) : err(401, 'UNAUTHENTICATED');
    });
    const typed = createTaskopApi(api);
    await Promise.all([typed.me(), typed.me(), typed.me()]);
    expect(refreshes).toBe(1);
  });

  it('does not refresh on INVALID_CREDENTIALS', async () => {
    const { api, fetchMock, onSessionExpired } = setup(() => err(401, 'INVALID_CREDENTIALS'));
    await expect(createTaskopApi(api).auth.changeCredential({ currentSecret: 'x', newSecret: 'y' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      status: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('reports an expired session when refresh fails', async () => {
    const store = memoryTokenStore();
    await store.save({ accessToken: 'old', refreshToken: null });
    const { api, onSessionExpired } = setup(() => err(401, 'UNAUTHENTICATED'), 'web', store);
    await expect(createTaskopApi(api).me()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(store.getAccessToken()).toBeNull();
  });

  it('retries a web refresh once after a 401 (another tab rotated the cookie)', async () => {
    let calls = 0;
    const { api } = setup((url) => {
      if (url.endsWith('/auth/refresh')) return ++calls === 1 ? err(401, 'UNAUTHENTICATED') : json(200, loginResult('t2'));
      return json(200, me);
    });
    expect((await api.refresh())?.accessToken).toBe('t2');
    expect(calls).toBe(2);
  });

  it('sends the stored refresh token on mobile and saves the rotated one', async () => {
    const store = memoryTokenStore();
    await store.save({ accessToken: 'a', refreshToken: 'r1' });
    let sent: unknown;
    const { api } = setup((_url, init) => {
      sent = JSON.parse(String(init.body));
      return json(200, loginResult('a2', 'r2'));
    }, 'mobile', store);
    await api.refresh();
    expect(sent).toEqual({ refreshToken: 'r1' });
    expect(await store.getRefreshToken()).toBe('r2');
  });

  it('turns fetch failures into NETWORK errors without clearing tokens', async () => {
    const store = memoryTokenStore();
    await store.save({ accessToken: 'a', refreshToken: 'r' });
    const { api } = setup(() => {
      throw new TypeError('Failed to fetch');
    }, 'mobile', store);
    await expect(createTaskopApi(api).me()).rejects.toBeInstanceOf(ApiError);
    await expect(createTaskopApi(api).me()).rejects.toMatchObject({ code: 'NETWORK', messageKey: 'errors.NETWORK' });
    expect(store.getAccessToken()).toBe('a');
  });

  it('serialises query parameters and skips empty ones', async () => {
    const { api, fetchMock } = setup(() => json(200, { items: [], nextCursor: null }));
    await createTaskopApi(api).users.list({ q: 'elvin', status: undefined, limit: 20 });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/users?q=elvin&limit=20');
  });

  it('returns undefined for 204 responses', async () => {
    const { api } = setup(() => new Response(null, { status: 204 }));
    await expect(createTaskopApi(api).auth.logout()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @taskop/api-client test`
Expected: FAIL — `./index.js` missing.

- [ ] **Step 4: Implement**

`packages/api-client/src/errors.ts`:
```ts
import type { ErrorCode } from '@taskop/contracts';

export type ClientErrorCode = ErrorCode | 'NETWORK';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ClientErrorCode,
    readonly messageKey: string,
    readonly fields: Record<string, string> | null = null,
    readonly retryAfterSeconds: number | null = null,
    readonly requestId: string | null = null,
  ) {
    super(code);
    this.name = 'ApiError';
  }

  static network(): ApiError {
    return new ApiError(0, 'NETWORK', 'errors.NETWORK');
  }
}
```

`packages/api-client/src/client.ts`:
```ts
import { errorBodySchema, type LoginResult, loginResultSchema } from '@taskop/contracts';
import type { ZodType } from 'zod';
import { ApiError } from './errors.js';

export interface TokenStore {
  getAccessToken(): string | null;
  save(tokens: { accessToken: string; refreshToken: string | null }): Promise<void>;
  getRefreshToken(): Promise<string | null>;
  clear(): Promise<void>;
}

/** In-memory store: the web keeps the refresh token in an HttpOnly cookie, never in JS. */
export function memoryTokenStore(): TokenStore {
  let access: string | null = null;
  let refresh: string | null = null;
  return {
    getAccessToken: () => access,
    save: async (t) => {
      access = t.accessToken;
      if (t.refreshToken !== null) refresh = t.refreshToken;
    },
    getRefreshToken: async () => refresh,
    clear: async () => {
      access = null;
      refresh = null;
    },
  };
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions<T> {
  body?: unknown;
  query?: QueryParams;
  schema?: ZodType<T>;
  auth?: boolean;
}

export interface ApiClientOptions {
  baseUrl: string;
  client: 'web' | 'mobile';
  tokenStore: TokenStore;
  /** Set false for clients without refresh (platform admin). */
  refresh?: boolean;
  onSessionExpired?: () => void;
  onRefreshed?: (result: LoginResult) => void;
  fetch?: typeof fetch;
  refreshRetryDelayMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function toQueryString(query?: QueryParams): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.append(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

async function toApiError(res: Response): Promise<ApiError> {
  const parsed = errorBodySchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) return new ApiError(res.status, 'INTERNAL', 'errors.INTERNAL');
  const e = parsed.data.error;
  return new ApiError(res.status, e.code, e.messageKey, e.fields, e.retryAfterSeconds, e.requestId);
}

async function isUnauthenticated(res: Response): Promise<boolean> {
  const body = (await res.clone().json().catch(() => null)) as { error?: { code?: string } } | null;
  return body?.error?.code === 'UNAUTHENTICATED';
}

export class ApiClient {
  private refreshing: Promise<LoginResult | null> | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: ApiClientOptions) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async request<T>(method: string, path: string, o: RequestOptions<T> = {}): Promise<T> {
    let res = await this.send(method, path, o);
    if (res.status === 401 && o.auth !== false && this.opts.refresh !== false && (await isUnauthenticated(res))) {
      const refreshed = await this.refresh();
      if (!refreshed) {
        this.opts.onSessionExpired?.();
        throw await toApiError(res);
      }
      res = await this.send(method, path, o);
    }
    return this.parse(res, o.schema);
  }

  /** Single-flight: concurrent callers share one refresh request. */
  refresh(): Promise<LoginResult | null> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<LoginResult | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const refreshToken = this.opts.client === 'mobile' ? await this.opts.tokenStore.getRefreshToken() : null;
      if (this.opts.client === 'mobile' && !refreshToken) break;
      const res = await this.send('POST', '/auth/refresh', { body: refreshToken ? { refreshToken } : {}, auth: false });
      if (res.ok) {
        const result = loginResultSchema.parse(await res.json());
        await this.opts.tokenStore.save({ accessToken: result.accessToken, refreshToken: result.refreshToken });
        this.opts.onRefreshed?.(result);
        return result;
      }
      // Another tab may have just rotated the shared cookie: the API answers 401 within its grace window.
      if (res.status !== 401 || this.opts.client !== 'web' || attempt === 1) break;
      await sleep(this.opts.refreshRetryDelayMs ?? 300);
    }
    await this.opts.tokenStore.clear();
    return null;
  }

  private async send<T>(method: string, path: string, o: RequestOptions<T>): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    const token = o.auth === false ? null : this.opts.tokenStore.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      return await this.fetchImpl(`${this.opts.baseUrl}${path}${toQueryString(o.query)}`, {
        method,
        headers,
        body: o.body === undefined ? undefined : JSON.stringify(o.body),
        credentials: 'include',
      });
    } catch {
      throw ApiError.network();
    }
  }

  private async parse<T>(res: Response, schema?: ZodType<T>): Promise<T> {
    if (!res.ok) throw await toApiError(res);
    if (res.status === 204) return undefined as T;
    const json: unknown = await res.json();
    return schema ? schema.parse(json) : (json as T);
  }
}
```

`packages/api-client/src/endpoints.ts`:
```ts
import {
  type AuditListQuery,
  auditEntryDtoSchema,
  type ChangeCredentialInput,
  type CreateRoleInput,
  type CreateSiteInput,
  type CreateSiteTypeInput,
  type CreateTeamInput,
  type CreateWorkerInput,
  type InviteAcceptInput,
  type InviteStaffInput,
  type LoginStaffInput,
  type LoginWorkerInput,
  loginResultSchema,
  meSchema,
  type MoveSiteInput,
  pageOf,
  permissionCatalogSchema,
  type PlatformLoginInput,
  platformLoginResultSchema,
  platformTenantDtoSchema,
  type PlatformTenantListQuery,
  type ResetCredentialInput,
  roleDtoSchema,
  type SignupInput,
  siteDtoSchema,
  siteTypeDtoSchema,
  teamDtoSchema,
  tenantDtoSchema,
  type UpdateRoleInput,
  type UpdateSiteInput,
  type UpdateSiteTypeInput,
  type UpdateTeamInput,
  type UpdateTenantInput,
  type UpdateUserInput,
  userDtoSchema,
  type UserListQuery,
  userWithSecretSchema,
  type PermissionKey,
} from '@taskop/contracts';
import { z } from 'zod';
import type { ApiClient, QueryParams } from './client.js';

const q = (query: object) => query as QueryParams;

export function createTaskopApi(c: ApiClient) {
  return {
    auth: {
      signup: (body: SignupInput) => c.request('POST', '/auth/signup', { body, schema: loginResultSchema, auth: false }),
      loginStaff: (body: LoginStaffInput) => c.request('POST', '/auth/login/staff', { body, schema: loginResultSchema, auth: false }),
      loginWorker: (body: LoginWorkerInput) => c.request('POST', '/auth/login/worker', { body, schema: loginResultSchema, auth: false }),
      verifyEmail: (token: string) => c.request<void>('POST', '/auth/verify-email', { body: { token }, auth: false }),
      resendVerification: () => c.request<void>('POST', '/auth/verify-email/resend', { body: {} }),
      acceptInvite: (body: InviteAcceptInput) => c.request('POST', '/auth/invite/accept', { body, schema: loginResultSchema, auth: false }),
      forgotPassword: (email: string) => c.request<void>('POST', '/auth/password/forgot', { body: { email }, auth: false }),
      resetPassword: (token: string, password: string) =>
        c.request<void>('POST', '/auth/password/reset', { body: { token, password }, auth: false }),
      changeCredential: (body: ChangeCredentialInput) => c.request<void>('POST', '/auth/credential/change', { body }),
      logout: () => c.request<void>('POST', '/auth/logout', { body: {} }),
    },
    me: () => c.request('GET', '/me', { schema: meSchema }),
    tenant: {
      get: () => c.request('GET', '/tenant', { schema: tenantDtoSchema }),
      update: (body: UpdateTenantInput) => c.request('PATCH', '/tenant', { body, schema: tenantDtoSchema }),
    },
    siteTypes: {
      list: () => c.request('GET', '/site-types', { schema: z.array(siteTypeDtoSchema) }),
      create: (body: CreateSiteTypeInput) => c.request('POST', '/site-types', { body, schema: siteTypeDtoSchema }),
      update: (id: string, body: UpdateSiteTypeInput) => c.request('PATCH', `/site-types/${id}`, { body, schema: siteTypeDtoSchema }),
    },
    sites: {
      list: () => c.request('GET', '/sites', { schema: z.array(siteDtoSchema) }),
      create: (body: CreateSiteInput) => c.request('POST', '/sites', { body, schema: siteDtoSchema }),
      update: (id: string, body: UpdateSiteInput) => c.request('PATCH', `/sites/${id}`, { body, schema: siteDtoSchema }),
      move: (id: string, body: MoveSiteInput) => c.request('POST', `/sites/${id}/move`, { body, schema: siteDtoSchema }),
    },
    teams: {
      list: () => c.request('GET', '/teams', { schema: z.array(teamDtoSchema) }),
      create: (body: CreateTeamInput) => c.request('POST', '/teams', { body, schema: teamDtoSchema }),
      update: (id: string, body: UpdateTeamInput) => c.request('PATCH', `/teams/${id}`, { body, schema: teamDtoSchema }),
      setMembers: (id: string, userIds: string[]) => c.request('PUT', `/teams/${id}/members`, { body: { userIds }, schema: teamDtoSchema }),
    },
    roles: {
      list: () => c.request('GET', '/roles', { schema: z.array(roleDtoSchema) }),
      catalog: () => c.request('GET', '/permissions', { schema: permissionCatalogSchema }),
      create: (body: CreateRoleInput) => c.request('POST', '/roles', { body, schema: roleDtoSchema }),
      update: (id: string, body: UpdateRoleInput) => c.request('PATCH', `/roles/${id}`, { body, schema: roleDtoSchema }),
      setPermissions: (id: string, permissions: PermissionKey[]) =>
        c.request('PUT', `/roles/${id}/permissions`, { body: { permissions }, schema: roleDtoSchema }),
    },
    users: {
      list: (query: UserListQuery = {}) => c.request('GET', '/users', { query: q(query), schema: pageOf(userDtoSchema) }),
      get: (id: string) => c.request('GET', `/users/${id}`, { schema: userDtoSchema }),
      createWorker: (body: CreateWorkerInput) => c.request('POST', '/users/workers', { body, schema: userWithSecretSchema }),
      invite: (body: InviteStaffInput) => c.request('POST', '/users/invite', { body, schema: userDtoSchema }),
      update: (id: string, body: UpdateUserInput) => c.request('PATCH', `/users/${id}`, { body, schema: userDtoSchema }),
      deactivate: (id: string) => c.request('POST', `/users/${id}/deactivate`, { body: {}, schema: userDtoSchema }),
      reactivate: (id: string) => c.request('POST', `/users/${id}/reactivate`, { body: {}, schema: userDtoSchema }),
      resetCredential: (id: string, body: ResetCredentialInput = {}) =>
        c.request('POST', `/users/${id}/reset-credential`, { body, schema: userWithSecretSchema }),
      setSites: (id: string, siteIds: string[]) => c.request('PUT', `/users/${id}/sites`, { body: { siteIds }, schema: userDtoSchema }),
      setTeams: (id: string, teamIds: string[]) => c.request('PUT', `/users/${id}/teams`, { body: { teamIds }, schema: userDtoSchema }),
    },
    audit: {
      list: (query: AuditListQuery = {}) => c.request('GET', '/audit-log', { query: q(query), schema: pageOf(auditEntryDtoSchema) }),
    },
  };
}
export type TaskopApi = ReturnType<typeof createTaskopApi>;

export function createPlatformApi(c: ApiClient) {
  return {
    login: (body: PlatformLoginInput) => c.request('POST', '/platform/auth/login', { body, schema: platformLoginResultSchema, auth: false }),
    tenants: {
      list: (query: PlatformTenantListQuery = {}) =>
        c.request('GET', '/platform/tenants', { query: q(query), schema: pageOf(platformTenantDtoSchema) }),
      suspend: (id: string) => c.request('POST', `/platform/tenants/${id}/suspend`, { body: {}, schema: platformTenantDtoSchema }),
      reactivate: (id: string) => c.request('POST', `/platform/tenants/${id}/reactivate`, { body: {}, schema: platformTenantDtoSchema }),
    },
  };
}
export type PlatformApi = ReturnType<typeof createPlatformApi>;
```

`packages/api-client/src/index.ts`:
```ts
export * from './errors.js';
export * from './client.js';
export * from './endpoints.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @taskop/api-client test && pnpm --filter @taskop/api-client build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api-client pnpm-lock.yaml
git commit -m "feat(api-client): add typed Taskop API client with single-flight refresh"
```

---

### Task W2: Web scaffold, session store, auth screens

**Files:**
- Create: `apps/web/package.json`, `index.html`, `vite.config.ts`, `tsconfig.json`, `eslint.config.js`
- Create: `apps/web/src/main.tsx`, `src/router.tsx`, `src/styles.css`
- Create: `apps/web/src/lib/i18n.ts`, `src/lib/session.ts`, `src/lib/query.ts`, `src/lib/errors.ts`
- Create: `apps/web/src/components/text-field.tsx`, `native-select.tsx`, `form-error.tsx`, `logo.tsx`
- Create: `apps/web/src/layouts/auth-layout.tsx`
- Create: `apps/web/src/features/auth/login-form.tsx`, `login-page.tsx`, `signup-page.tsx`, `verify-email-page.tsx`, `forgot-password-page.tsx`, `reset-password-page.tsx`, `accept-invite-page.tsx`
- Create: `apps/web/src/test/setup.ts`, `src/test/render.tsx`
- Create: `packages/i18n/src/az/auth.ts`; Modify: `packages/i18n/src/az/index.ts`
- Test: `apps/web/src/lib/errors.test.ts`, `apps/web/src/features/auth/login-form.test.tsx`

**Interfaces:**
- Consumes: `@taskop/api-client`, `@taskop/contracts`, `@taskop/i18n`.
- Produces:
  - `session` store `{ get(); subscribe(l); bootstrap(); signedIn(r: LoginResult); setMe(me); signOut() }`, hooks `useSession()`, `useMe()`, `useCan(...keys)`; `api: TaskopApi`, `apiClient`, `tokenStore` (from `@/lib/session`).
  - `queryClient` (from `@/lib/query`).
  - `errorText(t, e): string`, `applyFieldErrors(form, e): boolean` (from `@/lib/errors`).
  - Components: `TextField({ form, name, label, type?, autoComplete?, description? })`, `NativeSelect` (props of `<select>`), `FormError({ message })`, `Logo`.
  - Routes: `rootRoute`, `authLayout` (redirects authenticated users to `/`), `appLayout` (redirects anonymous users to `/login?redirect=…`), `/login`, `/signup`, `/forgot-password`, `/reset-password?token=`, `/accept-invite?token=`, `/verify-email?token=` (outside both layouts), `/` placeholder (replaced in W3). `router` export.
  - Test helper `renderWithProviders(ui)`.

- [ ] **Step 1: Create the app and install dependencies**

`apps/web/package.json`:
```json
{
  "name": "@taskop/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "e2e": "playwright test"
  }
}
```

```bash
pnpm --filter @taskop/web add react@latest react-dom@latest @tanstack/react-router@latest @tanstack/react-query@latest react-hook-form@latest @hookform/resolvers@latest i18next@latest react-i18next@latest zod@latest lucide-react@latest sonner@latest "@taskop/contracts@workspace:*" "@taskop/i18n@workspace:*" "@taskop/api-client@workspace:*"
pnpm --filter @taskop/web add -D vite@latest @vitejs/plugin-react@latest tailwindcss@latest @tailwindcss/vite@latest typescript@latest @types/react@latest @types/react-dom@latest @types/node@latest vitest@latest jsdom@latest @testing-library/react@latest @testing-library/user-event@latest @testing-library/jest-dom@latest eslint@latest eslint-plugin-react-hooks@latest "@taskop/config@workspace:*"
```

`apps/web/index.html`:
```html
<!doctype html>
<html lang="az">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Taskop</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/vite.config.ts`:
```ts
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  preview: { port: 4173, proxy: { '/api': 'http://localhost:3000' } },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "@taskop/config/tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true,
    "types": ["vite/client", "node"],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src", "e2e", "vite.config.ts", "playwright.config.ts"]
}
```

`apps/web/eslint.config.js`:
```js
import base from '@taskop/config/eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig } from 'eslint/config';

export default defineConfig(base, reactHooks.configs['recommended-latest'], { ignores: ['src/components/ui/**'] });
```

`apps/web/src/styles.css`:
```css
@import 'tailwindcss';
```

Initialise shadcn/ui (accept defaults; it writes `components.json`, `src/lib/utils.ts`, theme variables into `src/styles.css`) and add the components used in this plan:
```bash
cd apps/web
pnpm dlx shadcn@latest init --yes --base-color neutral
pnpm dlx shadcn@latest add --yes button input label card table dialog checkbox badge dropdown-menu sonner alert textarea separator tabs
cd ../..
```
Expected: files under `apps/web/src/components/ui/`. If `init` asks for the CSS file, answer `src/styles.css`; for the alias, `@/components` and `@/lib/utils`.

- [ ] **Step 2: Auth translations**

`packages/i18n/src/az/auth.ts`:
```ts
export default {
  login: {
    title: 'Taskop-a daxil olun',
    email: 'E-poçt',
    password: 'Şifrə',
    submit: 'Daxil ol',
    forgot: 'Şifrəni unutmusunuz?',
    noAccount: 'Hesabınız yoxdur?',
    signupLink: 'Təşkilatı qeydiyyatdan keçirin',
    workersHint: 'İşçilər mobil tətbiq vasitəsilə daxil olur.',
  },
  signup: {
    title: 'Təşkilatınızı qeydiyyatdan keçirin',
    orgName: 'Təşkilatın adı',
    orgCode: 'Təşkilat kodu',
    orgCodeHint: 'İşçilər mobil tətbiqə daxil olarkən bu kodu yazacaq. Məsələn: acme',
    fullName: 'Ad və soyad',
    email: 'E-poçt',
    password: 'Şifrə',
    passwordHint: 'Ən azı 10 simvol',
    submit: 'Qeydiyyatdan keç',
    haveAccount: 'Artıq hesabınız var?',
    loginLink: 'Daxil olun',
  },
  verify: {
    title: 'E-poçtun təsdiqi',
    verifying: 'Təsdiqlənir…',
    success: 'E-poçt ünvanınız təsdiqləndi.',
    continue: 'Davam et',
  },
  verifyBanner: {
    text: 'E-poçt ünvanınızı təsdiqləyin. Təsdiqdən sonra əməkdaşları dəvət edə biləcəksiniz.',
    resend: 'Məktubu yenidən göndər',
    sent: 'Məktub göndərildi.',
  },
  forgot: {
    title: 'Şifrənin bərpası',
    email: 'E-poçt',
    submit: 'Keçid göndər',
    sent: 'Bu e-poçt qeydiyyatdadırsa, şifrəni yeniləmək üçün keçid göndərdik.',
    back: 'Girişə qayıt',
  },
  reset: {
    title: 'Yeni şifrə təyin edin',
    password: 'Yeni şifrə',
    submit: 'Şifrəni yenilə',
    success: 'Şifrəniz yeniləndi. İndi daxil ola bilərsiniz.',
    login: 'Daxil ol',
  },
  invite: {
    title: 'Dəvəti qəbul edin',
    password: 'Şifrə',
    confirm: 'Şifrəni təkrarlayın',
    mismatch: 'Şifrələr eyni deyil.',
    submit: 'Hesabı aktivləşdir',
  },
  missingToken: 'Keçid natamamdır. E-poçtdakı keçidi yenidən açın.',
} as const;
```

Replace `packages/i18n/src/az/index.ts`:
```ts
import auth from './auth.js';
import common from './common.js';
import errors from './errors.js';

// Each UI namespace is a file in this folder; register new ones here.
export const az = { common, errors, auth } as const;
export type Translations = typeof az;
```
Run `pnpm --filter @taskop/i18n build`.

- [ ] **Step 3: Write the failing tests**

`apps/web/src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import '@/lib/i18n';

afterEach(() => cleanup());
```

`apps/web/src/test/render.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';

export function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
```

`apps/web/src/lib/errors.test.ts`:
```ts
import { ApiError } from '@taskop/api-client';
import { describe, expect, it } from 'vitest';
import i18n from './i18n';
import { errorText } from './errors';

describe('errorText', () => {
  const t = i18n.t.bind(i18n);
  it('translates API errors with minutes and request ids', () => {
    expect(errorText(t, new ApiError(429, 'ACCOUNT_LOCKED', 'errors.ACCOUNT_LOCKED', null, 840))).toContain('14 dəqiqədən');
    expect(errorText(t, new ApiError(500, 'INTERNAL', 'errors.INTERNAL', null, null, 'req-7'))).toContain('req-7');
  });
  it('falls back to the internal message for unknown errors', () => {
    expect(errorText(t, new Error('x'))).toContain('Gözlənilməz xəta');
  });
});
```

`apps/web/src/features/auth/login-form.test.tsx`:
```tsx
import { ApiError } from '@taskop/api-client';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { LoginForm } from './login-form';

const loginStaff = vi.fn();
vi.mock('@/lib/session', () => ({ api: { auth: { loginStaff: (...a: unknown[]) => loginStaff(...a) } } }));

describe('LoginForm', () => {
  beforeEach(() => loginStaff.mockReset());

  it('submits normalised credentials for the web client', async () => {
    const onSuccess = vi.fn();
    loginStaff.mockResolvedValue({ accessToken: 'a' });
    renderWithProviders(<LoginForm onSuccess={onSuccess} />);
    await userEvent.type(screen.getByLabelText('E-poçt'), '  Owner@Acme.AZ ');
    await userEvent.type(screen.getByLabelText('Şifrə'), 'secret password');
    await userEvent.click(screen.getByRole('button', { name: 'Daxil ol' }));
    expect(loginStaff).toHaveBeenCalledWith({ email: 'owner@acme.az', password: 'secret password', client: 'web' });
    expect(onSuccess).toHaveBeenCalledWith({ accessToken: 'a' });
  });

  it('shows the translated API error', async () => {
    loginStaff.mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'errors.INVALID_CREDENTIALS'));
    renderWithProviders(<LoginForm onSuccess={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('E-poçt'), 'a@b.az');
    await userEvent.type(screen.getByLabelText('Şifrə'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Daxil ol' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Giriş məlumatları yanlışdır.');
  });

  it('shows required-field errors without calling the API', async () => {
    renderWithProviders(<LoginForm onSuccess={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Daxil ol' }));
    expect(await screen.findAllByText('Bu xana mütləqdir.')).toHaveLength(2);
    expect(loginStaff).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm --filter @taskop/web test`
Expected: FAIL — `./i18n`, `./errors`, `./login-form` missing.

- [ ] **Step 5: Implement the libraries**

`apps/web/src/lib/i18n.ts`:
```ts
import { DEFAULT_LOCALE, resources } from '@taskop/i18n';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

void i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  interpolation: { escapeValue: false },
});

export default i18n;
```

`apps/web/src/lib/query.ts`:
```ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
});
```

`apps/web/src/lib/session.ts`:
```ts
import { ApiClient, ApiError, createTaskopApi, memoryTokenStore } from '@taskop/api-client';
import type { LoginResult, Me, PermissionKey } from '@taskop/contracts';
import { useSyncExternalStore } from 'react';
import { queryClient } from './query';

export type SessionState = { status: 'loading' } | { status: 'anonymous' } | { status: 'authenticated'; me: Me };

let state: SessionState = { status: 'loading' };
const listeners = new Set<() => void>();
function set(next: SessionState): void {
  state = next;
  listeners.forEach((l) => l());
}

export const tokenStore = memoryTokenStore();
export const apiClient = new ApiClient({
  baseUrl: '/api/v1',
  client: 'web',
  tokenStore,
  onSessionExpired: () => set({ status: 'anonymous' }),
  onRefreshed: (r) => set({ status: 'authenticated', me: r.me }),
});
export const api = createTaskopApi(apiClient);

export const session = {
  get: (): SessionState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** On page load: the HttpOnly refresh cookie (if any) restores the session. */
  async bootstrap(): Promise<void> {
    try {
      const result = await apiClient.refresh();
      set(result ? { status: 'authenticated', me: result.me } : { status: 'anonymous' });
    } catch {
      set({ status: 'anonymous' });
    }
  },
  async signedIn(result: LoginResult): Promise<void> {
    await tokenStore.save({ accessToken: result.accessToken, refreshToken: null });
    set({ status: 'authenticated', me: result.me });
  },
  setMe(me: Me): void {
    set({ status: 'authenticated', me });
  },
  async signOut(): Promise<void> {
    try {
      await api.auth.logout();
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    }
    await tokenStore.clear();
    queryClient.clear();
    set({ status: 'anonymous' });
  },
};

export function useSession(): SessionState {
  return useSyncExternalStore(session.subscribe, session.get);
}

export function useMe(): Me {
  const s = useSession();
  if (s.status !== 'authenticated') throw new Error('useMe() used outside the authenticated area');
  return s.me;
}

export function useCan(...keys: PermissionKey[]): boolean {
  const me = useMe();
  return keys.every((k) => me.permissions.includes(k));
}
```

`apps/web/src/lib/errors.ts`:
```ts
import { ApiError } from '@taskop/api-client';
import type { TFunction } from 'i18next';
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';

export function errorText(t: TFunction, e: unknown): string {
  if (e instanceof ApiError) {
    const minutes = e.retryAfterSeconds ? Math.ceil(e.retryAfterSeconds / 60) : 1;
    return t(e.messageKey, { minutes, requestId: e.requestId ?? '—' });
  }
  return t('errors.INTERNAL', { requestId: '—' });
}

/** Puts API field errors (i18n keys) onto the matching form inputs. Returns true if any were applied. */
export function applyFieldErrors<T extends FieldValues>(form: UseFormReturn<T>, e: unknown): boolean {
  if (!(e instanceof ApiError) || !e.fields) return false;
  const entries = Object.entries(e.fields);
  for (const [name, key] of entries) form.setError(name as Path<T>, { type: 'server', message: key });
  return entries.length > 0;
}
```

- [ ] **Step 6: Implement shared components**

`apps/web/src/components/text-field.tsx`:
```tsx
import { type FieldValues, get, type Path, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface TextFieldProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  name: Path<T>;
  label: string;
  type?: string;
  autoComplete?: string;
  description?: string;
  inputMode?: 'numeric' | 'text' | 'email';
}

export function TextField<T extends FieldValues>({ form, name, label, type = 'text', autoComplete, description, inputMode }: TextFieldProps<T>) {
  const { t } = useTranslation();
  const error = get(form.formState.errors, name)?.message as string | undefined;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} type={type} autoComplete={autoComplete} inputMode={inputMode} aria-invalid={Boolean(error)} {...form.register(name)} />
      {description && !error && <p className="text-muted-foreground text-xs">{description}</p>}
      {error && <p className="text-destructive text-sm">{t(error)}</p>}
    </div>
  );
}
```

`apps/web/src/components/native-select.tsx`:
```tsx
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** A styled native <select>: accessible, testable and form-friendly without a popover. */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'border-input focus-visible:ring-ring h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
```

`apps/web/src/components/form-error.tsx`:
```tsx
import { Alert, AlertDescription } from '@/components/ui/alert';

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
```

`apps/web/src/components/logo.tsx`:
```tsx
import { CheckSquare } from 'lucide-react';

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-lg font-semibold ${className}`}>
      <CheckSquare className="size-6 text-blue-600" aria-hidden />
      Taskop
    </span>
  );
}
```

`apps/web/src/layouts/auth-layout.tsx`:
```tsx
import { Outlet } from '@tanstack/react-router';
import { Logo } from '@/components/logo';

export function AuthLayout() {
  return (
    <div className="bg-muted/40 flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <Logo />
      <div className="bg-background w-full max-w-md rounded-xl border p-8 shadow-sm">
        <Outlet />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Implement the auth screens**

`apps/web/src/features/auth/login-form.tsx`:
```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { type LoginResult, loginStaffInputSchema } from '@taskop/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { FormError } from '@/components/form-error';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { applyFieldErrors, errorText } from '@/lib/errors';
import { api } from '@/lib/session';

type Values = z.input<typeof loginStaffInputSchema>;

export function LoginForm({ onSuccess }: { onSuccess: (result: LoginResult) => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values, unknown, z.output<typeof loginStaffInputSchema>>({
    resolver: zodResolver(loginStaffInputSchema),
    defaultValues: { email: '', password: '', client: 'web' },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      onSuccess(await api.auth.loginStaff(values));
    } catch (e) {
      if (!applyFieldErrors(form, e)) setError(errorText(t, e));
    }
  });
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <TextField form={form} name="email" label={t('auth.login.email')} type="email" autoComplete="username" />
      <TextField form={form} name="password" label={t('auth.login.password')} type="password" autoComplete="current-password" />
      <FormError message={error} />
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {t('auth.login.submit')}
      </Button>
    </form>
  );
}
```

`apps/web/src/features/auth/login-page.tsx`:
```tsx
import { Link, useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { session } from '@/lib/session';
import { LoginForm } from './login-form';

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const router = useRouter();
  const { redirect } = useSearch({ from: '/auth/login' });
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">{t('auth.login.title')}</h1>
      <LoginForm
        onSuccess={async (result) => {
          await session.signedIn(result);
          if (redirect?.startsWith('/')) router.history.push(redirect);
          else await navigate({ to: '/' });
        }}
      />
      <div className="text-muted-foreground grid gap-2 text-sm">
        <Link to="/forgot-password" className="underline">
          {t('auth.login.forgot')}
        </Link>
        <span>
          {t('auth.login.noAccount')}{' '}
          <Link to="/signup" className="underline">
            {t('auth.login.signupLink')}
          </Link>
        </span>
        <span>{t('auth.login.workersHint')}</span>
      </div>
    </div>
  );
}
```

`apps/web/src/features/auth/signup-page.tsx`:
```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { signupInputSchema } from '@taskop/contracts';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { FormError } from '@/components/form-error';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { applyFieldErrors, errorText } from '@/lib/errors';
import { api, session } from '@/lib/session';

export function SignupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof signupInputSchema>, unknown, z.output<typeof signupInputSchema>>({
    resolver: zodResolver(signupInputSchema),
    defaultValues: { orgName: '', orgCode: '', fullName: '', email: '', password: '', client: 'web' },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await session.signedIn(await api.auth.signup(values));
      await navigate({ to: '/' });
    } catch (e) {
      if (!applyFieldErrors(form, e)) setError(errorText(t, e));
    }
  });
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <h1 className="text-xl font-semibold">{t('auth.signup.title')}</h1>
      <TextField form={form} name="orgName" label={t('auth.signup.orgName')} autoComplete="organization" />
      <TextField form={form} name="orgCode" label={t('auth.signup.orgCode')} description={t('auth.signup.orgCodeHint')} />
      <TextField form={form} name="fullName" label={t('auth.signup.fullName')} autoComplete="name" />
      <TextField form={form} name="email" label={t('auth.signup.email')} type="email" autoComplete="email" />
      <TextField form={form} name="password" label={t('auth.signup.password')} type="password" autoComplete="new-password" description={t('auth.signup.passwordHint')} />
      <FormError message={error} />
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {t('auth.signup.submit')}
      </Button>
      <p className="text-muted-foreground text-sm">
        {t('auth.signup.haveAccount')}{' '}
        <Link to="/login" className="underline">
          {t('auth.signup.loginLink')}
        </Link>
      </p>
    </form>
  );
}
```

`apps/web/src/features/auth/verify-email-page.tsx`:
```tsx
import { Link, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/form-error';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { errorText } from '@/lib/errors';
import { api, session } from '@/lib/session';

export function VerifyEmailPage() {
  const { t } = useTranslation();
  const { token } = useSearch({ from: '/verify-email' });
  const [state, setState] = useState<'pending' | 'done' | 'error'>(token ? 'pending' : 'error');
  const [error, setError] = useState<string | null>(token ? null : t('auth.missingToken'));
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api.auth
      .verifyEmail(token)
      .then(async () => {
        setState('done');
        const s = session.get();
        if (s.status === 'authenticated') session.setMe(await api.me());
      })
      .catch((e: unknown) => {
        setState('error');
        setError(errorText(t, e));
      });
  }, [token, t]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <Logo />
      <div className="grid w-full max-w-md gap-4 rounded-xl border p-8">
        <h1 className="text-xl font-semibold">{t('auth.verify.title')}</h1>
        {state === 'pending' && <p>{t('auth.verify.verifying')}</p>}
        {state === 'done' && <p>{t('auth.verify.success')}</p>}
        <FormError message={error} />
        <Button asChild>
          <Link to="/">{t('auth.verify.continue')}</Link>
        </Button>
      </div>
    </div>
  );
}
```

`apps/web/src/features/auth/forgot-password-page.tsx`:
```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordInputSchema } from '@taskop/contracts';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { FormError } from '@/components/form-error';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { errorText } from '@/lib/errors';
import { api } from '@/lib/session';

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof forgotPasswordInputSchema>, unknown, z.output<typeof forgotPasswordInputSchema>>({
    resolver: zodResolver(forgotPasswordInputSchema),
    defaultValues: { email: '' },
  });
  const onSubmit = form.handleSubmit(async ({ email }) => {
    setError(null);
    try {
      await api.auth.forgotPassword(email);
      setSent(true);
    } catch (e) {
      setError(errorText(t, e));
    }
  });
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <h1 className="text-xl font-semibold">{t('auth.forgot.title')}</h1>
      {sent ? (
        <p>{t('auth.forgot.sent')}</p>
      ) : (
        <>
          <TextField form={form} name="email" label={t('auth.forgot.email')} type="email" autoComplete="email" />
          <FormError message={error} />
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {t('auth.forgot.submit')}
          </Button>
        </>
      )}
      <Link to="/login" className="text-sm underline">
        {t('auth.forgot.back')}
      </Link>
    </form>
  );
}
```

`apps/web/src/features/auth/reset-password-page.tsx`:
```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { passwordSchema } from '@taskop/contracts';
import { Link, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { FormError } from '@/components/form-error';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { applyFieldErrors, errorText } from '@/lib/errors';
import { api } from '@/lib/session';

const schema = z.object({ password: passwordSchema });

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const { token } = useSearch({ from: '/auth/reset-password' });
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : t('auth.missingToken'));
  const form = useForm<z.input<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { password: '' } });
  const onSubmit = form.handleSubmit(async ({ password }) => {
    if (!token) return;
    setError(null);
    try {
      await api.auth.resetPassword(token, password);
      setDone(true);
    } catch (e) {
      if (!applyFieldErrors(form, e)) setError(errorText(t, e));
    }
  });
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <h1 className="text-xl font-semibold">{t('auth.reset.title')}</h1>
      {done ? (
        <>
          <p>{t('auth.reset.success')}</p>
          <Button asChild>
            <Link to="/login">{t('auth.reset.login')}</Link>
          </Button>
        </>
      ) : (
        <>
          <TextField form={form} name="password" label={t('auth.reset.password')} type="password" autoComplete="new-password" />
          <FormError message={error} />
          <Button type="submit" disabled={!token || form.formState.isSubmitting}>
            {t('auth.reset.submit')}
          </Button>
        </>
      )}
    </form>
  );
}
```

`apps/web/src/features/auth/accept-invite-page.tsx`:
```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { passwordSchema } from '@taskop/contracts';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { FormError } from '@/components/form-error';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { applyFieldErrors, errorText } from '@/lib/errors';
import { api, session } from '@/lib/session';

const schema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], error: 'auth.invite.mismatch' });

export function AcceptInvitePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { token } = useSearch({ from: '/auth/accept-invite' });
  const [error, setError] = useState<string | null>(token ? null : t('auth.missingToken'));
  const form = useForm<z.input<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });
  const onSubmit = form.handleSubmit(async ({ password }) => {
    if (!token) return;
    setError(null);
    try {
      await session.signedIn(await api.auth.acceptInvite({ token, password, client: 'web' }));
      await navigate({ to: '/' });
    } catch (e) {
      if (!applyFieldErrors(form, e)) setError(errorText(t, e));
    }
  });
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <h1 className="text-xl font-semibold">{t('auth.invite.title')}</h1>
      <TextField form={form} name="password" label={t('auth.invite.password')} type="password" autoComplete="new-password" />
      <TextField form={form} name="confirm" label={t('auth.invite.confirm')} type="password" autoComplete="new-password" />
      <FormError message={error} />
      <Button type="submit" disabled={!token || form.formState.isSubmitting}>
        {t('auth.invite.submit')}
      </Button>
    </form>
  );
}
```

- [ ] **Step 8: Router and entry point**

`apps/web/src/router.tsx`:
```tsx
import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { AcceptInvitePage } from '@/features/auth/accept-invite-page';
import { ForgotPasswordPage } from '@/features/auth/forgot-password-page';
import { LoginPage } from '@/features/auth/login-page';
import { ResetPasswordPage } from '@/features/auth/reset-password-page';
import { SignupPage } from '@/features/auth/signup-page';
import { VerifyEmailPage } from '@/features/auth/verify-email-page';
import { AuthLayout } from '@/layouts/auth-layout';
import { session } from '@/lib/session';

const tokenSearch = (s: Record<string, unknown>) => ({ token: typeof s.token === 'string' ? s.token : undefined });

export const rootRoute = createRootRoute({ component: Outlet });

export const authLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'auth',
  component: AuthLayout,
  beforeLoad: () => {
    if (session.get().status === 'authenticated') throw redirect({ to: '/' });
  },
});

export const appLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: Outlet,
  beforeLoad: ({ location }) => {
    if (session.get().status !== 'authenticated') throw redirect({ to: '/login', search: { redirect: location.href } });
  },
});

const loginRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/login',
  component: LoginPage,
  validateSearch: (s: Record<string, unknown>) => ({ redirect: typeof s.redirect === 'string' ? s.redirect : undefined }),
});
const signupRoute = createRoute({ getParentRoute: () => authLayout, path: '/signup', component: SignupPage });
const forgotRoute = createRoute({ getParentRoute: () => authLayout, path: '/forgot-password', component: ForgotPasswordPage });
const resetRoute = createRoute({ getParentRoute: () => authLayout, path: '/reset-password', component: ResetPasswordPage, validateSearch: tokenSearch });
const acceptInviteRoute = createRoute({ getParentRoute: () => authLayout, path: '/accept-invite', component: AcceptInvitePage, validateSearch: tokenSearch });
const verifyEmailRoute = createRoute({ getParentRoute: () => rootRoute, path: '/verify-email', component: VerifyEmailPage, validateSearch: tokenSearch });

const homeRoute = createRoute({ getParentRoute: () => appLayout, path: '/', component: () => <p className="p-8">Taskop</p> });

const routeTree = rootRoute.addChildren([
  authLayout.addChildren([loginRoute, signupRoute, forgotRoute, resetRoute, acceptInviteRoute]),
  verifyEmailRoute,
  appLayout.addChildren([homeRoute]),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
```

`apps/web/src/main.tsx`:
```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from '@/components/ui/sonner';
import '@/lib/i18n';
import { queryClient } from '@/lib/query';
import { session } from '@/lib/session';
import { router } from '@/router';
import './styles.css';

session.subscribe(() => {
  void router.invalidate();
});

void session.bootstrap().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster richColors position="top-right" />
      </QueryClientProvider>
    </StrictMode>,
  );
});
```

- [ ] **Step 9: Run tests and type-check**

Run: `pnpm --filter @taskop/web test && pnpm --filter @taskop/web typecheck`
Expected: PASS. (If a shadcn component file fails `noUncheckedIndexedAccess`, keep it excluded from lint and add `// @ts-nocheck` only to that generated file.)

- [ ] **Step 10: Manual check**

With the API running (`pnpm --filter @taskop/api dev`), run `pnpm --filter @taskop/web dev`, open http://localhost:5173/signup, create an organisation, and confirm you land on `/` (placeholder). Open Mailpit (http://localhost:8025), follow the verification link, and confirm the success message.

- [ ] **Step 11: Commit**

```bash
git add apps/web packages/i18n pnpm-lock.yaml
git commit -m "feat(web): scaffold web app with session store and sign-up/login/reset/invite screens"
```

---

### Task W3: App shell, home, settings

**Files:**
- Create: `apps/web/src/layouts/app-shell.tsx`, `src/layouts/verify-email-banner.tsx`, `src/components/page-header.tsx`, `src/lib/format.ts`
- Create: `apps/web/src/features/home/home-page.tsx`
- Create: `apps/web/src/features/settings/settings-page.tsx`, `org-settings-form.tsx`, `change-password-form.tsx`
- Create: `packages/i18n/src/az/nav.ts`, `packages/i18n/src/az/settings.ts`; Modify: `packages/i18n/src/az/index.ts`
- Modify: `apps/web/src/router.tsx` (shell, home, settings)
- Test: `apps/web/src/layouts/app-shell.test.tsx`

**Interfaces:**
- Consumes: `session`, `useMe`, `useCan`, `api.tenant`, `api.auth.changeCredential`, `api.auth.resendVerification`.
- Produces:
  - `AppShell` (sidebar filtered by permission, user menu with logout, verify banner, redirects to `/login?redirect=` when the session becomes anonymous).
  - `NAV_ITEMS: { to; labelKey; icon; permission?: PermissionKey }[]` exported from `app-shell.tsx`; later tasks' routes match these paths: `/users`, `/roles`, `/sites`, `/teams`, `/audit`, `/settings`.
  - `PageHeader({ title, actions? })`; `useFormatDateTime(): (iso: string) => string` (from `@/lib/format`).
  - Routes `/` (HomePage) and `/settings`.

- [ ] **Step 1: Translations**

`packages/i18n/src/az/nav.ts`:
```ts
export default {
  home: 'Ana səhifə',
  users: 'İstifadəçilər',
  roles: 'Rollar',
  sites: 'Obyektlər',
  teams: 'Komandalar',
  audit: 'Audit jurnalı',
  settings: 'Parametrlər',
  logout: 'Çıxış',
  welcome: 'Xoş gəlmisiniz, {{name}}!',
  intro:
    'Taskop-un ilk mərhələsində təşkilatınızı, obyektləri, komandaları və əməkdaşları qura bilərsiniz. Yoxlama vərəqələri və tapşırıqlar növbəti mərhələlərdə əlavə olunacaq.',
} as const;
```

`packages/i18n/src/az/settings.ts`:
```ts
export default {
  title: 'Parametrlər',
  org: {
    title: 'Təşkilat',
    name: 'Təşkilatın adı',
    orgCode: 'Təşkilat kodu',
    orgCodeHint: 'Təşkilat kodu dəyişdirilə bilməz.',
    timezone: 'Saat qurşağı',
    locale: 'Dil',
    localeAz: 'Azərbaycan dili',
  },
  password: {
    title: 'Şifrəni dəyiş',
    current: 'Cari şifrə',
    next: 'Yeni şifrə',
    submit: 'Şifrəni dəyiş',
    changed: 'Şifrə dəyişdirildi. Digər cihazlardakı sessiyalar bağlandı.',
  },
} as const;
```
Register both in `packages/i18n/src/az/index.ts` (`import nav from './nav.js'; import settings from './settings.js';` and add `nav, settings` to the `az` object). Rebuild: `pnpm --filter @taskop/i18n build`.

- [ ] **Step 2: Write the failing test**

`apps/web/src/layouts/app-shell.test.tsx`:
```tsx
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';

const state: { current: { status: string; me?: unknown } } = { current: { status: 'authenticated' } };
const listeners = new Set<() => void>();
const me = (permissions: string[]) => ({
  user: { id: 'u', fullName: 'Elvin Əhmədov', jobTitle: null, kind: 'staff', email: 'e@a.az', username: null, emailVerified: true, credentialKind: 'password' },
  role: { id: 'r', name: 'Manager', systemKey: 'manager', dataScope: 'site_subtree' },
  permissions,
  tenant: { id: 't', name: 'Acme', orgCode: 'acme', timezone: 'Asia/Baku', locale: 'az' },
});

vi.mock('@/lib/session', () => ({
  useSession: () => state.current,
  useMe: () => state.current.me,
  useCan: (...keys: string[]) => keys.every((k) => (state.current.me as { permissions: string[] }).permissions.includes(k)),
  session: { signOut: vi.fn(), subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)), get: () => state.current },
  api: { auth: { resendVerification: vi.fn() } },
}));

const { AppShell } = await import('./app-shell');

function renderShell(path = '/users') {
  const root = createRootRoute();
  const shell = createRoute({ getParentRoute: () => root, id: 'app', component: AppShell });
  const page = createRoute({ getParentRoute: () => shell, path: '/users', component: () => <p>users page</p> });
  const login = createRoute({ getParentRoute: () => root, path: '/login', component: () => <p>login page</p> });
  const router = createRouter({ routeTree: root.addChildren([shell.addChildren([page]), login]), history: createMemoryHistory({ initialEntries: [path] }) });
  renderWithProviders(<RouterProvider router={router} />);
  return router;
}

describe('AppShell', () => {
  it('shows only the menu items the user may open', async () => {
    state.current = { status: 'authenticated', me: me(['users.view', 'sites.view']) };
    renderShell();
    expect(await screen.findByRole('link', { name: 'İstifadəçilər' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Obyektlər' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Rollar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Audit jurnalı' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Parametrlər' })).toBeInTheDocument();
  });

  it('AppShell redirects to login when the session ends', async () => {
    state.current = { status: 'authenticated', me: me([]) };
    const router = renderShell();
    await screen.findByText('users page');
    await act(async () => {
      state.current = { status: 'anonymous' };
      listeners.forEach((l) => l());
    });
    expect(await screen.findByText('login page')).toBeInTheDocument();
    expect(router.state.location.search).toMatchObject({ redirect: '/users' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @taskop/web test app-shell`
Expected: FAIL — `./app-shell` missing.

- [ ] **Step 4: Implement**

`apps/web/src/lib/format.ts`:
```ts
import { formatDateTime } from '@taskop/i18n';
import { useCallback } from 'react';
import { useMe } from './session';

export function useFormatDateTime(): (iso: string) => string {
  const { tenant } = useMe();
  return useCallback((iso: string) => formatDateTime(iso, { locale: tenant.locale, timeZone: tenant.timezone }), [tenant.locale, tenant.timezone]);
}
```

`apps/web/src/components/page-header.tsx`:
```tsx
import type { ReactNode } from 'react';

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
```

`apps/web/src/layouts/verify-email-banner.tsx`:
```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { errorText } from '@/lib/errors';
import { api, useMe } from '@/lib/session';

export function VerifyEmailBanner() {
  const { t } = useTranslation();
  const me = useMe();
  const [busy, setBusy] = useState(false);
  if (me.user.kind !== 'staff' || me.user.emailVerified) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-amber-50 px-6 py-2 text-sm text-amber-900">
      <span>{t('auth.verifyBanner.text')}</span>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.auth.resendVerification();
            toast.success(t('auth.verifyBanner.sent'));
          } catch (e) {
            toast.error(errorText(t, e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {t('auth.verifyBanner.resend')}
      </Button>
    </div>
  );
}
```

`apps/web/src/layouts/app-shell.tsx`:
```tsx
import type { PermissionKey } from '@taskop/contracts';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { Building2, ClipboardList, Home, LogOut, type LucideIcon, Settings, Shield, Users, UsersRound } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { session, useSession } from '@/lib/session';
import { VerifyEmailBanner } from './verify-email-banner';

export interface NavItem {
  to: '/' | '/users' | '/roles' | '/sites' | '/teams' | '/audit' | '/settings';
  labelKey: string;
  icon: LucideIcon;
  permission?: PermissionKey;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.home', icon: Home },
  { to: '/users', labelKey: 'nav.users', icon: Users, permission: 'users.view' },
  { to: '/roles', labelKey: 'nav.roles', icon: Shield, permission: 'roles.view' },
  { to: '/sites', labelKey: 'nav.sites', icon: Building2, permission: 'sites.view' },
  { to: '/teams', labelKey: 'nav.teams', icon: UsersRound, permission: 'teams.view' },
  { to: '/audit', labelKey: 'nav.audit', icon: ClipboardList, permission: 'audit.view' },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings },
];

export function AppShell() {
  const { t } = useTranslation();
  const s = useSession();
  const navigate = useNavigate();
  const href = useRouterState({ select: (r) => r.location.href });

  useEffect(() => {
    if (s.status === 'anonymous') void navigate({ to: '/login', search: { redirect: href } });
  }, [s.status, navigate, href]);

  if (s.status !== 'authenticated') return null;
  const { me } = s;
  const items = NAV_ITEMS.filter((i) => !i.permission || me.permissions.includes(i.permission));

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col bg-slate-900 text-slate-100">
        <div className="px-5 py-5">
          <Logo className="text-white" />
        </div>
        <nav className="grid gap-1 px-3">
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-slate-800"
              activeProps={{ className: 'bg-slate-800 font-medium' }}
              activeOptions={{ exact: item.to === '/' }}
            >
              <item.icon className="size-4" aria-hidden />
              {t(item.labelKey)}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b px-6 py-3">
          <span className="text-muted-foreground text-sm">{me.tenant.name}</span>
          <div className="flex items-center gap-3">
            <div className="text-right text-sm">
              <div className="font-medium">{me.user.fullName}</div>
              <div className="text-muted-foreground text-xs">{me.role.systemKey ? t(`roles.systemNames.${me.role.systemKey}`) : me.role.name}</div>
            </div>
            <Button variant="ghost" size="icon" aria-label={t('nav.logout')} onClick={() => void session.signOut()}>
              <LogOut className="size-4" />
            </Button>
          </div>
        </header>
        <VerifyEmailBanner />
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```
(`roles.systemNames.*` keys arrive in Task W6; until then i18next shows the key text, which is acceptable for one task.)

`apps/web/src/features/home/home-page.tsx`:
```tsx
import { useTranslation } from 'react-i18next';
import { useMe } from '@/lib/session';

export function HomePage() {
  const { t } = useTranslation();
  const me = useMe();
  return (
    <div className="grid max-w-2xl gap-3">
      <h1 className="text-2xl font-semibold">{t('nav.welcome', { name: me.user.fullName.split(' ')[0] })}</h1>
      <p className="text-muted-foreground">{t('nav.intro')}</p>
    </div>
  );
}
```

`apps/web/src/features/settings/org-settings-form.tsx`:
```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { type TenantDto, updateTenantInputSchema } from '@taskop/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FormError } from '@/components/form-error';
import { NativeSelect } from '@/components/native-select';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { applyFieldErrors, errorText } from '@/lib/errors';
import { api, session } from '@/lib/session';

const TIMEZONES = Intl.supportedValuesOf('timeZone');

export function OrgSettingsForm({ tenant, canEdit }: { tenant: TenantDto; canEdit: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof updateTenantInputSchema>, unknown, z.output<typeof updateTenantInputSchema>>({
    resolver: zodResolver(updateTenantInputSchema),
    defaultValues: { name: tenant.name, timezone: tenant.timezone },
  });
  const save = useMutation({
    mutationFn: api.tenant.update,
    onSuccess: async (updated) => {
      qc.setQueryData(['tenant'], updated);
      session.setMe(await api.me());
      toast.success(t('common.saved'));
    },
    onError: (e) => {
      if (!applyFieldErrors(form, e)) setError(errorText(t, e));
    },
  });
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid max-w-lg gap-4" noValidate>
      <fieldset disabled={!canEdit} className="grid gap-4">
        <TextField form={form} name="name" label={t('settings.org.name')} />
        <div className="grid gap-1.5">
          <Label htmlFor="orgCode">{t('settings.org.orgCode')}</Label>
          <Input id="orgCode" value={tenant.orgCode} readOnly disabled />
          <p className="text-muted-foreground text-xs">{t('settings.org.orgCodeHint')}</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="timezone">{t('settings.org.timezone')}</Label>
          <Controller
            control={form.control}
            name="timezone"
            render={({ field }) => (
              <NativeSelect id="timezone" {...field} value={field.value ?? ''}>
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </NativeSelect>
            )}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="locale">{t('settings.org.locale')}</Label>
          <Input id="locale" value={t('settings.org.localeAz')} readOnly disabled />
        </div>
      </fieldset>
      <FormError message={error} />
      {canEdit && (
        <Button type="submit" disabled={save.isPending}>
          {t('common.save')}
        </Button>
      )}
    </form>
  );
}
```

`apps/web/src/features/settings/change-password-form.tsx`:
```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { changeCredentialInputSchema } from '@taskop/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FormError } from '@/components/form-error';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { applyFieldErrors, errorText } from '@/lib/errors';
import { api } from '@/lib/session';

export function ChangePasswordForm() {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof changeCredentialInputSchema>>({
    resolver: zodResolver(changeCredentialInputSchema),
    defaultValues: { currentSecret: '', newSecret: '' },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api.auth.changeCredential(values);
      form.reset();
      toast.success(t('settings.password.changed'));
    } catch (e) {
      if (!applyFieldErrors(form, e)) setError(errorText(t, e));
    }
  });
  return (
    <form onSubmit={onSubmit} className="grid max-w-lg gap-4" noValidate>
      <TextField form={form} name="currentSecret" label={t('settings.password.current')} type="password" autoComplete="current-password" />
      <TextField form={form} name="newSecret" label={t('settings.password.next')} type="password" autoComplete="new-password" />
      <FormError message={error} />
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {t('settings.password.submit')}
      </Button>
    </form>
  );
}
```

`apps/web/src/features/settings/settings-page.tsx`:
```tsx
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, useCan } from '@/lib/session';
import { ChangePasswordForm } from './change-password-form';
import { OrgSettingsForm } from './org-settings-form';

export function SettingsPage() {
  const { t } = useTranslation();
  const canEdit = useCan('tenant.manage');
  const tenant = useQuery({ queryKey: ['tenant'], queryFn: api.tenant.get });
  return (
    <div className="grid gap-6">
      <PageHeader title={t('settings.title')} />
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.org.title')}</CardTitle>
        </CardHeader>
        <CardContent>{tenant.data ? <OrgSettingsForm tenant={tenant.data} canEdit={canEdit} /> : <p>{t('common.loading')}</p>}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.password.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
```

Modify `apps/web/src/router.tsx`:
- import `AppShell`, `HomePage`, `SettingsPage`;
- change `appLayout`'s `component: Outlet` to `component: AppShell`;
- replace `homeRoute` with `createRoute({ getParentRoute: () => appLayout, path: '/', component: HomePage })`;
- add `const settingsRoute = createRoute({ getParentRoute: () => appLayout, path: '/settings', component: SettingsPage });` and add it to `appLayout.addChildren([...])`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @taskop/web test && pnpm --filter @taskop/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web packages/i18n
git commit -m "feat(web): add permission-driven app shell, home and settings pages"
```

---

### Task W4: Sites — site types and the site tree editor

**Files:**
- Create: `apps/web/src/features/sites/queries.ts`, `tree.ts`, `site-types-panel.tsx`, `site-tree.tsx`, `site-form-dialog.tsx`, `move-site-dialog.tsx`, `sites-page.tsx`
- Create: `packages/i18n/src/az/sites.ts`; Modify: `packages/i18n/src/az/index.ts`
- Modify: `apps/web/src/router.tsx` (`/sites`)
- Test: `apps/web/src/features/sites/tree.test.ts`, `apps/web/src/features/sites/move-site-dialog.test.tsx`

**Interfaces:**
- Consumes: `api.siteTypes`, `api.sites`, `SiteDto`, `SiteTypeDto`.
- Produces:
  - `interface SiteNode extends SiteDto { children: SiteNode[] }`; `buildTree(sites: SiteDto[]): SiteNode[]` (sorted by name at each level); `moveTargets(sites: SiteDto[], siteId: string): SiteDto[]` (all sites except the site and its descendants, by `path` prefix).
  - Query keys: `['sites']`, `['site-types']`; hooks `useSites()`, `useSiteTypes()` (shared with Users in W7).
  - `MoveSiteDialog({ site, sites, open, onOpenChange, onMove(parentId: string | null) })`.
  - Route `/sites`.

- [ ] **Step 1: Translations**

`packages/i18n/src/az/sites.ts`:
```ts
export default {
  title: 'Obyektlər',
  types: {
    title: 'Obyekt növləri',
    add: 'Növ əlavə et',
    name: 'Növün adı',
    order: 'Sıra',
  },
  tree: {
    title: 'Obyekt strukturu',
    addRoot: 'Əsas obyekt əlavə et',
    addChild: 'Alt obyekt',
    move: 'Köçür',
    moveTitle: '«{{name}}» obyektini köçür',
    moveTarget: 'Yeni yer',
    root: '— Ən üst səviyyə —',
    empty: 'Hələ obyekt yoxdur.',
    expand: 'Aç',
    collapse: 'Bağla',
  },
  form: {
    createTitle: 'Yeni obyekt',
    editTitle: 'Obyekti redaktə et',
    name: 'Ad',
    type: 'Növ',
    address: 'Ünvan',
    parent: 'Yuxarı obyekt: {{name}}',
  },
} as const;
```
Register `sites` in `az/index.ts`; rebuild `@taskop/i18n`.

- [ ] **Step 2: Write the failing tests**

`apps/web/src/features/sites/tree.test.ts`:
```ts
import type { SiteDto } from '@taskop/contracts';
import { describe, expect, it } from 'vitest';
import { buildTree, moveTargets } from './tree';

const site = (id: string, path: string, name: string, parentId: string | null): SiteDto => ({
  id,
  path,
  name,
  parentId,
  typeId: 't',
  address: null,
  active: true,
  depth: path.split('.').length - 1,
});
const sites = [
  site('b', 'b', 'Bravo', null),
  site('a', 'a', 'Alfa', null),
  site('a1', 'a.a1', 'Zona 1', 'a'),
  site('a11', 'a.a1.a11', 'Bölmə', 'a1'),
  site('ab', 'ab', 'Alfa-B', null),
];

describe('buildTree', () => {
  it('nests children and sorts by name', () => {
    const tree = buildTree(sites);
    expect(tree.map((n) => n.name)).toEqual(['Alfa', 'Alfa-B', 'Bravo']);
    expect(tree[0]!.children[0]!.children[0]!.id).toBe('a11');
  });
});

describe('moveTargets', () => {
  it('move targets exclude the site and its descendants (but not path-prefix lookalikes)', () => {
    expect(moveTargets(sites, 'a').map((s) => s.id).sort()).toEqual(['ab', 'b']);
    expect(moveTargets(sites, 'a1').map((s) => s.id).sort()).toEqual(['a', 'ab', 'b']);
  });
});
```

`apps/web/src/features/sites/move-site-dialog.test.tsx`:
```tsx
import type { SiteDto } from '@taskop/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { MoveSiteDialog } from './move-site-dialog';

const s = (id: string, path: string, name: string): SiteDto => ({
  id, path, name, parentId: null, typeId: 't', address: null, active: true, depth: path.split('.').length - 1,
});
const sites = [s('a', 'a', 'Alfa'), s('a1', 'a.a1', 'Zona 1'), s('b', 'b', 'Bravo')];

describe('MoveSiteDialog', () => {
  it('offers only valid targets and submits the choice', async () => {
    const onMove = vi.fn();
    renderWithProviders(<MoveSiteDialog site={sites[0]!} sites={sites} open onOpenChange={vi.fn()} onMove={onMove} />);
    const select = screen.getByLabelText('Yeni yer');
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toEqual(['— Ən üst səviyyə —', 'Bravo']);
    await userEvent.selectOptions(select, 'b');
    await userEvent.click(screen.getByRole('button', { name: 'Köçür' }));
    expect(onMove).toHaveBeenCalledWith('b');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @taskop/web test sites`
Expected: FAIL — modules missing.

- [ ] **Step 4: Implement tree helpers and queries**

`apps/web/src/features/sites/tree.ts`:
```ts
import type { SiteDto } from '@taskop/contracts';

export interface SiteNode extends SiteDto {
  children: SiteNode[];
}

export function buildTree(sites: SiteDto[]): SiteNode[] {
  const nodes = new Map(sites.map((s) => [s.id, { ...s, children: [] as SiteNode[] }]));
  const roots: SiteNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const sort = (list: SiteNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name, 'az'));
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

export function moveTargets(sites: SiteDto[], siteId: string): SiteDto[] {
  const self = sites.find((s) => s.id === siteId);
  if (!self) return sites;
  return sites.filter((s) => s.path !== self.path && !s.path.startsWith(`${self.path}.`));
}

/** Indented label for flat <select> lists of sites. */
export const indentedName = (s: SiteDto) => `${'  '.repeat(s.depth)}${s.name}`;
```

`apps/web/src/features/sites/queries.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/session';

export const useSites = () => useQuery({ queryKey: ['sites'], queryFn: api.sites.list });
export const useSiteTypes = () => useQuery({ queryKey: ['site-types'], queryFn: api.siteTypes.list });
```

- [ ] **Step 5: Implement dialogs, panels and page**

`apps/web/src/features/sites/move-site-dialog.tsx`:
```tsx
import type { SiteDto } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { indentedName, moveTargets } from './tree';

interface Props {
  site: SiteDto;
  sites: SiteDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMove: (parentId: string | null) => void;
}

export function MoveSiteDialog({ site, sites, open, onOpenChange, onMove }: Props) {
  const { t } = useTranslation();
  const [target, setTarget] = useState(site.parentId ?? '');
  const options = moveTargets(sites, site.id);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('sites.tree.moveTitle', { name: site.name })}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="move-target">{t('sites.tree.moveTarget')}</Label>
          <NativeSelect id="move-target" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{t('sites.tree.root')}</option>
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {indentedName(s)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => onMove(target || null)}>{t('sites.tree.move')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

`apps/web/src/features/sites/site-form-dialog.tsx`:
```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import type { SiteDto, SiteTypeDto } from '@taskop/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { FormError } from '@/components/form-error';
import { NativeSelect } from '@/components/native-select';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { applyFieldErrors, errorText } from '@/lib/errors';

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  typeId: z.uuid(),
  address: z.string().trim().max(300),
});
export type SiteFormValues = z.output<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  types: SiteTypeDto[];
  site?: SiteDto;
  parent?: SiteDto | null;
  onSubmit: (values: SiteFormValues) => Promise<void>;
}

export function SiteFormDialog({ open, onOpenChange, types, site, parent, onSubmit }: Props) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const activeTypes = types.filter((ty) => ty.active || ty.id === site?.typeId);
  const form = useForm<z.input<typeof schema>, unknown, SiteFormValues>({
    resolver: zodResolver(schema),
    values: { name: site?.name ?? '', typeId: site?.typeId ?? activeTypes[0]?.id ?? '', address: site?.address ?? '' },
  });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await onSubmit(values);
      onOpenChange(false);
    } catch (e) {
      if (!applyFieldErrors(form, e)) setError(errorText(t, e));
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{site ? t('sites.form.editTitle') : t('sites.form.createTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          {parent && <p className="text-muted-foreground text-sm">{t('sites.form.parent', { name: parent.name })}</p>}
          <TextField form={form} name="name" label={t('sites.form.name')} />
          <div className="grid gap-1.5">
            <Label htmlFor="typeId">{t('sites.form.type')}</Label>
            <NativeSelect id="typeId" {...form.register('typeId')}>
              {activeTypes.map((ty) => (
                <option key={ty.id} value={ty.id}>
                  {ty.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <TextField form={form} name="address" label={t('sites.form.address')} />
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

`apps/web/src/features/sites/site-types-panel.tsx`:
```tsx
import type { SiteTypeDto } from '@taskop/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { errorText } from '@/lib/errors';
import { api } from '@/lib/session';

export function SiteTypesPanel({ types, canManage }: { types: SiteTypeDto[]; canManage: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['site-types'] });
  const onError = (e: unknown) => toast.error(errorText(t, e));
  const create = useMutation({
    mutationFn: () => api.siteTypes.create({ name, sortOrder: types.length }),
    onSuccess: () => {
      setName('');
      void refresh();
    },
    onError,
  });
  const toggle = useMutation({
    mutationFn: (ty: SiteTypeDto) => api.siteTypes.update(ty.id, { active: !ty.active }),
    onSuccess: () => void refresh(),
    onError,
  });
  return (
    <div className="grid gap-3">
      <ul className="grid gap-2">
        {types.map((ty) => (
          <li key={ty.id} className="flex items-center justify-between rounded-md border px-3 py-2">
            <span className={ty.active ? '' : 'text-muted-foreground line-through'}>{ty.name}</span>
            <div className="flex items-center gap-2">
              {!ty.active && <Badge variant="secondary">{t('common.inactive')}</Badge>}
              {canManage && (
                <Button size="sm" variant="ghost" onClick={() => toggle.mutate(ty)}>
                  {ty.active ? t('common.deactivate') : t('common.reactivate')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {canManage && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <Input aria-label={t('sites.types.name')} placeholder={t('sites.types.name')} value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" disabled={create.isPending}>
            {t('sites.types.add')}
          </Button>
        </form>
      )}
    </div>
  );
}
```

`apps/web/src/features/sites/site-tree.tsx`:
```tsx
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { SiteNode } from './tree';

interface Props {
  nodes: SiteNode[];
  typeName: (typeId: string) => string;
  canManage: boolean;
  onAddChild: (node: SiteNode) => void;
  onEdit: (node: SiteNode) => void;
  onMove: (node: SiteNode) => void;
  onToggleActive: (node: SiteNode) => void;
}

export function SiteTree(props: Props) {
  return (
    <ul role="tree" className="grid gap-1">
      {props.nodes.map((n) => (
        <SiteTreeItem key={n.id} node={n} {...props} />
      ))}
    </ul>
  );
}

function SiteTreeItem({ node, ...props }: Props & { node: SiteNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  return (
    <li role="treeitem" aria-expanded={hasChildren ? open : undefined}>
      <div className="hover:bg-muted/50 flex items-center gap-2 rounded-md px-2 py-1.5" style={{ paddingLeft: `${node.depth * 20 + 8}px` }}>
        <button
          type="button"
          className="text-muted-foreground size-5"
          aria-label={open ? t('sites.tree.collapse') : t('sites.tree.expand')}
          disabled={!hasChildren}
          onClick={() => setOpen((o) => !o)}
        >
          {hasChildren && (open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />)}
        </button>
        <span className={node.active ? 'font-medium' : 'text-muted-foreground line-through'}>{node.name}</span>
        <Badge variant="outline">{props.typeName(node.typeId)}</Badge>
        {!node.active && <Badge variant="secondary">{t('common.inactive')}</Badge>}
        {props.canManage && (
          <div className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => props.onAddChild(node)}>
              {t('sites.tree.addChild')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => props.onEdit(node)}>
              {t('common.edit')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => props.onMove(node)}>
              {t('sites.tree.move')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => props.onToggleActive(node)}>
              {node.active ? t('common.deactivate') : t('common.reactivate')}
            </Button>
          </div>
        )}
      </div>
      {hasChildren && open && (
        <ul role="group" className="grid gap-1">
          {node.children.map((c) => (
            <SiteTreeItem key={c.id} node={c} {...props} />
          ))}
        </ul>
      )}
    </li>
  );
}
```

`apps/web/src/features/sites/sites-page.tsx`:
```tsx
import type { SiteDto } from '@taskop/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { errorText } from '@/lib/errors';
import { api, useCan } from '@/lib/session';
import { MoveSiteDialog } from './move-site-dialog';
import { useSites, useSiteTypes } from './queries';
import { SiteFormDialog } from './site-form-dialog';
import { SiteTree } from './site-tree';
import { SiteTypesPanel } from './site-types-panel';
import { buildTree } from './tree';

type DialogState = { kind: 'create'; parent: SiteDto | null } | { kind: 'edit'; site: SiteDto } | { kind: 'move'; site: SiteDto } | null;

export function SitesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canManage = useCan('sites.manage');
  const sites = useSites();
  const types = useSiteTypes();
  const [dialog, setDialog] = useState<DialogState>(null);
  const tree = useMemo(() => buildTree(sites.data ?? []), [sites.data]);
  const typeName = (id: string) => types.data?.find((ty) => ty.id === id)?.name ?? '';
  const refresh = () => qc.invalidateQueries({ queryKey: ['sites'] });
  const close = () => setDialog(null);

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t('sites.title')}
        actions={canManage && <Button onClick={() => setDialog({ kind: 'create', parent: null })}>{t('sites.tree.addRoot')}</Button>}
      />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t('sites.tree.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {tree.length === 0 ? (
              <p className="text-muted-foreground">{sites.isLoading ? t('common.loading') : t('sites.tree.empty')}</p>
            ) : (
              <SiteTree
                nodes={tree}
                typeName={typeName}
                canManage={canManage}
                onAddChild={(n) => setDialog({ kind: 'create', parent: n })}
                onEdit={(n) => setDialog({ kind: 'edit', site: n })}
                onMove={(n) => setDialog({ kind: 'move', site: n })}
                onToggleActive={async (n) => {
                  try {
                    await api.sites.update(n.id, { active: !n.active });
                    await refresh();
                  } catch (e) {
                    toast.error(errorText(t, e));
                  }
                }}
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('sites.types.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <SiteTypesPanel types={types.data ?? []} canManage={canManage} />
          </CardContent>
        </Card>
      </div>

      {(dialog?.kind === 'create' || dialog?.kind === 'edit') && (
        <SiteFormDialog
          open
          onOpenChange={(o) => !o && close()}
          types={types.data ?? []}
          site={dialog.kind === 'edit' ? dialog.site : undefined}
          parent={dialog.kind === 'create' ? dialog.parent : undefined}
          onSubmit={async (v) => {
            const address = v.address || null;
            if (dialog.kind === 'edit') await api.sites.update(dialog.site.id, { name: v.name, typeId: v.typeId, address });
            else await api.sites.create({ parentId: dialog.parent?.id ?? null, typeId: v.typeId, name: v.name, address });
            await refresh();
          }}
        />
      )}
      {dialog?.kind === 'move' && (
        <MoveSiteDialog
          open
          site={dialog.site}
          sites={sites.data ?? []}
          onOpenChange={(o) => !o && close()}
          onMove={async (parentId) => {
            try {
              await api.sites.move(dialog.site.id, { parentId });
              await refresh();
              close();
            } catch (e) {
              toast.error(errorText(t, e));
            }
          }}
        />
      )}
    </div>
  );
}
```

Modify `apps/web/src/router.tsx`: import `SitesPage`; add `const sitesRoute = createRoute({ getParentRoute: () => appLayout, path: '/sites', component: SitesPage });` to `appLayout.addChildren`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @taskop/web test && pnpm --filter @taskop/web typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web packages/i18n
git commit -m "feat(web): add site types and site tree editor with safe moves"
```

---

### Task W5: Teams

**Files:**
- Create: `apps/web/src/components/checkbox-list.tsx`, `apps/web/src/features/teams/queries.ts`, `team-dialog.tsx`, `teams-page.tsx`
- Create: `packages/i18n/src/az/teams.ts`; Modify: `packages/i18n/src/az/index.ts`
- Modify: `apps/web/src/router.tsx` (`/teams`)
- Test: `apps/web/src/components/checkbox-list.test.tsx`

**Interfaces:**
- Produces:
  - `CheckboxList({ label, options: { value: string; label: string }[]; value: string[]; onChange(next: string[]); disabled? })` (reused for user sites/teams in W8).
  - `useTeams()` (query key `['teams']`), `useActiveUsers(enabled: boolean)` (query key `['users', 'active-all']`, first 200 active users).
  - Route `/teams`.

- [ ] **Step 1: Translations**

`packages/i18n/src/az/teams.ts`:
```ts
export default {
  title: 'Komandalar',
  add: 'Komanda yarat',
  name: 'Ad',
  description: 'Təsvir',
  members: 'Üzvlər',
  membersCount: '{{count}} üzv',
  empty: 'Hələ komanda yoxdur.',
  createTitle: 'Yeni komanda',
  editTitle: 'Komandanı redaktə et',
  searchMembers: 'Üzv axtar',
} as const;
```
Register `teams`; rebuild `@taskop/i18n`.

- [ ] **Step 2: Write the failing test**

`apps/web/src/components/checkbox-list.test.tsx`:
```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { CheckboxList } from './checkbox-list';

function Harness() {
  const [value, setValue] = useState<string[]>(['a']);
  return (
    <>
      <CheckboxList label="Üzvlər" options={[{ value: 'a', label: 'Alfa' }, { value: 'b', label: 'Bravo' }]} value={value} onChange={setValue} />
      <output>{value.join(',')}</output>
    </>
  );
}

describe('CheckboxList', () => {
  it('toggles values and filters by search', async () => {
    renderWithProviders(<Harness />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Bravo' }));
    expect(screen.getByRole('status')).toHaveTextContent('a,b');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Alfa' }));
    expect(screen.getByRole('status')).toHaveTextContent('b');
    await userEvent.type(screen.getByRole('searchbox'), 'alf');
    expect(screen.queryByRole('checkbox', { name: 'Bravo' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @taskop/web test checkbox-list`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement**

`apps/web/src/components/checkbox-list.tsx`:
```tsx
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

export function CheckboxList({ label, options, value, onChange, disabled }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [query, setQuery] = useState('');
  const visible = options.filter((o) => o.label.toLocaleLowerCase('az').includes(query.toLocaleLowerCase('az')));
  const toggle = (v: string, checked: boolean) => onChange(checked ? [...value, v] : value.filter((x) => x !== v));
  return (
    <fieldset className="grid gap-2" disabled={disabled}>
      <legend className="text-sm font-medium">{label}</legend>
      <Input type="search" placeholder={t('common.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="grid max-h-64 gap-2 overflow-y-auto rounded-md border p-3">
        {visible.length === 0 && <p className="text-muted-foreground text-sm">{t('common.noResults')}</p>}
        {visible.map((o) => (
          <div key={o.value} className="flex items-center gap-2">
            <Checkbox id={`${id}-${o.value}`} checked={value.includes(o.value)} onCheckedChange={(c) => toggle(o.value, c === true)} />
            <Label htmlFor={`${id}-${o.value}`} className="font-normal">
              {o.label}
            </Label>
          </div>
        ))}
      </div>
    </fieldset>
  );
}
```


`apps/web/src/features/teams/queries.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/session';

export const useTeams = () => useQuery({ queryKey: ['teams'], queryFn: api.teams.list });
export const useActiveUsers = (enabled: boolean) =>
  useQuery({
    queryKey: ['users', 'active-all'],
    queryFn: async () => (await api.users.list({ status: 'active', limit: 200 })).items,
    enabled,
  });
```

`apps/web/src/features/teams/team-dialog.tsx`:
```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import type { TeamDto, UserDto } from '@taskop/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { CheckboxList } from '@/components/checkbox-list';
import { FormError } from '@/components/form-error';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { applyFieldErrors, errorText } from '@/lib/errors';

const schema = z.object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(500) });
export type TeamFormValues = z.output<typeof schema> & { memberIds: string[] };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  team?: TeamDto;
  users: UserDto[];
  canEditMembers: boolean;
  onSubmit: (values: TeamFormValues) => Promise<void>;
}

export function TeamDialog({ open, onOpenChange, team, users, canEditMembers, onSubmit }: Props) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [memberIds, setMemberIds] = useState<string[]>(team?.memberIds ?? []);
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: team?.name ?? '', description: team?.description ?? '' },
  });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await onSubmit({ ...values, memberIds });
      onOpenChange(false);
    } catch (e) {
      if (!applyFieldErrors(form, e)) setError(errorText(t, e));
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{team ? t('teams.editTitle') : t('teams.createTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <TextField form={form} name="name" label={t('teams.name')} />
          <TextField form={form} name="description" label={t('teams.description')} />
          {canEditMembers && (
            <CheckboxList
              label={t('teams.members')}
              options={users.map((u) => ({ value: u.id, label: u.fullName }))}
              value={memberIds}
              onChange={setMemberIds}
            />
          )}
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

`apps/web/src/features/teams/teams-page.tsx`:
```tsx
import type { TeamDto } from '@taskop/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errorText } from '@/lib/errors';
import { api, useCan } from '@/lib/session';
import { useActiveUsers, useTeams } from './queries';
import { TeamDialog } from './team-dialog';

export function TeamsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canManage = useCan('teams.manage');
  const canSeeUsers = useCan('users.view');
  const teams = useTeams();
  const users = useActiveUsers(canSeeUsers);
  const [editing, setEditing] = useState<TeamDto | 'new' | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['teams'] });

  return (
    <div>
      <PageHeader title={t('teams.title')} actions={canManage && <Button onClick={() => setEditing('new')}>{t('teams.add')}</Button>} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('teams.name')}</TableHead>
            <TableHead>{t('teams.members')}</TableHead>
            <TableHead>{t('common.status')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(teams.data ?? []).map((team) => (
            <TableRow key={team.id}>
              <TableCell>
                <div className="font-medium">{team.name}</div>
                {team.description && <div className="text-muted-foreground text-xs">{team.description}</div>}
              </TableCell>
              <TableCell>{t('teams.membersCount', { count: team.memberIds.length })}</TableCell>
              <TableCell>
                <Badge variant={team.active ? 'default' : 'secondary'}>{team.active ? t('common.active') : t('common.inactive')}</Badge>
              </TableCell>
              <TableCell className="text-right">
                {canManage && (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(team)}>
                      {t('common.edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await api.teams.update(team.id, { active: !team.active });
                          await refresh();
                        } catch (e) {
                          toast.error(errorText(t, e));
                        }
                      }}
                    >
                      {team.active ? t('common.deactivate') : t('common.reactivate')}
                    </Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
          {teams.data?.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-muted-foreground text-center">
                {t('teams.empty')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {editing && (
        <TeamDialog
          open
          onOpenChange={(o) => !o && setEditing(null)}
          team={editing === 'new' ? undefined : editing}
          users={users.data ?? []}
          canEditMembers={canSeeUsers}
          onSubmit={async (v) => {
            const description = v.description || null;
            const team =
              editing === 'new'
                ? await api.teams.create({ name: v.name, description })
                : await api.teams.update(editing.id, { name: v.name, description });
            if (canSeeUsers) await api.teams.setMembers(team.id, v.memberIds);
            await refresh();
          }}
        />
      )}
    </div>
  );
}
```


Modify `apps/web/src/router.tsx`: add `/teams` → `TeamsPage`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @taskop/web test && pnpm --filter @taskop/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web packages/i18n
git commit -m "feat(web): add teams page with membership picker"
```

---

### Task W6: Roles and the permission grid

**Files:**
- Create: `apps/web/src/features/roles/queries.ts`, `permission-grid.tsx`, `role-editor.tsx`, `roles-page.tsx`
- Create: `packages/i18n/src/az/roles.ts`; Modify: `packages/i18n/src/az/index.ts`
- Modify: `apps/web/src/router.tsx` (`/roles`)
- Test: `apps/web/src/features/roles/permission-grid.test.tsx`

**Interfaces:**
- Produces:
  - `permissionLabelKey(key: PermissionKey): string` → `roles.keys.<key with '.' replaced by '_'>`.
  - `roleDisplayName(t, role: { name; systemKey })` (translates system roles).
  - `PermissionGrid({ catalog, value, onChange, held: ReadonlySet<PermissionKey>, disabled })`: keys the actor does not hold are disabled unless already granted (they can still be removed).
  - `useRoles()` (`['roles']`), `useCatalog()` (`['permissions']`).
  - Route `/roles`.

- [ ] **Step 1: Translations**

`packages/i18n/src/az/roles.ts`:
```ts
export default {
  title: 'Rollar',
  add: 'Rol yarat',
  name: 'Rolun adı',
  scope: 'Məlumat əhatəsi',
  permissions: 'İcazələr',
  users: '{{count}} istifadəçi',
  system: 'Sistem rolu',
  locked: 'Sahib rolu bütün icazələrə malikdir və dəyişdirilə bilməz.',
  createTitle: 'Yeni rol',
  select: 'Redaktə etmək üçün rol seçin.',
  systemNames: {
    owner: 'Sahib',
    admin: 'Administrator',
    manager: 'Menecer',
    worker: 'İşçi',
    auditor: 'Auditor',
  },
  scopes: {
    all: 'Bütün təşkilat',
    site_subtree: 'Öz obyektləri və onların alt obyektləri',
    subordinates: 'Tabeliyindəki əməkdaşlar',
    own: 'Yalnız özü',
  },
  groups: {
    tenant: 'Təşkilat',
    sites: 'Obyektlər',
    teams: 'Komandalar',
    users: 'İstifadəçilər',
    roles: 'Rollar',
    audit: 'Audit',
  },
  keys: {
    tenant_manage: 'Təşkilat parametrlərini idarə etmək',
    sites_view: 'Obyektlərə baxmaq',
    sites_manage: 'Obyektləri idarə etmək',
    teams_view: 'Komandalara baxmaq',
    teams_manage: 'Komandaları idarə etmək',
    users_view: 'İstifadəçilərə baxmaq',
    users_manage: 'İstifadəçiləri idarə etmək',
    roles_view: 'Rollara baxmaq',
    roles_manage: 'Rolları idarə etmək',
    audit_view: 'Audit jurnalına baxmaq',
  },
} as const;
```
Register `roles`; rebuild `@taskop/i18n`.

- [ ] **Step 2: Write the failing test**

`apps/web/src/features/roles/permission-grid.test.tsx`:
```tsx
import type { PermissionKey } from '@taskop/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { PermissionGrid } from './permission-grid';

const catalog = [
  { group: 'users', keys: ['users.view', 'users.manage'] as PermissionKey[] },
  { group: 'audit', keys: ['audit.view'] as PermissionKey[] },
];

describe('PermissionGrid', () => {
  it('toggles permissions', async () => {
    const onChange = vi.fn();
    renderWithProviders(<PermissionGrid catalog={catalog} value={['users.view']} onChange={onChange} held={new Set(['users.view', 'users.manage', 'audit.view'])} disabled={false} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'İstifadəçiləri idarə etmək' }));
    expect(onChange).toHaveBeenCalledWith(['users.view', 'users.manage']);
  });

  it('disables keys the actor does not hold, but still allows removing granted ones', () => {
    renderWithProviders(<PermissionGrid catalog={catalog} value={['users.manage']} onChange={vi.fn()} held={new Set(['users.view'])} disabled={false} />);
    expect(screen.getByRole('checkbox', { name: 'Audit jurnalına baxmaq' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'İstifadəçiləri idarə etmək' })).toBeEnabled();
  });

  it('disables everything for locked roles', () => {
    renderWithProviders(<PermissionGrid catalog={catalog} value={[]} onChange={vi.fn()} held={new Set(['users.view'])} disabled />);
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @taskop/web test permission-grid`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement**

`apps/web/src/features/roles/queries.ts`:
```ts
import type { PermissionKey, SystemRoleKey } from '@taskop/contracts';
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { api } from '@/lib/session';

export const useRoles = (enabled = true) => useQuery({ queryKey: ['roles'], queryFn: api.roles.list, enabled });
export const useCatalog = () => useQuery({ queryKey: ['permissions'], queryFn: api.roles.catalog, staleTime: Infinity });

export const permissionLabelKey = (key: PermissionKey) => `roles.keys.${key.replace('.', '_')}`;

export const roleDisplayName = (t: TFunction, role: { name: string; systemKey: SystemRoleKey | null }) =>
  role.systemKey ? t(`roles.systemNames.${role.systemKey}`) : role.name;
```

`apps/web/src/features/roles/permission-grid.tsx`:
```tsx
import type { PermissionCatalog, PermissionKey } from '@taskop/contracts';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { permissionLabelKey } from './queries';

interface Props {
  catalog: PermissionCatalog;
  value: PermissionKey[];
  onChange: (next: PermissionKey[]) => void;
  held: ReadonlySet<PermissionKey>;
  disabled: boolean;
}

export function PermissionGrid({ catalog, value, onChange, held, disabled }: Props) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {catalog.map((group) => (
        <fieldset key={group.group} className="grid gap-2 rounded-md border p-3">
          <legend className="px-1 text-sm font-semibold">{t(`roles.groups.${group.group}`)}</legend>
          {group.keys.map((key) => {
            const checked = value.includes(key);
            const cannotGrant = !held.has(key) && !checked;
            return (
              <div key={key} className="flex items-center gap-2">
                <Checkbox
                  id={`${id}-${key}`}
                  checked={checked}
                  disabled={disabled || cannotGrant}
                  onCheckedChange={(c) => onChange(c === true ? [...value, key] : value.filter((k) => k !== key))}
                />
                <Label htmlFor={`${id}-${key}`} className="font-normal">
                  {t(permissionLabelKey(key))}
                </Label>
              </div>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}
```

`apps/web/src/features/roles/role-editor.tsx`:
```tsx
import { DATA_SCOPES, type DataScope, type PermissionCatalog, type PermissionKey, type RoleDto } from '@taskop/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/form-error';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorText } from '@/lib/errors';
import { PermissionGrid } from './permission-grid';
import { roleDisplayName } from './queries';

export interface RoleDraft {
  name: string;
  dataScope: DataScope;
  permissions: PermissionKey[];
}

interface Props {
  role: RoleDto | null;
  catalog: PermissionCatalog;
  held: ReadonlySet<PermissionKey>;
  canManage: boolean;
  onSave: (draft: RoleDraft) => Promise<void>;
  onToggleActive?: () => Promise<void>;
}

export function RoleEditor({ role, catalog, held, canManage, onSave, onToggleActive }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<RoleDraft>({ name: '', dataScope: 'own', permissions: [] });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft(role ? { name: role.name, dataScope: role.dataScope, permissions: role.permissions } : { name: '', dataScope: 'own', permissions: [] });
    setError(null);
  }, [role]);
  const locked = !canManage || (role !== null && !role.editable);
  const nameLocked = locked || role?.systemKey != null;

  return (
    <div className="grid gap-4">
      {role && !role.editable && <p className="text-muted-foreground text-sm">{t('roles.locked')}</p>}
      <div className="grid gap-1.5">
        <Label htmlFor="role-name">{t('roles.name')}</Label>
        <Input
          id="role-name"
          value={role?.systemKey ? roleDisplayName(t, role) : draft.name}
          disabled={nameLocked}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="role-scope">{t('roles.scope')}</Label>
        <NativeSelect id="role-scope" value={draft.dataScope} disabled={locked} onChange={(e) => setDraft({ ...draft, dataScope: e.target.value as DataScope })}>
          {DATA_SCOPES.map((s) => (
            <option key={s} value={s}>
              {t(`roles.scopes.${s}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-2">
        <span className="text-sm font-medium">{t('roles.permissions')}</span>
        <PermissionGrid catalog={catalog} value={draft.permissions} onChange={(permissions) => setDraft({ ...draft, permissions })} held={held} disabled={locked} />
      </div>
      <FormError message={error} />
      {!locked && (
        <div className="flex gap-2">
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                await onSave(draft);
              } catch (e) {
                setError(errorText(t, e));
              } finally {
                setSaving(false);
              }
            }}
          >
            {t('common.save')}
          </Button>
          {role && !role.systemKey && onToggleActive && (
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await onToggleActive();
                } catch (e) {
                  setError(errorText(t, e));
                }
              }}
            >
              {role.active ? t('common.deactivate') : t('common.reactivate')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
```

`apps/web/src/features/roles/roles-page.tsx`:
```tsx
import type { RoleDto } from '@taskop/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, useCan, useMe } from '@/lib/session';
import { useCatalog, useRoles, roleDisplayName } from './queries';
import { RoleEditor } from './role-editor';

export function RolesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useMe();
  const canManage = useCan('roles.manage');
  const roles = useRoles();
  const catalog = useCatalog();
  const [selected, setSelected] = useState<RoleDto | 'new' | null>(null);
  const held = new Set(me.permissions);
  const refresh = async () => {
    const list = await qc.fetchQuery({ queryKey: ['roles'], queryFn: api.roles.list, staleTime: 0 });
    if (selected && selected !== 'new') setSelected(list.find((r) => r.id === selected.id) ?? null);
    return list;
  };

  return (
    <div>
      <PageHeader title={t('roles.title')} actions={canManage && <Button onClick={() => setSelected('new')}>{t('roles.add')}</Button>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <Card>
          <CardContent className="grid gap-1 p-2">
            {(roles.data ?? []).map((role) => (
              <button
                key={role.id}
                type="button"
                onClick={() => setSelected(role)}
                className={`hover:bg-muted flex items-center justify-between rounded-md px-3 py-2 text-left ${selected !== 'new' && selected?.id === role.id ? 'bg-muted' : ''}`}
              >
                <span className={role.active ? '' : 'text-muted-foreground line-through'}>{roleDisplayName(t, role)}</span>
                <span className="flex items-center gap-2">
                  {role.systemKey && <Badge variant="outline">{t('roles.system')}</Badge>}
                  <span className="text-muted-foreground text-xs">{t('roles.users', { count: role.userCount })}</span>
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{selected === 'new' ? t('roles.createTitle') : selected ? roleDisplayName(t, selected) : t('roles.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {!selected || !catalog.data ? (
              <p className="text-muted-foreground">{t('roles.select')}</p>
            ) : (
              <RoleEditor
                role={selected === 'new' ? null : selected}
                catalog={catalog.data}
                held={held}
                canManage={canManage}
                onSave={async (draft) => {
                  if (selected === 'new') {
                    const created = await api.roles.create(draft);
                    await refresh();
                    setSelected(created);
                  } else {
                    if (!selected.systemKey && draft.name !== selected.name) await api.roles.update(selected.id, { name: draft.name });
                    if (draft.dataScope !== selected.dataScope) await api.roles.update(selected.id, { dataScope: draft.dataScope });
                    await api.roles.setPermissions(selected.id, draft.permissions);
                    await refresh();
                  }
                  toast.success(t('common.saved'));
                }}
                onToggleActive={
                  selected !== 'new'
                    ? async () => {
                        await api.roles.update(selected.id, { active: !selected.active });
                        await refresh();
                      }
                    : undefined
                }
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

Modify `apps/web/src/router.tsx`: add `/roles` → `RolesPage`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @taskop/web test && pnpm --filter @taskop/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web packages/i18n
git commit -m "feat(web): add roles page with permission grid and escalation-aware editing"
```

---

### Task W7: Users list, create worker, invite staff

**Files:**
- Create: `apps/web/src/features/users/queries.ts`, `user-labels.ts`, `secret-dialog.tsx`, `create-worker-dialog.tsx`, `invite-staff-dialog.tsx`, `users-page.tsx`
- Create: `packages/i18n/src/az/users.ts`; Modify: `packages/i18n/src/az/index.ts`
- Modify: `apps/web/src/router.tsx` (`/users`)
- Test: `apps/web/src/features/users/create-worker-dialog.test.tsx`

**Interfaces:**
- Consumes: `useRoles`, `roleDisplayName`, `useSites`, `indentedName`, `useTeams`, `useActiveUsers`, `CheckboxList`.
- Produces:
  - `useUsersInfinite(filters)` (query key `['users', 'list', filters]`), `useUser(id)` (`['users', id]`).
  - `statusVariant(status)`, `loginLabel(user)` in `user-labels.ts`.
  - `SecretBlock({ orgCode, username, secret })` (used by the create dialog and by W8's reset flow).
  - `CreateWorkerDialog({ open, onOpenChange, orgCode, onCreated })` — after success it switches to a "credentials" view showing the generated PIN once.
  - `InviteStaffDialog({ open, onOpenChange, onInvited })`.
  - Route `/users`.

- [ ] **Step 1: Translations**

`packages/i18n/src/az/users.ts`:
```ts
export default {
  title: 'İstifadəçilər',
  newWorker: 'Yeni işçi',
  invite: 'Əməkdaşı dəvət et',
  search: 'Ad, istifadəçi adı və ya e-poçt',
  kinds: { worker: 'İşçi (mobil)', staff: 'Əməkdaş (web)' },
  statuses: { active: 'Aktiv', deactivated: 'Deaktiv', invited: 'Dəvət göndərilib' },
  columns: { name: 'Ad', login: 'Giriş', role: 'Rol', status: 'Status', lastLogin: 'Son giriş' },
  never: 'Heç vaxt',
  empty: 'İstifadəçi tapılmadı.',
  form: {
    fullName: 'Ad və soyad',
    username: 'İstifadəçi adı',
    usernameHint: 'Latın hərfləri, rəqəmlər, nöqtə, alt xətt və tire. Məsələn: elvin.m',
    email: 'E-poçt',
    jobTitle: 'Vəzifə',
    phone: 'Telefon',
    role: 'Rol',
    manager: 'Birbaşa rəhbər',
    noManager: '— Rəhbər yoxdur —',
    credentialKind: 'Giriş üsulu',
    pin: 'PIN (6 rəqəm)',
    password: 'Şifrə',
    secret: 'PIN / şifrə',
    secretHint: 'Boş saxlasanız, sistem avtomatik yaradacaq.',
    sites: 'Obyektlər',
    teams: 'Komandalar',
  },
  createWorkerTitle: 'Yeni işçi',
  inviteTitle: 'Əməkdaşı dəvət et',
  inviteSent: 'Dəvət məktubu göndərildi.',
  secret: {
    title: 'Giriş məlumatları',
    body: 'Bu məlumatları işçiyə təhvil verin. PIN/şifrə yalnız indi göstərilir.',
    orgCode: 'Təşkilat kodu',
    username: 'İstifadəçi adı',
    secret: 'PIN / şifrə',
    done: 'Hazırdır',
  },
  detail: {
    profile: 'Profil',
    assignments: 'Təyinatlar',
    access: 'Giriş və status',
    deactivate: 'Deaktiv et',
    reactivate: 'Aktiv et',
    confirmDeactivate: '{{name}} deaktiv edilsin? Bütün aktiv sessiyaları bağlanacaq.',
    resetCredential: 'PIN/şifrəni sıfırla',
    confirmReset: '{{name}} üçün yeni giriş məlumatı yaradılsın? Köhnə PIN/şifrə işləməyəcək.',
    resetStaffSent: 'Şifrə bərpası keçidi e-poçta göndərildi.',
    saveAssignments: 'Təyinatları yadda saxla',
    you: 'Bu sizin hesabınızdır.',
  },
} as const;
```
Register `users`; rebuild `@taskop/i18n`.

- [ ] **Step 2: Write the failing test**

`apps/web/src/features/users/create-worker-dialog.test.tsx`:
```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';

const roleId = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f';
const createWorker = vi.fn();
vi.mock('@/lib/session', () => ({
  api: { users: { createWorker: (...a: unknown[]) => createWorker(...a) } },
  useCan: () => true,
}));
vi.mock('@/features/roles/queries', () => ({
  useRoles: () => ({ data: [{ id: roleId, name: 'Worker', systemKey: 'worker', active: true, permissions: [], dataScope: 'own', editable: true, userCount: 0 }] }),
  roleDisplayName: (_t: unknown, r: { name: string }) => r.name,
}));
vi.mock('@/features/sites/queries', () => ({ useSites: () => ({ data: [] }) }));
vi.mock('@/features/teams/queries', () => ({ useTeams: () => ({ data: [] }), useActiveUsers: () => ({ data: [] }) }));

const { CreateWorkerDialog } = await import('./create-worker-dialog');

describe('CreateWorkerDialog', () => {
  beforeEach(() => createWorker.mockReset());

  it('creates a worker and shows the generated PIN once', async () => {
    createWorker.mockResolvedValue({ user: { id: 'u1', username: 'elvin.m' }, generatedSecret: '730184' });
    const onCreated = vi.fn();
    renderWithProviders(<CreateWorkerDialog open onOpenChange={vi.fn()} orgCode="acme" onCreated={onCreated} />);
    await userEvent.type(screen.getByLabelText('Ad və soyad'), 'Elvin Məmmədov');
    await userEvent.type(screen.getByLabelText('İstifadəçi adı'), 'Elvin.M');
    await userEvent.click(screen.getByRole('button', { name: 'Yarat' }));

    expect(createWorker).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: 'Elvin Məmmədov', username: 'elvin.m', roleId, credentialKind: 'pin', siteIds: [], teamIds: [] }),
    );
    expect(createWorker.mock.calls[0]![0]).not.toHaveProperty('secret');
    expect(await screen.findByText('730184')).toBeInTheDocument();
    expect(screen.getByText('acme')).toBeInTheDocument();
    expect(onCreated).toHaveBeenCalled();
  });

  it('maps API field errors onto inputs', async () => {
    const { ApiError } = await import('@taskop/api-client');
    createWorker.mockRejectedValue(new ApiError(409, 'USERNAME_TAKEN', 'errors.USERNAME_TAKEN', { username: 'errors.USERNAME_TAKEN' }));
    renderWithProviders(<CreateWorkerDialog open onOpenChange={vi.fn()} orgCode="acme" onCreated={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Ad və soyad'), 'Elvin Məmmədov');
    await userEvent.type(screen.getByLabelText('İstifadəçi adı'), 'elvin');
    await userEvent.click(screen.getByRole('button', { name: 'Yarat' }));
    expect(await screen.findByText('Bu istifadəçi adı artıq mövcuddur.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @taskop/web test create-worker`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement queries, labels, secret block**

`apps/web/src/features/users/queries.ts`:
```ts
import type { UserListQuery } from '@taskop/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/session';

export type UserFilters = Pick<UserListQuery, 'q' | 'status' | 'roleId' | 'kind'>;

export const useUsersInfinite = (filters: UserFilters) =>
  useInfiniteQuery({
    queryKey: ['users', 'list', filters],
    queryFn: ({ pageParam }) => api.users.list({ ...filters, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const useUser = (id: string) => useQuery({ queryKey: ['users', id], queryFn: () => api.users.get(id) });
```

`apps/web/src/features/users/user-labels.ts`:
```ts
import type { UserDto } from '@taskop/contracts';

export const statusVariant = (status: UserDto['status']) =>
  status === 'active' ? ('default' as const) : status === 'invited' ? ('outline' as const) : ('secondary' as const);

export const loginLabel = (u: Pick<UserDto, 'username' | 'email'>) => u.username ?? u.email ?? '—';
```

`apps/web/src/features/users/secret-dialog.tsx`:
```tsx
import { Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function SecretBlock({ orgCode, username, secret }: { orgCode: string; username: string; secret: string }) {
  const { t } = useTranslation();
  const rows: [string, string][] = [
    [t('users.secret.orgCode'), orgCode],
    [t('users.secret.username'), username],
    [t('users.secret.secret'), secret],
  ];
  return (
    <div className="grid gap-3">
      <p className="text-muted-foreground text-sm">{t('users.secret.body')}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-md border p-4 font-mono text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground font-sans">{label}</dt>
            <dd className="font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <Button
        type="button"
        variant="outline"
        onClick={async () => {
          await navigator.clipboard.writeText(rows.map(([l, v]) => `${l}: ${v}`).join('\n'));
          toast.success(t('common.copied'));
        }}
      >
        <Copy className="size-4" /> {t('common.copy')}
      </Button>
    </div>
  );
}
```

- [ ] **Step 5: Implement the dialogs**

`apps/web/src/features/users/create-worker-dialog.tsx`:
```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { createWorkerInputSchema, type UserWithSecret } from '@taskop/contracts';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { CheckboxList } from '@/components/checkbox-list';
import { FormError } from '@/components/form-error';
import { NativeSelect } from '@/components/native-select';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { roleDisplayName, useRoles } from '@/features/roles/queries';
import { useSites } from '@/features/sites/queries';
import { indentedName } from '@/features/sites/tree';
import { useActiveUsers, useTeams } from '@/features/teams/queries';
import { applyFieldErrors, errorText } from '@/lib/errors';
import { api, useCan } from '@/lib/session';
import { SecretBlock } from './secret-dialog';

type In = z.input<typeof createWorkerInputSchema>;
type Out = z.output<typeof createWorkerInputSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgCode: string;
  onCreated: (result: UserWithSecret) => void;
}

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);
const emptyToNull = (v: unknown) => (v === '' ? null : v);

export function CreateWorkerDialog({ open, onOpenChange, orgCode, onCreated }: Props) {
  const { t } = useTranslation();
  const canSeeSites = useCan('sites.view');
  const canSeeTeams = useCan('teams.view');
  const roles = useRoles();
  const sites = useSites();
  const teams = useTeams();
  const managers = useActiveUsers(true);
  const activeRoles = (roles.data ?? []).filter((r) => r.active && r.systemKey !== 'owner');
  const defaultRole = activeRoles.find((r) => r.systemKey === 'worker') ?? activeRoles[0];
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ username: string; secret: string } | null>(null);
  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(createWorkerInputSchema),
    values: {
      fullName: '',
      username: '',
      roleId: defaultRole?.id ?? '',
      credentialKind: 'pin',
      siteIds: [],
      teamIds: [],
      jobTitle: null,
      phone: null,
      managerId: null,
    },
    resetOptions: { keepDirtyValues: true },
  });
  const kind = form.watch('credentialKind');

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const result = await api.users.createWorker(values);
      onCreated(result);
      setCreated({ username: result.user.username ?? values.username, secret: result.generatedSecret ?? values.secret ?? '' });
    } catch (e) {
      if (!applyFieldErrors(form, e)) setError(errorText(t, e));
    }
  });

  const close = (o: boolean) => {
    if (!o) {
      setCreated(null);
      form.reset();
    }
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{created ? t('users.secret.title') : t('users.createWorkerTitle')}</DialogTitle>
        </DialogHeader>
        {created ? (
          <>
            <SecretBlock orgCode={orgCode} username={created.username} secret={created.secret} />
            <DialogFooter>
              <Button onClick={() => close(false)}>{t('users.secret.done')}</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField form={form} name="fullName" label={t('users.form.fullName')} />
              <TextField form={form} name="username" label={t('users.form.username')} description={t('users.form.usernameHint')} />
              <div className="grid gap-1.5">
                <Label htmlFor="jobTitle">{t('users.form.jobTitle')}</Label>
                <input id="jobTitle" className="border-input h-9 rounded-md border px-3 text-sm" {...form.register('jobTitle', { setValueAs: emptyToNull })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="phone">{t('users.form.phone')}</Label>
                <input id="phone" type="tel" className="border-input h-9 rounded-md border px-3 text-sm" {...form.register('phone', { setValueAs: emptyToNull })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="roleId">{t('users.form.role')}</Label>
                <NativeSelect id="roleId" {...form.register('roleId')}>
                  {activeRoles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {roleDisplayName(t, r)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="managerId">{t('users.form.manager')}</Label>
                <NativeSelect id="managerId" {...form.register('managerId', { setValueAs: emptyToNull })}>
                  <option value="">{t('users.form.noManager')}</option>
                  {(managers.data ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="credentialKind">{t('users.form.credentialKind')}</Label>
                <NativeSelect id="credentialKind" {...form.register('credentialKind')}>
                  <option value="pin">{t('users.form.pin')}</option>
                  <option value="password">{t('users.form.password')}</option>
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="secret">{t('users.form.secret')}</Label>
                <input
                  id="secret"
                  className="border-input h-9 rounded-md border px-3 text-sm"
                  inputMode={kind === 'pin' ? 'numeric' : 'text'}
                  autoComplete="off"
                  {...form.register('secret', { setValueAs: emptyToUndefined })}
                />
                {form.formState.errors.secret?.message ? (
                  <p className="text-destructive text-sm">{t(form.formState.errors.secret.message)}</p>
                ) : (
                  <p className="text-muted-foreground text-xs">{t('users.form.secretHint')}</p>
                )}
              </div>
            </div>
            {canSeeSites && (
              <Controller
                control={form.control}
                name="siteIds"
                render={({ field }) => (
                  <CheckboxList
                    label={t('users.form.sites')}
                    options={(sites.data ?? []).filter((s) => s.active).map((s) => ({ value: s.id, label: indentedName(s) }))}
                    value={field.value ?? []}
                    onChange={field.onChange}
                  />
                )}
              />
            )}
            {canSeeTeams && (
              <Controller
                control={form.control}
                name="teamIds"
                render={({ field }) => (
                  <CheckboxList
                    label={t('users.form.teams')}
                    options={(teams.data ?? []).filter((tm) => tm.active).map((tm) => ({ value: tm.id, label: tm.name }))}
                    value={field.value ?? []}
                    onChange={field.onChange}
                  />
                )}
              />
            )}
            <FormError message={error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {t('common.create')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

`apps/web/src/features/users/invite-staff-dialog.tsx`:
```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { inviteStaffInputSchema } from '@taskop/contracts';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { z } from 'zod';
import { CheckboxList } from '@/components/checkbox-list';
import { FormError } from '@/components/form-error';
import { NativeSelect } from '@/components/native-select';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { roleDisplayName, useRoles } from '@/features/roles/queries';
import { useSites } from '@/features/sites/queries';
import { indentedName } from '@/features/sites/tree';
import { applyFieldErrors, errorText } from '@/lib/errors';
import { api, useCan, useMe } from '@/lib/session';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited: () => void;
}

export function InviteStaffDialog({ open, onOpenChange, onInvited }: Props) {
  const { t } = useTranslation();
  const me = useMe();
  const canSeeSites = useCan('sites.view');
  const roles = useRoles();
  const sites = useSites();
  const assignable = (roles.data ?? []).filter((r) => r.active && (r.systemKey !== 'owner' || me.role.systemKey === 'owner'));
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof inviteStaffInputSchema>, unknown, z.output<typeof inviteStaffInputSchema>>({
    resolver: zodResolver(inviteStaffInputSchema),
    values: {
      fullName: '',
      email: '',
      roleId: assignable.find((r) => r.systemKey === 'manager')?.id ?? assignable[0]?.id ?? '',
      siteIds: [],
      teamIds: [],
      jobTitle: null,
      phone: null,
      managerId: null,
    },
    resetOptions: { keepDirtyValues: true },
  });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api.users.invite(values);
      toast.success(t('users.inviteSent'));
      onInvited();
      form.reset();
      onOpenChange(false);
    } catch (e) {
      if (!applyFieldErrors(form, e)) setError(errorText(t, e));
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('users.inviteTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <TextField form={form} name="fullName" label={t('users.form.fullName')} />
          <TextField form={form} name="email" label={t('users.form.email')} type="email" />
          <div className="grid gap-1.5">
            <Label htmlFor="invite-role">{t('users.form.role')}</Label>
            <NativeSelect id="invite-role" {...form.register('roleId')}>
              {assignable.map((r) => (
                <option key={r.id} value={r.id}>
                  {roleDisplayName(t, r)}
                </option>
              ))}
            </NativeSelect>
          </div>
          {canSeeSites && (
            <Controller
              control={form.control}
              name="siteIds"
              render={({ field }) => (
                <CheckboxList
                  label={t('users.form.sites')}
                  options={(sites.data ?? []).filter((s) => s.active).map((s) => ({ value: s.id, label: indentedName(s) }))}
                  value={field.value ?? []}
                  onChange={field.onChange}
                />
              )}
            />
          )}
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t('users.invite')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: Implement the users page**

`apps/web/src/features/users/users-page.tsx`:
```tsx
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { roleDisplayName, useRoles } from '@/features/roles/queries';
import { useFormatDateTime } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';
import { CreateWorkerDialog } from './create-worker-dialog';
import { InviteStaffDialog } from './invite-staff-dialog';
import { type UserFilters, useUsersInfinite } from './queries';
import { loginLabel, statusVariant } from './user-labels';

export function UsersPage() {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canManage = useCan('users.manage');
  const canSeeRoles = useCan('roles.view');
  const formatDateTime = useFormatDateTime();
  const roles = useRoles(canSeeRoles);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<UserFilters['status']>(undefined);
  const [roleId, setRoleId] = useState<string | undefined>(undefined);
  const q = useDeferredValue(search.trim());
  const users = useUsersInfinite({ q: q || undefined, status, roleId });
  const [dialog, setDialog] = useState<'worker' | 'invite' | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });
  const rows = users.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div>
      <PageHeader
        title={t('users.title')}
        actions={
          canManage && (
            <>
              <Button variant="outline" onClick={() => setDialog('invite')}>
                {t('users.invite')}
              </Button>
              <Button onClick={() => setDialog('worker')}>{t('users.newWorker')}</Button>
            </>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input type="search" className="max-w-sm" placeholder={t('users.search')} aria-label={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <NativeSelect className="w-48" aria-label={t('users.columns.status')} value={status ?? ''} onChange={(e) => setStatus((e.target.value || undefined) as UserFilters['status'])}>
          <option value="">{t('common.all')}</option>
          {(['active', 'invited', 'deactivated'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`users.statuses.${s}`)}
            </option>
          ))}
        </NativeSelect>
        {canSeeRoles && (
          <NativeSelect className="w-56" aria-label={t('users.columns.role')} value={roleId ?? ''} onChange={(e) => setRoleId(e.target.value || undefined)}>
            <option value="">{t('common.all')}</option>
            {(roles.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {roleDisplayName(t, r)}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('users.columns.name')}</TableHead>
            <TableHead>{t('users.columns.login')}</TableHead>
            <TableHead>{t('users.columns.role')}</TableHead>
            <TableHead>{t('users.columns.status')}</TableHead>
            <TableHead>{t('users.columns.lastLogin')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((u) => (
            <TableRow key={u.id} className="cursor-pointer" onClick={() => void navigate({ to: '/users/$userId', params: { userId: u.id } })}>
              <TableCell>
                <div className="font-medium">{u.fullName}</div>
                <div className="text-muted-foreground text-xs">{u.jobTitle ?? t(`users.kinds.${u.kind}`)}</div>
              </TableCell>
              <TableCell className="font-mono text-sm">{loginLabel(u)}</TableCell>
              <TableCell>{roleDisplayName(t, { name: u.role.name, systemKey: u.role.systemKey })}</TableCell>
              <TableCell>
                <Badge variant={statusVariant(u.status)}>{t(`users.statuses.${u.status}`)}</Badge>
              </TableCell>
              <TableCell className="text-sm">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : t('users.never')}</TableCell>
            </TableRow>
          ))}
          {!users.isLoading && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground text-center">
                {t('users.empty')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {users.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" disabled={users.isFetchingNextPage} onClick={() => void users.fetchNextPage()}>
            {t('common.loadMore')}
          </Button>
        </div>
      )}
      <CreateWorkerDialog open={dialog === 'worker'} onOpenChange={(o) => setDialog(o ? 'worker' : null)} orgCode={me.tenant.orgCode} onCreated={() => void refresh()} />
      <InviteStaffDialog open={dialog === 'invite'} onOpenChange={(o) => setDialog(o ? 'invite' : null)} onInvited={() => void refresh()} />
    </div>
  );
}
```

Modify `apps/web/src/router.tsx`: add `/users` → `UsersPage`, and register the detail route the row click navigates to, with a placeholder component that W8 replaces:
```tsx
const userDetailRoute = createRoute({ getParentRoute: () => appLayout, path: '/users/$userId', component: () => null });
```
Add both routes to `appLayout.addChildren([...])`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @taskop/web test`
Expected: PASS. Also run `pnpm --filter @taskop/web typecheck` — clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web packages/i18n
git commit -m "feat(web): add users list with filters, worker creation with one-time PIN and staff invites"
```

---

### Task W8: User detail — profile, assignments, status, credential reset

**Files:**
- Create: `apps/web/src/components/confirm-button.tsx`
- Create: `apps/web/src/features/users/user-detail-page.tsx`, `user-profile-form.tsx`, `user-assignments.tsx`, `user-access-card.tsx`
- Modify: `apps/web/src/router.tsx` (`/users/$userId`)
- Test: `apps/web/src/features/users/user-access-card.test.tsx`

**Interfaces:**
- Produces:
  - `ConfirmButton({ label, title, description, onConfirm, variant?, disabled? })` (dialog-based confirmation; reused in W10).
  - `UserAccessCard({ user, orgCode, isSelf, canManage, onChanged })`: deactivate/reactivate with confirmation; reset credential (workers: shows `SecretBlock`; staff: toast).
  - Route `/users/$userId`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/users/user-access-card.test.tsx`:
```tsx
import type { UserDto } from '@taskop/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';

const resetCredential = vi.fn();
const deactivate = vi.fn();
vi.mock('@/lib/session', () => ({
  api: { users: { resetCredential: (...a: unknown[]) => resetCredential(...a), deactivate: (...a: unknown[]) => deactivate(...a), reactivate: vi.fn() } },
}));
const { UserAccessCard } = await import('./user-access-card');

const worker: UserDto = {
  id: 'u1', fullName: 'Elvin Məmmədov', jobTitle: null, kind: 'worker', email: null, username: 'elvin', phone: null, status: 'active',
  credentialKind: 'pin', role: { id: 'r', name: 'Worker', systemKey: 'worker' }, managerId: null, managerName: null, siteIds: [], teamIds: [],
  lastLoginAt: null, createdAt: '2026-10-07T10:00:00.000Z',
};

describe('UserAccessCard', () => {
  beforeEach(() => {
    resetCredential.mockReset();
    deactivate.mockReset();
  });

  it('resets a worker PIN after confirmation and shows it once', async () => {
    resetCredential.mockResolvedValue({ user: worker, generatedSecret: '730184' });
    renderWithProviders(<UserAccessCard user={worker} orgCode="acme" isSelf={false} canManage onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'PIN/şifrəni sıfırla' }));
    await userEvent.click(screen.getByRole('button', { name: 'Təsdiqlə' }));
    expect(resetCredential).toHaveBeenCalledWith('u1', {});
    expect(await screen.findByText('730184')).toBeInTheDocument();
  });

  it('asks before deactivating', async () => {
    deactivate.mockResolvedValue({ ...worker, status: 'deactivated' });
    const onChanged = vi.fn();
    renderWithProviders(<UserAccessCard user={worker} orgCode="acme" isSelf={false} canManage onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('button', { name: 'Deaktiv et' }));
    expect(screen.getByText(/Elvin Məmmədov deaktiv edilsin/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Təsdiqlə' }));
    expect(deactivate).toHaveBeenCalledWith('u1');
    expect(onChanged).toHaveBeenCalled();
  });

  it('hides destructive actions on your own account', () => {
    renderWithProviders(<UserAccessCard user={worker} orgCode="acme" isSelf canManage onChanged={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Deaktiv et' })).not.toBeInTheDocument();
    expect(screen.getByText('Bu sizin hesabınızdır.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @taskop/web test user-access-card`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`apps/web/src/components/confirm-button.tsx`:
```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Props {
  label: string;
  title: string;
  description: string;
  onConfirm: () => Promise<void> | void;
  variant?: 'default' | 'destructive' | 'outline';
  disabled?: boolean;
}

export function ConfirmButton({ label, title, description, onConfirm, variant = 'outline', disabled }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant={variant} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={variant === 'destructive' ? 'destructive' : 'default'}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

`apps/web/src/features/users/user-access-card.tsx`:
```tsx
import type { UserDto } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/confirm-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { errorText } from '@/lib/errors';
import { api } from '@/lib/session';
import { SecretBlock } from './secret-dialog';
import { loginLabel, statusVariant } from './user-labels';

interface Props {
  user: UserDto;
  orgCode: string;
  isSelf: boolean;
  canManage: boolean;
  onChanged: (user: UserDto) => void;
}

export function UserAccessCard({ user, orgCode, isSelf, canManage, onChanged }: Props) {
  const { t } = useTranslation();
  const [secret, setSecret] = useState<string | null>(null);
  const run = async (fn: () => Promise<UserDto>) => {
    try {
      onChanged(await fn());
    } catch (e) {
      toast.error(errorText(t, e));
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('users.detail.access')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm">{loginLabel(user)}</span>
          <Badge variant={statusVariant(user.status)}>{t(`users.statuses.${user.status}`)}</Badge>
        </div>
        {isSelf && <p className="text-muted-foreground text-sm">{t('users.detail.you')}</p>}
        {canManage && !isSelf && (
          <div className="flex flex-wrap gap-2">
            <ConfirmButton
              label={t('users.detail.resetCredential')}
              title={t('users.detail.resetCredential')}
              description={t('users.detail.confirmReset', { name: user.fullName })}
              onConfirm={async () => {
                try {
                  const result = await api.users.resetCredential(user.id, {});
                  if (result.generatedSecret) setSecret(result.generatedSecret);
                  else toast.success(t('users.detail.resetStaffSent'));
                  onChanged(result.user);
                } catch (e) {
                  toast.error(errorText(t, e));
                }
              }}
            />
            {user.status === 'deactivated' ? (
              <Button variant="outline" onClick={() => void run(() => api.users.reactivate(user.id))}>
                {t('users.detail.reactivate')}
              </Button>
            ) : (
              <ConfirmButton
                variant="destructive"
                label={t('users.detail.deactivate')}
                title={t('users.detail.deactivate')}
                description={t('users.detail.confirmDeactivate', { name: user.fullName })}
                onConfirm={() => run(() => api.users.deactivate(user.id))}
              />
            )}
          </div>
        )}
      </CardContent>
      <Dialog open={secret !== null} onOpenChange={(o) => !o && setSecret(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('users.secret.title')}</DialogTitle>
          </DialogHeader>
          {secret && <SecretBlock orgCode={orgCode} username={user.username ?? ''} secret={secret} />}
          <DialogFooter>
            <Button onClick={() => setSecret(null)}>{t('users.secret.done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
```

`apps/web/src/features/users/user-profile-form.tsx`:
```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { type RoleDto, updateUserInputSchema, type UserDto } from '@taskop/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FormError } from '@/components/form-error';
import { NativeSelect } from '@/components/native-select';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { roleDisplayName } from '@/features/roles/queries';
import { applyFieldErrors, errorText } from '@/lib/errors';
import { api } from '@/lib/session';

const emptyToNull = (v: unknown) => (v === '' ? null : v);

interface Props {
  user: UserDto;
  roles: RoleDto[];
  managers: UserDto[];
  isSelf: boolean;
  canManage: boolean;
  onSaved: (user: UserDto) => void;
}

export function UserProfileForm({ user, roles, managers, isSelf, canManage, onSaved }: Props) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof updateUserInputSchema>, unknown, z.output<typeof updateUserInputSchema>>({
    resolver: zodResolver(updateUserInputSchema),
    values: {
      fullName: user.fullName,
      jobTitle: user.jobTitle,
      phone: user.phone,
      roleId: user.role.id,
      managerId: user.managerId,
      ...(user.kind === 'worker' ? { username: user.username ?? '' } : {}),
    },
  });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      onSaved(await api.users.update(user.id, values));
      toast.success(t('common.saved'));
    } catch (e) {
      if (!applyFieldErrors(form, e)) setError(errorText(t, e));
    }
  });
  const roleOptions = roles.filter((r) => r.active || r.id === user.role.id);
  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <fieldset disabled={!canManage} className="grid gap-4 sm:grid-cols-2">
        <TextField form={form} name="fullName" label={t('users.form.fullName')} />
        {user.kind === 'worker' && <TextField form={form} name="username" label={t('users.form.username')} />}
        <div className="grid gap-1.5">
          <Label htmlFor="p-jobTitle">{t('users.form.jobTitle')}</Label>
          <input id="p-jobTitle" className="border-input h-9 rounded-md border px-3 text-sm" {...form.register('jobTitle', { setValueAs: emptyToNull })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="p-phone">{t('users.form.phone')}</Label>
          <input id="p-phone" type="tel" className="border-input h-9 rounded-md border px-3 text-sm" {...form.register('phone', { setValueAs: emptyToNull })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="p-role">{t('users.form.role')}</Label>
          <NativeSelect id="p-role" disabled={isSelf || !canManage} {...form.register('roleId')}>
            {roleOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {roleDisplayName(t, r)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="p-manager">{t('users.form.manager')}</Label>
          <NativeSelect id="p-manager" {...form.register('managerId', { setValueAs: emptyToNull })}>
            <option value="">{t('users.form.noManager')}</option>
            {managers
              .filter((m) => m.id !== user.id)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName}
                </option>
              ))}
          </NativeSelect>
        </div>
      </fieldset>
      <FormError message={error} />
      {canManage && (
        <div>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {t('common.save')}
          </Button>
        </div>
      )}
    </form>
  );
}
```
(When the role list isn't visible to the actor (no `roles.view`), the page passes the user's current role only, so the select still renders it.)

`apps/web/src/features/users/user-assignments.tsx`:
```tsx
import type { SiteDto, TeamDto, UserDto } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckboxList } from '@/components/checkbox-list';
import { Button } from '@/components/ui/button';
import { indentedName } from '@/features/sites/tree';
import { errorText } from '@/lib/errors';
import { api } from '@/lib/session';

interface Props {
  user: UserDto;
  sites: SiteDto[] | null;
  teams: TeamDto[] | null;
  canManage: boolean;
  onSaved: (user: UserDto) => void;
}

export function UserAssignments({ user, sites, teams, canManage, onSaved }: Props) {
  const { t } = useTranslation();
  const [siteIds, setSiteIds] = useState(user.siteIds);
  const [teamIds, setTeamIds] = useState(user.teamIds);
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid gap-4">
      {sites && (
        <CheckboxList
          label={t('users.form.sites')}
          disabled={!canManage}
          options={sites.filter((s) => s.active || siteIds.includes(s.id)).map((s) => ({ value: s.id, label: indentedName(s) }))}
          value={siteIds}
          onChange={setSiteIds}
        />
      )}
      {teams && (
        <CheckboxList
          label={t('users.form.teams')}
          disabled={!canManage}
          options={teams.filter((tm) => tm.active || teamIds.includes(tm.id)).map((tm) => ({ value: tm.id, label: tm.name }))}
          value={teamIds}
          onChange={setTeamIds}
        />
      )}
      {canManage && (
        <div>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                let updated = user;
                if (sites) updated = await api.users.setSites(user.id, siteIds);
                if (teams) updated = await api.users.setTeams(user.id, teamIds);
                onSaved(updated);
                toast.success(t('common.saved'));
              } catch (e) {
                toast.error(errorText(t, e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('users.detail.saveAssignments')}
          </Button>
        </div>
      )}
    </div>
  );
}
```

`apps/web/src/features/users/user-detail-page.tsx`:
```tsx
import type { UserDto } from '@taskop/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useRoles } from '@/features/roles/queries';
import { useSites } from '@/features/sites/queries';
import { useActiveUsers, useTeams } from '@/features/teams/queries';
import { useCan, useMe } from '@/lib/session';
import { useUser } from './queries';
import { UserAccessCard } from './user-access-card';
import { UserAssignments } from './user-assignments';
import { UserProfileForm } from './user-profile-form';

export function UserDetailPage() {
  const { t } = useTranslation();
  const { userId } = useParams({ from: '/app/users/$userId' });
  const me = useMe();
  const qc = useQueryClient();
  const canManage = useCan('users.manage');
  const canSeeRoles = useCan('roles.view');
  const canSeeSites = useCan('sites.view');
  const canSeeTeams = useCan('teams.view');
  const user = useUser(userId);
  const roles = useRoles(canSeeRoles);
  const sites = useSites();
  const teams = useTeams();
  const managers = useActiveUsers(true);

  if (!user.data) return <p>{user.isError ? t('errors.NOT_FOUND') : t('common.loading')}</p>;
  const u = user.data;
  const isSelf = u.id === me.user.id;
  const onChanged = (updated: UserDto) => {
    qc.setQueryData(['users', updated.id], updated);
    void qc.invalidateQueries({ queryKey: ['users', 'list'] });
  };
  const roleList = canSeeRoles && roles.data ? roles.data : [{ ...u.role, dataScope: 'own' as const, editable: false, active: true, permissions: [], userCount: 0 }];

  return (
    <div className="grid gap-6">
      <Link to="/users" className="text-muted-foreground inline-flex items-center gap-1 text-sm">
        <ArrowLeft className="size-4" /> {t('users.title')}
      </Link>
      <PageHeader title={u.fullName} />
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('users.detail.profile')}</CardTitle>
            </CardHeader>
            <CardContent>
              <UserProfileForm user={u} roles={roleList} managers={managers.data ?? []} isSelf={isSelf} canManage={canManage} onSaved={onChanged} />
            </CardContent>
          </Card>
          {(canSeeSites || canSeeTeams) && (
            <Card>
              <CardHeader>
                <CardTitle>{t('users.detail.assignments')}</CardTitle>
              </CardHeader>
              <CardContent>
                <UserAssignments
                  key={u.id}
                  user={u}
                  sites={canSeeSites ? (sites.data ?? []) : null}
                  teams={canSeeTeams ? (teams.data ?? []) : null}
                  canManage={canManage}
                  onSaved={onChanged}
                />
              </CardContent>
            </Card>
          )}
        </div>
        <UserAccessCard user={u} orgCode={me.tenant.orgCode} isSelf={isSelf} canManage={canManage} onChanged={onChanged} />
      </div>
    </div>
  );
}
```

Modify `apps/web/src/router.tsx`: import `UserDetailPage` and change `userDetailRoute`'s `component: () => null` to `component: UserDetailPage`.

- [ ] **Step 4: Run tests and type-check**

Run: `pnpm --filter @taskop/web test && pnpm --filter @taskop/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): add user detail page with profile, assignments, status and credential reset"
```

---

### Task W9: Audit log viewer

**Files:**
- Create: `apps/web/src/features/audit/audit-diff.tsx`, `audit-page.tsx`
- Create: `packages/i18n/src/az/audit.ts`; Modify: `packages/i18n/src/az/index.ts`
- Modify: `apps/web/src/router.tsx` (`/audit`)
- Test: `apps/web/src/features/audit/audit-diff.test.tsx`

**Interfaces:**
- Produces: `diffEntries(before: unknown, after: unknown): { key: string; before: unknown; after: unknown }[]` (top-level keys whose JSON differs); `AuditDiff({ before, after })`; route `/audit`.

- [ ] **Step 1: Translations**

`packages/i18n/src/az/audit.ts`:
```ts
export default {
  title: 'Audit jurnalı',
  filters: { action: 'Əməliyyat (məs. user.created)', entityType: 'Element növü', from: 'Başlanğıc tarixi', to: 'Son tarix' },
  columns: { time: 'Vaxt', actor: 'İcraçı', action: 'Əməliyyat', entity: 'Element' },
  actorPlatform: 'Taskop dəstəyi',
  actorSystem: 'Sistem',
  before: 'Əvvəl',
  after: 'Sonra',
  noChanges: 'Əlavə məlumat yoxdur.',
  showChanges: 'Dəyişikliklər',
  entityTypes: {
    user: 'İstifadəçi',
    role: 'Rol',
    site: 'Obyekt',
    site_type: 'Obyekt növü',
    team: 'Komanda',
    tenant: 'Təşkilat',
    session: 'Sessiya',
  },
} as const;
```
Register `audit`; rebuild `@taskop/i18n`.

- [ ] **Step 2: Write the failing test**

`apps/web/src/features/audit/audit-diff.test.tsx`:
```tsx
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { AuditDiff, diffEntries } from './audit-diff';

describe('diffEntries', () => {
  it('lists only changed top-level keys', () => {
    expect(diffEntries({ name: 'A', tz: 'Asia/Baku', n: [1] }, { name: 'B', tz: 'Asia/Baku', n: [1] })).toEqual([{ key: 'name', before: 'A', after: 'B' }]);
  });
  it('treats a creation (no before) as all keys added', () => {
    expect(diffEntries(null, { name: 'A' })).toEqual([{ key: 'name', before: undefined, after: 'A' }]);
  });
  it('handles non-object payloads', () => {
    expect(diffEntries(null, null)).toEqual([]);
  });
});

describe('AuditDiff', () => {
  it('renders before and after values', () => {
    renderWithProviders(<AuditDiff before={{ status: 'active' }} after={{ status: 'deactivated' }} />);
    expect(screen.getByText('status')).toBeInTheDocument();
    expect(screen.getByText('"active"')).toBeInTheDocument();
    expect(screen.getByText('"deactivated"')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @taskop/web test audit-diff`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement**

`apps/web/src/features/audit/audit-diff.tsx`:
```tsx
import { useTranslation } from 'react-i18next';

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function diffEntries(before: unknown, after: unknown) {
  const b = asRecord(before);
  const a = asRecord(after);
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return keys.filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k])).map((k) => ({ key: k, before: b[k], after: a[k] }));
}

const show = (v: unknown) => (v === undefined ? '—' : JSON.stringify(v));

export function AuditDiff({ before, after }: { before: unknown; after: unknown }) {
  const { t } = useTranslation();
  const rows = diffEntries(before, after);
  if (rows.length === 0) return <p className="text-muted-foreground text-sm">{t('audit.noChanges')}</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-muted-foreground text-left">
          <th className="py-1 pr-4 font-normal" />
          <th className="py-1 pr-4 font-normal">{t('audit.before')}</th>
          <th className="py-1 font-normal">{t('audit.after')}</th>
        </tr>
      </thead>
      <tbody className="font-mono">
        {rows.map((r) => (
          <tr key={r.key} className="border-t align-top">
            <td className="py-1 pr-4 font-sans font-medium">{r.key}</td>
            <td className="py-1 pr-4 break-all text-red-700">{show(r.before)}</td>
            <td className="py-1 break-all text-green-700">{show(r.after)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

`apps/web/src/features/audit/audit-page.tsx`:
```tsx
import type { AuditEntryDto } from '@taskop/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Fragment, useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFormatDateTime } from '@/lib/format';
import { api } from '@/lib/session';
import { AuditDiff } from './audit-diff';

const ENTITY_TYPES = ['user', 'role', 'site', 'site_type', 'team', 'tenant', 'session'] as const;

/** `<input type="date">` gives a local day; convert to the UTC instant at its start/end. */
const dayBoundary = (day: string, end: boolean) => (day ? new Date(`${day}T${end ? '23:59:59.999' : '00:00:00'}`).toISOString() : undefined);

export function AuditPage() {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const filters = {
    action: useDeferredValue(action.trim()) || undefined,
    entityType: entityType || undefined,
    from: dayBoundary(from, false),
    to: dayBoundary(to, true),
  };
  const entries = useInfiniteQuery({
    queryKey: ['audit', filters],
    queryFn: ({ pageParam }) => api.audit.list({ ...filters, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = entries.data?.pages.flatMap((p) => p.items) ?? [];
  const actorName = (e: AuditEntryDto) =>
    e.actor.type === 'platform_admin' ? t('audit.actorPlatform') : e.actor.type === 'system' ? t('audit.actorSystem') : (e.actor.name ?? '—');

  return (
    <div>
      <PageHeader title={t('audit.title')} />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <div className="grid gap-1.5">
          <Label htmlFor="f-action">{t('audit.filters.action')}</Label>
          <Input id="f-action" value={action} onChange={(e) => setAction(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-entity">{t('audit.filters.entityType')}</Label>
          <NativeSelect id="f-entity" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            <option value="">{t('common.all')}</option>
            {ENTITY_TYPES.map((et) => (
              <option key={et} value={et}>
                {t(`audit.entityTypes.${et}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-from">{t('audit.filters.from')}</Label>
          <Input id="f-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-to">{t('audit.filters.to')}</Label>
          <Input id="f-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('audit.columns.time')}</TableHead>
            <TableHead>{t('audit.columns.actor')}</TableHead>
            <TableHead>{t('audit.columns.action')}</TableHead>
            <TableHead>{t('audit.columns.entity')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((e) => (
            <Fragment key={e.id}>
              <TableRow>
                <TableCell className="text-sm whitespace-nowrap">{formatDateTime(e.occurredAt)}</TableCell>
                <TableCell>{actorName(e)}</TableCell>
                <TableCell className="font-mono text-sm">{e.action}</TableCell>
                <TableCell>{t(`audit.entityTypes.${e.entityType}`, { defaultValue: e.entityType })}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
                    {t('audit.showChanges')}
                  </Button>
                </TableCell>
              </TableRow>
              {open === e.id && (
                <TableRow>
                  <TableCell colSpan={5} className="bg-muted/30">
                    <AuditDiff before={e.before} after={e.after} />
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          ))}
          {!entries.isLoading && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground text-center">
                {t('common.noResults')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {entries.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" disabled={entries.isFetchingNextPage} onClick={() => void entries.fetchNextPage()}>
            {t('common.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
```
Note: the date filters use the browser's local day. For a tenant in a different timezone than the browser this is off by the offset; acceptable for this sub-project and noted for the reports work in sub-project 7.

Modify `apps/web/src/router.tsx`: add `/audit` → `AuditPage`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @taskop/web test && pnpm --filter @taskop/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web packages/i18n
git commit -m "feat(web): add audit log viewer with filters and before/after diff"
```

---

### Task W10: Platform admin pages

**Files:**
- Create: `apps/web/src/features/platform/platform-session.ts`, `platform-login-page.tsx`, `platform-tenants-page.tsx`
- Create: `packages/i18n/src/az/platform.ts`; Modify: `packages/i18n/src/az/index.ts`
- Modify: `apps/web/src/router.tsx` (`/platform/login`, `/platform/tenants`)
- Test: `apps/web/src/features/platform/platform-tenants-page.test.tsx`

**Interfaces:**
- Produces:
  - `platformSession` `{ get(): PlatformLoginResult['admin'] | null; signIn(r); signOut(); subscribe(l) }`, `usePlatformAdmin()`, `platformApi: PlatformApi` (separate `ApiClient` with `refresh: false`; token in memory only, so a reload requires logging in again).
  - `PlatformTenantsTable({ tenants, onSuspend, onReactivate })`.
  - Routes `/platform/login` and `/platform/tenants` (the latter redirects to `/platform/login` without a platform session).

- [ ] **Step 1: Translations**

`packages/i18n/src/az/platform.ts`:
```ts
export default {
  title: 'Taskop platforması',
  login: { title: 'Platforma administratoru', email: 'E-poçt', password: 'Şifrə', submit: 'Daxil ol' },
  tenants: {
    title: 'Təşkilatlar',
    search: 'Ad və ya kod',
    name: 'Təşkilat',
    orgCode: 'Kod',
    users: 'İstifadəçilər',
    created: 'Yaradılıb',
    status: 'Status',
    active: 'Aktiv',
    suspended: 'Dayandırılıb',
    suspend: 'Dayandır',
    reactivate: 'Bərpa et',
    confirmSuspend: '«{{name}}» dayandırılsın? Bütün istifadəçilərin sessiyaları bağlanacaq.',
  },
  logout: 'Çıxış',
} as const;
```
Register `platform`; rebuild `@taskop/i18n`.

- [ ] **Step 2: Write the failing test**

`apps/web/src/features/platform/platform-tenants-page.test.tsx`:
```tsx
import type { PlatformTenantDto } from '@taskop/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { PlatformTenantsTable } from './platform-tenants-page';

const tenant = (status: 'active' | 'suspended'): PlatformTenantDto => ({
  id: 't1', name: 'Acme MMC', orgCode: 'acme', status, userCount: 12, createdAt: '2026-10-07T10:00:00.000Z',
});

describe('PlatformTenantsTable', () => {
  it('confirms before suspending', async () => {
    const onSuspend = vi.fn();
    renderWithProviders(<PlatformTenantsTable tenants={[tenant('active')]} onSuspend={onSuspend} onReactivate={vi.fn()} />);
    expect(screen.getByText('12')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dayandır' }));
    expect(screen.getByText(/«Acme MMC» dayandırılsın/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Təsdiqlə' }));
    expect(onSuspend).toHaveBeenCalledWith('t1');
  });

  it('offers reactivation for suspended tenants', async () => {
    const onReactivate = vi.fn();
    renderWithProviders(<PlatformTenantsTable tenants={[tenant('suspended')]} onSuspend={vi.fn()} onReactivate={onReactivate} />);
    await userEvent.click(screen.getByRole('button', { name: 'Bərpa et' }));
    expect(onReactivate).toHaveBeenCalledWith('t1');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @taskop/web test platform-tenants`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement**

`apps/web/src/features/platform/platform-session.ts`:
```ts
import { ApiClient, createPlatformApi, memoryTokenStore } from '@taskop/api-client';
import type { PlatformLoginResult } from '@taskop/contracts';
import { useSyncExternalStore } from 'react';

type Admin = PlatformLoginResult['admin'];

const store = memoryTokenStore();
let admin: Admin | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const client = new ApiClient({
  baseUrl: '/api/v1',
  client: 'web',
  tokenStore: store,
  refresh: false,
  onSessionExpired: () => void platformSession.signOut(),
});
export const platformApi = createPlatformApi(client);

export const platformSession = {
  get: () => admin,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  async signIn(result: PlatformLoginResult) {
    await store.save({ accessToken: result.accessToken, refreshToken: null });
    admin = result.admin;
    emit();
  },
  async signOut() {
    await store.clear();
    admin = null;
    emit();
  },
};

export const usePlatformAdmin = () => useSyncExternalStore(platformSession.subscribe, platformSession.get);
```
Because `refresh: false`, a 401 from an expired platform token is surfaced as an error; the tenants page catches `UNAUTHENTICATED` and calls `platformSession.signOut()` (see below).

`apps/web/src/features/platform/platform-login-page.tsx`:
```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { platformLoginInputSchema } from '@taskop/contracts';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { FormError } from '@/components/form-error';
import { Logo } from '@/components/logo';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { errorText } from '@/lib/errors';
import { platformApi, platformSession } from './platform-session';

export function PlatformLoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof platformLoginInputSchema>, unknown, z.output<typeof platformLoginInputSchema>>({
    resolver: zodResolver(platformLoginInputSchema),
    defaultValues: { email: '', password: '' },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await platformSession.signIn(await platformApi.login(values));
      await navigate({ to: '/platform/tenants' });
    } catch (e) {
      setError(errorText(t, e));
    }
  });
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-900 p-6">
      <Logo className="text-white" />
      <form onSubmit={onSubmit} className="bg-background grid w-full max-w-md gap-4 rounded-xl p-8" noValidate>
        <h1 className="text-xl font-semibold">{t('platform.login.title')}</h1>
        <TextField form={form} name="email" label={t('platform.login.email')} type="email" autoComplete="username" />
        <TextField form={form} name="password" label={t('platform.login.password')} type="password" autoComplete="current-password" />
        <FormError message={error} />
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {t('platform.login.submit')}
        </Button>
      </form>
    </div>
  );
}
```

`apps/web/src/features/platform/platform-tenants-page.tsx`:
```tsx
import { ApiError } from '@taskop/api-client';
import type { PlatformTenantDto } from '@taskop/contracts';
import { formatDateTime } from '@taskop/i18n';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/confirm-button';
import { Logo } from '@/components/logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errorText } from '@/lib/errors';
import { platformApi, platformSession, usePlatformAdmin } from './platform-session';

interface TableProps {
  tenants: PlatformTenantDto[];
  onSuspend: (id: string) => Promise<void> | void;
  onReactivate: (id: string) => Promise<void> | void;
}

export function PlatformTenantsTable({ tenants, onSuspend, onReactivate }: TableProps) {
  const { t } = useTranslation();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('platform.tenants.name')}</TableHead>
          <TableHead>{t('platform.tenants.orgCode')}</TableHead>
          <TableHead>{t('platform.tenants.users')}</TableHead>
          <TableHead>{t('platform.tenants.created')}</TableHead>
          <TableHead>{t('platform.tenants.status')}</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {tenants.map((tn) => (
          <TableRow key={tn.id}>
            <TableCell className="font-medium">{tn.name}</TableCell>
            <TableCell className="font-mono">{tn.orgCode}</TableCell>
            <TableCell>{tn.userCount}</TableCell>
            <TableCell>{formatDateTime(tn.createdAt, { locale: 'az', timeZone: 'Asia/Baku' })}</TableCell>
            <TableCell>
              <Badge variant={tn.status === 'active' ? 'default' : 'destructive'}>{t(`platform.tenants.${tn.status}`)}</Badge>
            </TableCell>
            <TableCell className="text-right">
              {tn.status === 'active' ? (
                <ConfirmButton
                  variant="destructive"
                  label={t('platform.tenants.suspend')}
                  title={t('platform.tenants.suspend')}
                  description={t('platform.tenants.confirmSuspend', { name: tn.name })}
                  onConfirm={() => onSuspend(tn.id)}
                />
              ) : (
                <Button variant="outline" onClick={() => void onReactivate(tn.id)}>
                  {t('platform.tenants.reactivate')}
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function PlatformTenantsPage() {
  const { t } = useTranslation();
  const admin = usePlatformAdmin();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const tenants = useQuery({
    queryKey: ['platform', 'tenants', q],
    queryFn: async () => (await platformApi.tenants.list({ q: q || undefined, limit: 200 })).items,
    enabled: admin !== null,
  });
  useEffect(() => {
    if (tenants.error instanceof ApiError && tenants.error.code === 'UNAUTHENTICATED') void platformSession.signOut();
  }, [tenants.error]);
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['platform', 'tenants'] });
    } catch (e) {
      toast.error(errorText(t, e));
    }
  };
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between bg-slate-900 px-6 py-3 text-white">
        <Logo className="text-white" />
        <div className="flex items-center gap-3 text-sm">
          <span>{admin?.fullName}</span>
          <Button size="sm" variant="secondary" onClick={() => void platformSession.signOut()}>
            {t('platform.logout')}
          </Button>
        </div>
      </header>
      <main className="grid gap-4 p-6">
        <h1 className="text-2xl font-semibold">{t('platform.tenants.title')}</h1>
        <Input type="search" className="max-w-sm" placeholder={t('platform.tenants.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <PlatformTenantsTable
          tenants={tenants.data ?? []}
          onSuspend={(id) => act(() => platformApi.tenants.suspend(id))}
          onReactivate={(id) => act(() => platformApi.tenants.reactivate(id))}
        />
      </main>
    </div>
  );
}
```

Modify `apps/web/src/router.tsx`:
```tsx
import { PlatformLoginPage } from '@/features/platform/platform-login-page';
import { PlatformTenantsPage } from '@/features/platform/platform-tenants-page';
import { platformSession } from '@/features/platform/platform-session';

const platformLoginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/platform/login', component: PlatformLoginPage });
const platformTenantsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/platform/tenants',
  component: PlatformTenantsPage,
  beforeLoad: () => {
    if (!platformSession.get()) throw redirect({ to: '/platform/login' });
  },
});
```
Add both to `rootRoute.addChildren([...])`. In `main.tsx`, also subscribe the router to platform session changes:
```tsx
import { platformSession } from '@/features/platform/platform-session';
platformSession.subscribe(() => {
  void router.invalidate();
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @taskop/web test && pnpm --filter @taskop/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web packages/i18n
git commit -m "feat(web): add platform admin login and tenant management pages"
```

---

### Task W11: End-to-end smoke test and CI

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/foundation.spec.ts`
- Modify: `.github/workflows/ci.yml` (add an `e2e` job)

**Interfaces:**
- Consumes: running API (port 3000) with a migrated database, web dev server (port 5173), Mailpit not required.
- Produces: `pnpm --filter @taskop/web e2e`.

- [ ] **Step 1: Install Playwright**

```bash
pnpm --filter @taskop/web add -D @playwright/test@latest
pnpm --filter @taskop/web exec playwright install --with-deps chromium
```

- [ ] **Step 2: Write the config and the test**

`apps/web/playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @taskop/api start',
      url: 'http://localhost:3000/api/v1/health',
      reuseExistingServer: !process.env.CI,
      cwd: '../..',
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @taskop/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      cwd: '../..',
      timeout: 120_000,
    },
  ],
});
```
(The API must be built (`pnpm --filter @taskop/api build`) and its environment loaded; locally, run `pnpm --filter @taskop/api dev` yourself first and Playwright reuses it.)

`apps/web/e2e/foundation.spec.ts`:
```ts
import { expect, test } from '@playwright/test';

test('owner signs up, creates a site and a worker, and finds the worker after logging back in', async ({ page }) => {
  const suffix = Date.now().toString(36);
  const orgCode = `e2e-${suffix}`;
  const email = `owner-${suffix}@example.az`;
  const password = 'e2e owner password';

  await page.goto('/signup');
  await page.getByLabel('Təşkilatın adı').fill('E2E MMC');
  await page.getByLabel('Təşkilat kodu').fill(orgCode);
  await page.getByLabel('Ad və soyad').fill('Elvin Əhmədov');
  await page.getByLabel('E-poçt', { exact: true }).fill(email);
  await page.getByLabel('Şifrə', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Qeydiyyatdan keç' }).click();
  await expect(page.getByRole('heading', { name: 'Xoş gəlmisiniz, Elvin!' })).toBeVisible();

  await page.getByRole('link', { name: 'Obyektlər' }).click();
  await page.getByRole('button', { name: 'Əsas obyekt əlavə et' }).click();
  await page.getByLabel('Ad', { exact: true }).fill('Anbar №1');
  await page.getByRole('button', { name: 'Yadda saxla' }).click();
  await expect(page.getByRole('treeitem').getByText('Anbar №1')).toBeVisible();

  await page.getByRole('link', { name: 'İstifadəçilər' }).click();
  await page.getByRole('button', { name: 'Yeni işçi' }).click();
  await page.getByLabel('Ad və soyad').fill('Nigar Səfərli');
  await page.getByLabel('İstifadəçi adı').fill('nigar');
  await page.getByRole('checkbox', { name: 'Anbar №1' }).check();
  await page.getByRole('button', { name: 'Yarat' }).click();
  await expect(page.getByText('Giriş məlumatları')).toBeVisible();
  await expect(page.getByText(orgCode)).toBeVisible();
  await page.getByRole('button', { name: 'Hazırdır' }).click();

  await page.getByRole('button', { name: 'Çıxış' }).click();
  await expect(page.getByRole('heading', { name: 'Taskop-a daxil olun' })).toBeVisible();
  await page.getByLabel('E-poçt', { exact: true }).fill(email);
  await page.getByLabel('Şifrə', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Daxil ol' }).click();
  await page.getByRole('link', { name: 'İstifadəçilər' }).click();
  await expect(page.getByRole('cell', { name: /Nigar Səfərli/ })).toBeVisible();
});
```

- [ ] **Step 3: Run it locally**

With `docker compose up -d`, `pnpm db:setup`, and `pnpm --filter @taskop/api dev` running:
Run: `pnpm --filter @taskop/web e2e`
Expected: 1 passed.

- [ ] **Step 4: Add the CI job**

Append to `.github/workflows/ci.yml` under `jobs:`:
```yaml
  e2e:
    runs-on: ubuntu-latest
    needs: build
    services:
      postgres:
        image: postgres:18-alpine
        env:
          POSTGRES_DB: taskop
          POSTGRES_USER: taskop_owner
          POSTGRES_PASSWORD: owner_ci_password
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U taskop_owner -d taskop" --health-interval 5s --health-timeout 3s --health-retries 10
    env:
      DATABASE_OWNER_URL: postgres://taskop_owner:owner_ci_password@localhost:5432/taskop
      DATABASE_APP_URL: postgres://taskop_app:app_ci_password@localhost:5432/taskop
      DATABASE_PLATFORM_URL: postgres://taskop_platform:platform_ci_password@localhost:5432/taskop
      APP_DB_PASSWORD: app_ci_password
      PLATFORM_DB_PASSWORD: platform_ci_password
      WEB_URL: http://localhost:5173
      SMTP_URL: smtp://localhost:1025
      MAIL_FROM: Taskop <no-reply@taskop.ci>
      COOKIE_SECURE: 'false'
      LOG_LEVEL: warn
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - name: Prepare database and JWT keys
        run: |
          cd apps/api
          touch .env
          pnpm exec tsx src/db/scripts/setup.ts
          pnpm exec tsx src/scripts/generate-keys.ts | sed 's/"//g' >> "$GITHUB_ENV"
      - run: pnpm --filter @taskop/web exec playwright install --with-deps chromium
      - run: pnpm --filter @taskop/web e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: apps/web/test-results
```
(`generate-keys.ts` prints `KEY="value"` lines; stripping quotes makes them valid `$GITHUB_ENV` entries with literal `\n` sequences, which `loadConfig` unescapes. SMTP sends fail silently in CI because mail errors are logged, not thrown.)

- [ ] **Step 5: Commit**

```bash
git add apps/web .github/workflows/ci.yml pnpm-lock.yaml
git commit -m "test(web): add Playwright end-to-end smoke test and CI job"
```
