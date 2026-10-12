import { uuidv7 } from 'uuidv7';
import { ownerQuery } from './owner-db';

export interface TaskRowInput {
  tenantId: string;
  createdBy: string;
  assigneeUserId?: string | null;
  assigneeTeamId?: string | null;
  problemId?: string | null;
  status?: string;
  id?: string;
}

/** A task row straight in the DB (owner connection, no API), for tests that only need a task to exist. */
export async function insertTaskRow(v: TaskRowInput): Promise<string> {
  const id = v.id ?? uuidv7();
  await ownerQuery(
    `insert into tasks (id, tenant_id, title, created_by_user_id, assignee_user_id, assignee_team_id, problem_id, status)
     values ($1, $2, 'Test tapşırığı', $3, $4, $5, $6, $7)`,
    [id, v.tenantId, v.createdBy, v.assigneeUserId ?? null, v.assigneeTeamId ?? null, v.problemId ?? null, v.status ?? 'new'],
  );
  return id;
}
