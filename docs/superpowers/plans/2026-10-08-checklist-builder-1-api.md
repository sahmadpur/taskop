# Taskop Checklist Builder — Part 1: Contracts & API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the checklist content model (Zod schemas, validation, evaluation logic) to `@taskop/contracts`, and the checklists, tenant templates and global templates modules to the API, with DB-enforced immutability of published versions and platform-admin authoring.

**Architecture:** Each checklist version stores its content as one `jsonb` document validated by a Zod schema shared with web/mobile. `checklists` holds identity and status. `checklist_versions` holds one editable draft plus immutable published versions; a trigger rejects any change to a published row. Tenant routes and platform-in-tenant routes share the same services. Controllers come from a factory, and a `PlatformTenantInterceptor` opens the normal RLS tenant transaction for platform admins. Global templates live in a non-RLS table that tenants read only through a `published` view.

**Tech Stack:** Node 24, TypeScript 7, NestJS 12, nestjs-zod 5, Zod 4, Drizzle ORM 0.45 + drizzle-kit, PostgreSQL 18, Vitest 5, Testcontainers, supertest (all already in the repo).

**Spec:** `docs/superpowers/specs/2026-10-08-checklist-builder-design.md`

**This plan is Part 1 of 2:**
- Part 1 (this file): contracts, i18n strings for errors, permissions and issues, API, seed.
- Part 2: `docs/superpowers/plans/2026-10-08-checklist-builder-2-web.md`, covering the API client and web app. It can start once Tasks 1–5 of this plan are merged into the feature branch.

## Global Constraints

- The product name is **Taskop** everywhere. Packages are `@taskop/*`.
- Install new packages with `pnpm add <pkg>@latest`. This part needs no new packages.
- IDs are UUIDv7 for table rows. Content node IDs are `crypto.randomUUID()` (v4) and are stable across versions.
- Every tenant-owned table has `tenant_id uuid not null`, RLS `FORCE`d with the policy on `nullif(current_setting('app.tenant_id', true), '')::uuid`, and composite `(tenant_id, x_id)` foreign keys.
- Checklists and templates are never deleted. The only `DELETE` allowed is of a **draft** `checklist_versions` row.
- Published versions are immutable, enforced by the DB trigger `checklist_versions_immutable`.
- Content limits (spec §3, copied exactly):
  - ≤ 50 sections; ≤ 500 items in total, including follow-ups; follow-up depth ≤ 3; 2–50 options per choice item
  - serialised content ≤ 1 MB (1,000,000 bytes)
  - text lengths: title ≤ 200, label ≤ 500, help text ≤ 2,000, section instructions ≤ 2,000, checklist instructions ≤ 5,000
  - photo `maxCount` ≤ 20, video `maxCount` ≤ 5, number `decimals` 0–4, weight 0–100
- Permission keys: `checklists.view`, `checklists.manage`, `checklists.publish`, `templates.manage`.
  - Manager defaults: `checklists.view`, `checklists.manage`. Auditor: `checklists.view`. Admin: all. Owner: all at runtime. Worker: none.
- Every error body is `{ error: { code, messageKey, fields, retryAfterSeconds, requestId, issues?, currentRevision? } }`. `issues` is `{ path: (string|number)[], code: string }[]`, and each `code` is an i18n key (`checklists.issues.*` or `errors.validation.*`).
- Draft autosaves are **not** audited. Every other state change writes exactly one `audit_log` row in the same transaction.
- Azerbaijani (`az`) is the only locale.

## Review Focus

These are the five input classes most likely to bite users that no spec test names. Each line gives the task whose tests pin it.

1. **Two tabs editing the same draft:** the second save must get `409 CHECKLIST_DRAFT_CONFLICT` with `currentRevision`, never silently overwrite. Publishing with a stale revision must also be refused. Pinned in Task 7 (`stale revision on save and publish`).
2. **A rule that points at an option the author then deleted:** saving still works, because drafts are lenient, but publishing reports `checklists.issues.unknownOption` at the exact rule path. Pinned in Task 2.
3. **Malicious or accidental deep nesting:** a 1 MB body of nested follow-ups must return 422 `checklists.issues.tooDeep`, not crash the process with a stack overflow. Pinned in Task 1 (`rejects pathological nesting without recursion`).
4. **Copying a checklist or using a template:** the copy must get fresh node IDs, *and* its rules must still point at its own (new) option IDs. Otherwise every rule silently stops matching. Pinned in Task 3 and Task 8 (`copy keeps rules working`).
5. **Deactivated checklist opened in an old tab:** autosave, publish, start-draft and discard must all return `CHECKLIST_DEACTIVATED`. Reading, copying and save-as-template must still work. Pinned in Task 7.

---

## File Structure

```
packages/contracts/src/
  checklist-content.ts        types, Zod schemas, limits, walkItems, parseDraftContent, factories, countItems
  checklist-content.test.ts
  checklist-validate.ts       validateForPublish, ISSUE_CODES
  checklist-validate.test.ts
  checklist-ids.ts            regenerateIds, regenerateItemIds
  checklist-logic.ts          isAnswered, ruleMatches, visibleItems, requirements, computeScore
  checklist-logic.test.ts     (also covers checklist-ids)
  checklists.ts               checklist DTOs and inputs
  templates.ts                TEMPLATE_CATEGORIES, template DTOs and inputs
  errors.ts                   + 8 codes, + issues/currentRevision on the error body
  permissions.ts              + checklists/templates groups and role defaults
  index.ts                    + exports
packages/i18n/src/az/
  checklists.ts               issues, categories, item types (UI strings are added in Part 2)
  errors.ts, roles.ts, index.ts
apps/api/
  drizzle/0003_checklists.sql            (generated)
  drizzle/0004_checklists_security.sql   (custom: RLS, grants, view, trigger, FK, permission backfill)
  src/db/schema.ts                       + enums, 4 tables, 1 view, audit_log.tenant_id nullable
  src/db/db.service.ts                   + platformAdminId in the tenant context
  src/db/audit.service.ts                + actor from context, recordIn()
  src/common/app-error.ts                + details (issues, currentRevision)
  src/common/error.filter.ts             + writes details
  src/app.setup.ts                       + 1.5 MB JSON body limit
  src/platform/platform.module.ts        + exports PlatformGuard
  src/checklists/
    content.ts                           parseDraftOrThrow
    actor.ts                             actorColumns()
    mappers.ts                           row → DTO
    checklists.service.ts
    templates.service.ts
    global-templates.service.ts
    platform-tenant.interceptor.ts
    route-mode.ts                        tenant/platform decorator helpers for controller factories
    checklists.controller.ts             factory → TenantChecklistsController, PlatformTenantChecklistsController
    templates.controller.ts              factory → TenantTemplatesController, PlatformTenantTemplatesController
    global-templates.controller.ts
    dto.ts
    checklists.module.ts
  src/db/scripts/seed.ts                 + global templates and demo checklists
  src/db/scripts/seed-templates.ts       8 global template fixtures (Azerbaijani)
  test/checklists-db.test.ts, test/checklists.test.ts, test/templates.test.ts,
  test/global-templates.test.ts, test/isolation.test.ts (extended), test/roles.test.ts (updated)
```

---

### Task 1: Content model: types, schema, draft parsing, factories

**Files:**
- Create: `packages/contracts/src/checklist-content.ts`
- Test: `packages/contracts/src/checklist-content.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Produces (exact names used by every later task and by Part 2):
  - Types: `ChecklistContent`, `Section`, `Item`, `RuleItem`, `ItemType`, `Rule`, `RuleCondition`, `RuleEffect`, `Evidence`, `ChoiceOption`, `ContentIssue`, `ItemLocation`
  - Constants: `ITEM_TYPES`, `CHOICE_ITEM_TYPES`, `RULE_ITEM_TYPES`, `EVIDENCE_LEVELS`, `PROBLEM_SEVERITIES`, `NUMBER_OPS`, `RANGE_OPS`, `DATETIME_MODES`, `CONTENT_LIMITS`
  - Schemas: `checklistContentSchema`, `itemSchema`, `contentIssueSchema`
  - Functions:
    - `hasRules(item): item is RuleItem`
    - `walkItems(content, fn)`
    - `parseDraftContent(raw): { success: true; content } | { success: false; issues }`
    - `blankContent()`, `newSection(title?)`, `newItem(type)`, `newRule(item)`
    - `countItems(content): number`

- [ ] **Step 1: Write the failing test**

`packages/contracts/src/checklist-content.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  blankContent,
  type ChecklistContent,
  countItems,
  ITEM_TYPES,
  type Item,
  newItem,
  newRule,
  newSection,
  parseDraftContent,
  walkItems,
} from './index.js';

const withItems = (...items: Item[]): ChecklistContent => ({ ...blankContent(), sections: [{ ...newSection('S'), items }] });

function nest(depth: number): Item {
  const root = newItem('yes_no');
  let cur = root;
  for (let i = 0; i < depth; i++) {
    if (cur.type !== 'yes_no') throw new Error('unreachable');
    const rule = newRule(cur);
    const child = newItem('yes_no');
    rule.then.followUps.push(child);
    cur.rules.push(rule);
    cur = child;
  }
  return root;
}

describe('checklist content schema', () => {
  it('accepts every item type built by the factories', () => {
    const content = withItems(...ITEM_TYPES.map((t) => newItem(t)));
    const r = parseDraftContent(JSON.parse(JSON.stringify(content)));
    expect(r.success).toBe(true);
  });

  it('accepts a blank draft with empty labels (drafts are lenient)', () => {
    expect(parseDraftContent(blankContent()).success).toBe(true);
  });

  it('strips unknown keys', () => {
    const content = withItems(newItem('text'));
    const raw = JSON.parse(JSON.stringify(content));
    raw.sections[0].items[0].hack = 1;
    const r = parseDraftContent(raw);
    expect(r.success && 'hack' in r.content.sections[0]!.items[0]!).toBe(false);
  });

  it('reports issues with exact paths and i18n codes', () => {
    const content = withItems(newItem('text'));
    const raw = JSON.parse(JSON.stringify(content));
    raw.sections[0].items[0].label = 'x'.repeat(501);
    const r = parseDraftContent(raw);
    expect(r).toEqual({ success: false, issues: [{ path: ['sections', 0, 'items', 0, 'label'], code: 'errors.validation.tooLong' }] });
  });

  it('allows follow-ups three levels deep but not four', () => {
    expect(parseDraftContent(withItems(nest(3))).success).toBe(true);
    const r = parseDraftContent(withItems(nest(4)));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.issues.map((i) => i.code)).toContain('checklists.issues.tooDeep');
  });

  it('rejects pathological nesting without recursion', () => {
    let raw: unknown = {};
    for (let i = 0; i < 20_000; i++) raw = { x: [raw] };
    expect(parseDraftContent(raw)).toEqual({ success: false, issues: [{ path: [], code: 'checklists.issues.tooDeep' }] });
  });

  it('rejects more than 500 items', () => {
    const items = Array.from({ length: 501 }, () => newItem('text'));
    const r = parseDraftContent(withItems(...items));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.issues).toContainEqual({ path: ['sections'], code: 'checklists.issues.tooManyItems' });
  });

  it('only rule-capable types carry rules', () => {
    const raw = JSON.parse(JSON.stringify(withItems(newItem('text'))));
    raw.sections[0].items[0].rules = [];
    const r = parseDraftContent(raw);
    expect(r.success && 'rules' in r.content.sections[0]!.items[0]!).toBe(false);
  });

  it('walks items depth-first with paths and counts them', () => {
    const content = withItems(nest(2), newItem('text'));
    const seen: Array<[number, string]> = [];
    walkItems(content, (_item, at) => seen.push([at.depth, at.path.join('.')]));
    expect(seen).toEqual([
      [0, 'sections.0.items.0'],
      [1, 'sections.0.items.0.rules.0.then.followUps.0'],
      [2, 'sections.0.items.0.rules.0.then.followUps.0.rules.0.then.followUps.0'],
      [0, 'sections.0.items.1'],
    ]);
    expect(countItems(content)).toBe(4);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @taskop/contracts test -- checklist-content`
Expected: FAIL. The imports `blankContent`, `parseDraftContent` and the others don't exist yet.

- [ ] **Step 3: Implement `checklist-content.ts`**

```ts
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
```

The contracts package compiles with `lib: ["ES2023"]` (no DOM, no `@types/node`), so declare the two runtime globals it uses. Create `packages/contracts/src/runtime.d.ts`:
```ts
// Provided at runtime by Node ≥ 19 and browsers. React Native (Hermes) needs polyfills
// (e.g. expo-crypto / core-js structuredClone) before sub-project 4 calls these functions.
declare global {
  var crypto: { randomUUID(): string };
  function structuredClone<T>(value: T): T;
}
export {};
```

Add to `packages/contracts/src/index.ts`, after the `platform.js` line:
```ts
export * from './checklist-content.js';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @taskop/contracts test -- checklist-content`
Expected: PASS (9 tests).

If Zod's `discriminatedUnion` rejects the `z.tuple` option values as discriminators at runtime, that's the wrong diagnosis: the discriminator is `type`, which is a literal in every member. Check that every member has `type: z.literal(...)`.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @taskop/contracts typecheck`
Expected: no errors.

```bash
git add packages/contracts/src/checklist-content.ts packages/contracts/src/checklist-content.test.ts packages/contracts/src/runtime.d.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add checklist content schema, draft parsing and factories"
```

---

### Task 2: Strict validation for publishing

**Files:**
- Create: `packages/contracts/src/checklist-validate.ts`
- Test: `packages/contracts/src/checklist-validate.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `ChecklistContent`, `walkItems`, `hasRules` (Task 1).
- Produces:
  - `validateForPublish(content: ChecklistContent): ContentIssue[]`: empty means publishable.
  - `ISSUE_CODES: readonly string[]`: every `checklists.issues.*` key emitted by Tasks 1–2. The i18n test (Task 5) checks each one has a translation.

- [ ] **Step 1: Write the failing test**

`packages/contracts/src/checklist-validate.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { blankContent, type ChecklistContent, type Item, newItem, newRule, newSection, validateForPublish } from './index.js';

function valid(): ChecklistContent {
  const yn = newItem('yes_no');
  if (yn.type !== 'yes_no') throw new Error();
  yn.label = 'Döşəmə təmizdir?';
  const rule = newRule(yn);
  rule.when = { kind: 'options', optionIds: [yn.options[1].id] };
  rule.then.problem = 'critical';
  const follow = newItem('comment');
  follow.label = 'Problemi təsvir edin';
  rule.then.followUps.push(follow);
  yn.rules.push(rule);
  const choice = newItem('single_choice');
  if (choice.type !== 'single_choice') throw new Error();
  choice.label = 'Vəziyyət';
  choice.options[0]!.label = 'Yaxşı';
  choice.options[1]!.label = 'Pis';
  return { ...blankContent(), sections: [{ ...newSection('Zal'), items: [yn, choice] }] };
}
const codes = (c: ChecklistContent) => validateForPublish(c).map((i) => `${i.path.join('.')}:${i.code.replace('checklists.issues.', '')}`);
const first = (c: ChecklistContent) => c.sections[0]!.items[0]! as Extract<Item, { type: 'yes_no' }>;

describe('validateForPublish', () => {
  it('accepts a complete checklist', () => expect(validateForPublish(valid())).toEqual([]));

  it('requires sections, items, titles and labels', () => {
    expect(codes({ ...blankContent(), sections: [] })).toEqual(['sections:noSections']);
    expect(codes(blankContent())).toEqual(['sections.0.title:titleRequired', 'sections:noItems']);
    const c = valid();
    c.sections[0]!.items[0]!.label = '  ';
    expect(codes(c)).toEqual(['sections.0.items.0.label:labelRequired']);
  });

  it('checks choice options', () => {
    const c = valid();
    const choice = c.sections[0]!.items[1]!;
    if (choice.type !== 'single_choice') throw new Error();
    choice.options[1]!.label = ' yaxşı ';
    expect(codes(c)).toEqual(['sections.0.items.1.options.1.label:duplicateOptionLabel']);
    choice.options = [choice.options[0]!];
    expect(codes(c)).toEqual(['sections.0.items.1.options:tooFewOptions']);
  });

  it('flags a rule that points at a removed option', () => {
    const c = valid();
    first(c).rules[0]!.when = { kind: 'options', optionIds: [crypto.randomUUID()] };
    expect(codes(c)).toEqual(['sections.0.items.0.rules.0.when:unknownOption']);
    first(c).rules[0]!.when = { kind: 'options', optionIds: [] };
    expect(codes(c)).toEqual(['sections.0.items.0.rules.0.when:ruleNoOptions']);
  });

  it('checks number ranges and rule kinds', () => {
    const c = valid();
    const n = newItem('number');
    if (n.type !== 'number') throw new Error();
    n.label = 'Temperatur';
    n.min = 0;
    n.max = 10;
    const r = newRule(n);
    r.when = { kind: 'range', op: 'outside', min: 2, max: 8 };
    n.rules.push(r);
    c.sections[0]!.items.push(n);
    expect(validateForPublish(c)).toEqual([]);
    r.when = { kind: 'range', op: 'between', min: 8, max: 2 };
    expect(codes(c)).toEqual(['sections.0.items.2.rules.0.when:rangeInvalid']);
    r.when = { kind: 'number', op: 'gt', value: 50 };
    expect(codes(c)).toEqual(['sections.0.items.2.rules.0.when:ruleOutOfRange']);
    r.when = { kind: 'options', optionIds: [] };
    expect(codes(c)).toEqual(['sections.0.items.2.rules.0.when:ruleKindMismatch']);
    r.when = { kind: 'number', op: 'gt', value: 5 };
    n.min = 20;
    expect(codes(c)).toEqual(['sections.0.items.2.max:rangeInvalid', 'sections.0.items.2.rules.0.when:ruleOutOfRange']);
  });

  it('checks media counts', () => {
    const c = valid();
    const p = newItem('photo');
    if (p.type !== 'photo') throw new Error();
    p.label = 'Şəkil';
    p.minCount = 0;
    c.sections[0]!.items.push(p);
    expect(codes(c)).toEqual(['sections.0.items.2.minCount:requiredMediaMin']);
    p.required = false;
    p.minCount = 6;
    expect(codes(c)).toEqual(['sections.0.items.2.maxCount:mediaCountInvalid']);
  });

  it('detects duplicate ids anywhere in the document', () => {
    const c = valid();
    c.sections[0]!.items[1]!.id = c.sections[0]!.items[0]!.id;
    expect(codes(c)).toEqual(['sections.0.items.1.id:duplicateId']);
  });

  it('validates follow-ups too', () => {
    const c = valid();
    first(c).rules[0]!.then.followUps[0]!.label = '';
    expect(codes(c)).toEqual(['sections.0.items.0.rules.0.then.followUps.0.label:labelRequired']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @taskop/contracts test -- checklist-validate`
Expected: FAIL. `validateForPublish` is not exported.

- [ ] **Step 3: Implement**

`packages/contracts/src/checklist-validate.ts`:
```ts
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
```

Note the issue order: section issues come first, then item issues in walk order, then `noItems`. The test expectations rely on this.

Add to `index.ts`:
```ts
export * from './checklist-validate.js';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @taskop/contracts test -- checklist-validate`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/checklist-validate.ts packages/contracts/src/checklist-validate.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add strict publish validation for checklist content"
```

---

### Task 3: ID regeneration and evaluation logic

**Files:**
- Create: `packages/contracts/src/checklist-ids.ts`, `packages/contracts/src/checklist-logic.ts`
- Test: `packages/contracts/src/checklist-logic.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: Task 1 types, `hasRules`, `walkItems`.
- Produces:
  - `regenerateIds(content: ChecklistContent): ChecklistContent`
  - `regenerateItemIds(item: Item): Item`: used by the builder's "duplicate"
  - `interface Answer { optionIds?: string[]; number?: number; text?: string; datetime?: string; photos?: string[]; videos?: string[]; note?: string }`
  - `type Answers = Record<string, Answer | undefined>`
  - `isAnswered(item, answer): boolean`
  - `ruleMatches(rule, item: RuleItem, answer): boolean`
  - `visibleItems(content, answers): VisibleItem[]`, where `VisibleItem = { item: Item; sectionId: string; depth: number; parentId: string | null }`
  - `requirements(content, answers): Missing[]`, where `Missing = { itemId: string; kind: 'answer' | 'photo' | 'video' | 'note' | 'mediaCount' }`
  - `computeScore(content, answers): ScoreResult`, where `ScoreResult = { earned: number; possible: number; percent: number | null; problems: { itemId: string; severity: ProblemSeverity }[] }`

- [ ] **Step 1: Write the failing test**

`packages/contracts/src/checklist-logic.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  type Answers,
  blankContent,
  type ChecklistContent,
  computeScore,
  newItem,
  newRule,
  newSection,
  type NumberItem,
  regenerateIds,
  requirements,
  ruleMatches,
  validateForPublish,
  visibleItems,
  walkItems,
  type YesNoItem,
} from './index.js';

function fixture() {
  const problem = newItem('yes_no') as YesNoItem;
  problem.label = 'Problem varmı?';
  problem.weight = 2;
  const [yes, no] = problem.options;
  const onYes = newRule(problem);
  onYes.when = { kind: 'options', optionIds: [yes.id] };
  onYes.then = { ...onYes.then, problem: 'critical', requirePhoto: true, requireNote: true };
  const describeIt = newItem('comment');
  describeIt.label = 'Təsvir';
  const deeper = newItem('yes_no') as YesNoItem;
  deeper.label = 'Təcili?';
  deeper.required = false;
  const deeperRule = newRule(deeper);
  deeperRule.when = { kind: 'options', optionIds: [deeper.options[0].id] };
  const call = newItem('text');
  call.label = 'Kimə zəng edildi?';
  deeperRule.then.followUps.push(call);
  deeper.rules.push(deeperRule);
  onYes.then.followUps.push(describeIt, deeper);
  problem.rules.push(onYes);

  const temp = newItem('number') as NumberItem;
  temp.label = 'Temperatur';
  const out = newRule(temp);
  out.when = { kind: 'range', op: 'outside', min: 2, max: 8 };
  out.then.problem = 'normal';
  temp.rules.push(out);

  const photo = newItem('photo');
  photo.label = 'Ümumi görünüş';
  photo.required = false;
  if (photo.type === 'photo') photo.minCount = 2;

  const content: ChecklistContent = { ...blankContent(), sections: [{ ...newSection('Zal'), items: [problem, temp, photo] }] };
  return { content, problem, yes, no, describeIt, deeper, call, temp, photo };
}

describe('visibleItems', () => {
  it('shows follow-ups only for matching answers, recursively', () => {
    const f = fixture();
    const ids = (a: Answers) => visibleItems(f.content, a).map((v) => `${v.depth}:${v.item.label}`);
    expect(ids({})).toEqual(['0:Problem varmı?', '0:Temperatur', '0:Ümumi görünüş']);
    expect(ids({ [f.problem.id]: { optionIds: [f.no.id] } })).toEqual(['0:Problem varmı?', '0:Temperatur', '0:Ümumi görünüş']);
    expect(ids({ [f.problem.id]: { optionIds: [f.yes.id] }, [f.deeper.id]: { optionIds: [f.deeper.options[0].id] } })).toEqual([
      '0:Problem varmı?', '1:Təsvir', '1:Təcili?', '2:Kimə zəng edildi?', '0:Temperatur', '0:Ümumi görünüş',
    ]);
  });

  it('matches number conditions', () => {
    const f = fixture();
    const rule = f.temp.rules[0]!;
    expect(ruleMatches(rule, f.temp, { number: 1.5 })).toBe(true);
    expect(ruleMatches(rule, f.temp, { number: 2 })).toBe(false);
    expect(ruleMatches(rule, f.temp, { number: 8 })).toBe(false);
    expect(ruleMatches(rule, f.temp, { number: 9 })).toBe(true);
    expect(ruleMatches(rule, f.temp, {})).toBe(false);
    for (const [op, value, n, expected] of [['lt', 5, 4, true], ['lte', 5, 5, true], ['gt', 5, 5, false], ['gte', 5, 5, true], ['eq', 5, 5, true]] as const) {
      expect(ruleMatches({ ...rule, when: { kind: 'number', op, value } }, f.temp, { number: n }), op).toBe(expected);
    }
    expect(ruleMatches({ ...rule, when: { kind: 'range', op: 'between', min: 2, max: 8 } }, f.temp, { number: 8 })).toBe(true);
  });

  it('matches multi-choice when any selected option is listed', () => {
    const m = newItem('multi_choice');
    if (m.type !== 'multi_choice') throw new Error();
    const r = newRule(m);
    r.when = { kind: 'options', optionIds: [m.options[1]!.id] };
    expect(ruleMatches(r, m, { optionIds: [m.options[0]!.id, m.options[1]!.id] })).toBe(true);
    expect(ruleMatches(r, m, { optionIds: [m.options[0]!.id] })).toBe(false);
  });
});

describe('requirements', () => {
  it('lists missing answers, rule evidence, notes and media counts', () => {
    const f = fixture();
    expect(requirements(f.content, {})).toEqual([
      { itemId: f.problem.id, kind: 'answer' },
      { itemId: f.temp.id, kind: 'answer' },
    ]);
    const a: Answers = { [f.problem.id]: { optionIds: [f.yes.id] }, [f.temp.id]: { number: 5 }, [f.photo.id]: { photos: ['p1'] } };
    expect(requirements(f.content, a)).toEqual([
      { itemId: f.problem.id, kind: 'photo' },
      { itemId: f.problem.id, kind: 'note' },
      { itemId: f.describeIt.id, kind: 'answer' },
      { itemId: f.photo.id, kind: 'mediaCount' },
    ]);
    a[f.problem.id] = { optionIds: [f.yes.id], photos: ['x'], note: 'Su axır' };
    a[f.describeIt.id] = { text: 'Kran sınıb' };
    a[f.photo.id] = { photos: ['p1', 'p2'] };
    expect(requirements(f.content, a)).toEqual([]);
  });

  it('ignores hidden follow-ups and item-level required evidence until answered', () => {
    const f = fixture();
    f.temp.evidence.photo = 'required';
    const a: Answers = { [f.problem.id]: { optionIds: [f.no.id] } };
    expect(requirements(f.content, a)).toEqual([{ itemId: f.temp.id, kind: 'answer' }]);
    a[f.temp.id] = { number: 4 };
    expect(requirements(f.content, a)).toEqual([{ itemId: f.temp.id, kind: 'photo' }]);
  });
});

describe('computeScore', () => {
  it('weights items that have problem rules and lists problems', () => {
    const f = fixture();
    const a: Answers = { [f.problem.id]: { optionIds: [f.yes.id] }, [f.temp.id]: { number: 5 } };
    expect(computeScore(f.content, a)).toEqual({ earned: 1, possible: 3, percent: 33.3, problems: [{ itemId: f.problem.id, severity: 'critical' }] });
    a[f.problem.id] = { optionIds: [f.no.id] };
    expect(computeScore(f.content, a)).toMatchObject({ earned: 3, possible: 3, percent: 100, problems: [] });
  });

  it('respects problemsReduceScore and enabled', () => {
    const f = fixture();
    const a: Answers = { [f.temp.id]: { number: 20 } };
    f.content.scoring.problemsReduceScore = false;
    expect(computeScore(f.content, a)).toEqual({ earned: 1, possible: 1, percent: 100, problems: [{ itemId: f.temp.id, severity: 'normal' }] });
    f.content.scoring.enabled = false;
    expect(computeScore(f.content, a).percent).toBeNull();
    expect(computeScore(f.content, {}).percent).toBeNull();
  });
});

describe('regenerateIds', () => {
  it('replaces every id and keeps rules pointing at their own options', () => {
    const f = fixture();
    const copy = regenerateIds(f.content);
    const oldIds = new Set<string>();
    walkItems(f.content, (i) => oldIds.add(i.id));
    walkItems(copy, (i) => expect(oldIds.has(i.id)).toBe(false));
    expect(copy.sections[0]!.id).not.toBe(f.content.sections[0]!.id);
    expect(validateForPublish(copy)).toEqual([]);
    const p = copy.sections[0]!.items[0]! as YesNoItem;
    expect(visibleItems(copy, { [p.id]: { optionIds: [p.options[0].id] } })).toHaveLength(5);
    expect(f.content.sections[0]!.items[0]!.id).toBe(f.problem.id);
  });
});
```

The fixture marks `problem` and `temp` as required (factory default) and `photo` as optional.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @taskop/contracts test -- checklist-logic`
Expected: FAIL. `computeScore` and `regenerateIds` are not exported.

- [ ] **Step 3: Implement `checklist-ids.ts`**

```ts
import { type ChecklistContent, hasRules, type Item } from './checklist-content.js';

const uid = (): string => globalThis.crypto.randomUUID();

function remap(item: Item): Item {
  const optionMap = new Map<string, string>();
  const next = { ...item, id: uid() } as Item;
  if ('options' in next) {
    (next as { options: Array<{ id: string }> }).options = next.options.map((o) => {
      const id = uid();
      optionMap.set(o.id, id);
      return { ...o, id };
    });
  }
  if (hasRules(next)) {
    next.rules = next.rules.map((r) => ({
      id: uid(),
      when: r.when.kind === 'options' ? { kind: 'options', optionIds: r.when.optionIds.map((id) => optionMap.get(id) ?? id) } : { ...r.when },
      then: { ...r.then, followUps: r.then.followUps.map(remap) },
    }));
  }
  return next;
}

/** Deep copy of one item with fresh ids for it, its options, rules and follow-ups (rule → option links kept). */
export const regenerateItemIds = (item: Item): Item => remap(structuredClone(item));

/** Deep copy with fresh ids everywhere: used for copies, templates and save-as-template. */
export function regenerateIds(content: ChecklistContent): ChecklistContent {
  const c = structuredClone(content);
  return { ...c, sections: c.sections.map((s) => ({ ...s, id: uid(), items: s.items.map(remap) })) };
}
```

- [ ] **Step 4: Implement `checklist-logic.ts`**

```ts
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
```

Add to `index.ts`:
```ts
export * from './checklist-ids.js';
export * from './checklist-logic.js';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @taskop/contracts test`
Expected: PASS for all contracts tests.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/checklist-ids.ts packages/contracts/src/checklist-logic.ts packages/contracts/src/checklist-logic.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add checklist evaluation logic and id regeneration"
```

---

### Task 4: Checklist and template DTOs, permissions, error codes

**Files:**
- Create: `packages/contracts/src/checklists.ts`, `packages/contracts/src/templates.ts`
- Modify: `packages/contracts/src/permissions.ts`, `packages/contracts/src/errors.ts`, `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/resources.test.ts` (append)

**Interfaces:**
- Consumes: `checklistContentSchema`, `contentIssueSchema` (Task 1).
- Produces:
  - `TEMPLATE_CATEGORIES`, `TemplateCategory`, `templateCategorySchema`
  - `checklistStatusSchema` (`'active' | 'deactivated'`)
  - `checklistSummarySchema` / `ChecklistSummary`: `{ id, name, description, category, status, currentVersionNumber, draftRevision, updatedAt }`
  - `checklistVersionSummarySchema` / `ChecklistVersionSummary`: `{ id, number, state, changeNote, publishedAt, publishedBy, createdAt }`, where `publishedBy: { kind: 'user' | 'platform'; name: string | null } | null`
  - `checklistDetailSchema` / `ChecklistDetail` = summary + `{ currentVersionId, source, versions }`, where `source: { kind: 'global' | 'tenant' | 'version'; id: string } | null`
  - `checklistVersionSchema` / `ChecklistVersion` = version summary + `{ checklistId, revision, content }`
  - `contentSaveResultSchema` / `ContentSaveResult` = `{ revision, issues }`
  - Inputs:
    - `createChecklistInputSchema`: `from?: { kind: 'global' | 'tenant'; templateId } | { kind: 'version'; versionId }`
    - `updateChecklistInputSchema`, `startDraftInputSchema`, `saveContentInputSchema` (`{ content: unknown, revision }`), `publishInputSchema`, `checklistListQuerySchema`
  - Templates:
    - `templateSummarySchema` / `TemplateSummary`: `{ id, source: 'global' | 'tenant', name, description, category, status, itemCount, updatedAt }`
    - `templateSchema` / `TemplateDto` = summary + `{ revision, content }`
    - `globalTemplateSummarySchema` / `GlobalTemplateSummary`: `{ id, name, description, category, published, sortOrder, itemCount, updatedAt }`
    - `globalTemplateSchema` / `GlobalTemplateDto` = + `{ revision, content }`
    - `createTemplateInputSchema`, `updateTemplateInputSchema`, `updateGlobalTemplateInputSchema`, `saveAsTemplateInputSchema`, `templateListQuerySchema`
  - Error codes: `CHECKLIST_NO_DRAFT` (404), `CHECKLIST_DRAFT_EXISTS` (409), `CHECKLIST_DRAFT_CONFLICT` (409), `CHECKLIST_INVALID_CONTENT` (422), `CHECKLIST_CONTENT_TOO_LARGE` (413), `CHECKLIST_DEACTIVATED` (409), `TEMPLATE_CONFLICT` (409), `TEMPLATE_DEACTIVATED` (409).
  - The error body gains optional `issues` and `currentRevision`.
  - Deviation from spec §6.4: missing checklists, versions and templates return the existing `NOT_FOUND`, not `CHECKLIST_NOT_FOUND`/`TEMPLATE_NOT_FOUND`. This keeps the 404 contract the isolation suite already asserts (`ParseIdPipe` also throws `NOT_FOUND`).

- [ ] **Step 1: Write the failing test**

Append to `packages/contracts/src/resources.test.ts`:
```ts
import {
  ALL_PERMISSIONS,
  createChecklistInputSchema,
  errorBodySchema,
  ERROR_HTTP_STATUS,
  SYSTEM_ROLE_DEFAULTS,
  templateCategorySchema,
} from './index.js';

describe('checklist contracts', () => {
  it('adds the checklist permissions and role defaults', () => {
    expect(ALL_PERMISSIONS).toEqual(expect.arrayContaining(['checklists.view', 'checklists.manage', 'checklists.publish', 'templates.manage']));
    expect(SYSTEM_ROLE_DEFAULTS.manager.permissions).toEqual(expect.arrayContaining(['checklists.view', 'checklists.manage']));
    expect(SYSTEM_ROLE_DEFAULTS.manager.permissions).not.toContain('checklists.publish');
    expect(SYSTEM_ROLE_DEFAULTS.auditor.permissions).toContain('checklists.view');
    expect(SYSTEM_ROLE_DEFAULTS.worker.permissions).toEqual([]);
  });

  it('parses create input with each source kind', () => {
    const id = '0190a4d2-7c3e-7000-8000-000000000001';
    expect(createChecklistInputSchema.parse({ name: ' Yoxlama ' })).toEqual({ name: 'Yoxlama' });
    expect(createChecklistInputSchema.parse({ name: 'A', from: { kind: 'global', templateId: id } }).from).toEqual({ kind: 'global', templateId: id });
    expect(createChecklistInputSchema.parse({ name: 'A', from: { kind: 'version', versionId: id } }).from).toEqual({ kind: 'version', versionId: id });
    expect(createChecklistInputSchema.safeParse({ name: 'A', from: { kind: 'version', templateId: id } }).success).toBe(false);
  });

  it('knows the categories', () => {
    expect(templateCategorySchema.options).toEqual(['cleaning', 'restaurant', 'retail', 'safety', 'production', 'warehouse', 'quality', 'maintenance', 'other']);
  });

  it('carries issues and currentRevision on errors', () => {
    expect(ERROR_HTTP_STATUS.CHECKLIST_INVALID_CONTENT).toBe(422);
    expect(ERROR_HTTP_STATUS.CHECKLIST_CONTENT_TOO_LARGE).toBe(413);
    const body = { error: { code: 'CHECKLIST_DRAFT_CONFLICT', messageKey: 'errors.CHECKLIST_DRAFT_CONFLICT', fields: null, retryAfterSeconds: null, requestId: null, currentRevision: 4 } };
    expect(errorBodySchema.parse(body).error.currentRevision).toBe(4);
  });
});
```

If `resources.test.ts` already imports from `./index.js`, merge these names into that import rather than adding a second import line.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @taskop/contracts test -- resources`
Expected: FAIL. `createChecklistInputSchema` is undefined.

- [ ] **Step 3: Update permissions**

In `packages/contracts/src/permissions.ts`, extend `PERMISSION_GROUPS` (keep order; append):
```ts
  { group: 'audit', keys: ['audit.view'] },
  { group: 'checklists', keys: ['checklists.view', 'checklists.manage', 'checklists.publish'] },
  { group: 'templates', keys: ['templates.manage'] },
] as const;
```
and update the defaults:
```ts
  manager: {
    name: 'Manager',
    dataScope: 'site_subtree',
    permissions: ['sites.view', 'teams.view', 'users.view', 'checklists.view', 'checklists.manage'],
    editable: true,
  },
  worker: { name: 'Worker', dataScope: 'own', permissions: [], editable: true },
  auditor: { name: 'Auditor', dataScope: 'all', permissions: ['sites.view', 'users.view', 'audit.view', 'checklists.view'], editable: true },
```

- [ ] **Step 4: Update errors**

In `packages/contracts/src/errors.ts`, add to `ErrorCode` (before `INTERNAL`):
```ts
  CHECKLIST_NO_DRAFT: 'CHECKLIST_NO_DRAFT',
  CHECKLIST_DRAFT_EXISTS: 'CHECKLIST_DRAFT_EXISTS',
  CHECKLIST_DRAFT_CONFLICT: 'CHECKLIST_DRAFT_CONFLICT',
  CHECKLIST_INVALID_CONTENT: 'CHECKLIST_INVALID_CONTENT',
  CHECKLIST_CONTENT_TOO_LARGE: 'CHECKLIST_CONTENT_TOO_LARGE',
  CHECKLIST_DEACTIVATED: 'CHECKLIST_DEACTIVATED',
  TEMPLATE_CONFLICT: 'TEMPLATE_CONFLICT',
  TEMPLATE_DEACTIVATED: 'TEMPLATE_DEACTIVATED',
```
to `ERROR_HTTP_STATUS`:
```ts
  CHECKLIST_NO_DRAFT: 404,
  CHECKLIST_DRAFT_EXISTS: 409,
  CHECKLIST_DRAFT_CONFLICT: 409,
  CHECKLIST_INVALID_CONTENT: 422,
  CHECKLIST_CONTENT_TOO_LARGE: 413,
  CHECKLIST_DEACTIVATED: 409,
  TEMPLATE_CONFLICT: 409,
  TEMPLATE_DEACTIVATED: 409,
```
and extend `errorBodySchema` (add the import `import { contentIssueSchema } from './checklist-content.js';`):
```ts
export const errorBodySchema = z.object({
  error: z.object({
    code: z.enum(ErrorCode),
    messageKey: z.string(),
    fields: z.record(z.string(), z.string()).nullable(),
    retryAfterSeconds: z.number().int().nullable(),
    requestId: z.string().nullable(),
    issues: z.array(contentIssueSchema).optional(),
    currentRevision: z.number().int().optional(),
  }),
});
```

- [ ] **Step 5: Create `templates.ts`**

```ts
import { z } from 'zod';
import { checklistContentSchema } from './checklist-content.js';
import { idSchema, isoDateTimeSchema } from './common.js';

export const TEMPLATE_CATEGORIES = ['cleaning', 'restaurant', 'retail', 'safety', 'production', 'warehouse', 'quality', 'maintenance', 'other'] as const;
export const templateCategorySchema = z.enum(TEMPLATE_CATEGORIES);
export type TemplateCategory = z.infer<typeof templateCategorySchema>;
export const templateSourceSchema = z.enum(['global', 'tenant']);
export type TemplateSource = z.infer<typeof templateSourceSchema>;
const statusSchema = z.enum(['active', 'deactivated']);

const name = z.string().trim().min(1).max(200);
const description = z.string().trim().max(2000).nullable();

export const templateSummarySchema = z.object({
  id: idSchema,
  source: templateSourceSchema,
  name: z.string(),
  description: z.string().nullable(),
  category: templateCategorySchema,
  status: statusSchema,
  itemCount: z.number().int(),
  updatedAt: isoDateTimeSchema,
});
export type TemplateSummary = z.infer<typeof templateSummarySchema>;
export const templateSchema = templateSummarySchema.extend({ revision: z.number().int(), content: checklistContentSchema });
export type TemplateDto = z.infer<typeof templateSchema>;

export const globalTemplateSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  category: templateCategorySchema,
  published: z.boolean(),
  sortOrder: z.number().int(),
  itemCount: z.number().int(),
  updatedAt: isoDateTimeSchema,
});
export type GlobalTemplateSummary = z.infer<typeof globalTemplateSummarySchema>;
export const globalTemplateSchema = globalTemplateSummarySchema.extend({ revision: z.number().int(), content: checklistContentSchema });
export type GlobalTemplateDto = z.infer<typeof globalTemplateSchema>;

export const templateListQuerySchema = z.object({
  source: templateSourceSchema.optional(),
  category: templateCategorySchema.optional(),
  status: statusSchema.optional(),
  q: z.string().trim().max(100).optional(),
});
export type TemplateListQuery = z.input<typeof templateListQuerySchema>;

export const createTemplateInputSchema = z.object({
  name,
  description: description.optional(),
  category: templateCategorySchema,
  /** Omitted → blank content. Validated with the draft schema by the API. */
  content: z.unknown().optional(),
});
export type CreateTemplateInput = z.input<typeof createTemplateInputSchema>;

export const updateTemplateInputSchema = z.object({
  name: name.optional(),
  description: description.optional(),
  category: templateCategorySchema.optional(),
});
export type UpdateTemplateInput = z.input<typeof updateTemplateInputSchema>;

export const updateGlobalTemplateInputSchema = updateTemplateInputSchema.extend({ sortOrder: z.number().int().min(0).max(10_000).optional() });
export type UpdateGlobalTemplateInput = z.input<typeof updateGlobalTemplateInputSchema>;

export const saveAsTemplateInputSchema = z.object({ name, description: description.optional(), category: templateCategorySchema });
export type SaveAsTemplateInput = z.input<typeof saveAsTemplateInputSchema>;
```

- [ ] **Step 6: Create `checklists.ts`**

```ts
import { z } from 'zod';
import { checklistContentSchema, contentIssueSchema } from './checklist-content.js';
import { cursorQuerySchema, idSchema, isoDateTimeSchema } from './common.js';
import { templateCategorySchema } from './templates.js';

export const checklistStatusSchema = z.enum(['active', 'deactivated']);
export type ChecklistStatus = z.infer<typeof checklistStatusSchema>;
export const checklistVersionStateSchema = z.enum(['draft', 'published']);

export const checklistSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  category: templateCategorySchema.nullable(),
  status: checklistStatusSchema,
  /** null until the first publish. */
  currentVersionNumber: z.number().int().nullable(),
  /** Revision of the open draft, null when there is none. */
  draftRevision: z.number().int().nullable(),
  updatedAt: isoDateTimeSchema,
});
export type ChecklistSummary = z.infer<typeof checklistSummarySchema>;

export const actorRefSchema = z.object({ kind: z.enum(['user', 'platform']), name: z.string().nullable() });
export type ActorRef = z.infer<typeof actorRefSchema>;

export const checklistVersionSummarySchema = z.object({
  id: idSchema,
  number: z.number().int().nullable(),
  state: checklistVersionStateSchema,
  changeNote: z.string().nullable(),
  publishedAt: isoDateTimeSchema.nullable(),
  publishedBy: actorRefSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type ChecklistVersionSummary = z.infer<typeof checklistVersionSummarySchema>;

export const checklistSourceSchema = z.object({ kind: z.enum(['global', 'tenant', 'version']), id: idSchema });
export const checklistDetailSchema = checklistSummarySchema.extend({
  currentVersionId: idSchema.nullable(),
  source: checklistSourceSchema.nullable(),
  /** Draft first, then published versions newest first. */
  versions: z.array(checklistVersionSummarySchema),
});
export type ChecklistDetail = z.infer<typeof checklistDetailSchema>;

export const checklistVersionSchema = checklistVersionSummarySchema.extend({
  checklistId: idSchema,
  revision: z.number().int(),
  content: checklistContentSchema,
});
export type ChecklistVersion = z.infer<typeof checklistVersionSchema>;

export const contentSaveResultSchema = z.object({ revision: z.number().int(), issues: z.array(contentIssueSchema) });
export type ContentSaveResult = z.infer<typeof contentSaveResultSchema>;

const name = z.string().trim().min(1).max(200);
const description = z.string().trim().max(2000).nullable();

export const createChecklistInputSchema = z.object({
  name,
  description: description.optional(),
  category: templateCategorySchema.nullable().optional(),
  from: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('global'), templateId: idSchema }),
      z.object({ kind: z.literal('tenant'), templateId: idSchema }),
      z.object({ kind: z.literal('version'), versionId: idSchema }),
    ])
    .optional(),
});
export type CreateChecklistInput = z.input<typeof createChecklistInputSchema>;

export const updateChecklistInputSchema = z.object({
  name: name.optional(),
  description: description.optional(),
  category: templateCategorySchema.nullable().optional(),
});
export type UpdateChecklistInput = z.input<typeof updateChecklistInputSchema>;

export const startDraftInputSchema = z.object({ fromVersionId: idSchema.optional() });
export type StartDraftInput = z.input<typeof startDraftInputSchema>;

/** `content` is parsed by the API with the draft schema, so errors come back as `issues`. */
export const saveContentInputSchema = z.object({ content: z.unknown(), revision: z.number().int().min(1) });
export type SaveContentInput = z.input<typeof saveContentInputSchema>;

export const publishInputSchema = z.object({
  revision: z.number().int().min(1),
  changeNote: z.string().trim().max(500).nullable().optional(),
});
export type PublishInput = z.input<typeof publishInputSchema>;

export const checklistListQuerySchema = cursorQuerySchema.extend({
  status: checklistStatusSchema.optional(),
  category: templateCategorySchema.optional(),
  q: z.string().trim().max(100).optional(),
  hasDraft: z.stringbool().optional(),
});
export type ChecklistListQuery = z.input<typeof checklistListQuerySchema>;
```

Add to `index.ts`:
```ts
export * from './templates.js';
export * from './checklists.js';
```

- [ ] **Step 5b: Fix the role test that pins Manager's defaults**

In `apps/api/test/roles.test.ts`, change the Manager expectation:
```ts
    expect(roles.find((r) => r.systemKey === 'manager')!.permissions.sort()).toEqual(['checklists.manage', 'checklists.view', 'sites.view', 'teams.view', 'users.view']);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @taskop/contracts test && pnpm --filter @taskop/contracts typecheck && pnpm --filter @taskop/contracts build`
Expected: PASS, no type errors. `dist/` builds, which the API and web need.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/src apps/api/test/roles.test.ts
git commit -m "feat(contracts): add checklist/template DTOs, permissions and error codes"
```

---

### Task 5: i18n strings for errors, permissions and content issues

**Files:**
- Create: `packages/i18n/src/az/checklists.ts`
- Modify: `packages/i18n/src/az/index.ts`, `packages/i18n/src/az/errors.ts`, `packages/i18n/src/az/roles.ts`, `packages/i18n/src/i18n.test.ts`

**Interfaces:**
- Consumes: `ErrorCode`, `ISSUE_CODES`, `ITEM_TYPES`, `TEMPLATE_CATEGORIES`, `PERMISSION_GROUPS` from contracts.
- Produces: the `az.checklists` namespace with keys `issues.<code>`, `categories.<category>` and `itemTypes.<type>`. Part 2 adds UI keys to the same file. Also `roles.groups.checklists`, `roles.groups.templates` and `roles.keys.<key with _>`.

- [ ] **Step 1: Write the failing test**

Append to `packages/i18n/src/i18n.test.ts`:
```ts
import { ALL_PERMISSIONS, ISSUE_CODES, ITEM_TYPES, PERMISSION_GROUPS, TEMPLATE_CATEGORIES } from '@taskop/contracts';

describe('checklist translations', () => {
  it('translates every content issue code', () => {
    for (const code of ISSUE_CODES) expect(az.checklists.issues[code], code).toBeTypeOf('string');
  });
  it('translates categories and item types', () => {
    for (const c of TEMPLATE_CATEGORIES) expect(az.checklists.categories[c], c).toBeTypeOf('string');
    for (const t of ITEM_TYPES) expect(az.checklists.itemTypes[t], t).toBeTypeOf('string');
  });
  it('labels every permission group and key', () => {
    for (const g of PERMISSION_GROUPS) expect(az.roles.groups[g.group as keyof typeof az.roles.groups], g.group).toBeTypeOf('string');
    for (const k of ALL_PERMISSIONS) expect(az.roles.keys[k.replace('.', '_') as keyof typeof az.roles.keys], k).toBeTypeOf('string');
  });
});
```

The existing test `has a message for every API error code` already covers the 8 new error codes.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @taskop/contracts build && pnpm --filter @taskop/i18n test`
Expected: FAIL, because `az.checklists` is undefined and `errors.CHECKLIST_NO_DRAFT` is missing.

- [ ] **Step 3: Add the strings**

`packages/i18n/src/az/checklists.ts`:
```ts
export default {
  issues: {
    tooDeep: 'Əlavə suallar ən çox 3 səviyyə dərinlikdə ola bilər.',
    tooManyItems: 'Yoxlama vərəqəsində ən çox 500 bənd ola bilər.',
    noSections: 'Ən azı bir bölmə əlavə edin.',
    noItems: 'Ən azı bir bənd əlavə edin.',
    titleRequired: 'Bölmənin adını yazın.',
    labelRequired: 'Sualın mətnini yazın.',
    tooFewOptions: 'Ən azı iki seçim əlavə edin.',
    optionLabelRequired: 'Seçimin mətnini yazın.',
    duplicateOptionLabel: 'Seçimlər təkrarlanmamalıdır.',
    unknownOption: 'Qayda silinmiş seçimə istinad edir.',
    ruleNoOptions: 'Qayda üçün ən azı bir seçim işarələyin.',
    ruleKindMismatch: 'Qaydanın şərti sualın növünə uyğun deyil.',
    rangeInvalid: 'Minimum dəyər maksimumdan böyük ola bilməz.',
    ruleOutOfRange: 'Qaydanın dəyəri sualın icazə verilən aralığından kənardadır.',
    duplicateId: 'Təkrarlanan identifikator. Bəndi silib yenidən əlavə edin.',
    mediaCountInvalid: 'Minimum say maksimumdan böyük ola bilməz.',
    requiredMediaMin: 'Məcburi foto/video sualı üçün minimum say ən azı 1 olmalıdır.',
  },
  categories: {
    cleaning: 'Təmizlik',
    restaurant: 'Restoran',
    retail: 'Pərakəndə satış',
    safety: 'Təhlükəsizlik',
    production: 'İstehsalat',
    warehouse: 'Anbar',
    quality: 'Keyfiyyət yoxlaması',
    maintenance: 'Texniki xidmət',
    other: 'Digər',
  },
  itemTypes: {
    yes_no: 'Bəli / Xeyr',
    confirm_deny: 'Təsdiq / İnkar',
    single_choice: 'Bir seçim',
    multi_choice: 'Çoxsaylı seçim',
    number: 'Rəqəm',
    text: 'Mətn',
    comment: 'Şərh',
    photo: 'Foto',
    video: 'Video',
    datetime: 'Tarix və vaxt',
  },
} as const;
```

Register it in `az/index.ts`:
```ts
import checklists from './checklists.js';
// ...
export const az = { common, errors, audit, auth, checklists, mobile, nav, platform, roles, settings, sites, teams, users } as const;
```

`az/errors.ts`: add after `SELF_MODIFICATION`:
```ts
  CHECKLIST_NO_DRAFT: 'Bu yoxlama vərəqəsinin qaralaması yoxdur.',
  CHECKLIST_DRAFT_EXISTS: 'Bu yoxlama vərəqəsinin artıq açıq qaralaması var.',
  CHECKLIST_DRAFT_CONFLICT: 'Qaralama başqa yerdə dəyişdirilib. Səhifəni yeniləyin.',
  CHECKLIST_INVALID_CONTENT: 'Yoxlama vərəqəsində düzəldilməli xətalar var.',
  CHECKLIST_CONTENT_TOO_LARGE: 'Yoxlama vərəqəsi çox böyükdür.',
  CHECKLIST_DEACTIVATED: 'Deaktiv yoxlama vərəqəsi dəyişdirilə bilməz.',
  TEMPLATE_CONFLICT: 'Şablon başqa yerdə dəyişdirilib. Səhifəni yeniləyin.',
  TEMPLATE_DEACTIVATED: 'Deaktiv şablondan istifadə etmək və onu dəyişdirmək olmaz.',
```

`az/roles.ts`: add to `groups`:
```ts
    checklists: 'Yoxlama vərəqələri',
    templates: 'Şablonlar',
```
and to `keys`:
```ts
    checklists_view: 'Yoxlama vərəqələrinə baxmaq',
    checklists_manage: 'Yoxlama vərəqələrini yaratmaq və redaktə etmək',
    checklists_publish: 'Yoxlama vərəqələrini dərc etmək',
    templates_manage: 'Şablonları idarə etmək',
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @taskop/i18n test && pnpm --filter @taskop/i18n build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/src
git commit -m "feat(i18n): add checklist issue, category, error and permission strings"
```

> **Milestone:** after Task 5, Part 2 (web) can start against the contracts.

---

### Task 6: Database schema, migrations, actor context and error details

**Files:**
- Modify: `apps/api/src/db/schema.ts`, `apps/api/src/db/db.service.ts`, `apps/api/src/db/audit.service.ts`, `apps/api/src/common/app-error.ts`, `apps/api/src/common/error.filter.ts`, `apps/api/src/app.setup.ts`, `apps/api/test/db-context.test.ts:35`
- Create: `apps/api/drizzle/0003_checklists.sql` (generated), `apps/api/drizzle/0004_checklists_security.sql` (custom, generated empty then filled)
- Test: `apps/api/test/checklists-db.test.ts`

**Interfaces:**
- Produces:
  - Tables: `checklists`, `checklistVersions`, `tenantTemplates`, `globalTemplates`, and the view `globalTemplatesPublished`.
  - Enums: `checklistStatus`, `checklistVersionState`, `templateCategory`, `templateSourceKind`.
  - `DbService.withTenant(tenantId, userId, fn, opts?: { platformAdminId?: string })`
  - `DbService.context(): { tenantId; userId: string | null; platformAdminId: string | null }`
  - `AuditService.record(e)` now fills `actorPlatformAdminId` from the context.
  - `AuditService.recordIn(executor, e & { tenantId: string | null; actorPlatformAdminId: string | null })`
  - `new AppError(code, { details: { issues?, currentRevision? } })`

- [ ] **Step 1: Write the failing DB test**

`apps/api/test/checklists-db.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { signupTenant } from './fixtures';
import { ownerQuery } from './owner-db';
import pg from 'pg';
import { inject } from 'vitest';

async function asApp<T>(tenantId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const pool = new pg.Pool({ connectionString: inject('db').appUrl, max: 1 });
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    return await fn(c);
  } finally {
    await c.query('rollback').catch(() => undefined);
    c.release();
    await pool.end();
  }
}

describe('checklist tables', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  async function seedChecklist(tenantId: string, ownerId: string) {
    const c = await ownerQuery<{ id: string }>(
      "insert into checklists (id, tenant_id, name, created_by_user_id) values (gen_random_uuid(), $1, 'X', $2) returning id",
      [tenantId, ownerId],
    );
    const v = await ownerQuery<{ id: string }>(
      `insert into checklist_versions (id, tenant_id, checklist_id, state, content, created_by_user_id)
       values (gen_random_uuid(), $1, $2, 'draft', '{}'::jsonb, $3) returning id`,
      [tenantId, c.rows[0]!.id, ownerId],
    );
    return { checklistId: c.rows[0]!.id, versionId: v.rows[0]!.id };
  }

  it('makes published versions immutable, even for raw SQL', async () => {
    const s = await signupTenant(t);
    const { versionId } = await seedChecklist(s.tenantId, s.ownerId);
    await ownerQuery(
      "update checklist_versions set state = 'published', number = 1, published_at = now(), published_by_user_id = $2 where id = $1",
      [versionId, s.ownerId],
    );
    await asApp(s.tenantId, async (c) => {
      await expect(c.query("update checklist_versions set change_note = 'x' where id = $1", [versionId])).rejects.toThrow(/immutable/);
    });
    await asApp(s.tenantId, async (c) => {
      await expect(c.query('delete from checklist_versions where id = $1', [versionId])).rejects.toThrow(/immutable/);
    });
  });

  it('allows deleting a draft and enforces one draft per checklist', async () => {
    const s = await signupTenant(t);
    const { checklistId, versionId } = await seedChecklist(s.tenantId, s.ownerId);
    await expect(
      ownerQuery(
        `insert into checklist_versions (id, tenant_id, checklist_id, state, content, created_by_user_id)
         values (gen_random_uuid(), $1, $2, 'draft', '{}'::jsonb, $3)`,
        [s.tenantId, checklistId, s.ownerId],
      ),
    ).rejects.toThrow(/checklist_versions_one_draft_uq/);
    await asApp(s.tenantId, async (c) => {
      expect((await c.query('delete from checklist_versions where id = $1', [versionId])).rowCount).toBe(1);
    });
  });

  it('isolates checklist rows by tenant', async () => {
    const a = await signupTenant(t);
    const b = await signupTenant(t);
    await seedChecklist(a.tenantId, a.ownerId);
    await asApp(b.tenantId, async (c) => {
      expect((await c.query('select count(*)::int as n from checklists where tenant_id = $1', [a.tenantId])).rows[0].n).toBe(0);
      expect((await c.query('select count(*)::int as n from checklist_versions where tenant_id = $1', [a.tenantId])).rows[0].n).toBe(0);
    });
  });

  it('shows tenants only published global templates and no write access', async () => {
    const s = await signupTenant(t);
    await ownerQuery(
      `insert into global_templates (id, name, category, content, item_count, published) values
       (gen_random_uuid(), 'Pub', 'cleaning', '{}'::jsonb, 0, true), (gen_random_uuid(), 'Hidden', 'cleaning', '{}'::jsonb, 0, false)`,
    );
    await asApp(s.tenantId, async (c) => {
      const names = (await c.query('select name from global_templates_published')).rows.map((r) => r.name);
      expect(names).toContain('Pub');
      expect(names).not.toContain('Hidden');
    });
    await asApp(s.tenantId, async (c) => {
      await expect(c.query('select * from global_templates')).rejects.toThrow(/permission denied/);
    });
  });

  it('accepts platform-scope audit rows without a tenant', async () => {
    await ownerQuery("insert into audit_log (id, tenant_id, actor_platform_admin_id, action, entity_type) values (gen_random_uuid(), null, gen_random_uuid(), 'x', 'x')");
    await expect(ownerQuery("insert into audit_log (id, tenant_id, action, entity_type) values (gen_random_uuid(), null, 'x', 'x')")).rejects.toThrow(
      /audit_log_scope_ck/,
    );
  });

  it('backfilled the new permissions for admin roles', async () => {
    const s = await signupTenant(t);
    const r = await ownerQuery<{ permission_key: string }>(
      "select rp.permission_key from role_permissions rp join roles r on r.id = rp.role_id where r.tenant_id = $1 and r.system_key = 'admin'",
      [s.tenantId],
    );
    expect(r.rows.map((x) => x.permission_key)).toEqual(expect.arrayContaining(['checklists.publish', 'templates.manage']));
  });
});
```

The last test passes for new tenants through `SYSTEM_ROLE_DEFAULTS.admin` (all keys). The backfill in 0004 covers tenants that existed before the migration, and Step 8 verifies it manually against the dev DB.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @taskop/api test -- checklists-db`
Expected: FAIL with `relation "checklists" does not exist`.

- [ ] **Step 3: Extend the Drizzle schema**

In `apps/api/src/db/schema.ts`:

Add `pgView` to the `drizzle-orm/pg-core` import. Don't import runtime values from `@taskop/contracts` here, because drizzle-kit loads this file on its own. The category list below is a literal that must match `TEMPLATE_CATEGORIES`. Inserts typed with `TemplateCategory` (Tasks 7–8) fail to compile if contracts ever gains a category this enum lacks.

Change `audit_log.tenant_id` to nullable, and add a scope check:
```ts
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    // null only for platform-scope entries (global templates); see audit_log_scope_ck.
    tenantId: uuid('tenant_id').references(() => tenants.id),
    // ...unchanged columns...
  },
  (t) => [
    index('audit_log_tenant_time_idx').on(t.tenantId, t.occurredAt),
    check('audit_log_scope_ck', sql`${t.tenantId} is not null or ${t.actorPlatformAdminId} is not null`),
  ],
);
```

Append the new enums and tables at the end of the file:
```ts
export const checklistStatus = pgEnum('checklist_status', ['active', 'deactivated']);
export const checklistVersionState = pgEnum('checklist_version_state', ['draft', 'published']);
// Must match TEMPLATE_CATEGORIES in @taskop/contracts.
export const templateCategory = pgEnum('template_category', ['cleaning', 'restaurant', 'retail', 'safety', 'production', 'warehouse', 'quality', 'maintenance', 'other']);
export const templateSourceKind = pgEnum('template_source_kind', ['global', 'tenant']);

const createdByUser = () => uuid('created_by_user_id');
const createdByPlatform = () => uuid('created_by_platform_admin_id');
const oneCreator = (name: string, t: { createdByUserId: AnyPgColumn; createdByPlatformAdminId: AnyPgColumn }) =>
  check(name, sql`num_nonnulls(${t.createdByUserId}, ${t.createdByPlatformAdminId}) = 1`);

export const checklists = pgTable(
  'checklists',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    description: text('description'),
    category: templateCategory('category'),
    status: checklistStatus('status').notNull().default('active'),
    // FK to checklist_versions (tenant_id, id) is added in 0004 (circular reference).
    currentVersionId: uuid('current_version_id'),
    latestVersionNumber: integer('latest_version_number').notNull().default(0),
    sourceTemplateKind: templateSourceKind('source_template_kind'),
    sourceTemplateId: uuid('source_template_id'),
    sourceVersionId: uuid('source_version_id'),
    createdByUserId: createdByUser(),
    createdByPlatformAdminId: createdByPlatform(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('checklists_tenant_id_uq').on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.createdByUserId], foreignColumns: [users.tenantId, users.id], name: 'checklists_created_by_fk' }),
    oneCreator('checklists_creator_ck', t),
    index('checklists_tenant_idx').on(t.tenantId, t.id),
  ],
);

export const checklistVersions = pgTable(
  'checklist_versions',
  {
    id: id(),
    tenantId: tenantId(),
    checklistId: uuid('checklist_id').notNull(),
    state: checklistVersionState('state').notNull(),
    number: integer('number'),
    content: jsonb('content').notNull(),
    changeNote: text('change_note'),
    revision: integer('revision').notNull().default(1),
    createdByUserId: createdByUser(),
    createdByPlatformAdminId: createdByPlatform(),
    publishedByUserId: uuid('published_by_user_id'),
    publishedByPlatformAdminId: uuid('published_by_platform_admin_id'),
    publishedAt: ts('published_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('checklist_versions_tenant_id_uq').on(t.tenantId, t.id),
    unique('checklist_versions_number_uq').on(t.checklistId, t.number),
    uniqueIndex('checklist_versions_one_draft_uq').on(t.checklistId).where(sql`${t.state} = 'draft'`),
    foreignKey({ columns: [t.tenantId, t.checklistId], foreignColumns: [checklists.tenantId, checklists.id], name: 'checklist_versions_checklist_fk' }),
    foreignKey({ columns: [t.tenantId, t.createdByUserId], foreignColumns: [users.tenantId, users.id], name: 'checklist_versions_created_by_fk' }),
    foreignKey({ columns: [t.tenantId, t.publishedByUserId], foreignColumns: [users.tenantId, users.id], name: 'checklist_versions_published_by_fk' }),
    oneCreator('checklist_versions_creator_ck', t),
    check(
      'checklist_versions_published_ck',
      sql`(${t.state} = 'draft' and ${t.number} is null and ${t.publishedAt} is null and ${t.publishedByUserId} is null and ${t.publishedByPlatformAdminId} is null)
       or (${t.state} = 'published' and ${t.number} is not null and ${t.publishedAt} is not null and num_nonnulls(${t.publishedByUserId}, ${t.publishedByPlatformAdminId}) = 1)`,
    ),
    index('checklist_versions_checklist_idx').on(t.tenantId, t.checklistId),
  ],
);

export const tenantTemplates = pgTable(
  'tenant_templates',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    description: text('description'),
    category: templateCategory('category').notNull(),
    content: jsonb('content').notNull(),
    revision: integer('revision').notNull().default(1),
    itemCount: integer('item_count').notNull(),
    status: checklistStatus('status').notNull().default('active'),
    sourceChecklistId: uuid('source_checklist_id'),
    sourceVersionId: uuid('source_version_id'),
    createdByUserId: createdByUser(),
    createdByPlatformAdminId: createdByPlatform(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('tenant_templates_tenant_id_uq').on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.createdByUserId], foreignColumns: [users.tenantId, users.id], name: 'tenant_templates_created_by_fk' }),
    oneCreator('tenant_templates_creator_ck', t),
    index('tenant_templates_tenant_idx').on(t.tenantId),
  ],
);

/** Taskop's library. No tenant_id and no RLS: tenants read it only through `global_templates_published`. */
export const globalTemplates = pgTable('global_templates', {
  id: id(),
  name: text('name').notNull(),
  description: text('description'),
  category: templateCategory('category').notNull(),
  content: jsonb('content').notNull(),
  revision: integer('revision').notNull().default(1),
  itemCount: integer('item_count').notNull(),
  published: boolean('published').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  // null = inserted by the seed script.
  createdByPlatformAdminId: uuid('created_by_platform_admin_id').references(() => platformAdmins.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Created by hand in 0004 (drizzle-kit does not manage it). */
export const globalTemplatesPublished = pgView('global_templates_published', {
  id: uuid('id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  category: templateCategory('category').notNull(),
  content: jsonb('content').notNull(),
  revision: integer('revision').notNull(),
  itemCount: integer('item_count').notNull(),
  sortOrder: integer('sort_order').notNull(),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
}).existing();
```

Also add `uniqueIndex` and `type AnyPgColumn` to the `drizzle-orm/pg-core` import. `platformAdmins` is declared above in the same file, and the `references` callback is lazy.

- [ ] **Step 4: Generate the migrations**

Run (from the repo root):
```bash
pnpm --filter @taskop/contracts build
pnpm --filter @taskop/api exec drizzle-kit generate --name checklists
pnpm --filter @taskop/api exec drizzle-kit generate --custom --name checklists_security
```
Expected: `apps/api/drizzle/0003_checklists.sql` contains the 4 `CREATE TYPE`s, the 4 `CREATE TABLE`s, the FKs, checks and indexes, and `ALTER TABLE "audit_log" ALTER COLUMN "tenant_id" DROP NOT NULL`. It must not contain `CREATE VIEW`. If drizzle-kit emitted one, delete that statement. `0004_checklists_security.sql` is created empty.

Fill `apps/api/drizzle/0004_checklists_security.sql`:
```sql
ALTER TABLE checklists
  ADD CONSTRAINT checklists_current_version_fk FOREIGN KEY (tenant_id, current_version_id) REFERENCES checklist_versions (tenant_id, id);
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['checklists','checklist_versions','tenant_templates']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t);
  END LOOP;
END $$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON checklists, tenant_templates TO taskop_app, taskop_platform;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON checklist_versions TO taskop_app, taskop_platform;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON global_templates TO taskop_platform;
--> statement-breakpoint
CREATE VIEW global_templates_published AS
  SELECT id, name, description, category, content, revision, item_count, sort_order, created_at, updated_at
  FROM global_templates WHERE published;
--> statement-breakpoint
GRANT SELECT ON global_templates_published TO taskop_app, taskop_platform;
--> statement-breakpoint
-- Published versions are immutable (NFR-06, FR-06.11); only drafts may be updated or deleted.
CREATE FUNCTION checklist_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'published' THEN
    RAISE EXCEPTION 'published checklist versions are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER checklist_versions_immutable BEFORE UPDATE OR DELETE ON checklist_versions
  FOR EACH ROW EXECUTE FUNCTION checklist_versions_guard();
--> statement-breakpoint
-- Existing tenants: Admin gets the new keys (new tenants get them from SYSTEM_ROLE_DEFAULTS).
INSERT INTO role_permissions (tenant_id, role_id, permission_key)
  SELECT r.tenant_id, r.id, k
  FROM roles r CROSS JOIN unnest(ARRAY['checklists.view','checklists.manage','checklists.publish','templates.manage']) AS k
  WHERE r.system_key = 'admin'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Bump the version so cached (roleId, version) permission sets reload.
UPDATE roles SET version = version + 1 WHERE system_key = 'admin';
```

`taskop_owner` is a superuser in Docker and in Testcontainers, so the backfill is not filtered by RLS.

- [ ] **Step 5: Carry the platform admin in the tenant context**

`apps/api/src/db/db.service.ts`:
```ts
interface TenantStore {
  tx: Tx;
  tenantId: string;
  userId: string | null;
  platformAdminId: string | null;
  afterCommit: (() => unknown)[];
}
```
```ts
  /** Runs `fn` in a transaction where RLS sees `tenantId`. Re-uses an enclosing transaction for the same tenant. */
  async withTenant<T>(tenantId: string, userId: string | null, fn: (tx: Tx) => Promise<T>, opts: { platformAdminId?: string } = {}): Promise<T> {
```
and in the `storage.run(...)` call:
```ts
      return storage.run({ tx, tenantId, userId, platformAdminId: opts.platformAdminId ?? null, afterCommit }, () => fn(tx));
```
```ts
  context(): { tenantId: string; userId: string | null; platformAdminId: string | null } {
    const current = storage.getStore();
    if (!current) throw new Error('No tenant transaction in scope');
    return { tenantId: current.tenantId, userId: current.userId, platformAdminId: current.platformAdminId };
  }
```

Update `apps/api/test/db-context.test.ts:35`:
```ts
      expect(db.context()).toEqual({ tenantId: A, userId: 'u1', platformAdminId: null });
```

- [ ] **Step 6: Audit rows: actor from the context, plus `recordIn`**

Replace the class body of `apps/api/src/db/audit.service.ts` (keep `redactSecrets` and `AuditEvent`):
```ts
type AuditRow = typeof auditLog.$inferInsert;

function toRow(e: AuditEvent, tenantId: string | null, actorUserId: string | null, actorPlatformAdminId: string | null): AuditRow {
  const meta = currentRequestMeta();
  return {
    tenantId,
    actorUserId,
    actorPlatformAdminId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    before: e.before === undefined ? null : redactSecrets(e.before),
    after: e.after === undefined ? null : redactSecrets(e.after),
    ip: meta.ip,
    userAgent: meta.userAgent,
  };
}

@Injectable()
export class AuditService {
  constructor(private readonly db: DbService) {}

  /** Writes inside the current tenant transaction, so it commits or rolls back with the change. */
  async record(e: AuditEvent): Promise<void> {
    const { tenantId, userId, platformAdminId } = this.db.context();
    const actorUserId = e.actorUserId === undefined ? userId : e.actorUserId;
    await this.db.tx().insert(auditLog).values(toRow(e, tenantId, actorUserId, platformAdminId));
  }

  async recordAsPlatform(e: AuditEvent & { tenantId: string; actorPlatformAdminId: string }): Promise<void> {
    await this.db.platform.insert(auditLog).values(toRow(e, e.tenantId, null, e.actorPlatformAdminId));
  }

  /** Writes on a caller-supplied executor (e.g. a platform-connection transaction for global templates). */
  async recordIn(executor: Executor, e: AuditEvent & { tenantId: string | null; actorPlatformAdminId: string | null }): Promise<void> {
    await executor.insert(auditLog).values(toRow(e, e.tenantId, null, e.actorPlatformAdminId));
  }
}
```
Add `type Executor` to the `./db.service` import.

- [ ] **Step 7: Error details on `AppError` and the error body; JSON body limit**

`apps/api/src/common/app-error.ts`:
```ts
import { type ContentIssue, ERROR_HTTP_STATUS, type ErrorCode } from '@taskop/contracts';

export interface AppErrorDetails {
  issues?: ContentIssue[];
  currentRevision?: number;
}

export class AppError extends Error {
  readonly fields: Record<string, string> | null;
  readonly retryAfterSeconds: number | null;
  readonly details: AppErrorDetails | null;

  constructor(
    readonly code: ErrorCode,
    opts: { fields?: Record<string, string>; retryAfterSeconds?: number; message?: string; details?: AppErrorDetails } = {},
  ) {
    super(opts.message ?? code);
    this.fields = opts.fields ?? null;
    this.retryAfterSeconds = opts.retryAfterSeconds ?? null;
    this.details = opts.details ?? null;
  }

  get status(): number {
    return ERROR_HTTP_STATUS[this.code];
  }
}
```

`apps/api/src/common/error.filter.ts`: in `catch`, change the JSON body to:
```ts
    res.status(err.status).json({
      error: {
        code: err.code,
        messageKey: errorMessageKey(err.code),
        fields: err.fields,
        retryAfterSeconds: err.retryAfterSeconds,
        requestId,
        ...(err.details ?? {}),
      },
    });
```

`apps/api/src/app.setup.ts`: after `express.disable('x-powered-by');` add:
```ts
  // Checklist content can be up to 1 MB; leave headroom for the JSON envelope (spec §6.4).
  express.useBodyParser('json', { limit: '1.5mb' });
```

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- checklists-db db-context error.filter roles audit`
Expected: PASS.

Then apply the migration to the local demo DB and check the backfill:
```bash
docker compose -p foundation start
pnpm db:setup
docker compose -p foundation exec postgres psql -U taskop_owner -d taskop -c "select count(*) from role_permissions where permission_key = 'checklists.publish'"
```
Expected: count ≥ 1, one per tenant. If the compose service has a different name, run `docker compose -p foundation ps` to find it.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/db apps/api/drizzle apps/api/src/common/app-error.ts apps/api/src/common/error.filter.ts apps/api/src/app.setup.ts apps/api/test/checklists-db.test.ts apps/api/test/db-context.test.ts
git commit -m "feat(api): add checklist tables, immutability trigger, RLS and platform actor context"
```

---

### Task 7: Checklists service and tenant endpoints (lifecycle)

**Files:**
- Create: `apps/api/src/checklists/content.ts`, `actor.ts`, `mappers.ts`, `checklists.service.ts`, `route-mode.ts`, `checklists.controller.ts`, `dto.ts`, `checklists.module.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/platform/platform.module.ts`
- Test: `apps/api/test/checklists.test.ts`, plus the shared fixture `apps/api/test/checklist-fixtures.ts`. Fixtures live outside `*.test.ts` files, because importing a test file re-registers its suites in the importer.

**Interfaces:**
- Consumes: Task 4 schemas/types, Task 6 tables and `AppError` details, `DbService`, `AuditService`.
- Produces:
  - `parseDraftOrThrow(raw: unknown): ChecklistContent` (throws `CHECKLIST_CONTENT_TOO_LARGE` or `CHECKLIST_INVALID_CONTENT`)
  - `actorColumns(db): { userId: string | null; platformAdminId: string | null }`
  - `ChecklistsService` methods:
    - `list(q)`, `get(id)`, `getVersion(id, versionId)`, `getDraft(id)`
    - `create(input)`, `update(id, input)`
    - `startDraft(id, input)`, `saveDraft(id, input)`, `discardDraft(id)`, `publish(id, input)`
    - `deactivate(id)`, `reactivate(id)`
  - The `ChecklistContentSource` interface (`contentFromTemplate(kind, id): Promise<ChecklistContent>`) is implemented in Task 8. In this task `create` with `from.kind` `global`/`tenant` throws `REFERENCE_NOT_FOUND`.
  - The `checklistsControllerFor(mode)` factory, plus `TenantChecklistsController` and `PlatformTenantChecklistsController`. Task 9 wires up the platform one.
  - `routeMode` helpers: `perm(mode, ...keys)` and `controllerDecorators(mode, path, tag)`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/checklist-fixtures.ts`:
```ts
import { blankContent, type ChecklistContent, newItem, newRule, newSection, type YesNoItem } from '@taskop/contracts';

/** One yes/no item; "yes" is a critical problem that requires a photo and asks a follow-up comment. */
export function sampleContent(): ChecklistContent {
  const yn = newItem('yes_no') as YesNoItem;
  yn.label = 'Problem varmı?';
  const rule = newRule(yn);
  rule.when = { kind: 'options', optionIds: [yn.options[0].id] };
  rule.then.problem = 'critical';
  rule.then.requirePhoto = true;
  const describeIt = newItem('comment');
  describeIt.label = 'Təsvir edin';
  rule.then.followUps.push(describeIt);
  yn.rules.push(rule);
  return { ...blankContent(), sections: [{ ...newSection('Giriş'), items: [yn] }] };
}
```

`apps/api/test/checklists.test.ts`:
```ts
import { blankContent, newItem, newSection } from '@taskop/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { sampleContent } from './checklist-fixtures';
import { as, createUserDirect, loginStaff, loginWorker, signupTenant } from './fixtures';
import { ownerQuery } from './owner-db';

const B = '/api/v1/checklists';

describe('checklists lifecycle', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  async function owner() {
    const s = await signupTenant(t);
    return { s, api: as(t, s.accessToken) };
  }

  it('creates a blank checklist with a draft, publishes v1 and v2, and keeps v1 unchanged', async () => {
    const { s, api } = await owner();
    const created = await api.post(B, { name: 'Gündəlik yoxlama', category: 'cleaning' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ name: 'Gündəlik yoxlama', status: 'active', currentVersionNumber: null, draftRevision: 1, versions: [{ state: 'draft' }] });
    const id = created.body.id as string;

    const draft = (await api.get(`${B}/${id}/draft`)).body;
    expect(draft.content.sections).toHaveLength(1);
    const saved = await api.put(`${B}/${id}/draft`, { content: sampleContent(), revision: 1 });
    expect(saved.body).toEqual({ revision: 2, issues: [] });

    const v1 = await api.post(`${B}/${id}/publish`, { revision: 2, changeNote: 'İlk versiya' });
    expect(v1.status, JSON.stringify(v1.body)).toBe(200);
    expect(v1.body).toMatchObject({ number: 1, state: 'published', changeNote: 'İlk versiya', publishedBy: { kind: 'user', name: 'Elvin Əhmədov' } });
    const v1Content = (await api.get(`${B}/${id}/versions/${v1.body.id}`)).body.content;

    const d2 = await api.post(`${B}/${id}/draft`, {});
    expect(d2.status).toBe(201);
    expect(d2.body.content).toEqual(v1Content);
    const edited = structuredClone(v1Content);
    edited.sections[0].title = 'Giriş zalı';
    expect((await api.put(`${B}/${id}/draft`, { content: edited, revision: 1 })).body.revision).toBe(2);
    expect((await api.post(`${B}/${id}/publish`, { revision: 2 })).body.number).toBe(2);

    const detail = (await api.get(`${B}/${id}`)).body;
    expect(detail).toMatchObject({ currentVersionNumber: 2, draftRevision: null });
    expect(detail.versions.map((v: { number: number }) => v.number)).toEqual([2, 1]);
    expect((await api.get(`${B}/${id}/versions/${v1.body.id}`)).body.content).toEqual(v1Content);

    const audit = await ownerQuery<{ action: string }>('select action from audit_log where tenant_id = $1 and entity_id = $2 order by occurred_at, id', [s.tenantId, id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['checklist.created', 'checklist.published', 'checklist.draft_started', 'checklist.published']);
  });

  it('stale revision on save and publish', async () => {
    const { api } = await owner();
    const id = (await api.post(B, { name: 'X' })).body.id;
    await api.put(`${B}/${id}/draft`, { content: sampleContent(), revision: 1 });
    const stale = await api.put(`${B}/${id}/draft`, { content: sampleContent(), revision: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'CHECKLIST_DRAFT_CONFLICT', currentRevision: 2 });
    const pub = await api.post(`${B}/${id}/publish`, { revision: 1 });
    expect(pub.body.error).toMatchObject({ code: 'CHECKLIST_DRAFT_CONFLICT', currentRevision: 2 });
  });

  it('returns strict issues on save and refuses to publish invalid content', async () => {
    const { api } = await owner();
    const id = (await api.post(B, { name: 'X' })).body.id;
    const saved = await api.put(`${B}/${id}/draft`, { content: blankContent(), revision: 1 });
    expect(saved.status).toBe(200);
    expect(saved.body.issues.map((i: { code: string }) => i.code)).toEqual(['checklists.issues.titleRequired', 'checklists.issues.noItems']);
    const pub = await api.post(`${B}/${id}/publish`, { revision: 2 });
    expect(pub.status).toBe(422);
    expect(pub.body.error.code).toBe('CHECKLIST_INVALID_CONTENT');
    expect(pub.body.error.issues).toHaveLength(2);
  });

  it('rejects structurally invalid and oversized drafts', async () => {
    const { api } = await owner();
    const id = (await api.post(B, { name: 'X' })).body.id;
    const bad = await api.put(`${B}/${id}/draft`, { content: { schemaVersion: 1, sections: 'nope' }, revision: 1 });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('CHECKLIST_INVALID_CONTENT');
    const huge = sampleContent();
    huge.instructions = 'x'.repeat(5000);
    huge.sections = Array.from({ length: 50 }, () => ({ ...newSection('S'), instructions: 'y'.repeat(2000), items: Array.from({ length: 10 }, () => ({ ...newItem('text'), label: 'z'.repeat(500), helpText: 'h'.repeat(1500) })) }));
    const big = await api.put(`${B}/${id}/draft`, { content: huge, revision: 1 });
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('CHECKLIST_CONTENT_TOO_LARGE');
  });

  it('discards drafts, restores old versions and refuses a second draft', async () => {
    const { api } = await owner();
    const id = (await api.post(B, { name: 'X' })).body.id;
    await api.put(`${B}/${id}/draft`, { content: sampleContent(), revision: 1 });
    const v1 = (await api.post(`${B}/${id}/publish`, { revision: 2 })).body;
    expect((await api.post(`${B}/${id}/draft`, {})).status).toBe(201);
    expect((await api.post(`${B}/${id}/draft`, {})).body.error.code).toBe('CHECKLIST_DRAFT_EXISTS');
    expect((await api.delete(`${B}/${id}/draft`)).status).toBe(204);
    expect((await api.get(`${B}/${id}/draft`)).body.error.code).toBe('CHECKLIST_NO_DRAFT');
    expect((await api.post(`${B}/${id}/draft`, { fromVersionId: v1.id })).status).toBe(201);
  });

  it('blocks writes on a deactivated checklist but still allows reading and copying', async () => {
    const { api } = await owner();
    const id = (await api.post(B, { name: 'X' })).body.id;
    await api.put(`${B}/${id}/draft`, { content: sampleContent(), revision: 1 });
    const v1 = (await api.post(`${B}/${id}/publish`, { revision: 2 })).body;
    await api.post(`${B}/${id}/draft`, {});
    expect((await api.post(`${B}/${id}/deactivate`)).body.status).toBe('deactivated');
    for (const res of [
      await api.put(`${B}/${id}/draft`, { content: sampleContent(), revision: 1 }),
      await api.post(`${B}/${id}/publish`, { revision: 1 }),
      await api.patch(`${B}/${id}`, { name: 'Y' }),
    ]) {
      expect(res.body.error?.code, JSON.stringify(res.body)).toBe('CHECKLIST_DEACTIVATED');
    }
    expect((await api.get(`${B}/${id}/versions/${v1.id}`)).status).toBe(200);
    const copy = await api.post(B, { name: 'X (surət)', from: { kind: 'version', versionId: v1.id } });
    expect(copy.status).toBe(201);
    expect((await api.post(`${B}/${id}/reactivate`)).body.status).toBe('active');
  });

  it('copy keeps rules working with fresh ids', async () => {
    const { api } = await owner();
    const id = (await api.post(B, { name: 'X' })).body.id;
    await api.put(`${B}/${id}/draft`, { content: sampleContent(), revision: 1 });
    const v1 = (await api.post(`${B}/${id}/publish`, { revision: 2 })).body;
    const original = (await api.get(`${B}/${id}/versions/${v1.id}`)).body.content;
    const copy = (await api.post(B, { name: 'Copy', from: { kind: 'version', versionId: v1.id } })).body;
    expect(copy.source).toEqual({ kind: 'version', id: v1.id });
    const draft = (await api.get(`${B}/${copy.id}/draft`)).body.content;
    const item = draft.sections[0].items[0];
    expect(item.id).not.toBe(original.sections[0].items[0].id);
    expect(item.rules[0].when.optionIds).toEqual([item.options[0].id]);
    expect((await api.post(`${B}/${copy.id}/publish`, { revision: 1 })).status).toBe(200);
  });

  it('lists with filters and cursor pagination', async () => {
    const { api } = await owner();
    for (const name of ['Alfa', 'Beta', 'Qamma']) await api.post(B, { name, category: name === 'Beta' ? 'retail' : 'cleaning' });
    expect((await api.get(`${B}?category=retail`)).body.items.map((c: { name: string }) => c.name)).toEqual(['Beta']);
    expect((await api.get(`${B}?q=amm`)).body.items).toHaveLength(1);
    expect((await api.get(`${B}?hasDraft=false`)).body.items).toHaveLength(0);
    const page1 = (await api.get(`${B}?limit=2`)).body;
    expect(page1.items.map((c: { name: string }) => c.name)).toEqual(['Qamma', 'Beta']);
    const page2 = (await api.get(`${B}?limit=2&cursor=${page1.nextCursor}`)).body;
    expect(page2).toEqual({ items: [expect.objectContaining({ name: 'Alfa' })], nextCursor: null });
  });

  it('enforces permissions: manager drafts but cannot publish; auditor reads; worker gets 403', async () => {
    const { s, api } = await owner();
    const id = (await api.post(B, { name: 'X' })).body.id;
    const mgr = await createUserDirect(t, s.tenantId, { kind: 'staff', roleKey: 'manager', emailVerified: true });
    const managerApi = as(t, (await loginStaff(t, mgr.email!, mgr.secret)).accessToken);
    expect((await managerApi.put(`${B}/${id}/draft`, { content: sampleContent(), revision: 1 })).status).toBe(200);
    expect((await managerApi.post(`${B}/${id}/publish`, { revision: 2 })).status).toBe(403);
    const aud = await createUserDirect(t, s.tenantId, { kind: 'staff', roleKey: 'auditor', emailVerified: true });
    const auditorApi = as(t, (await loginStaff(t, aud.email!, aud.secret)).accessToken);
    expect((await auditorApi.get(`${B}/${id}`)).status).toBe(200);
    expect((await auditorApi.post(B, { name: 'Y' })).status).toBe(403);
    const w = await createUserDirect(t, s.tenantId);
    const workerApi = as(t, (await loginWorker(t, s.orgCode, w.username!, w.secret)).accessToken);
    expect((await workerApi.get(B)).status).toBe(403);
  });
});
```

The test uses `api.delete`. Add it to the `as()` helper in `apps/api/test/fixtures.ts`:
```ts
    delete: (url: string) => t.http().delete(url).set(bearer(token)),
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @taskop/api test -- test/checklists.test.ts`
Expected: FAIL, because `POST /api/v1/checklists` returns 404.

- [ ] **Step 3: Content and actor helpers**

`apps/api/src/checklists/content.ts`:
```ts
import { type ChecklistContent, CONTENT_LIMITS, parseDraftContent } from '@taskop/contracts';
import { AppError } from '../common/app-error';

/** Draft-schema parse used by every content write: size limit first, then structure. */
export function parseDraftOrThrow(raw: unknown): ChecklistContent {
  if (Buffer.byteLength(JSON.stringify(raw ?? null)) > CONTENT_LIMITS.contentBytes) throw new AppError('CHECKLIST_CONTENT_TOO_LARGE');
  const r = parseDraftContent(raw);
  if (!r.success) throw new AppError('CHECKLIST_INVALID_CONTENT', { details: { issues: r.issues } });
  return r.content;
}

/** Stored content was parsed on write; re-parse on read so a bad row fails loudly instead of leaking. */
export function storedContent(raw: unknown): ChecklistContent {
  const r = parseDraftContent(raw);
  if (!r.success) throw new Error('Stored checklist content failed validation');
  return r.content;
}
```

`apps/api/src/checklists/actor.ts`:
```ts
import type { DbService } from '../db/db.service';

/** Who is acting in the current tenant transaction: a tenant user or a platform admin (FR-24.03). */
export function actorColumns(db: DbService): { userId: string | null; platformAdminId: string | null } {
  const { userId, platformAdminId } = db.context();
  return platformAdminId ? { userId: null, platformAdminId } : { userId, platformAdminId: null };
}
```

- [ ] **Step 4: Mappers**

`apps/api/src/checklists/mappers.ts`:
```ts
import type { ChecklistSummary, ChecklistVersionSummary } from '@taskop/contracts';

export interface ChecklistRow {
  id: string;
  name: string;
  description: string | null;
  category: ChecklistSummary['category'];
  status: ChecklistSummary['status'];
  latestVersionNumber: number;
  draftRevision: number | null;
  updatedAt: Date;
}

export const toChecklistSummary = (r: ChecklistRow): ChecklistSummary => ({
  id: r.id,
  name: r.name,
  description: r.description,
  category: r.category,
  status: r.status,
  currentVersionNumber: r.latestVersionNumber > 0 ? r.latestVersionNumber : null,
  draftRevision: r.draftRevision,
  updatedAt: r.updatedAt.toISOString(),
});

export interface VersionRow {
  id: string;
  number: number | null;
  state: 'draft' | 'published';
  changeNote: string | null;
  publishedAt: Date | null;
  publishedByUserId: string | null;
  publishedByPlatformAdminId: string | null;
  publisherName: string | null;
  createdAt: Date;
}

export const toVersionSummary = (r: VersionRow): ChecklistVersionSummary => ({
  id: r.id,
  number: r.number,
  state: r.state,
  changeNote: r.changeNote,
  publishedAt: r.publishedAt?.toISOString() ?? null,
  publishedBy: r.publishedByUserId
    ? { kind: 'user', name: r.publisherName }
    : r.publishedByPlatformAdminId
      ? { kind: 'platform', name: null }
      : null,
  createdAt: r.createdAt.toISOString(),
});
```

- [ ] **Step 5: The service**

`apps/api/src/checklists/checklists.service.ts`:
```ts
import { Injectable, Optional } from '@nestjs/common';
import {
  blankContent,
  type ChecklistContent,
  type ChecklistDetail,
  type ChecklistSummary,
  type ChecklistVersion,
  type ChecklistVersionSummary,
  type ContentSaveResult,
  type Page,
  regenerateIds,
  validateForPublish,
} from '@taskop/contracts';
import { and, desc, eq, getTableColumns, ilike, lt, sql, type SQL } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { escapeLike } from '../common/sql';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { checklists, checklistVersions, users } from '../db/schema';
import { actorColumns } from './actor';
import { parseDraftOrThrow, storedContent } from './content';
import type { ChecklistListQueryDto, CreateChecklistDto, PublishDto, SaveContentDto, StartDraftDto, UpdateChecklistDto } from './dto';
import { toChecklistSummary, toVersionSummary, type VersionRow } from './mappers';

/** Implemented by TemplatesService (Task 8): template content with fresh ids, ready to become a draft. */
export abstract class ChecklistContentSource {
  abstract contentFromTemplate(kind: 'global' | 'tenant', templateId: string): Promise<ChecklistContent>;
}

type ChecklistRecord = typeof checklists.$inferSelect;

@Injectable()
export class ChecklistsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Optional() private readonly templates?: ChecklistContentSource,
  ) {}

  async list(q: ChecklistListQueryDto): Promise<Page<ChecklistSummary>> {
    const conditions: (SQL | undefined)[] = [];
    if (q.status) conditions.push(eq(checklists.status, q.status));
    if (q.category) conditions.push(eq(checklists.category, q.category));
    if (q.q) conditions.push(ilike(checklists.name, `%${escapeLike(q.q)}%`));
    if (q.hasDraft !== undefined) conditions.push(q.hasDraft ? sql`${this.draftRevisionSql()} is not null` : sql`${this.draftRevisionSql()} is null`);
    if (q.cursor) conditions.push(lt(checklists.id, q.cursor));
    const rows = await this.selectSummaries()
      .where(and(...conditions))
      .orderBy(desc(checklists.id))
      .limit(q.limit + 1);
    const items = rows.slice(0, q.limit).map(toChecklistSummary);
    return { items, nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null };
  }

  async get(id: string): Promise<ChecklistDetail> {
    const [row] = await this.selectSummaries().where(eq(checklists.id, id));
    if (!row) throw new AppError('NOT_FOUND');
    const versions = await this.selectVersions()
      .where(eq(checklistVersions.checklistId, id))
      .orderBy(sql`${checklistVersions.number} desc nulls first`);
    return {
      ...toChecklistSummary(row),
      currentVersionId: row.currentVersionId,
      source: row.sourceTemplateKind
        ? { kind: row.sourceTemplateKind, id: row.sourceTemplateId! }
        : row.sourceVersionId
          ? { kind: 'version', id: row.sourceVersionId }
          : null,
      versions: versions.map(toVersionSummary),
    };
  }

  async getVersion(id: string, versionId: string): Promise<ChecklistVersion> {
    return this.versionDto(and(eq(checklistVersions.id, versionId), eq(checklistVersions.checklistId, id)), 'NOT_FOUND');
  }

  async getDraft(id: string): Promise<ChecklistVersion> {
    await this.find(id);
    return this.versionDto(and(eq(checklistVersions.checklistId, id), eq(checklistVersions.state, 'draft')), 'CHECKLIST_NO_DRAFT');
  }

  async create(input: CreateChecklistDto): Promise<ChecklistDetail> {
    const { tenantId } = this.db.context();
    const actor = actorColumns(this.db);
    const from = input.from;
    let content: ChecklistContent = blankContent();
    if (from?.kind === 'version') {
      const [src] = await this.db.tx().select({ content: checklistVersions.content }).from(checklistVersions).where(eq(checklistVersions.id, from.versionId));
      if (!src) throw new AppError('REFERENCE_NOT_FOUND');
      content = regenerateIds(storedContent(src.content));
    } else if (from) {
      if (!this.templates) throw new AppError('REFERENCE_NOT_FOUND');
      content = await this.templates.contentFromTemplate(from.kind, from.templateId);
    }
    const tx = this.db.tx();
    const [row] = await tx
      .insert(checklists)
      .values({
        tenantId,
        name: input.name,
        description: input.description ?? null,
        category: input.category ?? null,
        sourceTemplateKind: from && from.kind !== 'version' ? from.kind : null,
        sourceTemplateId: from && from.kind !== 'version' ? from.templateId : null,
        sourceVersionId: from?.kind === 'version' ? from.versionId : null,
        createdByUserId: actor.userId,
        createdByPlatformAdminId: actor.platformAdminId,
      })
      .returning({ id: checklists.id });
    await tx.insert(checklistVersions).values({
      tenantId,
      checklistId: row!.id,
      state: 'draft',
      content,
      createdByUserId: actor.userId,
      createdByPlatformAdminId: actor.platformAdminId,
    });
    const dto = await this.get(row!.id);
    await this.audit.record({
      action: 'checklist.created',
      entityType: 'checklist',
      entityId: dto.id,
      after: { name: dto.name, description: dto.description, category: dto.category, source: dto.source },
    });
    return dto;
  }

  async update(id: string, input: UpdateChecklistDto): Promise<ChecklistDetail> {
    const c = await this.lockActive(id);
    const before = { name: c.name, description: c.description, category: c.category };
    await this.db
      .tx()
      .update(checklists)
      .set({ name: input.name, description: input.description, category: input.category, updatedAt: new Date() })
      .where(eq(checklists.id, id));
    const after = await this.get(id);
    await this.audit.record({
      action: 'checklist.updated',
      entityType: 'checklist',
      entityId: id,
      before,
      after: { name: after.name, description: after.description, category: after.category },
    });
    return after;
  }

  async startDraft(id: string, input: StartDraftDto): Promise<ChecklistVersion> {
    const c = await this.lockActive(id);
    const tx = this.db.tx();
    const [existing] = await tx.select({ id: checklistVersions.id }).from(checklistVersions).where(and(eq(checklistVersions.checklistId, id), eq(checklistVersions.state, 'draft')));
    if (existing) throw new AppError('CHECKLIST_DRAFT_EXISTS');
    const sourceId = input.fromVersionId ?? c.currentVersionId;
    let content: ChecklistContent = blankContent();
    let fromNumber: number | null = null;
    if (sourceId) {
      const [src] = await tx
        .select({ content: checklistVersions.content, number: checklistVersions.number })
        .from(checklistVersions)
        .where(and(eq(checklistVersions.id, sourceId), eq(checklistVersions.checklistId, id), eq(checklistVersions.state, 'published')));
      if (!src) throw new AppError('REFERENCE_NOT_FOUND');
      // Same node ids as the source version: results stay comparable across versions.
      content = storedContent(src.content);
      fromNumber = src.number;
    }
    const actor = actorColumns(this.db);
    await tx.insert(checklistVersions).values({
      tenantId: c.tenantId,
      checklistId: id,
      state: 'draft',
      content,
      createdByUserId: actor.userId,
      createdByPlatformAdminId: actor.platformAdminId,
    });
    await this.touch(id);
    await this.audit.record({ action: 'checklist.draft_started', entityType: 'checklist', entityId: id, after: { fromVersionNumber: fromNumber } });
    return this.getDraft(id);
  }

  async saveDraft(id: string, input: SaveContentDto): Promise<ContentSaveResult> {
    const content = parseDraftOrThrow(input.content);
    await this.lockActive(id);
    const draft = await this.lockDraft(id, input.revision);
    const revision = draft.revision + 1;
    await this.db.tx().update(checklistVersions).set({ content, revision, updatedAt: new Date() }).where(eq(checklistVersions.id, draft.id));
    await this.touch(id);
    return { revision, issues: validateForPublish(content) };
  }

  async discardDraft(id: string): Promise<void> {
    await this.lockActive(id);
    const tx = this.db.tx();
    const [draft] = await tx
      .delete(checklistVersions)
      .where(and(eq(checklistVersions.checklistId, id), eq(checklistVersions.state, 'draft')))
      .returning({ revision: checklistVersions.revision });
    if (!draft) throw new AppError('CHECKLIST_NO_DRAFT');
    await this.touch(id);
    await this.audit.record({ action: 'checklist.draft_discarded', entityType: 'checklist', entityId: id, before: { revision: draft.revision } });
  }

  async publish(id: string, input: PublishDto): Promise<ChecklistVersionSummary> {
    const c = await this.lockActive(id);
    const draft = await this.lockDraft(id, input.revision);
    const issues = validateForPublish(storedContent(draft.content));
    if (issues.length) throw new AppError('CHECKLIST_INVALID_CONTENT', { details: { issues } });
    const number = c.latestVersionNumber + 1;
    const actor = actorColumns(this.db);
    const now = new Date();
    const tx = this.db.tx();
    await tx
      .update(checklistVersions)
      .set({
        state: 'published',
        number,
        changeNote: input.changeNote ?? null,
        publishedByUserId: actor.userId,
        publishedByPlatformAdminId: actor.platformAdminId,
        publishedAt: now,
        updatedAt: now,
      })
      .where(eq(checklistVersions.id, draft.id));
    await tx.update(checklists).set({ currentVersionId: draft.id, latestVersionNumber: number, updatedAt: now }).where(eq(checklists.id, id));
    await this.audit.record({
      action: 'checklist.published',
      entityType: 'checklist',
      entityId: id,
      after: { versionId: draft.id, number, changeNote: input.changeNote ?? null },
    });
    const [row] = await this.selectVersions().where(eq(checklistVersions.id, draft.id));
    return toVersionSummary(row!);
  }

  deactivate(id: string): Promise<ChecklistDetail> {
    return this.setStatus(id, 'deactivated');
  }

  reactivate(id: string): Promise<ChecklistDetail> {
    return this.setStatus(id, 'active');
  }

  private async setStatus(id: string, status: 'active' | 'deactivated'): Promise<ChecklistDetail> {
    const c = await this.lock(id);
    if (c.status !== status) {
      await this.db.tx().update(checklists).set({ status, updatedAt: new Date() }).where(eq(checklists.id, id));
      await this.audit.record({
        action: status === 'active' ? 'checklist.reactivated' : 'checklist.deactivated',
        entityType: 'checklist',
        entityId: id,
        before: { status: c.status },
        after: { status },
      });
    }
    return this.get(id);
  }

  // ---- helpers ----

  private draftRevisionSql() {
    return sql<number | null>`(select v.revision from checklist_versions v where v.checklist_id = ${checklists.id} and v.state = 'draft')`;
  }

  private selectSummaries() {
    return this.db
      .tx()
      .select({ ...getTableColumns(checklists), draftRevision: this.draftRevisionSql() })
      .from(checklists)
      .$dynamic();
  }

  private selectVersions() {
    return this.db
      .tx()
      .select({
        id: checklistVersions.id,
        number: checklistVersions.number,
        state: checklistVersions.state,
        changeNote: checklistVersions.changeNote,
        publishedAt: checklistVersions.publishedAt,
        publishedByUserId: checklistVersions.publishedByUserId,
        publishedByPlatformAdminId: checklistVersions.publishedByPlatformAdminId,
        publisherName: users.fullName,
        createdAt: checklistVersions.createdAt,
      })
      .from(checklistVersions)
      .leftJoin(users, eq(users.id, checklistVersions.publishedByUserId))
      .$dynamic();
  }

  private async versionDto(where: SQL | undefined, missing: 'NOT_FOUND' | 'CHECKLIST_NO_DRAFT'): Promise<ChecklistVersion> {
    const [row] = await this.db
      .tx()
      .select({ v: getTableColumns(checklistVersions), publisherName: users.fullName })
      .from(checklistVersions)
      .leftJoin(users, eq(users.id, checklistVersions.publishedByUserId))
      .where(where);
    if (!row) throw new AppError(missing);
    const summary: VersionRow = { ...row.v, publisherName: row.publisherName };
    return { ...toVersionSummary(summary), checklistId: row.v.checklistId, revision: row.v.revision, content: storedContent(row.v.content) };
  }

  private async find(id: string): Promise<ChecklistRecord> {
    const [c] = await this.db.tx().select().from(checklists).where(eq(checklists.id, id));
    if (!c) throw new AppError('NOT_FOUND');
    return c;
  }

  /** Row lock: serialises publish/draft changes per checklist (no duplicate version numbers). */
  private async lock(id: string): Promise<ChecklistRecord> {
    const [c] = await this.db.tx().select().from(checklists).where(eq(checklists.id, id)).for('update');
    if (!c) throw new AppError('NOT_FOUND');
    return c;
  }

  private async lockActive(id: string): Promise<ChecklistRecord> {
    const c = await this.lock(id);
    if (c.status !== 'active') throw new AppError('CHECKLIST_DEACTIVATED');
    return c;
  }

  private async lockDraft(id: string, revision: number) {
    const [draft] = await this.db
      .tx()
      .select()
      .from(checklistVersions)
      .where(and(eq(checklistVersions.checklistId, id), eq(checklistVersions.state, 'draft')))
      .for('update');
    if (!draft) throw new AppError('CHECKLIST_NO_DRAFT');
    if (draft.revision !== revision) throw new AppError('CHECKLIST_DRAFT_CONFLICT', { details: { currentRevision: draft.revision } });
    return draft;
  }

  private async touch(id: string): Promise<void> {
    await this.db.tx().update(checklists).set({ updatedAt: new Date() }).where(eq(checklists.id, id));
  }
}
```

The `ChecklistContentSource` abstract class is the DI token. Task 8 provides `{ provide: ChecklistContentSource, useExisting: TemplatesService }`. Until then `@Optional()` leaves it undefined.

- [ ] **Step 6: DTOs, route-mode helpers, controller factory, module**

`apps/api/src/checklists/dto.ts`:
```ts
import {
  checklistDetailSchema,
  checklistListQuerySchema,
  checklistSummarySchema,
  checklistVersionSchema,
  checklistVersionSummarySchema,
  contentSaveResultSchema,
  createChecklistInputSchema,
  createTemplateInputSchema,
  globalTemplateSchema,
  globalTemplateSummarySchema,
  pageOf,
  publishInputSchema,
  saveAsTemplateInputSchema,
  saveContentInputSchema,
  startDraftInputSchema,
  templateListQuerySchema,
  templateSchema,
  templateSummarySchema,
  updateChecklistInputSchema,
  updateGlobalTemplateInputSchema,
  updateTemplateInputSchema,
} from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class ChecklistListQueryDto extends createZodDto(checklistListQuerySchema) {}
export class CreateChecklistDto extends createZodDto(createChecklistInputSchema) {}
export class UpdateChecklistDto extends createZodDto(updateChecklistInputSchema) {}
export class StartDraftDto extends createZodDto(startDraftInputSchema) {}
export class SaveContentDto extends createZodDto(saveContentInputSchema) {}
export class PublishDto extends createZodDto(publishInputSchema) {}
export class SaveAsTemplateDto extends createZodDto(saveAsTemplateInputSchema) {}
export class TemplateListQueryDto extends createZodDto(templateListQuerySchema) {}
export class CreateTemplateDto extends createZodDto(createTemplateInputSchema) {}
export class UpdateTemplateDto extends createZodDto(updateTemplateInputSchema) {}
export class UpdateGlobalTemplateDto extends createZodDto(updateGlobalTemplateInputSchema) {}

export class ChecklistPageResponse extends createZodDto(pageOf(checklistSummarySchema)) {}
export class ChecklistDetailResponse extends createZodDto(checklistDetailSchema) {}
export class ChecklistVersionResponse extends createZodDto(checklistVersionSchema) {}
export class ChecklistVersionSummaryResponse extends createZodDto(checklistVersionSummarySchema) {}
export class ContentSaveResultResponse extends createZodDto(contentSaveResultSchema) {}
export class TemplateSummaryResponse extends createZodDto(templateSummarySchema) {}
export class TemplateResponse extends createZodDto(templateSchema) {}
export class GlobalTemplateSummaryResponse extends createZodDto(globalTemplateSummarySchema) {}
export class GlobalTemplateResponse extends createZodDto(globalTemplateSchema) {}
```

If `createZodDto` fails on `checklistContentSchema` because of the `z.lazy` recursion when building OpenAPI, the symptom is a startup error in `SwaggerModule.createDocument`. In that case change only the five *Response* classes whose schema contains content (`ChecklistVersionResponse`, `TemplateResponse`, `GlobalTemplateResponse`) to `extends createZodDto(<schema>.omit({ content: true }).extend({ content: z.record(z.string(), z.unknown()) }))`. Swagger then documents `content` as an object. Request validation is unaffected, because content goes through `parseDraftOrThrow`.

`apps/api/src/checklists/route-mode.ts`:
```ts
import { applyDecorators, Controller, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { PermissionKey } from '@taskop/contracts';
import { Public, RequirePermission } from '../common/decorators';
import { PlatformGuard } from '../platform/platform.guard';
import { PlatformTenantInterceptor } from './platform-tenant.interceptor';

export type RouteMode = 'tenant' | 'platform';

const noop: MethodDecorator = () => undefined;

/** Tenant routes check role permissions; platform admins hold every checklist permission (spec §6.2). */
export const perm = (mode: RouteMode, ...keys: PermissionKey[]): MethodDecorator => (mode === 'tenant' ? RequirePermission(...keys) : noop);

/** `path` is relative: tenant → `/<path>`, platform → `/platform/tenants/:tenantId/<path>`. */
export function controllerDecorators(mode: RouteMode, path: string, tag: string): ClassDecorator {
  return mode === 'tenant'
    ? applyDecorators(ApiTags(tag), ApiBearerAuth(), Controller(path))
    : applyDecorators(
        ApiTags('platform'),
        ApiBearerAuth(),
        Public(),
        UseGuards(PlatformGuard),
        UseInterceptors(PlatformTenantInterceptor),
        Controller(`platform/tenants/:tenantId/${path}`),
      );
}

export function named<T extends abstract new (...args: never[]) => unknown>(cls: T, name: string): T {
  Object.defineProperty(cls, 'name', { value: name });
  return cls;
}
```

`apps/api/src/checklists/platform-tenant.interceptor.ts`:
```ts
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { from, lastValueFrom, Observable } from 'rxjs';
import { AppError } from '../common/app-error';
import { ParseIdPipe } from '../common/parse-id.pipe';
import type { AppRequest } from '../common/request';
import { DbService } from '../db/db.service';
import { tenants } from '../db/schema';

/**
 * Platform admins working inside a customer's tenant (FR-24.03): the handler runs in the normal
 * app-connection tenant transaction (RLS applies), with the admin recorded as the actor.
 */
@Injectable()
export class PlatformTenantInterceptor implements NestInterceptor {
  constructor(private readonly db: DbService) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const adminId = req.platformAdminId;
    if (!adminId) throw new AppError('UNAUTHENTICATED');
    const tenantId = new ParseIdPipe().transform(String(req.params.tenantId ?? ''));
    const [tenant] = await this.db.platform.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) throw new AppError('NOT_FOUND');
    return from(
      this.db.withTenant(tenantId, null, () => lastValueFrom(next.handle(), { defaultValue: undefined }), { platformAdminId: adminId }),
    );
  }
}
```

`apps/api/src/checklists/checklists.controller.ts`:
```ts
import { Body, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { ChecklistDetail, ChecklistSummary, ChecklistVersion, ChecklistVersionSummary, ContentSaveResult, Page } from '@taskop/contracts';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { ChecklistsService } from './checklists.service';
import {
  ChecklistDetailResponse,
  ChecklistListQueryDto,
  ChecklistPageResponse,
  ChecklistVersionResponse,
  ChecklistVersionSummaryResponse,
  ContentSaveResultResponse,
  CreateChecklistDto,
  PublishDto,
  SaveContentDto,
  StartDraftDto,
  UpdateChecklistDto,
} from './dto';
import { controllerDecorators, named, perm, type RouteMode } from './route-mode';

export function checklistsControllerFor(mode: RouteMode) {
  const view = perm(mode, 'checklists.view');
  const manage = perm(mode, 'checklists.view', 'checklists.manage');
  const publish = perm(mode, 'checklists.view', 'checklists.publish');

  @controllerDecorators(mode, 'checklists', 'checklists')
  class ChecklistsController {
    constructor(@Inject(ChecklistsService) private readonly checklists: ChecklistsService) {}

    @Get()
    @view
    @ApiOkResponse({ type: ChecklistPageResponse })
    list(@Query() q: ChecklistListQueryDto): Promise<Page<ChecklistSummary>> {
      return this.checklists.list(q);
    }

    @Post()
    @manage
    @ApiOkResponse({ type: ChecklistDetailResponse })
    create(@Body() body: CreateChecklistDto): Promise<ChecklistDetail> {
      return this.checklists.create(body);
    }

    @Get(':id')
    @view
    @ApiOkResponse({ type: ChecklistDetailResponse })
    get(@Param('id', ParseIdPipe) id: string): Promise<ChecklistDetail> {
      return this.checklists.get(id);
    }

    @Patch(':id')
    @manage
    @ApiOkResponse({ type: ChecklistDetailResponse })
    update(@Param('id', ParseIdPipe) id: string, @Body() body: UpdateChecklistDto): Promise<ChecklistDetail> {
      return this.checklists.update(id, body);
    }

    @Get(':id/versions/:versionId')
    @view
    @ApiOkResponse({ type: ChecklistVersionResponse })
    version(@Param('id', ParseIdPipe) id: string, @Param('versionId', ParseIdPipe) versionId: string): Promise<ChecklistVersion> {
      return this.checklists.getVersion(id, versionId);
    }

    @Get(':id/draft')
    @view
    @ApiOkResponse({ type: ChecklistVersionResponse })
    draft(@Param('id', ParseIdPipe) id: string): Promise<ChecklistVersion> {
      return this.checklists.getDraft(id);
    }

    @Post(':id/draft')
    @manage
    @ApiOkResponse({ type: ChecklistVersionResponse })
    startDraft(@Param('id', ParseIdPipe) id: string, @Body() body: StartDraftDto): Promise<ChecklistVersion> {
      return this.checklists.startDraft(id, body);
    }

    @Put(':id/draft')
    @manage
    @ApiOkResponse({ type: ContentSaveResultResponse })
    saveDraft(@Param('id', ParseIdPipe) id: string, @Body() body: SaveContentDto): Promise<ContentSaveResult> {
      return this.checklists.saveDraft(id, body);
    }

    @Delete(':id/draft')
    @HttpCode(204)
    @manage
    discardDraft(@Param('id', ParseIdPipe) id: string): Promise<void> {
      return this.checklists.discardDraft(id);
    }

    @Post(':id/publish')
    @HttpCode(200)
    @publish
    @ApiOkResponse({ type: ChecklistVersionSummaryResponse })
    publishDraft(@Param('id', ParseIdPipe) id: string, @Body() body: PublishDto): Promise<ChecklistVersionSummary> {
      return this.checklists.publish(id, body);
    }

    @Post(':id/deactivate')
    @HttpCode(200)
    @manage
    @ApiOkResponse({ type: ChecklistDetailResponse })
    deactivate(@Param('id', ParseIdPipe) id: string): Promise<ChecklistDetail> {
      return this.checklists.deactivate(id);
    }

    @Post(':id/reactivate')
    @HttpCode(200)
    @manage
    @ApiOkResponse({ type: ChecklistDetailResponse })
    reactivate(@Param('id', ParseIdPipe) id: string): Promise<ChecklistDetail> {
      return this.checklists.reactivate(id);
    }
  }
  return named(ChecklistsController, mode === 'tenant' ? 'ChecklistsController' : 'PlatformTenantChecklistsController');
}

export const TenantChecklistsController = checklistsControllerFor('tenant');
export const PlatformTenantChecklistsController = checklistsControllerFor('platform');
```

`apps/api/src/checklists/checklists.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { TenantChecklistsController } from './checklists.controller';
import { ChecklistsService } from './checklists.service';
import { PlatformTenantInterceptor } from './platform-tenant.interceptor';

@Module({
  imports: [PlatformModule],
  controllers: [TenantChecklistsController],
  providers: [ChecklistsService, PlatformTenantInterceptor],
})
export class ChecklistsModule {}
```

`apps/api/src/platform/platform.module.ts`: add `exports: [PlatformGuard]`, keeping `imports: [AuthModule]` so `TokenService` resolves. Because `PlatformGuard` is used through `@UseGuards` in another module, Nest instantiates it in the *using* module's injector. Its dependencies (`TokenService`, `DbService`) must be visible there. `DbService` is global. For `TokenService`, also add `exports: [PlatformGuard, AuthModule]` (re-export) so `ChecklistsModule` sees `TokenService`.

`apps/api/src/app.module.ts`: import `ChecklistsModule` and append it to `imports`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- test/checklists.test.ts`
Expected: PASS (9 tests).

`hasDraft=false` returns 0 items because every new checklist has a draft. `limit=2` returns newest first.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/checklists apps/api/src/app.module.ts apps/api/src/platform/platform.module.ts apps/api/test/checklists.test.ts apps/api/test/checklist-fixtures.ts apps/api/test/fixtures.ts
git commit -m "feat(api): add checklists with draft/publish lifecycle and immutable versions"
```

---

### Task 8: Tenant templates, create-from-template, save-as-template

**Files:**
- Create: `apps/api/src/checklists/templates.service.ts`, `apps/api/src/checklists/templates.controller.ts`
- Modify: `apps/api/src/checklists/checklists.controller.ts` (add the save-as-template route), `apps/api/src/checklists/checklists.module.ts`
- Test: `apps/api/test/templates.test.ts`

**Interfaces:**
- Consumes: `ChecklistContentSource` (Task 7), `parseDraftOrThrow`, `storedContent`, `actorColumns`.
- Produces:
  - `TemplatesService`:
    - `list(q): TemplateSummary[]`, `get(source, id): TemplateDto`
    - `create(input)`, `update(id, input)`, `saveContent(id, input): ContentSaveResult`
    - `deactivate(id)`, `reactivate(id)`
    - `saveVersionAsTemplate(checklistId, versionId, input): TemplateDto`
    - `contentFromTemplate(kind, id)`
  - Routes: `GET /templates`, `GET /templates/global/:id`, `GET /templates/tenant/:id`, `POST /templates`, `PATCH /templates/:id`, `PUT /templates/:id/content`, `POST /templates/:id/deactivate|reactivate`, `POST /checklists/:id/versions/:versionId/save-as-template`
  - The factory `templatesControllerFor(mode)` → `TenantTemplatesController`, `PlatformTenantTemplatesController`

- [ ] **Step 1: Write the failing test**

`apps/api/test/templates.test.ts`:
```ts
import { blankContent } from '@taskop/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { sampleContent } from './checklist-fixtures';
import { as, createUserDirect, loginStaff, signupTenant } from './fixtures';
import { ownerQuery } from './owner-db';

const T = '/api/v1/templates';
const C = '/api/v1/checklists';

describe('templates', () => {
  let t: TestApp;
  let globalId: string;
  let hiddenId: string;
  beforeAll(async () => {
    t = await createTestApp();
    const ins = await ownerQuery<{ id: string }>(
      `insert into global_templates (id, name, category, content, item_count, published, sort_order) values
       (gen_random_uuid(), 'Taskop: Mətbəx', 'restaurant', $1::jsonb, 2, true, 1),
       (gen_random_uuid(), 'Taskop: Gizli', 'restaurant', $1::jsonb, 2, false, 2) returning id`,
      [JSON.stringify(sampleContent())],
    );
    [globalId, hiddenId] = ins.rows.map((r) => r.id) as [string, string];
  });
  afterAll(() => t.close());

  it('lists published global templates and own templates; hides unpublished ones', async () => {
    const s = await signupTenant(t);
    const api = as(t, s.accessToken);
    const own = (await api.post(T, { name: 'Bizim şablon', category: 'retail' })).body;
    expect(own).toMatchObject({ source: 'tenant', status: 'active', itemCount: 0, revision: 1 });
    const all = (await api.get(T)).body as Array<{ id: string; source: string }>;
    expect(all.map((x) => x.id)).toEqual(expect.arrayContaining([globalId, own.id]));
    expect(all.map((x) => x.id)).not.toContain(hiddenId);
    expect(((await api.get(`${T}?source=tenant`)).body as unknown[]).length).toBe(1);
    expect((await api.get(`${T}/global/${hiddenId}`)).status).toBe(404);
    expect((await api.get(`${T}/global/${globalId}`)).body.content.sections[0].items).toHaveLength(1);
  });

  it('creates a checklist from a global template with fresh ids and records the source', async () => {
    const s = await signupTenant(t);
    const api = as(t, s.accessToken);
    const tpl = (await api.get(`${T}/global/${globalId}`)).body;
    const created = (await api.post(C, { name: 'Mətbəx', from: { kind: 'global', templateId: globalId } })).body;
    expect(created.source).toEqual({ kind: 'global', id: globalId });
    const draft = (await api.get(`${C}/${created.id}/draft`)).body.content;
    expect(draft.sections[0].items[0].id).not.toBe(tpl.content.sections[0].items[0].id);
    expect((await api.post(`${C}/${created.id}/publish`, { revision: 1 })).status).toBe(200);
    expect((await api.post(C, { name: 'X', from: { kind: 'global', templateId: hiddenId } })).status).toBe(422);
  });

  it('saves a published version as a tenant template and uses it', async () => {
    const s = await signupTenant(t);
    const api = as(t, s.accessToken);
    const c = (await api.post(C, { name: 'X' })).body;
    await api.put(`${C}/${c.id}/draft`, { content: sampleContent(), revision: 1 });
    const v1 = (await api.post(`${C}/${c.id}/publish`, { revision: 2 })).body;
    const tpl = await api.post(`${C}/${c.id}/versions/${v1.id}/save-as-template`, { name: 'Bizim', category: 'safety' });
    expect(tpl.status, JSON.stringify(tpl.body)).toBe(201);
    expect(tpl.body).toMatchObject({ source: 'tenant', category: 'safety', itemCount: 2 });
    const fromTpl = (await api.post(C, { name: 'Y', from: { kind: 'tenant', templateId: tpl.body.id } })).body;
    expect(fromTpl.source).toEqual({ kind: 'tenant', id: tpl.body.id });
    expect((await api.get(`${C}/${fromTpl.id}/draft`)).body.content.sections[0].items).toHaveLength(1);
  });

  it('edits template content with revisions and blocks a deactivated template', async () => {
    const s = await signupTenant(t);
    const api = as(t, s.accessToken);
    const tpl = (await api.post(T, { name: 'A', category: 'other' })).body;
    expect((await api.put(`${T}/${tpl.id}/content`, { content: sampleContent(), revision: 1 })).body).toEqual({ revision: 2, issues: [] });
    expect((await api.put(`${T}/${tpl.id}/content`, { content: blankContent(), revision: 1 })).body.error).toMatchObject({ code: 'TEMPLATE_CONFLICT', currentRevision: 2 });
    expect((await api.get(`${T}/tenant/${tpl.id}`)).body.itemCount).toBe(2);
    expect((await api.post(`${T}/${tpl.id}/deactivate`)).body.status).toBe('deactivated');
    expect((await api.post(C, { name: 'Z', from: { kind: 'tenant', templateId: tpl.id } })).body.error.code).toBe('TEMPLATE_DEACTIVATED');
    expect((await api.patch(`${T}/${tpl.id}`, { name: 'B' })).body.error.code).toBe('TEMPLATE_DEACTIVATED');
    expect((await api.post(`${T}/${tpl.id}/reactivate`)).body.status).toBe('active');
    const audit = await ownerQuery<{ action: string }>('select action from audit_log where entity_id = $1 order by occurred_at, id', [tpl.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['template.created', 'template.updated', 'template.deactivated', 'template.reactivated']);
  });

  it('requires templates.manage to change templates; manage is enough to browse', async () => {
    const s = await signupTenant(t);
    const mgr = await createUserDirect(t, s.tenantId, { kind: 'staff', roleKey: 'manager', emailVerified: true });
    const api = as(t, (await loginStaff(t, mgr.email!, mgr.secret)).accessToken);
    expect((await api.get(T)).status).toBe(200);
    expect((await api.post(T, { name: 'A', category: 'other' })).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @taskop/api test -- test/templates.test.ts`
Expected: FAIL with 404 on `/api/v1/templates`.

- [ ] **Step 3: The service**

`apps/api/src/checklists/templates.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import {
  blankContent,
  type ChecklistContent,
  type ContentSaveResult,
  countItems,
  regenerateIds,
  type TemplateDto,
  type TemplateSummary,
  validateForPublish,
} from '@taskop/contracts';
import { and, asc, eq, ilike, type SQL } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { escapeLike } from '../common/sql';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { checklistVersions, globalTemplatesPublished, tenantTemplates } from '../db/schema';
import { actorColumns } from './actor';
import { ChecklistContentSource } from './checklists.service';
import { parseDraftOrThrow, storedContent } from './content';
import type { CreateTemplateDto, SaveAsTemplateDto, SaveContentDto, TemplateListQueryDto, UpdateTemplateDto } from './dto';

type TenantTemplateRow = typeof tenantTemplates.$inferSelect;
type GlobalRow = typeof globalTemplatesPublished.$inferSelect;

const tenantSummary = (r: TenantTemplateRow): TemplateSummary => ({
  id: r.id,
  source: 'tenant',
  name: r.name,
  description: r.description,
  category: r.category,
  status: r.status,
  itemCount: r.itemCount,
  updatedAt: r.updatedAt.toISOString(),
});
const globalSummary = (r: GlobalRow): TemplateSummary => ({
  id: r.id,
  source: 'global',
  name: r.name,
  description: r.description,
  category: r.category,
  status: 'active',
  itemCount: r.itemCount,
  updatedAt: r.updatedAt.toISOString(),
});
const meta = (r: { name: string; description: string | null; category: string }) => ({ name: r.name, description: r.description, category: r.category });

@Injectable()
export class TemplatesService extends ChecklistContentSource {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async list(q: TemplateListQueryDto): Promise<TemplateSummary[]> {
    const like = q.q ? `%${escapeLike(q.q)}%` : null;
    const out: TemplateSummary[] = [];
    if (q.source !== 'tenant' && q.status !== 'deactivated') {
      const g: (SQL | undefined)[] = [];
      if (q.category) g.push(eq(globalTemplatesPublished.category, q.category));
      if (like) g.push(ilike(globalTemplatesPublished.name, like));
      const rows = await this.db
        .tx()
        .select()
        .from(globalTemplatesPublished)
        .where(and(...g))
        .orderBy(asc(globalTemplatesPublished.sortOrder), asc(globalTemplatesPublished.name));
      out.push(...rows.map(globalSummary));
    }
    if (q.source !== 'global') {
      const c: (SQL | undefined)[] = [];
      if (q.category) c.push(eq(tenantTemplates.category, q.category));
      if (q.status) c.push(eq(tenantTemplates.status, q.status));
      if (like) c.push(ilike(tenantTemplates.name, like));
      const rows = await this.db.tx().select().from(tenantTemplates).where(and(...c)).orderBy(asc(tenantTemplates.name));
      out.push(...rows.map(tenantSummary));
    }
    return out;
  }

  async get(source: 'global' | 'tenant', id: string): Promise<TemplateDto> {
    if (source === 'global') {
      const [r] = await this.db.tx().select().from(globalTemplatesPublished).where(eq(globalTemplatesPublished.id, id));
      if (!r) throw new AppError('NOT_FOUND');
      return { ...globalSummary(r), revision: r.revision, content: storedContent(r.content) };
    }
    const r = await this.find(id);
    return { ...tenantSummary(r), revision: r.revision, content: storedContent(r.content) };
  }

  async contentFromTemplate(kind: 'global' | 'tenant', templateId: string): Promise<ChecklistContent> {
    let raw: unknown;
    if (kind === 'global') {
      const [r] = await this.db.tx().select({ content: globalTemplatesPublished.content }).from(globalTemplatesPublished).where(eq(globalTemplatesPublished.id, templateId));
      if (!r) throw new AppError('REFERENCE_NOT_FOUND');
      raw = r.content;
    } else {
      const [r] = await this.db.tx().select().from(tenantTemplates).where(eq(tenantTemplates.id, templateId));
      if (!r) throw new AppError('REFERENCE_NOT_FOUND');
      if (r.status !== 'active') throw new AppError('TEMPLATE_DEACTIVATED');
      raw = r.content;
    }
    return regenerateIds(storedContent(raw));
  }

  async create(input: CreateTemplateDto): Promise<TemplateDto> {
    const content = input.content === undefined ? blankContent() : parseDraftOrThrow(input.content);
    return this.insert({ name: input.name, description: input.description ?? null, category: input.category, content });
  }

  async saveVersionAsTemplate(checklistId: string, versionId: string, input: SaveAsTemplateDto): Promise<TemplateDto> {
    const [v] = await this.db
      .tx()
      .select({ content: checklistVersions.content })
      .from(checklistVersions)
      .where(and(eq(checklistVersions.id, versionId), eq(checklistVersions.checklistId, checklistId), eq(checklistVersions.state, 'published')));
    if (!v) throw new AppError('NOT_FOUND');
    return this.insert({
      name: input.name,
      description: input.description ?? null,
      category: input.category,
      content: regenerateIds(storedContent(v.content)),
      sourceChecklistId: checklistId,
      sourceVersionId: versionId,
    });
  }

  async update(id: string, input: UpdateTemplateDto): Promise<TemplateDto> {
    const before = await this.lockActive(id);
    await this.db
      .tx()
      .update(tenantTemplates)
      .set({ name: input.name, description: input.description, category: input.category, updatedAt: new Date() })
      .where(eq(tenantTemplates.id, id));
    const after = await this.get('tenant', id);
    await this.audit.record({ action: 'template.updated', entityType: 'template', entityId: id, before: meta(before), after: meta(after) });
    return after;
  }

  async saveContent(id: string, input: SaveContentDto): Promise<ContentSaveResult> {
    const content = parseDraftOrThrow(input.content);
    const row = await this.lockActive(id);
    if (row.revision !== input.revision) throw new AppError('TEMPLATE_CONFLICT', { details: { currentRevision: row.revision } });
    const revision = row.revision + 1;
    await this.db
      .tx()
      .update(tenantTemplates)
      .set({ content, revision, itemCount: countItems(content), updatedAt: new Date() })
      .where(eq(tenantTemplates.id, id));
    await this.audit.record({ action: 'template.updated', entityType: 'template', entityId: id, before: { revision: row.revision }, after: { revision } });
    return { revision, issues: validateForPublish(content) };
  }

  deactivate(id: string): Promise<TemplateDto> {
    return this.setStatus(id, 'deactivated');
  }

  reactivate(id: string): Promise<TemplateDto> {
    return this.setStatus(id, 'active');
  }

  private async setStatus(id: string, status: 'active' | 'deactivated'): Promise<TemplateDto> {
    const row = await this.lock(id);
    if (row.status !== status) {
      await this.db.tx().update(tenantTemplates).set({ status, updatedAt: new Date() }).where(eq(tenantTemplates.id, id));
      await this.audit.record({
        action: status === 'active' ? 'template.reactivated' : 'template.deactivated',
        entityType: 'template',
        entityId: id,
        before: { status: row.status },
        after: { status },
      });
    }
    return this.get('tenant', id);
  }

  private async insert(v: {
    name: string;
    description: string | null;
    category: TenantTemplateRow['category'];
    content: ChecklistContent;
    sourceChecklistId?: string;
    sourceVersionId?: string;
  }): Promise<TemplateDto> {
    const { tenantId } = this.db.context();
    const actor = actorColumns(this.db);
    const [row] = await this.db
      .tx()
      .insert(tenantTemplates)
      .values({
        tenantId,
        name: v.name,
        description: v.description,
        category: v.category,
        content: v.content,
        itemCount: countItems(v.content),
        sourceChecklistId: v.sourceChecklistId ?? null,
        sourceVersionId: v.sourceVersionId ?? null,
        createdByUserId: actor.userId,
        createdByPlatformAdminId: actor.platformAdminId,
      })
      .returning({ id: tenantTemplates.id });
    const dto = await this.get('tenant', row!.id);
    await this.audit.record({
      action: 'template.created',
      entityType: 'template',
      entityId: dto.id,
      after: { ...meta(dto), sourceChecklistId: v.sourceChecklistId ?? null, sourceVersionId: v.sourceVersionId ?? null },
    });
    return dto;
  }

  private async find(id: string): Promise<TenantTemplateRow> {
    const [r] = await this.db.tx().select().from(tenantTemplates).where(eq(tenantTemplates.id, id));
    if (!r) throw new AppError('NOT_FOUND');
    return r;
  }

  private async lock(id: string): Promise<TenantTemplateRow> {
    const [r] = await this.db.tx().select().from(tenantTemplates).where(eq(tenantTemplates.id, id)).for('update');
    if (!r) throw new AppError('NOT_FOUND');
    return r;
  }

  private async lockActive(id: string): Promise<TenantTemplateRow> {
    const r = await this.lock(id);
    if (r.status !== 'active') throw new AppError('TEMPLATE_DEACTIVATED');
    return r;
  }
}
```

- [ ] **Step 4: The controller, save-as-template route and module wiring**

`apps/api/src/checklists/templates.controller.ts`:
```ts
import { Body, Get, HttpCode, Inject, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { ContentSaveResult, TemplateDto, TemplateSummary } from '@taskop/contracts';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { AppError } from '../common/app-error';
import { ContentSaveResultResponse, CreateTemplateDto, SaveContentDto, TemplateListQueryDto, TemplateResponse, TemplateSummaryResponse, UpdateTemplateDto } from './dto';
import { controllerDecorators, named, perm, type RouteMode } from './route-mode';
import { TemplatesService } from './templates.service';

export function templatesControllerFor(mode: RouteMode) {
  const browse = perm(mode, 'checklists.manage');
  const manage = perm(mode, 'templates.manage');

  @controllerDecorators(mode, 'templates', 'templates')
  class TemplatesController {
    constructor(@Inject(TemplatesService) private readonly templates: TemplatesService) {}

    @Get()
    @browse
    @ApiOkResponse({ type: [TemplateSummaryResponse] })
    list(@Query() q: TemplateListQueryDto): Promise<TemplateSummary[]> {
      return this.templates.list(q);
    }

    @Get(':source/:id')
    @browse
    @ApiOkResponse({ type: TemplateResponse })
    get(@Param('source') source: string, @Param('id', ParseIdPipe) id: string): Promise<TemplateDto> {
      if (source !== 'global' && source !== 'tenant') throw new AppError('NOT_FOUND');
      return this.templates.get(source, id);
    }

    @Post()
    @manage
    @ApiOkResponse({ type: TemplateResponse })
    create(@Body() body: CreateTemplateDto): Promise<TemplateDto> {
      return this.templates.create(body);
    }

    @Patch(':id')
    @manage
    @ApiOkResponse({ type: TemplateResponse })
    update(@Param('id', ParseIdPipe) id: string, @Body() body: UpdateTemplateDto): Promise<TemplateDto> {
      return this.templates.update(id, body);
    }

    @Put(':id/content')
    @manage
    @ApiOkResponse({ type: ContentSaveResultResponse })
    saveContent(@Param('id', ParseIdPipe) id: string, @Body() body: SaveContentDto): Promise<ContentSaveResult> {
      return this.templates.saveContent(id, body);
    }

    @Post(':id/deactivate')
    @HttpCode(200)
    @manage
    @ApiOkResponse({ type: TemplateResponse })
    deactivate(@Param('id', ParseIdPipe) id: string): Promise<TemplateDto> {
      return this.templates.deactivate(id);
    }

    @Post(':id/reactivate')
    @HttpCode(200)
    @manage
    @ApiOkResponse({ type: TemplateResponse })
    reactivate(@Param('id', ParseIdPipe) id: string): Promise<TemplateDto> {
      return this.templates.reactivate(id);
    }
  }
  return named(TemplatesController, mode === 'tenant' ? 'TemplatesController' : 'PlatformTenantTemplatesController');
}

export const TenantTemplatesController = templatesControllerFor('tenant');
export const PlatformTenantTemplatesController = templatesControllerFor('platform');
```
In `checklists.controller.ts`, inject `TemplatesService` as well, and add the route. Add to the factory's constructor:
```ts
    constructor(
      @Inject(ChecklistsService) private readonly checklists: ChecklistsService,
      @Inject(TemplatesService) private readonly templates: TemplatesService,
    ) {}
```
and the method:
```ts
    @Post(':id/versions/:versionId/save-as-template')
    @(perm(mode, 'checklists.view', 'templates.manage'))
    @ApiOkResponse({ type: TemplateResponse })
    saveAsTemplate(
      @Param('id', ParseIdPipe) id: string,
      @Param('versionId', ParseIdPipe) versionId: string,
      @Body() body: SaveAsTemplateDto,
    ): Promise<TemplateDto> {
      return this.templates.saveVersionAsTemplate(id, versionId, body);
    }
```
Add the imports `TemplatesService`, `SaveAsTemplateDto`, `TemplateResponse` and `type TemplateDto`.

`checklists.module.ts`:
```ts
@Module({
  imports: [PlatformModule],
  controllers: [TenantChecklistsController, TenantTemplatesController],
  providers: [
    ChecklistsService,
    TemplatesService,
    { provide: ChecklistContentSource, useExisting: TemplatesService },
    PlatformTenantInterceptor,
  ],
})
export class ChecklistsModule {}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- templates checklists`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/checklists apps/api/test/templates.test.ts
git commit -m "feat(api): add tenant templates, create-from-template and save-as-template"
```

---

### Task 9: Platform: global templates and building inside a tenant

**Files:**
- Create: `apps/api/src/checklists/global-templates.service.ts`, `apps/api/src/checklists/global-templates.controller.ts`
- Modify: `apps/api/src/checklists/checklists.module.ts`
- Test: `apps/api/test/global-templates.test.ts`

**Interfaces:**
- Consumes: `PlatformGuard`, `PlatformTenantInterceptor`, `PlatformTenantChecklistsController`, `PlatformTenantTemplatesController`, `AuditService.recordIn`.
- Produces:
  - `GlobalTemplatesService`:
    - `list(): GlobalTemplateSummary[]`, `get(id): GlobalTemplateDto`
    - `create(adminId, input)`, `update(adminId, id, input)`, `saveContent(adminId, id, input)`
    - `setPublished(adminId, id, published)`
  - Routes `/platform/templates[...]`. Platform-in-tenant routes are live under `/platform/tenants/:tenantId/{checklists,templates}`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/global-templates.test.ts`:
```ts
import { hash } from '@node-rs/argon2';
import { blankContent } from '@taskop/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { sampleContent } from './checklist-fixtures';
import { as, signupTenant, uniq } from './fixtures';
import { ownerQuery } from './owner-db';

describe('platform checklist authoring', () => {
  let t: TestApp;
  let token: string;
  let adminId: string;
  beforeAll(async () => {
    t = await createTestApp();
    const email = `${uniq('admin')}@taskop.az`;
    const r = await ownerQuery<{ id: string }>(
      "insert into platform_admins (id, email, credential_hash, full_name) values (gen_random_uuid(), $1, $2, 'Support') returning id",
      [email, await hash('platform password 1', { memoryCost: 1024, timeCost: 1, parallelism: 1 })],
    );
    adminId = r.rows[0]!.id;
    token = (await t.http().post('/api/v1/platform/auth/login').send({ email, password: 'platform password 1' })).body.accessToken;
  });
  afterAll(() => t.close());

  it('authors a global template and controls tenant visibility by publishing', async () => {
    const p = as(t, token);
    const created = await p.post('/api/v1/platform/templates', { name: 'Anbar qəbulu', category: 'warehouse' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ published: false, revision: 1 });
    const id = created.body.id;
    expect((await p.post(`/api/v1/platform/templates/${id}/publish`)).body.error.code).toBe('CHECKLIST_INVALID_CONTENT');
    expect((await p.put(`/api/v1/platform/templates/${id}/content`, { content: sampleContent(), revision: 1 })).body).toEqual({ revision: 2, issues: [] });
    expect((await p.put(`/api/v1/platform/templates/${id}/content`, { content: blankContent(), revision: 1 })).body.error.code).toBe('TEMPLATE_CONFLICT');
    const s = await signupTenant(t);
    const tenant = as(t, s.accessToken);
    expect((await tenant.get(`/api/v1/templates/global/${id}`)).status).toBe(404);
    expect((await p.post(`/api/v1/platform/templates/${id}/publish`)).body.published).toBe(true);
    expect((await tenant.get(`/api/v1/templates/global/${id}`)).body.itemCount).toBe(2);
    expect((await p.patch(`/api/v1/platform/templates/${id}`, { sortOrder: 5, name: 'Anbar qəbulu (yeni)' })).body).toMatchObject({ sortOrder: 5, name: 'Anbar qəbulu (yeni)' });
    await p.post(`/api/v1/platform/templates/${id}/unpublish`);
    expect((await tenant.get(`/api/v1/templates/global/${id}`)).status).toBe(404);
    const audit = await ownerQuery<{ action: string; tenant_id: string | null; actor_platform_admin_id: string }>(
      'select action, tenant_id, actor_platform_admin_id from audit_log where entity_id = $1 order by occurred_at, id',
      [id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'global_template.created', 'global_template.updated', 'global_template.published', 'global_template.updated', 'global_template.unpublished',
    ]);
    expect(audit.rows.every((r) => r.tenant_id === null && r.actor_platform_admin_id === adminId)).toBe(true);
  });

  it('builds and publishes a checklist inside a tenant with platform attribution', async () => {
    const s = await signupTenant(t);
    const other = await signupTenant(t);
    const p = as(t, token);
    const base = `/api/v1/platform/tenants/${s.tenantId}/checklists`;
    const c = await p.post(base, { name: 'Taskop tərəfindən' });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    await p.put(`${base}/${c.body.id}/draft`, { content: sampleContent(), revision: 1 });
    const v1 = (await p.post(`${base}/${c.body.id}/publish`, { revision: 2 })).body;
    expect(v1.publishedBy).toEqual({ kind: 'platform', name: null });
    const row = await ownerQuery('select created_by_user_id, created_by_platform_admin_id from checklists where id = $1', [c.body.id]);
    expect(row.rows[0]).toEqual({ created_by_user_id: null, created_by_platform_admin_id: adminId });
    const audit = await ownerQuery<{ tenant_id: string; actor_platform_admin_id: string; actor_user_id: string | null }>(
      "select tenant_id, actor_platform_admin_id, actor_user_id from audit_log where entity_id = $1 and action = 'checklist.published'",
      [c.body.id],
    );
    expect(audit.rows[0]).toEqual({ tenant_id: s.tenantId, actor_platform_admin_id: adminId, actor_user_id: null });
    expect((await as(t, s.accessToken).get(`/api/v1/checklists/${c.body.id}`)).status).toBe(200);
    expect((await as(t, other.accessToken).get(`/api/v1/checklists/${c.body.id}`)).status).toBe(404);
    expect((await p.get(`/api/v1/platform/tenants/${other.tenantId}/checklists/${c.body.id}`)).status).toBe(404);
    const tpl = await p.post(`/api/v1/platform/tenants/${s.tenantId}/templates`, { name: 'Hazır', category: 'other' });
    expect(tpl.status).toBe(201);
  });

  it('rejects tenant tokens and unknown tenants on platform routes', async () => {
    const s = await signupTenant(t);
    expect((await as(t, s.accessToken).get('/api/v1/platform/templates')).status).toBe(401);
    expect((await as(t, s.accessToken).get(`/api/v1/platform/tenants/${s.tenantId}/checklists`)).status).toBe(401);
    expect((await as(t, token).get('/api/v1/platform/tenants/0190a4d2-7c3e-7000-8000-000000000999/checklists')).status).toBe(404);
    expect((await as(t, token).get('/api/v1/platform/tenants/not-a-uuid/checklists')).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @taskop/api test -- global-templates`
Expected: FAIL with 404 on `/api/v1/platform/templates`.

- [ ] **Step 3: The global templates service**

`apps/api/src/checklists/global-templates.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import {
  blankContent,
  type ChecklistContent,
  type ContentSaveResult,
  countItems,
  type GlobalTemplateDto,
  type GlobalTemplateSummary,
  validateForPublish,
} from '@taskop/contracts';
import { asc, eq } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { AuditService } from '../db/audit.service';
import { DbService, type Tx } from '../db/db.service';
import { globalTemplates } from '../db/schema';
import { parseDraftOrThrow, storedContent } from './content';
import type { CreateTemplateDto, SaveContentDto, UpdateGlobalTemplateDto } from './dto';

type Row = typeof globalTemplates.$inferSelect;

const summary = (r: Row): GlobalTemplateSummary => ({
  id: r.id,
  name: r.name,
  description: r.description,
  category: r.category,
  published: r.published,
  sortOrder: r.sortOrder,
  itemCount: r.itemCount,
  updatedAt: r.updatedAt.toISOString(),
});
const dto = (r: Row): GlobalTemplateDto => ({ ...summary(r), revision: r.revision, content: storedContent(r.content) });
const meta = (r: Row) => ({ name: r.name, description: r.description, category: r.category, sortOrder: r.sortOrder });

/** Taskop's global library, on the platform connection (no tenant, no RLS). Audited as platform scope. */
@Injectable()
export class GlobalTemplatesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<GlobalTemplateSummary[]> {
    const rows = await this.db.platform.select().from(globalTemplates).orderBy(asc(globalTemplates.sortOrder), asc(globalTemplates.name));
    return rows.map(summary);
  }

  async get(id: string): Promise<GlobalTemplateDto> {
    const [r] = await this.db.platform.select().from(globalTemplates).where(eq(globalTemplates.id, id));
    if (!r) throw new AppError('NOT_FOUND');
    return dto(r);
  }

  async create(adminId: string, input: CreateTemplateDto): Promise<GlobalTemplateDto> {
    const content: ChecklistContent = input.content === undefined ? blankContent() : parseDraftOrThrow(input.content);
    return this.db.platform.transaction(async (tx) => {
      const [r] = await tx
        .insert(globalTemplates)
        .values({
          name: input.name,
          description: input.description ?? null,
          category: input.category,
          content,
          itemCount: countItems(content),
          createdByPlatformAdminId: adminId,
        })
        .returning();
      await this.log(tx, adminId, 'global_template.created', r!.id, undefined, meta(r!));
      return dto(r!);
    });
  }

  async update(adminId: string, id: string, input: UpdateGlobalTemplateDto): Promise<GlobalTemplateDto> {
    return this.db.platform.transaction(async (tx) => {
      const before = await this.lock(tx, id);
      const [r] = await tx
        .update(globalTemplates)
        .set({ name: input.name, description: input.description, category: input.category, sortOrder: input.sortOrder, updatedAt: new Date() })
        .where(eq(globalTemplates.id, id))
        .returning();
      await this.log(tx, adminId, 'global_template.updated', id, meta(before), meta(r!));
      return dto(r!);
    });
  }

  async saveContent(adminId: string, id: string, input: SaveContentDto): Promise<ContentSaveResult> {
    const content = parseDraftOrThrow(input.content);
    return this.db.platform.transaction(async (tx) => {
      const row = await this.lock(tx, id);
      if (row.revision !== input.revision) throw new AppError('TEMPLATE_CONFLICT', { details: { currentRevision: row.revision } });
      const revision = row.revision + 1;
      await tx.update(globalTemplates).set({ content, revision, itemCount: countItems(content), updatedAt: new Date() }).where(eq(globalTemplates.id, id));
      await this.log(tx, adminId, 'global_template.updated', id, { revision: row.revision }, { revision });
      return { revision, issues: validateForPublish(content) };
    });
  }

  async setPublished(adminId: string, id: string, published: boolean): Promise<GlobalTemplateDto> {
    return this.db.platform.transaction(async (tx) => {
      const row = await this.lock(tx, id);
      if (published) {
        const issues = validateForPublish(storedContent(row.content));
        if (issues.length) throw new AppError('CHECKLIST_INVALID_CONTENT', { details: { issues } });
      }
      if (row.published === published) return dto(row);
      const [r] = await tx.update(globalTemplates).set({ published, updatedAt: new Date() }).where(eq(globalTemplates.id, id)).returning();
      await this.log(tx, adminId, published ? 'global_template.published' : 'global_template.unpublished', id, { published: row.published }, { published });
      return dto(r!);
    });
  }

  private async lock(tx: Tx, id: string): Promise<Row> {
    const [r] = await tx.select().from(globalTemplates).where(eq(globalTemplates.id, id)).for('update');
    if (!r) throw new AppError('NOT_FOUND');
    return r;
  }

  private log(tx: Tx, adminId: string, action: string, id: string, before: unknown, after: unknown): Promise<void> {
    return this.audit.recordIn(tx, { tenantId: null, actorPlatformAdminId: adminId, action, entityType: 'global_template', entityId: id, before, after });
  }
}
```

- [ ] **Step 4: The controller and module wiring**

`apps/api/src/checklists/global-templates.controller.ts`:
```ts
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { ContentSaveResult, GlobalTemplateDto, GlobalTemplateSummary } from '@taskop/contracts';
import { Public } from '../common/decorators';
import { ParseIdPipe } from '../common/parse-id.pipe';
import type { AppRequest } from '../common/request';
import { PlatformGuard } from '../platform/platform.guard';
import { ContentSaveResultResponse, CreateTemplateDto, GlobalTemplateResponse, GlobalTemplateSummaryResponse, SaveContentDto, UpdateGlobalTemplateDto } from './dto';
import { GlobalTemplatesService } from './global-templates.service';

@ApiTags('platform')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformGuard)
@Controller('platform/templates')
export class GlobalTemplatesController {
  constructor(private readonly templates: GlobalTemplatesService) {}

  @Get()
  @ApiOkResponse({ type: [GlobalTemplateSummaryResponse] })
  list(): Promise<GlobalTemplateSummary[]> {
    return this.templates.list();
  }

  @Get(':id')
  @ApiOkResponse({ type: GlobalTemplateResponse })
  get(@Param('id', ParseIdPipe) id: string): Promise<GlobalTemplateDto> {
    return this.templates.get(id);
  }

  @Post()
  @ApiOkResponse({ type: GlobalTemplateResponse })
  create(@Req() req: AppRequest, @Body() body: CreateTemplateDto): Promise<GlobalTemplateDto> {
    return this.templates.create(req.platformAdminId!, body);
  }

  @Patch(':id')
  @ApiOkResponse({ type: GlobalTemplateResponse })
  update(@Req() req: AppRequest, @Param('id', ParseIdPipe) id: string, @Body() body: UpdateGlobalTemplateDto): Promise<GlobalTemplateDto> {
    return this.templates.update(req.platformAdminId!, id, body);
  }

  @Put(':id/content')
  @ApiOkResponse({ type: ContentSaveResultResponse })
  saveContent(@Req() req: AppRequest, @Param('id', ParseIdPipe) id: string, @Body() body: SaveContentDto): Promise<ContentSaveResult> {
    return this.templates.saveContent(req.platformAdminId!, id, body);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @ApiOkResponse({ type: GlobalTemplateResponse })
  publish(@Req() req: AppRequest, @Param('id', ParseIdPipe) id: string): Promise<GlobalTemplateDto> {
    return this.templates.setPublished(req.platformAdminId!, id, true);
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @ApiOkResponse({ type: GlobalTemplateResponse })
  unpublish(@Req() req: AppRequest, @Param('id', ParseIdPipe) id: string): Promise<GlobalTemplateDto> {
    return this.templates.setPublished(req.platformAdminId!, id, false);
  }
}
```

`checklists.module.ts`, the final version:
```ts
import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { PlatformTenantChecklistsController, TenantChecklistsController } from './checklists.controller';
import { ChecklistContentSource, ChecklistsService } from './checklists.service';
import { GlobalTemplatesController } from './global-templates.controller';
import { GlobalTemplatesService } from './global-templates.service';
import { PlatformTenantInterceptor } from './platform-tenant.interceptor';
import { PlatformTenantTemplatesController, TenantTemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Module({
  imports: [PlatformModule],
  controllers: [
    TenantChecklistsController,
    TenantTemplatesController,
    PlatformTenantChecklistsController,
    PlatformTenantTemplatesController,
    GlobalTemplatesController,
  ],
  providers: [
    ChecklistsService,
    TemplatesService,
    { provide: ChecklistContentSource, useExisting: TemplatesService },
    GlobalTemplatesService,
    PlatformTenantInterceptor,
  ],
})
export class ChecklistsModule {}
```

Route ordering: `GlobalTemplatesController` (`platform/templates`) and `PlatformTenantTemplatesController` (`platform/tenants/:tenantId/templates`) don't overlap. The existing `PlatformTenantsController` (`platform/tenants`) defines only `GET /` and `POST /:id/suspend|reactivate`, so `/platform/tenants/:tenantId/checklists` doesn't collide.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- global-templates platform openapi`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/checklists apps/api/test/global-templates.test.ts
git commit -m "feat(api): add platform global templates and checklist authoring inside tenants"
```

---

### Task 10: Seed global templates and demo checklists

**Files:**
- Create: `apps/api/src/db/scripts/seed-templates.ts`
- Modify: `apps/api/src/db/scripts/seed.ts`
- Test: `apps/api/test/seed-templates.test.ts`

**Interfaces:**
- Consumes: `newItem`, `newRule`, `newSection`, `blankContent`, `validateForPublish`, `countItems`, `regenerateIds`.
- Produces: `GLOBAL_TEMPLATE_FIXTURES: Array<{ id: string; name: string; description: string; category: TemplateCategory; sortOrder: number; build: () => ChecklistContent }>`, with 8 entries, one per category except `other`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/seed-templates.test.ts`:
```ts
import { countItems, hasRules, validateForPublish, walkItems } from '@taskop/contracts';
import { describe, expect, it } from 'vitest';
import { GLOBAL_TEMPLATE_FIXTURES } from '../src/db/scripts/seed-templates';

describe('global template fixtures', () => {
  it('has one valid template per category except other', () => {
    expect(GLOBAL_TEMPLATE_FIXTURES.map((f) => f.category).sort()).toEqual(['cleaning', 'maintenance', 'production', 'quality', 'restaurant', 'retail', 'safety', 'warehouse']);
    expect(new Set(GLOBAL_TEMPLATE_FIXTURES.map((f) => f.id)).size).toBe(8);
  });

  it.each(GLOBAL_TEMPLATE_FIXTURES.map((f) => [f.name, f] as const))('%s is publishable and uses rules, problems and evidence', (_n, f) => {
    const c = f.build();
    expect(validateForPublish(c)).toEqual([]);
    expect(countItems(c)).toBeGreaterThanOrEqual(10);
    expect(countItems(c)).toBeLessThanOrEqual(25);
    let followUps = 0;
    let problems = 0;
    let evidence = 0;
    walkItems(c, (item, at) => {
      if (at.depth > 0) followUps++;
      if (hasRules(item) && item.rules.some((r) => r.then.problem)) problems++;
      if (item.evidence.photo === 'required' || (hasRules(item) && item.rules.some((r) => r.then.requirePhoto))) evidence++;
    });
    expect(followUps).toBeGreaterThan(0);
    expect(problems).toBeGreaterThan(0);
    expect(evidence).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @taskop/api test -- seed-templates`
Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: Write the fixtures**

`apps/api/src/db/scripts/seed-templates.ts`:
```ts
import {
  blankContent,
  type ChecklistContent,
  type Item,
  newItem,
  newRule,
  newSection,
  type NumberItem,
  type ProblemSeverity,
  type SingleChoiceItem,
  type TemplateCategory,
  type YesNoItem,
} from '@taskop/contracts';

// ---- tiny DSL so fixtures stay readable ----

interface YesNoOpts {
  /** Which answer is a problem (default: 'no'). */
  bad?: 'yes' | 'no';
  severity?: ProblemSeverity;
  /** On the bad answer: require a photo, and ask for a description. */
  photo?: boolean;
  describe?: string;
  followUps?: Item[];
  required?: boolean;
}
function yesNo(label: string, o: YesNoOpts = {}): YesNoItem {
  const item = newItem('yes_no') as YesNoItem;
  item.label = label;
  item.required = o.required ?? true;
  const bad = item.options[o.bad === 'yes' ? 0 : 1];
  const rule = newRule(item);
  rule.when = { kind: 'options', optionIds: [bad.id] };
  rule.then.problem = o.severity ?? 'normal';
  rule.then.requirePhoto = o.photo ?? false;
  if (o.describe) rule.then.followUps.push(comment(o.describe));
  rule.then.followUps.push(...(o.followUps ?? []));
  item.rules.push(rule);
  return item;
}
function num(label: string, unit: string, ok: [number, number], severity: ProblemSeverity = 'normal', describe?: string): NumberItem {
  const item = newItem('number') as NumberItem;
  item.label = label;
  item.unit = unit;
  item.decimals = 1;
  const rule = newRule(item);
  rule.when = { kind: 'range', op: 'outside', min: ok[0], max: ok[1] };
  rule.then.problem = severity;
  rule.then.requireNote = true;
  if (describe) rule.then.followUps.push(comment(describe));
  item.rules.push(rule);
  return item;
}
function choice(label: string, options: string[], badIndex: number[], severity: ProblemSeverity = 'normal'): SingleChoiceItem {
  const item = newItem('single_choice') as SingleChoiceItem;
  item.label = label;
  item.options = options.map((l) => ({ id: crypto.randomUUID(), label: l }));
  const rule = newRule(item);
  rule.when = { kind: 'options', optionIds: badIndex.map((i) => item.options[i]!.id) };
  rule.then.problem = severity;
  rule.then.requirePhoto = true;
  item.rules.push(rule);
  return item;
}
function comment(label: string, required = true): Item {
  const item = newItem('comment');
  item.label = label;
  item.required = required;
  return item;
}
function text(label: string, required = true): Item {
  const item = newItem('text');
  item.label = label;
  item.required = required;
  return item;
}
function photo(label: string, min = 1): Item {
  const item = newItem('photo');
  item.label = label;
  if (item.type === 'photo') item.minCount = min;
  return item;
}
function when(label: string): Item {
  const item = newItem('datetime');
  item.label = label;
  return item;
}
function content(sections: Array<[string, Item[]]>, instructions: string | null = null): ChecklistContent {
  return { ...blankContent(), instructions, sections: sections.map(([title, items]) => ({ ...newSection(title), items })) };
}

export interface GlobalTemplateFixture {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  sortOrder: number;
  build: () => ChecklistContent;
}

export const GLOBAL_TEMPLATE_FIXTURES: GlobalTemplateFixture[] = [
  {
    id: '01920000-0000-7000-8000-000000000001',
    name: 'Gündəlik təmizlik yoxlaması',
    description: 'Ofis və ümumi sahələrin gündəlik təmizlik nəzarəti.',
    category: 'cleaning',
    sortOrder: 1,
    build: () =>
      content(
        [
          ['Giriş və dəhliz', [
            yesNo('Döşəmə təmiz və qurudur?', { photo: true, describe: 'Problemi təsvir edin' }),
            yesNo('Zibil qutuları boşaldılıb?'),
            yesNo('Giriş qapısının şüşələri təmizdir?'),
          ]],
          ['Sanitar qovşaq', [
            yesNo('Əl yuma vasitələri var?', { severity: 'critical', photo: true }),
            yesNo('Kağız dəsmal və tualet kağızı var?'),
            yesNo('Pis qoxu var?', { bad: 'yes', describe: 'Qoxunun mənbəyini qeyd edin' }),
            yesNo('Kranlar və unitazlar işlək vəziyyətdədir?', { severity: 'critical', photo: true }),
          ]],
          ['Yekun', [
            choice('Ümumi təmizlik səviyyəsi', ['Əla', 'Qənaətbəxş', 'Qeyri-qənaətbəxş'], [2]),
            photo('Ümumi görünüşün fotosu'),
            comment('Əlavə qeydlər', false),
          ]],
        ],
        'Yoxlamanı növbənin əvvəlində aparın. Problem aşkar etdikdə foto çəkin.',
      ),
  },
  {
    id: '01920000-0000-7000-8000-000000000002',
    name: 'Restoran mətbəxi — gündəlik',
    description: 'Gigiyena, temperatur və ərzaq saxlanması nəzarəti.',
    category: 'restaurant',
    sortOrder: 2,
    build: () =>
      content([
        ['Soyuducular', [
          num('Soyuducu temperaturu', '°C', [0, 5], 'critical', 'Hansı tədbir görüldü?'),
          num('Dondurucu temperaturu', '°C', [-25, -18], 'critical'),
          yesNo('Məhsullar etiketlənib və tarixi var?', { photo: true }),
          yesNo('Vaxtı keçmiş məhsul var?', { bad: 'yes', severity: 'critical', photo: true, describe: 'Məhsulları və miqdarı yazın' }),
        ]],
        ['Gigiyena', [
          yesNo('İşçilər forma və baş örtüyündədir?'),
          yesNo('Əl yuma yeri hazırdır (sabun, dəsmal)?', { severity: 'critical' }),
          yesNo('Kəsmə taxtaları rəng koduna uyğun istifadə olunur?'),
          yesNo('Həşərat izləri var?', { bad: 'yes', severity: 'critical', photo: true, describe: 'Yeri və növü' }),
        ]],
        ['Növbənin sonu', [
          yesNo('Səthlər dezinfeksiya edilib?'),
          yesNo('Qaz və elektrik avadanlıqları söndürülüb?', { severity: 'critical' }),
          when('Yoxlamanın bitmə vaxtı'),
        ]],
      ]),
  },
  {
    id: '01920000-0000-7000-8000-000000000003',
    name: 'Mağaza açılışı',
    description: 'Pərakəndə mağazanın açılışdan əvvəl hazırlığı.',
    category: 'retail',
    sortOrder: 3,
    build: () =>
      content([
        ['Satış zalı', [
          yesNo('Vitrinlər səliqəlidir?', { photo: true }),
          yesNo('Qiymət etiketləri yerindədir?', { describe: 'Etiketsiz məhsulları qeyd edin' }),
          yesNo('Rəflər doludur?'),
          choice('Zalın işıqlandırması', ['Tam işləyir', 'Qismən işləyir', 'İşləmir'], [1, 2]),
        ]],
        ['Kassa', [
          yesNo('Kassa aparatı işləyir?', { severity: 'critical' }),
          yesNo('POS terminal işləyir?', { severity: 'critical' }),
          num('Kassada nağd qalıq', 'AZN', [0, 500]),
        ]],
        ['Təhlükəsizlik', [
          yesNo('Kameralar işləyir?', { severity: 'critical', photo: true }),
          yesNo('Təcili çıxış yolu açıqdır?', { severity: 'critical', photo: true }),
          text('Açılışı edən əməkdaşın adı'),
        ]],
      ]),
  },
  {
    id: '01920000-0000-7000-8000-000000000004',
    name: 'Yanğın təhlükəsizliyi — aylıq',
    description: 'Yanğınsöndürənlər, çıxışlar və siqnalizasiya.',
    category: 'safety',
    sortOrder: 4,
    build: () =>
      content([
        ['Yanğınsöndürənlər', [
          yesNo('Bütün yanğınsöndürənlər yerindədir?', { severity: 'critical', photo: true, describe: 'Çatışmayanların yeri' }),
          yesNo('Təzyiq göstəricisi yaşıl zonadadır?', { severity: 'critical', photo: true }),
          yesNo('Yoxlama etiketi aktualdır?'),
        ]],
        ['Çıxışlar', [
          yesNo('Təcili çıxış nişanları işıqlanır?', { severity: 'critical' }),
          yesNo('Çıxış yolları maneəsizdir?', { severity: 'critical', photo: true }),
          yesNo('Evakuasiya planı asılıb?'),
        ]],
        ['Siqnalizasiya', [
          yesNo('Siqnalizasiya paneli xətasızdır?', { severity: 'critical', photo: true }),
          yesNo('Tüstü detektorları təmizdir?'),
          when('Son təlim tarixi'),
          comment('Qeydlər', false),
        ]],
      ]),
  },
  {
    id: '01920000-0000-7000-8000-000000000005',
    name: 'İstehsalat xətti — növbə başlanğıcı',
    description: 'Avadanlıq, təhlükəsizlik və keyfiyyət yoxlaması.',
    category: 'production',
    sortOrder: 5,
    build: () =>
      content([
        ['Avadanlıq', [
          yesNo('Qoruyucu örtüklər yerindədir?', { severity: 'critical', photo: true }),
          yesNo('Təcili dayandırma düyməsi işləyir?', { severity: 'critical' }),
          num('Hidravlik təzyiq', 'bar', [150, 210], 'critical', 'Texniki xidmətə məlumat verildi?'),
          yesNo('Yağ sızması var?', { bad: 'yes', photo: true, describe: 'Sızmanın yeri' }),
        ]],
        ['Fərdi mühafizə', [
          yesNo('Bütün işçilər dəbilqə və eynəkdədir?', { severity: 'critical' }),
          yesNo('Qulaqlıqlar istifadə olunur?'),
        ]],
        ['Keyfiyyət', [
          num('İlk məhsulun ölçüsü', 'mm', [49.5, 50.5], 'normal', 'Tənzimləmə edildi?'),
          photo('İlk məhsulun fotosu'),
          text('Partiya nömrəsi'),
          comment('Qeydlər', false),
        ]],
      ]),
  },
  {
    id: '01920000-0000-7000-8000-000000000006',
    name: 'Anbar — mal qəbulu',
    description: 'Daxil olan malların qəbulu və yerləşdirilməsi.',
    category: 'warehouse',
    sortOrder: 6,
    build: () =>
      content([
        ['Sənədlər', [
          text('Qaimə nömrəsi'),
          yesNo('Miqdar qaimə ilə uyğundur?', { photo: true, describe: 'Fərqi yazın' }),
          when('Qəbul vaxtı'),
        ]],
        ['Mal vəziyyəti', [
          yesNo('Qablaşdırma zədəsizdir?', { photo: true, describe: 'Zədəli yerləri təsvir edin' }),
          num('Soyuq zəncir temperaturu', '°C', [2, 8], 'critical'),
          choice('Paletlərin vəziyyəti', ['Yaxşı', 'Zədəli', 'Yararsız'], [1, 2]),
          photo('Malın ümumi fotosu', 2),
        ]],
        ['Yerləşdirmə', [
          yesNo('Mal təyin olunmuş yerə qoyulub?'),
          yesNo('Keçidlər açıqdır?', { severity: 'critical' }),
          comment('Qeydlər', false),
        ]],
      ]),
  },
  {
    id: '01920000-0000-7000-8000-000000000007',
    name: 'Keyfiyyət auditi',
    description: 'Məhsul və xidmət keyfiyyətinin seçmə yoxlanışı.',
    category: 'quality',
    sortOrder: 7,
    build: () =>
      content([
        ['Seçmə', [
          text('Yoxlanılan məhsul/xidmət'),
          num('Yoxlanılan nümunə sayı', 'əd.', [5, 1000]),
          num('Uyğunsuz nümunə sayı', 'əd.', [0, 0], 'normal', 'Uyğunsuzluğun səbəbi'),
        ]],
        ['Standartlar', [
          yesNo('Standart əməliyyat proseduru əlçatandır?'),
          yesNo('İşçilər proseduru izləyir?', { photo: true, describe: 'Pozuntunu təsvir edin' }),
          yesNo('Ölçü alətləri kalibrlənib?', { severity: 'critical' }),
          choice('Ümumi qiymətləndirmə', ['Uyğun', 'Kiçik uyğunsuzluq', 'Ciddi uyğunsuzluq'], [1, 2], 'critical'),
        ]],
        ['Nəticə', [
          photo('Sübut fotosu'),
          comment('Tövsiyələr'),
          when('Növbəti audit tarixi'),
        ]],
      ]),
  },
  {
    id: '01920000-0000-7000-8000-000000000008',
    name: 'Texniki xidmət — kondisioner',
    description: 'Kondisioner sistemlərinin dövri yoxlanışı.',
    category: 'maintenance',
    sortOrder: 8,
    build: () =>
      content([
        ['Daxili blok', [
          yesNo('Filtrlər təmizdir?', { photo: true, describe: 'Filtr dəyişdirildi?' }),
          num('Çıxan havanın temperaturu', '°C', [10, 16]),
          yesNo('Kənar səs var?', { bad: 'yes', describe: 'Səsin xarakteri' }),
          yesNo('Drenaj xəttində sızma var?', { bad: 'yes', severity: 'critical', photo: true }),
        ]],
        ['Xarici blok', [
          yesNo('Kondensator təmizdir?', { photo: true }),
          num('Freon təzyiqi', 'bar', [4, 6], 'critical', 'Hansı tədbir görüldü?'),
          yesNo('Elektrik bağlantıları qaydasındadır?', { severity: 'critical' }),
        ]],
        ['Yekun', [
          text('Avadanlığın seriya nömrəsi'),
          photo('Görülən işin fotosu'),
          comment('İstifadə olunan materiallar', false),
        ]],
      ]),
  },
];
```

- [ ] **Step 4: Wire the fixtures into the seed script**

Restructure `apps/api/src/db/scripts/seed.ts` `main()` so seeding is idempotent per part:

```ts
import { countItems, regenerateIds } from '@taskop/contracts';
import { GLOBAL_TEMPLATE_FIXTURES } from './seed-templates';
// ...existing imports...

async function seedGlobalTemplates(db: NodePgDatabase<typeof schema>): Promise<void> {
  for (const f of GLOBAL_TEMPLATE_FIXTURES) {
    const content = f.build();
    // Insert once; never overwrite edits made later in the platform builder.
    await db
      .insert(schema.globalTemplates)
      .values({ id: f.id, name: f.name, description: f.description, category: f.category, sortOrder: f.sortOrder, content, itemCount: countItems(content), published: true })
      .onConflictDoNothing();
  }
}

async function seedDemoChecklists(tx: Tx, tenantId: string, ownerId: string): Promise<void> {
  const existing = await tx.select({ id: schema.checklists.id }).from(schema.checklists).where(eq(schema.checklists.tenantId, tenantId)).limit(1);
  if (existing.length) return;
  const cleaning = GLOBAL_TEMPLATE_FIXTURES.find((f) => f.category === 'cleaning')!;
  const warehouse = GLOBAL_TEMPLATE_FIXTURES.find((f) => f.category === 'warehouse')!;
  const by = { createdByUserId: ownerId };
  const published = (number: number, note: string) => ({ state: 'published' as const, number, changeNote: note, publishedByUserId: ownerId, publishedAt: new Date() });

  const dailyId = uuidv7();
  await tx.insert(schema.checklists).values({ id: dailyId, tenantId, name: 'Gündəlik təmizlik yoxlaması', category: 'cleaning', sourceTemplateKind: 'global', sourceTemplateId: cleaning.id, ...by });
  const v1 = regenerateIds(cleaning.build());
  const v2 = structuredClone(v1);
  const extra = structuredClone(v1.sections[2]!.items[2]!);
  extra.id = crypto.randomUUID();
  extra.label = 'Məsul şəxsə məlumat verildi?';
  v2.sections[2]!.items.splice(2, 0, extra);
  const v1Id = uuidv7();
  const v2Id = uuidv7();
  await tx.insert(schema.checklistVersions).values([
    { id: v1Id, tenantId, checklistId: dailyId, content: v1, ...by, ...published(1, 'İlk versiya') },
    { id: v2Id, tenantId, checklistId: dailyId, content: v2, ...by, ...published(2, 'Məsul şəxs sualı əlavə edildi') },
  ]);
  await tx.update(schema.checklists).set({ currentVersionId: v2Id, latestVersionNumber: 2 }).where(eq(schema.checklists.id, dailyId));

  const receivingId = uuidv7();
  await tx.insert(schema.checklists).values({ id: receivingId, tenantId, name: 'Anbar qəbulu', category: 'warehouse', sourceTemplateKind: 'global', sourceTemplateId: warehouse.id, ...by });
  await tx.insert(schema.checklistVersions).values({ tenantId, checklistId: receivingId, state: 'draft', content: regenerateIds(warehouse.build()), ...by });

  const handover = regenerateIds(cleaning.build());
  handover.sections = handover.sections.slice(0, 1);
  await tx.insert(schema.tenantTemplates).values({ tenantId, name: 'Növbə təhvili', category: 'other', content: handover, itemCount: countItems(handover), ...by });
}
```

In `main()`:
1. After `const db = drizzle(url, { schema });`, call `await seedGlobalTemplates(db);`.
2. Replace the early-return block. If the demo tenant exists, run `await db.transaction((tx) => seedDemoChecklists(tx, existing.id, <owner id>))` and return. Find the owner id with
   `const [owner] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, 'owner@demo.taskop.az'));`
3. Inside the existing creation transaction, after the owner insert, call `await seedDemoChecklists(tx, tenantId, ownerId);`.

Add the types: `import type { NodePgDatabase } from 'drizzle-orm/node-postgres';` and `type Tx = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];`.

The seed connects as `taskop_owner` (a superuser), so RLS doesn't filter its writes, and the trigger allows inserting published rows: it only fires on UPDATE/DELETE.

- [ ] **Step 5: Run the tests and the seed**

Run:
```bash
pnpm --filter @taskop/api test -- seed-templates
pnpm --filter @taskop/api typecheck
docker compose -p foundation start && pnpm db:setup && pnpm db:seed && pnpm db:seed
```
Expected: tests PASS. Both seed runs succeed; the second is a no-op for templates and demo checklists. Check with:
```bash
docker compose -p foundation exec postgres psql -U taskop_owner -d taskop -c "select count(*) from global_templates; select name, latest_version_number from checklists;"
```
Expected: 8 global templates; "Gündəlik təmizlik yoxlaması | 2" and "Anbar qəbulu | 0".

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/scripts apps/api/test/seed-templates.test.ts
git commit -m "feat(api): seed global checklist templates and demo checklists"
```

---

### Task 11: Tenant isolation suite and final verification

**Files:**
- Modify: `apps/api/test/isolation.test.ts`, `apps/api/test/openapi.test.ts`

**Interfaces:**
- Consumes: every endpoint from Tasks 7–9.

- [ ] **Step 1: Extend the isolation suite**

In `apps/api/test/isolation.test.ts` `beforeAll`, after the existing tenant-A setup, add:
```ts
    const ca = await apiA.post('/api/v1/checklists', { name: 'A checklist' });
    a.checklist = ca.body.id;
    await apiA.put(`/api/v1/checklists/${a.checklist}/draft`, { content: sampleContent(), revision: 1 });
    a.version = (await apiA.post(`/api/v1/checklists/${a.checklist}/publish`, { revision: 2 })).body.id;
    a.template = (await apiA.post(`/api/v1/checklists/${a.checklist}/versions/${a.version}/save-as-template`, { name: 'A tpl', category: 'other' })).body.id;
    b.checklist = (await as(t, B.accessToken).post('/api/v1/checklists', { name: 'B checklist' })).body.id;
```
with `import { sampleContent } from './checklist-fixtures';` at the top.

Append to the `notFound()` list:
```ts
    ['GET', () => `/api/v1/checklists/${a.checklist}`, undefined],
    ['PATCH', () => `/api/v1/checklists/${a.checklist}`, { name: 'x' }],
    ['GET', () => `/api/v1/checklists/${a.checklist}/versions/${a.version}`, undefined],
    ['GET', () => `/api/v1/checklists/${b.checklist}/versions/${a.version}`, undefined],
    ['GET', () => `/api/v1/checklists/${a.checklist}/draft`, undefined],
    ['POST', () => `/api/v1/checklists/${a.checklist}/draft`, {}],
    ['PUT', () => `/api/v1/checklists/${a.checklist}/draft`, { content: sampleContent(), revision: 1 }],
    ['POST', () => `/api/v1/checklists/${a.checklist}/publish`, { revision: 1 }],
    ['POST', () => `/api/v1/checklists/${a.checklist}/deactivate`, {}],
    ['POST', () => `/api/v1/checklists/${a.checklist}/reactivate`, {}],
    ['POST', () => `/api/v1/checklists/${a.checklist}/versions/${a.version}/save-as-template`, { name: 'x', category: 'other' }],
    ['POST', () => `/api/v1/checklists/${b.checklist}/versions/${a.version}/save-as-template`, { name: 'x', category: 'other' }],
    ['GET', () => `/api/v1/templates/tenant/${a.template}`, undefined],
    ['PATCH', () => `/api/v1/templates/${a.template}`, { name: 'x' }],
    ['PUT', () => `/api/v1/templates/${a.template}/content`, { content: sampleContent(), revision: 1 }],
    ['POST', () => `/api/v1/templates/${a.template}/deactivate`, {}],
```

Extend `rejects foreign ids inside request bodies with 422` with:
```ts
      await api.post('/api/v1/checklists', { name: 'x', from: { kind: 'version', versionId: a.version } }),
      await api.post('/api/v1/checklists', { name: 'x', from: { kind: 'tenant', templateId: a.template } }),
      await api.post(`/api/v1/checklists/${b.checklist}/draft`, { fromVersionId: a.version }),
```
The last case reaches `startDraft`, which first finds B's draft (created with the checklist) and returns `CHECKLIST_DRAFT_EXISTS` (409), not 422. To exercise the foreign `fromVersionId`, first discard B's draft. Add `await as(t, B.accessToken).delete(\`/api/v1/checklists/${b.checklist}/draft\`);` in `beforeAll`, after creating `b.checklist`.

Extend the list check:
```ts
    for (const url of ['/api/v1/sites', '/api/v1/site-types', '/api/v1/teams', '/api/v1/roles', '/api/v1/templates']) {
```
and
```ts
    for (const url of ['/api/v1/users?limit=200', '/api/v1/audit-log?limit=200', '/api/v1/checklists?limit=200']) {
```

Add to `left tenant A untouched`:
```ts
    const c = await ownerQuery('select name, latest_version_number from checklists where id = $1', [a.checklist]);
    expect(c.rows[0]).toEqual({ name: 'A checklist', latest_version_number: 1 });
```

- [ ] **Step 2: Extend the OpenAPI test**

In `apps/api/test/openapi.test.ts`, add to the `arrayContaining` list: `'/api/v1/checklists'`, `'/api/v1/templates'`, `'/api/v1/platform/templates'`, `'/api/v1/platform/tenants/{tenantId}/checklists'`.

- [ ] **Step 3: Run the full verification**

Run:
```bash
pnpm --filter @taskop/api test -- isolation openapi
pnpm lint && pnpm typecheck && pnpm test
```
Expected: everything passes. The `prettier` formatting check is part of lint, so if lint fails on formatting only, run `pnpm format` and re-run.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test
git commit -m "test(api): extend tenant isolation and OpenAPI suites to checklists and templates"
```

---

## Spec coverage (self-review)

| Spec section | Task |
|---|---|
| §3 content document, limits, stable IDs | 1, 3 |
| §3.2 draft vs. strict validation, issue paths | 1, 2 |
| §3.3 `visibleItems`, `requirements`, `computeScore`, `regenerateIds` | 3 |
| §4.1 tables, §4.2 trigger, grants, view, §4.3 categories | 4, 6 |
| §4.4 lifecycle: create, copy, autosave, publish, restore, discard, deactivate | 7 |
| §4.4 save as template | 8 |
| §5 permissions, role defaults, backfill | 4, 6 |
| §6.1 tenant endpoints | 7, 8 |
| §6.2 platform endpoints, audit with null tenant | 6, 9 |
| §6.3 audit actions (autosave not audited) | 7, 8, 9 |
| §6.4 error codes, issues, `currentRevision`, size limit | 4, 6, 7 |
| §8 seed data | 10 |
| §9 API tests, including isolation | 6–11 |

Deliberate deviations, noted in the tasks:
- Number rules use `kind: 'range'` for `between`/`outside`.
- Missing resources use the existing `NOT_FOUND` code.
- The 1.5 MB body limit is global, not per route.
- `global_templates.created_by_platform_admin_id` is nullable (seeded rows).
- `tenant_templates` and `global_templates` gain an `item_count` column for list views.
