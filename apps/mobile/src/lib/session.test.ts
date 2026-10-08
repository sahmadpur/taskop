const mockStore = new Map<string, string>();
jest.mock('./secure-storage', () => ({
  STORAGE_KEYS: { refreshToken: 'taskop.refreshToken', me: 'taskop.me', orgCode: 'taskop.orgCode' },
  secureStorage: {
    get: jest.fn(async (k: string) => mockStore.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
    remove: jest.fn(async (k: string) => void mockStore.delete(k)),
  },
}));

const id = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f';
const me = {
  user: { id, fullName: 'Elvin Məmmədov', jobTitle: null, kind: 'worker', email: null, username: 'elvin', emailVerified: false, credentialKind: 'pin' },
  role: { id, name: 'Worker', systemKey: 'worker', dataScope: 'own' },
  permissions: [],
  tenant: { id, name: 'Acme', orgCode: 'acme', timezone: 'Asia/Baku', locale: 'az' },
};
const json = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body, clone() { return this; } }) as unknown as Response;

let session: typeof import('./session').session;

beforeEach(() => {
  mockStore.clear();
  jest.resetModules();
  global.fetch = jest.fn();
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh module graph per test
  ({ session } = require('./session') as typeof import('./session'));
});

describe('mobile session', () => {
  it('is anonymous without a stored refresh token', async () => {
    await session.bootstrap();
    expect(session.get()).toEqual({ status: 'anonymous' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('restores the session through refresh and caches the profile', async () => {
    mockStore.set('taskop.refreshToken', 'r1');
    (global.fetch as jest.Mock).mockResolvedValue(json(200, { accessToken: 'a', accessTokenExpiresAt: '2026-10-07T10:00:00.000Z', refreshToken: 'r2', me }));
    await session.bootstrap();
    expect(session.get()).toMatchObject({ status: 'authenticated', offline: false });
    expect(mockStore.get('taskop.refreshToken')).toBe('r2');
    expect(JSON.parse(mockStore.get('taskop.me')!).user.username).toBe('elvin');
  });

  it('restores the cached profile when offline', async () => {
    mockStore.set('taskop.refreshToken', 'r1');
    mockStore.set('taskop.me', JSON.stringify(me));
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));
    await session.bootstrap();
    expect(session.get()).toMatchObject({ status: 'authenticated', offline: true });
    expect(mockStore.get('taskop.refreshToken')).toBe('r1');
  });

  it('falls back to the cached profile offline when refresh fails with a 5xx', async () => {
    mockStore.set('taskop.refreshToken', 'r1');
    mockStore.set('taskop.me', JSON.stringify(me));
    (global.fetch as jest.Mock).mockResolvedValue(
      json(503, { error: { code: 'INTERNAL', messageKey: 'errors.INTERNAL', fields: null, retryAfterSeconds: null, requestId: null } }),
    );
    await session.bootstrap();
    expect(session.get()).toMatchObject({ status: 'authenticated', offline: true });
    expect(mockStore.get('taskop.refreshToken')).toBe('r1');
  });

  it('is anonymous (not stuck loading) when the cached profile is corrupt and the network fails', async () => {
    mockStore.set('taskop.refreshToken', 'r1');
    mockStore.set('taskop.me', '{not json');
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));
    await session.bootstrap();
    expect(session.get()).toEqual({ status: 'anonymous' });
  });

  it('clears storage when refresh is rejected', async () => {
    mockStore.set('taskop.refreshToken', 'r1');
    mockStore.set('taskop.me', JSON.stringify(me));
    (global.fetch as jest.Mock).mockResolvedValue(
      json(401, { error: { code: 'UNAUTHENTICATED', messageKey: 'errors.UNAUTHENTICATED', fields: null, retryAfterSeconds: null, requestId: null } }),
    );
    await session.bootstrap();
    expect(session.get()).toEqual({ status: 'anonymous' });
    expect(mockStore.has('taskop.refreshToken')).toBe(false);
    expect(mockStore.has('taskop.me')).toBe(false);
  });

  it('signs out locally even when the server is unreachable', async () => {
    await session.signedIn({ accessToken: 'a', accessTokenExpiresAt: '2026-10-07T10:00:00.000Z', refreshToken: 'r1', me } as never);
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));
    await session.signOut();
    expect(session.get()).toEqual({ status: 'anonymous' });
    expect(mockStore.has('taskop.refreshToken')).toBe(false);
  });

  it('remembers the org code', async () => {
    await session.rememberOrgCode('acme');
    expect(await session.getOrgCode()).toBe('acme');
  });
});
