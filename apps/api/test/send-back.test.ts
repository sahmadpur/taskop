import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DomainEvents } from '../src/common/domain-events';
import { createTestApp, type TestApp } from './app';
import { type AuditWorld, auditLogOf, auditWorld, correct, correctionRows, problemRows, reworkRows, sendBack, withdraw } from './audit-fixtures';
import { executionRow, historyOf, statusOf } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';

const AT = '2026-11-02T05:00:00.000Z';
const DUE = '2026-11-03T06:00:00.000Z';

describe('send-back and withdrawal (spec §3.1, §6.2)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  const world = async (opts: { requiresAudit?: boolean } = {}): Promise<AuditWorld> => {
    const a = await auditWorld(t, clock, opts);
    clock.set(AT);
    return a;
  };
  const items = (a: AuditWorld) => [
    { itemId: a.w.c.photo.id, comment: 'Foto bulanıqdır, yenidən çəkin' },
    { itemId: a.w.c.temp.id, comment: 'Temperaturu yenidən ölçün' },
  ];

  it('sends a run back: the request, rework state, round 1, correction_required, the snapshot, the event and the audit entry', async () => {
    const a = await world();
    const seen: unknown[] = [];
    const off = t.app.get(DomainEvents).on('execution.sent_back', (e) => void seen.push(e));
    const res = await sendBack(a.manager.api, a.executionId, { items: items(a), dueAt: DUE });
    off();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      id: expect.any(String), round: 1, items: items(a), dueAt: DUE, requestedBy: { id: a.manager.id, fullName: 'Menecer' },
      requestedAt: AT, resubmittedAt: null, withdrawnAt: null, withdrawnBy: null, answersBefore: a.answers,
    });
    expect(await reworkRows(a.executionId)).toEqual([
      expect.objectContaining({ round: 1, answers_before: a.answers, status_before: 'completed', requested_by_user_id: a.manager.id, due_at: new Date(DUE) }),
    ]);
    expect(await executionRow(a.executionId)).toMatchObject({ state: 'rework', answers: a.answers, answers_rev: 1 });
    const x = await ownerQuery<{ rework_round: number; original_answers: unknown; original_captured_at: Date }>('select rework_round, original_answers, original_captured_at from executions where id = $1', [a.executionId]);
    expect(x.rows[0]).toEqual({ rework_round: 1, original_answers: a.answers, original_captured_at: new Date(AT) });
    expect(await statusOf(a.w.occurrenceId)).toBe('correction_required');
    expect((await historyOf(a.w.occurrenceId)).at(-1)).toEqual(['completed', 'correction_required', AT, null, a.manager.id]);
    expect(seen).toEqual([{ tenantId: a.w.s.tenantId, executionId: a.executionId, occurrenceId: a.w.occurrenceId, round: 1, actorUserId: a.manager.id }]);
    expect((await auditLogOf(a.executionId)).map((l) => [l.action, l.after])).toEqual([['execution.sent_back', { round: 1, items: items(a), dueAt: DUE }]]);
  });

  it('sends back an audit-pending run and remembers that status', async () => {
    const a = await world({ requiresAudit: true });
    await ownerQuery("update occurrences set status = 'audit_pending' where id = $1", [a.w.occurrenceId]);
    expect((await sendBack(a.manager.api, a.executionId, { items: items(a) })).status).toBe(200);
    expect((await reworkRows(a.executionId))[0]!.status_before).toBe('audit_pending');
  });

  it('refuses a second send-back, corrections while sent back, unknown items and a past due date', async () => {
    const a = await world();
    const unknown = await sendBack(a.manager.api, a.executionId, { items: [{ itemId: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f', comment: 'x' }] });
    expect([unknown.status, unknown.body.error.fields]).toEqual([400, { 'items.0.itemId': 'executions.issues.unknownItem' }]);
    const past = await sendBack(a.manager.api, a.executionId, { items: items(a), dueAt: '2026-11-02T04:00:00.000Z' });
    expect([past.status, past.body.error.fields]).toEqual([400, { dueAt: 'corrections.issues.dueInPast' }]);
    expect((await sendBack(a.manager.api, a.executionId, { items: items(a) })).status).toBe(200);
    expect((await sendBack(a.manager.api, a.executionId, { items: items(a) })).body.error.code).toBe('EXECUTION_NOT_CORRECTABLE');
    const c = await correct(a.manager.api, a.executionId, { answersRev: 1, changes: [{ itemId: a.w.c.temp.id, answer: { number: 5 } }], reason: 'x' });
    expect(c.body.error.code).toBe('EXECUTION_NOT_CORRECTABLE');
    expect(await reworkRows(a.executionId)).toHaveLength(1);
  });

  it('withdraws: completed again, the status before, the request closed and an audit entry', async () => {
    const a = await world();
    await sendBack(a.manager.api, a.executionId, { items: items(a) });
    clock.set('2026-11-02T05:30:00Z');
    const res = await withdraw(a.manager.api, a.executionId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ round: 1, withdrawnAt: '2026-11-02T05:30:00.000Z', withdrawnBy: { id: a.manager.id, fullName: 'Menecer' }, resubmittedAt: null });
    expect((await executionRow(a.executionId)).state).toBe('completed');
    expect(await statusOf(a.w.occurrenceId)).toBe('completed');
    expect((await historyOf(a.w.occurrenceId)).at(-1)).toEqual(['correction_required', 'completed', '2026-11-02T05:30:00.000Z', null, a.manager.id]);
    expect((await auditLogOf(a.executionId)).map((l) => l.action)).toEqual(['execution.sent_back', 'execution.send_back_withdrawn']);
    // The run can be corrected directly again (the withdrawal bumped answers_rev to 2, ruling R7).
    expect((await correct(a.manager.api, a.executionId, { answersRev: 2, changes: [{ itemId: a.w.c.temp.id, answer: { number: 5 } }], reason: 'x' })).status).toBe(200);
  });

  it('R7: withdrawing restores answers_before over the worker\'s rework answers, bumps answers_rev, recalculates and writes no corrections', async () => {
    const a = await world();
    await sendBack(a.manager.api, a.executionId, { items: items(a) });
    // The worker saved rework answers in between (the rework save path is Task 11): temp back in range, its problem cleared.
    const rework = { ...a.answers, [a.w.c.temp.id]: { number: 5 } };
    await ownerQuery("update executions set answers = $2, answers_rev = 2, score = $3, progress = progress where id = $1", [
      a.executionId,
      JSON.stringify(rework),
      JSON.stringify({ earned: 2, possible: 2, percent: 100, problems: [] }),
    ]);
    await ownerQuery('update execution_problems set cleared_at = now() where execution_id = $1 and item_id = $2', [a.executionId, a.w.c.temp.id]);
    const before = (await executionRow(a.executionId)).score!.percent;
    expect(before).toBe(100);
    clock.set('2026-11-02T05:30:00Z');
    const res = await withdraw(a.manager.api, a.executionId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await executionRow(a.executionId);
    expect(row).toMatchObject({ state: 'completed', answers: a.answers, answers_rev: 3 });
    expect(row.score!.percent).toBe(50);
    const active = (await problemRows(a.executionId)).filter((p) => p.cleared_at === null);
    expect(active.map((p) => p.item_id)).toEqual([a.w.c.temp.id]);
    expect(await correctionRows(a.executionId)).toEqual([]);
    const log = (await auditLogOf(a.executionId)).at(-1)!;
    expect(log.action).toBe('execution.send_back_withdrawn');
    expect(log.before).toMatchObject({ round: 1, answers: { [a.w.c.temp.id]: { number: 5 } } });
    expect(log.after).toMatchObject({ status: 'completed', answers: { [a.w.c.temp.id]: { number: 10, note: 'isti' } } });
  });

  it('R7: withdrawing with no rework answers saved still bumps answers_rev and keeps the answers', async () => {
    const a = await world();
    await sendBack(a.manager.api, a.executionId, { items: items(a) });
    expect((await withdraw(a.manager.api, a.executionId)).status).toBe(200);
    expect(await executionRow(a.executionId)).toMatchObject({ answers: a.answers, answers_rev: 2 });
    expect(await correctionRows(a.executionId)).toEqual([]);
    expect((await auditLogOf(a.executionId)).at(-1)!.after).toEqual({ status: 'completed' });
  });

  it('returns a withdrawn audit-pending run to completed when its audit was cancelled and the checklist does not require audit', async () => {
    const a = await world();
    await ownerQuery("update occurrences set status = 'audit_pending' where id = $1", [a.w.occurrenceId]);
    await sendBack(a.manager.api, a.executionId, { items: items(a) });
    await ownerQuery(
      `insert into audits (id, tenant_id, execution_id, occurrence_id, status, auditor_user_id, started_at, cancelled_at, cancel_reason)
       values ($1, $2, $3, $4, 'cancelled', $5, now(), now(), 'Səhv başladı')`,
      [uuidv7(), a.w.s.tenantId, a.executionId, a.w.occurrenceId, a.auditor.id],
    );
    expect((await withdraw(a.manager.api, a.executionId)).status).toBe(200);
    expect(await statusOf(a.w.occurrenceId)).toBe('completed');
  });

  it('refuses to withdraw when nothing is open, and keeps scope and permission', async () => {
    const a = await world();
    expect((await withdraw(a.manager.api, a.executionId)).body.error.code).toBe('EXECUTION_NOT_CORRECTABLE');
    expect((await sendBack(a.outsider.api, a.executionId, { items: items(a) })).status).toBe(404);
    expect((await sendBack(a.auditor.api, a.executionId, { items: items(a) })).status).toBe(403);
    await sendBack(a.manager.api, a.executionId, { items: items(a) });
    expect((await withdraw(a.outsider.api, a.executionId)).status).toBe(404);
    expect((await withdraw(a.worker.api, a.executionId)).status).toBe(403);
  });
});
