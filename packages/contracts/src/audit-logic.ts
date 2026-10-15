import { z } from 'zod';
import type { ChecklistContent } from './checklist-content.js';
import { type Answer, type Answers, visibleItems } from './checklist-logic.js';
import { idSchema } from './common.js';
import { emailSchema } from './credentials.js';
import type { ExecutionState } from './execution-logic.js';
import type { OccurrenceStatus } from './occurrences.js';
import { roundOne } from './report-logic.js';

/**
 * Sub-project 8 spec §3–§4.3: the audit and correction rules shared by the API, the web and the phone.
 * The API enforces exactly these; the apps use them to show only the actions the API will accept.
 */
export const AUDIT_STATUSES = ['in_progress', 'finished', 'cancelled'] as const;
export const auditStatusSchema = z.enum(AUDIT_STATUSES);
export type AuditStatus = z.infer<typeof auditStatusSchema>;

export const AUDIT_RESULTS = ['passed', 'failed'] as const;
export const auditResultSchema = z.enum(AUDIT_RESULTS);
export type AuditResult = z.infer<typeof auditResultSchema>;

export const AUDIT_VERDICTS = ['approved', 'rejected'] as const;
export const auditVerdictSchema = z.enum(AUDIT_VERDICTS);
export type AuditVerdict = z.infer<typeof auditVerdictSchema>;

export const AUDIT_REPORT_STATUSES = ['none', 'pending', 'ready', 'failed'] as const;
export const auditReportStatusSchema = z.enum(AUDIT_REPORT_STATUSES);
export type AuditReportStatus = z.infer<typeof auditReportStatusSchema>;

/** The tabs of the web audit queue (spec §8.3). */
export const AUDIT_QUEUES = ['waiting', 'in_progress', 'finished'] as const;
export const auditQueueSchema = z.enum(AUDIT_QUEUES);
export type AuditQueue = z.infer<typeof auditQueueSchema>;

/** The reports runs column (spec §8.3): no audit is null. */
export const RUN_AUDIT_STATES = ['waiting', 'in_progress', 'passed', 'failed'] as const;
export const runAuditStateSchema = z.enum(RUN_AUDIT_STATES);
export type RunAuditState = z.infer<typeof runAuditStateSchema>;

/** `manual` = a manager's direct correction; `rework` = the worker's resubmit after a send-back. */
export const CORRECTION_KINDS = ['manual', 'rework'] as const;
export const correctionKindSchema = z.enum(CORRECTION_KINDS);
export type CorrectionKind = z.infer<typeof correctionKindSchema>;

/** The only statuses an audit, a correction or a send-back may start from (spec §1, "Which runs"). */
export const CORRECTABLE_STATUSES = ['completed', 'audit_pending'] as const satisfies readonly OccurrenceStatus[];

export const AUDIT_LIMITS = {
  /** checklists.audit_report_emails. */
  reportEmails: 10,
  /** Checklist addresses plus extra addresses, per send. */
  recipients: 20,
  verdictComment: 1000,
  finalComment: 4000,
  /** A correction's reason and a rework item's comment. */
  reason: 1000,
  cancelReason: 500,
  reworkItems: 200,
  changes: 200,
  photosPerItem: 3,
  photosPerReport: 40,
  queuePageSize: 50,
  queueMaxDays: 366,
} as const;

export interface RunState {
  status: OccurrenceStatus;
  executionState: ExecutionState;
}

const isCorrectable = (s: OccurrenceStatus): boolean => (CORRECTABLE_STATUSES as readonly OccurrenceStatus[]).includes(s);

/** Direct corrections: completed or audit_pending, with a completed execution (not rework, not partial). */
export const canCorrect = (run: RunState): boolean => isCorrectable(run.status) && run.executionState === 'completed';

/** Send-back follows the same rule as a correction. */
export const canSendBack = (run: RunState): boolean => canCorrect(run);

/** Only an open send-back can be withdrawn. */
export const canWithdrawSendBack = (run: RunState): boolean => run.status === 'correction_required' && run.executionState === 'rework';

/** `hasOpenAudit`: a non-cancelled audit exists for the run. */
export const canStartAudit = (run: RunState, hasOpenAudit: boolean): boolean => canCorrect(run) && !hasOpenAudit;

/** While the run is with the worker, its audit can collect verdicts but not finish (spec §3.3). */
export const isAuditPaused = (status: OccurrenceStatus): boolean => status === 'correction_required';

export function nextStatusAfterResubmit(requiresAudit: boolean, hasOpenAudit: boolean): 'completed' | 'audit_pending' {
  return requiresAudit || hasOpenAudit ? 'audit_pending' : 'completed';
}

/** A run sent back keeps its status until the resubmit decides it (Spec decision 12). */
export function statusAfterAuditCancel(requiresAudit: boolean, current: OccurrenceStatus): OccurrenceStatus {
  if (current === 'correction_required') return current;
  return requiresAudit ? 'audit_pending' : 'completed';
}

/** Spec decision 1: the items the current answers show, in checklist order. */
export function auditableItemIds(content: ChecklistContent, answers: Answers): string[] {
  return visibleItems(content, answers).map((v) => v.item.id);
}

export const auditScoreSchema = z.object({
  approved: z.number().int(),
  rejected: z.number().int(),
  reviewed: z.number().int(),
  percent: z.number().nullable(),
});
export type AuditScore = z.infer<typeof auditScoreSchema>;

/** approved ÷ reviewed × 100, one decimal; verdicts on items that are not auditable are ignored. */
export function auditScore(verdicts: ReadonlyMap<string, AuditVerdict>, auditableIds: readonly string[]): AuditScore {
  let approved = 0;
  let rejected = 0;
  for (const id of auditableIds) {
    const v = verdicts.get(id);
    if (v === 'approved') approved++;
    else if (v === 'rejected') rejected++;
  }
  const reviewed = approved + rejected;
  return { approved, rejected, reviewed, percent: reviewed ? roundOne((approved / reviewed) * 100) : null };
}

export function missingVerdicts(verdicts: ReadonlyMap<string, AuditVerdict>, auditableIds: readonly string[]): string[] {
  return auditableIds.filter((id) => !verdicts.has(id));
}

/**
 * The comparable form of a value: option ids sorted; empty arrays, blank strings, null and undefined dropped;
 * object keys sorted. Photo and video order is kept: it is what the worker chose.
 */
function normalise(v: unknown, key?: string): unknown {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return v.trim() === '' ? undefined : v;
  if (Array.isArray(v)) {
    if (!v.length) return undefined;
    const items = v.map((x) => normalise(x));
    return key === 'optionIds' ? [...(items as string[])].sort() : items;
  }
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const n = normalise((v as Record<string, unknown>)[k], k);
      if (n !== undefined) out[k] = n;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return v;
}

export function answersEqual(a: Answer | undefined, b: Answer | undefined): boolean {
  return JSON.stringify(normalise(a) ?? null) === JSON.stringify(normalise(b) ?? null);
}

/** Every item whose answer differs: those in `after` in its key order, then those only in `before`. */
export function changedItemIds(before: Answers, after: Answers): string[] {
  const ids = [...Object.keys(after), ...Object.keys(before).filter((id) => !Object.hasOwn(after, id))];
  return ids.filter((id) => !answersEqual(before[id], after[id]));
}

/**
 * Spec §4.3 reworkGuard (Spec decision 28): the changed items the worker may not change. Only unflagged items visible
 * both before and after are locked; anything hidden on either side may change. So follow-ups a flagged answer reveals
 * (and chains of them) can be answered, and a follow-up hidden again may keep or drop a leftover answer. Otherwise a
 * revealed required follow-up could never be answered and the run could never be resubmitted.
 */
export function reworkViolations(content: ChecklistContent, before: Answers, after: Answers, flagged: ReadonlySet<string>): string[] {
  const shownBefore = new Set(visibleItems(content, before).map((v) => v.item.id));
  const shownAfter = new Set(visibleItems(content, after).map((v) => v.item.id));
  return changedItemIds(before, after).filter((id) => !flagged.has(id) && shownBefore.has(id) && shownAfter.has(id));
}

export function runAuditState(status: OccurrenceStatus, audit: { status: AuditStatus; result: AuditResult | null } | null): RunAuditState | null {
  if (audit?.status === 'in_progress') return 'in_progress';
  if (audit?.status === 'finished') return audit.result === 'failed' ? 'failed' : 'passed';
  return status === 'audit_pending' ? 'waiting' : null;
}

/** The run's latest audit on the run views (`ExecutionDetail.audit`). */
export const auditBriefSchema = z.object({
  id: idSchema,
  status: auditStatusSchema,
  result: auditResultSchema.nullable(),
  percent: z.number().nullable(),
  /** In progress while the run is sent back. */
  paused: z.boolean(),
});
export type AuditBrief = z.infer<typeof auditBriefSchema>;

const dedupe = (list: readonly string[]): string[] => [...new Set(list)];

/** checklists.audit_report_emails: lower-cased, de-duplicated, at most 10. */
export const auditReportEmailsSchema = z
  .array(emailSchema)
  .max(AUDIT_LIMITS.reportEmails, { error: 'audits.issues.tooManyEmails' })
  .transform(dedupe);

/** Spec §7.2: the checklist's addresses, then the extra ones; lower-cased, de-duplicated, at most 20. */
export function reportRecipients(checklistEmails: readonly string[], extra: readonly string[]): string[] {
  return dedupe([...checklistEmails, ...extra].map((e) => e.trim().toLowerCase()).filter(Boolean)).slice(0, AUDIT_LIMITS.recipients);
}
