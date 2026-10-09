import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, createPlatformApi, createTaskopApi, memoryTokenStore, type TokenStore } from './index.js';

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

  it('keeps the session when refresh fails transiently (503)', async () => {
    const store = memoryTokenStore();
    await store.save({ accessToken: 'old', refreshToken: null });
    const { api, onSessionExpired } = setup((url) => (url.endsWith('/auth/refresh') ? err(503, 'INTERNAL') : err(401, 'UNAUTHENTICATED')), 'web', store);
    await expect(createTaskopApi(api).me()).rejects.toMatchObject({ status: 503 });
    expect(store.getAccessToken()).toBe('old');
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('returns null from refresh on mobile without a stored refresh token', async () => {
    const { api, fetchMock } = setup(() => json(200, me), 'mobile');
    await expect(api.refresh()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns a malformed success body into an INTERNAL ApiError', async () => {
    const { api } = setup(() => new Response('<html>', { status: 200 }));
    await expect(createTaskopApi(api).me()).rejects.toMatchObject({ code: 'INTERNAL', messageKey: 'errors.INTERNAL' });
  });
});

describe('checklist endpoints', () => {
  const cid = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e60';

  it('exposes issues and currentRevision on errors', async () => {
    const issues = [{ path: ['sections', 0, 'title'], code: 'checklists.issues.titleRequired' }];
    const { api } = setup(() =>
      json(422, { error: { code: 'CHECKLIST_INVALID_CONTENT', messageKey: 'errors.CHECKLIST_INVALID_CONTENT', fields: null, retryAfterSeconds: null, requestId: 'r', issues } }),
    );
    const e = await createTaskopApi(api).checklists.publish(cid, { revision: 1 }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).issues).toEqual(issues);
    const { api: api2 } = setup(() =>
      json(409, { error: { code: 'CHECKLIST_DRAFT_CONFLICT', messageKey: 'x', fields: null, retryAfterSeconds: null, requestId: null, currentRevision: 7 } }),
    );
    const e2 = (await createTaskopApi(api2).checklists.saveDraft(cid, { content: {}, revision: 1 }).catch((x: unknown) => x)) as ApiError;
    expect([e2.code, e2.currentRevision, e2.issues]).toEqual(['CHECKLIST_DRAFT_CONFLICT', 7, null]);
  });

  it('builds tenant and platform-in-tenant paths', async () => {
    const { api, fetchMock } = setup(() => json(200, { revision: 2, issues: [] }));
    await createTaskopApi(api).checklists.saveDraft(cid, { content: {}, revision: 1 });
    await createPlatformApi(api).inTenant(cid).checklists.saveDraft(cid, { content: {}, revision: 1 });
    await createPlatformApi(api).inTenant(cid).templates.saveContent(cid, { content: {}, revision: 1 });
    expect(fetchMock.mock.calls.map((c) => `${c[1].method} ${c[0]}`)).toEqual([
      `PUT /api/v1/checklists/${cid}/draft`,
      `PUT /api/v1/platform/tenants/${cid}/checklists/${cid}/draft`,
      `PUT /api/v1/platform/tenants/${cid}/templates/${cid}/content`,
    ]);
  });

  it('discards a draft with DELETE and no body', async () => {
    const { api, fetchMock } = setup(() => new Response(null, { status: 204 }));
    await expect(createTaskopApi(api).checklists.discardDraft(cid)).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'DELETE', body: undefined });
  });
});

describe('scheduling endpoints', () => {
  async function authed(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    const store = memoryTokenStore();
    await store.save({ accessToken: 'a1', refreshToken: null });
    return setup(handler, 'web', store);
  }

  it('builds paths and query strings, with comma-separated statuses', async () => {
    const urls: string[] = [];
    const { api } = await authed((url, init) => {
      urls.push(`${init.method} ${url}`);
      return json(200, { items: [], nextCursor: null });
    });
    const t = createTaskopApi(api);
    await t.occurrences.list({ from: '2026-11-02', to: '2026-11-08', status: 'pending,overdue', siteId: id });
    await t.occurrences.mine({ from: '2026-11-02', to: '2026-11-08' });
    await t.assignments.list({ status: 'active' });
    expect(urls).toEqual([
      `GET /api/v1/occurrences?from=2026-11-02&to=2026-11-08&status=pending%2Coverdue&siteId=${id}`,
      'GET /api/v1/me/occurrences?from=2026-11-02&to=2026-11-08',
      'GET /api/v1/assignments?status=active',
    ]);
  });

  it('exposes userIds on scheduling errors', async () => {
    const { api } = await authed(() =>
      json(422, { error: { code: 'ASSIGNEE_NOT_AT_SITE', messageKey: 'errors.ASSIGNEE_NOT_AT_SITE', fields: null, retryAfterSeconds: null, requestId: 'r1', userIds: [id] } }),
    );
    const call = createTaskopApi(api).assignments.preview({
      siteId: id,
      schedule: { kind: 'once', date: '2026-11-05' },
      timing: { mode: 'fixed', startTime: '08:00', dueAfterMinutes: 60, graceMinutes: 0 },
    });
    await expect(call).rejects.toMatchObject({ code: 'ASSIGNEE_NOT_AT_SITE', userIds: [id] });
  });
});
