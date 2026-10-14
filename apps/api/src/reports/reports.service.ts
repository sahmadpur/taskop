import { Inject, Injectable } from '@nestjs/common';
import {
  type EmployeeReportRow,
  type Page,
  REPORT_LIMITS,
  type ReportFilters,
  type ReportProblems,
  type ReportProblemsParams,
  type ReportRun,
  type ReportRunsParams,
  type ReportSummary,
  type ReportTasks,
  type ReportTasksParams,
  type SiteReportRow,
} from '@taskop/contracts';
import { sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { pgErrorOf } from '../common/pg-errors';
import type { Principal } from '../common/request';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { DbService } from '../db/db.service';
import { SchedulingScope } from '../scheduling/scheduling-scope';
import { TaskScope } from '../tasks/task-scope';
import { ReportFilterResolver, type ResolvedFilters } from './report-filters';
import { ReportQueries } from './report-queries';

/** SQLSTATE query_canceled: the statement timeout fired. */
const QUERY_CANCELED = '57014';

/** The report endpoints (spec §5.3): scope from the principal, filters from the query, one guarded transaction. */
@Injectable()
export class ReportsService {
  constructor(
    private readonly db: DbService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly filters: ReportFilterResolver,
    private readonly scheduling: SchedulingScope,
    private readonly taskScope: TaskScope,
    private readonly queries: ReportQueries,
  ) {}

  /**
   * Spec §5.5: a statement timeout for the rest of the request's transaction (TenantContextInterceptor opened it), the
   * range check, then `fn`. A cancelled statement aborts the transaction; it is answered 503 REPORT_TIMEOUT.
   */
  async guarded<T>(q: ReportFilters, fn: (f: ResolvedFilters) => Promise<T>): Promise<T> {
    // A config integer, never user input; SET takes no bind parameters.
    await this.db.tx().execute(sql.raw(`set local statement_timeout = ${Math.trunc(this.config.REPORTS_STATEMENT_TIMEOUT_MS)}`));
    try {
      return await fn(await this.filters.resolve(q));
    } catch (e) {
      if (pgErrorOf(e)?.code === QUERY_CANCELED) throw new AppError('REPORT_TIMEOUT');
      throw e;
    }
  }

  summary(p: Principal, q: ReportFilters): Promise<ReportSummary> {
    return this.guarded(q, (f) => this.queries.summary(f, this.scheduling.occurrences(p)));
  }

  sites(p: Principal, q: ReportFilters): Promise<SiteReportRow[]> {
    return this.guarded(q, (f) => this.queries.sites(f, this.scheduling.occurrences(p)));
  }

  employees(p: Principal, q: ReportFilters): Promise<EmployeeReportRow[]> {
    return this.guarded(q, (f) => this.queries.employees(f, this.scheduling.occurrences(p)));
  }

  runs(p: Principal, q: ReportRunsParams): Promise<Page<ReportRun>> {
    return this.guarded(q, (f) => this.queries.runs(f, this.scheduling.occurrences(p), q.bucket, { cursor: q.cursor, limit: REPORT_LIMITS.pageSize }));
  }

  problems(p: Principal, q: ReportProblemsParams): Promise<ReportProblems> {
    return this.guarded(q, async (f) => {
      const scope = this.scheduling.occurrences(p);
      const counts = await this.queries.problemCounts(f, scope, q.severity);
      return { counts, ...(await this.queries.problems(f, scope, q.severity, { cursor: q.cursor, limit: REPORT_LIMITS.pageSize })) };
    });
  }

  tasks(p: Principal, q: ReportTasksParams): Promise<ReportTasks> {
    return this.guarded(q, async (f) => {
      const scope = this.taskScope.readable(p);
      const counts = await this.queries.taskCounts(f, scope);
      return { counts, ...(await this.queries.tasks(f, scope, { cursor: q.cursor, limit: REPORT_LIMITS.pageSize })) };
    });
  }
}
