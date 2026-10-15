import { ApiError } from '@taskop/api-client';
import { ExecutionLockedError } from './execution-store';
import { listCommands, outboxCounts } from './outbox';
import { indicatorOf } from './sync-engine';
import { capturedPhoto } from './testing/fake-transport';
import { completedAnswers, myExecution, OCC, occurrence, REWORK_EXECUTION, REWORK_PHOTO, reworkSync, syncResponse, T } from './testing/fixtures';
import { createHarness, type Harness } from './testing/harness';

const methods = (h: Harness) => h.api.calls.map((c) => c.method);
const bodyOf = (h: Harness, method: string) => h.api.calls.find((c) => c.method === method)!.body as Record<string, unknown>;
const execution = async (h: Harness) => (await h.store.execution(REWORK_EXECUTION))!;
const progress = { answered: 3, total: 4, requiredMissing: 0 };
const refuse = (code: string, status = 409) => async (): Promise<never> => {
  throw new ApiError(status, code as never, `errors.${code}`);
};

/** The pull of the first cycle fails, so what a test sees after it is what the push left. */
const failPull = (h: Harness) => h.api.on('pull', refuse('INTERNAL', 503));

/** OCC sent back with Temperatur and the shelf photo flagged; the server keeps listing it until it leaves rework. */
let current: Harness | null = null;
/** A failed assertion can leave a backoff retry scheduled: stop the engine so it cannot keep the run alive. */
afterEach(() => current?.engine.stop());

async function reworking(): Promise<Harness> {
  const h = await createHarness();
  current = h;
  const res = reworkSync(h.c, [{ itemId: h.c.temp.id, comment: 'Temperaturu yenidən ölçün' }, { itemId: h.c.photo.id, comment: 'Şəkil bulanıqdır' }]);
  await h.seed(res);
  h.api.sync = res;
  return h;
}

describe('resubmitting a run sent back for correction (spec §8.1)', () => {
  it('lists what is still missing and queues no resubmit', async () => {
    const h = await reworking();
    await h.store.patchAnswer(REWORK_EXECUTION, h.c.temp.id, { number: 10 }); // outside 2–8: the rule asks for a note
    expect(await h.store.resubmit(REWORK_EXECUTION)).toEqual({ ok: false, missing: [{ itemId: h.c.temp.id, kind: 'note' }] });
    expect((await listCommands(h.db)).map((c) => c.kind)).toEqual(['answers']);
    expect(await execution(h)).toMatchObject({ state: 'rework' });
  });

  it('sends the new photo and the answers before the resubmit, then takes the server’s state and status', async () => {
    const h = await reworking();
    await h.engine.run('manual');
    expect((await execution(h)).finishedSyncedAt).toBeNull(); // a run in rework is never "finished syncing"
    h.api.calls.length = 0;
    const photo = await h.store.attachMedia(REWORK_EXECUTION, capturedPhoto(h.transport), { itemId: h.c.photo.id, field: 'evidence' });
    await h.store.patchAnswer(REWORK_EXECUTION, h.c.temp.id, { number: 6 });
    expect(await h.store.resubmit(REWORK_EXECUTION)).toEqual({ ok: true });
    expect(await execution(h)).toMatchObject({ state: 'completed', completedAt: T.due, rework: { round: 1 } });
    const answers = { ...completedAnswers(h.c), [h.c.temp.id]: { number: 6 }, [h.c.photo.id]: { photos: [REWORK_PHOTO, photo] } };
    h.api.on('resubmit', async (id) => {
      h.api.sync = syncResponse({
        occurrences: [occurrence({ status: 'audit_pending' })],
        executions: [myExecution({ id, state: 'completed', completedAt: T.due, answers, answersRev: 5, reworkRound: 1, rework: null })],
      });
      return { executionId: id, state: 'completed', status: 'audit_pending', progress, score: null };
    });
    failPull(h);
    await h.engine.run('manual');
    expect(methods(h)).toEqual(['registerMedia', 'saveAnswers', 'resubmit', 'pull']);
    // What the push alone left: the state and the occurrence status come from the resubmit's answer.
    expect(await execution(h)).toMatchObject({ state: 'completed', rework: null });
    expect((await h.store.occurrence(OCC))?.status).toBe('audit_pending');
    expect(await outboxCounts(h.db)).toEqual({ pending: 0, failed: 0 });
    h.api.reset('pull');
    await h.engine.run('manual');
    expect(methods(h)).toEqual(['registerMedia', 'saveAnswers', 'resubmit', 'pull', 'pull', 'registerMedia', 'confirmUploaded']);
    // R21: the round being closed is captured when the worker taps Resubmit.
    expect(bodyOf(h, 'resubmit')).toEqual({ round: 1, resubmittedAt: T.open, deviceTime: T.open, clientOffsetMs: 0 });
    expect(await execution(h)).toMatchObject({ state: 'completed', completedAt: T.due, rework: null, reworkRound: 1, answers, syncedRev: 5 });
    expect((await execution(h)).finishedSyncedAt).not.toBeNull();
    expect((await h.store.occurrence(OCC))?.status).toBe('audit_pending');
    expect(await outboxCounts(h.db)).toEqual({ pending: 0, failed: 0 });
  });

  it('queues the round being closed, captured at the tap, with the tap time', async () => {
    const h = await reworking();
    await h.store.resubmit(REWORK_EXECUTION);
    expect((await listCommands(h.db))[0]!.payload).toEqual({ round: 1, resubmittedAt: T.open });
  });

  it('a replay answered with the run completed closes the rework locally, with the status of the body and no stale note', async () => {
    const h = await reworking();
    failPull(h);
    h.api.on('resubmit', refuse('CLOCK_INVALID', 422));
    await h.store.resubmit(REWORK_EXECUTION);
    await h.engine.run('manual');
    const [parked] = await listCommands(h.db);
    await h.engine.discardCommand(parked!.seq);
    expect(await execution(h)).toMatchObject({ state: 'rework', syncNote: 'errors.CLOCK_INVALID' });
    h.api.on('resubmit', async (id) => ({ executionId: id, state: 'completed', status: 'audited', progress: { answered: 0, total: 0, requiredMissing: 0 }, score: null }));
    await h.store.resubmit(REWORK_EXECUTION);
    await h.engine.run('manual');
    // The pull failed again: this is what the push left.
    expect(await execution(h)).toMatchObject({ state: 'completed', rework: null, syncNote: null });
    expect((await h.store.occurrence(OCC))?.status).toBe('audited');
    expect(await outboxCounts(h.db)).toEqual({ pending: 0, failed: 0 });
    h.api.sync = syncResponse({
      occurrences: [occurrence({ status: 'audited' })],
      executions: [myExecution({ id: REWORK_EXECUTION, state: 'completed', completedAt: T.due, answers: completedAnswers(h.c), answersRev: 3, reworkRound: 1, rework: null })],
    });
    h.api.reset('pull');
    await h.engine.run('manual');
    expect(await execution(h)).toMatchObject({ state: 'completed', rework: null, syncNote: null });
    expect((await h.store.occurrence(OCC))?.status).toBe('audited');
  });

  it('a replay answered with a newer round only drops its command and pulls: the run is not finished and nothing is taken from the body', async () => {
    const h = await reworking();
    await h.store.resubmit(REWORK_EXECUTION);
    // Round 1 was resubmitted elsewhere and the manager has sent the run back again: the server answers with the current state.
    h.api.on('resubmit', async (id) => ({ executionId: id, state: 'rework', status: 'correction_required', progress: { answered: 1, total: 9, requiredMissing: 7 }, score: null }));
    failPull(h);
    await h.engine.run('manual');
    // The pull failed: the push alone dropped the command and marked nothing finished.
    expect(methods(h)).toEqual(['resubmit', 'pull']);
    expect(await listCommands(h.db)).toEqual([]);
    expect(await execution(h)).toMatchObject({ state: 'completed', rework: { round: 1 }, reworkRound: 1, finishedSyncedAt: null });
    expect((await h.store.occurrence(OCC))?.status).toBe('correction_required');
    h.api.sync = reworkSync(h.c, [{ itemId: h.c.temp.id, comment: 'Yenə ölçün' }], { request: { round: 2 }, execution: { reworkRound: 2, answersRev: 3 } });
    h.api.reset('pull');
    await h.engine.run('manual');
    expect(methods(h)).toEqual(['resubmit', 'pull', 'pull']);
    expect(await listCommands(h.db)).toEqual([]);
    expect(await execution(h)).toMatchObject({ state: 'rework', reworkRound: 2, rework: { round: 2 }, finishedSyncedAt: null });
    expect((await h.store.occurrence(OCC))?.status).toBe('correction_required');
    expect(await h.store.resubmit(REWORK_EXECUTION)).toEqual({ ok: true });
    expect((await listCommands(h.db))[0]!.payload).toMatchObject({ round: 2 });
  });

  it('a transient failure keeps one resubmit queued and sends the same body again', async () => {
    const h = await reworking();
    h.api.on('resubmit', refuse('INTERNAL', 503));
    await h.store.resubmit(REWORK_EXECUTION);
    await h.engine.run('manual');
    expect(await outboxCounts(h.db)).toEqual({ pending: 1, failed: 0 });
    expect((await listCommands(h.db)).map((c) => c.kind)).toEqual(['resubmit']);
    h.api.reset('resubmit');
    h.api.sync = syncResponse({
      occurrences: [occurrence({ status: 'completed' })],
      executions: [myExecution({ id: REWORK_EXECUTION, state: 'completed', completedAt: T.due, answers: completedAnswers(h.c), answersRev: 3, reworkRound: 1, rework: null })],
    });
    await h.engine.run('manual');
    const bodies = h.api.calls.filter((c) => c.method === 'resubmit').map((c) => c.body);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[0]).toEqual({ round: 1, resubmittedAt: T.open, deviceTime: T.open, clientOffsetMs: 0 });
    expect(await outboxCounts(h.db)).toEqual({ pending: 0, failed: 0 });
    expect(await execution(h)).toMatchObject({ state: 'completed', rework: null });
  });

  it('refuses to resubmit a run in rework that holds no request', async () => {
    const h = await reworking();
    await h.db.run('UPDATE executions SET rework = NULL WHERE id = ?', [REWORK_EXECUTION]);
    await expect(h.store.resubmit(REWORK_EXECUTION)).rejects.toBeInstanceOf(ExecutionLockedError);
    expect(await listCommands(h.db)).toEqual([]);
    expect(await execution(h)).toMatchObject({ state: 'rework' });
  });

  it('queues one resubmit when two taps race', async () => {
    const h = await reworking();
    const [first, second] = await Promise.allSettled([h.store.resubmit(REWORK_EXECUTION), h.store.resubmit(REWORK_EXECUTION)]);
    expect(first).toEqual({ status: 'fulfilled', value: { ok: true } });
    expect(second).toMatchObject({ status: 'rejected', reason: expect.any(ExecutionLockedError) });
    expect((await listCommands(h.db)).filter((c) => c.kind === 'resubmit')).toHaveLength(1);
  });

  it('a resubmit refused for unmet requirements puts the run back into rework, with nothing left in the queue', async () => {
    const h = await reworking();
    h.api.on('resubmit', refuse('REQUIREMENTS_UNMET', 422));
    expect(await h.store.resubmit(REWORK_EXECUTION)).toEqual({ ok: true });
    await h.engine.run('manual');
    expect(await listCommands(h.db)).toEqual([]);
    expect(indicatorOf(h.engine.status())).toBe('synced');
    expect(await execution(h)).toMatchObject({ state: 'rework', rework: { round: 1 }, finishedSyncedAt: null });
    expect(await h.store.resubmit(REWORK_EXECUTION)).toEqual({ ok: true });
  });

  it('a withdrawn send-back drops the queued rework (answers, an unregistered photo, the resubmit); the run shows completed with a note', async () => {
    const h = await reworking();
    h.net.online = false;
    const photo = capturedPhoto(h.transport);
    await h.store.attachMedia(REWORK_EXECUTION, photo, { itemId: h.c.photo.id, field: 'evidence' });
    await h.store.patchAnswer(REWORK_EXECUTION, h.c.temp.id, { number: 6 });
    await h.store.resubmit(REWORK_EXECUTION);
    // Meanwhile the manager withdrew the send-back: rework commands are refused, and the run is completed again.
    h.api.on('registerMedia', refuse('EXECUTION_NOT_ACTIVE'));
    h.api.on('saveAnswers', refuse('EXECUTION_NOT_ACTIVE'));
    h.api.on('resubmit', refuse('EXECUTION_NOT_ACTIVE'));
    h.api.sync = syncResponse({
      occurrences: [occurrence({ status: 'completed' })],
      executions: [myExecution({ id: REWORK_EXECUTION, state: 'completed', completedAt: T.due, answers: completedAnswers(h.c), answersRev: 3, reworkRound: 1, rework: null })],
    });
    h.net.online = true;
    await h.engine.run('reconnect');
    expect(methods(h)).toEqual(['registerMedia', 'pull']);
    expect(await listCommands(h.db)).toEqual([]);
    expect(await h.store.media(REWORK_EXECUTION)).toEqual([]);
    expect(h.transport.removed).toEqual([photo.localUri]);
    expect(await execution(h)).toMatchObject({ state: 'completed', rework: null, answers: completedAnswers(h.c), rev: 3, syncNote: 'errors.EXECUTION_NOT_ACTIVE' });
    expect((await h.store.occurrence(OCC))?.status).toBe('completed');
    expect(indicatorOf(h.engine.status())).toBe('synced');
  });

  it('answers refused as not active while the run is still in rework (not yet resubmitted) drop the rework copy too', async () => {
    const h = await reworking();
    await h.store.patchAnswer(REWORK_EXECUTION, h.c.temp.id, { number: 6 });
    h.api.on('saveAnswers', refuse('EXECUTION_NOT_ACTIVE'));
    h.api.sync = syncResponse({
      occurrences: [occurrence({ status: 'completed' })],
      executions: [myExecution({ id: REWORK_EXECUTION, state: 'completed', completedAt: T.due, answers: completedAnswers(h.c), answersRev: 4, reworkRound: 1, rework: null })],
    });
    await h.engine.run('manual');
    expect(methods(h)).toEqual(['saveAnswers', 'pull']);
    expect(await execution(h)).toMatchObject({ state: 'completed', rework: null, answers: completedAnswers(h.c), syncNote: 'errors.EXECUTION_NOT_ACTIVE' });
    expect((await h.store.occurrence(OCC))?.status).toBe('completed');
  });

  it('"Sil" on a parked resubmit puts the run back into rework with the note', async () => {
    const h = await reworking();
    h.api.on('resubmit', refuse('CLOCK_INVALID', 422));
    await h.store.resubmit(REWORK_EXECUTION);
    await h.engine.run('manual');
    expect(indicatorOf(h.engine.status())).toBe('failed');
    const [parked] = await listCommands(h.db);
    expect(parked).toMatchObject({ kind: 'resubmit', status: 'failed', errorCode: 'CLOCK_INVALID' });
    await h.engine.discardCommand(parked!.seq);
    expect(await listCommands(h.db)).toEqual([]);
    expect(await execution(h)).toMatchObject({ state: 'rework', syncNote: 'errors.CLOCK_INVALID' });
  });
});
