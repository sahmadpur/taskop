import { z } from 'zod';

export const CONTENT_LIMITS = {
  sections: 50,
  items: 500,
  options: 50,
  rulesPerItem: 20,
  followUpDepth: 3,
  contentBytes: 1_000_000,
  title: 200,
  label: 500,
  optionLabel: 200,
  helpText: 2000,
  sectionInstructions: 2000,
  instructions: 5000,
  unit: 20,
} as const;
/** Raw JSON nesting allowed before schema parsing (depth-3 follow-ups need ~22). */
const MAX_JSON_DEPTH = 40;

export const ITEM_TYPES = ['yes_no', 'confirm_deny', 'single_choice', 'multi_choice', 'number', 'text', 'comment', 'photo', 'video', 'datetime'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export const CHOICE_ITEM_TYPES = ['yes_no', 'confirm_deny', 'single_choice', 'multi_choice'] as const;
export const RULE_ITEM_TYPES = [...CHOICE_ITEM_TYPES, 'number'] as const;
export const EVIDENCE_LEVELS = ['none', 'optional', 'required'] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];
export const PROBLEM_SEVERITIES = ['normal', 'critical'] as const;
export type ProblemSeverity = (typeof PROBLEM_SEVERITIES)[number];
export const NUMBER_OPS = ['lt', 'lte', 'gt', 'gte', 'eq'] as const;
export type NumberOp = (typeof NUMBER_OPS)[number];
export const RANGE_OPS = ['between', 'outside'] as const;
export type RangeOp = (typeof RANGE_OPS)[number];
export const DATETIME_MODES = ['date', 'time', 'datetime'] as const;
export type DateTimeMode = (typeof DATETIME_MODES)[number];

export interface Evidence {
  photo: EvidenceLevel;
  video: EvidenceLevel;
  /** Camera only: the gallery is blocked during execution (FR-12.05–06). */
  liveOnly: boolean;
}
export interface ChoiceOption {
  id: string;
  label: string;
}
export type RuleCondition =
  | { kind: 'options'; optionIds: string[] }
  | { kind: 'number'; op: NumberOp; value: number }
  | { kind: 'range'; op: RangeOp; min: number; max: number };
export interface RuleEffect {
  problem: ProblemSeverity | null;
  requireNote: boolean;
  requirePhoto: boolean;
  requireVideo: boolean;
  followUps: Item[];
}
export interface Rule {
  id: string;
  when: RuleCondition;
  then: RuleEffect;
}
interface ItemBase {
  id: string;
  label: string;
  helpText: string | null;
  required: boolean;
  weight: number;
  evidence: Evidence;
}
export interface YesNoItem extends ItemBase {
  type: 'yes_no';
  options: [{ id: string; key: 'yes' }, { id: string; key: 'no' }];
  rules: Rule[];
}
export interface ConfirmDenyItem extends ItemBase {
  type: 'confirm_deny';
  options: [{ id: string; key: 'confirm' }, { id: string; key: 'deny' }];
  rules: Rule[];
}
export interface SingleChoiceItem extends ItemBase {
  type: 'single_choice';
  options: ChoiceOption[];
  rules: Rule[];
}
export interface MultiChoiceItem extends ItemBase {
  type: 'multi_choice';
  options: ChoiceOption[];
  rules: Rule[];
}
export interface NumberItem extends ItemBase {
  type: 'number';
  unit: string | null;
  min: number | null;
  max: number | null;
  decimals: number;
  rules: Rule[];
}
export interface TextItem extends ItemBase {
  type: 'text';
  maxLength: number;
}
export interface CommentItem extends ItemBase {
  type: 'comment';
  maxLength: number;
}
export interface PhotoItem extends ItemBase {
  type: 'photo';
  minCount: number;
  maxCount: number;
}
export interface VideoItem extends ItemBase {
  type: 'video';
  minCount: number;
  maxCount: number;
}
export interface DateTimeItem extends ItemBase {
  type: 'datetime';
  mode: DateTimeMode;
}
export type RuleItem = YesNoItem | ConfirmDenyItem | SingleChoiceItem | MultiChoiceItem | NumberItem;
export type Item = RuleItem | TextItem | CommentItem | PhotoItem | VideoItem | DateTimeItem;
export interface Section {
  id: string;
  title: string;
  instructions: string | null;
  items: Item[];
}
export interface ChecklistContent {
  schemaVersion: 1;
  instructions: string | null;
  scoring: { enabled: boolean; problemsReduceScore: boolean };
  sections: Section[];
}

export interface ContentIssue {
  path: (string | number)[];
  code: string;
}
export const contentIssueSchema = z.object({ path: z.array(z.union([z.string(), z.number()])), code: z.string() });

export const hasRules = (item: Item): item is RuleItem => 'rules' in item;

export interface ItemLocation {
  path: (string | number)[];
  depth: number;
  sectionIndex: number;
  parent: RuleItem | null;
}

/** Visits every item depth-first: an item, then its rules' follow-ups in rule order. */
export function walkItems(content: Pick<ChecklistContent, 'sections'>, fn: (item: Item, at: ItemLocation) => void): void {
  const visit = (items: Item[], base: (string | number)[], depth: number, sectionIndex: number, parent: RuleItem | null) =>
    items.forEach((item, i) => {
      const path = [...base, i];
      fn(item, { path, depth, sectionIndex, parent });
      if (hasRules(item)) {
        item.rules.forEach((rule, r) => visit(rule.then.followUps, [...path, 'rules', r, 'then', 'followUps'], depth + 1, sectionIndex, item));
      }
    });
  content.sections.forEach((s, si) => visit(s.items, ['sections', si, 'items'], 0, si, null));
}

export function countItems(content: Pick<ChecklistContent, 'sections'>): number {
  let n = 0;
  walkItems(content, () => n++);
  return n;
}

// ---- Zod schemas (structure + max lengths; non-empty checks live in validateForPublish) ----

const id = z.uuid();
const text = (max: number) => z.string().max(max);
const nullableText = (max: number) => z.string().max(max).nullable();
const evidenceSchema = z.object({ photo: z.enum(EVIDENCE_LEVELS), video: z.enum(EVIDENCE_LEVELS), liveOnly: z.boolean() });
const base = {
  id,
  label: text(CONTENT_LIMITS.label),
  helpText: nullableText(CONTENT_LIMITS.helpText),
  required: z.boolean(),
  weight: z.number().min(0).max(100),
  evidence: evidenceSchema,
};
const choiceOptions = z.array(z.object({ id, label: text(CONTENT_LIMITS.optionLabel) })).max(CONTENT_LIMITS.options);
const ruleConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('options'), optionIds: z.array(id).max(CONTENT_LIMITS.options) }),
  z.object({ kind: z.literal('number'), op: z.enum(NUMBER_OPS), value: z.number() }),
  z.object({ kind: z.literal('range'), op: z.enum(RANGE_OPS), min: z.number(), max: z.number() }),
]);
const ruleSchema: z.ZodType<Rule> = z.lazy(() =>
  z.object({
    id,
    when: ruleConditionSchema,
    then: z.object({
      problem: z.enum(PROBLEM_SEVERITIES).nullable(),
      requireNote: z.boolean(),
      requirePhoto: z.boolean(),
      requireVideo: z.boolean(),
      followUps: z.array(itemSchema),
    }),
  }),
);
const rules = z.array(ruleSchema).max(CONTENT_LIMITS.rulesPerItem);
const count = (max: number) => z.number().int().min(0).max(max);

export const itemSchema: z.ZodType<Item> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ ...base, type: z.literal('yes_no'), options: z.tuple([z.object({ id, key: z.literal('yes') }), z.object({ id, key: z.literal('no') })]), rules }),
    z.object({ ...base, type: z.literal('confirm_deny'), options: z.tuple([z.object({ id, key: z.literal('confirm') }), z.object({ id, key: z.literal('deny') })]), rules }),
    z.object({ ...base, type: z.literal('single_choice'), options: choiceOptions, rules }),
    z.object({ ...base, type: z.literal('multi_choice'), options: choiceOptions, rules }),
    z.object({
      ...base,
      type: z.literal('number'),
      unit: nullableText(CONTENT_LIMITS.unit),
      min: z.number().nullable(),
      max: z.number().nullable(),
      decimals: z.number().int().min(0).max(4),
      rules,
    }),
    z.object({ ...base, type: z.literal('text'), maxLength: z.number().int().min(1).max(500) }),
    z.object({ ...base, type: z.literal('comment'), maxLength: z.number().int().min(1).max(5000) }),
    z.object({ ...base, type: z.literal('photo'), minCount: count(20), maxCount: z.number().int().min(1).max(20) }),
    z.object({ ...base, type: z.literal('video'), minCount: count(5), maxCount: z.number().int().min(1).max(5) }),
    z.object({ ...base, type: z.literal('datetime'), mode: z.enum(DATETIME_MODES) }),
  ]),
);

const sectionSchema = z.object({
  id,
  title: text(CONTENT_LIMITS.title),
  instructions: nullableText(CONTENT_LIMITS.sectionInstructions),
  items: z.array(itemSchema),
});

export const checklistContentSchema: z.ZodType<ChecklistContent> = z
  .object({
    schemaVersion: z.literal(1),
    instructions: nullableText(CONTENT_LIMITS.instructions),
    scoring: z.object({ enabled: z.boolean(), problemsReduceScore: z.boolean() }),
    sections: z.array(sectionSchema).max(CONTENT_LIMITS.sections),
  })
  .superRefine((c, ctx) => {
    let total = 0;
    walkItems(c, (_item, at) => {
      total++;
      if (at.depth > CONTENT_LIMITS.followUpDepth) ctx.addIssue({ code: 'custom', path: at.path, message: 'checklists.issues.tooDeep' });
    });
    if (total > CONTENT_LIMITS.items) ctx.addIssue({ code: 'custom', path: ['sections'], message: 'checklists.issues.tooManyItems' });
  });

/** Iterative, so hostile nesting can't overflow the stack before Zod (which recurses) sees it. */
function jsonDepthExceeds(value: unknown, max: number): boolean {
  const stack: Array<[unknown, number]> = [[value, 1]];
  while (stack.length) {
    const [v, d] = stack.pop()!;
    if (v === null || typeof v !== 'object') continue;
    if (d > max) return true;
    for (const child of Array.isArray(v) ? v : Object.values(v)) stack.push([child, d + 1]);
  }
  return false;
}

export type ParseContentResult = { success: true; content: ChecklistContent } | { success: false; issues: ContentIssue[] };

/** Lenient (draft) validation: structure, types and limits. Strict checks: `validateForPublish`. */
export function parseDraftContent(raw: unknown): ParseContentResult {
  if (jsonDepthExceeds(raw, MAX_JSON_DEPTH)) return { success: false, issues: [{ path: [], code: 'checklists.issues.tooDeep' }] };
  const r = checklistContentSchema.safeParse(raw);
  if (r.success) return { success: true, content: r.data };
  return {
    success: false,
    issues: r.error.issues.slice(0, 100).map((i) => ({
      path: i.path.map((p) => (typeof p === 'number' ? p : String(p))),
      code: /^(errors|checklists)\./.test(i.message) ? i.message : 'errors.validation.invalid',
    })),
  };
}

// ---- Factories (used by the API for blank content and by the web builder) ----

const uid = (): string => globalThis.crypto.randomUUID();
const defaultEvidence = (): Evidence => ({ photo: 'none', video: 'none', liveOnly: false });

export function newItem(type: ItemType): Item {
  const b = { id: uid(), label: '', helpText: null, required: true, weight: 1, evidence: defaultEvidence() };
  switch (type) {
    case 'yes_no':
      return { ...b, type, options: [{ id: uid(), key: 'yes' }, { id: uid(), key: 'no' }], rules: [] };
    case 'confirm_deny':
      return { ...b, type, options: [{ id: uid(), key: 'confirm' }, { id: uid(), key: 'deny' }], rules: [] };
    case 'single_choice':
    case 'multi_choice':
      return { ...b, type, options: [{ id: uid(), label: '' }, { id: uid(), label: '' }], rules: [] };
    case 'number':
      return { ...b, type, unit: null, min: null, max: null, decimals: 0, rules: [] };
    case 'text':
      return { ...b, type, maxLength: 500 };
    case 'comment':
      return { ...b, type, maxLength: 5000 };
    case 'photo':
      return { ...b, type, minCount: 1, maxCount: 5 };
    case 'video':
      return { ...b, type, minCount: 1, maxCount: 1 };
    case 'datetime':
      return { ...b, type, mode: 'datetime' };
  }
}

export const newSection = (title = ''): Section => ({ id: uid(), title, instructions: null, items: [] });

export const newRule = (item: RuleItem): Rule => ({
  id: uid(),
  when: item.type === 'number' ? { kind: 'number', op: 'lt', value: 0 } : { kind: 'options', optionIds: [] },
  then: { problem: null, requireNote: false, requirePhoto: false, requireVideo: false, followUps: [] },
});

export const blankContent = (): ChecklistContent => ({
  schemaVersion: 1,
  instructions: null,
  scoring: { enabled: true, problemsReduceScore: true },
  sections: [newSection()],
});
