import type { Db } from './db';
import { capturedPhoto } from './testing/fake-transport';
import { ME, myExecution, OCC, occurrence, OTHER, syncResponse, versionOf } from './testing/fixtures';
import { createTestServices, type TestServices } from './testing/test-services';

/** A promise the test resolves by hand, to hold an API call in flight. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}

/** Logs out while a sync call is held in flight, past the 10 s shutdown wait; then, optionally, B signs in on the same phone. */
async function logOutDuringCall(a: TestServices, nextUser: string | null): Promise<TestServices | null> {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const clearing = a.services.clearAll();
  await jest.advanceTimersByTimeAsync(10_000);
  await clearing;
  return nextUser ? createTestServices({ db: a.db, transport: a.transport, userId: nextUser }) : null;
}

/** Records every write statement from now on, in or out of a transaction. */
function recordWrites(db: Db): string[] {
  const writes: string[] = [];
  const record = (run: Db['run']): Db['run'] => (sql, params) => {
    writes.push(sql);
    return run(sql, params);
  };
  const original = { run: db.run, transaction: db.transaction };
  db.run = record(original.run);
  db.transaction = (<T>(fn: (tx: Db) => Promise<T>) => original.transaction((tx) => fn({ ...tx, run: record(tx.run) }))) as Db['transaction'];
  return writes;
}

const counts = (db: Db) =>
  db.first(
    `SELECT (SELECT count(*) FROM occurrences) AS occurrences, (SELECT count(*) FROM executions) AS executions,
            (SELECT count(*) FROM checklist_versions) AS versions, (SELECT count(*) FROM media) AS media, (SELECT count(*) FROM outbox) AS outbox`,
  );
const meta = (db: Db) => db.all('SELECT key, value FROM meta ORDER BY key');
const EMPTY = { occurrences: 0, executions: 0, versions: 0, media: 0, outbox: 0 };

describe('offline services', () => {
  it("signing in as another user clears the previous user's unsynced data and never sends it", async () => {
    const a = await createTestServices();
    await a.seed();
    const id = await a.services.store.start(OCC, ME);
    const photo = capturedPhoto(a.transport);
    await a.services.store.attachMedia(id, photo, { itemId: a.c.photo.id, field: 'evidence' });
    await a.services.dispose();

    const b = await createTestServices({ db: a.db, transport: a.transport, userId: OTHER, online: true });
    expect(await b.services.store.occurrences()).toEqual([]);
    expect(await b.services.store.unsyncedCount()).toBe(0);
    expect(await b.db.first('SELECT count(*) AS n FROM outbox')).toEqual({ n: 0 });
    expect(a.transport.removed).toEqual([photo.localUri]);
    await b.services.syncNow('manual');
    expect(b.api.calls.map((c) => c.method)).toEqual(['pull']);
  });

  it('signing in again as the same user keeps the unsynced data', async () => {
    const a = await createTestServices();
    await a.seed();
    await a.services.store.start(OCC, ME);
    await a.services.dispose();
    const again = await createTestServices({ db: a.db, transport: a.transport });
    expect(await again.services.store.unsyncedCount()).toBe(1);
  });

  it('claims at once when online', async () => {
    const t = await createTestServices({ online: true });
    await t.seed();
    await t.services.store.start(OCC, ME);
    await t.services.engine.idle();
    expect(t.api.calls.map((c) => c.method)).toEqual(['claim', 'pull']);
  });

  it('clearAll stops syncing and deletes every row and file', async () => {
    const t = await createTestServices();
    await t.seed();
    const id = await t.services.store.start(OCC, ME);
    const photo = capturedPhoto(t.transport);
    await t.services.store.attachMedia(id, photo, { itemId: t.c.photo.id, field: 'evidence' });
    await t.services.clearAll();
    expect(await t.services.store.occurrences()).toEqual([]);
    expect(await t.services.store.unsyncedCount()).toBe(0);
    expect(t.transport.removed).toContain(photo.localUri);
    t.net.online = true;
    await t.services.syncNow('manual');
    expect(t.api.calls).toEqual([]);
  });

  it('stops waiting for a sync that never settles after 10 s, so logout still clears', async () => {
    jest.useFakeTimers();
    try {
      const t = await createTestServices({ online: true });
      await t.seed();
      t.api.on('pull', () => new Promise(() => undefined));
      void t.services.syncNow('manual');
      await jest.advanceTimersByTimeAsync(0);
      expect(t.services.engine.status().running).toBe(true);
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      let cleared = false;
      const clearing = t.services.clearAll().then(() => {
        cleared = true;
      });
      await jest.advanceTimersByTimeAsync(9_999);
      expect(cleared).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      await clearing;
      expect(await t.services.store.occurrences()).toEqual([]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('[offline]'));
      warn.mockRestore();
    } finally {
      jest.useRealTimers();
    }
  });

  describe('a sync result that lands after the signed-in user changed', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    /** A's pull held in flight, answered with A's occurrence, execution and checklist version. */
    async function pullInFlight() {
      const a = await createTestServices({ online: true });
      await a.seed();
      const entered = gate();
      const release = gate();
      a.api.on('pull', async () => {
        entered.open();
        await release.opened;
        return syncResponse({
          serverTime: '2026-11-02T04:08:00.000Z',
          occurrences: [occurrence()],
          checklistVersions: [versionOf(a.c.content)],
          executions: [myExecution()],
        });
      });
      void a.services.syncNow('manual');
      await entered.opened;
      return { a, release };
    }

    it("a pull leaves none of A's data in B's store and keeps B's clock fields untouched", async () => {
      const { a, release } = await pullInFlight();
      const b = (await logOutDuringCall(a, OTHER))!;
      release.open();
      await a.services.engine.idle();
      expect(await counts(b.db)).toEqual(EMPTY);
      expect(await meta(b.db)).toEqual([{ key: 'userId', value: OTHER }]);
      expect(await b.services.store.occurrences()).toEqual([]);
    });

    it('a pull after a logout with no new user leaves the store empty', async () => {
      const { a, release } = await pullInFlight();
      await logOutDuringCall(a, null);
      release.open();
      await a.services.engine.idle();
      expect(await counts(a.db)).toEqual(EMPTY);
      expect(await meta(a.db)).toEqual([]);
    });

    it('an answers acknowledgement writes nothing', async () => {
      const a = await createTestServices({ online: true });
      await a.seed();
      const id = await a.services.store.start(OCC, ME);
      await a.services.engine.idle();
      await a.services.store.patchAnswer(id, a.c.temp.id, { number: 5 });
      const entered = gate();
      const release = gate();
      a.api.on('saveAnswers', async (executionId, body) => {
        entered.open();
        await release.opened;
        return a.api.defaults.saveAnswers(executionId, body);
      });
      void a.services.syncNow('manual');
      await entered.opened;
      await logOutDuringCall(a, OTHER);
      const writes = recordWrites(a.db);
      release.open();
      await a.services.engine.idle();
      expect(writes).toEqual([]);
    });

    it('a media confirmation writes nothing and deletes no file', async () => {
      const a = await createTestServices({ online: true });
      await a.seed();
      const id = await a.services.store.start(OCC, ME);
      await a.services.engine.idle();
      await a.services.store.attachMedia(id, capturedPhoto(a.transport), { itemId: a.c.photo.id, field: 'evidence' });
      const entered = gate();
      const release = gate();
      a.api.on('confirmUploaded', async (mediaId) => {
        entered.open();
        await release.opened;
        return a.api.defaults.confirmUploaded(mediaId);
      });
      void a.services.syncNow('manual');
      await entered.opened;
      await logOutDuringCall(a, OTHER);
      const writes = recordWrites(a.db);
      const removed = a.transport.removed.length;
      release.open();
      await a.services.engine.idle();
      expect(writes).toEqual([]);
      expect(a.transport.removed).toHaveLength(removed);
    });
  });
});
