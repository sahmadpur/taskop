import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DomainEvents } from '../src/common/domain-events';
import { JobsService } from '../src/scheduling/jobs.service';
import { createTestApp, type TestApp } from './app';
import { type AuditWorld, auditLogOf, auditWorld, correct, markUploaded, resubmit, sendBack, startAudit, verdictAll } from './audit-fixtures';
import { answersBody, historyOf, statusOf } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';

const AT = '2026-11-02T05:00:00.000Z';
const DONE = '2026-11-02T06:00:00.000Z';

describe('finishing an audit (FR-19.06, spec §6.2)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => {
    clock.set(MONDAY_0800);
    vi.restoreAllMocks();
  });
  afterAll(() => t.close());

  /** A run with an audit in progress; `items` are the four auditable items ("Xeyr" hides the follow-up). */
  async function audited(opts: { problemYes?: boolean } = {}) {
    const a = await auditWorld(t, clock, opts);
    clock.set(AT);
    const res = await startAudit(a.auditor.api, a.executionId);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const items = [a.w.c.problem.id, a.w.c.temp.id, a.w.c.photo.id, a.w.c.note.id];
    return { a, auditId: res.body.id as string, items };
  }
  const finish = (a: AuditWorld, auditId: string, body: object) => a.auditor.api.post(`/api/v1/audits/${auditId}/finish`, body);

  it('refuses to finish while auditable items lack a verdict, naming them', async () => {
    const { a, auditId, items } = await audited();
    await markUploaded(a.executionId);
    await verdictAll(a.auditor.api, auditId, items.slice(0, 2));
    const res = await finish(a, auditId, { result: 'passed' });
    expect([res.status, res.body.error.code, res.body.error.itemIds]).toEqual([422, 'AUDIT_INCOMPLETE', items.slice(2)]);
  });

  it('refuses to finish while a photo of the answers is still uploading', async () => {
    const { a, auditId, items } = await audited();
    await verdictAll(a.auditor.api, auditId, items);
    expect((await finish(a, auditId, { result: 'passed' })).body.error.code).toBe('MEDIA_NOT_FOUND_IN_STORAGE');
    await markUploaded(a.executionId);
    expect((await finish(a, auditId, { result: 'passed' })).status).toBe(200);
  });

  it('refuses to finish while the run is sent back', async () => {
    const { a, auditId, items } = await audited();
    await markUploaded(a.executionId);
    await verdictAll(a.auditor.api, auditId, items);
    await sendBack(a.manager.api, a.executionId, { items: [{ itemId: a.w.c.temp.id, comment: 'Yenidən ölçün' }] });
    expect((await finish(a, auditId, { result: 'passed' })).body.error.code).toBe('AUDIT_PAUSED');
  });

  it('finishes: audited, the score, the recipients, the report pending, the event, the audit entry and the job', async () => {
    const { a, auditId, items } = await audited();
    await ownerQuery("update checklists set audit_report_emails = '{qa@acme.az}' where id = $1", [a.w.checklistId]);
    await markUploaded(a.executionId);
    await verdictAll(a.auditor.api, auditId, items, [a.w.c.temp.id]);
    const send = vi.spyOn(t.app.get(JobsService), 'send');
    const seen: unknown[] = [];
    const off = t.app.get(DomainEvents).on('audit.finished', (e) => void seen.push(e));
    clock.set(DONE);
    const res = await finish(a, auditId, { result: 'failed', comment: 'Temperatur rejimi pozulub', extraEmails: ['Boss@acme.az', 'qa@acme.az'] });
    off();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const score = { approved: 3, rejected: 1, reviewed: 4, percent: 75 };
    expect(res.body).toMatchObject({
      status: 'finished', finishedAt: DONE, result: 'failed', score, comment: 'Temperatur rejimi pozulub',
      reportStatus: 'pending', reportRecipients: ['qa@acme.az', 'boss@acme.az'], reportSentAt: null, paused: false,
    });
    expect(await statusOf(a.w.occurrenceId)).toBe('audited');
    expect((await historyOf(a.w.occurrenceId)).at(-1)).toEqual(['audit_pending', 'audited', DONE, null, a.auditor.id]);
    expect(seen).toEqual([{ tenantId: a.w.s.tenantId, auditId, executionId: a.executionId, occurrenceId: a.w.occurrenceId, result: 'failed', actorUserId: a.auditor.id }]);
    expect(send).toHaveBeenCalledWith('audit.report', { tenantId: a.w.s.tenantId, auditId });
    expect((await auditLogOf(auditId)).at(-1)).toMatchObject({
      action: 'audit.finished',
      after: { result: 'failed', score, rejectedItemIds: [a.w.c.temp.id], comment: 'Temperatur rejimi pozulub', recipients: ['qa@acme.az', 'boss@acme.az'] },
    });
  });

  it('refuses a merged recipient list over 20 instead of truncating it, and accepts exactly 20', async () => {
    const { a, auditId, items } = await audited();
    const emails = (from: number, n: number) => Array.from({ length: n }, (_, i) => `u${from + i}@acme.az`);
    await ownerQuery('update checklists set audit_report_emails = $2 where id = $1', [a.w.checklistId, emails(0, 10)]);
    await markUploaded(a.executionId);
    await verdictAll(a.auditor.api, auditId, items);
    const tooMany = await finish(a, auditId, { result: 'passed', extraEmails: emails(10, 11) });
    expect([tooMany.status, tooMany.body.error.code, tooMany.body.error.fields]).toEqual([400, 'VALIDATION_FAILED', { extraEmails: 'audits.issues.tooManyEmails' }]);
    expect((await ownerQuery<{ status: string }>('select status from audits where id = $1', [auditId])).rows[0]!.status).toBe('in_progress');
    // Addresses the checklist already lists do not count twice.
    const ok = await finish(a, auditId, { result: 'passed', extraEmails: [...emails(0, 3), ...emails(10, 10)] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.reportRecipients).toEqual(emails(0, 20));
  });

  it('locks the run once audited', async () => {
    const { a, auditId, items } = await audited();
    await markUploaded(a.executionId);
    await verdictAll(a.auditor.api, auditId, items);
    expect((await finish(a, auditId, { result: 'passed' })).status).toBe(200);
    expect((await correct(a.manager.api, a.executionId, { answersRev: 1, changes: [{ itemId: a.w.c.temp.id, answer: { number: 5 } }], reason: 'x' })).body.error.code).toBe('EXECUTION_LOCKED');
    expect((await sendBack(a.manager.api, a.executionId, { items: [{ itemId: a.w.c.temp.id, comment: 'x' }] })).body.error.code).toBe('EXECUTION_LOCKED');
    expect((await startAudit(a.auditor.api, a.executionId)).body.error.code).toBe('EXECUTION_LOCKED');
    for (const res of [
      await finish(a, auditId, { result: 'passed' }),
      await a.auditor.api.put(`/api/v1/audits/${auditId}/items/${a.w.c.temp.id}`, { verdict: 'approved' }),
      await a.auditor.api.post(`/api/v1/audits/${auditId}/cancel`, { reason: 'x' }),
    ]) {
      expect(res.body.error.code).toBe('AUDIT_NOT_IN_PROGRESS');
    }
    expect((await finish({ ...a, auditor: a.manager }, auditId, { result: 'passed' })).status).toBe(403);
  });

  it('finishes when only items the answers hide lack a verdict, and leaves them out of the score', async () => {
    const { a, auditId } = await audited({ problemYes: true });
    await markUploaded(a.executionId);
    await verdictAll(a.auditor.api, auditId, [a.w.c.comment.id], [a.w.c.comment.id]);
    await correct(a.manager.api, a.executionId, { answersRev: 1, changes: [{ itemId: a.w.c.problem.id, answer: { optionIds: [a.w.c.no.id], photos: [] } }], reason: 'Problem yox idi' });
    await verdictAll(a.auditor.api, auditId, [a.w.c.problem.id, a.w.c.temp.id, a.w.c.photo.id, a.w.c.note.id]);
    const res = await finish(a, auditId, { result: 'passed' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.score).toEqual({ approved: 4, rejected: 0, reviewed: 4, percent: 100 });
    expect((await auditLogOf(auditId)).at(-1)!.after).toMatchObject({ rejectedItemIds: [] });
  });

  it('resumes after a resubmit: the changed item needs a new verdict, then the audit finishes', async () => {
    const { a, auditId, items } = await audited();
    await markUploaded(a.executionId);
    await verdictAll(a.auditor.api, auditId, items, [a.w.c.temp.id]);
    await sendBack(a.manager.api, a.executionId, { items: [{ itemId: a.w.c.temp.id, comment: 'Yenidən ölçün' }] });
    const later = '2026-11-02T12:00:00.000Z';
    clock.set(later);
    await a.worker.api.put(`/api/v1/executions/${a.executionId}/answers`, answersBody(2, { ...a.answers, [a.w.c.temp.id]: { number: 5 } }, later));
    expect((await resubmit(a.worker.api, a.executionId, later)).body.status).toBe('audit_pending');
    const incomplete = await finish(a, auditId, { result: 'passed' });
    expect([incomplete.body.error.code, incomplete.body.error.itemIds]).toEqual(['AUDIT_INCOMPLETE', [a.w.c.temp.id]]);
    await verdictAll(a.auditor.api, auditId, [a.w.c.temp.id]);
    expect((await finish(a, auditId, { result: 'passed' })).body).toMatchObject({ status: 'finished', score: { approved: 4, percent: 100 } });
  });
});
