import { ApiClient, createTaskopApi, type TokenStore } from '@taskop/api-client';
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

/** A profile cached before sub-project 6 has no emailNotifications; the server's default (true) stands in until the next refresh. */
function withPreferenceDefaults(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const user = (raw as { user?: unknown }).user;
  if (typeof user !== 'object' || user === null || 'emailNotifications' in user) return raw;
  return { ...raw, user: { ...user, emailNotifications: true } };
}

async function loadCachedMe(): Promise<Me | null> {
  const raw = await secureStorage.get(STORAGE_KEYS.me);
  if (!raw) return null;
  try {
    const parsed = meSchema.safeParse(withPreferenceDefaults(JSON.parse(raw)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A request that has not settled by then counts as a network failure, so sync, logout and a user switch never hang on it. */
export const API_TIMEOUT_MS = 30_000;

const apiClient = new ApiClient({
  baseUrl: `${process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'}/api/v1`,
  client: 'mobile',
  tokenStore,
  timeoutMs: API_TIMEOUT_MS,
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
    } catch {
      // refresh() only throws for non-rejections (network, 5xx, 429, internal): keep the session and go offline.
      const cached = await loadCachedMe();
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
  /** Applies a change the server confirmed (PATCH /me/preferences) to the signed-in profile and its offline copy. */
  async patchUser(patch: Partial<Me['user']>): Promise<void> {
    if (state.status !== 'authenticated') return;
    const me: Me = { ...state.me, user: { ...state.me.user, ...patch } };
    set({ ...state, me });
    await cacheMe(me).catch((e: unknown) => console.warn('[session] Could not cache the profile', e instanceof Error ? e.message : 'unknown error'));
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
  /**
   * Ends the session in memory when signOut() failed (secure storage): the local data is already deleted and the offline
   * services stopped, so staying signed in would lose any later work. Removing the stored tokens is retried, best effort.
   */
  forceSignedOut(): void {
    accessToken = null;
    set({ status: 'anonymous' });
    void tokenStore.clear().catch(() => undefined);
  },
  rememberOrgCode: (code: string) => secureStorage.set(STORAGE_KEYS.orgCode, code),
  getOrgCode: () => secureStorage.get(STORAGE_KEYS.orgCode),
};

export function useSession(): MobileSession {
  return useSyncExternalStore(session.subscribe, session.get);
}
