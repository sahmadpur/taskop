import { capturedPhoto } from './testing/fake-transport';
import { ME, OCC, OTHER } from './testing/fixtures';
import { createTestServices } from './testing/test-services';

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
});
