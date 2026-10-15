import type { Answers } from '@taskop/contracts';
import { expect } from 'vitest';
import type { TestApp } from './app';
import { claimOk, completeExecution, type ExecutionWorld, executionWorld, registerPhoto, type TestWorker } from './execution-fixtures';
import type { FakeClock } from './fake-clock';
import { staffAt } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import type { Api } from './scheduling-fixtures';

export interface Staff {
  id: string;
  api: Api;
}

export interface AuditWorld {
  w: ExecutionWorld;
  executionId: string;
  /** İşçi 1, the executor. */
  worker: TestWorker;
  /** The photo item's photo (registered, not uploaded; `markUploaded` uploads it). */
  photoId: string;
  /** The problem item's photo with `problemYes`. */
  problemPhotoId: string | null;
  /** What İşçi 1 completed with. */
  answers: Answers;
  /** "Menecer": built-in Manager at Filial 1 (executions.correct, reports.view). */
  manager: Staff;
  /** "Auditor": built-in Auditor, whole tenant (audits.perform, reports.view). */
  auditor: Staff;
  /** "Başqa menecer": built-in Manager at Filial 2 only: the run is out of their scope. */
  outsider: Staff;
}

/**
 * İşçi 1 completes today's run at 08:20 Baku; the clock then reads 08:20. Answers: "Xeyr" on the problem item (with
 * `problemYes`: "Bəli" with a photo and the follow-up comment "Su axır", a critical rule problem), 10 °C with the note
 * "isti" (a normal rule problem), one photo. `requiresAudit` sets the checklist flag before the run completes.
 */
export async function auditWorld(t: TestApp, clock: FakeClock, opts: { requiresAudit?: boolean; problemYes?: boolean } = {}): Promise<AuditWorld> {
  const w = await executionWorld(t);
  if (opts.requiresAudit) await ownerQuery('update checklists set requires_audit = true where id = $1', [w.checklistId]);
  const worker = w.workers[0];
  clock.set('2026-11-02T04:20:00Z');
  const executionId = await claimOk(worker.api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
  const photoId = await registerPhoto(worker.api, executionId, w.c.photo.id);
  const problemPhotoId = opts.problemYes ? await registerPhoto(worker.api, executionId, w.c.problem.id) : null;
  const answers: Answers = {
    [w.c.problem.id]: problemPhotoId ? { optionIds: [w.c.yes.id], photos: [problemPhotoId] } : { optionIds: [w.c.no.id] },
    ...(problemPhotoId ? { [w.c.comment.id]: { text: 'Su axır' } } : {}),
    [w.c.temp.id]: { number: 10, note: 'isti' },
    [w.c.photo.id]: { photos: [photoId] },
  };
  const res = await completeExecution(worker.api, executionId, 1, answers, '2026-11-02T04:20:00.000Z');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const staff = async (roleKey: 'manager' | 'auditor', siteIds: string[], name: string): Promise<Staff> => {
    const s = await staffAt(t, w.s.tenantId, w.owner, roleKey, siteIds, name);
    return { id: s.id, api: s.api };
  };
  return {
    w,
    executionId,
    worker,
    photoId,
    problemPhotoId,
    answers,
    manager: await staff('manager', [w.siteId], 'Menecer'),
    auditor: await staff('auditor', [], 'Auditor'),
    outsider: await staff('manager', [w.otherSiteId], 'Başqa menecer'),
  };
}

export const correct = (api: Api, executionId: string, body: object) => api.post(`/api/v1/executions/${executionId}/corrections`, body);
export const sendBack = (api: Api, executionId: string, body: object) => api.post(`/api/v1/executions/${executionId}/send-back`, body);
export const withdraw = (api: Api, executionId: string) => api.post(`/api/v1/executions/${executionId}/send-back/cancel`);
export const resubmit = (api: Api, executionId: string, at: string) =>
  api.post(`/api/v1/executions/${executionId}/resubmit`, { resubmittedAt: at, deviceTime: at, clientOffsetMs: 0 });
export const startAudit = (api: Api, executionId: string) => api.post(`/api/v1/executions/${executionId}/audits`);

export interface CorrectionDbRow {
  id: string;
  item_id: string;
  kind: string;
  round: number;
  before: unknown;
  after: unknown;
  reason: string;
  actor_user_id: string | null;
  actor_platform_admin_id: string | null;
  at: Date;
}

export const correctionRows = async (executionId: string): Promise<CorrectionDbRow[]> =>
  (await ownerQuery<CorrectionDbRow>('select * from execution_corrections where execution_id = $1 order by at, id', [executionId])).rows;

export interface ReworkDbRow {
  id: string;
  round: number;
  items: { itemId: string; comment: string }[];
  due_at: Date | null;
  requested_by_user_id: string | null;
  answers_before: Answers;
  status_before: string;
  resubmitted_at: Date | null;
  withdrawn_at: Date | null;
  withdrawn_by_user_id: string | null;
}

export const reworkRows = async (executionId: string): Promise<ReworkDbRow[]> =>
  (await ownerQuery<ReworkDbRow>('select * from execution_rework_requests where execution_id = $1 order by round', [executionId])).rows;

export interface AuditLogDbRow {
  action: string;
  entity_type: string;
  actor_user_id: string | null;
  actor_platform_admin_id: string | null;
  before: unknown;
  after: unknown;
}

/** The audit-log rows of one entity, oldest first. */
export const auditLogOf = async (entityId: string): Promise<AuditLogDbRow[]> =>
  (
    await ownerQuery<AuditLogDbRow>(
      'select action, entity_type, actor_user_id, actor_platform_admin_id, before, after from audit_log where entity_id = $1 order by occurred_at, id',
      [entityId],
    )
  ).rows;

export interface ProblemDbRow {
  id: string;
  item_id: string;
  source: string;
  severity: string;
  note: string | null;
  cleared_at: Date | null;
  cleared_by_correction_id: string | null;
}

export const problemRows = async (executionId: string): Promise<ProblemDbRow[]> =>
  (
    await ownerQuery<ProblemDbRow>(
      'select id, item_id, source, severity, note, cleared_at, cleared_by_correction_id from execution_problems where execution_id = $1 order by created_at, id',
      [executionId],
    )
  ).rows;

/** Marks every medium of the execution uploaded, as if the phone had finished its uploads. */
export const markUploaded = (executionId: string) =>
  ownerQuery("update execution_media set status = 'uploaded', uploaded_at = now() where execution_id = $1", [executionId]);
