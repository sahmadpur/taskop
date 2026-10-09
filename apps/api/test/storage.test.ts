import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/config';
import { S3Service } from '../src/storage/s3.service';
import { testEnv } from './app';
import { type Seaweed, startSeaweedfs } from './seaweedfs';

describe('S3Service against SeaweedFS', () => {
  let sw: Seaweed;
  let s3: S3Service;
  beforeAll(async () => {
    sw = await startSeaweedfs();
    s3 = new S3Service(loadConfig(testEnv(sw.env)));
  });
  afterAll(async () => {
    s3?.onModuleDestroy();
    await sw?.stop();
  });

  it('uploads through a presigned PUT, reads it back through a presigned GET and deletes it', async () => {
    const key = `t/test/e/test/${crypto.randomUUID()}.jpg`;
    const body = Buffer.alloc(1234, 7);
    const put = await s3.presignPut(key, 'image/jpeg', body.length);
    // Spec §6.7: Content-Type and Content-Length are bound by the signature.
    expect(new URL(put.url).searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    expect(put.headers).toEqual({ 'Content-Type': 'image/jpeg', 'Content-Length': '1234' });
    expect(+put.expiresAt - Date.now()).toBeGreaterThan(14 * 60_000);
    const res = await fetch(put.url, { method: 'PUT', body, headers: { 'Content-Type': 'image/jpeg' } });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await s3.head(key)).toEqual({ contentLength: 1234, contentType: 'image/jpeg' });
    const get = await s3.presignGet(key);
    expect(+get.expiresAt - Date.now()).toBeLessThanOrEqual(5 * 60_000);
    const down = await fetch(get.url);
    expect(Buffer.from(await down.arrayBuffer())).toEqual(body);
    await s3.delete(key);
    expect(await s3.head(key)).toBeNull();
  });

  it('keeps the bucket private', async () => {
    expect((await fetch(`${sw.env.S3_ENDPOINT}/taskop-media/anything.jpg`)).status).toBe(403);
  });
});
