import type { NotificationsApi } from '@taskop/api-client';
import type { AppStatePort } from '@/offline/sync-triggers';
import type { PushPort, PushTokenStore } from './ports';

export interface PushDeps {
  push: PushPort;
  tokens: PushTokenStore;
  api: Pick<NotificationsApi, 'pushDevices'>;
}

/** 'blocked': sign-out blocked the attempt (see `blockPushRegistration`). */
export type RegisterOutcome = 'registered' | 'simulator' | 'denied' | 'noProject' | 'failed' | 'blocked';

/** These end the attempts of this session; after 'denied' or 'failed' the next foreground tries again (decision 6). */
const FINAL: ReadonlySet<RegisterOutcome> = new Set(['registered', 'simulator', 'noProject']);

const message = (e: unknown) => (e instanceof Error ? e.message : 'unknown error');

let inFlight: Promise<RegisterOutcome> | null = null;

/** The registration still running, if any: logout waits for it, so it cannot re-register a signed-out phone. */
export const pendingRegistration = (): Promise<RegisterOutcome> | null => inFlight;

/**
 * Sign-out guard. `blocked` stops every attempt from starting; `epoch` also cancels an attempt that is already running
 * (it started before the block, so it must not register once the block, or a later sign-in, has happened).
 */
let blocked = false;
let epoch = 0;

/**
 * Called by logout before it removes this phone's push registration: no attempt registers the phone from now on, not
 * on a foreground return and not an attempt already waiting for its Expo token. A new sign-in
 * (`startPushRegistration`) lifts the block.
 */
export function blockPushRegistration(): void {
  blocked = true;
  epoch += 1;
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
export function startPushRegistration(deps: PushDeps & { appState: AppStatePort }): () => void {
  // A sign-in: lift the sign-out block, and drop any attempt left over from the previous session.
  blocked = false;
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
    off();
  };
}
