import { Injectable } from '@nestjs/common';
import { REPORT_CONTENT_TYPES, REPORT_LIMITS, type ReportExportKind, type ReportExportParams, type ReportTaskCounts, reportFileName, type RunBucket } from '@taskop/contracts';
import { az } from '@taskop/i18n';
import { and, eq, type SQL } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import type { Principal } from '../common/request';
import { ScopeService } from '../common/scope.service';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { checklists, sites, users } from '../db/schema';
import { SchedulingScope } from '../scheduling/scheduling-scope';
import { TaskScope } from '../tasks/task-scope';
import { toCsv } from './export/csv';
import type { ReportDocument, ReportTable } from './export/report-table';
import { employeesTable, problemsTable, runsTable, runsTitle, sitesTable, summaryTables, tasksTable } from './export/report-tables';
import { toXlsx } from './export/xlsx';
import { toPdf } from './pdf/pdf-document';
import type { ResolvedFilters } from './report-filters';
import { ReportQueries } from './report-queries';
import { ReportsService } from './reports.service';

export interface ExportedFile {
  body: Buffer;
  contentType: string;
  filename: string;
}

/** The full report's run sections, one per bucket (spec §5.4). */
const FULL_RUN_BUCKETS = ['overdue', 'partial', 'missed'] as const satisfies readonly RunBucket[];

/** Spec §5.4: refuses before any rows are read when a list section is over the cap (Spec decision 18). */
function assertCap(rows: number): void {
  if (rows > REPORT_LIMITS.exportRowCap) throw new AppError('REPORT_TOO_LARGE', { details: { rows, limit: REPORT_LIMITS.exportRowCap } });
}

const taskTotal = (c: ReportTaskCounts): number => Object.values(c.byStatus).reduce((a, b) => a + b, 0);

@Injectable()
export class ReportExporter {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
    private readonly queries: ReportQueries,
    private readonly scheduling: SchedulingScope,
    private readonly taskScope: TaskScope,
    private readonly scope: ScopeService,
  ) {}

  async export(p: Principal, kind: ReportExportKind, q: ReportExportParams): Promise<ExportedFile> {
    if (kind === 'full' && q.format === 'csv') throw new AppError('VALIDATION_FAILED', { fields: { format: 'reports.issues.fullNotCsv' } });
    return this.reports.guarded(q, async (f) => {
      const sections = await this.sections(p, kind, f, q);
      const doc: ReportDocument = {
        title: az.reports.titles[kind],
        tenantName: f.tenantName,
        from: f.from,
        to: f.to,
        filters: await this.filterLabels(p, kind, f, q),
        generatedAt: f.now,
        timezone: f.timezone,
        sections,
      };
      const body = q.format === 'csv' ? toCsv(doc) : q.format === 'xlsx' ? await toXlsx(doc) : await toPdf(doc);
      // In the request's transaction: a failed export records nothing (Spec decision 20).
      await this.audit.record({
        action: 'reports.exported',
        entityType: 'report',
        entityId: null,
        after: {
          kind,
          format: q.format,
          filters: {
            from: q.from,
            to: q.to,
            siteId: q.siteId ?? null,
            userId: q.userId ?? null,
            checklistId: q.checklistId ?? null,
            bucket: kind === 'runs' ? (q.bucket ?? 'all') : null,
            severity: kind === 'problems' ? (q.severity ?? null) : null,
          },
          rows: sections.reduce((n, s) => n + s.rows.length, 0),
        },
      });
      return { body, contentType: REPORT_CONTENT_TYPES[q.format], filename: reportFileName(kind, q.from, q.to, q.format) };
    });
  }

  private async sections(p: Principal, kind: ReportExportKind, f: ResolvedFilters, q: ReportExportParams): Promise<ReportTable[]> {
    const occ: SQL | undefined = this.scheduling.occurrences(p);
    const taskScope = this.taskScope.readable(p);
    switch (kind) {
      case 'summary':
        return summaryTables(await this.queries.summary(f, occ));
      case 'sites': {
        const rows = await this.queries.sites(f, occ);
        assertCap(rows.length);
        return [sitesTable(rows)];
      }
      case 'employees': {
        const rows = await this.queries.employees(f, occ);
        assertCap(rows.length);
        return [employeesTable(rows)];
      }
      case 'runs': {
        const bucket = q.bucket ?? 'all';
        assertCap(await this.queries.countRuns(f, occ, bucket));
        return [runsTable((await this.queries.runs(f, occ, bucket, { limit: null })).items, runsTitle(bucket))];
      }
      case 'problems': {
        assertCap((await this.queries.problemCounts(f, occ, q.severity)).total);
        return [problemsTable((await this.queries.problems(f, occ, q.severity, { limit: null })).items)];
      }
      case 'tasks': {
        assertCap(taskTotal(await this.queries.taskCounts(f, taskScope)));
        return [tasksTable((await this.queries.tasks(f, taskScope, { limit: null })).items)];
      }
      case 'full': {
        // Every list section is counted before any rows are read.
        const siteRows = await this.queries.sites(f, occ);
        const employeeRows = await this.queries.employees(f, occ);
        const runCounts: number[] = [];
        for (const b of FULL_RUN_BUCKETS) runCounts.push(await this.queries.countRuns(f, occ, b));
        const problemTotal = (await this.queries.problemCounts(f, occ, undefined)).total;
        const taskCount = taskTotal(await this.queries.taskCounts(f, taskScope));
        assertCap(Math.max(siteRows.length, employeeRows.length, ...runCounts, problemTotal, taskCount));
        const runSections: ReportTable[] = [];
        for (const b of FULL_RUN_BUCKETS) runSections.push(runsTable((await this.queries.runs(f, occ, b, { limit: null })).items, az.reports.sheets[b]));
        return [
          ...summaryTables(await this.queries.summary(f, occ)),
          sitesTable(siteRows),
          employeesTable(employeeRows),
          ...runSections,
          problemsTable((await this.queries.problems(f, occ, undefined, { limit: null })).items),
          tasksTable((await this.queries.tasks(f, taskScope, { limit: null })).items),
        ];
      }
    }
  }

  /** "Obyekt: Zona A1"-style lines for the PDF header; names as they are now, only for what the viewer's scope can see (else "—"). */
  private async filterLabels(p: Principal, kind: ReportExportKind, f: ResolvedFilters, q: ReportExportParams): Promise<string[]> {
    const tx = this.db.tx();
    const F = az.reports.filters;
    const out: string[] = [];
    if (f.siteId) {
      const [s] = await tx.select({ name: sites.name }).from(sites).where(and(eq(sites.id, f.siteId), this.scheduling.readableSites(p)));
      out.push(`${F.site}: ${s?.name ?? az.reports.noValue}`);
    }
    if (f.userId) {
      const [u] = await tx.select({ name: users.fullName }).from(users).where(and(eq(users.id, f.userId), this.scope.usersFilter(p)));
      out.push(`${F.employee}: ${u?.name ?? az.reports.noValue}`);
    }
    if (f.checklistId) {
      const [c] = await tx.select({ name: checklists.name }).from(checklists).where(eq(checklists.id, f.checklistId));
      out.push(`${F.checklist}: ${c?.name ?? az.reports.noValue}`);
    }
    if (kind === 'runs' && q.bucket && q.bucket !== 'all') out.push(`${F.bucket}: ${az.reports.buckets[q.bucket]}`);
    if (kind === 'problems' && q.severity) out.push(`${F.severity}: ${az.executions.severities[q.severity]}`);
    return out;
  }
}
