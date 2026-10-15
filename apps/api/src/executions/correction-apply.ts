import { type Answer, type Answers, type ChecklistContent, type CorrectAnswersParams, walkItems } from '@taskop/contracts';
import { AppError } from '../common/app-error';

/**
 * The answers after a manager's changes (Spec decision 2). An item's manual problem is always kept; `answer: null`
 * clears the rest of it. Photos and videos may only be removed: every medium must already be on that item.
 */
export function applyCorrection(content: ChecklistContent, before: Answers, changes: CorrectAnswersParams['changes']): Answers {
  const known = new Set<string>();
  walkItems(content, (item) => known.add(item.id));
  const after: Answers = { ...before };
  changes.forEach((change, i) => {
    if (!known.has(change.itemId)) throw new AppError('VALIDATION_FAILED', { fields: { [`changes.${i}.itemId`]: 'executions.issues.unknownItem' } });
    const old = before[change.itemId];
    if (change.answer) {
      for (const field of ['photos', 'videos'] as const) {
        const existing = new Set(old?.[field] ?? []);
        if ((change.answer[field] ?? []).some((id) => !existing.has(id))) {
          throw new AppError('MEDIA_NOT_CORRECTABLE', { fields: { [`changes.${i}.answer.${field}`]: 'errors.MEDIA_NOT_CORRECTABLE' } });
        }
      }
    }
    const next: Answer = { ...(change.answer ?? {}), ...(old?.problem ? { problem: old.problem } : {}) };
    if (Object.keys(next).length) after[change.itemId] = next;
    else delete after[change.itemId];
  });
  return after;
}
