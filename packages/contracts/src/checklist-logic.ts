import { type ChecklistContent, hasRules, type Item, type ProblemSeverity, type Rule, type RuleItem } from './checklist-content.js';

export interface Answer {
  optionIds?: string[];
  number?: number;
  text?: string;
  datetime?: string;
  photos?: string[];
  videos?: string[];
  note?: string;
}
export type Answers = Record<string, Answer | undefined>;
export interface VisibleItem {
  item: Item;
  sectionId: string;
  depth: number;
  parentId: string | null;
}
export type MissingKind = 'answer' | 'photo' | 'video' | 'note' | 'mediaCount';
export interface Missing {
  itemId: string;
  kind: MissingKind;
}
export interface ScoreResult {
  earned: number;
  possible: number;
  percent: number | null;
  problems: { itemId: string; severity: ProblemSeverity }[];
}

export function isAnswered(item: Item, a: Answer | undefined): boolean {
  if (!a) return false;
  switch (item.type) {
    case 'yes_no':
    case 'confirm_deny':
    case 'single_choice':
    case 'multi_choice':
      return (a.optionIds?.length ?? 0) > 0;
    case 'number':
      return typeof a.number === 'number' && Number.isFinite(a.number);
    case 'text':
    case 'comment':
      return !!a.text?.trim();
    case 'datetime':
      return !!a.datetime;
    case 'photo':
      return (a.photos?.length ?? 0) > 0;
    case 'video':
      return (a.videos?.length ?? 0) > 0;
  }
}

export function ruleMatches(rule: Rule, item: RuleItem, a: Answer | undefined): boolean {
  if (!a || !isAnswered(item, a)) return false;
  const w = rule.when;
  if (w.kind === 'options') return item.type !== 'number' && (a.optionIds ?? []).some((id) => w.optionIds.includes(id));
  if (item.type !== 'number') return false;
  const n = a.number!;
  if (w.kind === 'number') {
    switch (w.op) {
      case 'lt':
        return n < w.value;
      case 'lte':
        return n <= w.value;
      case 'gt':
        return n > w.value;
      case 'gte':
        return n >= w.value;
      case 'eq':
        return n === w.value;
    }
  }
  const inside = n >= w.min && n <= w.max;
  return w.op === 'between' ? inside : !inside;
}

const matchingRules = (item: Item, a: Answer | undefined): Rule[] => (hasRules(item) ? item.rules.filter((r) => ruleMatches(r, item, a)) : []);

export function visibleItems(content: ChecklistContent, answers: Answers): VisibleItem[] {
  const out: VisibleItem[] = [];
  const visit = (items: Item[], sectionId: string, depth: number, parentId: string | null) => {
    for (const item of items) {
      out.push({ item, sectionId, depth, parentId });
      for (const rule of matchingRules(item, answers[item.id])) visit(rule.then.followUps, sectionId, depth + 1, item.id);
    }
  };
  for (const s of content.sections) visit(s.items, s.id, 0, null);
  return out;
}

/** What still blocks completion (FR-08.06). Empty array = the checklist can be completed. */
export function requirements(content: ChecklistContent, answers: Answers): Missing[] {
  const missing: Missing[] = [];
  for (const { item } of visibleItems(content, answers)) {
    const a = answers[item.id];
    const add = (kind: MissingKind) => missing.push({ itemId: item.id, kind });
    if (!isAnswered(item, a)) {
      if (item.required) add('answer');
      continue;
    }
    if (item.type === 'photo' || item.type === 'video') {
      const n = (item.type === 'photo' ? a!.photos : a!.videos)?.length ?? 0;
      if (n < item.minCount) add('mediaCount');
      continue;
    }
    const rules = matchingRules(item, a);
    if ((item.evidence.photo === 'required' || rules.some((r) => r.then.requirePhoto)) && !a!.photos?.length) add('photo');
    if ((item.evidence.video === 'required' || rules.some((r) => r.then.requireVideo)) && !a!.videos?.length) add('video');
    if (rules.some((r) => r.then.requireNote) && !a!.note?.trim()) add('note');
  }
  return missing;
}

/**
 * Scored items: visible, answered, rule-capable items with at least one problem rule.
 * Each adds `weight` to possible, and to earned unless a matching rule flags a problem
 * (or problems don't reduce the score).
 */
export function computeScore(content: ChecklistContent, answers: Answers): ScoreResult {
  let earned = 0;
  let possible = 0;
  const problems: ScoreResult['problems'] = [];
  for (const { item } of visibleItems(content, answers)) {
    if (!hasRules(item)) continue;
    const a = answers[item.id];
    if (!isAnswered(item, a)) continue;
    const severities = matchingRules(item, a)
      .map((r) => r.then.problem)
      .filter((s): s is ProblemSeverity => s !== null);
    const severity = severities.includes('critical') ? 'critical' : (severities[0] ?? null);
    if (severity) problems.push({ itemId: item.id, severity });
    if (!item.rules.some((r) => r.then.problem !== null)) continue;
    possible += item.weight;
    if (!severity || !content.scoring.problemsReduceScore) earned += item.weight;
  }
  const percent = content.scoring.enabled && possible > 0 ? Math.round((earned / possible) * 1000) / 10 : null;
  return { earned, possible, percent, problems };
}
