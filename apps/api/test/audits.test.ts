import { auditScore, type AuditVerdict, missingVerdicts } from '@taskop/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { type AuditWorld, auditLogOf, auditWorld, correct, sendBack, startAudit } from './audit-fixtures';
import { historyOf, statusOf } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { type Api, MONDAY_0800 } from './scheduling-fixtures';

const AT = '2026-11-02T05:00:00.000Z';

describe('audits: start, read, verdicts, cancel (spec §3.1, §6.2)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  const world = async (opts: { requiresAudit?: boolean; problemYes?: boolean } = {}): Promise<AuditWorld> => {
    const a = await auditWorld(t, clock, opts);
    clock.set(AT);
    return a;
  };
  const started = async (a: AuditWorld): Promise<string> => {
    const res = await startAudit(a.auditor.api, a.executionId);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  };
  const verdict = (api: Api, auditId: string, itemId: string, body: object) => api.put(`/api/v1/audits/${auditId}/items/${itemId}`, body);
  const detail = async (api: Api, auditId: string) => (await api.get(`/api/v1/audits/${auditId}`)).body;

  it('starts an audit on a completed run: audit_pending by the auditor, and an audit entry', async () => {
    const a = await world();
    const res = await startAudit(a.auditor.api, a.executionId);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String), executionId: a.executionId, occurrenceId: a.w.occurrenceId, status: 'in_progress', paused: false,
      auditor: { kind: 'user', id: a.auditor.id, name: 'Auditor' }, startedAt: AT, finishedAt: null, cancelledAt: null, cancelReason: null,
      result: null, score: null, comment: null, reportStatus: 'none', reportRecipients: [], reportSentAt: null, verdicts: [],
    });
    expect(await statusOf(a.w.occurrenceId)).toBe('audit_pending');
    expect((await historyOf(a.w.occurrenceId)).at(-1)).toEqual(['completed', 'audit_pending', AT, null, a.auditor.id]);
    expect((await auditLogOf(res.body.id)).map((l) => [l.action, l.entity_type, l.actor_user_id])).toEqual([['audit.started', 'audit', a.auditor.id]]);
  });

  it('starts on a run already waiting without a status change', async () => {
    const a = await world({ requiresAudit: true });
    const before = (await historyOf(a.w.occurrenceId)).length;
    await started(a);
    expect(await statusOf(a.w.occurrenceId)).toBe('audit_pending');
    expect(await historyOf(a.w.occurrenceId)).toHaveLength(before);
  });

  it('refuses a second audit with its id, an audited run and a partial run', async () => {
    const a = await world();
    const auditId = await started(a);
    const again = await startAudit(a.auditor.api, a.executionId);
    expect([again.status, again.body.error.code, again.body.error.auditId]).toEqual([409, 'AUDIT_EXISTS', auditId]);
    await ownerQuery("update occurrences set status = 'audited' where id = $1", [a.w.occurrenceId]);
    expect((await startAudit(a.auditor.api, a.executionId)).body.error.code).toBe('EXECUTION_LOCKED');
    const p = await world();
    await ownerQuery("update occurrences set status = 'partial' where id = $1", [p.w.occurrenceId]);
    await ownerQuery("update executions set state = 'partial' where id = $1", [p.executionId]);
    expect((await startAudit(p.auditor.api, p.executionId)).body.error.code).toBe('EXECUTION_NOT_CORRECTABLE');
  });

  it('shows the audit with its run, history and auditable items to auditors and report viewers in scope', async () => {
    const a = await world();
    const auditId = await started(a);
    const body = await detail(a.auditor.api, auditId);
    expect(body).toMatchObject({
      id: auditId,
      execution: { id: a.executionId, answers: a.answers, audit: { id: auditId, status: 'in_progress', paused: false } },
      corrections: { original: null, corrections: [], reworkRequests: [], diff: [] },
      // "Xeyr" hides the follow-up comment.
      auditableItemIds: [a.w.c.problem.id, a.w.c.temp.id, a.w.c.photo.id, a.w.c.note.id],
      checklistReportEmails: [],
      requiresAudit: false,
    });
    expect((await a.manager.api.get(`/api/v1/audits/${auditId}`)).status).toBe(200);
    expect((await a.outsider.api.get(`/api/v1/audits/${auditId}`)).status).toBe(404);
    expect((await a.worker.api.get(`/api/v1/audits/${auditId}`)).status).toBe(403);
  });

  it('records verdicts: approve, reject with a comment, change and clear, without audit-log entries', async () => {
    const a = await world();
    const auditId = await started(a);
    const ok = await verdict(a.auditor.api, auditId, a.w.c.temp.id, { verdict: 'approved' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toEqual({ itemId: a.w.c.temp.id, verdict: 'approved', comment: null, updatedBy: { id: a.auditor.id, fullName: 'Auditor' }, updatedAt: AT });
    const noComment = await verdict(a.auditor.api, auditId, a.w.c.temp.id, { verdict: 'rejected' });
    expect([noComment.status, noComment.body.error.fields]).toEqual([400, { comment: 'audits.issues.commentRequired' }]);
    expect((await verdict(a.auditor.api, auditId, a.w.c.temp.id, { verdict: 'rejected', comment: 'Temperatur yüksəkdir' })).body).toMatchObject({ verdict: 'rejected', comment: 'Temperatur yüksəkdir' });
    await verdict(a.auditor.api, auditId, a.w.c.photo.id, { verdict: 'approved' });
    expect((await detail(a.auditor.api, auditId)).verdicts.map((v: { itemId: string; verdict: string }) => [v.itemId, v.verdict])).toEqual(
      expect.arrayContaining([[a.w.c.temp.id, 'rejected'], [a.w.c.photo.id, 'approved']]),
    );
    expect((await a.auditor.api.delete(`/api/v1/audits/${auditId}/items/${a.w.c.photo.id}`)).status).toBe(204);
    expect((await detail(a.auditor.api, auditId)).verdicts.map((v: { itemId: string }) => v.itemId)).toEqual([a.w.c.temp.id]);
    expect((await auditLogOf(auditId)).map((l) => l.action)).toEqual(['audit.started']);
  });

  it('refuses verdicts on unknown and hidden items, and from report viewers', async () => {
    const a = await world();
    const auditId = await started(a);
    expect((await verdict(a.auditor.api, auditId, '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f', { verdict: 'approved' })).status).toBe(404);
    const hidden = await verdict(a.auditor.api, auditId, a.w.c.comment.id, { verdict: 'approved' });
    expect([hidden.status, hidden.body.error.fields]).toEqual([400, { itemId: 'audits.issues.notAuditable' }]);
    expect((await verdict(a.manager.api, auditId, a.w.c.temp.id, { verdict: 'approved' })).status).toBe(403);
  });

  it('ignores verdicts on items the current answers hide', async () => {
    const a = await world({ problemYes: true });
    const auditId = await started(a);
    expect((await detail(a.auditor.api, auditId)).auditableItemIds).toContain(a.w.c.comment.id);
    await verdict(a.auditor.api, auditId, a.w.c.comment.id, { verdict: 'rejected', comment: 'Təsvir natamamdır' });
    // A manager corrects "Bəli" to "Xeyr": the follow-up comment is hidden, its answer and verdict stay.
    const fix = await correct(a.manager.api, a.executionId, { answersRev: 1, changes: [{ itemId: a.w.c.problem.id, answer: { optionIds: [a.w.c.no.id], photos: [] } }], reason: 'Problem yox idi' });
    expect(fix.status, JSON.stringify(fix.body)).toBe(200);
    for (const itemId of [a.w.c.problem.id, a.w.c.temp.id, a.w.c.photo.id, a.w.c.note.id]) await verdict(a.auditor.api, auditId, itemId, { verdict: 'approved' });
    const body = await detail(a.auditor.api, auditId);
    expect(body.auditableItemIds).not.toContain(a.w.c.comment.id);
    expect(body.verdicts.map((v: { itemId: string }) => v.itemId)).toContain(a.w.c.comment.id);
    const verdicts = new Map<string, AuditVerdict>(body.verdicts.map((v: { itemId: string; verdict: AuditVerdict }) => [v.itemId, v.verdict]));
    expect(missingVerdicts(verdicts, body.auditableItemIds)).toEqual([]);
    expect(auditScore(verdicts, body.auditableItemIds)).toEqual({ approved: 4, rejected: 0, reviewed: 4, percent: 100 });
    // A verdict can no longer be set on the hidden item.
    expect((await verdict(a.auditor.api, auditId, a.w.c.comment.id, { verdict: 'approved' })).body.error.fields).toEqual({ itemId: 'audits.issues.notAuditable' });
  });

  it('cancels: back to completed, or still waiting when the checklist requires audit; a second cancel is refused', async () => {
    const a = await world();
    const auditId = await started(a);
    const res = await a.auditor.api.post(`/api/v1/audits/${auditId}/cancel`, { reason: 'Səhv icra seçildi' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'cancelled', cancelledAt: AT, cancelReason: 'Səhv icra seçildi' });
    expect(await statusOf(a.w.occurrenceId)).toBe('completed');
    expect((await historyOf(a.w.occurrenceId)).at(-1)).toEqual(['audit_pending', 'completed', AT, 'Səhv icra seçildi', a.auditor.id]);
    expect((await a.auditor.api.post(`/api/v1/audits/${auditId}/cancel`, { reason: 'x' })).body.error.code).toBe('AUDIT_NOT_IN_PROGRESS');
    expect((await verdict(a.auditor.api, auditId, a.w.c.temp.id, { verdict: 'approved' })).body.error.code).toBe('AUDIT_NOT_IN_PROGRESS');
    expect((await auditLogOf(auditId)).map((l) => [l.action, l.after])).toEqual([
      ['audit.started', { executionId: a.executionId, occurrenceId: a.w.occurrenceId }],
      ['audit.cancelled', { reason: 'Səhv icra seçildi', status: 'completed' }],
    ]);
    // A new audit can start after a cancelled one.
    expect((await startAudit(a.auditor.api, a.executionId)).status).toBe(201);
    const required = await world({ requiresAudit: true });
    const requiredAudit = await started(required);
    await required.auditor.api.post(`/api/v1/audits/${requiredAudit}/cancel`, { reason: 'Sonra' });
    expect(await statusOf(required.w.occurrenceId)).toBe('audit_pending');
  });

  it('pauses while the run is sent back: verdicts still change, cancel leaves the status for the resubmit', async () => {
    const a = await world();
    const auditId = await started(a);
    await sendBack(a.manager.api, a.executionId, { items: [{ itemId: a.w.c.temp.id, comment: 'Yenidən ölçün' }] });
    expect(await detail(a.auditor.api, auditId)).toMatchObject({ status: 'in_progress', paused: true });
    expect((await verdict(a.auditor.api, auditId, a.w.c.photo.id, { verdict: 'approved' })).status).toBe(200);
    expect((await a.auditor.api.post(`/api/v1/audits/${auditId}/cancel`, { reason: 'Gözləmirik' })).status).toBe(200);
    expect(await statusOf(a.w.occurrenceId)).toBe('correction_required');
  });
});
