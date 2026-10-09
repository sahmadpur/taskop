import { ApiError } from '@taskop/api-client';
import { iso } from './local-model';
import { createMediaQueue, LOCAL_FILE_KEEP_DAYS, MEDIA_MAX_ATTEMPTS, mediaErrorKey } from './media-queue';
import { capturedPhoto, capturedVideo } from './testing/fake-transport';
import { ME, OCC, T } from './testing/fixtures';
import { createHarness, type Harness } from './testing/harness';

/** Starts, attaches a video (problem draft) then a photo, and marks both registered, as an acknowledged outbox would. */
async function twoMedia(h: Harness) {
  const id = await h.store.start(OCC, ME);
  const video = capturedVideo(h.transport, { capturedAt: '2026-11-02T04:11:00.000Z' });
  const photo = capturedPhoto(h.transport, { capturedAt: '2026-11-02T04:12:00.000Z' });
  const videoId = await h.store.attachMedia(id, video, { itemId: h.c.temp.id, field: 'problem' });
  const photoId = await h.store.attachMedia(id, photo, { itemId: h.c.photo.id, field: 'evidence' });
  await h.db.run('UPDATE media SET registered_at = ?', [T.open]);
  return { id, video, photo, videoId, photoId };
}

const rows = (h: Harness) =>
  h.db.all<{ id: string; uploaded_at: string | null; failed_code: string | null; attempts: number }>('SELECT id, uploaded_at, failed_code, attempts FROM media ORDER BY captured_at');

describe('media queue', () => {
  it('uploads one file at a time, photos before videos, with exactly the ticket headers', async () => {
    const h = await createHarness();
    const m = await twoMedia(h);
    let active = 0;
    let peak = 0;
    h.transport.respond(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return 200;
    });
    expect(await h.mediaQueue.drain()).toBe('ok');
    expect(h.transport.uploads.map((u) => u.uri)).toEqual([m.photo.localUri, m.video.localUri]);
    expect(peak).toBe(1);
    expect(h.transport.uploads[0]).toEqual({
      uri: m.photo.localUri,
      url: `http://files.test/taskop-media/${m.photoId}`,
      headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '250000' },
    });
    expect(h.api.calls.map((c) => [c.method, c.id])).toEqual([
      ['registerMedia', m.id], ['confirmUploaded', m.photoId], ['registerMedia', m.id], ['confirmUploaded', m.videoId],
    ]);
    expect((await rows(h)).every((r) => r.uploaded_at !== null)).toBe(true);
    expect(await h.mediaQueue.counts()).toEqual({ pending: 0, failed: 0 });
  });

  it('resumes after the app is killed mid-upload', async () => {
    const h = await createHarness();
    await twoMedia(h);
    h.transport.respond(() => {
      throw new Error('connection reset');
    });
    expect(await h.mediaQueue.drain()).toBe('retry');
    expect((await rows(h)).map((r) => [r.uploaded_at, r.attempts])).toEqual([[null, 0], [null, 0]]);
    // A new process: a fresh queue over the same database and files.
    h.transport.respond(() => 200);
    const restarted = createMediaQueue({ db: h.db, api: h.api.api, clock: h.clock, transport: h.transport, feed: h.feed });
    expect(await restarted.drain()).toBe('ok');
    expect((await rows(h)).every((r) => r.uploaded_at !== null)).toBe(true);
  });

  it('retries a confirmation that raced the upload and parks the file after 5 attempts', async () => {
    const h = await createHarness();
    const m = await twoMedia(h);
    await h.db.run('DELETE FROM media WHERE id = ?', [m.videoId]);
    h.api.on('confirmUploaded', async () => {
      throw new ApiError(422, 'MEDIA_NOT_FOUND_IN_STORAGE', 'errors.MEDIA_NOT_FOUND_IN_STORAGE');
    });
    for (let i = 1; i < MEDIA_MAX_ATTEMPTS; i++) expect(await h.mediaQueue.drain()).toBe('retry');
    expect(await h.mediaQueue.counts()).toEqual({ pending: 1, failed: 0 });
    expect(await h.mediaQueue.drain()).toBe('retry');
    expect(await h.mediaQueue.counts()).toEqual({ pending: 0, failed: 1 });
    expect((await h.mediaQueue.list())[0]).toMatchObject({ kind: 'photo', failedCode: 'UPLOAD_FAILED', checklistName: 'Açılış yoxlaması' });
    expect(await h.mediaQueue.drain()).toBe('ok');
    h.api.reset('confirmUploaded');
    await h.mediaQueue.retryFailed();
    expect(await h.mediaQueue.drain()).toBe('ok');
    expect(await h.mediaQueue.counts()).toEqual({ pending: 0, failed: 0 });
  });

  it('parks a medium the server refuses and moves on to the next', async () => {
    const h = await createHarness();
    const m = await twoMedia(h);
    h.api.on('registerMedia', async (executionId, b) => {
      if (b.kind === 'photo') throw new ApiError(422, 'EVIDENCE_LIVE_ONLY', 'errors.EVIDENCE_LIVE_ONLY');
      return h.api.defaults.registerMedia(executionId, b);
    });
    expect(await h.mediaQueue.drain()).toBe('ok');
    expect(h.transport.uploads.map((u) => u.uri)).toEqual([m.video.localUri]);
    expect(await h.mediaQueue.list()).toMatchObject([{ id: m.photoId, failedCode: 'EVIDENCE_LIVE_ONLY' }]);
    expect(mediaErrorKey('EVIDENCE_LIVE_ONLY')).toBe('errors.EVIDENCE_LIVE_ONLY');
    expect(mediaErrorKey('FILE_MISSING')).toBe('mobile.sync.mediaErrors.FILE_MISSING');
  });

  it('marks a file missing from the phone as failed and skips the PUT when the server already has the file', async () => {
    const h = await createHarness();
    const m = await twoMedia(h);
    h.transport.files.delete(m.photo.localUri);
    h.api.on('registerMedia', async (executionId, b) => ({ ...(await h.api.defaults.registerMedia(executionId, b)), status: 'uploaded' }));
    expect(await h.mediaQueue.drain()).toBe('ok');
    expect(h.transport.uploads).toEqual([]);
    expect(h.api.calls.map((c) => c.method)).toEqual(['registerMedia']);
    expect((await rows(h)).map((r) => [r.id, r.failed_code, r.uploaded_at !== null])).toEqual([
      [m.videoId, null, true],
      [m.photoId, 'FILE_MISSING', false],
    ]);
  });

  it('deletes a local file only after upload and 7 days after its execution finished syncing', async () => {
    const h = await createHarness();
    const m = await twoMedia(h);
    await h.mediaQueue.drain();
    h.clock.set('2026-12-31T00:00:00.000Z');
    expect(await h.mediaQueue.cleanup()).toBe(0); // the execution has not finished syncing
    h.clock.set(T.open);
    await h.db.run('UPDATE executions SET finished_synced_at = ?', [T.open]);
    h.clock.set(iso(Date.parse(T.open) + LOCAL_FILE_KEEP_DAYS * 86_400_000 - 1));
    expect(await h.mediaQueue.cleanup()).toBe(0);
    h.clock.advance(1);
    expect(await h.mediaQueue.cleanup()).toBe(2);
    expect([...h.transport.removed].sort()).toEqual([m.photo.localUri, m.video.localUri].sort());
    expect(await h.mediaQueue.cleanup()).toBe(0);
  });

  it('counts a ticket without an upload URL as a failed attempt unless the server already has the file', async () => {
    const h = await createHarness();
    const m = await twoMedia(h);
    await h.db.run('DELETE FROM media WHERE id = ?', [m.videoId]);
    h.api.on('registerMedia', async (executionId, b) => ({ ...(await h.api.defaults.registerMedia(executionId, b)), uploadUrl: null, expiresAt: null }));
    expect(await h.mediaQueue.drain()).toBe('retry');
    expect(h.transport.uploads).toEqual([]);
    expect(h.api.calls.map((c) => c.method)).toEqual(['registerMedia']);
    expect((await rows(h)).map((r) => [r.uploaded_at, r.failed_code, r.attempts])).toEqual([[null, null, 1]]);
    h.api.on('registerMedia', async (executionId, b) => ({
      ...(await h.api.defaults.registerMedia(executionId, b)), status: 'uploaded', uploadUrl: null, expiresAt: null,
    }));
    expect(await h.mediaQueue.drain()).toBe('ok');
    expect(h.transport.uploads).toEqual([]);
    expect(h.api.calls.map((c) => c.method)).toEqual(['registerMedia', 'registerMedia']);
    expect((await rows(h))[0]?.uploaded_at).not.toBeNull();
  });

  it.each<[string, (h: Harness) => void]>([
    ['marked uploaded', () => undefined],
    ['counted as an attempt after a bad PUT status', (h) => h.transport.respond(async () => 500)],
    ['counted as an attempt after a racing confirm', (h) => h.api.on('confirmUploaded', async () => {
      throw new ApiError(422, 'MEDIA_NOT_FOUND_IN_STORAGE', 'errors.MEDIA_NOT_FOUND_IN_STORAGE');
    })],
    ['parked after a refused confirm', (h) => h.api.on('confirmUploaded', async () => {
      throw new ApiError(409, 'EXECUTION_NOT_ACTIVE', 'errors.EXECUTION_NOT_ACTIVE');
    })],
  ])('stops for a medium removed mid-upload that would have been %s, and moves on', async (_name, arrange) => {
    const h = await createHarness();
    const m = await twoMedia(h);
    arrange(h);
    h.api.on('registerMedia', async (executionId, b) => {
      if (b.id === m.photoId) await h.db.run('DELETE FROM media WHERE id = ?', [m.photoId]);
      return h.api.defaults.registerMedia(executionId, b);
    });
    await expect(h.mediaQueue.drain()).resolves.toBeDefined();
    const left = await rows(h);
    expect(left.map((r) => r.id)).toEqual([m.videoId]);
    expect(h.api.calls.filter((c) => c.method === 'registerMedia').map((c) => (c.body as { id: string }).id)).toEqual([m.photoId, m.videoId]);
  });
});
