import {
  AUDIT_LIMITS,
  AUDIT_QUEUES,
  AUDIT_RESULTS,
  type Answers,
  type AuditItemVerdict,
  type AuditQueue,
  type AuditQueueQuery,
  type AuditResult,
  type AuditVerdict,
  type ChecklistContent,
  dayNumber,
  idSchema,
  localDateSchema,
  type RunAuditState,
  type VisibleItem,
  visibleItems,
} from '@taskop/contracts';
import type { TFunction } from 'i18next';
import type { Variant } from '@/features/scheduling/labels';

export const DEFAULT_QUEUE: AuditQueue = 'waiting';
/** Part 1 "Errors to handle in the UI": while the report is built, GET /audits/:id every 3 s, for at most 60 s. */
export const REPORT_POLL_MS = 3_000;
export const REPORT_POLL_LIMIT_MS = 60_000;

export const resultVariant = (r: AuditResult): Variant => (r === 'passed' ? 'default' : 'destructive');

export const runAuditStateVariant = (s: RunAuditState): Variant =>
  s === 'passed' ? 'default' : s === 'failed' ? 'destructive' : s === 'in_progress' || s === 'waiting' ? 'audit' : 'outline';

export const verdictVariant = (v: AuditVerdict | null): Variant => (v === 'approved' ? 'default' : v === 'rejected' ? 'destructive' : 'outline');

/** `/audits`: the open queue and its filters (decision 2). Absent means Waiting, everything in scope. */
export interface AuditsSearch {
  queue?: AuditQueue;
  siteId?: string;
  checklistId?: string;
  auditorId?: string;
  result?: AuditResult;
  /** Run completion date range, both ends inclusive, tenant dates. */
  from?: string;
  to?: string;
}

const isId = (v: unknown): v is string => idSchema.safeParse(v).success;
const isDate = (v: unknown): v is string => localDateSchema.safeParse(v).success;
const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/** `validateSearch` of `/audits`: anything invalid is dropped here, so it is never sent to the API. */
export function auditsSearch(s: Record<string, unknown>): AuditsSearch {
  return {
    ...(isOneOf(AUDIT_QUEUES, s.queue) ? { queue: s.queue } : {}),
    ...(isId(s.siteId) ? { siteId: s.siteId } : {}),
    ...(isId(s.checklistId) ? { checklistId: s.checklistId } : {}),
    ...(isId(s.auditorId) ? { auditorId: s.auditorId } : {}),
    ...(isOneOf(AUDIT_RESULTS, s.result) ? { result: s.result } : {}),
    ...(isDate(s.from) ? { from: s.from } : {}),
    ...(isDate(s.to) ? { to: s.to } : {}),
  };
}

export type QueueRangeIssue = 'incomplete' | 'inverted' | 'tooLong';
export const RANGE_ISSUE_KEYS: Record<QueueRangeIssue, string> = {
  incomplete: 'audits.web.page.range.incomplete',
  inverted: 'audits.web.page.range.inverted',
  tooLong: 'audits.issues.rangeTooLong',
};

/** The API's refine on the queue (Part 1): both dates or none, `to ≥ from`, at most 366 days counting both ends. */
export function queueRangeIssue(from?: string, to?: string): QueueRangeIssue | null {
  if (!from && !to) return null;
  if (!from || !to) return 'incomplete';
  const days = dayNumber(to) - dayNumber(from) + 1;
  if (days < 1) return 'inverted';
  if (days > AUDIT_LIMITS.queueMaxDays) return 'tooLong';
  return null;
}

export type AuditQueueFilters = Omit<AuditQueueQuery, 'cursor' | 'limit'>;

/** GET /audits for a search. A waiting run has no auditor yet, and only a finished audit has a result. */
export function queueFilters(s: AuditsSearch): AuditQueueFilters {
  const queue = s.queue ?? DEFAULT_QUEUE;
  return {
    queue,
    ...(s.siteId ? { siteId: s.siteId } : {}),
    ...(s.checklistId ? { checklistId: s.checklistId } : {}),
    ...(queue !== 'waiting' && s.auditorId ? { auditorId: s.auditorId } : {}),
    ...(queue === 'finished' && s.result ? { result: s.result } : {}),
    ...(s.from && s.to ? { from: s.from, to: s.to } : {}),
  };
}

/** The items under review, in checklist order: visible for the current answers and auditable (decision 5). */
export function auditItems(content: ChecklistContent, answers: Answers, auditableIds: readonly string[]): VisibleItem[] {
  const ids = new Set(auditableIds);
  return visibleItems(content, answers).filter((v) => ids.has(v.item.id));
}

export const verdictMap = (verdicts: readonly AuditItemVerdict[]): Map<string, AuditVerdict> => new Map(verdicts.map((v) => [v.itemId, v.verdict]));

/** The neighbour of `current` in `order`, staying at the ends; the first item when nothing (or a vanished item) is selected. */
export function stepItem(order: readonly string[], current: string | null, step: 1 | -1): string | null {
  if (order.length === 0) return null;
  const i = current === null ? -1 : order.indexOf(current);
  if (i === -1) return order[0]!;
  return order[Math.min(order.length - 1, Math.max(0, i + step))]!;
}

/** An auditor or a correction's actor: the person, or Taskop support for a platform admin. */
export const actorName = (t: TFunction, a: { kind: 'user' | 'platform'; name: string | null } | null): string =>
  a === null ? '—' : a.kind === 'platform' ? t('scheduling.schedule.actorPlatform') : (a.name ?? '—');

export const upsertVerdict = (list: readonly AuditItemVerdict[], v: AuditItemVerdict): AuditItemVerdict[] => [...list.filter((x) => x.itemId !== v.itemId), v];
