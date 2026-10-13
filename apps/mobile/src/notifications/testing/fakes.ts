import type { PushPlatform, RegisterPushDeviceInput } from '@taskop/contracts';
import type { AppStatePort } from '@/offline/sync-triggers';
import type { PushPermission, PushPort, PushTokenStore } from '../ports';

/** Test-only: nothing in the app imports this file. */
export const PROJECT_ID = 'f1c3d2a4-5b6c-4d7e-8f90-1a2b3c4d5e6f';
export const PUSH_TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';

export type FakePush = PushPort & { ensureChannel: jest.Mock; permission: jest.Mock; requestPermission: jest.Mock; expoToken: jest.Mock; setBadge: jest.Mock };

/** A real phone with push granted, on Android, with an EAS project id, unless told otherwise. */
export function fakePush(o: { isDevice?: boolean; platform?: PushPlatform; projectId?: string | null } = {}): FakePush {
  return {
    isDevice: o.isDevice ?? true,
    platform: () => o.platform ?? 'android',
    projectId: () => (o.projectId === undefined ? PROJECT_ID : o.projectId),
    ensureChannel: jest.fn(async () => undefined),
    permission: jest.fn(async (): Promise<PushPermission> => 'granted'),
    requestPermission: jest.fn(async (): Promise<PushPermission> => 'granted'),
    expoToken: jest.fn(async (_projectId: string) => PUSH_TOKEN),
    setBadge: jest.fn(async (_count: number) => undefined),
  };
}

export type FakeTokens = PushTokenStore & { value: string | null };

export function fakeTokens(value: string | null = null): FakeTokens {
  const store: FakeTokens = {
    value,
    get: async () => store.value,
    set: async (token) => {
      store.value = token;
    },
    clear: async () => {
      store.value = null;
    },
  };
  return store;
}

export function fakePushApi() {
  return {
    pushDevices: {
      register: jest.fn(async (_body: RegisterPushDeviceInput) => undefined),
      remove: jest.fn(async (_token: string) => undefined),
    },
  };
}

export function fakeAppState(): AppStatePort & { emit(active: boolean): void; readonly listeners: number } {
  const listeners = new Set<(active: boolean) => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit: (active) => listeners.forEach((l) => l(active)),
    get listeners() {
      return listeners.size;
    },
  };
}
