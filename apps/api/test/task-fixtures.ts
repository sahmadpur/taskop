import type { Answers } from '@taskop/contracts';
import { uuidv7 } from 'uuidv7';
import { expect } from 'vitest';
import type { TestApp } from './app';
import { claimOk, completeExecution, executionWorld, registerPhoto } from './execution-fixtures';
import type { FakeClock } from './fake-clock';
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

/**
 * İşçi 1 completes today's run at 08:20 Baku with two problems on the temperature: a manual critical one
 * ("Kondisioner xarabdır") and the rule one (10 °C, note "isti"). The run is closed, so both can get tasks.
 */
export async function closedRunWithProblems(t: TestApp, clock: FakeClock) {
  const w = await executionWorld(t);
  const api = w.workers[0].api;
  clock.set('2026-11-02T04:20:00Z');
  const executionId = await claimOk(api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
  const photo = await registerPhoto(api, executionId, w.c.photo.id);
  const answers: Answers = {
    [w.c.problem.id]: { optionIds: [w.c.no.id] },
    [w.c.temp.id]: { number: 10, note: 'isti', problem: { severity: 'critical', note: 'Kondisioner xarabdır', mediaIds: [] } },
    [w.c.photo.id]: { photos: [photo] },
  };
  const res = await completeExecution(api, executionId, 1, answers, '2026-11-02T04:20:00.000Z');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const rows = (await ownerQuery<{ id: string; source: string }>('select id, source from execution_problems where execution_id = $1', [executionId])).rows;
  const idOf = (source: string) => rows.find((r) => r.source === source)!.id;
  return { w, executionId, manualProblemId: idOf('manual'), ruleProblemId: idOf('rule') };
}
