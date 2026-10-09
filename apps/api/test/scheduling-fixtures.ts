import type { AssignmentDetail, SystemRoleKey } from '@taskop/contracts';
import { expect } from 'vitest';
import type { TestApp } from './app';
import { sampleContent } from './checklist-fixtures';
import { as, createUserDirect, loginStaff, signupTenant, siteTypeIdOf, type SignedUpTenant } from './fixtures';
import { ownerQuery } from './owner-db';

/** Monday 2026-11-02 08:00 in Asia/Baku (UTC+4, no DST), the default tenant timezone. */
export const MONDAY_0800 = '2026-11-02T04:00:00Z';
export const TODAY = '2026-11-02';

export type Api = ReturnType<typeof as>;

export interface SchedulingWorld {
  s: SignedUpTenant;
  api: Api;
  siteId: string;
  otherSiteId: string;
  workers: string[];
  checklistId: string;
}

export async function publishedChecklist(api: Api, name = 'Açılış yoxlaması'): Promise<string> {
  const id = (await api.post('/api/v1/checklists', { name })).body.id as string;
  await api.put(`/api/v1/checklists/${id}/draft`, { content: sampleContent(), revision: 1 });
  const res = await api.post(`/api/v1/checklists/${id}/publish`, { revision: 2 });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return id;
}

/** An owner, two top-level sites, `workerCount` workers linked to the first site, and a published checklist. */
export async function schedulingWorld(t: TestApp, workerCount = 2): Promise<SchedulingWorld> {
  const s = await signupTenant(t);
  const api = as(t, s.accessToken);
  const typeId = await siteTypeIdOf(s.tenantId);
  const siteId = (await api.post('/api/v1/sites', { parentId: null, typeId, name: 'Filial 1' })).body.id as string;
  const otherSiteId = (await api.post('/api/v1/sites', { parentId: null, typeId, name: 'Filial 2' })).body.id as string;
  const workers: string[] = [];
  for (let i = 0; i < workerCount; i++) {
    const w = await createUserDirect(t, s.tenantId, { fullName: `İşçi ${i + 1}` });
    const res = await api.put(`/api/v1/users/${w.id}/sites`, { siteIds: [siteId] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    workers.push(w.id);
  }
  return { s, api, siteId, otherSiteId, workers, checklistId: await publishedChecklist(api) };
}

/** A staff user with a built-in role, linked to `siteIds`, logged in. */
export async function staffWithRole(t: TestApp, w: SchedulingWorld, roleKey: SystemRoleKey, siteIds: string[]) {
  const u = await createUserDirect(t, w.s.tenantId, { kind: 'staff', roleKey, fullName: `Staff ${roleKey}`, emailVerified: true });
  if (siteIds.length) await w.api.put(`/api/v1/users/${u.id}/sites`, { siteIds });
  const login = await loginStaff(t, u.email!, u.secret);
  return { id: u.id, api: as(t, login.accessToken) };
}

export const daily = (startDate = TODAY, extra: Record<string, unknown> = {}) => ({ kind: 'daily', every: 1, startDate, endDate: null, skipDates: [], ...extra });
export const fixed = (startTime = '08:00', dueAfterMinutes = 120, graceMinutes = 60) => ({ mode: 'fixed', startTime, dueAfterMinutes, graceMinutes });

export async function createAssignment(w: SchedulingWorld, body: Record<string, unknown> = {}): Promise<AssignmentDetail> {
  const res = await w.api.post('/api/v1/assignments', {
    checklistId: w.checklistId,
    siteId: w.siteId,
    assigneeIds: w.workers,
    schedule: daily(),
    timing: fixed(),
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as AssignmentDetail;
}

export interface OccurrenceRow {
  id: string;
  local_date: string;
  starts_at: Date;
  status: string;
  cancel_reason: string | null;
  assignees: string[];
}

/** Every occurrence of an assignment (any status), read as the owner. */
export async function occurrenceRows(assignmentId: string): Promise<OccurrenceRow[]> {
  const r = await ownerQuery<OccurrenceRow>(
    `select o.id, to_char(o.local_date, 'YYYY-MM-DD') as local_date, o.starts_at, o.status, o.cancel_reason,
            array(select oa.user_id::text from occurrence_assignees oa where oa.occurrence_id = o.id order by oa.user_id) as assignees
       from occurrences o where o.assignment_id = $1 order by o.local_date, o.starts_at`,
    [assignmentId],
  );
  return r.rows;
}

export const live = (rows: OccurrenceRow[]) => rows.filter((r) => r.status !== 'cancelled');
