import { NOTIFICATION_TYPES } from '@taskop/contracts';
import { ME, OCC, OCC2, OCC3, occurrence, OTHER, pushData, reworkSync, syncResponse, syncTask, TASK, TASK2, versionOf } from '@/offline/testing/fixtures';
import { createTestServices } from '@/offline/testing/test-services';
import { createRouteContext, HOME, INBOX, type RouteContext, routeForPush, routeForTarget, startTapRouting, TEAM_RUN_TYPES } from './notification-router';
import { fakeEvents } from './testing/fakes';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** OCC started on this phone, OCC2 not started, TASK mine; the server answers every pull with the same. */
async function world(o: { manager?: boolean; serverAlsoHas?: 'OCC3' } = {}) {
  const t = await createTestServices({ online: true });
  const seeded = syncResponse({
    occurrences: [occurrence(), occurrence({ id: OCC2, checklistName: 'Kassa yoxlaması' })],
    checklistVersions: [versionOf(t.c.content)],
    tasks: [syncTask()],
  });
  await t.seed(seeded);
  t.api.sync = seeded; // the claim's own sync must not drop OCC2
  await t.services.store.start(OCC, ME);
  await t.services.engine.idle();
  if (o.serverAlsoHas) t.api.sync = { ...seeded, occurrences: [...seeded.occurrences, occurrence({ id: OCC3, checklistName: 'Anbar yoxlaması' })] };
  const ctx = createRouteContext(t.services, () => o.manager ?? false);
  const pulls = () => t.api.calls.filter((c) => c.method === 'pull').length;
  return { t, ctx, pulls };
}

const stubCtx = (over: Partial<RouteContext> = {}): RouteContext => ({
  userId: ME,
  canManageTasks: () => false,
  sync: jest.fn(async () => undefined),
  occurrenceOnPhone: jest.fn(async () => 'execution' as const),
  taskOnPhone: jest.fn(async () => true),
  nonce: () => 'nonce-1',
  ...over,
});

describe('where a notification leads (spec §7.3)', () => {
  it('opens a started checklist by its occurrence id, after syncing first', async () => {
    const { ctx, pulls } = await world();
    const before = pulls();
    expect(await routeForPush(pushData({ targetId: OCC }), ctx)).toEqual({ pathname: '/execution/[id]', params: { id: OCC } });
    expect(pulls()).toBe(before + 1);
  });

  it('sends a not-yet-started checklist to Home, where its Başla is', async () => {
    const { ctx } = await world();
    expect(await routeForPush(pushData({ targetId: OCC2 }), ctx)).toEqual(HOME);
  });

  it('finds an occurrence that only the sync brings', async () => {
    const { ctx } = await world({ serverAlsoHas: 'OCC3' });
    expect(await routeForPush(pushData({ targetId: OCC3 }), ctx)).toEqual(HOME);
  });

  it('opens the inbox for an occurrence this phone does not hold (a manager’s problem notice)', async () => {
    const { ctx } = await world();
    expect(await routeForPush(pushData({ type: 'problem.critical', targetId: OCC3 }), ctx)).toEqual(INBOX);
  });

  it('opens a task on the phone', async () => {
    const { ctx } = await world();
    expect(await routeForPush(pushData({ type: 'task.assigned', targetKind: 'task', targetId: TASK, targetDate: null }), ctx)).toEqual({
      pathname: '/task/[id]',
      params: { id: TASK },
    });
  });

  it('opens the review screen for a task not on the phone when the user manages tasks, and the inbox otherwise', async () => {
    const manager = await world({ manager: true });
    const route = await routeForPush(pushData({ type: 'task.submitted', targetKind: 'task', targetId: TASK2, targetDate: null }), manager.ctx);
    expect(route).toMatchObject({ pathname: '/review/[id]', params: { id: TASK2 } });
    const worker = await world();
    expect(await routeForPush(pushData({ type: 'task.completed', targetKind: 'task', targetId: TASK2, targetDate: null }), worker.ctx)).toEqual(INBOX);
  });

  it('keeps a message without a target in the inbox, without syncing', async () => {
    const { ctx, pulls } = await world();
    const before = pulls();
    expect(await routeForPush(pushData({ type: 'manual', targetKind: 'none', targetId: null, targetDate: null }), ctx)).toEqual(INBOX);
    expect(pulls()).toBe(before);
  });

  it('a push for another user opens the inbox without syncing; unreadable data too', async () => {
    const { ctx, pulls } = await world();
    const before = pulls();
    expect(await routeForPush(pushData({ userId: OTHER }), ctx)).toEqual(INBOX);
    expect(await routeForPush({ note: 'Expo push tool' }, ctx)).toEqual(INBOX);
    expect(pulls()).toBe(before);
  });

  it('stops waiting for the sync after 5 s', async () => {
    jest.useFakeTimers();
    try {
      const ctx = stubCtx({ sync: () => new Promise(() => undefined) });
      let route: unknown = null;
      void routeForTarget({ targetKind: 'occurrence', targetId: OCC }, ctx).then((r) => (route = r));
      await jest.advanceTimersByTimeAsync(4_999);
      expect(route).toBeNull();
      await jest.advanceTimersByTimeAsync(1);
      expect(route).toEqual({ pathname: '/execution/[id]', params: { id: OCC } });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('startTapRouting', () => {
  it('handles the launching tap once, even when the listener delivers it too, and clears it', async () => {
    const launch = { identifier: 'launch-1', data: pushData() };
    const events = fakeEvents(launch);
    const navigate = jest.fn();
    const stop = startTapRouting({ events, ctx: stubCtx(), navigate });
    events.tap(launch);
    await flush();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith({ pathname: '/execution/[id]', params: { id: OCC } });
    expect(events.cleared).toBe(1);
    expect(events.last).toBeNull();
    stop();
  });

  it('routes later taps, and none after it stopped', async () => {
    const events = fakeEvents();
    const navigate = jest.fn();
    const stop = startTapRouting({ events, ctx: stubCtx(), navigate });
    events.tap({ identifier: 'n1', data: pushData({ type: 'task.assigned', targetKind: 'task', targetId: TASK, targetDate: null }) });
    await flush();
    expect(navigate).toHaveBeenCalledWith({ pathname: '/task/[id]', params: { id: TASK } });
    stop();
    events.tap({ identifier: 'n2', data: pushData() });
    await flush();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('syncs when a notification for the signed-in user arrives in the foreground, and not for another user', async () => {
    const events = fakeEvents();
    const ctx = stubCtx();
    const stop = startTapRouting({ events, ctx, navigate: jest.fn() });
    events.receive(pushData());
    events.receive(pushData({ userId: OTHER }));
    await flush();
    expect(ctx.sync).toHaveBeenCalledTimes(1);
    stop();
  });

  it('opens the inbox when the local store cannot be read', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const events = fakeEvents();
    const navigate = jest.fn();
    const stop = startTapRouting({ events, ctx: stubCtx({ occurrenceOnPhone: async () => Promise.reject(new Error('db')) }), navigate });
    events.tap({ identifier: 'n1', data: pushData() });
    await flush();
    expect(navigate).toHaveBeenCalledWith(INBOX);
    expect(error).toHaveBeenCalled();
    stop();
    error.mockRestore();
  });
});

describe('sub-project 8 run notifications (Spec decision 15)', () => {
  const notOnPhone = { occurrenceOnPhone: jest.fn(async () => null) };

  it('opens a run sent back to me on the execution screen once the tap’s sync brought it', async () => {
    const t = await createTestServices({ online: true });
    t.api.sync = reworkSync(t.c, [{ itemId: t.c.temp.id, comment: 'Temperaturu yenidən ölçün' }]);
    const ctx = createRouteContext(t.services, () => false, () => false);
    expect(await routeForPush(pushData({ type: 'run.correction_required', targetId: OCC }), ctx)).toEqual({ pathname: '/execution/[id]', params: { id: OCC } });
  });

  it('opens an audit result on a run the worker still holds on the execution screen', async () => {
    expect(await routeForPush(pushData({ type: 'audit.finished', targetId: OCC }), stubCtx({ canSeeTeam: () => true }))).toEqual({
      pathname: '/execution/[id]',
      params: { id: OCC },
    });
  });

  it('opens the run on the Team tab for a viewer who does not hold it', async () => {
    const ctx = stubCtx({ ...notOnPhone, canSeeTeam: () => true });
    for (const type of ['run.resubmitted', 'audit.finished', 'run.correction_required'] as const) {
      expect(await routeForPush(pushData({ type, targetId: OCC3 }), ctx)).toEqual({ pathname: '/team/run/[id]', params: { id: OCC3 } });
    }
    // An inbox row carries its type too.
    expect(await routeForTarget({ targetKind: 'occurrence', targetId: OCC3, type: 'run.resubmitted' }, ctx)).toEqual({ pathname: '/team/run/[id]', params: { id: OCC3 } });
  });

  it('keeps other run notifications, and viewers without the Team tab, in the inbox', async () => {
    expect(await routeForTarget({ targetKind: 'occurrence', targetId: OCC3, type: 'problem.critical' }, stubCtx({ ...notOnPhone, canSeeTeam: () => true }))).toEqual(INBOX);
    expect(await routeForPush(pushData({ type: 'audit.finished', targetId: OCC3 }), stubCtx(notOnPhone))).toEqual(INBOX);
    expect(await routeForPush(pushData({ type: 'audit.finished', targetId: OCC3 }), stubCtx({ ...notOnPhone, canSeeTeam: () => false }))).toEqual(INBOX);
  });

  it('names only notification types that exist', () => {
    expect([...TEAM_RUN_TYPES]).toHaveLength(3);
    for (const type of TEAM_RUN_TYPES) expect(NOTIFICATION_TYPES).toContain(type);
  });
});
