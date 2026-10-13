import { type PushData, pushDataSchema } from '@taskop/contracts';

/** The `data` of a Taskop push (Part 1 `PushData`), or null for anything else. */
export function readPushData(raw: unknown): PushData | null {
  const parsed = pushDataSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** expo-notifications' NotificationBehavior. */
export interface ForegroundBehavior {
  shouldShowBanner: boolean;
  shouldShowList: boolean;
  shouldPlaySound: boolean;
  shouldSetBadge: boolean;
}

/**
 * Spec §7.1 (banner, sound and list in the foreground), limited by decision 5: a push for another user (a shared phone
 * whose last logout failed offline) or for an anonymous app is not shown. Data that is not a Taskop push is shown while signed in.
 */
export function foregroundBehavior(raw: unknown, signedInUserId: string | null): ForegroundBehavior {
  const data = readPushData(raw);
  const show = signedInUserId !== null && (data === null || data.userId === signedInUserId);
  return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: show };
}
