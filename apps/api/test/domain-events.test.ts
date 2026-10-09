import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainEvents } from '../src/common/domain-events';
import { createTestApp, type TestApp } from './app';
import { as, createUserDirect, signupTenant, siteTypeIdOf } from './fixtures';
import { ownerQuery } from './owner-db';

describe('DomainEvents', () => {
  it('runs handlers in order, awaits them and propagates errors', async () => {
    const events = new DomainEvents();
    const seen: string[] = [];
    events.on('roster.changed', async (e) => {
      await Promise.resolve();
      seen.push(`a:${e.siteId}`);
    });
    const off = events.on('roster.changed', (e) => {
      seen.push(`b:${e.siteId}`);
    });
    await events.emit('roster.changed', { tenantId: 't', siteId: 's1', from: '2026-11-02', to: '2026-11-08' });
    off();
    await events.emit('roster.changed', { tenantId: 't', siteId: 's2', from: '2026-11-02', to: '2026-11-08' });
    expect(seen).toEqual(['a:s1', 'b:s1', 'a:s2']);
    events.on('checklist.deactivated', () => {
      throw new Error('boom');
    });
    await expect(events.emit('checklist.deactivated', { tenantId: 't', checklistId: 'c' })).rejects.toThrow('boom');
  });
});

describe('emitters', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('emits user.access_changed and checklist.deactivated inside the request transaction', async () => {
    const s = await signupTenant(t);
    const api = as(t, s.accessToken);
    const events = t.app.get(DomainEvents);
    const seen: string[] = [];
    const offs = [
      events.on('user.access_changed', (e) => {
        if (e.tenantId === s.tenantId) seen.push(`user:${e.userId}`);
      }),
      events.on('checklist.deactivated', (e) => {
        if (e.tenantId === s.tenantId) seen.push(`checklist:${e.checklistId}`);
      }),
    ];
    try {
      const typeId = await siteTypeIdOf(s.tenantId);
      const siteId = (await api.post('/api/v1/sites', { parentId: null, typeId, name: 'Filial' })).body.id;
      const w = await createUserDirect(t, s.tenantId);
      await api.put(`/api/v1/users/${w.id}/sites`, { siteIds: [siteId] });
      await api.post(`/api/v1/users/${w.id}/deactivate`);
      await api.post(`/api/v1/users/${w.id}/reactivate`);
      const c = (await api.post('/api/v1/checklists', { name: 'X' })).body.id;
      await api.post(`/api/v1/checklists/${c}/deactivate`);
      expect(seen).toEqual([`user:${w.id}`, `user:${w.id}`, `user:${w.id}`, `checklist:${c}`]);
    } finally {
      offs.forEach((off) => off());
    }
  });

  it('rolls the change back when a handler fails', async () => {
    const s = await signupTenant(t);
    const api = as(t, s.accessToken);
    const off = t.app.get(DomainEvents).on('checklist.deactivated', (e) => {
      if (e.tenantId === s.tenantId) throw new Error('listener failed');
    });
    try {
      const c = (await api.post('/api/v1/checklists', { name: 'X' })).body.id;
      expect((await api.post(`/api/v1/checklists/${c}/deactivate`)).status).toBe(500);
      const row = await ownerQuery<{ status: string }>('select status from checklists where id = $1', [c]);
      expect(row.rows[0]!.status).toBe('active');
    } finally {
      off();
    }
  });
});
