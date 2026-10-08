import { blankContent } from '@taskop/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { sampleContent } from './checklist-fixtures';
import { as, createUserDirect, loginStaff, signupTenant } from './fixtures';
import { ownerQuery } from './owner-db';

const T = '/api/v1/templates';
const C = '/api/v1/checklists';

describe('templates', () => {
  let t: TestApp;
  let globalId: string;
  let hiddenId: string;
  beforeAll(async () => {
    t = await createTestApp();
    const ins = await ownerQuery<{ id: string }>(
      `insert into global_templates (id, name, category, content, item_count, published, sort_order) values
       (gen_random_uuid(), 'Taskop: Mətbəx', 'restaurant', $1::jsonb, 2, true, 1),
       (gen_random_uuid(), 'Taskop: Gizli', 'restaurant', $1::jsonb, 2, false, 2) returning id`,
      [JSON.stringify(sampleContent())],
    );
    [globalId, hiddenId] = ins.rows.map((r) => r.id) as [string, string];
  });
  afterAll(() => t.close());

  it('lists published global templates and own templates; hides unpublished ones', async () => {
    const s = await signupTenant(t);
    const api = as(t, s.accessToken);
    const own = (await api.post(T, { name: 'Bizim şablon', category: 'retail' })).body;
    expect(own).toMatchObject({ source: 'tenant', status: 'active', itemCount: 0, revision: 1 });
    const all = (await api.get(T)).body as Array<{ id: string; source: string }>;
    expect(all.map((x) => x.id)).toEqual(expect.arrayContaining([globalId, own.id]));
    expect(all.map((x) => x.id)).not.toContain(hiddenId);
    expect(((await api.get(`${T}?source=tenant`)).body as unknown[]).length).toBe(1);
    expect((await api.get(`${T}/global/${hiddenId}`)).status).toBe(404);
    expect((await api.get(`${T}/global/${globalId}`)).body.content.sections[0].items).toHaveLength(1);
  });

  it('creates a checklist from a global template with fresh ids and records the source', async () => {
    const s = await signupTenant(t);
    const api = as(t, s.accessToken);
    const tpl = (await api.get(`${T}/global/${globalId}`)).body;
    const created = (await api.post(C, { name: 'Mətbəx', from: { kind: 'global', templateId: globalId } })).body;
    expect(created.source).toEqual({ kind: 'global', id: globalId });
    const draft = (await api.get(`${C}/${created.id}/draft`)).body.content;
    expect(draft.sections[0].items[0].id).not.toBe(tpl.content.sections[0].items[0].id);
    expect((await api.post(`${C}/${created.id}/publish`, { revision: 1 })).status).toBe(200);
    expect((await api.post(C, { name: 'X', from: { kind: 'global', templateId: hiddenId } })).status).toBe(422);
  });

  it('saves a published version as a tenant template and uses it', async () => {
    const s = await signupTenant(t);
    const api = as(t, s.accessToken);
    const c = (await api.post(C, { name: 'X' })).body;
    await api.put(`${C}/${c.id}/draft`, { content: sampleContent(), revision: 1 });
    const v1 = (await api.post(`${C}/${c.id}/publish`, { revision: 2 })).body;
    const tpl = await api.post(`${C}/${c.id}/versions/${v1.id}/save-as-template`, { name: 'Bizim', category: 'safety' });
    expect(tpl.status, JSON.stringify(tpl.body)).toBe(201);
    expect(tpl.body).toMatchObject({ source: 'tenant', category: 'safety', itemCount: 2 });
    const fromTpl = (await api.post(C, { name: 'Y', from: { kind: 'tenant', templateId: tpl.body.id } })).body;
    expect(fromTpl.source).toEqual({ kind: 'tenant', id: tpl.body.id });
    expect((await api.get(`${C}/${fromTpl.id}/draft`)).body.content.sections[0].items).toHaveLength(1);
  });

  it('edits template content with revisions and blocks a deactivated template', async () => {
    const s = await signupTenant(t);
    const api = as(t, s.accessToken);
    const tpl = (await api.post(T, { name: 'A', category: 'other' })).body;
    expect((await api.put(`${T}/${tpl.id}/content`, { content: sampleContent(), revision: 1 })).body).toEqual({ revision: 2, issues: [] });
    expect((await api.put(`${T}/${tpl.id}/content`, { content: blankContent(), revision: 1 })).body.error).toMatchObject({ code: 'TEMPLATE_CONFLICT', currentRevision: 2 });
    expect((await api.get(`${T}/tenant/${tpl.id}`)).body.itemCount).toBe(2);
    expect((await api.post(`${T}/${tpl.id}/deactivate`)).body.status).toBe('deactivated');
    expect((await api.post(C, { name: 'Z', from: { kind: 'tenant', templateId: tpl.id } })).body.error.code).toBe('TEMPLATE_DEACTIVATED');
    expect((await api.patch(`${T}/${tpl.id}`, { name: 'B' })).body.error.code).toBe('TEMPLATE_DEACTIVATED');
    expect((await api.post(`${T}/${tpl.id}/reactivate`)).body.status).toBe('active');
    const audit = await ownerQuery<{ action: string }>('select action from audit_log where entity_id = $1 order by occurred_at, id', [tpl.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['template.created', 'template.updated', 'template.deactivated', 'template.reactivated']);
  });

  it('requires templates.manage to change templates; manage is enough to browse', async () => {
    const s = await signupTenant(t);
    const mgr = await createUserDirect(t, s.tenantId, { kind: 'staff', roleKey: 'manager', emailVerified: true });
    const api = as(t, (await loginStaff(t, mgr.email!, mgr.secret)).accessToken);
    expect((await api.get(T)).status).toBe(200);
    expect((await api.post(T, { name: 'A', category: 'other' })).status).toBe(403);
  });
});
