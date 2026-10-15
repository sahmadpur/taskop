import { ApiError } from '@taskop/api-client';
import type {
  ChecklistSummary,
  EmployeeReportRow,
  ProblemSeverity,
  ReportExportKind,
  ReportExportQuery,
  ReportFilters,
  ReportFormat,
  ReportRun,
  RunAuditState,
  RunBucket,
  RunCountKey,
  SiteDto,
} from '@taskop/contracts';
import type { TFunction } from 'i18next';
import { formatPercent } from '@/features/executions/labels';
import { buildTree, type SiteNode } from '@/features/sites/tree';
import { errorText } from '@/lib/errors';
import { filterSearch, type ReportSearch, type ReportsPageSearch } from './search';

/** The counts shown as tiles; each one opens the runs list of its bucket (Part 1 decision 6). */
export type TileKey = Extract<RunCountKey, 'planned' | 'completed' | 'inProgress' | 'overdue' | 'partial' | 'missed' | 'withProblems'>;

export const TILE_BUCKETS: Record<TileKey, RunBucket> = {
  planned: 'planned',
  completed: 'completed',
  inProgress: 'in_progress',
  overdue: 'overdue',
  partial: 'partial',
  missed: 'missed',
  withProblems: 'problems',
};

/** Spec §6.1: Planned, Completed, In progress, Overdue, With problems (then the two percentages). */
export const DASHBOARD_TILES: readonly TileKey[] = ['planned', 'completed', 'inProgress', 'overdue', 'withProblems'];
/** The Summary tab also shows Partial and Missed (decision 6). */
export const SUMMARY_TILES: readonly TileKey[] = ['planned', 'completed', 'inProgress', 'overdue', 'partial', 'missed', 'withProblems'];

/** `/reports?tab=runs&bucket=…` with the same filters. */
export const tileSearch = (s: ReportSearch, key: TileKey): ReportsPageSearch => ({ ...filterSearch(s), tab: 'runs', bucket: TILE_BUCKETS[key] });

export const percentText = (t: TFunction, value: number | null, locale: string): string =>
  value === null ? t('reports.noValue') : t('executions.percent', { value: formatPercent(value, locale) });

/** The trend is hidden for a single day (spec §6.1). */
export const isSingleDay = (f: Pick<ReportFilters, 'from' | 'to'>): boolean => f.from === f.to;

export interface SortState<K> {
  key: K;
  dir: 'asc' | 'desc';
}

/**
 * A sorted copy (decision 12). Missing values go last in either direction; ties keep the server's order; rows matched
 * by `pinLast` (the Unassigned row) stay at the end.
 */
export function sortRows<T extends object, K extends keyof T>(rows: readonly T[], sort: SortState<K> | null, pinLast: (row: T) => boolean = () => false): T[] {
  const pinned = rows.filter(pinLast);
  const rest = rows.filter((r) => !pinLast(r));
  if (!sort) return [...rest, ...pinned];
  const sign = sort.dir === 'asc' ? 1 : -1;
  const indexed = rest.map((row, i) => ({ row, i }));
  indexed.sort((a, b) => {
    const x: unknown = a.row[sort.key];
    const y: unknown = b.row[sort.key];
    const xMissing = x === null || x === undefined;
    const yMissing = y === null || y === undefined;
    if (xMissing || yMissing) return xMissing && yMissing ? a.i - b.i : xMissing ? 1 : -1;
    const c = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y, 'az') : Number(x) - Number(y);
    return c === 0 ? a.i - b.i : c * sign;
  });
  return [...indexed.map((e) => e.row), ...pinned];
}

/** Names A→Z and numbers high→low first; the same column again reverses. */
export const nextSort = <K extends string>(current: SortState<K> | null, key: K): SortState<K> =>
  current?.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' };

/** Sites in tree order; inactive ones only with "show inactive", except the selected one (decision 5). */
export function siteOptions(sites: readonly SiteDto[], showInactive: boolean, selectedId?: string): SiteDto[] {
  const out: SiteDto[] = [];
  const walk = (nodes: SiteNode[]) => {
    for (const n of nodes) {
      if (n.active || showInactive || n.id === selectedId) out.push(n);
      walk(n.children);
    }
  };
  walk(buildTree([...sites]));
  return out;
}

export interface EmployeeOption {
  id: string;
  name: string;
  active: boolean;
}

/** The people of the period's employee report (decision 4); the Unassigned row cannot be a filter. */
export function employeeOptions(rows: readonly EmployeeReportRow[], showInactive: boolean, selectedId?: string): EmployeeOption[] {
  return rows
    .filter((r): r is EmployeeReportRow & { userId: string } => r.userId !== null)
    .filter((r) => r.active || showInactive || r.userId === selectedId)
    .map((r) => ({ id: r.userId, name: r.name, active: r.active }));
}

export function checklistOptions(list: readonly ChecklistSummary[], showInactive: boolean, selectedId?: string): ChecklistSummary[] {
  return list.filter((c) => c.status === 'active' || showInactive || c.id === selectedId).sort((a, b) => a.name.localeCompare(b.name, 'az'));
}

/** The export's query: bucket and audit state go with runs, severity with problems, the full report takes none (SP7 decision 14, SP8 decision 16). */
export function exportQuery(
  kind: ReportExportKind,
  filters: ReportFilters,
  format: ReportFormat,
  extra: { bucket?: RunBucket; severity?: ProblemSeverity; auditState?: RunAuditState },
): ReportExportQuery {
  return {
    ...filters,
    format,
    ...(kind === 'runs' && extra.bucket ? { bucket: extra.bucket } : {}),
    ...(kind === 'runs' && extra.auditState ? { auditState: extra.auditState } : {}),
    ...(kind === 'problems' && extra.severity ? { severity: extra.severity } : {}),
  };
}

/** REPORT_TOO_LARGE names the rows and the cap and asks to narrow the filters; anything else comes from az.errors. */
export function exportErrorText(t: TFunction, e: unknown): string {
  if (e instanceof ApiError && e.code === 'REPORT_TOO_LARGE' && e.rows !== null && e.limit !== null) {
    return t('reports.export.tooLarge', { rows: e.rows, limit: e.limit });
  }
  return errorText(t, e);
}

/** Who did or is to do a run: the executor, else the assignees, else Unassigned. */
export const runPeople = (t: TFunction, r: ReportRun): string =>
  r.executor?.fullName ?? (r.assignees.map((a) => a.fullName).join(', ') || t('reports.employees.unassigned'));
