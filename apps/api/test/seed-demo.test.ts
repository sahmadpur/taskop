import { describe, expect, inject, it } from 'vitest';
import { seed } from '../src/db/scripts/seed';
import { ownerQuery } from './owner-db';

describe('demo seed', () => {
  it('seeds one partial demo execution with a rule and a manual problem, once', async () => {
    await seed(inject('db').ownerUrl);
    await seed(inject('db').ownerUrl);
    const r = await ownerQuery<{ state: string; status: string; sources: string[]; pinned: boolean; history: string[] }>(
      `select x.state, o.status, o.checklist_version_id = x.checklist_version_id as pinned,
              array(select p.source::text from execution_problems p where p.execution_id = x.id order by p.source::text) as sources,
              array(select h.to_status::text from occurrence_status_history h where h.occurrence_id = o.id order by h.id) as history
         from executions x
         join occurrences o on o.id = x.occurrence_id
         join tenants t on t.id = x.tenant_id
        where t.org_code = 'demo'`,
    );
    expect(r.rows).toEqual([{ state: 'partial', status: 'partial', sources: ['manual', 'rule'], pinned: true, history: ['pending', 'started', 'in_progress', 'partial'] }]);
  }, 60_000);

  it('seeds a team and two demo tasks, one from the run’s manual problem, once', async () => {
    await seed(inject('db').ownerUrl);
    await seed(inject('db').ownerUrl);
    const r = await ownerQuery<{ title: string; status: string; assignee: string | null; team: string | null; from_problem: boolean; requires_review: boolean; history: number }>(
      `select k.title, k.status, u.username as assignee, tm.name as team, k.problem_id is not null as from_problem, k.requires_review,
              (select count(*)::int from task_status_history h where h.task_id = k.id) as history
         from tasks k
         join tenants t on t.id = k.tenant_id
         left join users u on u.id = k.assignee_user_id
         left join teams tm on tm.id = k.assignee_team_id
        where t.org_code = 'demo'
        order by k.title`,
    );
    expect(r.rows).toEqual([
      { title: 'Soyuducunun qapısını təmir edin', status: 'new', assignee: 'elvin', team: null, from_problem: false, requires_review: false, history: 1 },
      { title: 'Zibil qutusunun qapağını dəyişin', status: 'new', assignee: null, team: 'Texniki xidmət', from_problem: true, requires_review: true, history: 1 },
    ]);
    const members = await ownerQuery<{ username: string }>(
      `select u.username from user_teams ut join users u on u.id = ut.user_id join teams tm on tm.id = ut.team_id
        join tenants t on t.id = tm.tenant_id where t.org_code = 'demo' and tm.name = 'Texniki xidmət' order by u.username`,
    );
    expect(members.rows.map((m) => m.username)).toEqual(['elvin', 'nigar']);
  }, 60_000);
});
