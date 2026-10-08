import { blankContent, newItem, newSection } from '@taskop/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { sampleContent } from './checklist-fixtures';
import { as, createUserDirect, loginStaff, loginWorker, signupTenant } from './fixtures';
import { ownerQuery } from './owner-db';

const B = '/api/v1/checklists';

describe('checklists lifecycle', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  async function owner() {
    const s = await signupTenant(t);
    return { s, api: as(t, s.accessToken) };
  }

  it('creates a blank checklist with a draft, publishes v1 and v2, and keeps v1 unchanged', async () => {
    const { s, api } = await owner();
    const created = await api.post(B, { name: 'Gündəlik yoxlama', category: 'cleaning' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ name: 'Gündəlik yoxlama', status: 'active', currentVersionNumber: null, draftRevision: 1, versions: [{ state: 'draft' }] });
    const id = created.body.id as string;

    const draft = (await api.get(`${B}/${id}/draft`)).body;
    expect(draft.content.sections).toHaveLength(1);
    const saved = await api.put(`${B}/${id}/draft`, { content: sampleContent(), revision: 1 });
    expect(saved.body).toEqual({ revision: 2, issues: [] });

    const v1 = await api.post(`${B}/${id}/publish`, { revision: 2, changeNote: 'İlk versiya' });
    expect(v1.status, JSON.stringify(v1.body)).toBe(200);
    expect(v1.body).toMatchObject({ number: 1, state: 'published', changeNote: 'İlk versiya', publishedBy: { kind: 'user', name: 'Elvin Əhmədov' } });
    const v1Content = (await api.get(`${B}/${id}/versions/${v1.body.id}`)).body.content;

    const d2 = await api.post(`${B}/${id}/draft`, {});
    expect(d2.status).toBe(201);
    expect(d2.body.content).toEqual(v1Content);
    const edited = structuredClone(v1Content);
    edited.sections[0].title = 'Giriş zalı';
    expect((await api.put(`${B}/${id}/draft`, { content: edited, revision: 1 })).body.revision).toBe(2);
    expect((await api.post(`${B}/${id}/publish`, { revision: 2 })).body.number).toBe(2);

    const detail = (await api.get(`${B}/${id}`)).body;
    expect(detail).toMatchObject({ currentVersionNumber: 2, draftRevision: null });
    expect(detail.versions.map((v: { number: number }) => v.number)).toEqual([2, 1]);
    expect((await api.get(`${B}/${id}/versions/${v1.body.id}`)).body.content).toEqual(v1Content);

    const audit = await ownerQuery<{ action: string }>('select action from audit_log where tenant_id = $1 and entity_id = $2 order by occurred_at, id', [s.tenantId, id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['checklist.created', 'checklist.published', 'checklist.draft_started', 'checklist.published']);
  });

  it('stale revision on save and publish', async () => {
    const { api } = await owner();
    const id = (await api.post(B, { name: 'X' })).body.id;
    await api.put(`${B}/${id}/draft`, { content: sampleContent(), revision: 1 });
    const stale = await api.put(`${B}/${id}/draft`, { content: sampleContent(), revision: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'CHECKLIST_DRAFT_CONFLICT', currentRevision: 2 });
    const pub = await api.post(`${B}/${id}/publish`, { revision: 1 });
    expect(pub.body.error).toMatchObject({ code: 'CHECKLIST_DRAFT_CONFLICT', currentRevision: 2 });
  });

  it('returns strict issues on save and refuses to publish invalid content', async () => {
    const { api } = await owner();
    const id = (await api.post(B, { name: 'X' })).body.id;
    const saved = await api.put(`${B}/${id}/draft`, { content: blankContent(), revision: 1 });
    expect(saved.status).toBe(200);
    expect(saved.body.issues.map((i: { code: string }) => i.code)).toEqual(['checklists.issues.titleRequired', 'checklists.issues.noItems']);
    const pub = await api.post(`${B}/${id}/publish`, { revision: 2 });
    expect(pub.status).toBe(422);
    expect(pub.body.error.code).toBe('CHECKLIST_INVALID_CONTENT');
    expect(pub.body.error.issues).toHaveLength(2);
  });

  it('rejects structurally invalid and oversized drafts', async () => {
    const { api } = await owner();
    const id = (await api.post(B, { name: 'X' })).body.id;
    const bad = await api.put(`${B}/${id}/draft`, { content: { schemaVersion: 1, sections: 'nope' }, revision: 1 });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('CHECKLIST_INVALID_CONTENT');
    const huge = sampleContent();
    huge.instructions = 'x'.repeat(5000);
    huge.sections = Array.from({ length: 50 }, () => ({ ...newSection('S'), instructions: 'y'.repeat(2000), items: Array.from({ length: 10 }, () => ({ ...newItem('text'), label: 'z'.repeat(500), helpText: 'h'.repeat(1500) })) }));
    const big = await api.put(`${B}/${id}/draft`, { content: huge, revision: 1 });
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('CHECKLIST_CONTENT_TOO_LARGE');
  });

  it('discards drafts, restores old versions and refuses a second draft', async () => {
    const { api } = await owner();
    const id = (await api.post(B, { name: 'X' })).body.id;
    await api.put(`${B}/${id}/draft`, { content: sampleContent(), revision: 1 });
    const v1 = (await api.post(`${B}/${id}/publish`, { revision: 2 })).body;
    expect((await api.post(`${B}/${id}/draft`, {})).status).toBe(201);
    expect((await api.post(`${B}/${id}/draft`, {})).body.error.code).toBe('CHECKLIST_DRAFT_EXISTS');
    expect((await api.delete(`${B}/${id}/draft`)).status).toBe(204);
    expect((await api.get(`${B}/${id}/draft`)).body.error.code).toBe('CHECKLIST_NO_DRAFT');
    expect((await api.post(`${B}/${id}/draft`, { fromVersionId: v1.id })).status).toBe(201);
  });

  it('blocks writes on a deactivated checklist but still allows reading and copying', async () => {
    const { api } = await owner();
    const id = (await api.post(B, { name: 'X' })).body.id;
    await api.put(`${B}/${id}/draft`, { content: sampleContent(), revision: 1 });
    const v1 = (await api.post(`${B}/${id}/publish`, { revision: 2 })).body;
    await api.post(`${B}/${id}/draft`, {});
    expect((await api.post(`${B}/${id}/deactivate`)).body.status).toBe('deactivated');
    for (const res of [
      await api.put(`${B}/${id}/draft`, { content: sampleContent(), revision: 1 }),
      await api.post(`${B}/${id}/publish`, { revision: 1 }),
      await api.patch(`${B}/${id}`, { name: 'Y' }),
    ]) {
      expect(res.body.error?.code, JSON.stringify(res.body)).toBe('CHECKLIST_DEACTIVATED');
    }
    expect((await api.get(`${B}/${id}/versions/${v1.id}`)).status).toBe(200);
    const copy = await api.post(B, { name: 'X (surət)', from: { kind: 'version', versionId: v1.id } });
    expect(copy.status).toBe(201);
    expect((await api.post(`${B}/${id}/reactivate`)).body.status).toBe('active');
  });

  it('copy keeps rules working with fresh ids', async () => {
    const { api } = await owner();
    const id = (await api.post(B, { name: 'X' })).body.id;
    await api.put(`${B}/${id}/draft`, { content: sampleContent(), revision: 1 });
    const v1 = (await api.post(`${B}/${id}/publish`, { revision: 2 })).body;
    const original = (await api.get(`${B}/${id}/versions/${v1.id}`)).body.content;
    const copy = (await api.post(B, { name: 'Copy', from: { kind: 'version', versionId: v1.id } })).body;
    expect(copy.source).toEqual({ kind: 'version', id: v1.id });
    const draft = (await api.get(`${B}/${copy.id}/draft`)).body.content;
    const item = draft.sections[0].items[0];
    expect(item.id).not.toBe(original.sections[0].items[0].id);
    expect(item.rules[0].when.optionIds).toEqual([item.options[0].id]);
    expect((await api.post(`${B}/${copy.id}/publish`, { revision: 1 })).status).toBe(200);
  });

  it('lists with filters and cursor pagination', async () => {
    const { api } = await owner();
    for (const name of ['Alfa', 'Beta', 'Qamma']) await api.post(B, { name, category: name === 'Beta' ? 'retail' : 'cleaning' });
    expect((await api.get(`${B}?category=retail`)).body.items.map((c: { name: string }) => c.name)).toEqual(['Beta']);
    expect((await api.get(`${B}?q=amm`)).body.items).toHaveLength(1);
    expect((await api.get(`${B}?hasDraft=false`)).body.items).toHaveLength(0);
    const page1 = (await api.get(`${B}?limit=2`)).body;
    expect(page1.items.map((c: { name: string }) => c.name)).toEqual(['Qamma', 'Beta']);
    const page2 = (await api.get(`${B}?limit=2&cursor=${page1.nextCursor}`)).body;
    expect(page2).toEqual({ items: [expect.objectContaining({ name: 'Alfa' })], nextCursor: null });
  });

  it('enforces permissions: manager drafts but cannot publish; auditor reads; worker gets 403', async () => {
    const { s, api } = await owner();
    const id = (await api.post(B, { name: 'X' })).body.id;
    const mgr = await createUserDirect(t, s.tenantId, { kind: 'staff', roleKey: 'manager', emailVerified: true });
    const managerApi = as(t, (await loginStaff(t, mgr.email!, mgr.secret)).accessToken);
    expect((await managerApi.put(`${B}/${id}/draft`, { content: sampleContent(), revision: 1 })).status).toBe(200);
    expect((await managerApi.post(`${B}/${id}/publish`, { revision: 2 })).status).toBe(403);
    const aud = await createUserDirect(t, s.tenantId, { kind: 'staff', roleKey: 'auditor', emailVerified: true });
    const auditorApi = as(t, (await loginStaff(t, aud.email!, aud.secret)).accessToken);
    expect((await auditorApi.get(`${B}/${id}`)).status).toBe(200);
    expect((await auditorApi.post(B, { name: 'Y' })).status).toBe(403);
    const w = await createUserDirect(t, s.tenantId);
    const workerApi = as(t, (await loginWorker(t, s.orgCode, w.username!, w.secret)).accessToken);
    expect((await workerApi.get(B)).status).toBe(403);
  });
});
