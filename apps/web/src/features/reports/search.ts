import {
  dayNumber,
  idSchema,
  localDateSchema,
  PERIOD_PRESETS,
  type PeriodPreset,
  PROBLEM_SEVERITIES,
  type ProblemSeverity,
  REPORT_KINDS,
  type ReportFilters,
  type ReportKind,
  reportRangeTooLong,
  resolvePeriod,
  RUN_AUDIT_STATES,
  RUN_BUCKETS,
  type RunAuditState,
  type RunBucket,
} from '@taskop/contracts';

/** The period picker: Part 1's presets, then the UI's own "custom" (Part 1: "Custom" is not a preset). */
export type PeriodChoice = PeriodPreset | 'custom';
export const PERIOD_CHOICES: readonly PeriodChoice[] = [...PERIOD_PRESETS, 'custom'];
export const DEFAULT_PERIOD: PeriodPreset = 'today';
export const DEFAULT_TAB: ReportKind = 'summary';
export const DEFAULT_BUCKET: RunBucket = 'all';

/**
 * The filters shared by `/` and `/reports` (spec §6.1–6.2). Absent means the default: Today, everything in the viewer's
 * scope, and only active entries in the pickers.
 */
export interface ReportSearch {
  period?: PeriodChoice;
  /** Only with `period: 'custom'`. */
  from?: string;
  to?: string;
  siteId?: string;
  userId?: string;
  checklistId?: string;
  /** "Deaktivləri göstər": the pickers also list inactive sites, people and checklists. */
  inactive?: true;
}

/** `/reports`: the shared filters, the open tab, the runs bucket and the problems severity. */
export interface ReportsPageSearch extends ReportSearch {
  tab?: ReportKind;
  bucket?: RunBucket;
  severity?: ProblemSeverity;
  /** The runs table's audit filter (SP8 spec §8.3). */
  auditState?: RunAuditState;
}

const isId = (v: unknown): v is string => idSchema.safeParse(v).success;
const isDate = (v: unknown): v is string => localDateSchema.safeParse(v).success;
const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

function pick<T extends object, K extends keyof T>(o: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

/** `validateSearch` of `/`. Anything invalid is dropped here, so it is never sent to the API. */
export function reportSearch(s: Record<string, unknown>): ReportSearch {
  const period = isOneOf(PERIOD_CHOICES, s.period) ? s.period : undefined;
  const custom = period === 'custom';
  return {
    ...(period ? { period } : {}),
    ...(custom && isDate(s.from) ? { from: s.from } : {}),
    ...(custom && isDate(s.to) ? { to: s.to } : {}),
    ...(isId(s.siteId) ? { siteId: s.siteId } : {}),
    ...(isId(s.userId) ? { userId: s.userId } : {}),
    ...(isId(s.checklistId) ? { checklistId: s.checklistId } : {}),
    // The router parses `inactive=true` into a boolean; a hand-written link may keep the string.
    ...(s.inactive === true || s.inactive === 'true' ? { inactive: true as const } : {}),
  };
}

/** `validateSearch` of `/reports`. */
export function reportsPageSearch(s: Record<string, unknown>): ReportsPageSearch {
  return {
    ...reportSearch(s),
    ...(isOneOf(REPORT_KINDS, s.tab) ? { tab: s.tab } : {}),
    ...(isOneOf(RUN_BUCKETS, s.bucket) ? { bucket: s.bucket } : {}),
    ...(isOneOf(PROBLEM_SEVERITIES, s.severity) ? { severity: s.severity } : {}),
    ...(isOneOf(RUN_AUDIT_STATES, s.auditState) ? { auditState: s.auditState } : {}),
  };
}

const FILTER_KEYS = ['period', 'from', 'to', 'siteId', 'userId', 'checklistId', 'inactive'] as const;
const PAGE_KEYS = ['tab', 'bucket', 'severity', 'auditState'] as const;

/** The filters a tile or a page switch carries along. */
export const filterSearch = (s: ReportSearch): ReportSearch => pick(s, FILTER_KEYS);
export const pageExtras = (s: ReportsPageSearch): Pick<ReportsPageSearch, 'tab' | 'bucket' | 'severity' | 'auditState'> => pick(s, PAGE_KEYS);

/** Drops empty values: a select set back to "all", a cleared date field. */
export function cleanSearch<T extends object>(s: T): T {
  return Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as T;
}

export type FilterIssue = 'incomplete' | 'toBeforeFrom' | 'tooLong';
export const FILTER_ISSUE_KEYS: Record<FilterIssue, string> = {
  incomplete: 'reports.range.incomplete',
  toBeforeFrom: 'reports.issues.toBeforeFrom',
  tooLong: 'errors.REPORT_RANGE_TOO_LONG',
};

export type ResolvedFilters = { ok: true; filters: ReportFilters } | { ok: false; issue: FilterIssue };

/**
 * The API's filters for a search, from the tenant's today. A custom range the API would refuse (spec §5.2) comes back
 * as an issue instead, and the caller asks for nothing.
 */
export function resolveReportFilters(s: ReportSearch, today: string): ResolvedFilters {
  const period = s.period ?? DEFAULT_PERIOD;
  let range: { from: string; to: string };
  if (period === 'custom') {
    if (!s.from || !s.to) return { ok: false, issue: 'incomplete' };
    if (dayNumber(s.to) < dayNumber(s.from)) return { ok: false, issue: 'toBeforeFrom' };
    if (reportRangeTooLong(s.from, s.to)) return { ok: false, issue: 'tooLong' };
    range = { from: s.from, to: s.to };
  } else {
    range = resolvePeriod(period, today);
  }
  return { ok: true, filters: { ...range, ...pick(s, ['siteId', 'userId', 'checklistId'] as const) } };
}

/** The search after choosing a period: a custom range starts from the period shown now; a preset drops the range. */
export function withPeriod(s: ReportSearch, choice: PeriodChoice, today: string): ReportSearch {
  const rest = pick(s, ['siteId', 'userId', 'checklistId', 'inactive'] as const);
  if (choice !== 'custom') return { period: choice, ...rest };
  const current = resolveReportFilters(s, today);
  const range = current.ok ? { from: current.filters.from, to: current.filters.to } : { from: today, to: today };
  return { period: 'custom', ...range, ...rest };
}
