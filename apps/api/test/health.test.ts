import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';

describe('health and error format', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('GET /api/v1/health returns ok', async () => {
    const res = await t.http().get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toBeTypeOf('string');
  });

  it('unknown routes use the standard error body', async () => {
    const res = await t.http().get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', messageKey: 'errors.NOT_FOUND', fields: null });
    expect(res.body.error.requestId).toBeTypeOf('string');
  });
});
