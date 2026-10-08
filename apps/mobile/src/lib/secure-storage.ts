import * as SecureStore from 'expo-secure-store';

export const STORAGE_KEYS = {
  refreshToken: 'taskop.refreshToken',
  me: 'taskop.me',
  orgCode: 'taskop.orgCode',
} as const;

export const secureStorage = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  remove: (key: string) => SecureStore.deleteItemAsync(key),
};
