import type { ExpoPushMessage } from 'expo-server-sdk';
import { describe, expect, it, vi } from 'vitest';
import { type ExpoClientLike, ExpoPushSender, FakePushSender, type PushMessage } from './push-sender';

const data = { notificationId: 'n', userId: 'u', tenantId: 't', type: 'task.assigned', targetKind: 'task', targetId: 'x', targetDate: null } as const;
const message = (to: string): PushMessage => ({ to, title: 'Yeni tapşırıq', body: 'Qapı', data, sound: 'default', channelId: 'default', priority: 'default', badge: 2 });

function client(over: Partial<ExpoClientLike> = {}): ExpoClientLike {
  return {
    chunkPushNotifications: (m) => [m],
    sendPushNotificationsAsync: vi.fn(async (m: ExpoPushMessage[]) => m.map((_, i) => ({ status: 'ok' as const, id: `ticket-${i}` }))),
    chunkPushNotificationReceiptIds: (ids) => [ids],
    getPushNotificationReceiptsAsync: vi.fn(async () => ({})),
    ...over,
  };
}

describe('ExpoPushSender', () => {
  it('sends Expo messages with every field and maps tickets in order', async () => {
    const c = client({
      sendPushNotificationsAsync: vi.fn(async () => [
        { status: 'ok' as const, id: 'a' },
        { status: 'error' as const, message: 'gone', details: { error: 'DeviceNotRegistered' as const } },
        { status: 'error' as const, message: 'odd' },
      ]),
    });
    const tickets = await new ExpoPushSender(c).send([message('ExponentPushToken[1]'), message('ExponentPushToken[2]'), message('ExponentPushToken[3]')]);
    expect(c.sendPushNotificationsAsync).toHaveBeenCalledWith([
      { to: 'ExponentPushToken[1]', title: 'Yeni tapşırıq', body: 'Qapı', data, sound: 'default', channelId: 'default', priority: 'default', badge: 2 },
      expect.objectContaining({ to: 'ExponentPushToken[2]' }),
      expect.objectContaining({ to: 'ExponentPushToken[3]' }),
    ]);
    expect(tickets).toEqual([
      { ok: true, id: 'a' },
      { ok: false, error: 'DeviceNotRegistered', message: 'gone' },
      { ok: false, error: null, message: 'odd' },
    ]);
  });

  it('lets an HTTP failure through, and reads receipts by id', async () => {
    const failing = client({ sendPushNotificationsAsync: vi.fn(async () => Promise.reject(Object.assign(new Error('Too Many Requests'), { statusCode: 429 }))) });
    await expect(new ExpoPushSender(failing).send([message('ExponentPushToken[1]')])).rejects.toThrow('Too Many Requests');
    const c = client({
      getPushNotificationReceiptsAsync: vi.fn(async () => ({
        a: { status: 'ok' as const },
        b: { status: 'error' as const, message: 'gone', details: { error: 'DeviceNotRegistered' as const } },
      })),
    });
    const receipts = await new ExpoPushSender(c).receipts(['a', 'b', 'c']);
    expect([...receipts.entries()]).toEqual([
      ['a', { ok: true }],
      ['b', { ok: false, error: 'DeviceNotRegistered', message: 'gone' }],
    ]);
    expect(await new ExpoPushSender(c).receipts([])).toEqual(new Map());
  });
});

describe('FakePushSender', () => {
  it('records messages and answers with configurable tickets and receipts', async () => {
    const fake = new FakePushSender();
    const [ticket] = await fake.send([message('ExponentPushToken[1]')]);
    expect(ticket).toMatchObject({ ok: true, id: expect.stringMatching(/^ticket-/) });
    expect(fake.sent.map((m) => m.to)).toEqual(['ExponentPushToken[1]']);
    fake.failWith = new Error('down');
    await expect(fake.send([message('x')])).rejects.toThrow('down');
    fake.reset();
    expect(fake.sent).toEqual([]);
    expect([...(await fake.receipts(['r'])).entries()]).toEqual([['r', { ok: true }]]);
  });

  it('holds a send until released', async () => {
    const fake = new FakePushSender();
    const { reached, release } = fake.hold();
    const sending = fake.send([message('ExponentPushToken[1]')]);
    await reached;
    expect(fake.sent).toEqual([]);
    release();
    expect(await sending).toHaveLength(1);
    expect(fake.sent).toHaveLength(1);
    await fake.send([message('ExponentPushToken[2]')]);
    expect(fake.sent).toHaveLength(2);
  });
});
