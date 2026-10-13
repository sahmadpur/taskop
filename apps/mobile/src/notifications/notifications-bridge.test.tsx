import '@/lib/i18n';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { NotificationsBridge } from './notifications-bridge';
import { PUSH_TOKEN } from './testing/fakes';

const mockRegister = jest.fn();
jest.mock('@/lib/session', () => ({
  api: { pushDevices: { register: (...a: unknown[]) => mockRegister(...a), remove: jest.fn() } },
  useSession: () => ({ status: 'authenticated', offline: false, me: { permissions: [] } }),
}));
jest.mock('@/notifications/native', () => {
  const { fakePush, fakeTokens } = jest.requireActual<typeof import('./testing/fakes')>('./testing/fakes');
  return { nativePush: fakePush(), pushTokenStore: fakeTokens() };
});
jest.mock('@/offline/native/ports', () => ({ rnAppState: () => ({ subscribe: () => () => undefined }) }));

beforeEach(() => {
  mockRegister.mockReset();
  mockRegister.mockResolvedValue(undefined);
});

describe('NotificationsBridge', () => {
  it('registers this phone for push once the signed-in app has opened, without waiting on anything', async () => {
    const t = await createTestServices();
    await renderWithServices(t.services, <NotificationsBridge />);
    await eventually(async () => expect(mockRegister).toHaveBeenCalledWith({ expoToken: PUSH_TOKEN, platform: 'android' }));
  });
});
