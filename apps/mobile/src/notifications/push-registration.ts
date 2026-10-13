import type { NotificationsApi } from '@taskop/api-client';
import type { AppStatePort } from '@/offline/sync-triggers';
import type { PushPort, PushTokenStore } from './ports';
import { settleWithin } from './settle-within';

export interface PushDeps {
  push: PushPort;
  tokens: PushTokenStore;
  api: Pick<NotificationsApi, 'pushDevices'>;
}

/** 'blocked': the attempt was cancelled by a sign-out block or by its controller stopping (see `blockPushRegistration`). */
export type RegisterOutcome = 'registered' | 'simulator' | 'denied' | 'noProject' | 'failed' | 'blocked';

/** These end the attempts of this session; after 'denied' or 'failed' the next foreground tries again (decision 6). */
const FINAL: ReadonlySet<RegisterOutcome> = new Set(['registered', 'simulator', 'noProject']);

const message = (e: unknown) => (e instanceof Error ? e.message : 'unknown error');

let inFlight: Promise<RegisterOutcome> | null = null;

/** The registration still running, if any: logout waits for it, so it cannot re-register a signed-out phone. */
export const pendingRegistration = (): Promise<RegisterOutcome> | null => inFlight;

/**
 * Sign-out guard. `blocked` stops every attempt from starting; `epoch` also cancels an attempt that is already running
 * (it started before the block, so it must not register once the block, a stop, or a later sign-in, has happened).
 */
let blocked = false;
let epoch = 0;
/** The user whose controller started last, i.e. the signed-in user; the user a sign-out block is for. */
let activeUser: string | null = null;
let blockedUser: string | null = null;

/**
 * Called by logout before it removes this phone's push registration: no attempt registers the phone from now on, not
 * on a foreground return and not an attempt already waiting for its Expo token. The block is for the signed-in user:
 * a controller restarted for the same user during the sign-out window (a provider remount) leaves it in place, and a
 * sign-in as another user (`startPushRegistration`), or `endPushSignOut`, lets the next start lift it.
 */
export function blockPushRegistration(): void {
  blocked = true;
  blockedUser = activeUser;
  epoch += 1;
}

/** Logout is over (signed out, or it failed and the user stays signed in): the same user may sign in again and register. */
export function endPushSignOut(): void {
  blockedUser = null;
}

async function attempt({ push, tokens, api }: PushDeps): Promise<RegisterOutcome> {
  const mine = epoch;
  const cancelled = () => blocked || epoch !== mine;
  if (cancelled()) return 'blocked';
  if (!push.isDevice) return 'simulator';
  try {
    await push.ensureChannel();
    let permission = await push.permission();
    // Asked once: only while the OS has not asked yet. A denial is respected (spec §7.2).
    if (permission === 'undetermined') permission = await push.requestPermission();
    if (permission !== 'granted') return 'denied';
    const projectId = push.projectId();
    if (!projectId) {
      console.warn('[push] The app config has no EAS projectId (run `eas init`); push registration is skipped');
      return 'noProject';
    }
    const expoToken = await push.expoToken(projectId);
    if (cancelled()) return 'blocked';
    await api.pushDevices.register({ expoToken, platform: push.platform() });
    await tokens.set(expoToken);
    return 'registered';
  } catch (e) {
    console.warn('[push] Registration failed; it is tried again later', message(e));
    return 'failed';
  }
}

/** Spec §7.2: PUT /me/push-devices with this phone's Expo token. Never rejects and never blocks the caller's flow. */
export function registerPush(deps: PushDeps): Promise<RegisterOutcome> {
  const run: Promise<RegisterOutcome> = attempt(deps).finally(() => {
    if (inFlight === run) inFlight = null;
  });
  inFlight = run;
  return run;
}

/** Registers now (app start or login) and at each return to the foreground until an outcome is final. */
export function startPushRegistration(deps: PushDeps & { appState: AppStatePort; userId: string }): () => void {
  // A sign-in lifts the sign-out block, but a restart for the very user being signed out does not. Either way an
  // attempt left over from before (the previous session, or a controller that was replaced) is dropped.
  if (blocked && blockedUser !== deps.userId) blocked = false;
  activeUser = deps.userId;
  epoch += 1;
  let done = false;
  let running = false;
  let stopped = false;
  const tryOnce = () => {
    if (done || running || stopped || blocked) return;
    running = true;
    void registerPush(deps).then((outcome) => {
      done = FINAL.has(outcome);
      running = false;
    });
  };
  const off = deps.appState.subscribe((active) => {
    if (active) tryOnce();
  });
  tryOnce();
  return () => {
    stopped = true;
    epoch += 1; // Its own attempt, if still waiting, must not register after the controller is gone.
    off();
  };
}

/** Spec §7.2 "best-effort with a short timeout": logout waits at most this long for the device removal in total. */
export const PUSH_REMOVE_TIMEOUT_MS = 3_000;

/**
 * Logout, before the session ends (the request still carries this user's token). Blocks registration first so nothing
 * re-registers the phone while it signs out, waits for a registration still running, then DELETE
 * /me/push-devices/:token with the stored token and forgets it, all within `timeoutMs`. Never rejects. A removal that
 * fails is covered by the next sign-in's token claim.
 */
export async function unregisterPush({ tokens, api }: PushDeps, timeoutMs = PUSH_REMOVE_TIMEOUT_MS): Promise<void> {
  blockPushRegistration();
  const deadline = Date.now() + timeoutMs;
  const left = () => Math.max(deadline - Date.now(), 0);
  const running = pendingRegistration();
  if (running) await settleWithin(running, left());
  let token: string | null = null;
  try {
    token = await tokens.get();
  } catch (e) {
    console.warn('[push] Could not read the stored push token', message(e));
  }
  if (token) {
    const removed = await settleWithin(api.pushDevices.remove(token), left());
    if (removed !== 'done') console.warn(`[push] The device was not removed (${removed}); the next sign-in on this phone claims it`);
  }
  await tokens.clear().catch((e: unknown) => console.warn('[push] Could not forget the push token', message(e)));
}

/**
 * Logout, after the local data is cleared: the app badge back to 0. Last on purpose, so a sync that finished while the
 * data was being cleared cannot bring the old count back. Never rejects.
 */
export async function clearAppBadge(push: Pick<PushPort, 'setBadge'>): Promise<void> {
  await push.setBadge(0).catch((e: unknown) => console.warn('[push] Could not clear the app badge', message(e)));
}
