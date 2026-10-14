import type { Page, ReportRun } from '@taskop/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { addChecklist, addRun, addSite, PERIOD, qs, REPORT_NOW, reportBase, type ReportWorld, reportWorld, type RunKey } from './report-fixtures';
import type { Api } from './scheduling-fixtures';

describe('GET /reports/runs', () => {
  const clock = new FakeClock(REPORT_NOW);
  let t: TestApp;
  let w: ReportWorld;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    w = await reportWorld(t);
  });
  afterAll(() => t.close());

  const page = async (api: Api, q: Record<string, string | undefined>): Promise<Page<ReportRun>> => {
    const res = await api.get(`/api/v1/reports/runs?${qs(q)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as Page<ReportRun>;
  };
  const ids = (p: Page<ReportRun>) => p.items.map((r) => r.occurrenceId);
  const runs = (...keys: RunKey[]) => keys.map((k) => w.runs[k].occurrenceId);

  it('lists each bucket, latest due time first (ties: newest id first)', async () => {
    const bucket = async (b?: string) => ids(await page(w.owner, { ...PERIOD, bucket: b }));
    expect(await bucket('overdue')).toEqual(runs('r12'));
    expect(await bucket('partial')).toEqual(runs('r5'));
    expect(await bucket('missed')).toEqual(runs('r10', 'r8', 'r3'));
    expect(await bucket('problems')).toEqual(runs('r9', 'r4', 'r1'));
    expect(await bucket('completed')).toEqual(runs('r15', 'r11', 'r9', 'r7', 'r4', 'r2', 'r1'));
    expect(await bucket('in_progress')).toEqual(runs('r13', 'r16'));
    // `planned` is every run that is not cancelled (r6 is the fixture's only cancelled run).
    expect(await bucket('planned')).toEqual(runs('r15', 'r14', 'r13', 'r16', 'r12', 'r11', 'r10', 'r9', 'r8', 'r7', 'r5', 'r4', 'r3', 'r2', 'r1'));
    // `all` (the default) includes the cancelled r6.
    expect(await bucket()).toEqual(runs('r15', 'r14', 'r13', 'r16', 'r12', 'r11', 'r10', 'r9', 'r8', 'r7', 'r6', 'r5', 'r4', 'r3', 'r2', 'r1'));
  });

  it('returns the run row with its people, both completion times and the flags', async () => {
    const completed = (await page(w.owner, { ...PERIOD, bucket: 'completed' })).items;
    expect(completed.find((r) => r.occurrenceId === w.runs.r7.occurrenceId)).toEqual({
      occurrenceId: w.runs.r7.occurrenceId,
      executionId: w.runs.r7.executionIds[0],
      localDate: '2026-11-02',
      dueAt: '2026-11-02T06:00:00.000Z',
      checklist: { id: w.checklists.opening.id, name: 'Açılış yoxlaması' },
      site: { id: w.sites.zoneA1, name: 'Zona A1' },
      status: 'completed',
      assignees: [{ id: w.aynur.id, fullName: 'Aynur Quliyeva' }],
      executor: { id: w.aynur.id, fullName: 'Aynur Quliyeva' },
      startedAt: '2026-11-02T04:10:00.000Z',
      completedAt: '2026-11-02T07:00:00.000Z',
      completedReceivedAt: '2026-11-04T05:00:00.000Z',
      score: 90,
      problemCount: 0,
      criticalCount: 0,
      late: true,
      clockSuspect: false,
    });
    expect(completed.find((r) => r.occurrenceId === w.runs.r9.occurrenceId)).toMatchObject({ clockSuspect: true, problemCount: 1, criticalCount: 1 });
    expect(completed.find((r) => r.occurrenceId === w.runs.r4.occurrenceId)).toMatchObject({ problemCount: 2, criticalCount: 1 });
    // The lost claim is never the run's execution.
    const r16 = (await page(w.owner, { ...PERIOD, bucket: 'in_progress' })).items.find((r) => r.occurrenceId === w.runs.r16.occurrenceId)!;
    expect([r16.executionId, r16.executor?.fullName, r16.assignees.map((a) => a.fullName)]).toEqual([w.runs.r16.executionIds[0], 'Kamran Əliyev', ['Aynur Quliyeva', 'Kamran Əliyev']]);
    const r8 = (await page(w.owner, { ...PERIOD, bucket: 'missed' })).items.find((r) => r.occurrenceId === w.runs.r8.occurrenceId)!;
    expect(r8).toMatchObject({ executionId: null, executor: null, assignees: [], startedAt: null, completedAt: null, completedReceivedAt: null, score: null, late: false, clockSuspect: false });
  });

  it('filters by employee with the spec §3.3 attribution', async () => {
    expect(ids(await page(w.owner, { ...PERIOD, userId: w.kamran.id }))).toEqual(runs('r13', 'r16', 'r9', 'r5', 'r3', 'r2'));
    expect(ids(await page(w.owner, { ...PERIOD, userId: w.aynur.id, bucket: 'in_progress' }))).toEqual([]);
  });

  it('pages 50 at a time by (due_at, id) without repeating or skipping runs with the same due time', async () => {
    const b = await reportBase(t);
    const site = await addSite(b, 'Filial');
    const checklist = await addChecklist(b, 'Yoxlama');
    const created: string[] = [];
    for (let i = 0; i < 55; i++) {
      created.push((await addRun(b, { date: '2026-11-03', siteId: site, checklist, status: 'missed', dueAt: '2026-11-03T06:00:00Z', assignees: [] })).occurrenceId);
    }
    const first = await page(b.owner, { ...PERIOD, bucket: 'missed' });
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBe(first.items[49]!.occurrenceId);
    const second = await page(b.owner, { ...PERIOD, bucket: 'missed', cursor: first.nextCursor! });
    expect(second.nextCursor).toBeNull();
    expect([...ids(first), ...ids(second)]).toEqual([...created].reverse());
  });

  it('refuses an unknown bucket', async () => {
    expect((await w.owner.get(`/api/v1/reports/runs?${qs({ ...PERIOD, bucket: 'late' })}`)).status).toBe(400);
  });
});
