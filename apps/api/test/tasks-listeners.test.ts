import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { MONDAY_0800 } from './scheduling-fixtures';
import { act, captureTaskEvents, createTask, newTaskBody, taskHistory, taskRow, taskWorld } from './task-fixtures';

const T = (hhmm: string) => `2026-11-02T${hhmm}:00.000Z`;

describe('deactivated assignees', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('returns a deactivated member’s open team tasks to the team and flags their direct tasks; nothing is deleted', async () => {
    const w = await taskWorld(t);
    const [w1, w2] = w.workers;
    const team = await createTask(w.manager.api, newTaskBody({ teamId: w.teamId }));
    const closed = await createTask(w.manager.api, newTaskBody({ teamId: w.teamId }));
    const direct = await createTask(w.manager.api, newTaskBody({ userId: w1.id }));
    clock.set(T('04:20'));
    await act(w1.api, team.id, 'start', T('04:10'));
    await act(w1.api, closed.id, 'start', T('04:10'));
    expect((await w1.api.post(`/api/v1/tasks/${closed.id}/submissions`, { id: uuidv7(), submittedAt: T('04:15') })).body.status).toBe('completed');
    await act(w1.api, direct.id, 'accept', T('04:10'));
    const events = captureTaskEvents(t);
    expect((await w.owner.post(`/api/v1/users/${w1.id}/deactivate`)).status).toBe(200);
    events.stop();
    expect(await taskRow(team.id)).toMatchObject({ status: 'new', assignee_user_id: null, assignee_team_id: w.teamId, accepted_at: null, started_at: null });
    expect((await taskHistory(team.id)).at(-1)).toEqual(['in_progress', 'new', null, 'assignee_deactivated']);
    expect(events.seen).toEqual([['task.assigned', team.id, null]]);
    expect((await w2.api.get(`/api/v1/tasks/${team.id}`)).status).toBe(200);
    expect(await taskRow(closed.id)).toMatchObject({ status: 'completed', assignee_user_id: w1.id });
    expect((await w.manager.api.get(`/api/v1/tasks/${direct.id}`)).body).toMatchObject({ status: 'accepted', assignee: { id: w1.id }, assigneeInactive: true });
    expect((await w.owner.post(`/api/v1/users/${w1.id}/reactivate`)).status).toBe(200);
    expect((await w.manager.api.get(`/api/v1/tasks/${direct.id}`)).body.assigneeInactive).toBe(false);
    expect(await taskRow(team.id)).toMatchObject({ status: 'new', assignee_user_id: null });
  });
});
