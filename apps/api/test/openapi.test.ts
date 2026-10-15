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

  it('documents the notification paths', async () => {
    const res = await t.http().get('/api/docs-json');
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/me/notifications',
        '/api/v1/me/notifications/unread-count',
        '/api/v1/me/notifications/read-all',
        '/api/v1/me/notifications/{id}/read',
        '/api/v1/me/push-devices',
        '/api/v1/me/push-devices/{token}',
        '/api/v1/me/preferences',
        '/api/v1/notification-rules',
        '/api/v1/notification-rules/{type}',
        '/api/v1/notifications/messages',
        '/api/v1/notifications/messages/options',
        '/api/v1/notifications/messages/preview',
        '/api/v1/notifications/messages/{id}',
      ]),
    );
  });

  it('documents the report paths', async () => {
    const res = await t.http().get('/api/docs-json');
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/reports/summary',
        '/api/v1/reports/sites',
        '/api/v1/reports/employees',
        '/api/v1/reports/runs',
        '/api/v1/reports/problems',
        '/api/v1/reports/tasks',
        '/api/v1/reports/{kind}/export',
      ]),
    );
    expect(Object.keys(res.body.paths['/api/v1/reports/{kind}/export'].get.responses['200'].content)).toEqual(
      expect.arrayContaining(['text/csv; charset=utf-8', 'application/pdf']),
    );
  });

  it('documents the audit and correction paths', async () => {
    const res = await t.http().get('/api/docs-json');
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/audits',
        '/api/v1/audits/{id}',
        '/api/v1/audits/{id}/items/{itemId}',
        '/api/v1/audits/{id}/finish',
        '/api/v1/audits/{id}/cancel',
        '/api/v1/audits/{id}/report.pdf',
        '/api/v1/audits/{id}/report/send',
        '/api/v1/executions/{id}/audits',
        '/api/v1/executions/{id}/corrections',
        '/api/v1/executions/{id}/send-back',
        '/api/v1/executions/{id}/send-back/cancel',
        '/api/v1/executions/{id}/resubmit',
        '/api/v1/platform/tenants/{tenantId}/audits',
        '/api/v1/platform/tenants/{tenantId}/audits/{id}',
        '/api/v1/platform/tenants/{tenantId}/audits/{id}/finish',
        '/api/v1/platform/tenants/{tenantId}/executions/{id}/audits',
        '/api/v1/platform/tenants/{tenantId}/executions/{id}/send-back',
        '/api/v1/platform/tenants/{tenantId}/executions/{id}/send-back/cancel',
        '/api/v1/platform/tenants/{tenantId}/executions/{id}/corrections',
      ]),
    );
    expect(Object.keys(res.body.paths['/api/v1/audits/{id}/report.pdf'].get.responses['200'].content)).toContain('application/pdf');
  });
});
