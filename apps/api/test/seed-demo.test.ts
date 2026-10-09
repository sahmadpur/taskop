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
});
