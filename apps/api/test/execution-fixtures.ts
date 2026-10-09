import {
  type Answers,
  blankContent,
  type ChecklistContent,
  type ClaimCommand,
  type ExecutionProgress,
  newItem,
  newRule,
  newSection,
  type NumberItem,
  type PhotoItem,
  type YesNoItem,
} from '@taskop/contracts';
import { uuidv7 } from 'uuidv7';
import { expect } from 'vitest';
import { as, createUserDirect, loginWorker, type SignedUpTenant, signupTenant, siteTypeIdOf } from './fixtures';
import type { TestApp } from './app';
import { ownerQuery } from './owner-db';
import { type Api, daily, fixed, TODAY } from './scheduling-fixtures';

/** Opens a draft from the current version, saves `content` and publishes it; returns the new version id. */
export async function publishNextVersion(api: Api, checklistId: string, content: ChecklistContent): Promise<string> {
  expect((await api.post(`/api/v1/checklists/${checklistId}/draft`, {})).status).toBe(201);
  expect((await api.put(`/api/v1/checklists/${checklistId}/draft`, { content, revision: 1 })).status).toBe(200);
  const res = await api.post(`/api/v1/checklists/${checklistId}/publish`, { revision: 2 });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.id as string;
}

/** The checklist version an occurrence is pinned to, or null while unpinned. */
export async function pinnedVersionOf(occurrenceId: string): Promise<string | null> {
  return (await ownerQuery<{ v: string | null }>('select checklist_version_id as v from occurrences where id = $1', [occurrenceId])).rows[0]!.v;
}

/**
 * problem (yes → critical problem, photo required, follow-up comment), temp (−50…50; outside 2–8 → normal problem,
 * note required), photo (required, 1–2, live only), note (optional text).
 */
export function executionContent() {
  const problem = newItem('yes_no') as YesNoItem;
  problem.label = 'Problem varmı?';
  const [yes, no] = problem.options;
  const onYes = newRule(problem);
  onYes.when = { kind: 'options', optionIds: [yes.id] };
  onYes.then = { ...onYes.then, problem: 'critical', requirePhoto: true };
  const comment = newItem('comment');
  comment.label = 'Təsvir edin';
  onYes.then.followUps.push(comment);
  problem.rules.push(onYes);
  const temp = newItem('number') as NumberItem;
  temp.label = 'Temperatur';
  temp.min = -50;
  temp.max = 50;
  const out = newRule(temp);
  out.when = { kind: 'range', op: 'outside', min: 2, max: 8 };
  out.then.problem = 'normal';
  out.then.requireNote = true;
  temp.rules.push(out);
  const photo = newItem('photo') as PhotoItem;
  photo.label = 'Ümumi görünüş';
  photo.minCount = 1;
  photo.maxCount = 2;
  photo.evidence = { ...photo.evidence, liveOnly: true };
  const note = newItem('text');
  note.label = 'Qeyd';
  note.required = false;
  const content: ChecklistContent = { ...blankContent(), sections: [{ ...newSection('Zal'), items: [problem, temp, photo, note] }] };
  return { content, problem, yes, no, comment, temp, photo, note };
}
export type ExecutionContent = ReturnType<typeof executionContent>;

export interface TestWorker {
  id: string;
  api: Api;
}

export interface ExecutionWorld {
  s: SignedUpTenant;
  owner: Api;
  siteId: string;
  otherSiteId: string;
  checklistId: string;
  versionId: string;
  assignmentId: string;
  /** İşçi 1 and İşçi 2, linked to siteId, logged in on mobile. */
  workers: [TestWorker, TestWorker];
  c: ExecutionContent;
  /** The occurrence on `date`: with the default timing 08:00–10:00 Baku, closing 11:00 (04:00Z / 06:00Z / 07:00Z). */
  occurrenceId: string;
}

export async function occurrenceOn(assignmentId: string, date: string): Promise<string> {
  const r = await ownerQuery<{ id: string }>("select id from occurrences where assignment_id = $1 and local_date = $2 and status <> 'cancelled'", [assignmentId, date]);
  expect(r.rows).toHaveLength(1);
  return r.rows[0]!.id;
}

/** Create it while the clock is at or before the window of `date`, so that occurrence is materialised. */
export async function executionWorld(t: TestApp, opts: { date?: string; timing?: Record<string, unknown> } = {}): Promise<ExecutionWorld> {
  const s = await signupTenant(t);
  const owner = as(t, s.accessToken);
  const typeId = await siteTypeIdOf(s.tenantId);
  const siteId = (await owner.post('/api/v1/sites', { parentId: null, typeId, name: 'Filial 1' })).body.id as string;
  const otherSiteId = (await owner.post('/api/v1/sites', { parentId: null, typeId, name: 'Filial 2' })).body.id as string;
  const workers: TestWorker[] = [];
  for (const fullName of ['İşçi 1', 'İşçi 2']) {
    const u = await createUserDirect(t, s.tenantId, { fullName });
    expect((await owner.put(`/api/v1/users/${u.id}/sites`, { siteIds: [siteId] })).status).toBe(200);
    workers.push({ id: u.id, api: as(t, (await loginWorker(t, s.orgCode, u.username!, u.secret)).accessToken) });
  }
  const c = executionContent();
  const checklistId = (await owner.post('/api/v1/checklists', { name: 'İcra yoxlaması' })).body.id as string;
  await owner.put(`/api/v1/checklists/${checklistId}/draft`, { content: c.content, revision: 1 });
  const published = await owner.post(`/api/v1/checklists/${checklistId}/publish`, { revision: 2 });
  expect(published.status, JSON.stringify(published.body)).toBe(200);
  const date = opts.date ?? TODAY;
  const res = await owner.post('/api/v1/assignments', {
    checklistId,
    siteId,
    assigneeIds: workers.map((w) => w.id),
    schedule: daily(date),
    timing: opts.timing ?? fixed(),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const assignmentId = res.body.id as string;
  return {
    s,
    owner,
    siteId,
    otherSiteId,
    checklistId,
    versionId: published.body.id as string,
    assignmentId,
    workers: workers as [TestWorker, TestWorker],
    c,
    occurrenceId: await occurrenceOn(assignmentId, date),
  };
}

export const DEVICE = { platform: 'android', osVersion: '15', appVersion: '1.0.0' } as const;

/** deviceTime defaults to startedAt: the phone sends the claim as soon as it is online. */
export const claimBody = (occurrenceId: string, startedAt: string, extra: Partial<ClaimCommand> = {}): ClaimCommand => ({
  id: uuidv7(),
  occurrenceId,
  startedAt,
  deviceTime: startedAt,
  clientOffsetMs: 0,
  device: DEVICE,
  ...extra,
});

export async function claimOk(api: Api, occurrenceId: string, startedAt: string): Promise<string> {
  const res = await api.post('/api/v1/executions', claimBody(occurrenceId, startedAt));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.state).toBe('active');
  return res.body.executionId as string;
}

/** [from, to, at, reason, actor user id] in insertion order (ids are monotonic UUIDv7). */
export type HistoryRow = [string | null, string, string, string | null, string | null];
export async function historyOf(occurrenceId: string): Promise<HistoryRow[]> {
  const r = await ownerQuery<{ from_status: string | null; to_status: string; at: Date; reason: string | null; actor_user_id: string | null }>(
    'select from_status, to_status, at, reason, actor_user_id from occurrence_status_history where occurrence_id = $1 order by id',
    [occurrenceId],
  );
  return r.rows.map((h) => [h.from_status, h.to_status, h.at.toISOString(), h.reason, h.actor_user_id]);
}

export interface ExecutionDbRow {
  id: string;
  state: string;
  rejected_reason: string | null;
  executor_user_id: string;
  started_at: Date;
  started_received_at: Date;
  completed_at: Date | null;
  completed_received_at: Date | null;
  answers: Answers;
  answers_rev: number;
  progress: ExecutionProgress;
  score: { percent: number | null; problems: unknown[] } | null;
  late: boolean;
  clock_suspect: boolean;
  clock_offset_ms: number | null;
}

export async function executionRow(id: string): Promise<ExecutionDbRow> {
  return (await ownerQuery<ExecutionDbRow>('select * from executions where id = $1', [id])).rows[0]!;
}

export const statusOf = async (occurrenceId: string): Promise<string> =>
  (await ownerQuery<{ status: string }>('select status from occurrences where id = $1', [occurrenceId])).rows[0]!.status;

/** A 1000-byte camera JPEG captured at Monday 08:20 Baku (04:20Z). */
export const photoBody = (itemId: string | null, extra: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  itemId,
  kind: 'photo',
  source: 'camera',
  mime: 'image/jpeg',
  bytes: 1000,
  width: 1600,
  height: 1200,
  capturedAt: '2026-11-02T04:20:00.000Z',
  deviceTime: '2026-11-02T04:20:00.000Z',
  clientOffsetMs: 0,
  ...extra,
});

export async function registerPhoto(api: Api, executionId: string, itemId: string | null, extra: Record<string, unknown> = {}): Promise<string> {
  const body = photoBody(itemId, extra);
  const res = await api.post(`/api/v1/executions/${executionId}/media`, body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return body.id;
}

export const answersBody = (rev: number, answers: Answers, deviceTime: string, extra: Record<string, unknown> = {}) => ({ rev, answers, deviceTime, clientOffsetMs: 0, ...extra });
