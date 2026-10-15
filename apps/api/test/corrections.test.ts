import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { type AuditWorld, auditLogOf, auditWorld, correct, correctionRows, problemRows } from './audit-fixtures';
import { executionRow, historyOf, statusOf } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { staffAt } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';
import { closedRunWithProblems } from './task-fixtures';

const AT = '2026-11-02T05:00:00.000Z';

describe('direct corrections (POST /executions/:id/corrections, spec §6.2)', () => {
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
  const tempTo = (a: AuditWorld, number: number) => ({ answersRev: 1, changes: [{ itemId: a.w.c.temp.id, answer: { number } }], reason: 'Termometr səhv oxunub' });

  it('corrects a value: one correction row, the snapshot, the new score and rev, a cleared problem and an audit entry', async () => {
    const a = await world();
    const before = await executionRow(a.executionId);
    const res = await correct(a.manager.api, a.executionId, tempTo(a, 5));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      executionId: a.executionId,
      answersRev: 2,
      changedItemIds: [a.w.c.temp.id],
      score: { earned: 2, possible: 2, percent: 100, problems: [] },
    });
    const rows = await correctionRows(a.executionId);
    expect(rows).toEqual([
      expect.objectContaining({
        item_id: a.w.c.temp.id, kind: 'manual', round: 0, before: { number: 10, note: 'isti' }, after: { number: 5 },
        reason: 'Termometr səhv oxunub', actor_user_id: a.manager.id, actor_platform_admin_id: null, at: new Date(AT),
      }),
    ]);
    const after = await ownerQuery<{ answers: unknown; answers_rev: number; original_answers: unknown; original_score: { percent: number }; original_captured_at: Date; completed_at: Date; late: boolean }>(
      'select answers, answers_rev, original_answers, original_score, original_captured_at, completed_at, late from executions where id = $1',
      [a.executionId],
    );
    expect(after.rows[0]).toMatchObject({
      answers_rev: 2,
      original_answers: a.answers,
      original_score: { percent: 50 },
      original_captured_at: new Date(AT),
      completed_at: before.completed_at,
      late: before.late,
    });
    expect((await problemRows(a.executionId)).map((p) => [p.item_id, p.cleared_by_correction_id])).toEqual([[a.w.c.temp.id, rows[0]!.id]]);
    expect(await statusOf(a.w.occurrenceId)).toBe('completed');
    expect(await auditLogOf(a.executionId)).toEqual([
      {
        action: 'execution.corrected', entity_type: 'execution', actor_user_id: a.manager.id, actor_platform_admin_id: null,
        before: { answers: { [a.w.c.temp.id]: { number: 10, note: 'isti' } } },
        after: { answers: { [a.w.c.temp.id]: { number: 5 } }, reason: 'Termometr səhv oxunub' },
      },
    ]);
    // Direct corrections never change the status (spec §3.1).
    expect((await historyOf(a.w.occurrenceId)).at(-1)![1]).toBe('completed');
  });

  it('writes one row per changed item in checklist order, whatever order the request lists them in', async () => {
    const a = await world({ problemYes: true });
    const { comment, temp, note } = a.w.c;
    const res = await correct(a.manager.api, a.executionId, {
      answersRev: 1,
      changes: [
        { itemId: note.id, answer: { text: 'Əlavə' } },
        { itemId: temp.id, answer: { number: 5 } },
        { itemId: comment.id, answer: { text: 'Su axmır' } },
      ],
      reason: 'Yenidən yoxlandı',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.changedItemIds).toEqual([comment.id, temp.id, note.id]);
    expect((await correctionRows(a.executionId)).map((c) => c.item_id)).toEqual([comment.id, temp.id, note.id]);
    expect((await problemRows(a.executionId)).find((p) => p.item_id === temp.id)!.cleared_by_correction_id).toBe((await correctionRows(a.executionId))[1]!.id);
  });

  it('keeps the original from the first correction only', async () => {
    const a = await world();
    expect((await correct(a.manager.api, a.executionId, tempTo(a, 5))).status).toBe(200);
    clock.set('2026-11-02T05:30:00Z');
    const second = await correct(a.manager.api, a.executionId, { ...tempTo(a, 6), answersRev: 2 });
    expect(second.body.answersRev).toBe(3);
    const r = await ownerQuery<{ original_answers: unknown; original_captured_at: Date }>('select original_answers, original_captured_at from executions where id = $1', [a.executionId]);
    expect(r.rows[0]).toEqual({ original_answers: a.answers, original_captured_at: new Date(AT) });
    expect((await correctionRows(a.executionId)).map((c) => [c.before, c.after])).toEqual([
      [{ number: 10, note: 'isti' }, { number: 5 }],
      [{ number: 5 }, { number: 6 }],
    ]);
  });

  it('answers 200 and writes nothing when no item changed', async () => {
    const a = await world();
    const res = await correct(a.manager.api, a.executionId, { answersRev: 1, changes: [{ itemId: a.w.c.temp.id, answer: { note: 'isti', number: 10 } }], reason: 'Yoxladım' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ answersRev: 1, changedItemIds: [] });
    expect(await correctionRows(a.executionId)).toEqual([]);
    expect(await auditLogOf(a.executionId)).toEqual([]);
    expect((await executionRow(a.executionId)).answers_rev).toBe(1);
  });

  it('refuses a stale answersRev without writing anything', async () => {
    const a = await world();
    // Two managers press save at the same moment, both based on rev 1.
    const results = await Promise.all([correct(a.manager.api, a.executionId, tempTo(a, 5)), correct(a.manager.api, a.executionId, tempTo(a, 6))]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('ANSWERS_CONFLICT');
    expect(await correctionRows(a.executionId)).toHaveLength(1);
    expect((await auditLogOf(a.executionId)).map((l) => l.action)).toEqual(['execution.corrected']);
    expect((await executionRow(a.executionId)).answers_rev).toBe(2);
  });

  it('refuses a correction that leaves a revealed required item unanswered', async () => {
    const a = await world();
    // "Bəli" reveals the required follow-up comment and asks for a photo on the item.
    const res = await correct(a.manager.api, a.executionId, { answersRev: 1, changes: [{ itemId: a.w.c.problem.id, answer: { optionIds: [a.w.c.yes.id] } }], reason: 'Problem var idi' });
    expect([res.status, res.body.error.code]).toEqual([422, 'REQUIREMENTS_UNMET']);
    expect(res.body.error.missing).toEqual([
      { itemId: a.w.c.problem.id, kind: 'photo' },
      { itemId: a.w.c.comment.id, kind: 'answer' },
    ]);
    expect(await correctionRows(a.executionId)).toEqual([]);
    expect((await executionRow(a.executionId)).answers).toEqual(a.answers);
  });

  it('keeps the item’s manual problem and lets a manager unlink evidence but never add it', async () => {
    const { w, executionId, manualProblemId } = await closedRunWithProblems(t, clock);
    const manager = await staffAt(t, w.s.tenantId, w.owner, 'manager', [w.siteId], 'Menecer');
    const res = await correct(manager.api, executionId, { answersRev: 1, changes: [{ itemId: w.c.temp.id, answer: { number: 5, note: 'normal' } }], reason: 'Səhv' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await executionRow(executionId)).answers[w.c.temp.id]).toEqual({ number: 5, note: 'normal', problem: { severity: 'critical', note: 'Kondisioner xarabdır', mediaIds: [] } });
    expect((await problemRows(executionId)).find((p) => p.id === manualProblemId)!.cleared_at).toBeNull();
    const added = await correct(manager.api, executionId, {
      answersRev: 2,
      changes: [{ itemId: w.c.photo.id, answer: { photos: ['0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f'] } }],
      reason: 'Başqa foto',
    });
    expect([added.status, added.body.error.code, added.body.error.fields]).toEqual([422, 'MEDIA_NOT_CORRECTABLE', { 'changes.0.answer.photos': 'errors.MEDIA_NOT_CORRECTABLE' }]);
  });

  it('refuses unknown items and invalid values', async () => {
    const a = await world();
    const unknown = await correct(a.manager.api, a.executionId, { answersRev: 1, changes: [{ itemId: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f', answer: { number: 1 } }], reason: 'x' });
    expect([unknown.status, unknown.body.error.fields]).toEqual([400, { 'changes.0.itemId': 'executions.issues.unknownItem' }]);
    const outOfRange = await correct(a.manager.api, a.executionId, tempTo(a, 99));
    expect([outOfRange.status, outOfRange.body.error.code]).toEqual([400, 'VALIDATION_FAILED']);
    expect(outOfRange.body.error.issues).toEqual([{ path: ['answers', a.w.c.temp.id, 'number'], code: 'executions.issues.invalidValue' }]);
    const dup = await correct(a.manager.api, a.executionId, { answersRev: 1, changes: [{ itemId: a.w.c.temp.id, answer: null }, { itemId: a.w.c.temp.id, answer: null }], reason: 'x' });
    expect(dup.body.error.fields).toEqual({ 'changes.1.itemId': 'corrections.issues.duplicateItem' });
  });

  it('refuses audited, partial and missed runs with the right code', async () => {
    const audited = await world();
    await ownerQuery("update occurrences set status = 'audited' where id = $1", [audited.w.occurrenceId]);
    expect((await correct(audited.manager.api, audited.executionId, tempTo(audited, 5))).body.error.code).toBe('EXECUTION_LOCKED');
    const partial = await world();
    await ownerQuery("update occurrences set status = 'partial' where id = $1", [partial.w.occurrenceId]);
    await ownerQuery("update executions set state = 'partial' where id = $1", [partial.executionId]);
    expect((await correct(partial.manager.api, partial.executionId, tempTo(partial, 5))).body.error.code).toBe('EXECUTION_NOT_CORRECTABLE');
  });

  it('is 404 out of scope or for a lost claim, and 403 without executions.correct', async () => {
    const a = await world();
    expect((await correct(a.outsider.api, a.executionId, tempTo(a, 5))).status).toBe(404);
    expect((await correct(a.auditor.api, a.executionId, tempTo(a, 5))).status).toBe(403);
    expect((await correct(a.worker.api, a.executionId, tempTo(a, 5))).status).toBe(403);
    await ownerQuery("update executions set state = 'rejected', rejected_reason = 'ALREADY_CLAIMED' where id = $1", [a.executionId]);
    expect((await correct(a.manager.api, a.executionId, tempTo(a, 5))).status).toBe(404);
  });
});
