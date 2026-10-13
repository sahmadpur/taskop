import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';

describe('OpenAPI', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('serves the document with the Foundation paths', async () => {
    const res = await t.http().get('/api/docs-json');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining(['/api/v1/auth/signup', '/api/v1/users', '/api/v1/sites', '/api/v1/roles', '/api/v1/audit-log', '/api/v1/checklists', '/api/v1/templates', '/api/v1/platform/templates', '/api/v1/platform/tenants/{tenantId}/checklists', '/api/v1/shifts', '/api/v1/roster', '/api/v1/assignments', '/api/v1/assignments/preview', '/api/v1/occurrences', '/api/v1/me/occurrences', '/api/v1/me/sync', '/api/v1/executions', '/api/v1/executions/{id}', '/api/v1/executions/{id}/answers', '/api/v1/executions/{id}/complete', '/api/v1/executions/{id}/media', '/api/v1/media/{id}/uploaded', '/api/v1/media/{id}/url', '/api/v1/problems', '/api/v1/platform/tenants/{tenantId}/assignments']),
    );
  });

  it('documents the task paths', async () => {
    const res = await t.http().get('/api/docs-json');
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/tasks',
        '/api/v1/tasks/assignees',
        '/api/v1/tasks/{id}',
        '/api/v1/tasks/{id}/cancel',
        '/api/v1/tasks/{id}/review',
        '/api/v1/tasks/{id}/accept',
        '/api/v1/tasks/{id}/start',
        '/api/v1/tasks/{id}/submissions',
        '/api/v1/tasks/{id}/media',
        '/api/v1/tasks/{id}/problem-media/{mediaId}/url',
        '/api/v1/task-media/{id}/uploaded',
        '/api/v1/task-media/{id}/url',
      ]),
    );
  });
});
