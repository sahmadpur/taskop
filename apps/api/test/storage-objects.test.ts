import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { S3Service } from '../src/storage/s3.service';
import { createTestApp, type TestApp } from './app';
import { type Seaweed, startSeaweedfs } from './seaweedfs';

describe('whole-object storage against SeaweedFS (SP8 audit reports)', () => {
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

  it('puts, heads and gets an object, and answers null for a missing one', async () => {
    const s3 = t.app.get(S3Service);
    const body = Buffer.from('%PDF-1.7 audit');
    await s3.putObject('tenants/t1/audits/a1/report.pdf', body, 'application/pdf');
    expect(await s3.head('tenants/t1/audits/a1/report.pdf')).toEqual({ contentLength: body.length, contentType: 'application/pdf' });
    expect(await s3.getObject('tenants/t1/audits/a1/report.pdf')).toEqual(body);
    expect(await s3.getObject('tenants/t1/audits/missing/report.pdf')).toBeNull();
  });
});
