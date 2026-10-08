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
  onSessionExpired: () => {
    queryClient.clear();
    set({ status: 'anonymous' });
  },
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
    // Never let a previous (expired or other) user's cached data survive into the new session.
    queryClient.clear();
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
