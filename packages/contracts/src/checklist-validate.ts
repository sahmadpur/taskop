import { type ChecklistContent, type ContentIssue, hasRules, walkItems } from './checklist-content.js';

export const ISSUE_CODES = [
  'tooDeep', 'tooManyItems', 'noSections', 'noItems', 'titleRequired', 'labelRequired', 'tooFewOptions',
  'optionLabelRequired', 'duplicateOptionLabel', 'unknownOption', 'ruleNoOptions', 'ruleKindMismatch',
  'rangeInvalid', 'ruleOutOfRange', 'duplicateId', 'mediaCountInvalid', 'requiredMediaMin',
] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];

/** Strict checks a draft must pass before it can be published. Empty array = publishable. */
export function validateForPublish(content: ChecklistContent): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const add = (path: (string | number)[], code: IssueCode) => issues.push({ path, code: `checklists.issues.${code}` });
  const ids = new Set<string>();
  const seen = (id: string, path: (string | number)[]) => {
    if (ids.has(id)) add(path, 'duplicateId');
    ids.add(id);
  };

  if (content.sections.length === 0) add(['sections'], 'noSections');
  content.sections.forEach((s, si) => {
    seen(s.id, ['sections', si, 'id']);
    if (!s.title.trim()) add(['sections', si, 'title'], 'titleRequired');
  });

  let itemCount = 0;
  walkItems(content, (item, at) => {
    itemCount++;
    const p = at.path;
    seen(item.id, [...p, 'id']);
    if (!item.label.trim()) add([...p, 'label'], 'labelRequired');
    if ('options' in item) item.options.forEach((o, oi) => seen(o.id, [...p, 'options', oi, 'id']));

    switch (item.type) {
      case 'single_choice':
      case 'multi_choice': {
        if (item.options.length < 2) add([...p, 'options'], 'tooFewOptions');
        const labels = new Set<string>();
        item.options.forEach((o, oi) => {
          const label = o.label.trim().toLocaleLowerCase('az');
          if (!label) add([...p, 'options', oi, 'label'], 'optionLabelRequired');
          else if (labels.has(label)) add([...p, 'options', oi, 'label'], 'duplicateOptionLabel');
          labels.add(label);
        });
        break;
      }
      case 'number':
        if (item.min !== null && item.max !== null && item.min > item.max) add([...p, 'max'], 'rangeInvalid');
        break;
      case 'photo':
      case 'video':
        if (item.minCount > item.maxCount) add([...p, 'maxCount'], 'mediaCountInvalid');
        if (item.required && item.minCount < 1) add([...p, 'minCount'], 'requiredMediaMin');
        break;
      default:
        break;
    }

    if (!hasRules(item)) return;
    item.rules.forEach((rule, ri) => {
      const rp = [...p, 'rules', ri];
      seen(rule.id, [...rp, 'id']);
      const w = rule.when;
      if (item.type === 'number') {
        if (w.kind === 'options') add([...rp, 'when'], 'ruleKindMismatch');
        else if (w.kind === 'range' && w.min > w.max) add([...rp, 'when'], 'rangeInvalid');
        else {
          const values = w.kind === 'number' ? [w.value] : [w.min, w.max];
          const outside = (v: number) => (item.min !== null && v < item.min) || (item.max !== null && v > item.max);
          if (values.some(outside)) add([...rp, 'when'], 'ruleOutOfRange');
        }
      } else if (w.kind !== 'options') {
        add([...rp, 'when'], 'ruleKindMismatch');
      } else {
        const own = new Set<string>(item.options.map((o) => o.id));
        if (w.optionIds.length === 0) add([...rp, 'when'], 'ruleNoOptions');
        else if (w.optionIds.some((id) => !own.has(id))) add([...rp, 'when'], 'unknownOption');
      }
    });
  });
  if (content.sections.length > 0 && itemCount === 0) add(['sections'], 'noItems');
  return issues;
}
