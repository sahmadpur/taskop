import type { PushPlatform } from '@taskop/contracts';

/** Expo push sends every message with channelId 'default' (Part 1); the phone creates the channel. */
export const PUSH_CHANNEL_ID = 'default';

export type PushPermission = 'granted' | 'denied' | 'undetermined';

/** The phone's push capabilities. `native.ts` implements it with expo-notifications; tests use `testing/fakes.ts`. */
export interface PushPort {
  /** False on simulators and emulators: they get no push token. */
  isDevice: boolean;
  platform(): PushPlatform;
  /** The EAS project id from the app config, or null before `eas init`. */
  projectId(): string | null;
  /** Android: creates the 'default' channel (needed before the permission prompt on Android 13+). No-op on iOS. */
  ensureChannel(): Promise<void>;
  permission(): Promise<PushPermission>;
  requestPermission(): Promise<PushPermission>;
  expoToken(projectId: string): Promise<string>;
  setBadge(count: number): Promise<void>;
}

/** The token this phone registered last (SecureStore). */
export interface PushTokenStore {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}

/** A tap on a notification: its identifier (to handle it once) and its data. */
export interface TapResponse {
  identifier: string;
  data: unknown;
}

export interface NotificationEvents {
  /** The tap that launched the app (cold start), until cleared. */
  lastResponse(): TapResponse | null;
  clearLastResponse(): void;
  onResponse(listener: (response: TapResponse) => void): () => void;
  /** A notification received while the app is running. */
  onReceived(listener: (data: unknown) => void): () => void;
}
