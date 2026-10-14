import { ApiError } from '@taskop/api-client';
import { applyPull } from './sync-pull';
import { syncResponse, T } from './testing/fixtures';
import { openTestDb } from './testing/node-db';
import { createTestServices } from './testing/test-services';
import { readUnreadNotifications } from './unread';

describe('unread notifications', () => {
  it('keeps the count of the last sync in the local store', async () => {
    const db = await openTestDb();
    expect(await readUnreadNotifications(db)).toBe(0);
    await applyPull(db, syncResponse({ unreadNotifications: 7 }), 0, Date.parse(T.open));
    expect(await readUnreadNotifications(db)).toBe(7);
    await applyPull(db, syncResponse({ unreadNotifications: 0 }), 0, Date.parse(T.open));
    expect(await readUnreadNotifications(db)).toBe(0);
  });

  it('hands every pulled count to the app badge, and nothing when the pull fails', async () => {
    const t = await createTestServices({ online: true });
    t.api.sync = syncResponse({ occurrences: [], unreadNotifications: 4 });
    await t.services.syncNow('manual');
    expect(await readUnreadNotifications(t.db)).toBe(4);
    expect(t.unread).toEqual([4]);
    t.api.sync = syncResponse({ occurrences: [], unreadNotifications: 0 });
    await t.services.syncNow('manual');
    expect(t.unread).toEqual([4, 0]);
    t.api.on('pull', async () => {
      throw ApiError.network();
    });
    await t.services.syncNow('manual');
    expect(t.unread).toEqual([4, 0]);
    await t.services.dispose();
  });

  it('stores a count the inbox read, and nothing once the user has logged out', async () => {
    const t = await createTestServices();
    await t.services.setUnreadNotifications(2);
    expect(await readUnreadNotifications(t.db)).toBe(2);
    expect(t.unread).toEqual([2]);
    await t.services.clearAll();
    expect(await readUnreadNotifications(t.db)).toBe(0);
    await t.services.setUnreadNotifications(5);
    expect(await readUnreadNotifications(t.db)).toBe(0);
    expect(t.unread).toEqual([2]);
  });

  describe('after the engine stopped', () => {
    /** A pull held in flight that answers with a count of 9. */
    async function pullInFlight() {
      const t = await createTestServices({ online: true });
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let entered!: () => void;
      const hasEntered = new Promise<void>((resolve) => (entered = resolve));
      t.api.on('pull', async () => {
        entered();
        await released;
        return syncResponse({ occurrences: [], unreadNotifications: 9 });
      });
      void t.services.syncNow('manual');
      await hasEntered;
      return { t, release };
    }

    it('a pull that lands after the services shut down leaves the stored count and the badge untouched', async () => {
      const { t, release } = await pullInFlight();
      await t.services.setUnreadNotifications(3);
      const stopping = t.services.dispose();
      release();
      await stopping;
      await t.services.engine.idle();
      expect(await readUnreadNotifications(t.db)).toBe(3);
      expect(t.unread).toEqual([3]);
    });

    it('a pull that lands after a logout leaves no count and does not touch the badge', async () => {
      jest.useFakeTimers();
      try {
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { t, release } = await pullInFlight();
        const clearing = t.services.clearAll();
        await jest.advanceTimersByTimeAsync(10_000);
        await clearing;
        release();
        await t.services.engine.idle();
        expect(await readUnreadNotifications(t.db)).toBe(0);
        expect(t.unread).toEqual([]);
      } finally {
        jest.useRealTimers();
      }
    });

    it('an inbox count that arrives after the services shut down is dropped', async () => {
      const t = await createTestServices();
      await t.services.dispose();
      await t.services.setUnreadNotifications(6);
      expect(await readUnreadNotifications(t.db)).toBe(0);
      expect(t.unread).toEqual([]);
    });
  });
});
