import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { answersBody, claimOk, executionWorld, occurrenceOn, publishNextVersion, registerPhoto } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginWorker } from './fixtures';
import { ownerQuery } from './owner-db';
import { type Api, MONDAY_0800 } from './scheduling-fixtures';

const pull = (api: Api, known: string[] = []) => api.get(`/api/v1/me/sync${known.length ? `?knownVersionIds=${known.join(',')}` : ''}`);
const versionOf = async (id: string) => (await ownerQuery<{ v: string | null }>('select checklist_version_id as v from occurrences where id = $1', [id])).rows[0]!.v;

describe('download sync (GET /me/sync)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('returns the caller’s occurrences in the window with pinned versions, and each version once', async () => {
    const w = await executionWorld(t);
    const [w0] = w.workers;
    const res = await pull(w0.api);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.serverTime).toBe('2026-11-02T04:00:00.000Z');
    expect(res.body.occurrences.map((o: { localDate: string }) => o.localDate)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
    expect(res.body.occurrences[0]).toEqual({
      id: w.occurrenceId,
      checklistId: w.checklistId,
      checklistName: 'İcra yoxlaması',
      siteId: w.siteId,
      siteName: 'Filial 1',
      shiftName: null,
      localDate: '2026-11-02',
      startsAt: '2026-11-02T04:00:00.000Z',
      dueAt: '2026-11-02T06:00:00.000Z',
      closesAt: '2026-11-02T07:00:00.000Z',
      status: 'pending',
      checklistVersionId: w.versionId,
      claim: null,
    });
    expect(res.body.checklistVersions).toHaveLength(1);
    expect(res.body.checklistVersions[0]).toMatchObject({ id: w.versionId, checklistId: w.checklistId, number: 1, schemaVersion: 1 });
    expect(res.body.checklistVersions[0].content.sections[0].items).toHaveLength(4);
    expect(res.body.executions).toEqual([]);
    expect((await pull(w0.api, [w.versionId])).body.checklistVersions).toEqual([]);
    expect(await versionOf(await occurrenceOn(w.assignmentId, '2026-11-05'))).toBeNull();
  });

  it('keeps a pinned version while newer occurrences get the newer one', async () => {
    const w = await executionWorld(t);
    const [w0] = w.workers;
    await pull(w0.api);
    const next = structuredClone(w.c.content);
    next.sections[0]!.title = 'Zal (yeni)';
    const v2 = await publishNextVersion(w.owner, w.checklistId, next);
    clock.set('2026-11-03T04:00:00Z');
    const res = await pull(w0.api, [w.versionId]);
    const byDate = Object.fromEntries(res.body.occurrences.map((o: { localDate: string; checklistVersionId: string }) => [o.localDate, o.checklistVersionId]));
    expect(byDate).toEqual({ '2026-11-02': w.versionId, '2026-11-03': w.versionId, '2026-11-04': w.versionId, '2026-11-05': v2 });
    expect(res.body.checklistVersions.map((v: { id: string }) => v.id)).toEqual([v2]);
  });

  it('shows who holds the claim, and the caller’s own executions with answers and pending uploads', async () => {
    const w = await executionWorld(t);
    const [w0, w1] = w.workers;
    clock.set('2026-11-02T04:20:00Z');
    const executionId = await claimOk(w0.api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    await registerPhoto(w0.api, executionId, w.c.photo.id);
    await w0.api.put(`/api/v1/executions/${executionId}/answers`, answersBody(1, { [w.c.temp.id]: { number: 5 } }, '2026-11-02T04:15:00.000Z'));
    const theirs = (await pull(w1.api)).body;
    expect(theirs.occurrences[0]).toMatchObject({ id: w.occurrenceId, status: 'in_progress', claim: { executionId, executorUserId: w0.id, executorName: 'İşçi 1' } });
    expect(theirs.executions).toEqual([]);
    expect((await pull(w0.api)).body.executions).toEqual([
      {
        id: executionId,
        occurrenceId: w.occurrenceId,
        checklistVersionId: w.versionId,
        state: 'active',
        rejectedReason: null,
        startedAt: '2026-11-02T04:10:00.000Z',
        completedAt: null,
        answers: { [w.c.temp.id]: { number: 5 } },
        answersRev: 1,
        progress: { answered: 1, total: 4, requiredMissing: 2 },
        late: false,
        clockSuspect: false,
        mediaPending: 1,
      },
    ]);
  });

  it('keeps an active execution in sync after the worker leaves the snapshot', async () => {
    const w = await executionWorld(t);
    const [w0] = w.workers;
    clock.set('2026-11-02T04:20:00Z');
    const executionId = await claimOk(w0.api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    await ownerQuery('delete from occurrence_assignees where user_id = $1', [w0.id]);
    clock.set('2026-11-08T04:00:00Z');
    const res = (await pull(w0.api)).body;
    expect(res.occurrences.map((o: { id: string }) => o.id)).toEqual([w.occurrenceId]);
    expect(res.executions.map((x: { id: string }) => x.id)).toEqual([executionId]);
  });

  it('drops finished executions after 24 hours and gives an outsider nothing', async () => {
    const w = await executionWorld(t);
    const api = w.workers[0].api;
    clock.set('2026-11-02T04:20:00Z');
    const executionId = await claimOk(api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    const photo = await registerPhoto(api, executionId, w.c.photo.id);
    const answers = { [w.c.problem.id]: { optionIds: [w.c.no.id] }, [w.c.temp.id]: { number: 5 }, [w.c.photo.id]: { photos: [photo] } };
    await api.post(`/api/v1/executions/${executionId}/complete`, { rev: 1, answers, completedAt: '2026-11-02T04:20:00.000Z', deviceTime: '2026-11-02T04:20:00.000Z', clientOffsetMs: 0 });
    clock.set('2026-11-03T04:19:00Z');
    expect((await pull(api)).body.executions.map((x: { state: string }) => x.state)).toEqual(['completed']);
    clock.set('2026-11-03T04:21:00Z');
    expect((await pull(api)).body.executions).toEqual([]);
    const outsider = await createUserDirect(t, w.s.tenantId, { fullName: 'Kənar' });
    const outsiderApi = as(t, (await loginWorker(t, w.s.orgCode, outsider.username!, outsider.secret)).accessToken);
    expect((await pull(outsiderApi)).body).toMatchObject({ occurrences: [], checklistVersions: [], executions: [] });
  });

  it('sends the version of every returned execution, also when its occurrence is no longer listed', async () => {
    const w = await executionWorld(t);
    const api = w.workers[0].api;
    clock.set('2026-11-02T04:20:00Z');
    const executionId = await claimOk(api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    const photo = await registerPhoto(api, executionId, w.c.photo.id);
    const answers = { [w.c.problem.id]: { optionIds: [w.c.no.id] }, [w.c.temp.id]: { number: 5 }, [w.c.photo.id]: { photos: [photo] } };
    await api.post(`/api/v1/executions/${executionId}/complete`, { rev: 1, answers, completedAt: '2026-11-02T04:20:00.000Z', deviceTime: '2026-11-02T04:20:00.000Z', clientOffsetMs: 0 });
    await ownerQuery('delete from occurrence_assignees where user_id = $1', [w.workers[0].id]);
    const res = (await pull(api)).body;
    expect(res.occurrences).toEqual([]);
    expect(res.executions.map((x: { id: string }) => x.id)).toEqual([executionId]);
    expect(res.checklistVersions.map((v: { id: string }) => v.id)).toEqual([w.versionId]);
    expect((await pull(api, [w.versionId])).body.checklistVersions).toEqual([]);
  });
});
