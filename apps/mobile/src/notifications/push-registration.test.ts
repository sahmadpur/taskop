import { ApiError } from '@taskop/api-client';
import { blockPushRegistration, clearAppBadge, endPushSignOut, PUSH_RETRY_DELAYS_MS, registerPush, startPushRegistration, unregisterPush } from './push-registration';
import { fakeAppState, fakePush, fakePushApi, fakeTokens, PROJECT_ID, PUSH_TOKEN } from './testing/fakes';

const USER = 'user-a';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}

let warn: jest.SpyInstance;
let info: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
  info.mockRestore();
});

describe('registerPush', () => {
  it("creates the channel first, gets the Expo token with the project's id and registers it as this phone", async () => {
    const push = fakePush();
    const tokens = fakeTokens();
    const api = fakePushApi();
    expect(await registerPush({ push, tokens, api })).toBe('registered');
    expect(push.ensureChannel.mock.invocationCallOrder[0]!).toBeLessThan(push.expoToken.mock.invocationCallOrder[0]!);
    expect(push.expoToken).toHaveBeenCalledWith(PROJECT_ID);
    expect(api.pushDevices.register).toHaveBeenCalledWith({ expoToken: PUSH_TOKEN, platform: 'android' });
    expect(tokens.value).toBe(PUSH_TOKEN);
    expect(push.requestPermission).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith('[push] Registered this device');
  });

  it('asks for permission once when the OS has not asked yet', async () => {
    const push = fakePush({ platform: 'ios' });
    push.permission.mockResolvedValue('undetermined');
    const api = fakePushApi();
    expect(await registerPush({ push, tokens: fakeTokens(), api })).toBe('registered');
    expect(push.requestPermission).toHaveBeenCalledTimes(1);
    expect(api.pushDevices.register).toHaveBeenCalledWith({ expoToken: PUSH_TOKEN, platform: 'ios' });
  });

  it('respects a denial silently: no prompt, no token, no request', async () => {
    const push = fakePush();
    push.permission.mockResolvedValue('denied');
    const api = fakePushApi();
    expect(await registerPush({ push, tokens: fakeTokens(), api })).toBe('denied');
    expect(push.requestPermission).not.toHaveBeenCalled();
    expect(push.expoToken).not.toHaveBeenCalled();
    expect(api.pushDevices.register).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('stops when the user declines the prompt', async () => {
    const push = fakePush();
    push.permission.mockResolvedValue('undetermined');
    push.requestPermission.mockResolvedValue('denied');
    expect(await registerPush({ push, tokens: fakeTokens(), api: fakePushApi() })).toBe('denied');
    expect(push.expoToken).not.toHaveBeenCalled();
  });

  it('skips a simulator silently', async () => {
    const push = fakePush({ isDevice: false });
    expect(await registerPush({ push, tokens: fakeTokens(), api: fakePushApi() })).toBe('simulator');
    expect(push.permission).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('skips with a log when the app has no EAS project id yet', async () => {
    const push = fakePush({ projectId: null });
    const api = fakePushApi();
    expect(await registerPush({ push, tokens: fakeTokens(), api })).toBe('noProject');
    expect(api.pushDevices.register).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('eas init'));
  });

  it('never throws: a token or API failure is logged and reported as failed, with nothing stored', async () => {
    const api = fakePushApi();
    api.pushDevices.register.mockRejectedValueOnce(ApiError.network());
    const tokens = fakeTokens();
    expect(await registerPush({ push: fakePush(), tokens, api })).toBe('failed');
    expect(tokens.value).toBeNull();
    const push = fakePush();
    push.expoToken.mockRejectedValueOnce(new Error('Expo unreachable'));
    expect(await registerPush({ push, tokens, api })).toBe('failed');
    expect(warn).toHaveBeenCalledWith('[push] Registration failed; it is tried again later', 'Expo unreachable');
    expect(info).not.toHaveBeenCalled();
  });
});

describe('startPushRegistration', () => {
  it('registers at start and does not repeat once registered', async () => {
    const api = fakePushApi();
    const appState = fakeAppState();
    const stop = startPushRegistration({ push: fakePush(), tokens: fakeTokens(), api, appState, userId: USER });
    await flush();
    appState.emit(true);
    await flush();
    expect(api.pushDevices.register).toHaveBeenCalledTimes(1);
    stop();
    expect(appState.listeners).toBe(0);
  });

  it('tries a failed registration again when the app returns to the foreground', async () => {
    const api = fakePushApi();
    api.pushDevices.register.mockRejectedValueOnce(ApiError.network());
    const tokens = fakeTokens();
    const appState = fakeAppState();
    const stop = startPushRegistration({ push: fakePush(), tokens, api, appState, userId: USER });
    await flush();
    expect(tokens.value).toBeNull();
    appState.emit(false);
    appState.emit(true);
    await flush();
    expect(api.pushDevices.register).toHaveBeenCalledTimes(2);
    expect(tokens.value).toBe(PUSH_TOKEN);
    stop();
  });

  it('never prompts again after a denial, and registers once the user allows push in the settings', async () => {
    const push = fakePush();
    push.permission.mockResolvedValue('denied');
    const api = fakePushApi();
    const appState = fakeAppState();
    const stop = startPushRegistration({ push, tokens: fakeTokens(), api, appState, userId: USER });
    await flush();
    appState.emit(true);
    await flush();
    expect(push.requestPermission).not.toHaveBeenCalled();
    expect(api.pushDevices.register).not.toHaveBeenCalled();
    push.permission.mockResolvedValue('granted');
    appState.emit(true);
    await flush();
    expect(api.pushDevices.register).toHaveBeenCalledTimes(1);
    stop();
  });

  it('runs one attempt at a time', async () => {
    const held = gate();
    const api = fakePushApi();
    api.pushDevices.register.mockImplementationOnce(() => held.opened.then(() => undefined));
    const appState = fakeAppState();
    const stop = startPushRegistration({ push: fakePush(), tokens: fakeTokens(), api, appState, userId: USER });
    await flush();
    appState.emit(true);
    appState.emit(true);
    held.open();
    await flush();
    expect(api.pushDevices.register).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe('blocking registration (sign-out)', () => {
  it('a foreground return after the block does not register, even with a previously failed attempt', async () => {
    const api = fakePushApi();
    api.pushDevices.register.mockRejectedValueOnce(ApiError.network());
    const appState = fakeAppState();
    const stop = startPushRegistration({ push: fakePush(), tokens: fakeTokens(), api, appState, userId: USER });
    await flush();
    expect(api.pushDevices.register).toHaveBeenCalledTimes(1);
    blockPushRegistration();
    appState.emit(true);
    await flush();
    expect(api.pushDevices.register).toHaveBeenCalledTimes(1);
    stop();
  });

  it('an attempt already past its token does not register once the block is set', async () => {
    const held = gate();
    const push = fakePush();
    push.expoToken.mockImplementationOnce(() => held.opened.then(() => PUSH_TOKEN));
    const api = fakePushApi();
    const tokens = fakeTokens();
    const stop = startPushRegistration({ push, tokens, api, appState: fakeAppState(), userId: USER });
    await flush();
    blockPushRegistration();
    held.open();
    await flush();
    expect(api.pushDevices.register).not.toHaveBeenCalled();
    expect(tokens.value).toBeNull();
    stop();
  });

  it('a block set before any attempt keeps registerPush from doing anything', async () => {
    blockPushRegistration();
    const push = fakePush();
    expect(await registerPush({ push, tokens: fakeTokens(), api: fakePushApi() })).toBe('blocked');
    expect(push.permission).not.toHaveBeenCalled();
  });

  it('a sign-in as another user starts registration again', async () => {
    blockPushRegistration();
    const api = fakePushApi();
    const stop = startPushRegistration({ push: fakePush(), tokens: fakeTokens(), api, appState: fakeAppState(), userId: 'user-b' });
    await flush();
    expect(api.pushDevices.register).toHaveBeenCalledTimes(1);
    stop();
  });
});

let lifts = 0;
/** Lifts a sign-out block left by an earlier test: a sign-in as a user nobody was blocked for starts registration again. */
async function liftBlock() {
  const stop = startPushRegistration({ push: fakePush({ isDevice: false }), tokens: fakeTokens(), api: fakePushApi(), appState: fakeAppState(), userId: `lift-${(lifts += 1)}` });
  await flush();
  stop();
}

describe('unregisterPush', () => {
  beforeEach(liftBlock);
  afterEach(() => jest.useRealTimers());

  it("removes this phone's device with the stored token and forgets the token", async () => {
    const push = fakePush();
    const tokens = fakeTokens(PUSH_TOKEN);
    const api = fakePushApi();
    await unregisterPush({ push, tokens, api });
    expect(api.pushDevices.remove).toHaveBeenCalledWith(PUSH_TOKEN);
    expect(tokens.value).toBeNull();
  });

  it('asks nothing when this phone never registered, and never throws when the removal fails', async () => {
    const api = fakePushApi();
    await unregisterPush({ push: fakePush(), tokens: fakeTokens(), api });
    expect(api.pushDevices.remove).not.toHaveBeenCalled();
    api.pushDevices.remove.mockRejectedValueOnce(ApiError.network());
    const tokens = fakeTokens(PUSH_TOKEN);
    await expect(unregisterPush({ push: fakePush(), tokens, api })).resolves.toBeUndefined();
    expect(tokens.value).toBeNull();
  });

  it('gives up on a removal that does not answer within 3 s', async () => {
    jest.useFakeTimers();
    const api = fakePushApi();
    api.pushDevices.remove.mockImplementation(() => new Promise(() => undefined));
    const tokens = fakeTokens(PUSH_TOKEN);
    let finished = false;
    void unregisterPush({ push: fakePush(), tokens, api }).then(() => (finished = true));
    await jest.advanceTimersByTimeAsync(2_999);
    expect(finished).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(finished).toBe(true);
    expect(tokens.value).toBeNull();
  });

  it('shares the 3 s with a registration still running, which it waits for first', async () => {
    jest.useFakeTimers();
    const api = fakePushApi();
    api.pushDevices.register.mockImplementationOnce(() => new Promise(() => undefined));
    api.pushDevices.remove.mockImplementation(() => new Promise(() => undefined));
    const tokens = fakeTokens(PUSH_TOKEN);
    const push = fakePush();
    void registerPush({ push, tokens, api });
    await jest.advanceTimersByTimeAsync(0);
    let finished = false;
    void unregisterPush({ push, tokens, api }).then(() => (finished = true));
    await jest.advanceTimersByTimeAsync(2_999);
    expect(finished).toBe(false);
    // The registration used the whole budget, so the removal gets none: it is given up at once (a 0 ms timer, one tick later).
    await jest.advanceTimersByTimeAsync(2);
    expect(finished).toBe(true);
    expect(api.pushDevices.remove).toHaveBeenCalledTimes(1);
  });

  it('waits for a registration still running, so it cannot re-register a signed-out phone', async () => {
    const held = gate();
    const api = fakePushApi();
    const order: string[] = [];
    api.pushDevices.register.mockImplementationOnce(() => held.opened.then(() => void order.push('register')));
    api.pushDevices.remove.mockImplementationOnce(async () => void order.push('remove'));
    const tokens = fakeTokens();
    const push = fakePush();
    void registerPush({ push, tokens, api });
    await flush();
    const leaving = unregisterPush({ push, tokens, api });
    held.open();
    await leaving;
    expect(order).toEqual(['register', 'remove']);
    expect(api.pushDevices.remove).toHaveBeenCalledWith(PUSH_TOKEN);
    expect(tokens.value).toBeNull();
  });

  it('blocks registration first: a foreground return during sign-out does not re-register, even after an earlier failed attempt', async () => {
    const api = fakePushApi();
    api.pushDevices.register.mockRejectedValueOnce(ApiError.network());
    const held = gate();
    api.pushDevices.remove.mockImplementationOnce(() => held.opened.then(() => undefined));
    const appState = fakeAppState();
    const tokens = fakeTokens(PUSH_TOKEN);
    const stop = startPushRegistration({ push: fakePush(), tokens, api, appState, userId: USER });
    await flush();
    expect(api.pushDevices.register).toHaveBeenCalledTimes(1);
    const leaving = unregisterPush({ push: fakePush(), tokens, api });
    await flush();
    expect(api.pushDevices.remove).toHaveBeenCalledTimes(1);
    appState.emit(false);
    appState.emit(true);
    await flush();
    held.open();
    await leaving;
    expect(api.pushDevices.register).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe('clearAppBadge', () => {
  it('sets the badge to 0 and never throws', async () => {
    const push = fakePush();
    await clearAppBadge(push);
    expect(push.setBadge).toHaveBeenCalledWith(0);
    push.setBadge.mockRejectedValueOnce(new Error('no badges here'));
    await expect(clearAppBadge(push)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[push] Could not clear the app badge', 'no badges here');
  });
});

describe('the sign-out block across sign-ins', () => {
  beforeEach(liftBlock);

  it('a remount for the same user during the sign-out window does not lift the block', async () => {
    const api = fakePushApi();
    const stopFirst = startPushRegistration({ push: fakePush(), tokens: fakeTokens(PUSH_TOKEN), api, appState: fakeAppState(), userId: USER });
    await flush();
    api.pushDevices.register.mockClear();
    await unregisterPush({ push: fakePush(), tokens: fakeTokens(PUSH_TOKEN), api });
    stopFirst();
    const appState = fakeAppState();
    const stopSecond = startPushRegistration({ push: fakePush(), tokens: fakeTokens(), api, appState, userId: USER });
    await flush();
    appState.emit(true);
    await flush();
    expect(api.pushDevices.register).not.toHaveBeenCalled();
    stopSecond();
  });

  it('a different user signing in lifts it', async () => {
    const api = fakePushApi();
    const stopFirst = startPushRegistration({ push: fakePush(), tokens: fakeTokens(), api, appState: fakeAppState(), userId: USER });
    await flush();
    api.pushDevices.register.mockClear();
    await unregisterPush({ push: fakePush(), tokens: fakeTokens(), api });
    stopFirst();
    const stopSecond = startPushRegistration({ push: fakePush(), tokens: fakeTokens(), api, appState: fakeAppState(), userId: 'user-b' });
    await flush();
    expect(api.pushDevices.register).toHaveBeenCalledTimes(1);
    stopSecond();
  });

  it('the same user signing in again lifts it once the logout has finished', async () => {
    const api = fakePushApi();
    const stopFirst = startPushRegistration({ push: fakePush(), tokens: fakeTokens(), api, appState: fakeAppState(), userId: USER });
    await flush();
    api.pushDevices.register.mockClear();
    await unregisterPush({ push: fakePush(), tokens: fakeTokens(), api });
    stopFirst();
    endPushSignOut();
    const stopSecond = startPushRegistration({ push: fakePush(), tokens: fakeTokens(), api, appState: fakeAppState(), userId: USER });
    await flush();
    expect(api.pushDevices.register).toHaveBeenCalledTimes(1);
    stopSecond();
  });
});

describe('stopping the controller', () => {
  beforeEach(liftBlock);

  it("cancels the controller's own attempt that is still waiting for its Expo token", async () => {
    const held = gate();
    const push = fakePush();
    push.expoToken.mockImplementationOnce(() => held.opened.then(() => PUSH_TOKEN));
    const api = fakePushApi();
    const tokens = fakeTokens();
    const stop = startPushRegistration({ push, tokens, api, appState: fakeAppState(), userId: USER });
    await flush();
    stop();
    held.open();
    await flush();
    expect(api.pushDevices.register).not.toHaveBeenCalled();
    expect(tokens.value).toBeNull();
  });

  it('a remount registers once: the new controller does, the stopped one does not', async () => {
    const held = gate();
    const push = fakePush();
    push.expoToken.mockImplementationOnce(() => held.opened.then(() => PUSH_TOKEN));
    const api = fakePushApi();
    const stopFirst = startPushRegistration({ push, tokens: fakeTokens(), api, appState: fakeAppState(), userId: USER });
    await flush();
    stopFirst();
    const stopSecond = startPushRegistration({ push, tokens: fakeTokens(), api, appState: fakeAppState(), userId: USER });
    held.open();
    await flush();
    expect(api.pushDevices.register).toHaveBeenCalledTimes(1);
    stopSecond();
  });
});

describe('trying a failed registration again in the foreground', () => {
  const [first, second, third] = PUSH_RETRY_DELAYS_MS as [number, number, number];
  const tick = (ms: number) => jest.advanceTimersByTimeAsync(ms);

  beforeEach(async () => {
    await liftBlock();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('tries again after 5 s and then 30 s while the app stays in the foreground, and stops once registered', async () => {
    const api = fakePushApi();
    api.pushDevices.register.mockRejectedValueOnce(ApiError.network()).mockRejectedValueOnce(ApiError.network());
    const tokens = fakeTokens();
    const stop = startPushRegistration({ push: fakePush(), tokens, api, appState: fakeAppState(), userId: USER });
    await tick(0);
    expect(api.pushDevices.register).toHaveBeenCalledTimes(1);
    await tick(first - 1);
    expect(api.pushDevices.register).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(api.pushDevices.register).toHaveBeenCalledTimes(2);
    await tick(second);
    expect(api.pushDevices.register).toHaveBeenCalledTimes(3);
    expect(tokens.value).toBe(PUSH_TOKEN);
    expect(info).toHaveBeenCalledTimes(1);
    await tick(10 * 60_000);
    expect(api.pushDevices.register).toHaveBeenCalledTimes(3);
    stop();
  });

  it('stops after the last delay until the next foreground, which starts the delays over', async () => {
    const push = fakePush();
    push.expoToken.mockRejectedValue(new Error('Expo unreachable'));
    const appState = fakeAppState();
    const stop = startPushRegistration({ push, tokens: fakeTokens(), api: fakePushApi(), appState, userId: USER });
    await tick(0);
    await tick(first);
    await tick(second);
    await tick(third);
    expect(push.expoToken).toHaveBeenCalledTimes(4);
    await tick(60 * 60_000);
    expect(push.expoToken).toHaveBeenCalledTimes(4);
    expect(jest.getTimerCount()).toBe(0);
    appState.emit(true);
    await tick(0);
    expect(push.expoToken).toHaveBeenCalledTimes(5);
    await tick(first);
    expect(push.expoToken).toHaveBeenCalledTimes(6);
    stop();
  });

  it('leaving the foreground cancels the pending retry', async () => {
    const api = fakePushApi();
    api.pushDevices.register.mockRejectedValueOnce(ApiError.network());
    const appState = fakeAppState();
    const stop = startPushRegistration({ push: fakePush(), tokens: fakeTokens(), api, appState, userId: USER });
    await tick(0);
    appState.emit(false);
    await tick(10 * 60_000);
    expect(api.pushDevices.register).toHaveBeenCalledTimes(1);
    appState.emit(true);
    await tick(0);
    expect(api.pushDevices.register).toHaveBeenCalledTimes(2);
    stop();
  });

  it('does not try again after a sign-out block', async () => {
    const api = fakePushApi();
    api.pushDevices.register.mockRejectedValueOnce(ApiError.network());
    const stop = startPushRegistration({ push: fakePush(), tokens: fakeTokens(), api, appState: fakeAppState(), userId: USER });
    await tick(0);
    expect(api.pushDevices.register).toHaveBeenCalledTimes(1);
    blockPushRegistration();
    await tick(10 * 60_000);
    expect(api.pushDevices.register).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stopping the controller cancels a pending retry', async () => {
    const api = fakePushApi();
    api.pushDevices.register.mockRejectedValueOnce(ApiError.network());
    const stop = startPushRegistration({ push: fakePush(), tokens: fakeTokens(), api, appState: fakeAppState(), userId: USER });
    await tick(0);
    expect(jest.getTimerCount()).toBe(1);
    stop();
    expect(jest.getTimerCount()).toBe(0);
    await tick(10 * 60_000);
    expect(api.pushDevices.register).toHaveBeenCalledTimes(1);
  });
});
