import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DomainEvents } from '../src/common/domain-events';
import { OccurrenceJobs } from '../src/scheduling/occurrence-jobs';
import { createTestApp, type TestApp } from './app';
import { type AuditWorld, auditLogOf, auditWorld, correctionRows, problemRows, resubmit, reworkRows, sendBack, withdraw } from './audit-fixtures';
import { answersBody, executionRow, historyOf, photoBody, statusOf } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';

/** Hours after the window closed at 07:00Z: rework is not limited by closes_at. */
const LATER = '2026-11-02T12:00:00.000Z';

describe('rework on the phone (spec §3.2, §6.2)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  /** The manager sends the temperature (and the photo item) back at 09:00 Baku; the clock then reads 16:00 Baku. */
  async function sentBack(opts: { requiresAudit?: boolean; photo?: boolean; status?: 'audit_pending' } = {}) {
    const a = await auditWorld(t, clock, { requiresAudit: opts.requiresAudit });
    if (opts.status) await ownerQuery('update occurrences set status = $2 where id = $1', [a.w.occurrenceId, opts.status]);
    clock.set('2026-11-02T05:00:00Z');
    const items = [{ itemId: a.w.c.temp.id, comment: 'Temperaturu yenidən ölçün' }, ...(opts.photo ? [{ itemId: a.w.c.photo.id, comment: 'Foto bulanıqdır' }] : [])];
    const res = await sendBack(a.manager.api, a.executionId, { items });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    clock.set(LATER);
    return a;
  }
  const save = (a: AuditWorld, rev: number, answers: object) => a.worker.api.put(`/api/v1/executions/${a.executionId}/answers`, answersBody(rev, answers as never, LATER));
  const fixedTemp = (a: AuditWorld) => ({ ...a.answers, [a.w.c.temp.id]: { number: 5, note: 'yenidən ölçüldü' } });

  it('takes changes to flagged items only, after closes_at, without recalculating yet', async () => {
    const a = await sentBack();
    const ok = await save(a, 2, fixedTemp(a));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ rev: 2, stale: false, state: 'rework' });
    expect(await executionRow(a.executionId)).toMatchObject({ answers_rev: 2, answers: fixedTemp(a), score: { percent: 50 } });
    const outside = await save(a, 3, { ...fixedTemp(a), [a.w.c.problem.id]: { optionIds: [a.w.c.yes.id] } });
    expect([outside.status, outside.body.error.code, outside.body.error.fields]).toEqual([422, 'ITEM_NOT_IN_REWORK', { [`answers.${a.w.c.problem.id}`]: 'errors.ITEM_NOT_IN_REWORK' }]);
    expect((await executionRow(a.executionId)).answers_rev).toBe(2);
    // A stale command is still ignored before any check.
    expect((await save(a, 1, {})).body).toMatchObject({ rev: 2, stale: true });
  });

  it('takes media for flagged items and manual problems only', async () => {
    const a = await sentBack({ photo: true });
    const register = (itemId: string | null) => a.worker.api.post(`/api/v1/executions/${a.executionId}/media`, photoBody(itemId, { capturedAt: LATER, deviceTime: LATER }));
    expect((await register(a.w.c.photo.id)).status).toBe(200);
    expect((await register(null)).status).toBe(200);
    const notFlagged = await register(a.w.c.problem.id);
    expect([notFlagged.status, notFlagged.body.error.code]).toEqual([422, 'ITEM_NOT_IN_REWORK']);
  });

  it('resubmits: rework corrections with the comments as reasons, recalculation, completed again, an event and an audit entry', async () => {
    const a = await sentBack();
    await save(a, 2, fixedTemp(a));
    const seen: unknown[] = [];
    const off = t.app.get(DomainEvents).on('execution.resubmitted', (e) => void seen.push(e));
    const res = await resubmit(a.worker.api, a.executionId, LATER);
    off();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      executionId: a.executionId, state: 'completed', status: 'completed',
      progress: { answered: 3, total: 4, requiredMissing: 0 }, score: { earned: 2, possible: 2, percent: 100, problems: [] },
    });
    const rows = await correctionRows(a.executionId);
    expect(rows).toEqual([
      expect.objectContaining({
        item_id: a.w.c.temp.id, kind: 'rework', round: 1, before: { number: 10, note: 'isti' }, after: { number: 5, note: 'yenidən ölçüldü' },
        reason: 'Temperaturu yenidən ölçün', actor_user_id: a.worker.id,
      }),
    ]);
    expect((await problemRows(a.executionId)).map((p) => [p.item_id, p.cleared_by_correction_id])).toEqual([[a.w.c.temp.id, rows[0]!.id]]);
    expect((await reworkRows(a.executionId))[0]!.resubmitted_at?.toISOString()).toBe(LATER);
    const x = await executionRow(a.executionId);
    expect(x).toMatchObject({ state: 'completed', late: false });
    expect(x.completed_at?.toISOString()).toBe('2026-11-02T04:20:00.000Z');
    expect(await statusOf(a.w.occurrenceId)).toBe('completed');
    expect((await historyOf(a.w.occurrenceId)).at(-1)).toEqual(['correction_required', 'completed', LATER, null, a.worker.id]);
    expect(seen).toEqual([{ tenantId: a.w.s.tenantId, executionId: a.executionId, occurrenceId: a.w.occurrenceId, round: 1, actorUserId: a.worker.id }]);
    expect((await auditLogOf(a.executionId)).map((l) => [l.action, l.actor_user_id])).toEqual([
      ['execution.sent_back', a.manager.id],
      ['execution.resubmitted', a.worker.id],
    ]);
  });

  it('goes to audit_pending when the checklist requires audit', async () => {
    const a = await sentBack();
    await ownerQuery('update checklists set requires_audit = true where id = $1', [a.w.checklistId]);
    await save(a, 2, fixedTemp(a));
    expect((await resubmit(a.worker.api, a.executionId, LATER)).body.status).toBe('audit_pending');
    expect(await statusOf(a.w.occurrenceId)).toBe('audit_pending');
  });

  it('resets the verdicts of changed items while an audit is open, and returns the run to the audit', async () => {
    const a = await auditWorld(t, clock);
    await ownerQuery("update occurrences set status = 'audit_pending' where id = $1", [a.w.occurrenceId]);
    const auditId = uuidv7();
    await ownerQuery(
      "insert into audits (id, tenant_id, execution_id, occurrence_id, status, auditor_user_id, started_at) values ($1, $2, $3, $4, 'in_progress', $5, now())",
      [auditId, a.w.s.tenantId, a.executionId, a.w.occurrenceId, a.auditor.id],
    );
    await ownerQuery(
      `insert into audit_item_verdicts (tenant_id, audit_id, item_id, verdict, comment, updated_by_user_id, updated_at)
       values ($1, $2, $3, 'rejected', 'Temperatur yüksəkdir', $4, now()), ($1, $2, $5, 'approved', null, $4, now())`,
      [a.w.s.tenantId, auditId, a.w.c.temp.id, a.auditor.id, a.w.c.photo.id],
    );
    clock.set('2026-11-02T05:00:00Z');
    await sendBack(a.manager.api, a.executionId, { items: [{ itemId: a.w.c.temp.id, comment: 'Yenidən ölçün' }] });
    clock.set(LATER);
    await save(a, 2, fixedTemp(a));
    expect((await resubmit(a.worker.api, a.executionId, LATER)).body.status).toBe('audit_pending');
    const verdicts = await ownerQuery<{ item_id: string }>('select item_id from audit_item_verdicts where audit_id = $1', [auditId]);
    expect(verdicts.rows.map((v) => v.item_id)).toEqual([a.w.c.photo.id]);
  });

  it('answers a repeated resubmit with the same result and writes nothing more', async () => {
    const a = await sentBack();
    await save(a, 2, fixedTemp(a));
    const first = await resubmit(a.worker.api, a.executionId, LATER);
    const again = await resubmit(a.worker.api, a.executionId, LATER);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(await correctionRows(a.executionId)).toHaveLength(1);
    expect((await historyOf(a.w.occurrenceId)).filter((h) => h[0] === 'correction_required')).toHaveLength(1);
  });

  it('refuses a resubmit after the send-back was withdrawn', async () => {
    const a = await sentBack();
    await save(a, 2, fixedTemp(a));
    expect((await withdraw(a.manager.api, a.executionId)).status).toBe(200);
    const res = await resubmit(a.worker.api, a.executionId, LATER);
    expect([res.status, res.body.error.code]).toEqual([409, 'EXECUTION_NOT_ACTIVE']);
    expect(await correctionRows(a.executionId)).toEqual([]);
    expect(await statusOf(a.w.occurrenceId)).toBe('completed');
    expect((await reworkRows(a.executionId))[0]).toMatchObject({ resubmitted_at: null });
    // The withdrawal restored the answers the run was sent back from (R7); the rework answers were never corrections.
    expect((await executionRow(a.executionId)).answers).toEqual(a.answers);
    expect((await auditLogOf(a.executionId)).map((l) => l.action)).toEqual(['execution.sent_back', 'execution.send_back_withdrawn']);
    // Later rework commands of the stale phone are refused the same way: answers and a new medium.
    // The withdrawal bumped the rev to 3, so the stale phone's next save carries rev 4.
    expect((await save(a, 4, fixedTemp(a))).body.error.code).toBe('EXECUTION_NOT_ACTIVE');
    const media = await a.worker.api.post(`/api/v1/executions/${a.executionId}/media`, photoBody(a.w.c.temp.id, { capturedAt: LATER, deviceTime: LATER }));
    expect([media.status, media.body.error.code]).toEqual([409, 'EXECUTION_NOT_ACTIVE']);
  });

  it('refuses the queued commands of a stale phone after a withdrawal and writes nothing (R7)', async () => {
    const a = await sentBack({ photo: true });
    expect((await save(a, 2, fixedTemp(a))).status).toBe(200);
    expect((await withdraw(a.manager.api, a.executionId)).status).toBe(200);
    // The withdrawal restores the answers sent back from and moves the rev on (current + 1).
    expect(await executionRow(a.executionId)).toMatchObject({ state: 'completed', answers_rev: 3, answers: a.answers });
    const mediaBefore = (await ownerQuery('select id from execution_media where execution_id = $1', [a.executionId])).rowCount;
    // Rev 3 is not newer than the server's: still the existing stale answer, nothing written.
    expect((await save(a, 3, fixedTemp(a))).body).toMatchObject({ rev: 3, stale: true, state: 'completed' });
    const queued = await save(a, 4, fixedTemp(a));
    expect([queued.status, queued.body.error.code]).toEqual([409, 'EXECUTION_NOT_ACTIVE']);
    const media = await a.worker.api.post(`/api/v1/executions/${a.executionId}/media`, photoBody(a.w.c.photo.id, { capturedAt: LATER, deviceTime: LATER }));
    expect([media.status, media.body.error.code]).toEqual([409, 'EXECUTION_NOT_ACTIVE']);
    const again = await resubmit(a.worker.api, a.executionId, LATER);
    expect([again.status, again.body.error.code]).toEqual([409, 'EXECUTION_NOT_ACTIVE']);
    expect(await executionRow(a.executionId)).toMatchObject({ state: 'completed', answers_rev: 3, answers: a.answers });
    expect((await ownerQuery('select id from execution_media where execution_id = $1', [a.executionId])).rowCount).toBe(mediaBefore);
    expect(await correctionRows(a.executionId)).toEqual([]);
    expect((await reworkRows(a.executionId))[0]).toMatchObject({ resubmitted_at: null });
    expect(await statusOf(a.w.occurrenceId)).toBe('completed');
  });

  it('refuses an incomplete resubmit and keeps the rework open', async () => {
    const a = await sentBack({ photo: true });
    await save(a, 2, { ...a.answers, [a.w.c.photo.id]: { photos: [] } });
    const res = await resubmit(a.worker.api, a.executionId, LATER);
    expect([res.status, res.body.error.code, res.body.error.missing]).toEqual([422, 'REQUIREMENTS_UNMET', [{ itemId: a.w.c.photo.id, kind: 'answer' }]]);
    expect((await executionRow(a.executionId)).state).toBe('rework');
    expect(await statusOf(a.w.occurrenceId)).toBe('correction_required');
  });

  it('lets a flagged change reveal a required follow-up, which the worker answers, and resubmits', async () => {
    const a = await auditWorld(t, clock);
    clock.set('2026-11-02T05:00:00Z');
    await sendBack(a.manager.api, a.executionId, { items: [{ itemId: a.w.c.problem.id, comment: 'Problem var idi, düzəldin' }] });
    clock.set(LATER);
    // "Bəli" asks for a photo on the item and reveals the required follow-up comment, which was never flagged.
    const photo = await a.worker.api.post(`/api/v1/executions/${a.executionId}/media`, photoBody(a.w.c.problem.id, { capturedAt: LATER, deviceTime: LATER }));
    expect(photo.status, JSON.stringify(photo.body)).toBe(200);
    const photoId = photo.body.mediaId as string;
    const answers = { ...a.answers, [a.w.c.problem.id]: { optionIds: [a.w.c.yes.id], photos: [photoId] }, [a.w.c.comment.id]: { text: 'Su axır' } };
    const saved = await save(a, 2, answers);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const res = await resubmit(a.worker.api, a.executionId, LATER);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('completed');
    expect((await correctionRows(a.executionId)).map((c) => [c.item_id, c.kind, c.reason])).toEqual([
      [a.w.c.problem.id, 'rework', 'Problem var idi, düzəldin'],
      [a.w.c.comment.id, 'rework', 'Problem var idi, düzəldin'],
    ]);
  });

  it('accepts a follow-up answered and then hidden again, and resubmits without a correction for it', async () => {
    const a = await auditWorld(t, clock);
    clock.set('2026-11-02T05:00:00Z');
    await sendBack(a.manager.api, a.executionId, { items: [{ itemId: a.w.c.problem.id, comment: 'Yenidən baxın' }] });
    clock.set(LATER);
    const photo = (await a.worker.api.post(`/api/v1/executions/${a.executionId}/media`, photoBody(a.w.c.problem.id, { capturedAt: LATER, deviceTime: LATER }))).body.mediaId as string;
    const shown = { ...a.answers, [a.w.c.problem.id]: { optionIds: [a.w.c.yes.id], photos: [photo] }, [a.w.c.comment.id]: { text: 'Su axır' } };
    expect((await save(a, 2, shown)).status).toBe(200);
    // Back to "Xeyr": the follow-up is hidden again, its answer left behind.
    const hidden = { ...a.answers, [a.w.c.comment.id]: { text: 'Su axır' } };
    const saved = await save(a, 3, hidden);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const res = await resubmit(a.worker.api, a.executionId, LATER);
    expect([res.status, res.body.status]).toEqual([200, 'completed']);
    expect(await correctionRows(a.executionId)).toEqual([]);
  });

  it('is for the executor only', async () => {
    const a = await sentBack();
    expect((await resubmit(a.w.workers[1].api, a.executionId, LATER)).body.error.code).toBe('NOT_EXECUTOR');
    expect((await a.w.workers[1].api.put(`/api/v1/executions/${a.executionId}/answers`, answersBody(2, fixedTemp(a), LATER))).body.error.code).toBe('NOT_EXECUTOR');
  });

  it('carries the rework run in /me/sync whatever its date, and drops it once resubmitted and out of the windows', async () => {
    const a = await sentBack();
    clock.set('2026-11-05T08:00:00Z');
    const pull = async () => (await a.worker.api.get('/api/v1/me/sync')).body;
    const during = await pull();
    expect(during.executions.find((x: { id: string }) => x.id === a.executionId)).toMatchObject({
      state: 'rework',
      reworkRound: 1,
      rework: { round: 1, items: [{ itemId: a.w.c.temp.id, comment: 'Temperaturu yenidən ölçün' }], dueAt: null, requestedBy: { id: a.manager.id, fullName: 'Menecer' } },
    });
    expect(during.occurrences.find((o: { id: string }) => o.id === a.w.occurrenceId)).toMatchObject({ status: 'correction_required', checklistVersionId: a.w.versionId });
    expect(during.checklistVersions.map((v: { id: string }) => v.id)).toContain(a.w.versionId);
    // Another worker of the same site never gets it.
    expect((await a.w.workers[1].api.get('/api/v1/me/sync')).body.executions).toEqual([]);
    await save(a, 2, fixedTemp(a));
    expect((await resubmit(a.worker.api, a.executionId, '2026-11-05T08:00:00.000Z')).status).toBe(200);
    clock.set('2026-11-06T09:00:00Z');
    const after = await pull();
    expect(after.executions.map((x: { id: string }) => x.id)).not.toContain(a.executionId);
    expect(after.occurrences.map((o: { id: string }) => o.id)).not.toContain(a.w.occurrenceId);
  });

  it('leaves rework runs to the worker: the partial sweep never touches them', async () => {
    const a = await sentBack();
    clock.set('2026-11-03T12:00:00Z');
    await t.app.get(OccurrenceJobs).sweepAll([a.w.s.tenantId]);
    expect((await executionRow(a.executionId)).state).toBe('rework');
    expect(await statusOf(a.w.occurrenceId)).toBe('correction_required');
  });
});
