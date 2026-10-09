import { z } from 'zod';
import { type ChecklistContent, PROBLEM_SEVERITIES, type ProblemSeverity } from './checklist-content.js';
import { type Answers, computeScore, isAnswered, type MissingKind, requirements, visibleItems } from './checklist-logic.js';
import { idSchema } from './common.js';

export const EXECUTION_STATES = ['active', 'completed', 'partial', 'rejected'] as const;
export const executionStateSchema = z.enum(EXECUTION_STATES);
export type ExecutionState = z.infer<typeof executionStateSchema>;

/** Why a claim was stored as rejected (spec §5.2). The strings are also i18n keys under executions.claimRejections. */
export const CLAIM_REJECTION_REASONS = ['ALREADY_CLAIMED', 'NOT_ASSIGNED', 'NOT_STARTABLE', 'NOT_YET_OPEN', 'CLOSED', 'NOT_ON_SHIFT'] as const;
export const claimRejectionReasonSchema = z.enum(CLAIM_REJECTION_REASONS);
export type ClaimRejectionReason = z.infer<typeof claimRejectionReasonSchema>;

export const PROBLEM_SOURCES = ['rule', 'manual'] as const;
export const problemSourceSchema = z.enum(PROBLEM_SOURCES);
export type ProblemSource = z.infer<typeof problemSourceSchema>;
export const problemSeveritySchema = z.enum(PROBLEM_SEVERITIES);

export const MISSING_KINDS = ['answer', 'photo', 'video', 'note', 'mediaCount'] as const satisfies readonly MissingKind[];
export const missingSchema = z.object({ itemId: idSchema, kind: z.enum(MISSING_KINDS) });

export const progressSchema = z.object({ answered: z.number().int(), total: z.number().int(), requiredMissing: z.number().int() });
export type ExecutionProgress = z.infer<typeof progressSchema>;

export const scoreSchema = z.object({
  earned: z.number(),
  possible: z.number(),
  percent: z.number().nullable(),
  problems: z.array(z.object({ itemId: idSchema, severity: problemSeveritySchema })),
});

export interface DerivedProblem {
  itemId: string;
  source: ProblemSource;
  severity: ProblemSeverity;
  note: string | null;
  mediaIds: string[];
}

/** FR-10.07, over visible items. `requiredMissing` counts every completion blocker (`requirements`). */
export function progress(content: ChecklistContent, answers: Answers): ExecutionProgress {
  const visible = visibleItems(content, answers);
  return {
    answered: visible.filter((v) => isAnswered(v.item, answers[v.item.id])).length,
    total: visible.length,
    requiredMissing: requirements(content, answers).length,
  };
}

/**
 * Problems of visible items (FR-13.01–03, spec §4): rule problems from `computeScore`, then manual ones.
 * Pure, so the phone and the API derive exactly the same list.
 */
export function deriveProblems(content: ChecklistContent, answers: Answers): DerivedProblem[] {
  const ruleSeverity = new Map(computeScore(content, answers).problems.map((p) => [p.itemId, p.severity]));
  const out: DerivedProblem[] = [];
  for (const { item } of visibleItems(content, answers)) {
    const a = answers[item.id];
    const severity = ruleSeverity.get(item.id);
    if (severity) {
      out.push({ itemId: item.id, source: 'rule', severity, note: a?.note?.trim() || null, mediaIds: [...(a?.photos ?? []), ...(a?.videos ?? [])] });
    }
    if (a?.problem) {
      out.push({ itemId: item.id, source: 'manual', severity: a.problem.severity, note: a.problem.note, mediaIds: [...a.problem.mediaIds] });
    }
  }
  return out;
}
