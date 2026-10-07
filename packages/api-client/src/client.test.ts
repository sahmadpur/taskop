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
