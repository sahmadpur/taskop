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

describe('execution endpoints', () => {
  async function authed(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    const store = memoryTokenStore();
    await store.save({ accessToken: 'a1', refreshToken: null });
    return setup(handler, 'mobile', store);
  }
  const progress = { answered: 0, total: 3, requiredMissing: 3 };
  const now0 = '2026-11-02T04:00:00.000Z';
  const detail = {
    id,
    executor: { id, fullName: 'Murad' },
    state: 'completed',
    rejectedReason: null,
    startedAt: now0,
    startedReceivedAt: now0,
    completedAt: now0,
    completedReceivedAt: now0,
    late: false,
    clockSuspect: false,
    progress,
    scorePercent: null,
    problemCount: 0,
    mediaPending: 0,
    occurrence: {
      id,
      assignmentId: id,
      assignmentName: null,
      checklistId: id,
      checklistName: 'Ops',
      siteId: id,
      siteName: 'Main',
      shiftId: null,
      shiftName: null,
      localDate: '2026-11-02',
      startsAt: now0,
      dueAt: now0,
      closesAt: now0,
      status: 'completed',
      statusChangedAt: now0,
      cancelReason: null,
      assigneeIds: [id],
      unassigned: false,
      executionBrief: null,
    },
    checklistVersionId: id,
    versionNumber: 1,
    content: { schemaVersion: 1, instructions: null, scoring: { enabled: false, problemsReduceScore: false }, sections: [] },
    answers: {},
    answersRev: 3,
    score: null,
    clockOffsetMs: 0,
    device: { platform: 'android', osVersion: '15', appVersion: '1.0.0' },
    lastSyncedAt: now0,
    media: [],
    problems: [],
  };

  it('builds every path, method and body', async () => {
    const calls: string[] = [];
    const { api } = await authed((url, init) => {
      calls.push(`${init.method} ${url} ${init.body ?? ''}`);
      if (url.includes('/me/sync')) return json(200, { serverTime: '2026-11-02T04:00:00.000Z', occurrences: [], checklistVersions: [], executions: [] });
      if (url.endsWith('/answers')) return json(200, { executionId: id, rev: 2, stale: false, state: 'active', progress });
      if (url.endsWith('/complete')) return json(200, { executionId: id, state: 'completed', completedAt: '2026-11-02T05:00:00.000Z', late: false, progress, score: null });
      if (url.endsWith(`/executions/${id}/media`)) return json(200, { mediaId: id, status: 'pending', uploadUrl: 'http://files.test/x', headers: { 'Content-Type': 'image/jpeg' }, expiresAt: '2026-11-02T04:15:00.000Z' });
      if (url.endsWith('/uploaded')) return json(200, { mediaId: id, status: 'uploaded', uploadedAt: '2026-11-02T04:01:00.000Z' });
      if (url.endsWith('/url')) return json(200, { url: 'http://files.test/x', expiresAt: '2026-11-02T04:05:00.000Z' });
      if (url.includes('/problems')) return json(200, { items: [], nextCursor: null });
      if (url.endsWith(`/executions/${id}`)) return json(200, detail);
      return json(200, { executionId: id, state: 'rejected', reason: 'ALREADY_CLAIMED', claim: { executionId: id, executorUserId: id, executorName: 'Murad' }, checklistVersionId: id, startedAt: '2026-11-02T04:00:00.000Z', clockSuspect: false });
    });
    const t = createTaskopApi(api);
    const now = '2026-11-02T04:00:00.000Z';
    await t.sync.pull([id, id]);
    await t.sync.pull();
    const claim = await t.executions.claim({ id, occurrenceId: id, startedAt: now, deviceTime: now, clientOffsetMs: 0, device: { platform: 'android', osVersion: '15', appVersion: '1.0.0' } });
    expect(claim).toMatchObject({ state: 'rejected', reason: 'ALREADY_CLAIMED', claim: { executorName: 'Murad' } });
    await t.executions.saveAnswers(id, { rev: 2, answers: {}, deviceTime: now, clientOffsetMs: 0 });
    await t.executions.complete(id, { rev: 3, answers: {}, completedAt: now, deviceTime: now, clientOffsetMs: 0 });
    await t.executions.get(id);
    await t.executions.registerMedia(id, { id, itemId: null, kind: 'photo', source: 'camera', mime: 'image/jpeg', bytes: 10, capturedAt: now, deviceTime: now, clientOffsetMs: 0 });
    await t.media.confirmUploaded(id);
    await t.media.url(id);
    await t.problems.list({ from: '2026-11-01', to: '2026-11-30', severity: 'critical' });
    expect(calls.map((c) => c.split(' ').slice(0, 2).join(' '))).toEqual([
      `GET /api/v1/me/sync?knownVersionIds=${id}%2C${id}`,
      'GET /api/v1/me/sync',
      'POST /api/v1/executions',
      `PUT /api/v1/executions/${id}/answers`,
      `POST /api/v1/executions/${id}/complete`,
      `GET /api/v1/executions/${id}`,
      `POST /api/v1/executions/${id}/media`,
      `POST /api/v1/media/${id}/uploaded`,
      `GET /api/v1/media/${id}/url`,
      'GET /api/v1/problems?from=2026-11-01&to=2026-11-30&severity=critical',
    ]);
  });

  it('exposes the missing requirements on REQUIREMENTS_UNMET', async () => {
    const { api } = await authed(() =>
      json(422, { error: { code: 'REQUIREMENTS_UNMET', messageKey: 'errors.REQUIREMENTS_UNMET', fields: null, retryAfterSeconds: null, requestId: 'r1', missing: [{ itemId: id, kind: 'photo' }] } }),
    );
    const now = '2026-11-02T04:00:00.000Z';
    await expect(createTaskopApi(api).executions.complete(id, { rev: 1, answers: {}, completedAt: now, deviceTime: now, clientOffsetMs: 0 })).rejects.toMatchObject({
      code: 'REQUIREMENTS_UNMET',
      missing: [{ itemId: id, kind: 'photo' }],
    });
  });
});
