import { Injectable } from '@nestjs/common';
import { COMPLETED_STATUSES, completionPercent, type EmployeeReportRow, IN_PROGRESS_STATUSES, type OccurrenceStatus, type Page, periodDays, type ReportRun, type ReportSummary, roundOne, type RunBucket, type RunCounts, type SiteReportRow, type UserRef } from '@taskop/contracts';
import { az } from '@taskop/i18n';
import { and, eq, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { DbService } from '../db/db.service';
import { occurrences } from '../db/schema';
import type { ResolvedFilters } from './report-filters';

/** A SQL list of status literals from a contracts constant (never user input). */
export const statusList = (list: readonly string[]): SQL => sql.raw(`(${list.map((s) => `'${s}'`).join(', ')})`);

/** The siteId filter: the column's site lies in the filter site's subtree (spec §4). Undefined without a siteId. */
export function inFilterSubtree(f: ResolvedFilters, siteCol: AnyPgColumn): SQL | undefined {
  if (f.sitePath === undefined) return undefined;
  if (f.sitePath === null) return sql`false`;
  return sql`exists (select 1 from sites fs where fs.id = ${siteCol} and fs.path <@ ${f.sitePath}::ltree)`;
}

/** The spec §3.1 buckets as one row of counts over `runs r`, plus the score sum and count. */
export type CountRow = {
  planned: number;
  due: number;
  completed: number;
  in_progress: number;
  pending: number;
  overdue: number;
  partial: number;
  missed: number;
  with_problems: number;
  with_critical: number;
  score_sum: number;
  score_count: number;
};

/** classifyRun (report-logic.ts) in SQL; the cross-check test in reports-summary.test.ts keeps the two equal. */
export function countColumns(now: Date): SQL {
  const completed = statusList(COMPLETED_STATUSES);
  return sql`
    (count(*) filter (where r.status <> 'cancelled'))::int as planned,
    (count(*) filter (where r.status <> 'cancelled' and (r.status in ${completed} or r.due_at <= ${now})))::int as due,
    (count(*) filter (where r.status in ${completed}))::int as completed,
    (count(*) filter (where r.status in ${statusList(IN_PROGRESS_STATUSES)}))::int as in_progress,
    (count(*) filter (where r.status = 'pending'))::int as pending,
    (count(*) filter (where r.status = 'overdue'))::int as overdue,
    (count(*) filter (where r.status = 'partial'))::int as partial,
    (count(*) filter (where r.status = 'missed'))::int as missed,
    (count(*) filter (where r.status <> 'cancelled' and r.has_problems))::int as with_problems,
    (count(*) filter (where r.status <> 'cancelled' and r.has_critical))::int as with_critical,
    coalesce(sum(r.score_percent), 0)::float8 as score_sum,
    count(r.score_percent)::int as score_count`;
}

export const toCounts = (r: CountRow): RunCounts => ({
  planned: r.planned,
  due: r.due,
  completed: r.completed,
  inProgress: r.in_progress,
  pending: r.pending,
  overdue: r.overdue,
  partial: r.partial,
  missed: r.missed,
  withProblems: r.with_problems,
  withCritical: r.with_critical,
});

/** Percentages in TypeScript from the SQL counts, so they round exactly as report-logic.ts (Spec decision 3). */
export const measuresOf = (r: CountRow): { completionPercent: number | null; averageScore: number | null } => ({
  completionPercent: completionPercent(r.completed, r.due),
  averageScore: r.score_count ? roundOne(r.score_sum / r.score_count) : null,
});

const ZERO: CountRow = { planned: 0, due: 0, completed: 0, in_progress: 0, pending: 0, overdue: 0, partial: 0, missed: 0, with_problems: 0, with_critical: 0, score_sum: 0, score_count: 0 };
const addRows = (a: CountRow, b: CountRow): CountRow => Object.fromEntries(Object.keys(ZERO).map((k) => [k, a[k as keyof CountRow] + b[k as keyof CountRow]])) as unknown as CountRow;

/**
 * Scope and filters on the period's occurrences (spec §3.2, §4). `x` is the counted (non-rejected) execution. The
 * userId filter is spec §3.3: executed runs belong to their executor, unexecuted (not cancelled) runs to their assignees.
 */
function runConditions(f: ResolvedFilters, scope: SQL | undefined): SQL {
  const conds: (SQL | undefined)[] = [scope, sql`${occurrences.localDate} between ${f.from}::date and ${f.to}::date`, inFilterSubtree(f, occurrences.siteId)];
  if (f.checklistId) conds.push(eq(occurrences.checklistId, f.checklistId));
  if (f.userId) {
    conds.push(sql`((x.id is not null and x.executor_user_id = ${f.userId})
      or (x.id is null and ${occurrences.status} <> 'cancelled'
          and exists (select 1 from occurrence_assignees oa where oa.occurrence_id = ${occurrences.id} and oa.user_id = ${f.userId})))`);
  }
  return and(...conds)!;
}

/**
 * The CTE `runs`: one row per occurrence of the period after scope and filters, with its counted execution and its
 * problem counts. Problems are aggregated once for the period's occurrences (Spec decision 26).
 */
export function runsCte(f: ResolvedFilters, scope: SQL | undefined): SQL {
  return sql`runs as (
    select ${occurrences.id} as id, ${occurrences.status}::text as status, ${occurrences.dueAt} as due_at,
           ${occurrences.localDate}::text as local_date, ${occurrences.siteId} as site_id, ${occurrences.checklistId} as checklist_id,
           x.id as execution_id, x.executor_user_id, (x.score->>'percent')::float8 as score_percent,
           pr.occurrence_id is not null as has_problems, coalesce(pr.critical, 0) > 0 as has_critical,
           coalesce(pr.total, 0) as problem_count, coalesce(pr.critical, 0) as critical_count
      from occurrences
      left join executions x on x.occurrence_id = ${occurrences.id} and x.state <> 'rejected'
      left join (
        select ep.occurrence_id, count(*)::int as total, (count(*) filter (where ep.severity = 'critical'))::int as critical
          from execution_problems ep
          join occurrences po on po.id = ep.occurrence_id
         where po.local_date between ${f.from}::date and ${f.to}::date
         group by ep.occurrence_id
      ) pr on pr.occurrence_id = ${occurrences.id}
     where ${runConditions(f, scope)})`;
}

/** /reports/runs buckets over `runs r` (Spec decision 6). */
export function bucketCondition(b: RunBucket): SQL {
  switch (b) {
    case 'overdue':
      return sql`r.status = 'overdue'`;
    case 'partial':
      return sql`r.status = 'partial'`;
    case 'missed':
      return sql`r.status = 'missed'`;
    case 'problems':
      return sql`r.status <> 'cancelled' and r.has_problems`;
    case 'completed':
      return sql`r.status in ${statusList(COMPLETED_STATUSES)}`;
    case 'in_progress':
      return sql`r.status in ${statusList(IN_PROGRESS_STATUSES)}`;
    case 'planned':
      return sql`r.status <> 'cancelled'`;
    case 'all':
      return sql`true`;
  }
}

type RunRow = {
  id: string;
  execution_id: string | null;
  local_date: string;
  due_at: string;
  status: OccurrenceStatus;
  checklist_id: string;
  checklist_name: string;
  site_id: string;
  site_name: string;
  assignees: UserRef[];
  executor_user_id: string | null;
  executor_name: string | null;
  started_at: string | null;
  completed_at: string | null;
  completed_received_at: string | null;
  score_percent: number | null;
  late: boolean;
  clock_suspect: boolean;
  problem_count: number;
  critical_count: number;
};

// Drizzle's pg driver returns timestamps from `execute` as raw strings.
const isoOf = (v: string | null): string | null => (v === null ? null : new Date(v).toISOString());

const toReportRun = (r: RunRow): ReportRun => ({
  occurrenceId: r.id,
  executionId: r.execution_id,
  localDate: r.local_date,
  dueAt: isoOf(r.due_at)!,
  checklist: { id: r.checklist_id, name: r.checklist_name },
  site: { id: r.site_id, name: r.site_name },
  status: r.status,
  assignees: r.assignees,
  executor: r.executor_user_id ? { id: r.executor_user_id, fullName: r.executor_name ?? '' } : null,
  startedAt: isoOf(r.started_at),
  completedAt: isoOf(r.completed_at),
  completedReceivedAt: isoOf(r.completed_received_at),
  score: r.score_percent,
  problemCount: r.problem_count,
  criticalCount: r.critical_count,
  late: r.late,
  clockSuspect: r.clock_suspect,
});

/** The report SQL (spec §5.1). Every method runs in the request's tenant transaction and returns contract shapes. */
@Injectable()
export class ReportQueries {
  constructor(private readonly db: DbService) {}

  /** Counts, percentages and the daily trend; one query grouped by day, summed for the totals. */
  async summary(f: ResolvedFilters, scope: SQL | undefined): Promise<ReportSummary> {
    const days = (
      await this.db.tx().execute<CountRow & { local_date: string }>(sql`
        with ${runsCte(f, scope)}
        select r.local_date, ${countColumns(f.now)} from runs r group by r.local_date`)
    ).rows;
    const total = days.reduce<CountRow>(addRows, ZERO);
    const byDay = new Map(days.map((d) => [d.local_date, d]));
    return {
      counts: toCounts(total),
      ...measuresOf(total),
      trend: periodDays(f.from, f.to).map((date) => {
        const d = byDay.get(date);
        return { date, due: d?.due ?? 0, completed: d?.completed ?? 0, completionPercent: d ? completionPercent(d.completed, d.due) : null };
      }),
    };
  }

  /** Spec §5.3: one row per site with a planned run, in tree order; `path` = ancestor names, root first. */
  async sites(f: ResolvedFilters, scope: SQL | undefined): Promise<SiteReportRow[]> {
    const rows = await this.db.tx().execute<CountRow & { site_id: string; name: string; active: boolean; path: string[] }>(sql`
      with ${runsCte(f, scope)}
      select s.id as site_id, s.name, s.active,
             array(select a.name from sites a where a.path @> s.path and a.id <> s.id order by nlevel(a.path)) as path,
             ${countColumns(f.now)}
        from runs r
        join sites s on s.id = r.site_id
       group by s.id
      having count(*) filter (where r.status <> 'cancelled') > 0
       order by s.path`);
    return rows.rows.map((r) => ({ siteId: r.site_id, name: r.name, path: r.path, active: r.active, ...toCounts(r), ...measuresOf(r) }));
  }

  /**
   * Spec §3.3: an executed run counts for its executor only; an unexecuted run for each assignee; one without assignees
   * for the Unassigned row (user_id null, last). Cancelled runs count for nobody. Executors' scores only.
   */
  async employees(f: ResolvedFilters, scope: SQL | undefined): Promise<EmployeeReportRow[]> {
    const rows = await this.db.tx().execute<CountRow & { user_id: string | null; full_name: string | null; status: string | null }>(sql`
      with ${runsCte(f, scope)},
      attributed as (
        select r.*, r.executor_user_id as user_id from runs r
         where r.execution_id is not null and r.status <> 'cancelled'
        union all
        select r.*, oa.user_id from runs r join occurrence_assignees oa on oa.occurrence_id = r.id
         where r.execution_id is null and r.status <> 'cancelled'
        union all
        select r.*, null::uuid from runs r
         where r.execution_id is null and r.status <> 'cancelled'
           and not exists (select 1 from occurrence_assignees oa where oa.occurrence_id = r.id)
      )
      select r.user_id, u.full_name, u.status::text as status, ${countColumns(f.now)}
        from attributed r
        left join users u on u.id = r.user_id
       where ${f.userId ? sql`r.user_id = ${f.userId}` : sql`true`}
       group by r.user_id, u.full_name, u.status
       order by r.user_id is null, u.full_name, r.user_id`);
    return rows.rows.map((r) => ({
      userId: r.user_id,
      name: r.user_id ? (r.full_name ?? '') : az.reports.employees.unassigned,
      active: r.user_id ? r.status === 'active' : true,
      ...toCounts(r),
      ...measuresOf(r),
    }));
  }

  /** Spec §5.3: newest due first, keyset on (due_at, id) like /problems (Spec decision 7). `limit: null` reads every row. */
  async runs(f: ResolvedFilters, scope: SQL | undefined, bucket: RunBucket, opts: { cursor?: string; limit: number | null }): Promise<Page<ReportRun>> {
    const conds = [bucketCondition(bucket)];
    if (opts.cursor) conds.push(sql`(r.due_at, r.id) < (select c.due_at, c.id from occurrences c where c.id = ${opts.cursor})`);
    const rows = (
      await this.db.tx().execute<RunRow>(sql`
        with ${runsCte(f, scope)}
        select r.id, r.execution_id, r.local_date, r.due_at, r.status, r.checklist_id, c.name as checklist_name, r.site_id, s.name as site_name,
               coalesce((select json_agg(json_build_object('id', u.id, 'fullName', u.full_name) order by u.full_name, u.id)
                           from occurrence_assignees oa join users u on u.id = oa.user_id where oa.occurrence_id = r.id), '[]'::json) as assignees,
               x.executor_user_id, eu.full_name as executor_name, x.started_at, x.completed_at, x.completed_received_at, r.score_percent,
               coalesce(x.late, false) as late, coalesce(x.clock_suspect, false) as clock_suspect, r.problem_count, r.critical_count
          from runs r
          join checklists c on c.id = r.checklist_id
          join sites s on s.id = r.site_id
          left join executions x on x.id = r.execution_id
          left join users eu on eu.id = x.executor_user_id
         where ${sql.join(conds, sql` and `)}
         order by r.due_at desc, r.id desc
         ${opts.limit === null ? sql.empty() : sql`limit ${opts.limit + 1}`}`)
    ).rows;
    const items = opts.limit === null ? rows : rows.slice(0, opts.limit);
    const more = opts.limit !== null && rows.length > opts.limit;
    return { items: items.map(toReportRun), nextCursor: more ? items[items.length - 1]!.id : null };
  }

  /** The export's count-first check (spec §5.4). */
  async countRuns(f: ResolvedFilters, scope: SQL | undefined, bucket: RunBucket): Promise<number> {
    const r = await this.db.tx().execute<{ n: number }>(sql`with ${runsCte(f, scope)} select count(*)::int as n from runs r where ${bucketCondition(bucket)}`);
    return r.rows[0]!.n;
  }
}
