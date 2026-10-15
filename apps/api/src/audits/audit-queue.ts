import { Injectable } from '@nestjs/common';
import { type AuditQueueParams, type AuditQueueRow, type AuditResult, type AuditStatus, type OccurrenceStatus, type Page, runAuditState } from '@taskop/contracts';
import { type SQL, sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { occurrences } from '../db/schema';
import type { Actor } from '../scheduling/actor';
import { SchedulingScope } from '../scheduling/scheduling-scope';
import { auditorOf } from './audit-rows';

type QueueRow = {
  occurrence_id: string;
  execution_id: string;
  audit_id: string | null;
  checklist_id: string;
  checklist_name: string;
  site_id: string;
  site_name: string;
  executor_user_id: string;
  executor_name: string;
  local_date: string;
  completed_at: string;
  status: OccurrenceStatus;
  audit_status: AuditStatus | null;
  audit_result: AuditResult | null;
  percent: number | null;
  started_at: string | null;
  finished_at: string | null;
  auditor_user_id: string | null;
  auditor_name: string | null;
};

// Drizzle's pg driver returns timestamps from `execute` as raw strings.
const isoOf = (v: string | null): string | null => (v === null ? null : new Date(v).toISOString());

/** GET /audits (Spec decision 13): one row per counted execution, with its non-cancelled audit; keyset pages. */
@Injectable()
export class AuditQueueQuery {
  constructor(
    private readonly db: DbService,
    private readonly scope: SchedulingScope,
  ) {}

  async page(a: Actor, q: AuditQueueParams): Promise<Page<AuditQueueRow>> {
    const conds: SQL[] = [this.scope.occurrences(a) ?? sql`true`];
    let order: SQL;
    switch (q.queue) {
      case 'waiting':
        conds.push(sql`${occurrences.status} = 'audit_pending' and au.id is null`);
        if (q.cursor) {
          conds.push(sql`(x.completed_at, ${occurrences.id}) > (select cx.completed_at, cx.occurrence_id from executions cx where cx.occurrence_id = ${q.cursor} and cx.state <> 'rejected')`);
        }
        order = sql`x.completed_at asc, ${occurrences.id} asc`;
        break;
      case 'in_progress':
        conds.push(sql`au.status = 'in_progress'`);
        if (q.cursor) conds.push(sql`(au.started_at, ${occurrences.id}) < (select ca.started_at, ca.occurrence_id from audits ca where ca.occurrence_id = ${q.cursor} and ca.status <> 'cancelled')`);
        order = sql`au.started_at desc, ${occurrences.id} desc`;
        break;
      case 'finished':
        conds.push(sql`au.status = 'finished'`);
        if (q.cursor) conds.push(sql`(au.finished_at, ${occurrences.id}) < (select ca.finished_at, ca.occurrence_id from audits ca where ca.occurrence_id = ${q.cursor} and ca.status <> 'cancelled')`);
        order = sql`au.finished_at desc, ${occurrences.id} desc`;
        break;
    }
    if (q.siteId) conds.push(sql`exists (select 1 from sites fs, sites f where f.id = ${q.siteId} and fs.id = ${occurrences.siteId} and fs.path <@ f.path)`);
    if (q.checklistId) conds.push(sql`${occurrences.checklistId} = ${q.checklistId}`);
    if (q.auditorId) conds.push(sql`au.auditor_user_id = ${q.auditorId}`);
    if (q.result) conds.push(sql`au.result = ${q.result}`);
    if (q.from && q.to) conds.push(sql`${occurrences.localDate} between ${q.from}::date and ${q.to}::date`);
    const rows = (
      await this.db.tx().execute<QueueRow>(sql`
        select ${occurrences.id} as occurrence_id, x.id as execution_id, au.id as audit_id,
               c.id as checklist_id, c.name as checklist_name, s.id as site_id, s.name as site_name,
               x.executor_user_id, eu.full_name as executor_name, ${occurrences.localDate}::text as local_date, x.completed_at,
               ${occurrences.status}::text as status, au.status::text as audit_status, au.result::text as audit_result,
               (au.audit_score->>'percent')::float8 as percent, au.started_at, au.finished_at, au.auditor_user_id, aud.full_name as auditor_name
          from occurrences
          join executions x on x.occurrence_id = ${occurrences.id} and x.state <> 'rejected'
          join checklists c on c.id = ${occurrences.checklistId}
          join sites s on s.id = ${occurrences.siteId}
          join users eu on eu.id = x.executor_user_id
          left join audits au on au.execution_id = x.id and au.status <> 'cancelled'
          left join users aud on aud.id = au.auditor_user_id
         where ${sql.join(conds, sql` and `)}
         order by ${order!}
         limit ${q.limit + 1}`)
    ).rows;
    const items = rows.slice(0, q.limit).map((r): AuditQueueRow => ({
      occurrenceId: r.occurrence_id,
      executionId: r.execution_id,
      auditId: r.audit_id,
      checklist: { id: r.checklist_id, name: r.checklist_name },
      site: { id: r.site_id, name: r.site_name },
      executor: { id: r.executor_user_id, fullName: r.executor_name },
      localDate: r.local_date,
      completedAt: isoOf(r.completed_at)!,
      status: r.status,
      auditState: runAuditState(r.status, r.audit_status ? { status: r.audit_status, result: r.audit_result } : null),
      auditor: r.audit_id ? auditorOf(r.auditor_user_id, r.auditor_name) : null,
      result: r.audit_result,
      percent: r.percent,
      startedAt: isoOf(r.started_at),
      finishedAt: isoOf(r.finished_at),
    }));
    return { items, nextCursor: rows.length > q.limit ? items[items.length - 1]!.occurrenceId : null };
  }
}
