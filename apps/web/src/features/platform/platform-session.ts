import { ApiClient, createPlatformApi, memoryTokenStore } from '@taskop/api-client';
import type { PlatformLoginResult } from '@taskop/contracts';
import { useSyncExternalStore } from 'react';

type Admin = PlatformLoginResult['admin'];

// In memory only: a reload requires logging in again.
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
    return () => {
      listeners.delete(listener);
    };
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
