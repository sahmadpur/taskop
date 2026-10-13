import { ApiError } from '@taskop/api-client';
import { blockPushRegistration, registerPush, startPushRegistration } from './push-registration';
import { fakeAppState, fakePush, fakePushApi, fakeTokens, PROJECT_ID, PUSH_TOKEN } from './testing/fakes';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

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
  });
});

describe('startPushRegistration', () => {
  it('registers at start and does not repeat once registered', async () => {
    const api = fakePushApi();
    const appState = fakeAppState();
    const stop = startPushRegistration({ push: fakePush(), tokens: fakeTokens(), api, appState });
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
    const stop = startPushRegistration({ push: fakePush(), tokens, api, appState });
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
    const stop = startPushRegistration({ push, tokens: fakeTokens(), api, appState });
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
    const stop = startPushRegistration({ push: fakePush(), tokens: fakeTokens(), api, appState });
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
    const stop = startPushRegistration({ push: fakePush(), tokens: fakeTokens(), api, appState });
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
    const stop = startPushRegistration({ push, tokens, api, appState: fakeAppState() });
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

  it('a new sign-in starts registration again', async () => {
    blockPushRegistration();
    const api = fakePushApi();
    const stop = startPushRegistration({ push: fakePush(), tokens: fakeTokens(), api, appState: fakeAppState() });
    await flush();
    expect(api.pushDevices.register).toHaveBeenCalledTimes(1);
    stop();
  });
});
