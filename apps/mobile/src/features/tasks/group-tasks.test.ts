import type { SyncTask, TaskStatus } from '@taskop/contracts';
import type { TaskView } from '@/offline/task-store';
import { syncTask, T, TASK, TASK2, TASK3, TASK4, TASK5, TEAM } from '@/offline/testing/fixtures';
import { groupTasks, taskCounts } from './group-tasks';

const NOW = Date.parse(T.open);
const team = { id: TEAM, name: 'Texniki xidmət' };
const view = (over: Partial<SyncTask>, status?: TaskStatus): TaskView => {
  const server = syncTask(over);
  return {
    id: server.id, server, status: status ?? server.status, rev: server.rev, syncNote: null, receivedAt: T.open, updatedAt: T.open,
    draft: null, unsynced: false, failedKey: null,
  };
};
const ids = (xs: TaskView[]) => xs.map((x) => x.id);

describe('groupTasks', () => {
  it('puts team offers, my open tasks (overdue first, then by due date) and counts the Home card', () => {
    const g = groupTasks(
      [
        view({ id: TASK, dueAt: '2026-11-04T10:00:00.000Z' }),
        view({ id: TASK2, dueAt: null }),
        view({ id: TASK3, dueAt: '2026-11-03T10:00:00.000Z' }),
        view({ id: TASK4, dueAt: T.before }), // past due by the phone's clock, before the sweep flagged it
        view({ id: TASK5, assignee: null, team }),
      ],
      NOW,
    );
    expect(ids(g.team)).toEqual([TASK5]);
    expect(ids(g.mine)).toEqual([TASK4, TASK3, TASK, TASK2]);
    expect(g.inReview).toEqual([]);
    expect(g.done).toEqual([]);
    expect(taskCounts(g, NOW)).toEqual({ open: 4, overdue: 1 });
  });

  it('moves a team task accepted on this phone to Mənim, and sorts tasks in review and closed ones', () => {
    const g = groupTasks(
      [
        view({ id: TASK, assignee: null, team }, 'accepted'),
        view({ id: TASK2, status: 'awaiting_review' }),
        view({ id: TASK3, status: 'completed', updatedAt: '2026-11-01T10:00:00.000Z', overdueAt: '2026-10-31T10:00:00.000Z' }),
        view({ id: TASK4, status: 'cancelled', updatedAt: '2026-11-02T03:00:00.000Z' }),
        view({ id: TASK5 }, 'awaiting_review'), // submitted on this phone, not yet synced
      ],
      NOW,
    );
    expect(ids(g.team)).toEqual([]);
    expect(ids(g.mine)).toEqual([TASK]);
    expect(ids(g.inReview)).toEqual([TASK2, TASK5]);
    expect(ids(g.done)).toEqual([TASK4, TASK3]);
    expect(taskCounts(g, NOW)).toEqual({ open: 1, overdue: 0 });
  });
});
