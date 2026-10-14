import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, createPlatformApi, createTaskopApi, memoryTokenStore, parseContentDispositionFilename, type TokenStore } from './index.js';

const id = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f';
const me = {
  user: { id, fullName: 'A B', jobTitle: null, kind: 'staff', email: 'a@b.az', username: null, emailVerified: true, credentialKind: 'password', emailNotifications: true },
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

  describe('timeoutMs', () => {
    /** A fetch that never answers until its signal aborts. */
    const hanging = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });

    it('aborts a request that does not settle in time and throws a NETWORK error', async () => {
      vi.useFakeTimers();
      try {
        const fetchMock = vi.fn(hanging);
        const api = new ApiClient({ baseUrl: '/api/v1', client: 'mobile', tokenStore: memoryTokenStore(), fetch: fetchMock as unknown as typeof fetch, timeoutMs: 30_000 });
        const pending = createTaskopApi(api).me();
        const outcome = expect(pending).rejects.toMatchObject({ code: 'NETWORK', messageKey: 'errors.NETWORK', status: 0 });
        await vi.advanceTimersByTimeAsync(29_999);
        expect(fetchMock.mock.calls[0]![1].signal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await outcome;
        expect(fetchMock.mock.calls[0]![1].signal?.aborted).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('also bounds a response body that never finishes', async () => {
      vi.useFakeTimers();
      try {
        const body = new ReadableStream({ start: () => undefined }); // headers arrive, the body never does
        const api = new ApiClient({
          baseUrl: '/api/v1', client: 'mobile', tokenStore: memoryTokenStore(), timeoutMs: 1_000,
          fetch: (async () => new Response(body, { status: 200 })) as unknown as typeof fetch,
        });
        const outcome = expect(createTaskopApi(api).me()).rejects.toMatchObject({ code: 'NETWORK' });
        await vi.advanceTimersByTimeAsync(1_000);
        await outcome;
      } finally {
        vi.useRealTimers();
      }
    });

    it('sends no abort signal and never times out without the option (web)', async () => {
      const { api, fetchMock } = setup(() => json(200, me));
      await createTaskopApi(api).me();
      expect(fetchMock.mock.calls[0]![1].signal).toBeUndefined();
    });
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
      if (url.includes('/me/sync')) return json(200, { serverTime: '2026-11-02T04:00:00.000Z', occurrences: [], checklistVersions: [], executions: [], tasks: [], removedTaskIds: [], unreadNotifications: 0 });
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

describe('task endpoints', () => {
  async function authed(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    const store = memoryTokenStore();
    await store.save({ accessToken: 'a1', refreshToken: null });
    return setup(handler, 'mobile', store);
  }
  const now = '2026-11-02T04:00:00.000Z';
  const user = { id, fullName: 'Nigar' };
  const detail = {
    id, title: 'Qapı', priority: 'normal', status: 'new', site: null, assignee: user, team: null, assigneeInactive: false, createdBy: user,
    requiresReview: false, source: 'adhoc', problemId: null, dueAt: null, overdueAt: null, rev: 1, createdAt: now, updatedAt: now,
    instructions: '', evidence: { photo: 'optional', video: 'optional', liveOnly: false }, acceptedAt: null, startedAt: null,
    submittedAt: null, completedAt: null, cancelledAt: null, cancelReason: null, media: [], submissions: [], problem: null,
    history: [], canManage: true, canReview: true,
  };

  it('builds every path, method and body', async () => {
    const calls: string[] = [];
    const { api } = await authed((url, init) => {
      calls.push(`${init.method} ${url}`);
      if (url.includes('/me/sync')) return json(200, { serverTime: now, occurrences: [], checklistVersions: [], executions: [], tasks: [], removedTaskIds: [id], unreadNotifications: 0 });
      if (url.includes('/tasks/assignees')) return json(200, { users: [{ id, fullName: 'Nigar', jobTitle: null, kind: 'worker' }], teams: [], sites: [] });
      if (url.endsWith('/uploaded')) return json(200, { mediaId: id, status: 'uploaded', uploadedAt: now });
      if (url.endsWith('/url')) return json(200, { url: 'http://files.test/x', expiresAt: now });
      if (url.endsWith('/media')) return json(200, { mediaId: id, status: 'pending', uploadUrl: 'http://files.test/x', headers: {}, expiresAt: now });
      if (init.method === 'GET' && url.includes('/tasks?')) return json(200, { items: [], nextCursor: null });
      return json(init.method === 'POST' && url.endsWith('/tasks') ? 201 : 200, detail);
    });
    const t = createTaskopApi(api);
    expect((await t.sync.pull([id], [id, id])).removedTaskIds).toEqual([id]);
    await t.tasks.list({ status: 'new,in_progress', awaitingMyReview: 'true' });
    await t.tasks.get(id);
    await t.tasks.create({ id, title: 'Qapı', assignee: { userId: id } });
    await t.tasks.update(id, { assignee: { teamId: id } });
    await t.tasks.cancel(id, { reason: 'Lazım deyil' });
    await t.tasks.review(id, { decision: 'reject', comment: 'Foto yoxdur' });
    await t.tasks.accept(id, { at: now });
    await t.tasks.start(id, { at: now });
    await t.tasks.submit(id, { id, text: 'Hazır', mediaIds: [id], submittedAt: now });
    await t.tasks.registerMedia(id, { id, role: 'response', kind: 'photo', source: 'camera', mime: 'image/jpeg', bytes: 10, capturedAt: now });
    await t.tasks.assignees({ q: 'Nig' });
    await t.tasks.problemMediaUrl(id, id);
    await t.taskMedia.confirmUploaded(id);
    await t.taskMedia.url(id);
    expect(calls).toEqual([
      `GET /api/v1/me/sync?knownVersionIds=${id}&knownTaskIds=${id}%2C${id}`,
      'GET /api/v1/tasks?status=new%2Cin_progress&awaitingMyReview=true',
      `GET /api/v1/tasks/${id}`,
      'POST /api/v1/tasks',
      `PATCH /api/v1/tasks/${id}`,
      `POST /api/v1/tasks/${id}/cancel`,
      `POST /api/v1/tasks/${id}/review`,
      `POST /api/v1/tasks/${id}/accept`,
      `POST /api/v1/tasks/${id}/start`,
      `POST /api/v1/tasks/${id}/submissions`,
      `POST /api/v1/tasks/${id}/media`,
      'GET /api/v1/tasks/assignees?q=Nig',
      `GET /api/v1/tasks/${id}/problem-media/${id}/url`,
      `POST /api/v1/task-media/${id}/uploaded`,
      `GET /api/v1/task-media/${id}/url`,
    ]);
  });

  it('exposes TASK_ALREADY_TAKEN as an ApiError', async () => {
    const { api } = await authed(() => err(409, 'TASK_ALREADY_TAKEN'));
    await expect(createTaskopApi(api).tasks.accept(id, { at: now })).rejects.toMatchObject({ status: 409, code: 'TASK_ALREADY_TAKEN' });
  });
});

describe('notification endpoints', () => {
  async function authed(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    const store = memoryTokenStore();
    await store.save({ accessToken: 'a1', refreshToken: null });
    return setup(handler, 'mobile', store);
  }
  const now = '2026-11-02T04:00:00.000Z';
  const token = 'ExponentPushToken[abc]';
  const zero = { queued: 0, sent: 0, delivered: 0, failed: 0, skipped: 0 };
  const rule = { type: 'task.assigned', enabled: true, push: true, email: false, notifyAssignees: true, notifyCreator: false, roleIds: [], leadMinutes: null, isDefault: true };
  const summary = {
    id, title: 'Diqqət', body: 'Sabah iclas var.', sender: { id, fullName: 'Elvin' }, sentAt: now, emailRequested: false,
    processed: false, recipientCount: 0, readCount: 0, push: zero, email: zero,
  };
  const item = { id, type: 'manual', title: 'Diqqət', body: 'Sabah iclas var.', targetKind: 'none', targetId: null, targetDate: null, createdAt: now, readAt: null };

  it('builds every path, method and body', async () => {
    const calls: string[] = [];
    const { api } = await authed((url, init) => {
      calls.push(`${init.method} ${url} ${init.body ?? ''}`);
      if (init.method === 'POST' && (url.endsWith('/read') || url.endsWith('/read-all'))) return new Response(null, { status: 204 });
      if (url.includes('/push-devices')) return new Response(null, { status: 204 });
      if (url.endsWith('/unread-count')) return json(200, { count: 2 });
      if (url.includes('/me/notifications')) return json(200, { items: [item], nextCursor: null });
      if (url.endsWith('/me/preferences')) return json(200, { emailNotifications: false });
      if (url.endsWith('/notification-rules')) return json(200, [rule]);
      if (url.includes('/notification-rules/')) return json(200, rule);
      if (url.includes('/messages/options')) return json(200, { users: [{ id, fullName: 'Nigar', jobTitle: null }], teams: [], sites: [] });
      if (url.endsWith('/messages/preview')) return json(200, { recipientCount: 3 });
      if (init.method === 'POST' && url.endsWith('/notifications/messages')) return json(201, summary);
      if (url.includes('/notifications/messages?')) return json(200, { items: [summary], nextCursor: null });
      return json(200, { ...summary, targets: { users: [], teams: [], sites: [] }, recipients: [] });
    });
    const t = createTaskopApi(api);
    expect((await t.notifications.list({ limit: 10, unread: 'true' })).items[0]!.type).toBe('manual');
    expect(await t.notifications.unreadCount()).toEqual({ count: 2 });
    await t.notifications.markRead(id);
    await t.notifications.markAllRead();
    await t.pushDevices.register({ expoToken: token, platform: 'ios' });
    await t.pushDevices.remove(token);
    expect(await t.preferences.update({ emailNotifications: false })).toEqual({ emailNotifications: false });
    expect(await t.notificationRules.list()).toEqual([rule]);
    await t.notificationRules.update('task.assigned', { enabled: true, push: true, email: false, notifyAssignees: true, notifyCreator: false, roleIds: [], leadMinutes: null });
    await t.notificationRules.reset('task.assigned');
    await t.messages.options({ q: 'Nig' });
    expect(await t.messages.preview({ title: 'Diqqət', body: 'Sabah iclas var.', teamIds: [id] })).toEqual({ recipientCount: 3 });
    await t.messages.send({ title: 'Diqqət', body: 'Sabah iclas var.', teamIds: [id] });
    await t.messages.list({ limit: 20 });
    expect((await t.messages.get(id)).recipients).toEqual([]);
    expect(calls).toEqual([
      'GET /api/v1/me/notifications?limit=10&unread=true ',
      'GET /api/v1/me/notifications/unread-count ',
      `POST /api/v1/me/notifications/${id}/read {}`,
      'POST /api/v1/me/notifications/read-all {}',
      `PUT /api/v1/me/push-devices {"expoToken":"${token}","platform":"ios"}`,
      'DELETE /api/v1/me/push-devices/ExponentPushToken%5Babc%5D ',
      'PATCH /api/v1/me/preferences {"emailNotifications":false}',
      'GET /api/v1/notification-rules ',
      'PUT /api/v1/notification-rules/task.assigned {"enabled":true,"push":true,"email":false,"notifyAssignees":true,"notifyCreator":false,"roleIds":[],"leadMinutes":null}',
      'DELETE /api/v1/notification-rules/task.assigned ',
      'GET /api/v1/notifications/messages/options?q=Nig ',
      `POST /api/v1/notifications/messages/preview {"title":"Diqqət","body":"Sabah iclas var.","teamIds":["${id}"]}`,
      `POST /api/v1/notifications/messages {"title":"Diqqət","body":"Sabah iclas var.","teamIds":["${id}"]}`,
      'GET /api/v1/notifications/messages?limit=20 ',
      `GET /api/v1/notifications/messages/${id} `,
    ]);
  });

  it('parses each response with its contract schema', async () => {
    const { api } = await authed((url, init) => {
      if (url.endsWith('/unread-count')) return json(200, { count: -1 });
      if (url.includes('/messages/options')) return json(200, { users: [{ id, fullName: 'Nigar', jobTitle: null }], teams: [], sites: [] });
      if (url.endsWith('/messages/preview')) return json(200, { recipientCount: 3 });
      if (init.method === 'POST' && url.endsWith('/notifications/messages')) return json(201, summary);
      return json(200, { ...rule, type: 'not.a.type' });
    });
    const t = createTaskopApi(api);
    await expect(t.notifications.unreadCount()).rejects.toBeDefined();
    await expect(t.notificationRules.reset('task.assigned')).rejects.toBeDefined();
    expect((await t.messages.options({})).users[0]!.fullName).toBe('Nigar');
    expect((await t.messages.send({ title: 'Diqqət', body: 'Sabah iclas var.', userIds: [id] })).sender?.fullName).toBe('Elvin');
  });

  it('resolves the 204 endpoints to undefined', async () => {
    const { api } = await authed(() => new Response(null, { status: 204 }));
    const t = createTaskopApi(api);
    expect(await t.notifications.markRead(id)).toBeUndefined();
    expect(await t.notifications.markAllRead()).toBeUndefined();
    expect(await t.pushDevices.register({ expoToken: token, platform: 'android' })).toBeUndefined();
    expect(await t.pushDevices.remove(token)).toBeUndefined();
  });

  it('exposes a refused send as an ApiError with its fields', async () => {
    const { api } = await authed(() =>
      json(400, { error: { code: 'VALIDATION_FAILED', messageKey: 'errors.VALIDATION_FAILED', fields: { userIds: 'notifications.issues.tooManyRecipients' }, retryAfterSeconds: null, requestId: 'r1' } }),
    );
    await expect(createTaskopApi(api).messages.send({ title: 'a', body: 'b', siteIds: [id] })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      fields: { userIds: 'notifications.issues.tooManyRecipients' },
    });
  });
});

describe('report endpoints', () => {
  async function authed(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    const store = memoryTokenStore();
    await store.save({ accessToken: 'a1', refreshToken: null });
    return setup(handler, 'web', store);
  }
  const range = { from: '2026-11-02', to: '2026-11-04' };
  const zero = { planned: 0, due: 0, completed: 0, inProgress: 0, pending: 0, overdue: 0, partial: 0, missed: 0, withProblems: 0, withCritical: 0 };
  const summary = { counts: zero, completionPercent: null, averageScore: null, trend: [{ date: '2026-11-02', due: 0, completed: 0, completionPercent: null }] };
  const empty = { items: [], nextCursor: null };
  const problems = { counts: { total: 0, critical: 0, resolution: { none: 0, open: 0, resolved: 0, cancelled: 0 } }, ...empty };
  const tasks = {
    counts: { byStatus: { new: 0, accepted: 0, in_progress: 0, awaiting_review: 0, completed: 0, cancelled: 0 }, overdueOpen: 0, completedOnTime: 0, completedLate: 0 },
    ...empty,
  };
  const csvFile = () =>
    new Response(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]), {
      status: 200,
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="taskop-runs-2026-11-02_2026-11-04.csv"' },
    });

  it('builds every path and query string and parses each response', async () => {
    const calls: string[] = [];
    const { api } = await authed((url, init) => {
      calls.push(`${init.method} ${url}`);
      if (url.includes('/reports/summary')) return json(200, summary);
      if (url.includes('/reports/sites') || url.includes('/reports/employees')) return json(200, []);
      if (url.includes('/reports/runs')) return json(200, empty);
      if (url.includes('/reports/problems')) return json(200, problems);
      return json(200, tasks);
    });
    const r = createTaskopApi(api).reports;
    expect(await r.summary({ ...range, siteId: id })).toEqual(summary);
    expect(await r.sites(range)).toEqual([]);
    expect(await r.employees({ ...range, userId: id })).toEqual([]);
    expect(await r.runs({ ...range, bucket: 'overdue', cursor: id })).toEqual(empty);
    expect(await r.problems({ ...range, severity: 'critical' })).toEqual(problems);
    expect(await r.tasks({ ...range, checklistId: id })).toEqual(tasks);
    expect(calls).toEqual([
      `GET /api/v1/reports/summary?from=2026-11-02&to=2026-11-04&siteId=${id}`,
      'GET /api/v1/reports/sites?from=2026-11-02&to=2026-11-04',
      `GET /api/v1/reports/employees?from=2026-11-02&to=2026-11-04&userId=${id}`,
      `GET /api/v1/reports/runs?from=2026-11-02&to=2026-11-04&bucket=overdue&cursor=${id}`,
      'GET /api/v1/reports/problems?from=2026-11-02&to=2026-11-04&severity=critical',
      `GET /api/v1/reports/tasks?from=2026-11-02&to=2026-11-04&checklistId=${id}`,
    ]);
  });

  it('downloads an export as a Blob named by Content-Disposition', async () => {
    const seen: Array<[string, string]> = [];
    const { api } = await authed((url, init) => {
      seen.push([url, (init.headers as Record<string, string>).Accept!]);
      return csvFile();
    });
    const file = await createTaskopApi(api).reports.export('runs', { ...range, format: 'csv', bucket: 'missed' });
    expect(file.filename).toBe('taskop-runs-2026-11-02_2026-11-04.csv');
    expect(new Uint8Array(await file.blob.arrayBuffer())).toEqual(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]));
    expect(seen).toEqual([['/api/v1/reports/runs/export?from=2026-11-02&to=2026-11-04&format=csv&bucket=missed', '*/*']]);
  });

  it('falls back to the contract file name without Content-Disposition', async () => {
    const { api } = await authed(() => new Response('x', { status: 200 }));
    expect((await createTaskopApi(api).reports.export('full', { ...range, format: 'pdf' })).filename).toBe('taskop-full-2026-11-02_2026-11-04.pdf');
  });

  it('refreshes and retries a download on UNAUTHENTICATED', async () => {
    const { api } = setup((url, init) => {
      if (url.endsWith('/auth/refresh')) return json(200, loginResult('fresh'));
      return (init.headers as Record<string, string>).Authorization === 'Bearer fresh' ? csvFile() : err(401, 'UNAUTHENTICATED');
    });
    expect((await api.download('/reports/runs/export', { query: { ...range, format: 'csv' } })).filename).toBe('taskop-runs-2026-11-02_2026-11-04.csv');
  });

  it('exposes rows and limit on REPORT_TOO_LARGE', async () => {
    const { api } = await authed(() =>
      json(422, { error: { code: 'REPORT_TOO_LARGE', messageKey: 'errors.REPORT_TOO_LARGE', fields: null, retryAfterSeconds: null, requestId: 'r1', rows: 12000, limit: 10000 } }),
    );
    await expect(createTaskopApi(api).reports.export('runs', { ...range, format: 'xlsx' })).rejects.toMatchObject({ status: 422, code: 'REPORT_TOO_LARGE', rows: 12000, limit: 10000 });
  });

  it('reads RFC 6266 file names', () => {
    expect(parseContentDispositionFilename('attachment; filename="a b.csv"')).toBe('a b.csv');
    expect(parseContentDispositionFilename(`attachment; filename*=UTF-8''t%C9%99.csv; filename="t.csv"`)).toBe('tə.csv');
    expect(parseContentDispositionFilename('attachment; filename=plain.pdf')).toBe('plain.pdf');
    expect(parseContentDispositionFilename('attachment')).toBeNull();
    expect(parseContentDispositionFilename(null)).toBeNull();
  });
});
