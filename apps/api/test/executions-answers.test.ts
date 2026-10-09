import { type Answers, newItem } from '@taskop/contracts';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { answersBody, claimBody, claimOk, executionRow, executionWorld, historyOf, publishNextVersion, registerPhoto, statusOf } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { type Api, MONDAY_0800 } from './scheduling-fixtures';

const problemsOf = async (executionId: string) =>
  (
    await ownerQuery<{ item_id: string; source: string; severity: string; note: string | null; media_ids: string[] }>(
      'select item_id, source, severity, note, media_ids::text[] as media_ids from execution_problems where execution_id = $1 order by item_id, source',
      [executionId],
    )
  ).rows;

describe('answers (PUT /executions/:id/answers)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  async function started() {
    const w = await executionWorld(t);
    clock.set('2026-11-02T04:20:00Z');
    const executionId = await claimOk(w.workers[0].api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    return { w, executionId, api: w.workers[0].api };
  }
  const put = (api: Api, id: string, body: object) => api.put(`/api/v1/executions/${id}/answers`, body);

  it('stores answers, moves the occurrence to in_progress once and rewrites the problems', async () => {
    const { w, executionId, api } = await started();
    const { c } = w;
    const m1 = await registerPhoto(api, executionId, c.problem.id);
    const rev1 = await put(api, executionId, answersBody(1, { [c.problem.id]: { optionIds: [c.yes.id], photos: [m1] }, [c.comment.id]: { text: 'Su axır' } }, '2026-11-02T04:15:00.000Z'));
    expect(rev1.status, JSON.stringify(rev1.body)).toBe(200);
    expect(rev1.body).toEqual({ executionId, rev: 1, stale: false, state: 'active', progress: { answered: 2, total: 5, requiredMissing: 2 } });
    expect(await problemsOf(executionId)).toEqual([{ item_id: c.problem.id, source: 'rule', severity: 'critical', note: null, media_ids: [m1] }]);

    const rev2Answers: Answers = { [c.problem.id]: { optionIds: [c.no.id] }, [c.temp.id]: { number: 5, problem: { severity: 'normal', note: 'Termometr köhnədir', mediaIds: [] } } };
    const rev2 = await put(api, executionId, answersBody(2, rev2Answers, '2026-11-02T04:18:00.000Z'));
    expect(rev2.body).toMatchObject({ rev: 2, stale: false, progress: { answered: 2, total: 4, requiredMissing: 1 } });
    expect(await problemsOf(executionId)).toEqual([{ item_id: c.temp.id, source: 'manual', severity: 'normal', note: 'Termometr köhnədir', media_ids: [] }]);
    expect((await historyOf(w.occurrenceId)).slice(-2)).toEqual([
      ['pending', 'started', '2026-11-02T04:10:00.000Z', null, w.workers[0].id],
      ['started', 'in_progress', '2026-11-02T04:15:00.000Z', null, w.workers[0].id],
    ]);
    const row = await executionRow(executionId);
    expect(row.answers).toEqual(rev2Answers);
    expect(row.score).toMatchObject({ problems: [] });
  });

  it('keeps a problem’s id and creation time while it persists', async () => {
    const { w, executionId, api } = await started();
    const manual = (note: string): Answers => ({ [w.c.temp.id]: { number: 5, problem: { severity: 'critical', note, mediaIds: [] } } });
    await put(api, executionId, answersBody(1, manual('Birinci'), '2026-11-02T04:15:00.000Z'));
    const before = (await ownerQuery<{ id: string; created_at: Date }>('select id, created_at from execution_problems where execution_id = $1', [executionId])).rows;
    clock.set('2026-11-02T04:25:00Z');
    await put(api, executionId, answersBody(2, manual('İkinci'), '2026-11-02T04:24:00.000Z'));
    const after = (await ownerQuery<{ id: string; created_at: Date; note: string }>('select id, created_at, note from execution_problems where execution_id = $1', [executionId])).rows;
    expect(after).toEqual([{ ...before[0], note: 'İkinci' }]);
  });

  it('ignores a stale revision', async () => {
    const { w, executionId, api } = await started();
    await put(api, executionId, answersBody(2, { [w.c.temp.id]: { number: 4 } }, '2026-11-02T04:15:00.000Z'));
    const stale = await put(api, executionId, answersBody(1, { [w.c.temp.id]: { number: 9 } }, '2026-11-02T04:14:00.000Z'));
    expect(stale.status).toBe(200);
    expect(stale.body).toMatchObject({ rev: 2, stale: true, state: 'active' });
    expect((await executionRow(executionId)).answers).toEqual({ [w.c.temp.id]: { number: 4 } });
  });

  it('validates against the pinned version, not the newest one', async () => {
    const { w, executionId, api } = await started();
    const next = structuredClone(w.c.content);
    const added = newItem('text');
    added.label = 'Yeni sual';
    next.sections[0]!.items.push(added);
    await publishNextVersion(w.owner, w.checklistId, next);
    const codes = async (answers: Answers) => {
      const res = await put(api, executionId, answersBody(1, answers, '2026-11-02T04:15:00.000Z'));
      expect([res.status, res.body.error.code]).toEqual([400, 'VALIDATION_FAILED']);
      return res.body.error.issues.map((i: { code: string }) => i.code);
    };
    expect(await codes({ [added.id]: { text: 'x' } })).toEqual(['executions.issues.unknownItem']);
    expect(await codes({ [w.c.problem.id]: { optionIds: [w.c.temp.id] } })).toEqual(['executions.issues.unknownOption']);
    expect(await codes({ [w.c.temp.id]: { text: '5' } })).toEqual(['executions.issues.invalidValue']);
    expect(await codes({ [w.c.photo.id]: { photos: [uuidv7()] } })).toEqual(['executions.issues.unknownMedia']);
    expect((await executionRow(executionId)).answers_rev).toBe(0);
  });

  it('stores the answers of a rejected execution without counting them', async () => {
    const { w } = await started();
    const w1 = w.workers[1];
    const lost = claimBody(w.occurrenceId, '2026-11-02T04:12:00.000Z');
    await w1.api.post('/api/v1/executions', lost);
    const res = await put(w1.api, lost.id, answersBody(1, { [w.c.problem.id]: { optionIds: [w.c.yes.id] } }, '2026-11-02T04:16:00.000Z'));
    expect(res.body).toMatchObject({ rev: 1, stale: false, state: 'rejected', progress: { answered: 0, total: 4, requiredMissing: 3 } });
    expect((await executionRow(lost.id)).answers).toEqual({ [w.c.problem.id]: { optionIds: [w.c.yes.id] } });
    expect(await problemsOf(lost.id)).toEqual([]);
    expect(await statusOf(w.occurrenceId)).toBe('started');
  });

  it('lets only the executor save, and refuses more than 1 MB of answers', async () => {
    const { w, executionId, api } = await started();
    const other = await put(w.workers[1].api, executionId, answersBody(1, {}, '2026-11-02T04:15:00.000Z'));
    expect([other.status, other.body.error.code]).toEqual([403, 'NOT_EXECUTOR']);
    const big = Object.fromEntries(Array.from({ length: 520 }, () => [crypto.randomUUID(), { note: 'x'.repeat(2000) }]));
    const tooBig = await put(api, executionId, answersBody(1, big, '2026-11-02T04:15:00.000Z'));
    expect([tooBig.status, tooBig.body.error.fields]).toEqual([400, { answers: 'executions.issues.answersTooLarge' }]);
    expect((await put(api, '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f', answersBody(1, {}, '2026-11-02T04:15:00.000Z'))).status).toBe(404);
  });

  it('lets a swept partial execution take answers captured inside the window, and nothing after it', async () => {
    const { w, executionId, api } = await started();
    await ownerQuery("update executions set state = 'partial' where id = $1", [executionId]);
    clock.set('2026-11-02T07:30:00Z');
    const late = await put(api, executionId, answersBody(1, { [w.c.temp.id]: { number: 5 } }, '2026-11-02T06:50:00.000Z'));
    expect(late.body).toMatchObject({ rev: 1, stale: false, state: 'partial' });
    expect((await executionRow(executionId)).answers).toEqual({ [w.c.temp.id]: { number: 5 } });
    const after = await put(api, executionId, answersBody(2, { [w.c.temp.id]: { number: 6 } }, '2026-11-02T07:10:00.000Z'));
    expect([after.status, after.body.error.code]).toEqual([409, 'EXECUTION_NOT_ACTIVE']);
  });
});
