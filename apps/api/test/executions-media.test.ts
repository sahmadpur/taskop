import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { answersBody, claimBody, claimOk, executionWorld, photoBody, publishNextVersion, registerPhoto } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { type Api, MONDAY_0800 } from './scheduling-fixtures';

describe('media registration (POST /executions/:id/media)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  /** İşçi 1 started at 08:10 Baku; now is 08:20. */
  async function started() {
    const w = await executionWorld(t);
    clock.set('2026-11-02T04:20:00Z');
    const executionId = await claimOk(w.workers[0].api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    return { w, executionId, api: w.workers[0].api };
  }
  const register = (api: Api, executionId: string, body: object) => api.post(`/api/v1/executions/${executionId}/media`, body);

  it('registers a pending photo and returns a presigned PUT against the public host; a repeat gives a fresh URL', async () => {
    const { w, executionId, api } = await started();
    const body = photoBody(w.c.photo.id);
    const res = await register(api, executionId, body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ mediaId: body.id, status: 'pending', headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '1000' } });
    const key = `t/${w.s.tenantId}/e/${executionId}/${body.id}.jpg`;
    expect(res.body.uploadUrl.startsWith(`http://files.taskop.test/taskop-media/${key}?`)).toBe(true);
    const row = await ownerQuery('select status, captured_by_user_id, item_id, storage_key, source from execution_media where id = $1', [body.id]);
    expect(row.rows[0]).toEqual({ status: 'pending', captured_by_user_id: w.workers[0].id, item_id: w.c.photo.id, storage_key: key, source: 'camera' });
    const again = await register(api, executionId, body);
    expect([again.status, again.body.mediaId]).toEqual([200, body.id]);
    expect((await ownerQuery('select id from execution_media where execution_id = $1', [executionId])).rowCount).toBe(1);
  });

  it.each([
    ['a GIF', { mime: 'image/gif' }, 'MEDIA_TYPE_INVALID'],
    ['a video on a photo item', { kind: 'video', mime: 'video/mp4', durationMs: 5000, width: 1280, height: 720 }, 'MEDIA_TYPE_INVALID'],
    ['a photo over 5 MB', { bytes: 5 * 1024 * 1024 + 1 }, 'MEDIA_TOO_LARGE'],
    ['a video over 60 s', { itemId: null, kind: 'video', mime: 'video/mp4', durationMs: 60_001, width: 1280, height: 720 }, 'MEDIA_TOO_LARGE'],
    ['a 1080p video', { itemId: null, kind: 'video', mime: 'video/mp4', durationMs: 10_000, width: 1920, height: 1080 }, 'MEDIA_TOO_LARGE'],
    ['a gallery photo on a live-only item', { source: 'gallery' }, 'EVIDENCE_LIVE_ONLY'],
  ])('refuses %s', async (_name, extra, code) => {
    const { w, executionId, api } = await started();
    const res = await register(api, executionId, photoBody(w.c.photo.id, extra));
    expect([res.status, res.body.error.code]).toEqual([422, code]);
  });

  it('caps stored media per item at max(3 × the limit, 10) and refuses evidence the item does not take', async () => {
    const { w, executionId, api } = await started();
    // maxCount 2 → room for 10 registrations (retakes); the exact maxCount is checked on the answers.
    for (let i = 0; i < 10; i++) expect((await register(api, executionId, photoBody(w.c.photo.id))).status).toBe(200);
    const eleventh = await register(api, executionId, photoBody(w.c.photo.id));
    expect([eleventh.status, eleventh.body.error.code]).toEqual([422, 'MEDIA_LIMIT_REACHED']);
    expect((await register(api, executionId, photoBody(w.c.note.id))).body.error.code).toBe('MEDIA_LIMIT_REACHED');
    // The problem item takes photo evidence through its rule, and is not live-only.
    expect((await register(api, executionId, photoBody(w.c.problem.id, { source: 'gallery' }))).status).toBe(200);
    expect((await register(api, executionId, photoBody(null))).status).toBe(200);
    const unknown = await register(api, executionId, photoBody('0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f'));
    expect([unknown.status, unknown.body.error.fields]).toEqual([400, { itemId: 'executions.issues.unknownItem' }]);
  });

  it('lets the worker retake the photo of a maxCount 1 item; the answers hold only the latest', async () => {
    const w = await executionWorld(t);
    const next = structuredClone(w.c.content);
    const photoItem = next.sections[0]!.items.find((i) => i.id === w.c.photo.id)!;
    if (photoItem.type === 'photo') photoItem.maxCount = 1;
    await publishNextVersion(w.owner, w.checklistId, next);
    clock.set('2026-11-02T04:20:00Z');
    const api = w.workers[0].api;
    const executionId = await claimOk(api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    const first = await registerPhoto(api, executionId, w.c.photo.id);
    // The worker removed the first photo on the phone and took another.
    const retake = await registerPhoto(api, executionId, w.c.photo.id);
    const answers = (photos: string[]) => answersBody(1, { [w.c.photo.id]: { photos } }, '2026-11-02T04:20:00.000Z');
    const both = await api.put(`/api/v1/executions/${executionId}/answers`, answers([first, retake]));
    expect([both.status, both.body.error.issues.map((i: { code: string }) => i.code)]).toEqual([400, ['executions.issues.tooManyMedia']]);
    const latest = await api.put(`/api/v1/executions/${executionId}/answers`, answers([retake]));
    expect(latest.status, JSON.stringify(latest.body)).toBe(200);
  });

  it('lets only the executor register, also on a rejected claim, and checks the device clock', async () => {
    const { w, executionId } = await started();
    const w1 = w.workers[1];
    expect((await register(w1.api, executionId, photoBody(w.c.photo.id))).body.error.code).toBe('NOT_EXECUTOR');
    const lost = claimBody(w.occurrenceId, '2026-11-02T04:15:00.000Z');
    expect((await w1.api.post('/api/v1/executions', lost)).body.state).toBe('rejected');
    expect((await register(w1.api, lost.id, photoBody(w.c.photo.id))).status).toBe(200);
    const ahead = await register(w1.api, lost.id, photoBody(w.c.photo.id, { capturedAt: '2026-11-02T04:30:00.000Z' }));
    expect([ahead.status, ahead.body.error.code]).toEqual([422, 'CLOCK_INVALID']);
    expect((await register(w1.api, '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f', photoBody(null))).status).toBe(404);
  });

  it('refuses media on a completed execution', async () => {
    const { w, executionId, api } = await started();
    await ownerQuery("update executions set state = 'completed', completed_at = $2 where id = $1", [executionId, '2026-11-02T04:20:00Z']);
    const res = await register(api, executionId, photoBody(w.c.photo.id));
    expect([res.status, res.body.error.code]).toEqual([409, 'EXECUTION_NOT_ACTIVE']);
  });

  it('still takes media on a swept partial execution, but only if captured before closes_at', async () => {
    const { w, executionId, api } = await started();
    // Swept while the phone was offline: partial with no completed_at. The window closes at 11:00 Baku (07:00Z).
    await ownerQuery("update executions set state = 'partial', completed_at = null where id = $1", [executionId]);
    clock.set('2026-11-02T07:30:00Z');
    const inside = await register(api, executionId, photoBody(w.c.photo.id, { capturedAt: '2026-11-02T06:59:59.000Z', deviceTime: '2026-11-02T06:59:59.000Z' }));
    expect(inside.status, JSON.stringify(inside.body)).toBe(200);
    const atClose = await register(api, executionId, photoBody(w.c.photo.id, { capturedAt: '2026-11-02T07:00:00.000Z' }));
    expect([atClose.status, atClose.body.error.code]).toEqual([409, 'EXECUTION_NOT_ACTIVE']);
    // A partial execution that was completed late (completed_at set) accepts nothing more.
    await ownerQuery("update executions set completed_at = $2 where id = $1", [executionId, '2026-11-02T06:59:00Z']);
    const done = await register(api, executionId, photoBody(w.c.photo.id, { capturedAt: '2026-11-02T06:00:00.000Z' }));
    expect([done.status, done.body.error.code]).toEqual([409, 'EXECUTION_NOT_ACTIVE']);
  });
});
