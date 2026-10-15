import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { type AuditWorld, auditWorld, correct, resubmit, sendBack } from './audit-fixtures';
import { answersBody } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginStaff, uniq } from './fixtures';
import { ownerQuery } from './owner-db';
import { type Api, MONDAY_0800 } from './scheduling-fixtures';

const AT = '2026-11-02T05:00:00.000Z';
const LATER = '2026-11-02T12:00:00.000Z';

describe('reading corrections (spec §6.2, NFR-07.05)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  const world = async (): Promise<AuditWorld> => {
    const a = await auditWorld(t, clock);
    clock.set(AT);
    return a;
  };
  const history = (api: Api, a: AuditWorld) => api.get(`/api/v1/executions/${a.executionId}/corrections`);
  const tempTo = (a: AuditWorld, rev: number, number: number) => ({ answersRev: rev, changes: [{ itemId: a.w.c.temp.id, answer: { number } }], reason: 'Termometr səhv oxunub' });

  it('returns the original, the corrections oldest first, the rework rounds and the diff in checklist order', async () => {
    const a = await world();
    expect((await history(a.manager.api, a)).body).toEqual({ original: null, corrections: [], reworkRequests: [], diff: [] });
    expect((await correct(a.manager.api, a.executionId, tempTo(a, 1, 5))).status).toBe(200);
    clock.set('2026-11-02T05:10:00Z');
    await sendBack(a.manager.api, a.executionId, { items: [{ itemId: a.w.c.temp.id, comment: 'Yenidən ölçün' }] });
    clock.set(LATER);
    await a.worker.api.put(`/api/v1/executions/${a.executionId}/answers`, answersBody(3, { ...a.answers, [a.w.c.temp.id]: { number: 6 } }, LATER));
    expect((await resubmit(a.worker.api, a.executionId, LATER)).status).toBe(200);

    const res = await history(a.manager.api, a);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.original).toEqual({ answers: a.answers, score: { earned: 1, possible: 2, percent: 50, problems: [{ itemId: a.w.c.temp.id, severity: 'normal' }] }, capturedAt: AT });
    expect(res.body.corrections).toEqual([
      { id: expect.any(String), itemId: a.w.c.temp.id, kind: 'manual', round: 0, before: { number: 10, note: 'isti' }, after: { number: 5 }, reason: 'Termometr səhv oxunub', actor: { kind: 'user', name: 'Menecer' }, at: AT },
      { id: expect.any(String), itemId: a.w.c.temp.id, kind: 'rework', round: 1, before: { number: 5 }, after: { number: 6 }, reason: 'Yenidən ölçün', actor: { kind: 'user', name: 'İşçi 1' }, at: LATER },
    ]);
    expect(res.body.reworkRequests).toEqual([expect.objectContaining({ round: 1, resubmittedAt: LATER, withdrawnAt: null })]);
    expect(res.body.diff).toEqual([{ itemId: a.w.c.temp.id, original: { number: 10, note: 'isti' }, current: { number: 6 } }]);
  });

  it('lists the diff in checklist order and the rework rounds in round order', async () => {
    const a = await world();
    const { temp, note } = a.w.c;
    // Corrected in reverse checklist order, so neither the diff nor the history can fall back on chronology by accident.
    const fix = await correct(a.manager.api, a.executionId, {
      answersRev: 1,
      changes: [
        { itemId: note.id, answer: { text: 'Düzəliş' } },
        { itemId: temp.id, answer: { number: 5 } },
      ],
      reason: 'Səhv daxil edilib',
    });
    expect(fix.status, JSON.stringify(fix.body)).toBe(200);
    const rework = async (itemId: string, answer: object, round: number) => {
      const rev = (await a.manager.api.get(`/api/v1/executions/${a.executionId}`)).body.answersRev as number;
      expect((await sendBack(a.manager.api, a.executionId, { items: [{ itemId, comment: `Dəyişin ${round}` }] })).status).toBe(200);
      const current = (await a.manager.api.get(`/api/v1/executions/${a.executionId}`)).body.answers;
      clock.set(`2026-11-02T1${round}:00:00Z`);
      const put = await a.worker.api.put(`/api/v1/executions/${a.executionId}/answers`, answersBody(rev + 1, { ...current, [itemId]: answer }, `2026-11-02T1${round}:00:00Z`));
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      const done = await resubmit(a.worker.api, a.executionId, `2026-11-02T1${round}:00:00Z`, round);
      expect(done.status, JSON.stringify(done.body)).toBe(200);
    };
    await rework(note.id, { text: 'Yeni qeyd' }, 1);
    await rework(temp.id, { number: 6 }, 2);

    const res = await history(a.manager.api, a);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.reworkRequests.map((r: { round: number }) => r.round)).toEqual([1, 2]);
    expect(res.body.diff).toEqual([
      { itemId: temp.id, original: { number: 10, note: 'isti' }, current: { number: 6 } },
      { itemId: note.id, original: null, current: { text: 'Yeni qeyd' } },
    ]);
  });

  describe('ExecutionDetail.audit', () => {
    const insertAudit = (a: AuditWorld, status: 'in_progress' | 'finished' | 'cancelled', startedAt: string) => {
      const id = uuidv7();
      return ownerQuery(
        `insert into audits (id, tenant_id, execution_id, occurrence_id, status, auditor_user_id, started_at, finished_at, result, audit_score, cancelled_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          id,
          a.w.s.tenantId,
          a.executionId,
          a.w.occurrenceId,
          status,
          a.auditor.id,
          startedAt,
          status === 'finished' ? startedAt : null,
          status === 'finished' ? 'passed' : null,
          status === 'finished' ? JSON.stringify({ approved: 2, rejected: 0, reviewed: 2, percent: 100 }) : null,
          status === 'cancelled' ? startedAt : null,
        ],
      ).then(() => id);
    };
    const audit = async (a: AuditWorld) => (await a.manager.api.get(`/api/v1/executions/${a.executionId}`)).body.audit;

    it('prefers the non-cancelled audit over a newer cancelled one', async () => {
      const a = await world();
      await insertAudit(a, 'cancelled', '2026-11-02T04:50:00Z');
      const open = await insertAudit(a, 'finished', '2026-11-02T04:30:00Z');
      expect(await audit(a)).toEqual({ id: open, status: 'finished', result: 'passed', percent: 100, paused: false });
    });

    it('returns the in-progress audit rather than a cancelled one, not paused while the run is not sent back', async () => {
      const a = await world();
      await insertAudit(a, 'cancelled', '2026-11-02T04:50:00Z');
      const open = await insertAudit(a, 'in_progress', '2026-11-02T04:30:00Z');
      expect(await audit(a)).toEqual({ id: open, status: 'in_progress', result: null, percent: null, paused: false });
    });

    it('falls back to the latest cancelled audit when there is no other', async () => {
      const a = await world();
      await insertAudit(a, 'cancelled', '2026-11-02T04:30:00Z');
      const latest = await insertAudit(a, 'cancelled', '2026-11-02T04:50:00Z');
      expect(await audit(a)).toEqual({ id: latest, status: 'cancelled', result: null, percent: null, paused: false });
    });
  });

  it('fills the run detail: rework, the snapshot flag, the audit brief and cleared problems', async () => {
    const a = await world();
    const detail = async () => (await a.manager.api.get(`/api/v1/executions/${a.executionId}`)).body;
    expect(await detail()).toMatchObject({ reworkRound: 0, rework: null, corrected: false, audit: null, problems: [{ itemId: a.w.c.temp.id, clearedAt: null }] });
    await correct(a.manager.api, a.executionId, tempTo(a, 1, 5));
    expect(await detail()).toMatchObject({ corrected: true, problems: [{ itemId: a.w.c.temp.id, clearedAt: AT }] });
    const occurrence = (await a.manager.api.get(`/api/v1/occurrences/${a.w.occurrenceId}`)).body;
    expect(occurrence.execution.problemCount).toBe(0);
    const auditId = uuidv7();
    await ownerQuery("update occurrences set status = 'audit_pending' where id = $1", [a.w.occurrenceId]);
    await ownerQuery(
      "insert into audits (id, tenant_id, execution_id, occurrence_id, status, auditor_user_id, started_at) values ($1, $2, $3, $4, 'in_progress', $5, now())",
      [auditId, a.w.s.tenantId, a.executionId, a.w.occurrenceId, a.auditor.id],
    );
    await sendBack(a.manager.api, a.executionId, { items: [{ itemId: a.w.c.photo.id, comment: 'Foto bulanıqdır' }] });
    expect(await detail()).toMatchObject({
      state: 'rework',
      reworkRound: 1,
      rework: { round: 1, items: [{ itemId: a.w.c.photo.id, comment: 'Foto bulanıqdır' }] },
      audit: { id: auditId, status: 'in_progress', result: null, percent: null, paused: true },
    });
  });

  it('lets the executor and every in-scope reader with one of the four keys read the history', async () => {
    const a = await world();
    const roleUser = async (permissions: string[]) => {
      const role = await a.w.owner.post('/api/v1/roles', { name: uniq('Rol'), dataScope: 'all', permissions });
      expect(role.status, JSON.stringify(role.body)).toBe(201);
      const u = await createUserDirect(t, a.w.s.tenantId, { kind: 'staff', roleId: role.body.id, emailVerified: true });
      return as(t, (await loginStaff(t, u.email!, u.secret, 'web')).accessToken);
    };
    expect((await history(a.worker.api, a)).status).toBe(200);
    expect((await history(a.manager.api, a)).status).toBe(200);
    expect((await history(a.auditor.api, a)).status).toBe(200);
    expect((await history(await roleUser(['executions.correct']), a)).status).toBe(200);
    expect((await history(await roleUser(['audits.perform']), a)).status).toBe(200);
    expect((await (await roleUser(['audits.perform'])).get(`/api/v1/executions/${a.executionId}`)).status).toBe(200);
    expect((await history(await roleUser(['checklists.view']), a)).status).toBe(404);
    expect((await history(a.outsider.api, a)).status).toBe(404);
    expect((await history(a.w.workers[1].api, a)).status).toBe(404);
  });

  it('hides cleared problems from GET /problems unless includeCleared', async () => {
    const a = await world();
    await correct(a.manager.api, a.executionId, tempTo(a, 1, 5));
    const list = (q = '') => a.manager.api.get(`/api/v1/problems?from=2026-11-01&to=2026-11-30${q}`);
    expect((await list()).body.items).toEqual([]);
    const all = (await list('&includeCleared=true')).body.items;
    expect(all.map((p: { itemId: string; clearedAt: string }) => [p.itemId, p.clearedAt])).toEqual([[a.w.c.temp.id, AT]]);
  });
});
