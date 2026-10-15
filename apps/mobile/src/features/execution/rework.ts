import { type Answers, type ChecklistContent, isAnswered, requirements, type ReworkRequest, visibleItems } from '@taskop/contracts';

/** The manager's comment per flagged item (spec §8.1). */
export function reworkComments(rework: ReworkRequest | null): ReadonlyMap<string, string> {
  return new Map((rework?.items ?? []).map((i) => [i.itemId, i.comment]));
}

/** Whether a round's due date has passed: it turns red, and nothing else happens (spec §3.2). */
export function reworkOverdue(rework: Pick<ReworkRequest, 'dueAt'>, now: number): boolean {
  return rework.dueAt !== null && now >= Date.parse(rework.dueAt);
}

/** Spec decision 7: the visible editable items (flagged and revealed), and how many of them are answered with nothing missing. */
export function reworkProgress(content: ChecklistContent, answers: Answers, editable: ReadonlySet<string>): { done: number; total: number } {
  const missing = new Set(requirements(content, answers).map((m) => m.itemId));
  const shown = visibleItems(content, answers).filter((v) => editable.has(v.item.id));
  return { total: shown.length, done: shown.filter((v) => isAnswered(v.item, answers[v.item.id]) && !missing.has(v.item.id)).length };
}
