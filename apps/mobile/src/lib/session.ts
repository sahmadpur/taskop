import { ApiClient, ApiError, createTaskopApi, type TokenStore } from '@taskop/api-client';
import { type LoginResult, type Me, meSchema } from '@taskop/contracts';
import { useSyncExternalStore } from 'react';
import { secureStorage, STORAGE_KEYS } from './secure-storage';

export type MobileSession = { status: 'loading' } | { status: 'anonymous' } | { status: 'authenticated'; me: Me; offline: boolean };

let state: MobileSession = { status: 'loading' };
const listeners = new Set<() => void>();
function set(next: MobileSession): void {
  state = next;
  listeners.forEach((l) => l());
}

let accessToken: string | null = null;
const tokenStore: TokenStore = {
  getAccessToken: () => accessToken,
  async save(t) {
    accessToken = t.accessToken;
    if (t.refreshToken) await secureStorage.set(STORAGE_KEYS.refreshToken, t.refreshToken);
  },
  getRefreshToken: () => secureStorage.get(STORAGE_KEYS.refreshToken),
  async clear() {
    accessToken = null;
    await secureStorage.remove(STORAGE_KEYS.refreshToken);
    await secureStorage.remove(STORAGE_KEYS.me);
  },
};

const cacheMe = (me: Me) => secureStorage.set(STORAGE_KEYS.me, JSON.stringify(me));

async function loadCachedMe(): Promise<Me | null> {
  const raw = await secureStorage.get(STORAGE_KEYS.me);
  if (!raw) return null;
  const parsed = meSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

const apiClient = new ApiClient({
  baseUrl: `${process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'}/api/v1`,
  client: 'mobile',
  tokenStore,
  onSessionExpired: () => set({ status: 'anonymous' }),
  onRefreshed: (r) => {
    void cacheMe(r.me);
    set({ status: 'authenticated', me: r.me, offline: false });
  },
});
export const api = createTaskopApi(apiClient);

export const session = {
  get: (): MobileSession => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  async bootstrap(): Promise<void> {
    if (!(await tokenStore.getRefreshToken())) return set({ status: 'anonymous' });
    try {
      const result = await apiClient.refresh();
      if (!result) set({ status: 'anonymous' });
    } catch (e) {
      const cached = e instanceof ApiError && e.code === 'NETWORK' ? await loadCachedMe() : null;
      set(cached ? { status: 'authenticated', me: cached, offline: true } : { status: 'anonymous' });
    }
  },
  async signedIn(result: LoginResult): Promise<void> {
    await tokenStore.save({ accessToken: result.accessToken, refreshToken: result.refreshToken });
    await cacheMe(result.me);
    set({ status: 'authenticated', me: result.me, offline: false });
  },
  async refreshMe(): Promise<void> {
    const me = await api.me();
    await cacheMe(me);
    set({ status: 'authenticated', me, offline: false });
  },
  async signOut(): Promise<void> {
    try {
      await api.auth.logout();
    } catch {
      // Offline or already revoked: local sign-out still has to happen.
    }
    await tokenStore.clear();
    set({ status: 'anonymous' });
  },
  rememberOrgCode: (code: string) => secureStorage.set(STORAGE_KEYS.orgCode, code),
  getOrgCode: () => secureStorage.get(STORAGE_KEYS.orgCode),
};

export function useSession(): MobileSession {
  return useSyncExternalStore(session.subscribe, session.get);
}
