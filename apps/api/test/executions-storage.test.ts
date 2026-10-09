import type { MediaUploadTicket } from '@taskop/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MediaJobs } from '../src/executions/media-jobs';
import { S3Service } from '../src/storage/s3.service';
import { createTestApp, type TestApp } from './app';
import { liveExecution, mediaRow, photoBody, registerBytes } from './execution-fixtures';
import { as, createUserDirect, loginStaff } from './fixtures';
import { ownerQuery } from './owner-db';
import { type Seaweed, startSeaweedfs } from './seaweedfs';

/** Real time throughout: SeaweedFS checks signatures against its own clock. */
describe('media upload, confirmation, viewing and cleanup against SeaweedFS', () => {
  let sw: Seaweed;
  let t: TestApp;
  beforeAll(async () => {
    sw = await startSeaweedfs();
    t = await createTestApp(sw.env);
  });
  afterAll(async () => {
    await t?.close();
    await sw?.stop();
  });

  const upload = (ticket: MediaUploadTicket, body: Buffer) =>
    fetch(ticket.uploadUrl!, { method: 'PUT', body: new Uint8Array(body), headers: { 'Content-Type': ticket.headers['Content-Type']! } });

  it('registers, uploads through the presigned PUT and confirms', async () => {
    const { w, executionId, api } = await liveExecution(t);
    const bytes = Buffer.alloc(2048, 1);
    const { id, ticket } = await registerBytes(api, executionId, w.c.photo.id, bytes.length);
    expect((await upload(ticket, bytes)).status).toBe(200);
    const res = await api.post(`/api/v1/media/${id}/uploaded`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ mediaId: id, status: 'uploaded' });
    expect((await api.post(`/api/v1/media/${id}/uploaded`)).body.uploadedAt).toBe(res.body.uploadedAt);
    expect((await mediaRow(id)).status).toBe('uploaded');
    expect((await w.workers[1].api.post(`/api/v1/media/${id}/uploaded`)).body.error.code).toBe('NOT_EXECUTOR');
  });

  it('answers a replayed registration of an uploaded medium without a new PUT URL, so stored evidence cannot be overwritten', async () => {
    const { w, executionId, api } = await liveExecution(t);
    const bytes = Buffer.alloc(100, 5);
    const { id, ticket } = await registerBytes(api, executionId, w.c.photo.id, bytes.length);
    expect((await upload(ticket, bytes)).status).toBe(200);
    expect((await api.post(`/api/v1/media/${id}/uploaded`)).body.status).toBe('uploaded');
    const now = new Date().toISOString();
    const replay = await api.post(`/api/v1/executions/${executionId}/media`, photoBody(w.c.photo.id, { id, bytes: bytes.length, capturedAt: now, deviceTime: now }));
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);
    expect(replay.body).toEqual({ mediaId: id, status: 'uploaded', uploadUrl: null, headers: {}, expiresAt: null });
  });

  it('confirming before the PUT finished is refused and can be retried', async () => {
    const { w, executionId, api } = await liveExecution(t);
    const bytes = Buffer.alloc(500, 2);
    const { id, ticket } = await registerBytes(api, executionId, w.c.photo.id, bytes.length);
    const early = await api.post(`/api/v1/media/${id}/uploaded`);
    expect([early.status, early.body.error.code]).toEqual([422, 'MEDIA_NOT_FOUND_IN_STORAGE']);
    expect((await mediaRow(id)).status).toBe('pending');
    expect((await upload(ticket, bytes)).status).toBe(200);
    expect((await api.post(`/api/v1/media/${id}/uploaded`)).body.status).toBe('uploaded');
  });

  it('refuses an object whose size differs from the registration', async () => {
    const { w, executionId, api } = await liveExecution(t);
    const { id, ticket } = await registerBytes(api, executionId, w.c.photo.id, 1000);
    // The signed Content-Length makes storage refuse the PUT (403); if it ever accepts it, the HEAD check still does.
    expect([200, 403]).toContain((await upload(ticket, Buffer.alloc(999, 3))).status);
    expect((await api.post(`/api/v1/media/${id}/uploaded`)).body.error.code).toBe('MEDIA_NOT_FOUND_IN_STORAGE');
  });

  it('issues view URLs to the executor and in-scope viewers only', async () => {
    const { w, executionId, api } = await liveExecution(t);
    const bytes = Buffer.alloc(300, 4);
    const { id, ticket } = await registerBytes(api, executionId, w.c.photo.id, bytes.length);
    await upload(ticket, bytes);
    await api.post(`/api/v1/media/${id}/uploaded`);
    const manager = async (siteId: string) => {
      const u = await createUserDirect(t, w.s.tenantId, { kind: 'staff', roleKey: 'manager', emailVerified: true });
      await w.owner.put(`/api/v1/users/${u.id}/sites`, { siteIds: [siteId] });
      return as(t, (await loginStaff(t, u.email!, u.secret)).accessToken);
    };
    const mine = await api.get(`/api/v1/media/${id}/url`);
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(Buffer.from(await (await fetch(mine.body.url)).arrayBuffer())).toEqual(bytes);
    expect((await w.owner.get(`/api/v1/media/${id}/url`)).status).toBe(200);
    expect((await (await manager(w.siteId)).get(`/api/v1/media/${id}/url`)).status).toBe(200);
    expect((await (await manager(w.otherSiteId)).get(`/api/v1/media/${id}/url`)).status).toBe(404);
    expect((await w.workers[1].api.get(`/api/v1/media/${id}/url`)).status).toBe(404);
    const pending = await registerBytes(api, executionId, null, 10);
    expect((await api.get(`/api/v1/media/${pending.id}/url`)).body.error.code).toBe('MEDIA_NOT_FOUND_IN_STORAGE');
  });

  it('deletes the objects of media never confirmed after 14 days, once, and keeps the rows', async () => {
    const { w, executionId, api } = await liveExecution(t);
    const old = await registerBytes(api, executionId, w.c.photo.id, 10);
    const recent = await registerBytes(api, executionId, null, 10);
    expect((await upload(old.ticket, Buffer.alloc(10))).status).toBe(200);
    expect((await upload(recent.ticket, Buffer.alloc(10))).status).toBe(200);
    await ownerQuery("update execution_media set created_at = now() - interval '15 days' where id = $1", [old.id]);
    await ownerQuery("update execution_media set created_at = now() - interval '13 days' where id = $1", [recent.id]);
    const jobs = t.app.get(MediaJobs);
    const s3 = t.app.get(S3Service);
    expect(await jobs.cleanupAll([w.s.tenantId])).toBe(1);
    expect(await jobs.cleanupAll([w.s.tenantId])).toBe(0);
    const o = await mediaRow(old.id);
    expect([o.status, o.purged]).toEqual(['pending', true]);
    expect(await s3.head(o.storage_key)).toBeNull();
    const r = await mediaRow(recent.id);
    expect([r.status, r.purged]).toEqual(['pending', false]);
    expect(await s3.head(r.storage_key)).not.toBeNull();
  });
});
