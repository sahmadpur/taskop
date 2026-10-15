import type { Answers } from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DbService } from '../src/db/db.service';
import { executions, occurrences } from '../src/db/schema';
import { ExecutionLookups } from '../src/executions/execution-lookups';
import { ExecutionRecalculator } from '../src/executions/recalculation';
import { createTestApp, type TestApp } from './app';
import { problemRows } from './audit-fixtures';
import { executionRow } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { eventRows } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';
import { closedRunWithProblems, insertTaskRow } from './task-fixtures';

const NOW = '2026-11-02T06:00:00.000Z';

describe('recalculation after close (SP8 spec §6.3)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  /** A manual correction row for one item, as CorrectionsService writes it (Task 7). */
  const correctionFor = async (tenantId: string, executionId: string, actor: string, itemId: string): Promise<string> =>
    (
      await ownerQuery<{ id: string }>(
        `insert into execution_corrections (id, tenant_id, execution_id, item_id, kind, round, reason, actor_user_id, at)
         values ($1, $2, $3, $4, 'manual', 0, 'Səhv', $5, now()) returning id`,
        [uuidv7(), tenantId, executionId, itemId, actor],
      )
    ).rows[0]!.id;

  /** Stores `answers` and recalculates in one tenant transaction, as the correction endpoint does. */
  const recalc = (tenantId: string, userId: string, executionId: string, answers: Answers, clearedBy = new Map<string, string>()) =>
    t.app.get(DbService).withTenant(tenantId, userId, async (tx) => {
      const [e] = await tx.select().from(executions).where(eq(executions.id, executionId));
      const [o] = await tx.select().from(occurrences).where(eq(occurrences.id, e!.occurrenceId));
      const content = await t.app.get(ExecutionLookups).content(e!.checklistVersionId);
      await tx.update(executions).set({ answers }).where(eq(executions.id, executionId));
      return t.app.get(ExecutionRecalculator).recalculate({ execution: e!, occurrence: o!, content, answers, clearedBy, now: new Date(NOW) });
    });

  it('clears a problem with a task instead of deleting it, and updates the score', async () => {
    const { w, executionId, ruleProblemId, manualProblemId } = await closedRunWithProblems(t, clock);
    const taskId = await insertTaskRow({ tenantId: w.s.tenantId, createdBy: w.s.ownerId, assigneeUserId: w.workers[1].id, problemId: ruleProblemId });
    const answers = (await executionRow(executionId)).answers;
    expect((await executionRow(executionId)).score?.percent).toBe(50);
    // 5 °C is inside 2–8: the rule problem goes; the manual problem rides along unchanged.
    const corrected: Answers = { ...answers, [w.c.temp.id]: { ...answers[w.c.temp.id], number: 5 } };
    const correctionId = await correctionFor(w.s.tenantId, executionId, w.s.ownerId, w.c.temp.id);

    const result = await recalc(w.s.tenantId, w.s.ownerId, executionId, corrected, new Map([[w.c.temp.id, correctionId]]));

    expect(result.score).toMatchObject({ earned: 2, possible: 2, percent: 100, problems: [] });
    expect((await executionRow(executionId)).score).toMatchObject({ percent: 100, problems: [] });
    const rows = await problemRows(executionId);
    expect(rows).toHaveLength(2);
    const rule = rows.find((r) => r.id === ruleProblemId)!;
    expect(rule.cleared_by_correction_id).toBe(correctionId);
    expect(rule.cleared_at?.toISOString()).toBe(NOW);
    expect(rows.find((r) => r.id === manualProblemId)!.cleared_at).toBeNull();
    expect((await ownerQuery<{ problem_id: string }>('select problem_id from tasks where id = $1', [taskId])).rows[0]!.problem_id).toBe(ruleProblemId);
  });

  it('inserts a problem the new answers derive beside the cleared row of the same item, and notifies it', async () => {
    const { w, executionId, ruleProblemId } = await closedRunWithProblems(t, clock);
    const answers = (await executionRow(executionId)).answers;
    await recalc(w.s.tenantId, w.s.ownerId, executionId, { ...answers, [w.c.temp.id]: { ...answers[w.c.temp.id], number: 5 } });
    await recalc(w.s.tenantId, w.s.ownerId, executionId, { ...answers, [w.c.temp.id]: { ...answers[w.c.temp.id], number: 12 } });
    const rule = (await problemRows(executionId)).filter((r) => r.source === 'rule');
    expect(rule.map((r) => [r.id === ruleProblemId, r.cleared_at === null])).toEqual([
      [true, false],
      [false, true],
    ]);
    // A rule problem with no correction of its item (clearedBy without it) is cleared with a null link.
    expect(rule[0]!.cleared_by_correction_id).toBeNull();
    const recorded = await eventRows(w.s.tenantId, 'problem.recorded');
    expect(recorded.map((e) => e.payload.problemId)).toContain(rule[1]!.id);
  });

  it('updates the severity and note of a problem the answers still derive, keeping its id', async () => {
    const { w, executionId, ruleProblemId } = await closedRunWithProblems(t, clock);
    const answers = (await executionRow(executionId)).answers;
    await recalc(w.s.tenantId, w.s.ownerId, executionId, { ...answers, [w.c.temp.id]: { ...answers[w.c.temp.id], number: 12, note: 'çox isti' } });
    const rule = (await problemRows(executionId)).filter((r) => r.source === 'rule');
    expect(rule.map((r) => [r.id, r.note, r.cleared_at])).toEqual([[ruleProblemId, 'çox isti', null]]);
  });

  it('leaves manual problems untouched when the answers keep the problem field as it was (a manager correction)', async () => {
    const { w, executionId, manualProblemId } = await closedRunWithProblems(t, clock);
    const answers = (await executionRow(executionId)).answers;
    const before = (await problemRows(executionId)).find((r) => r.id === manualProblemId)!;
    await recalc(w.s.tenantId, w.s.ownerId, executionId, { ...answers, [w.c.temp.id]: { ...answers[w.c.temp.id], number: 5 } });
    const manual = (await problemRows(executionId)).find((r) => r.id === manualProblemId)!;
    expect(manual).toMatchObject({ source: 'manual', severity: 'critical', note: 'Kondisioner xarabdır', cleared_at: null, cleared_by_correction_id: null });
    expect(manual.id).toBe(before.id);
  });

  it('clears a manual problem the answers no longer carry, pointing at the correction of its item (R8)', async () => {
    const { w, executionId, manualProblemId } = await closedRunWithProblems(t, clock);
    const answers = (await executionRow(executionId)).answers;
    const { problem: _dropped, ...temp } = answers[w.c.temp.id]!;
    const correctionId = await correctionFor(w.s.tenantId, executionId, w.s.ownerId, w.c.temp.id);
    await recalc(w.s.tenantId, w.s.ownerId, executionId, { ...answers, [w.c.temp.id]: temp }, new Map([[w.c.temp.id, correctionId]]));
    const rows = await problemRows(executionId);
    const manual = rows.find((r) => r.id === manualProblemId)!;
    expect(manual.cleared_at?.toISOString()).toBe(NOW);
    expect(manual.cleared_by_correction_id).toBe(correctionId);
    expect(rows.filter((r) => r.source === 'manual' && r.cleared_at === null)).toEqual([]);
  });

  it('clears a manual problem with a null link when the caller passes no correction for the item (R8)', async () => {
    const { w, executionId, manualProblemId } = await closedRunWithProblems(t, clock);
    const answers = (await executionRow(executionId)).answers;
    const { problem: _dropped, ...temp } = answers[w.c.temp.id]!;
    await recalc(w.s.tenantId, w.s.ownerId, executionId, { ...answers, [w.c.temp.id]: temp });
    const manual = (await problemRows(executionId)).find((r) => r.id === manualProblemId)!;
    expect(manual.cleared_at?.toISOString()).toBe(NOW);
    expect(manual.cleared_by_correction_id).toBeNull();
  });

  it('inserts a manual problem newly present in the answers and notifies it (R8)', async () => {
    const { w, executionId } = await closedRunWithProblems(t, clock);
    const answers = (await executionRow(executionId)).answers;
    const added = { severity: 'normal' as const, note: 'Yeni qeyd', mediaIds: [] };
    await recalc(w.s.tenantId, w.s.ownerId, executionId, { ...answers, [w.c.photo.id]: { ...answers[w.c.photo.id], problem: added } });
    const manual = (await problemRows(executionId)).filter((r) => r.source === 'manual' && r.item_id === w.c.photo.id);
    expect(manual).toHaveLength(1);
    expect(manual[0]).toMatchObject({ severity: 'normal', note: 'Yeni qeyd', cleared_at: null });
    const recorded = await eventRows(w.s.tenantId, 'problem.recorded');
    expect(recorded.map((e) => e.payload.problemId)).toContain(manual[0]!.id);
  });

  it('updates the severity and note of a manual problem in place, keeping its id (R8)', async () => {
    const { w, executionId, manualProblemId } = await closedRunWithProblems(t, clock);
    const answers = (await executionRow(executionId)).answers;
    const changed = { severity: 'normal' as const, note: 'Düzəldildi qismən', mediaIds: [] };
    await recalc(w.s.tenantId, w.s.ownerId, executionId, { ...answers, [w.c.temp.id]: { ...answers[w.c.temp.id], problem: changed } });
    const manual = (await problemRows(executionId)).filter((r) => r.source === 'manual');
    expect(manual.map((r) => [r.id, r.severity, r.note, r.cleared_at])).toEqual([[manualProblemId, 'normal', 'Düzəldildi qismən', null]]);
  });
});
