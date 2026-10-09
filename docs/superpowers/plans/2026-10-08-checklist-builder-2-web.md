# Taskop Checklist Builder — Part 2: API Client & Web — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give tenant users and Taskop platform admins a web checklist builder covering checklists, versions, templates and preview, backed by the Part 1 API.

**Architecture:**
- **Workspace context.** All checklist screens read one `ChecklistWorkspace` context, which holds the API group, permissions, route prefix and navigation function. The same pages therefore serve tenant users (`/checklists…`) and platform admins working inside a tenant (`/platform/tenants/:id/checklists…`).
- **Builder state.** The builder is a pure reducer (content plus undo/redo) over the shared `ChecklistContent` type. A debounced, single-flight autosave hook sends saves with the last known `revision`.
- **Shared validation.** Content validation and preview logic come from `@taskop/contracts`, so the web app and the API agree exactly.

**Tech Stack:** React 19.2.3, Vite, TanStack Router + Query, Tailwind + shadcn/ui, i18next, `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` (new), Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-checklist-builder-design.md`

**This plan is Part 2 of 2:**
- Part 1: `docs/superpowers/plans/2026-10-08-checklist-builder-1-api.md`. Its Tasks 1–5 (contracts + i18n) must be merged before this part starts. Its Tasks 6–11 (API) must be merged before Task W10 (Playwright).

## Global Constraints

- The product name is **Taskop**. All user-visible text goes through i18n keys (`az` only). Never hard-code Azerbaijani strings in components.
- Install new packages with `pnpm add <pkg>@latest`. React stays pinned at 19.2.3 repo-wide (Expo).
- Content types, validation (`validateForPublish`), evaluation (`visibleItems`, `requirements`, `computeScore`), factories (`newItem`, `newRule`, `newSection`) and `regenerateItemIds` come from `@taskop/contracts`. Never re-implement them in the web app.
- Builder rules (spec §7.2):
  - Autosave runs 1.5 s after the last change and on `visibilitychange`/`pagehide`, with one save in flight at a time.
  - A 409 stops autosave and shows a reload banner.
  - Undo/redo keeps 50 steps.
  - Publish is disabled while `validateForPublish` returns issues.
  - Follow-up depth is at most 3.
  - Every node has "Move to…" in addition to drag-and-drop.
- Permission gating:
  - Builder edits and checklist actions need `checklists.manage`.
  - Publish needs `checklists.publish`.
  - Template changes need `templates.manage`.
  - The **Checklists** nav item needs `checklists.view`; **Templates** needs `checklists.manage`.
  - Platform admins hold all of these.
- Dates are formatted with `@taskop/i18n` `formatDateTime` in the tenant timezone (platform pages use `Asia/Baku`).

## Review Focus

The five input classes most likely to bite users, with the task that pins each:

1. **Typing fast, then publishing immediately.** Publish must first wait for the in-flight save *and* save any newer edits, then publish with the latest revision. It must never publish a stale draft or hit a self-inflicted 409. Pinned in Task W3 (`flush saves newer edits made during an in-flight save`) and Task W7 (`publish flushes before publishing`).
2. **Deleting a choice option that a rule uses.** The rule must drop that option ID, rather than leaving a rule that can never match. Pinned in Task W6 (`removing an option strips it from rules`).
3. **Dragging or moving an item into its own follow-ups, or past depth 3.** The move must be refused, and the content must stay unchanged. Pinned in Task W2 (`refuses moves into own subtree or beyond depth 3`) and Task W5 (`Move to hides invalid targets`).
4. **Undo after typing a long label.** One undo should restore the previous label, not remove one character. Pinned in Task W2 (`coalesces typing into one undo step`).
5. **A tenant user without `checklists.publish` (Manager) or without `checklists.manage` (Auditor).** The Publish button must not appear for the Manager. The Auditor sees a read-only builder with no autosave calls. Pinned in Task W7 (`read-only and no-publish modes`).

---

## File Structure

```
packages/api-client/src/
  errors.ts                 + issues, currentRevision on ApiError
  client.ts                 + passes them through
  endpoints.ts              + createChecklistsApi, createTemplatesApi, platform globalTemplates + inTenant()
  client.test.ts            + tests
packages/i18n/src/az/
  checklists.ts             + UI strings (Part 1 created issues/categories/itemTypes)
  nav.ts, platform.ts       + entries
apps/web/src/
  test/workspace.tsx        fakeWorkspace() + renderInWorkspace() for tests
  features/checklists/
    workspace.tsx           ChecklistWorkspace context, TenantWorkspace, PlatformTenantWorkspace, WsLink
    queries.ts              useChecklistPages, useChecklist, useTemplates
    labels.ts               optionLabel, itemTypeIcon, category helpers
    checklists-page.tsx     list + filters
    new-checklist-dialog.tsx  blank / from template / copy
    template-picker.tsx
    checklist-detail-page.tsx  versions, actions
    checklist-dialogs.tsx   EditDetailsDialog, SaveAsTemplateDialog
    templates-page.tsx      gallery (Taskop / ours) + new template
    editor-pages.tsx        ChecklistDraftPage, ChecklistVersionPage, TemplateEditorPage
    routes.tsx              param → page adapters for both route trees
    builder/
      tree.ts               pure content-tree helpers (find, move, insert, canMoveTo, listContainers)
      reducer.ts            builderReducer + undo/redo
      use-autosave.ts
      issues.ts             indexIssues: issue path → node
      builder.tsx           layout + top bar + publish dialog
      outline.tsx           dnd-kit tree + dropAction
      move-to-dialog.tsx
      canvas.tsx            section + item cards + AddItemButton
      inspector.tsx         settings / section / item panels
      rules-editor.tsx
      preview.tsx
  features/platform/
    platform-layout.tsx     header + nav (Tenants, Templates) + Outlet
    platform-tenants-page.tsx   (header moved to layout; + Checklists link)
    global-templates-page.tsx
    global-template-editor-page.tsx
    platform-tenant-workspace.tsx  banner + PlatformTenantWorkspace + Outlet
  layouts/app-shell.tsx     + nav items
  router.tsx                + routes
apps/web/e2e/checklists.spec.ts
.github/workflows/ci.yml    + seed step before e2e
```

---

### Task W1: API client: checklist and template endpoints, error details

**Files:**
- Modify: `packages/api-client/src/errors.ts`, `packages/api-client/src/client.ts`, `packages/api-client/src/endpoints.ts`
- Test: `packages/api-client/src/client.test.ts`

**Interfaces:**
- Consumes (Part 1 Task 4): the schemas `checklistSummarySchema`, `checklistDetailSchema`, `checklistVersionSchema`, `checklistVersionSummarySchema`, `contentSaveResultSchema`, `templateSummarySchema`, `templateSchema`, `globalTemplateSummarySchema`, `globalTemplateSchema`, plus the input types.
- Produces:
  - `ApiError.issues: ContentIssue[] | null` and `ApiError.currentRevision: number | null`
  - `createChecklistsApi(c, base = '')` → `{ list, get, create, update, version, draft, startDraft, saveDraft, discardDraft, publish, deactivate, reactivate, saveAsTemplate }`, typed as `ChecklistsApi`
  - `createTemplatesApi(c, base = '')` → `{ list, get, create, update, saveContent, deactivate, reactivate }`, typed as `TemplatesApi`
  - `TaskopApi.checklists` and `TaskopApi.templates`
  - `PlatformApi.globalTemplates` → `{ list, get, create, update, saveContent, publish, unpublish }`
  - `PlatformApi.inTenant(tenantId)` → `{ checklists, templates }`, with paths under `/platform/tenants/:tenantId`

- [ ] **Step 1: Write the failing test**

Append to `packages/api-client/src/client.test.ts`:
```ts
import { createPlatformApi } from './index.js';

describe('checklist endpoints', () => {
  const cid = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e60';

  it('exposes issues and currentRevision on errors', async () => {
    const issues = [{ path: ['sections', 0, 'title'], code: 'checklists.issues.titleRequired' }];
    const { api } = setup(() =>
      json(422, { error: { code: 'CHECKLIST_INVALID_CONTENT', messageKey: 'errors.CHECKLIST_INVALID_CONTENT', fields: null, retryAfterSeconds: null, requestId: 'r', issues } }),
    );
    const e = await createTaskopApi(api).checklists.publish(cid, { revision: 1 }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).issues).toEqual(issues);
    const { api: api2 } = setup(() =>
      json(409, { error: { code: 'CHECKLIST_DRAFT_CONFLICT', messageKey: 'x', fields: null, retryAfterSeconds: null, requestId: null, currentRevision: 7 } }),
    );
    const e2 = (await createTaskopApi(api2).checklists.saveDraft(cid, { content: {}, revision: 1 }).catch((x: unknown) => x)) as ApiError;
    expect([e2.code, e2.currentRevision, e2.issues]).toEqual(['CHECKLIST_DRAFT_CONFLICT', 7, null]);
  });

  it('builds tenant and platform-in-tenant paths', async () => {
    const { api, fetchMock } = setup(() => json(200, { revision: 2, issues: [] }));
    await createTaskopApi(api).checklists.saveDraft(cid, { content: {}, revision: 1 });
    await createPlatformApi(api).inTenant(cid).checklists.saveDraft(cid, { content: {}, revision: 1 });
    await createPlatformApi(api).inTenant(cid).templates.saveContent(cid, { content: {}, revision: 1 });
    expect(fetchMock.mock.calls.map((c) => `${c[1].method} ${c[0]}`)).toEqual([
      `PUT /api/v1/checklists/${cid}/draft`,
      `PUT /api/v1/platform/tenants/${cid}/checklists/${cid}/draft`,
      `PUT /api/v1/platform/tenants/${cid}/templates/${cid}/content`,
    ]);
  });

  it('discards a draft with DELETE and no body', async () => {
    const { api, fetchMock } = setup(() => new Response(null, { status: 204 }));
    await expect(createTaskopApi(api).checklists.discardDraft(cid)).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'DELETE', body: undefined });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @taskop/api-client test`
Expected: FAIL. `checklists` is undefined on the API.

- [ ] **Step 3: Implement**

`errors.ts`, which gains two trailing constructor params:
```ts
import type { ContentIssue, ErrorCode } from '@taskop/contracts';

export type ClientErrorCode = ErrorCode | 'NETWORK';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ClientErrorCode,
    readonly messageKey: string,
    readonly fields: Record<string, string> | null = null,
    readonly retryAfterSeconds: number | null = null,
    readonly requestId: string | null = null,
    readonly issues: ContentIssue[] | null = null,
    readonly currentRevision: number | null = null,
  ) {
    super(code);
    this.name = 'ApiError';
  }

  static network(): ApiError {
    return new ApiError(0, 'NETWORK', 'errors.NETWORK');
  }
}
```

`client.ts` `toApiError`:
```ts
  return new ApiError(res.status, e.code, e.messageKey, e.fields, e.retryAfterSeconds, e.requestId, e.issues ?? null, e.currentRevision ?? null);
```

`endpoints.ts`: add these imports to the existing `@taskop/contracts` import list: `checklistDetailSchema`, `type ChecklistListQuery`, `checklistSummarySchema`, `checklistVersionSchema`, `checklistVersionSummarySchema`, `contentSaveResultSchema`, `type CreateChecklistInput`, `type CreateTemplateInput`, `globalTemplateSchema`, `globalTemplateSummarySchema`, `type PublishInput`, `type SaveAsTemplateInput`, `type SaveContentInput`, `type StartDraftInput`, `type TemplateListQuery`, `templateSchema`, `templateSummarySchema`, `type UpdateChecklistInput`, `type UpdateGlobalTemplateInput`, `type UpdateTemplateInput`. Then add:
```ts
/** `base` is '' for tenant users or `/platform/tenants/<id>` for platform admins working in a tenant. */
export function createChecklistsApi(c: ApiClient, base = '') {
  const p = `${base}/checklists`;
  return {
    list: (query: ChecklistListQuery = {}) => c.request('GET', p, { query: q(query), schema: pageOf(checklistSummarySchema) }),
    get: (id: string) => c.request('GET', `${p}/${id}`, { schema: checklistDetailSchema }),
    create: (body: CreateChecklistInput) => c.request('POST', p, { body, schema: checklistDetailSchema }),
    update: (id: string, body: UpdateChecklistInput) => c.request('PATCH', `${p}/${id}`, { body, schema: checklistDetailSchema }),
    version: (id: string, versionId: string) => c.request('GET', `${p}/${id}/versions/${versionId}`, { schema: checklistVersionSchema }),
    draft: (id: string) => c.request('GET', `${p}/${id}/draft`, { schema: checklistVersionSchema }),
    startDraft: (id: string, body: StartDraftInput = {}) => c.request('POST', `${p}/${id}/draft`, { body, schema: checklistVersionSchema }),
    saveDraft: (id: string, body: SaveContentInput) => c.request('PUT', `${p}/${id}/draft`, { body, schema: contentSaveResultSchema }),
    discardDraft: (id: string) => c.request<void>('DELETE', `${p}/${id}/draft`),
    publish: (id: string, body: PublishInput) => c.request('POST', `${p}/${id}/publish`, { body, schema: checklistVersionSummarySchema }),
    deactivate: (id: string) => c.request('POST', `${p}/${id}/deactivate`, { body: {}, schema: checklistDetailSchema }),
    reactivate: (id: string) => c.request('POST', `${p}/${id}/reactivate`, { body: {}, schema: checklistDetailSchema }),
    saveAsTemplate: (id: string, versionId: string, body: SaveAsTemplateInput) =>
      c.request('POST', `${p}/${id}/versions/${versionId}/save-as-template`, { body, schema: templateSchema }),
  };
}
export type ChecklistsApi = ReturnType<typeof createChecklistsApi>;

export function createTemplatesApi(c: ApiClient, base = '') {
  const p = `${base}/templates`;
  return {
    list: (query: TemplateListQuery = {}) => c.request('GET', p, { query: q(query), schema: z.array(templateSummarySchema) }),
    get: (source: 'global' | 'tenant', id: string) => c.request('GET', `${p}/${source}/${id}`, { schema: templateSchema }),
    create: (body: CreateTemplateInput) => c.request('POST', p, { body, schema: templateSchema }),
    update: (id: string, body: UpdateTemplateInput) => c.request('PATCH', `${p}/${id}`, { body, schema: templateSchema }),
    saveContent: (id: string, body: SaveContentInput) => c.request('PUT', `${p}/${id}/content`, { body, schema: contentSaveResultSchema }),
    deactivate: (id: string) => c.request('POST', `${p}/${id}/deactivate`, { body: {}, schema: templateSchema }),
    reactivate: (id: string) => c.request('POST', `${p}/${id}/reactivate`, { body: {}, schema: templateSchema }),
  };
}
export type TemplatesApi = ReturnType<typeof createTemplatesApi>;
```
In `createTaskopApi`, add:
```ts
    checklists: createChecklistsApi(c),
    templates: createTemplatesApi(c),
```
In `createPlatformApi`, add:
```ts
    globalTemplates: {
      list: () => c.request('GET', '/platform/templates', { schema: z.array(globalTemplateSummarySchema) }),
      get: (id: string) => c.request('GET', `/platform/templates/${id}`, { schema: globalTemplateSchema }),
      create: (body: CreateTemplateInput) => c.request('POST', '/platform/templates', { body, schema: globalTemplateSchema }),
      update: (id: string, body: UpdateGlobalTemplateInput) => c.request('PATCH', `/platform/templates/${id}`, { body, schema: globalTemplateSchema }),
      saveContent: (id: string, body: SaveContentInput) => c.request('PUT', `/platform/templates/${id}/content`, { body, schema: contentSaveResultSchema }),
      publish: (id: string) => c.request('POST', `/platform/templates/${id}/publish`, { body: {}, schema: globalTemplateSchema }),
      unpublish: (id: string) => c.request('POST', `/platform/templates/${id}/unpublish`, { body: {}, schema: globalTemplateSchema }),
    },
    inTenant: (tenantId: string) => ({
      checklists: createChecklistsApi(c, `/platform/tenants/${tenantId}`),
      templates: createTemplatesApi(c, `/platform/tenants/${tenantId}`),
    }),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @taskop/api-client test && pnpm --filter @taskop/api-client typecheck && pnpm --filter @taskop/api-client build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api-client/src
git commit -m "feat(api-client): add checklist and template endpoints and error details"
```

---

### Task W2: Builder core: content tree helpers and reducer with undo/redo

**Files:**
- Create: `apps/web/src/features/checklists/builder/tree.ts`, `apps/web/src/features/checklists/builder/reducer.ts`
- Create (test fixture, not a test file, so importing it never re-registers suites): `apps/web/src/features/checklists/builder/fixtures.ts`
- Test: `apps/web/src/features/checklists/builder/tree.test.ts`, `apps/web/src/features/checklists/builder/reducer.test.ts`

**Interfaces:**
- Consumes: `ChecklistContent`, `Item`, `hasRules`, `CONTENT_LIMITS`, `newItem`, `newRule`, `newSection`, `regenerateItemIds` from contracts.
- Produces (`tree.ts`):
  - `type ContainerRef = { kind: 'section'; sectionId: string } | { kind: 'rule'; itemId: string; ruleId: string }`
  - `type NodeRef = { kind: 'settings' } | { kind: 'section'; id: string } | { kind: 'item'; id: string }`
  - `containerKey(c): string`
  - `findItem(content, itemId): FoundItem | null`, where `FoundItem = { item, list, index, container, depth, sectionId }`
  - `containerItems(content, c): Item[] | null`
  - `containerDepth(content, c): number | null`
  - `subtreeHeight(item): number`
  - `canMoveTo(content, itemId, to): boolean`
  - `moveItem(content, itemId, to, index)`, `moveSection(content, sectionId, index)`
  - `insertItem(content, to, index, item)`, `removeItem(content, itemId)`
  - `listContainers(content): ContainerOption[]`, where `ContainerOption = { ref, key, depth, sectionTitle, ownerLabel: string | null, ruleNo: number | null }`
  - `rootItemId(content, itemId): string | null`
- Produces (`reducer.ts`):
  - `BuilderState = { content, past, future, selected: NodeRef, version, lastKey }`
  - `BuilderAction` (union below), `RulePatch`
  - `initialState(content)`, `builderReducer(state, action)`, `HISTORY_LIMIT = 50`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/checklists/builder/fixtures.ts`:
```ts
import { blankContent, type ChecklistContent, newItem, newRule, newSection, type YesNoItem } from '@taskop/contracts';

/** S1: [A (rule → A1 (rule → A11)), B], S2: [C]. Shared by the builder tests. */
export function treeFixture() {
  const a = newItem('yes_no') as YesNoItem;
  a.label = 'A';
  const rule = newRule(a);
  const a1 = newItem('yes_no') as YesNoItem;
  a1.label = 'A1';
  const rule1 = newRule(a1);
  const a11 = newItem('text');
  a11.label = 'A11';
  rule1.then.followUps.push(a11);
  a1.rules.push(rule1);
  rule.then.followUps.push(a1);
  a.rules.push(rule);
  const b = newItem('text');
  b.label = 'B';
  const c = newItem('text');
  c.label = 'C';
  const s1 = { ...newSection('S1'), items: [a, b] };
  const s2 = { ...newSection('S2'), items: [c] };
  const content: ChecklistContent = { ...blankContent(), sections: [s1, s2] };
  return { content, a, rule, a1, rule1, a11, b, c, s1, s2 };
}
```

`apps/web/src/features/checklists/builder/tree.test.ts`:
```ts
import type { ChecklistContent } from '@taskop/contracts';
import { describe, expect, it } from 'vitest';
import { treeFixture } from './fixtures';
import { canMoveTo, containerDepth, findItem, listContainers, moveItem, moveSection, rootItemId, subtreeHeight } from './tree';

const labels = (c: ChecklistContent, s: number) => c.sections[s]!.items.map((i) => i.label);

describe('tree helpers', () => {
  it('finds items with depth, container and section', () => {
    const f = treeFixture();
    expect(findItem(f.content, f.a11.id)).toMatchObject({ depth: 2, sectionId: f.s1.id, index: 0, container: { kind: 'rule', itemId: f.a1.id, ruleId: f.rule1.id } });
    expect(findItem(f.content, 'nope')).toBeNull();
    expect(rootItemId(f.content, f.a11.id)).toBe(f.a.id);
    expect(subtreeHeight(f.a)).toBe(2);
    expect(containerDepth(f.content, { kind: 'rule', itemId: f.a1.id, ruleId: f.rule1.id })).toBe(2);
  });

  it('moves within and across sections without mutating the input', () => {
    const f = treeFixture();
    const before = structuredClone(f.content);
    const down = moveItem(f.content, f.a.id, { kind: 'section', sectionId: f.s1.id }, 1);
    expect(labels(down, 0)).toEqual(['B', 'A']);
    const across = moveItem(f.content, f.b.id, { kind: 'section', sectionId: f.s2.id }, 0);
    expect([labels(across, 0), labels(across, 1)]).toEqual([['A'], ['B', 'C']]);
    expect(f.content).toEqual(before);
    expect(moveSection(f.content, f.s2.id, 0).sections.map((s) => s.title)).toEqual(['S2', 'S1']);
  });

  it('refuses moves into own subtree or beyond depth 3', () => {
    const f = treeFixture();
    expect(canMoveTo(f.content, f.a.id, { kind: 'rule', itemId: f.a1.id, ruleId: f.rule1.id })).toBe(false);
    expect(canMoveTo(f.content, f.b.id, { kind: 'rule', itemId: f.a1.id, ruleId: f.rule1.id })).toBe(true);
    // A (height 2) under C's rule would put A11 at depth 3: allowed. Under A11-depth container (3) it would be 5.
    const c = f.content.sections[1]!.items[0]!;
    expect(canMoveTo(f.content, c.id, { kind: 'section', sectionId: f.s1.id })).toBe(true);
    const deep = moveItem(f.content, f.a.id, { kind: 'rule', itemId: f.a1.id, ruleId: f.rule1.id }, 0);
    expect(deep).toBe(f.content);
  });

  it('lists move targets in document order with depth', () => {
    const f = treeFixture();
    expect(listContainers(f.content).map((c) => [c.depth, c.sectionTitle, c.ownerLabel, c.ruleNo])).toEqual([
      [0, 'S1', null, null],
      [1, 'S1', 'A', 1],
      [2, 'S1', 'A1', 1],
      [0, 'S2', null, null],
    ]);
  });
});
```

`apps/web/src/features/checklists/builder/reducer.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { builderReducer, type BuilderAction, type BuilderState, HISTORY_LIMIT, initialState } from './reducer';
import { findItem } from './tree';
import { treeFixture } from './fixtures';

const run = (s: BuilderState, ...actions: BuilderAction[]) => actions.reduce(builderReducer, s);

describe('builderReducer', () => {
  it('adds an item and selects it', () => {
    const f = treeFixture();
    const s = run(initialState(f.content), { type: 'addItem', container: { kind: 'section', sectionId: f.s2.id }, itemType: 'number' });
    const added = s.content.sections[1]!.items[1]!;
    expect(added.type).toBe('number');
    expect(s.selected).toEqual({ kind: 'item', id: added.id });
    expect(s.version).toBe(1);
  });

  it('coalesces typing into one undo step', () => {
    const f = treeFixture();
    let s = initialState(f.content);
    for (const label of ['B', 'Bo', 'Bos']) s = builderReducer(s, { type: 'updateItem', itemId: f.b.id, patch: { label } });
    expect(s.past).toHaveLength(1);
    s = builderReducer(s, { type: 'updateItem', itemId: f.b.id, patch: { required: false } });
    expect(s.past).toHaveLength(2);
    s = run(s, { type: 'undo' }, { type: 'undo' });
    expect(findItem(s.content, f.b.id)!.item.label).toBe('B');
    s = builderReducer(s, { type: 'redo' });
    expect(findItem(s.content, f.b.id)!.item.label).toBe('Bos');
    expect(s.version).toBe(7);
  });

  it('caps history at 50 and clears redo on a new change', () => {
    const f = treeFixture();
    let s = initialState(f.content);
    for (let i = 0; i < 60; i++) s = builderReducer(s, { type: 'moveSection', sectionId: f.s1.id, index: i % 2 });
    expect(s.past.length).toBe(HISTORY_LIMIT);
    s = run(s, { type: 'undo' }, { type: 'addSection' });
    expect(s.future).toEqual([]);
  });

  it('duplicates with fresh ids right after the original', () => {
    const f = treeFixture();
    const s = run(initialState(f.content), { type: 'duplicateItem', itemId: f.a.id });
    const [orig, copy] = s.content.sections[0]!.items;
    expect(copy!.label).toBe('A');
    expect(copy!.id).not.toBe(orig!.id);
    expect(s.selected).toEqual({ kind: 'item', id: copy!.id });
  });

  it('edits rules and follow-ups, respecting depth', () => {
    const f = treeFixture();
    const noRule = initialState(f.content);
    expect(builderReducer(noRule, { type: 'addRule', itemId: f.b.id })).toBe(noRule);
    let s = run(initialState(f.content), { type: 'addRule', itemId: f.a.id });
    const newRule = (findItem(s.content, f.a.id)!.item as typeof f.a).rules[1]!;
    s = run(s, { type: 'updateRule', itemId: f.a.id, ruleId: newRule.id, patch: { then: { problem: 'critical' } } });
    expect((findItem(s.content, f.a.id)!.item as typeof f.a).rules[1]!.then).toMatchObject({ problem: 'critical', followUps: [] });
    const depth3 = { kind: 'rule' as const, itemId: f.a1.id, ruleId: f.rule1.id };
    s = run(s, { type: 'addItem', container: depth3, itemType: 'text' });
    expect(findItem(s.content, f.a1.id)!.item).toMatchObject({ rules: [{ then: { followUps: [{}, {}] } }] });
    s = run(s, { type: 'removeRule', itemId: f.a.id, ruleId: f.rule.id });
    expect(findItem(s.content, f.a1.id)).toBeNull();
  });

  it('drops a removed selection back to its section', () => {
    const f = treeFixture();
    const s = run(initialState(f.content), { type: 'select', node: { kind: 'item', id: f.b.id } }, { type: 'removeItem', itemId: f.b.id });
    expect(s.selected).toEqual({ kind: 'section', id: f.s1.id });
    const u = builderReducer(s, { type: 'undo' });
    expect(findItem(u.content, f.b.id)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @taskop/web test -- builder/`
Expected: FAIL, because the modules don't exist.

- [ ] **Step 3: Implement `tree.ts`**

```ts
import { type ChecklistContent, CONTENT_LIMITS, hasRules, type Item } from '@taskop/contracts';

export type ContainerRef = { kind: 'section'; sectionId: string } | { kind: 'rule'; itemId: string; ruleId: string };
export type NodeRef = { kind: 'settings' } | { kind: 'section'; id: string } | { kind: 'item'; id: string };

export const containerKey = (c: ContainerRef): string => (c.kind === 'section' ? `section:${c.sectionId}` : `rule:${c.itemId}:${c.ruleId}`);

export interface FoundItem {
  item: Item;
  list: Item[];
  index: number;
  container: ContainerRef;
  depth: number;
  sectionId: string;
}

export function findItem(content: ChecklistContent, itemId: string): FoundItem | null {
  const search = (list: Item[], container: ContainerRef, depth: number, sectionId: string): FoundItem | null => {
    for (let index = 0; index < list.length; index++) {
      const item = list[index]!;
      if (item.id === itemId) return { item, list, index, container, depth, sectionId };
      if (hasRules(item)) {
        for (const rule of item.rules) {
          const hit = search(rule.then.followUps, { kind: 'rule', itemId: item.id, ruleId: rule.id }, depth + 1, sectionId);
          if (hit) return hit;
        }
      }
    }
    return null;
  };
  for (const s of content.sections) {
    const hit = search(s.items, { kind: 'section', sectionId: s.id }, 0, s.id);
    if (hit) return hit;
  }
  return null;
}

export function rootItemId(content: ChecklistContent, itemId: string): string | null {
  let found = findItem(content, itemId);
  while (found && found.container.kind === 'rule') found = findItem(content, found.container.itemId);
  return found?.item.id ?? null;
}

export function containerItems(content: ChecklistContent, c: ContainerRef): Item[] | null {
  if (c.kind === 'section') return content.sections.find((s) => s.id === c.sectionId)?.items ?? null;
  const owner = findItem(content, c.itemId);
  if (!owner || !hasRules(owner.item)) return null;
  return owner.item.rules.find((r) => r.id === c.ruleId)?.then.followUps ?? null;
}

/** Depth of the items that live in `c` (section = 0). */
export function containerDepth(content: ChecklistContent, c: ContainerRef): number | null {
  if (c.kind === 'section') return content.sections.some((s) => s.id === c.sectionId) ? 0 : null;
  const owner = findItem(content, c.itemId);
  return owner && containerItems(content, c) ? owner.depth + 1 : null;
}

export function subtreeHeight(item: Item): number {
  if (!hasRules(item)) return 0;
  let h = 0;
  for (const r of item.rules) for (const f of r.then.followUps) h = Math.max(h, 1 + subtreeHeight(f));
  return h;
}

function contains(item: Item, itemId: string): boolean {
  if (item.id === itemId) return true;
  return hasRules(item) && item.rules.some((r) => r.then.followUps.some((f) => contains(f, itemId)));
}

export function canMoveTo(content: ChecklistContent, itemId: string, to: ContainerRef): boolean {
  const found = findItem(content, itemId);
  const depth = containerDepth(content, to);
  if (!found || depth === null) return false;
  if (to.kind === 'rule' && contains(found.item, to.itemId)) return false;
  return depth + subtreeHeight(found.item) <= CONTENT_LIMITS.followUpDepth;
}

const edit = (content: ChecklistContent, fn: (draft: ChecklistContent) => void): ChecklistContent => {
  const d = structuredClone(content);
  fn(d);
  return d;
};
export { edit };

/** `index` is the final position in the target list (after removal from the source). */
export function moveItem(content: ChecklistContent, itemId: string, to: ContainerRef, index: number): ChecklistContent {
  if (!canMoveTo(content, itemId, to)) return content;
  return edit(content, (d) => {
    const found = findItem(d, itemId)!;
    found.list.splice(found.index, 1);
    const target = containerItems(d, to)!;
    target.splice(Math.max(0, Math.min(index, target.length)), 0, found.item);
  });
}

export function insertItem(content: ChecklistContent, to: ContainerRef, index: number, item: Item): ChecklistContent {
  return edit(content, (d) => {
    const target = containerItems(d, to);
    if (target) target.splice(Math.max(0, Math.min(index, target.length)), 0, item);
  });
}

export function removeItem(content: ChecklistContent, itemId: string): ChecklistContent {
  return edit(content, (d) => {
    const found = findItem(d, itemId);
    if (found) found.list.splice(found.index, 1);
  });
}

export function moveSection(content: ChecklistContent, sectionId: string, index: number): ChecklistContent {
  const from = content.sections.findIndex((s) => s.id === sectionId);
  if (from < 0) return content;
  return edit(content, (d) => {
    const [s] = d.sections.splice(from, 1);
    d.sections.splice(Math.max(0, Math.min(index, d.sections.length)), 0, s!);
  });
}

export interface ContainerOption {
  ref: ContainerRef;
  key: string;
  depth: number;
  sectionTitle: string;
  ownerLabel: string | null;
  ruleNo: number | null;
}

export function listContainers(content: ChecklistContent): ContainerOption[] {
  const out: ContainerOption[] = [];
  const visit = (items: Item[], depth: number, sectionTitle: string) => {
    for (const item of items) {
      if (!hasRules(item)) continue;
      item.rules.forEach((rule, i) => {
        const ref: ContainerRef = { kind: 'rule', itemId: item.id, ruleId: rule.id };
        out.push({ ref, key: containerKey(ref), depth: depth + 1, sectionTitle, ownerLabel: item.label, ruleNo: i + 1 });
        visit(rule.then.followUps, depth + 1, sectionTitle);
      });
    }
  };
  for (const s of content.sections) {
    const ref: ContainerRef = { kind: 'section', sectionId: s.id };
    out.push({ ref, key: containerKey(ref), depth: 0, sectionTitle: s.title, ownerLabel: null, ruleNo: null });
    visit(s.items, 0, s.title);
  }
  return out;
}
```

- [ ] **Step 4: Implement `reducer.ts`**

```ts
import {
  type ChecklistContent,
  CONTENT_LIMITS,
  hasRules,
  type Item,
  type ItemType,
  newItem,
  newRule,
  newSection,
  regenerateItemIds,
  type Rule,
  type Section,
} from '@taskop/contracts';
import { containerDepth, type ContainerRef, containerItems, edit, findItem, insertItem, moveItem, moveSection, type NodeRef, removeItem } from './tree';

export const HISTORY_LIMIT = 50;

export interface BuilderState {
  content: ChecklistContent;
  past: ChecklistContent[];
  future: ChecklistContent[];
  selected: NodeRef;
  /** Bumps on every content change (incl. undo/redo); autosave compares it with the last saved value. */
  version: number;
  /** Consecutive edits with the same key (same node + fields) share one undo step. */
  lastKey: string | null;
}

export interface RulePatch {
  when?: Rule['when'];
  then?: Partial<Omit<Rule['then'], 'followUps'>>;
}

export type BuilderAction =
  | { type: 'select'; node: NodeRef }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'updateSettings'; patch: Partial<Pick<ChecklistContent, 'instructions' | 'scoring'>> }
  | { type: 'addSection' }
  | { type: 'updateSection'; sectionId: string; patch: Partial<Pick<Section, 'title' | 'instructions'>> }
  | { type: 'removeSection'; sectionId: string }
  | { type: 'moveSection'; sectionId: string; index: number }
  | { type: 'addItem'; container: ContainerRef; index?: number; itemType: ItemType }
  | { type: 'updateItem'; itemId: string; patch: Partial<Item> }
  | { type: 'removeItem'; itemId: string }
  | { type: 'duplicateItem'; itemId: string }
  | { type: 'moveItem'; itemId: string; to: ContainerRef; index: number }
  | { type: 'addRule'; itemId: string }
  | { type: 'updateRule'; itemId: string; ruleId: string; patch: RulePatch }
  | { type: 'removeRule'; itemId: string; ruleId: string };

export const initialState = (content: ChecklistContent): BuilderState => ({
  content,
  past: [],
  future: [],
  selected: { kind: 'settings' },
  version: 0,
  lastKey: null,
});

const keyOf = (id: string, patch: object) => `${id}:${Object.keys(patch).sort().join(',')}`;

function commit(state: BuilderState, content: ChecklistContent, opts: { key?: string; selected?: NodeRef } = {}): BuilderState {
  if (content === state.content) return state;
  const coalesce = opts.key !== undefined && opts.key === state.lastKey;
  return {
    content,
    past: coalesce ? state.past : [...state.past, state.content].slice(-HISTORY_LIMIT),
    future: [],
    selected: opts.selected ?? state.selected,
    version: state.version + 1,
    lastKey: opts.key ?? null,
  };
}

function validSelection(content: ChecklistContent, sel: NodeRef): NodeRef {
  if (sel.kind === 'item' && !findItem(content, sel.id)) return { kind: 'settings' };
  if (sel.kind === 'section' && !content.sections.some((s) => s.id === sel.id)) return { kind: 'settings' };
  return sel;
}

function editRule(content: ChecklistContent, itemId: string, fn: (rules: Rule[]) => void): ChecklistContent {
  const found = findItem(content, itemId);
  if (!found || !hasRules(found.item)) return content;
  return edit(content, (d) => {
    const item = findItem(d, itemId)!.item;
    if (hasRules(item)) fn(item.rules);
  });
}

export function builderReducer(state: BuilderState, action: BuilderAction): BuilderState {
  const c = state.content;
  switch (action.type) {
    case 'select':
      return { ...state, selected: action.node, lastKey: null };
    case 'undo': {
      const prev = state.past.at(-1);
      if (!prev) return state;
      return { ...state, content: prev, past: state.past.slice(0, -1), future: [c, ...state.future], version: state.version + 1, lastKey: null, selected: validSelection(prev, state.selected) };
    }
    case 'redo': {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return { ...state, content: next, past: [...state.past, c].slice(-HISTORY_LIMIT), future: rest, version: state.version + 1, lastKey: null, selected: validSelection(next, state.selected) };
    }
    case 'updateSettings':
      return commit(state, edit(c, (d) => Object.assign(d, action.patch)), { key: keyOf('settings', action.patch) });
    case 'addSection': {
      const s = newSection();
      return commit(state, edit(c, (d) => void d.sections.push(s)), { selected: { kind: 'section', id: s.id } });
    }
    case 'updateSection':
      return commit(
        state,
        edit(c, (d) => {
          const s = d.sections.find((x) => x.id === action.sectionId);
          if (s) Object.assign(s, action.patch);
        }),
        { key: keyOf(action.sectionId, action.patch) },
      );
    case 'removeSection':
      return commit(state, edit(c, (d) => void (d.sections = d.sections.filter((s) => s.id !== action.sectionId))), { selected: { kind: 'settings' } });
    case 'moveSection':
      return commit(state, moveSection(c, action.sectionId, action.index));
    case 'addItem': {
      const depth = containerDepth(c, action.container);
      if (depth === null || depth > CONTENT_LIMITS.followUpDepth) return state;
      const item = newItem(action.itemType);
      const length = containerItems(c, action.container)!.length;
      return commit(state, insertItem(c, action.container, action.index ?? length, item), { selected: { kind: 'item', id: item.id } });
    }
    case 'updateItem':
      if (!findItem(c, action.itemId)) return state;
      return commit(state, edit(c, (d) => void Object.assign(findItem(d, action.itemId)!.item, action.patch)), { key: keyOf(action.itemId, action.patch) });
    case 'removeItem': {
      const found = findItem(c, action.itemId);
      if (!found) return state;
      return commit(state, removeItem(c, action.itemId), { selected: { kind: 'section', id: found.sectionId } });
    }
    case 'duplicateItem': {
      const found = findItem(c, action.itemId);
      if (!found) return state;
      const copy = regenerateItemIds(found.item);
      return commit(state, insertItem(c, found.container, found.index + 1, copy), { selected: { kind: 'item', id: copy.id } });
    }
    case 'moveItem':
      return commit(state, moveItem(c, action.itemId, action.to, action.index));
    case 'addRule': {
      const found = findItem(c, action.itemId);
      if (!found || !hasRules(found.item)) return state;
      const rule = newRule(found.item);
      return commit(state, editRule(c, action.itemId, (rules) => void rules.push(rule)));
    }
    case 'updateRule':
      return commit(
        state,
        editRule(c, action.itemId, (rules) => {
          const rule = rules.find((r) => r.id === action.ruleId);
          if (!rule) return;
          if (action.patch.when) rule.when = action.patch.when;
          if (action.patch.then) Object.assign(rule.then, action.patch.then);
        }),
        { key: keyOf(action.ruleId, { ...(action.patch.when ? { when: 1 } : {}), ...action.patch.then }) },
      );
    case 'removeRule':
      return commit(state, editRule(c, action.itemId, (rules) => void rules.splice(rules.findIndex((r) => r.id === action.ruleId) >>> 0, 1)));
  }
}
```

`removeRule` uses `>>> 0` so a missing rule (index −1) becomes a huge index and `splice` does nothing.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @taskop/web test -- builder/`
Expected: PASS.

The version count in `coalesces typing…`: 4 edits (3 coalesced labels count as 3 versions, plus `required`), then 2 undos and 1 redo, gives 7.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/checklists/builder
git commit -m "feat(web): add checklist builder tree helpers and undoable reducer"
```

---

### Task W3: Autosave hook and issue indexing

**Files:**
- Create: `apps/web/src/features/checklists/builder/use-autosave.ts`, `apps/web/src/features/checklists/builder/issues.ts`
- Test: `apps/web/src/features/checklists/builder/use-autosave.test.ts`, `apps/web/src/features/checklists/builder/issues.test.ts`

**Interfaces:**
- Consumes: `ApiError` from api-client, plus `ContentSaveResult`, `ContentIssue` and `ChecklistContent` from contracts.
- Produces:
  - `useAutosave({ content, version, initialRevision, save?, delayMs? })` → `{ status: SaveStatus; flush(): Promise<boolean>; revision(): number }`
  - `SaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict'`
  - `indexIssues(content, issues)` → `IssueIndex = { byNode: Map<string, NodeIssue[]>; list: LocatedIssue[] }`
    - `NodeIssue = { field: string | null; code: string }`
    - `LocatedIssue = { code: string; field: string | null; node: { kind: 'section' | 'item'; id: string } | null }`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/checklists/builder/use-autosave.test.ts`:
```ts
import { ApiError } from '@taskop/api-client';
import { blankContent, type ChecklistContent } from '@taskop/contracts';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutosave } from './use-autosave';

const c = (title: string): ChecklistContent => ({ ...blankContent(), instructions: title });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useAutosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces changes into one save with the latest content', async () => {
    const save = vi.fn(async (_c: ChecklistContent, revision: number) => ({ revision: revision + 1, issues: [] }));
    const { result, rerender } = renderHook((p: { content: ChecklistContent; version: number }) => useAutosave({ ...p, initialRevision: 3, save }), {
      initialProps: { content: c('a'), version: 0 },
    });
    expect(result.current.status).toBe('saved');
    rerender({ content: c('ab'), version: 1 });
    rerender({ content: c('abc'), version: 2 });
    expect(result.current.status).toBe('dirty');
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(c('abc'), 3);
    expect(result.current.status).toBe('saved');
    expect(result.current.revision()).toBe(4);
  });

  it('flush saves newer edits made during an in-flight save', async () => {
    const first = deferred<{ revision: number; issues: [] }>();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce({ revision: 3, issues: [] });
    const { result, rerender } = renderHook((p: { content: ChecklistContent; version: number }) => useAutosave({ ...p, initialRevision: 1, save }), {
      initialProps: { content: c('a'), version: 0 },
    });
    rerender({ content: c('b'), version: 1 });
    let done: Promise<boolean>;
    act(() => {
      done = result.current.flush();
    });
    rerender({ content: c('c'), version: 2 });
    const again = result.current.flush();
    await act(async () => first.resolve({ revision: 2, issues: [] }));
    await expect(done!).resolves.toBe(true);
    await expect(again).resolves.toBe(true);
    expect(save.mock.calls.map((call) => [call[0].instructions, call[1]])).toEqual([['b', 1], ['c', 2]]);
    expect(result.current.revision()).toBe(3);
  });

  it('stops on a conflict and reports errors', async () => {
    const save = vi.fn().mockRejectedValueOnce(new ApiError(409, 'CHECKLIST_DRAFT_CONFLICT', 'x', null, null, null, null, 9));
    const { result, rerender } = renderHook((p: { content: ChecklistContent; version: number }) => useAutosave({ ...p, initialRevision: 1, save }), {
      initialProps: { content: c('a'), version: 0 },
    });
    rerender({ content: c('b'), version: 1 });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(result.current.status).toBe('conflict');
    rerender({ content: c('c'), version: 2 });
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(save).toHaveBeenCalledTimes(1);
    await expect(result.current.flush()).resolves.toBe(false);
  });

  it('marks network errors and retries on the next change', async () => {
    const save = vi.fn().mockRejectedValueOnce(ApiError.network()).mockResolvedValueOnce({ revision: 2, issues: [] });
    const { result, rerender } = renderHook((p: { content: ChecklistContent; version: number }) => useAutosave({ ...p, initialRevision: 1, save }), {
      initialProps: { content: c('a'), version: 0 },
    });
    rerender({ content: c('b'), version: 1 });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(result.current.status).toBe('error');
    rerender({ content: c('bc'), version: 2 });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(result.current.status).toBe('saved');
  });

  it('never saves without a save function (read-only)', async () => {
    const { result, rerender } = renderHook((p: { content: ChecklistContent; version: number }) => useAutosave({ ...p, initialRevision: 1 }), {
      initialProps: { content: c('a'), version: 0 },
    });
    rerender({ content: c('b'), version: 1 });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current.status).toBe('saved');
  });

  it('flushes when the page is hidden', async () => {
    const save = vi.fn(async () => ({ revision: 2, issues: [] }));
    const { rerender } = renderHook((p: { content: ChecklistContent; version: number }) => useAutosave({ ...p, initialRevision: 1, save }), {
      initialProps: { content: c('a'), version: 0 },
    });
    rerender({ content: c('b'), version: 1 });
    await act(async () => window.dispatchEvent(new Event('pagehide')));
    expect(save).toHaveBeenCalledTimes(1);
  });
});
```

`apps/web/src/features/checklists/builder/issues.test.ts`:
```ts
import { validateForPublish } from '@taskop/contracts';
import { describe, expect, it } from 'vitest';
import { indexIssues } from './issues';
import { treeFixture } from './fixtures';

describe('indexIssues', () => {
  it('attaches issues to the deepest section or item on the path', () => {
    const f = treeFixture();
    f.content.sections[1]!.title = '';
    f.a11.label = '';
    const idx = indexIssues(f.content, validateForPublish(f.content));
    expect(idx.byNode.get(f.s2.id)).toEqual([{ field: 'title', code: 'checklists.issues.titleRequired' }]);
    expect(idx.byNode.get(f.a.id)).toEqual([{ field: 'rules', code: 'checklists.issues.ruleNoOptions' }]);
    expect(idx.byNode.get(f.a11.id)).toEqual([{ field: 'label', code: 'checklists.issues.labelRequired' }]);
    expect(idx.list.find((i) => i.node?.id === f.a11.id)).toEqual({ code: 'checklists.issues.labelRequired', field: 'label', node: { kind: 'item', id: f.a11.id } });
  });

  it('keeps checklist-level issues without a node', () => {
    const f = treeFixture();
    const idx = indexIssues(f.content, [{ path: ['sections'], code: 'checklists.issues.noItems' }]);
    expect(idx.list).toEqual([{ code: 'checklists.issues.noItems', field: null, node: null }]);
  });
});
```

The fixture's rules have empty `optionIds` (from `newRule`), so `A` and `A1` both report `ruleNoOptions`. The first test asserts only on `A`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @taskop/web test -- use-autosave issues`
Expected: FAIL, because the modules don't exist.

- [ ] **Step 3: Implement `use-autosave.ts`**

```ts
import { ApiError } from '@taskop/api-client';
import type { ChecklistContent, ContentSaveResult } from '@taskop/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

interface Options {
  content: ChecklistContent;
  version: number;
  initialRevision: number;
  /** Absent in read-only mode: nothing is ever saved. */
  save?: (content: ChecklistContent, revision: number) => Promise<ContentSaveResult>;
  delayMs?: number;
}

const CONFLICTS = new Set(['CHECKLIST_DRAFT_CONFLICT', 'TEMPLATE_CONFLICT']);

/**
 * Debounced autosave with one request in flight. Each save sends the last known revision;
 * a conflict stops autosave until the page reloads the draft.
 */
export function useAutosave({ content, version, initialRevision, save, delayMs = 1500 }: Options) {
  const [status, setStatus] = useState<SaveStatus>('saved');
  const latest = useRef({ content, version });
  latest.current = { content, version };
  const saveRef = useRef(save);
  saveRef.current = save;
  const savedVersion = useRef(version);
  const revision = useRef(initialRevision);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const blocked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const runOnce = useCallback(async (): Promise<boolean> => {
    const snap = latest.current;
    if (snap.version === savedVersion.current) {
      setStatus('saved');
      return true;
    }
    setStatus('saving');
    try {
      const res = await saveRef.current!(snap.content, revision.current);
      revision.current = res.revision;
      savedVersion.current = snap.version;
      // Edits made while this request was in flight are saved right away.
      return runOnce();
    } catch (e) {
      const conflict = e instanceof ApiError && CONFLICTS.has(e.code);
      blocked.current = conflict;
      setStatus(conflict ? 'conflict' : 'error');
      return false;
    }
  }, []);

  const flush = useCallback((): Promise<boolean> => {
    clearTimeout(timer.current);
    if (blocked.current) return Promise.resolve(false);
    if (!saveRef.current) return Promise.resolve(latest.current.version === savedVersion.current);
    inFlight.current ??= runOnce().finally(() => {
      inFlight.current = null;
    });
    return inFlight.current;
  }, [runOnce]);

  // Depend on whether saving is possible, not on `save` itself: callers pass inline lambdas,
  // and a new identity every render must not restart the debounce.
  const canSave = Boolean(save);
  useEffect(() => {
    if (!canSave || blocked.current || version === savedVersion.current) return;
    setStatus((s) => (s === 'saving' ? s : 'dirty'));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), delayMs);
  }, [version, canSave, delayMs, flush]);

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    const onPageHide = () => void flush();
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
      clearTimeout(timer.current);
      // Leaving the builder (e.g. navigating away) still saves pending edits.
      if (latest.current.version !== savedVersion.current) void flush();
    };
  }, [flush]);

  return { status, flush, revision: () => revision.current };
}
```

In the in-flight test, the second `flush()` call returns the same promise as the first, because `inFlight.current ??=` reuses it. That promise resolves only after `runOnce` has saved version 2 as well.

- [ ] **Step 4: Implement `issues.ts`**

```ts
import type { ChecklistContent, ContentIssue } from '@taskop/contracts';

export interface NodeIssue {
  field: string | null;
  code: string;
}
export interface LocatedIssue extends NodeIssue {
  node: { kind: 'section' | 'item'; id: string } | null;
}
export interface IssueIndex {
  byNode: Map<string, NodeIssue[]>;
  list: LocatedIssue[];
}

function nodeKind(v: unknown): 'section' | 'item' | null {
  if (!v || typeof v !== 'object' || typeof (v as { id?: unknown }).id !== 'string') return null;
  if ('title' in v && 'items' in v) return 'section';
  if ('type' in v && 'label' in v) return 'item';
  return null;
}

/** Maps each issue path (e.g. sections.0.items.2.rules.0.when) to the deepest section/item it passes through. */
export function indexIssues(content: ChecklistContent, issues: ContentIssue[]): IssueIndex {
  const byNode = new Map<string, NodeIssue[]>();
  const list: LocatedIssue[] = [];
  for (const issue of issues) {
    let cur: unknown = content;
    let node: LocatedIssue['node'] = null;
    let field: string | null = null;
    for (const seg of issue.path) {
      cur = cur && typeof cur === 'object' ? (cur as Record<string | number, unknown>)[seg] : undefined;
      const kind = nodeKind(cur);
      if (kind) {
        node = { kind, id: (cur as { id: string }).id };
        field = null;
      } else if (node && field === null && typeof seg === 'string') {
        field = seg;
      }
    }
    list.push({ code: issue.code, field, node });
    if (node) byNode.set(node.id, [...(byNode.get(node.id) ?? []), { field, code: issue.code }]);
  }
  return { byNode, list };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @taskop/web test -- use-autosave issues`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/checklists/builder
git commit -m "feat(web): add builder autosave hook and issue indexing"
```

---

### Task W4: Strings, workspace context, checklists list and "new checklist"

**Files:**
- Modify: `packages/i18n/src/az/checklists.ts`, `packages/i18n/src/az/nav.ts`, `packages/i18n/src/az/platform.ts`, `apps/web/src/layouts/app-shell.tsx`, `apps/web/src/router.tsx`
- Create: `apps/web/src/features/checklists/workspace.tsx`, `queries.ts`, `labels.ts`, `checklists-page.tsx`, `new-checklist-dialog.tsx`, `template-picker.tsx`, `routes.tsx`, `apps/web/src/test/workspace.tsx`
- Test: `apps/web/src/features/checklists/checklists-page.test.tsx`

**Interfaces:**
- Consumes: `ChecklistsApi`, `TemplatesApi` (W1), and `useCan` / `useMe` / `api` from `@/lib/session`.
- Produces:
  - `ChecklistWorkspace = { checklists; templates; can: { manage; publish; templates }; base: string; scope: string; timeZone: string; go(to: string): void }`, where `go` takes a path relative to `base`
  - Components: `WorkspaceProvider`, `TenantWorkspace`, `PlatformTenantWorkspace`, `WsLink`, plus the hook `useWorkspace()`
  - Queries: `useChecklistPages(filters)`, `useChecklist(id)`, `useTemplates(query)`
  - Labels: `optionLabel(t, item, option, index)`, `categoryLabel(t, category)`
  - Pages and components: `ChecklistsPage`, `NewChecklistDialog`, `TemplatePicker`
  - Test helpers: `fakeWorkspace(overrides?)` and `renderInWorkspace(ui, ws?)`
  - Route adapters in `routes.tsx` (filled in over W4–W8)

- [ ] **Step 1: Add the UI strings**

Replace `packages/i18n/src/az/checklists.ts` with the Part 1 content (`issues`, `categories`, `itemTypes`, unchanged) plus the UI keys below. Keep the three Part 1 objects exactly as they are, and add the rest after them:
```ts
  title: 'Yoxlama vərəqələri',
  new: 'Yeni yoxlama vərəqəsi',
  empty: 'Hələ yoxlama vərəqəsi yoxdur.',
  name: 'Ad',
  description: 'Təsvir',
  category: 'Kateqoriya',
  noCategory: 'Kateqoriyasız',
  statuses: { active: 'Aktiv', deactivated: 'Deaktiv' },
  version: 'Versiya',
  versionN: 'v{{n}}',
  notPublished: 'Dərc edilməyib',
  draft: 'Qaralama',
  updated: 'Yenilənib',
  filters: { search: 'Ad üzrə axtar', allStatuses: 'Bütün statuslar', allCategories: 'Bütün kateqoriyalar', status: 'Status üzrə filtr', category: 'Kateqoriya üzrə filtr' },
  create: {
    title: 'Yeni yoxlama vərəqəsi',
    blank: 'Boş',
    fromTemplate: 'Şablondan',
    copy: 'Mövcuddan kopyala',
    pickTemplate: 'Şablon seçin',
    pickChecklist: 'Yoxlama vərəqəsi',
    copySuffix: '{{name}} (surət)',
    noPublished: 'Kopyalamaq üçün dərc edilmiş yoxlama vərəqəsi yoxdur.',
    nameRequired: 'Adı yazın.',
    templateRequired: 'Şablon seçin.',
  },
  detail: {
    edit: 'Redaktə et',
    continueDraft: 'Qaralamaya davam et',
    copy: 'Kopyala',
    editDetails: 'Məlumatları dəyiş',
    versions: 'Versiyalar',
    publishedAt: 'Dərc tarixi',
    publishedBy: 'Dərc edən',
    changeNote: 'Dəyişiklik qeydi',
    open: 'Bax',
    restore: 'Qaralama kimi bərpa et',
    saveAsTemplate: 'Şablon kimi saxla',
    taskop: 'Taskop',
    confirmDeactivate: '«{{name}}» deaktiv edilsin? Versiyalar və tarixçə saxlanılacaq.',
    deactivatedBanner: 'Bu yoxlama vərəqəsi deaktivdir və dəyişdirilə bilməz.',
    discardDraft: 'Qaralamanı sil',
    confirmDiscard: 'Qaralamadakı dərc edilməmiş dəyişikliklər silinsin?',
    source: { global: 'Taskop şablonundan yaradılıb', tenant: 'Öz şablonumuzdan yaradılıb', version: 'Başqa yoxlama vərəqəsinin surətidir' },
  },
  saveAsTemplate: { title: 'Şablon kimi saxla', done: 'Şablon yaradıldı' },
  templates: {
    title: 'Şablonlar',
    taskop: 'Taskop şablonları',
    ours: 'Bizim şablonlar',
    new: 'Yeni şablon',
    use: 'İstifadə et',
    preview: 'Bax',
    editTemplate: 'Redaktə et',
    items: '{{count}} bənd',
    empty: 'Şablon tapılmadı.',
    useTitle: 'Şablondan yoxlama vərəqəsi',
    published: 'Dərc edilib',
    unpublished: 'Gizli',
    publish: 'Dərc et',
    unpublish: 'Gizlət',
    sortOrder: 'Sıra',
    template: 'Şablon',
  },
  builder: {
    outline: 'Struktur',
    settings: 'Ümumi parametrlər',
    addSection: 'Bölmə əlavə et',
    addItem: 'Bənd əlavə et',
    addFollowUp: 'Əlavə sual',
    untitledSection: 'Adsız bölmə',
    untitledItem: 'Mətnsiz sual',
    sectionTitle: 'Bölmənin adı',
    sectionInstructions: 'Bölmə üzrə təlimat',
    deleteSection: 'Bölməni sil',
    confirmDeleteSection: 'Bölmə və içindəki {{count}} bənd silinsin?',
    duplicate: 'Kopyala',
    delete: 'Sil',
    moveTo: 'Köçür…',
    dragHandle: 'Sürüşdürmək üçün tutun',
    moveTitle: 'Köçür',
    target: 'Hara',
    position: 'Mövqe',
    sectionTarget: 'Bölmə: {{title}}',
    followUpsOf: '↳ {{label}} — qayda {{n}}',
    save: {
      saving: 'Yadda saxlanılır…',
      saved: 'Yadda saxlanıldı',
      dirty: 'Yadda saxlanılmamış dəyişikliklər',
      error: 'Yadda saxlamaq alınmadı',
      conflict: 'Bu qaralama başqa yerdə dəyişdirilib.',
      reload: 'Yenidən yüklə',
      confirmReload: 'Yadda saxlanılmamış dəyişikliklər itəcək. Davam edilsin?',
    },
    undo: 'Geri al',
    redo: 'Təkrarla',
    preview: 'Önizləmə',
    closePreview: 'Redaktora qayıt',
    publish: 'Dərc et',
    publishTitle: 'Yeni versiyanı dərc et',
    changeNote: 'Dəyişiklik qeydi (istəyə bağlı)',
    published: 'v{{n}} dərc edildi',
    issues_one: '{{count}} xəta',
    issues_other: '{{count}} xəta',
    noIssues: 'Xəta yoxdur',
    readOnly: 'Yalnız baxış',
    noDraft: 'Bu yoxlama vərəqəsinin açıq qaralaması yoxdur.',
    startDraft: 'Redaktəyə başla',
    instructions: 'Ümumi təlimat',
    scoringEnabled: 'Bal hesablansın',
    problemsReduceScore: 'Problemlər balı azaltsın',
    item: {
      label: 'Sualın mətni',
      helpText: 'Köməkçi mətn',
      required: 'Məcburi',
      weight: 'Çəki (bal)',
      photo: 'Foto',
      video: 'Video',
      liveOnly: 'Yalnız kamera ilə (canlı sübut)',
      options: 'Seçimlər',
      addOption: 'Seçim əlavə et',
      option: 'Seçim {{n}}',
      removeOption: 'Seçimi sil',
      moveUp: 'Yuxarı',
      moveDown: 'Aşağı',
      unit: 'Vahid',
      min: 'Minimum',
      max: 'Maksimum',
      decimals: 'Onluq rəqəmlər',
      maxLength: 'Maksimum uzunluq',
      minCount: 'Minimum say',
      maxCount: 'Maksimum say',
      mode: 'Format',
      modes: { date: 'Tarix', time: 'Vaxt', datetime: 'Tarix və vaxt' },
    },
    evidence: { none: 'Yoxdur', optional: 'İstəyə bağlı', required: 'Məcburi' },
    fixedOptions: { yes: 'Bəli', no: 'Xeyr', confirm: 'Təsdiq', deny: 'İnkar' },
    rules: {
      title: 'Qaydalar',
      add: 'Qayda əlavə et',
      remove: 'Qaydanı sil',
      ruleN: 'Qayda {{n}}',
      whenOptions: 'Cavab bunlardan biridirsə',
      whenNumber: 'Cavab',
      value: 'Dəyər',
      problem: 'Problem',
      problemNone: 'Yoxdur',
      problemNormal: 'Adi',
      problemCritical: 'Kritik',
      requireNote: 'Qeyd tələb et',
      requirePhoto: 'Foto tələb et',
      requireVideo: 'Video tələb et',
      followUps: 'Əlavə suallar',
      depthLimit: 'Əlavə sualların dərinliyi maksimuma çatıb.',
      ops: { lt: 'kiçikdir', lte: 'kiçik və ya bərabərdir', gt: 'böyükdür', gte: 'böyük və ya bərabərdir', eq: 'bərabərdir', between: 'aralığındadır', outside: 'aralığından kənardadır' },
    },
    preview: {
      title: 'Önizləmə',
      missing_one: '{{count}} tələb tamamlanmayıb',
      missing_other: '{{count}} tələb tamamlanmayıb',
      complete: 'Tamamlana bilər',
      score: 'Bal: {{percent}}%',
      noScore: 'Bal hesablanmır',
      note: 'Qeyd',
      addPhoto: 'Foto əlavə et (nümunə)',
      addVideo: 'Video əlavə et (nümunə)',
      media: '{{count}} fayl',
      problem: 'Problem',
      critical: 'Kritik problem',
      missingKinds: { answer: 'Cavab tələb olunur', photo: 'Foto tələb olunur', video: 'Video tələb olunur', note: 'Qeyd tələb olunur', mediaCount: 'Daha çox fayl tələb olunur' },
    },
  },
```

`packages/i18n/src/az/nav.ts`: add `checklists: 'Yoxlama vərəqələri',` and `templates: 'Şablonlar',`. Replace `intro` with:
```ts
  intro: 'Təşkilatınızı, obyektləri, komandaları və əməkdaşları qurun, yoxlama vərəqələrini yaradın və dərc edin. Planlaşdırma və icra növbəti mərhələlərdə əlavə olunacaq.',
```

`packages/i18n/src/az/platform.ts`: add
```ts
  nav: { tenants: 'Təşkilatlar', templates: 'Şablonlar' },
  workspaceBanner: 'Siz Taskop administratoru kimi «{{name}}» təşkilatında işləyirsiniz.',
  backToTenants: 'Təşkilatlara qayıt',
```
and inside `tenants` add `checklists: 'Yoxlama vərəqələri',`.

Run `pnpm --filter @taskop/i18n build`.

- [ ] **Step 2: Write the failing test**

`apps/web/src/test/workspace.tsx`:
```tsx
import type { ChecklistsApi, TemplatesApi } from '@taskop/api-client';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { type ChecklistWorkspace, WorkspaceProvider } from '@/features/checklists/workspace';
import { renderWithProviders } from './render';

const fns = <T extends string>(...names: T[]) => Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<T, ReturnType<typeof vi.fn>>;

export function fakeWorkspace(overrides: Partial<ChecklistWorkspace> = {}): ChecklistWorkspace & {
  checklists: Record<keyof ChecklistsApi, ReturnType<typeof vi.fn>>;
  templates: Record<keyof TemplatesApi, ReturnType<typeof vi.fn>>;
  go: ReturnType<typeof vi.fn>;
} {
  return {
    checklists: fns('list', 'get', 'create', 'update', 'version', 'draft', 'startDraft', 'saveDraft', 'discardDraft', 'publish', 'deactivate', 'reactivate', 'saveAsTemplate'),
    templates: fns('list', 'get', 'create', 'update', 'saveContent', 'deactivate', 'reactivate'),
    can: { manage: true, publish: true, templates: true },
    base: '',
    scope: 'test',
    timeZone: 'Asia/Baku',
    go: vi.fn(),
    ...overrides,
  } as never;
}

export function renderInWorkspace(ui: ReactElement, ws = fakeWorkspace()) {
  return { ws, ...renderWithProviders(<WorkspaceProvider value={ws}>{ui}</WorkspaceProvider>) };
}
```

`apps/web/src/features/checklists/checklists-page.test.tsx`:
```tsx
import type { ChecklistSummary } from '@taskop/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeWorkspace, renderInWorkspace } from '@/test/workspace';
import { ChecklistsPage } from './checklists-page';

const row = (over: Partial<ChecklistSummary> = {}): ChecklistSummary => ({
  id: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e01',
  name: 'Gündəlik təmizlik',
  description: null,
  category: 'cleaning',
  status: 'active',
  currentVersionNumber: 2,
  draftRevision: 3,
  updatedAt: '2026-10-08T08:00:00.000Z',
  ...over,
});

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));

describe('ChecklistsPage', () => {
  it('lists checklists with version and draft badges and filters by search', async () => {
    const ws = fakeWorkspace();
    ws.checklists.list.mockResolvedValue({ items: [row(), row({ id: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e02', name: 'Anbar', currentVersionNumber: null })], nextCursor: null });
    renderInWorkspace(<ChecklistsPage />, ws);
    expect(await screen.findByText('Gündəlik təmizlik')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.getByText('Dərc edilməyib')).toBeInTheDocument();
    expect(screen.getAllByText('Qaralama')).toHaveLength(2);
    await userEvent.type(screen.getByRole('searchbox'), 'anb');
    await waitFor(() => expect(ws.checklists.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'anb', status: 'active' })));
  });

  it('creates a blank checklist and opens its draft', async () => {
    const ws = fakeWorkspace();
    ws.checklists.list.mockResolvedValue({ items: [], nextCursor: null });
    ws.checklists.create.mockResolvedValue({ ...row(), id: 'new-id', versions: [], currentVersionId: null, source: null });
    renderInWorkspace(<ChecklistsPage />, ws);
    await userEvent.click(await screen.findByRole('button', { name: 'Yeni yoxlama vərəqəsi' }));
    await userEvent.type(screen.getByLabelText('Ad'), 'Mətbəx yoxlaması');
    await userEvent.selectOptions(screen.getByLabelText('Kateqoriya'), 'restaurant');
    await userEvent.click(screen.getByRole('button', { name: 'Yarat' }));
    await waitFor(() => expect(ws.checklists.create).toHaveBeenCalledWith({ name: 'Mətbəx yoxlaması', category: 'restaurant' }));
    expect(ws.go).toHaveBeenCalledWith('/checklists/new-id/draft');
  });

  it('creates from a template with the template name prefilled', async () => {
    const ws = fakeWorkspace();
    ws.checklists.list.mockResolvedValue({ items: [], nextCursor: null });
    ws.templates.list.mockResolvedValue([
      { id: 't1', source: 'global', name: 'Restoran mətbəxi', description: null, category: 'restaurant', status: 'active', itemCount: 11, updatedAt: '2026-10-08T08:00:00.000Z' },
    ]);
    ws.checklists.create.mockResolvedValue({ ...row(), id: 'c9', versions: [], currentVersionId: null, source: null });
    renderInWorkspace(<ChecklistsPage />, ws);
    await userEvent.click(await screen.findByRole('button', { name: 'Yeni yoxlama vərəqəsi' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Şablondan' }));
    await userEvent.click(await screen.findByRole('radio', { name: /Restoran mətbəxi/ }));
    expect(screen.getByLabelText('Ad')).toHaveValue('Restoran mətbəxi');
    await userEvent.click(screen.getByRole('button', { name: 'Yarat' }));
    await waitFor(() => expect(ws.checklists.create).toHaveBeenCalledWith({ name: 'Restoran mətbəxi', category: 'restaurant', from: { kind: 'global', templateId: 't1' } }));
  });

  it('hides the create button without checklists.manage', async () => {
    const ws = fakeWorkspace({ can: { manage: false, publish: false, templates: false } });
    ws.checklists.list.mockResolvedValue({ items: [], nextCursor: null });
    renderInWorkspace(<ChecklistsPage />, ws);
    expect(await screen.findByText('Hələ yoxlama vərəqəsi yoxdur.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Yeni yoxlama vərəqəsi' })).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @taskop/web test -- checklists-page`
Expected: FAIL, because the modules don't exist.

- [ ] **Step 4: Workspace, queries, labels**

`apps/web/src/features/checklists/workspace.tsx`:
```tsx
import type { ChecklistsApi, TemplatesApi } from '@taskop/api-client';
import { useNavigate } from '@tanstack/react-router';
import { createContext, type MouseEvent, type ReactNode, useContext, useMemo } from 'react';
import { platformApi } from '@/features/platform/platform-session';
import { api, useCan, useMe } from '@/lib/session';

export interface ChecklistWorkspace {
  checklists: ChecklistsApi;
  templates: TemplatesApi;
  can: { manage: boolean; publish: boolean; templates: boolean };
  /** Route prefix: '' for tenant users, `/platform/tenants/<id>` for platform admins. */
  base: string;
  /** Query-key scope so tenant and platform caches never mix. */
  scope: string;
  timeZone: string;
  /** Navigate to a path relative to `base`. */
  go: (to: string) => void;
}

const WorkspaceContext = createContext<ChecklistWorkspace | null>(null);

export function useWorkspace(): ChecklistWorkspace {
  const ws = useContext(WorkspaceContext);
  if (!ws) throw new Error('useWorkspace() used outside a checklist workspace');
  return ws;
}

export function WorkspaceProvider({ value, children }: { value: ChecklistWorkspace; children: ReactNode }) {
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function TenantWorkspace({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const me = useMe();
  const manage = useCan('checklists.manage');
  const publish = useCan('checklists.publish');
  const templates = useCan('templates.manage');
  const value = useMemo<ChecklistWorkspace>(
    () => ({
      checklists: api.checklists,
      templates: api.templates,
      can: { manage, publish, templates },
      base: '',
      scope: 'tenant',
      timeZone: me.tenant.timezone,
      go: (to) => void navigate({ to: to as '/' }),
    }),
    [manage, publish, templates, me.tenant.timezone, navigate],
  );
  return <WorkspaceProvider value={value}>{children}</WorkspaceProvider>;
}

export function PlatformTenantWorkspace({ tenantId, children }: { tenantId: string; children: ReactNode }) {
  const navigate = useNavigate();
  const value = useMemo<ChecklistWorkspace>(() => {
    const base = `/platform/tenants/${tenantId}`;
    return {
      ...platformApi.inTenant(tenantId),
      can: { manage: true, publish: true, templates: true },
      base,
      scope: `platform:${tenantId}`,
      timeZone: 'Asia/Baku',
      go: (to) => void navigate({ to: `${base}${to}` as '/' }),
    };
  }, [tenantId, navigate]);
  return <WorkspaceProvider value={value}>{children}</WorkspaceProvider>;
}

/** An <a> that navigates inside the current workspace (keeps cmd/ctrl-click working). */
export function WsLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  const ws = useWorkspace();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    ws.go(to);
  };
  return (
    <a href={`${ws.base}${to}`} onClick={onClick} className={className ?? 'font-medium hover:underline'}>
      {children}
    </a>
  );
}
```

`apps/web/src/features/checklists/queries.ts`:
```ts
import type { ChecklistListQuery, TemplateListQuery } from '@taskop/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useWorkspace } from './workspace';

export function useChecklistPages(filters: Omit<ChecklistListQuery, 'cursor' | 'limit'>) {
  const ws = useWorkspace();
  return useInfiniteQuery({
    queryKey: [ws.scope, 'checklists', 'list', filters],
    queryFn: ({ pageParam }) => ws.checklists.list({ ...filters, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useChecklist(id: string) {
  const ws = useWorkspace();
  return useQuery({ queryKey: [ws.scope, 'checklists', id], queryFn: () => ws.checklists.get(id) });
}

export function useTemplates(query: TemplateListQuery, enabled = true) {
  const ws = useWorkspace();
  return useQuery({ queryKey: [ws.scope, 'templates', query], queryFn: () => ws.templates.list(query), enabled });
}
```

`apps/web/src/features/checklists/labels.ts`:
```ts
import type { ChoiceOption, Item, TemplateCategory } from '@taskop/contracts';
import type { TFunction } from 'i18next';

export function optionLabel(t: TFunction, _item: Item, option: ChoiceOption | { id: string; key: string }, index: number): string {
  if ('key' in option) return t(`checklists.builder.fixedOptions.${option.key}`);
  return option.label.trim() || t('checklists.builder.item.option', { n: index + 1 });
}

export const categoryLabel = (t: TFunction, category: TemplateCategory | null): string =>
  category ? t(`checklists.categories.${category}`) : t('checklists.noCategory');
```

- [ ] **Step 5: Template picker, new-checklist dialog, list page**

`apps/web/src/features/checklists/template-picker.tsx`:
```tsx
import { TEMPLATE_CATEGORIES, type TemplateCategory, type TemplateSummary } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { cn } from '@/lib/utils';
import { categoryLabel } from './labels';
import { useTemplates } from './queries';

export function TemplatePicker({ value, onPick }: { value: TemplateSummary | null; onPick: (t: TemplateSummary) => void }) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<TemplateCategory | ''>('');
  const templates = useTemplates({ status: 'active', category: category || undefined });
  return (
    <div className="grid gap-2">
      <NativeSelect aria-label={t('checklists.filters.category')} value={category} onChange={(e) => setCategory(e.target.value as TemplateCategory | '')}>
        <option value="">{t('checklists.filters.allCategories')}</option>
        {TEMPLATE_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {t(`checklists.categories.${c}`)}
          </option>
        ))}
      </NativeSelect>
      <div role="radiogroup" aria-label={t('checklists.create.pickTemplate')} className="grid max-h-64 gap-1 overflow-y-auto">
        {(templates.data ?? []).map((tpl) => (
          <button
            key={`${tpl.source}:${tpl.id}`}
            type="button"
            role="radio"
            aria-checked={value?.id === tpl.id}
            onClick={() => onPick(tpl)}
            className={cn('rounded-md border px-3 py-2 text-left text-sm', value?.id === tpl.id && 'border-primary bg-primary/5')}
          >
            <span className="font-medium">{tpl.name}</span>
            <span className="text-muted-foreground block text-xs">
              {tpl.source === 'global' ? t('checklists.templates.taskop') : t('checklists.templates.ours')} · {categoryLabel(t, tpl.category)} ·{' '}
              {t('checklists.templates.items', { count: tpl.itemCount })}
            </span>
          </button>
        ))}
        {templates.data?.length === 0 && <p className="text-muted-foreground text-sm">{t('checklists.templates.empty')}</p>}
      </div>
    </div>
  );
}
```

`apps/web/src/features/checklists/new-checklist-dialog.tsx`:
```tsx
import { TEMPLATE_CATEGORIES, type CreateChecklistInput, type TemplateCategory, type TemplateSummary } from '@taskop/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/form-error';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { errorText } from '@/lib/errors';
import { TemplatePicker } from './template-picker';
import { useWorkspace } from './workspace';

export type NewChecklistMode = 'blank' | 'template' | 'copy';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: NewChecklistMode;
  /** Preselects a checklist to copy (detail page "Copy"). */
  copyFrom?: { id: string; name: string };
  /** Preselects a template (templates page "Use"). */
  template?: TemplateSummary;
}

export function NewChecklistDialog({ open, onOpenChange, initialMode = 'blank', copyFrom, template: initialTemplate }: Props) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [mode, setMode] = useState<NewChecklistMode>(initialMode);
  const [name, setName] = useState(initialTemplate?.name ?? (copyFrom ? t('checklists.create.copySuffix', { name: copyFrom.name }) : ''));
  const [category, setCategory] = useState<TemplateCategory | ''>(initialTemplate?.category ?? '');
  const [template, setTemplate] = useState<TemplateSummary | null>(initialTemplate ?? null);
  const [copyId, setCopyId] = useState(copyFrom?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const published = useQuery({
    queryKey: [ws.scope, 'checklists', 'list', 'published-all'],
    queryFn: async () => (await ws.checklists.list({ limit: 200 })).items.filter((c) => c.currentVersionNumber !== null),
    enabled: open && mode === 'copy',
  });

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError(t('checklists.create.nameRequired'));
    const body: CreateChecklistInput = { name: name.trim() };
    if (category) body.category = category;
    try {
      setBusy(true);
      if (mode === 'template') {
        if (!template) return setError(t('checklists.create.templateRequired'));
        body.from = { kind: template.source, templateId: template.id };
      } else if (mode === 'copy') {
        if (!copyId) return setError(t('checklists.create.pickChecklist'));
        const detail = await ws.checklists.get(copyId);
        if (!detail.currentVersionId) return setError(t('checklists.create.noPublished'));
        body.from = { kind: 'version', versionId: detail.currentVersionId };
      }
      const created = await ws.checklists.create(body);
      onOpenChange(false);
      ws.go(`/checklists/${created.id}/draft`);
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('checklists.create.title')}</DialogTitle>
        </DialogHeader>
        <Tabs value={mode} onValueChange={(v) => setMode(v as NewChecklistMode)}>
          <TabsList>
            <TabsTrigger value="blank">{t('checklists.create.blank')}</TabsTrigger>
            <TabsTrigger value="template">{t('checklists.create.fromTemplate')}</TabsTrigger>
            <TabsTrigger value="copy">{t('checklists.create.copy')}</TabsTrigger>
          </TabsList>
          <TabsContent value="template">
            <TemplatePicker
              value={template}
              onPick={(tpl) => {
                if (!name.trim() || name === template?.name) setName(tpl.name);
                setTemplate(tpl);
                setCategory(tpl.category);
              }}
            />
          </TabsContent>
          <TabsContent value="copy">
            <div className="grid gap-1.5">
              <Label htmlFor="copy-from">{t('checklists.create.pickChecklist')}</Label>
              <NativeSelect
                id="copy-from"
                value={copyId}
                onChange={(e) => {
                  const picked = published.data?.find((c) => c.id === e.target.value);
                  setCopyId(e.target.value);
                  if (picked) setName(t('checklists.create.copySuffix', { name: picked.name }));
                }}
              >
                <option value="">—</option>
                {(published.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
              {published.data?.length === 0 && <p className="text-muted-foreground text-sm">{t('checklists.create.noPublished')}</p>}
            </div>
          </TabsContent>
        </Tabs>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="new-checklist-name">{t('checklists.name')}</Label>
            <Input id="new-checklist-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-checklist-category">{t('checklists.category')}</Label>
            <NativeSelect id="new-checklist-category" value={category} onChange={(e) => setCategory(e.target.value as TemplateCategory | '')}>
              <option value="">{t('checklists.noCategory')}</option>
              {TEMPLATE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`checklists.categories.${c}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {t('common.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

`apps/web/src/features/checklists/checklists-page.tsx`:
```tsx
import { TEMPLATE_CATEGORIES, type ChecklistStatus, type TemplateCategory } from '@taskop/contracts';
import { formatDateTime } from '@taskop/i18n';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { categoryLabel } from './labels';
import { NewChecklistDialog } from './new-checklist-dialog';
import { useChecklistPages } from './queries';
import { useWorkspace, WsLink } from './workspace';

export function ChecklistsPage() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ChecklistStatus | ''>('active');
  const [category, setCategory] = useState<TemplateCategory | ''>('');
  const q = useDeferredValue(search.trim());
  const pages = useChecklistPages({ q: q || undefined, status: status || undefined, category: category || undefined });
  const [creating, setCreating] = useState(false);
  const rows = pages.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div>
      <PageHeader title={t('checklists.title')} actions={ws.can.manage && <Button onClick={() => setCreating(true)}>{t('checklists.new')}</Button>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input type="search" className="max-w-xs" placeholder={t('checklists.filters.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <NativeSelect aria-label={t('checklists.filters.status')} className="w-44" value={status} onChange={(e) => setStatus(e.target.value as ChecklistStatus | '')}>
          <option value="">{t('checklists.filters.allStatuses')}</option>
          <option value="active">{t('checklists.statuses.active')}</option>
          <option value="deactivated">{t('checklists.statuses.deactivated')}</option>
        </NativeSelect>
        <NativeSelect aria-label={t('checklists.filters.category')} className="w-52" value={category} onChange={(e) => setCategory(e.target.value as TemplateCategory | '')}>
          <option value="">{t('checklists.filters.allCategories')}</option>
          {TEMPLATE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`checklists.categories.${c}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('checklists.name')}</TableHead>
            <TableHead>{t('checklists.category')}</TableHead>
            <TableHead>{t('checklists.version')}</TableHead>
            <TableHead>{t('common.status')}</TableHead>
            <TableHead>{t('checklists.updated')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                <WsLink to={`/checklists/${c.id}`}>{c.name}</WsLink>
                {c.description && <div className="text-muted-foreground text-xs">{c.description}</div>}
              </TableCell>
              <TableCell>{categoryLabel(t, c.category)}</TableCell>
              <TableCell className="flex items-center gap-2">
                {c.currentVersionNumber ? t('checklists.versionN', { n: c.currentVersionNumber }) : t('checklists.notPublished')}
                {c.draftRevision !== null && <Badge variant="outline">{t('checklists.draft')}</Badge>}
              </TableCell>
              <TableCell>
                <Badge variant={c.status === 'active' ? 'default' : 'secondary'}>{t(`checklists.statuses.${c.status}`)}</Badge>
              </TableCell>
              <TableCell>{formatDateTime(c.updatedAt, { locale: 'az', timeZone: ws.timeZone })}</TableCell>
            </TableRow>
          ))}
          {pages.isSuccess && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground text-center">
                {t('checklists.empty')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {pages.hasNextPage && (
        <Button variant="outline" className="mt-3" disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
          {t('common.loadMore')}
        </Button>
      )}
      {creating && <NewChecklistDialog open onOpenChange={setCreating} />}
    </div>
  );
}
```

- [ ] **Step 6: Install the drag-and-drop libraries, add routes and nav**

```bash
pnpm --filter @taskop/web add @dnd-kit/core@latest @dnd-kit/sortable@latest @dnd-kit/utilities@latest
```
These are the stable `@dnd-kit/core` 6.x and `@dnd-kit/sortable` 10.x packages. Don't use the pre-1.0 `@dnd-kit/react`. Task W5 uses them.

`apps/web/src/features/checklists/routes.tsx` (the first version; later tasks add adapters):
```tsx
import { Outlet } from '@tanstack/react-router';
import { ChecklistsPage } from './checklists-page';
import { TenantWorkspace } from './workspace';

export function TenantWorkspaceLayout() {
  return (
    <TenantWorkspace>
      <Outlet />
    </TenantWorkspace>
  );
}

export { ChecklistsPage };
```

`apps/web/src/router.tsx`: add
```ts
import { ChecklistsPage, TenantWorkspaceLayout } from '@/features/checklists/routes';
// ...
const checklistsWs = createRoute({ getParentRoute: () => appLayout, id: 'checklists-ws', component: TenantWorkspaceLayout });
const checklistsRoute = createRoute({ getParentRoute: () => checklistsWs, path: '/checklists', component: ChecklistsPage });
```
and change `appLayout.addChildren([...])` to include `checklistsWs.addChildren([checklistsRoute])`.

`apps/web/src/layouts/app-shell.tsx`:
- Widen `NavItem['to']` to `'/' | '/users' | '/roles' | '/sites' | '/teams' | '/audit' | '/settings' | '/checklists' | '/templates'`.
- Import `LayoutTemplate` and `ListChecks` from `lucide-react`.
- Insert after Home:
```ts
  { to: '/checklists', labelKey: 'nav.checklists', icon: ListChecks, permission: 'checklists.view' },
  { to: '/templates', labelKey: 'nav.templates', icon: LayoutTemplate, permission: 'checklists.manage' },
```
Update `apps/web/src/layouts/app-shell.test.tsx` if it asserts the exact list of nav labels. Run it to see.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @taskop/web test && pnpm --filter @taskop/web typecheck`
Expected: PASS. The `/templates` route doesn't exist yet. Navigating there 404s until W8, which is fine.

- [ ] **Step 8: Commit**

```bash
git add packages/i18n/src apps/web
git commit -m "feat(web): add checklist workspace, list page and new-checklist dialog"
```

---

### Task W5: Outline with drag-and-drop and "Move to…"

**Files:**
- Create: `apps/web/src/features/checklists/builder/outline.tsx`, `apps/web/src/features/checklists/builder/move-to-dialog.tsx`
- Test: `apps/web/src/features/checklists/builder/outline.test.tsx`

**Interfaces:**
- Consumes: `BuilderAction`, `NodeRef`, `ContainerRef`, `canMoveTo`, `findItem`, `listContainers` and `containerItems` (W2), plus `IssueIndex` (W3).
- Produces:
  - `Outline` props: `{ content, selected, issues, dispatch, readOnly }`
  - `DragData`, plus the pure function `dropAction(content, active: DragData, over: DragData): BuilderAction | null`
  - `MoveToDialog` props: `{ content, node: NodeRef, onClose, onMove(action) }`

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/checklists/builder/outline.test.tsx`:
```tsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { indexIssues } from './issues';
import { dropAction, Outline } from './outline';
import { treeFixture } from './fixtures';

describe('dropAction', () => {
  it('maps drops to moves and refuses invalid ones', () => {
    const f = treeFixture();
    const s1 = { kind: 'section' as const, sectionId: f.s1.id };
    const s2 = { kind: 'section' as const, sectionId: f.s2.id };
    expect(dropAction(f.content, { kind: 'item', itemId: f.b.id, container: s1, index: 1 }, { kind: 'item', itemId: f.c.id, container: s2, index: 0 })).toEqual({
      type: 'moveItem', itemId: f.b.id, to: s2, index: 0,
    });
    expect(dropAction(f.content, { kind: 'item', itemId: f.b.id, container: s1, index: 1 }, { kind: 'container', container: s2, length: 1 })).toMatchObject({ index: 1 });
    expect(dropAction(f.content, { kind: 'section', sectionId: f.s2.id, index: 1, itemCount: 1 }, { kind: 'section', sectionId: f.s1.id, index: 0, itemCount: 2 })).toEqual({
      type: 'moveSection', sectionId: f.s2.id, index: 0,
    });
    const own = { kind: 'rule' as const, itemId: f.a1.id, ruleId: f.rule1.id };
    expect(dropAction(f.content, { kind: 'item', itemId: f.a.id, container: s1, index: 0 }, { kind: 'container', container: own, length: 1 })).toBeNull();
  });
});

describe('Outline', () => {
  const setup = (readOnly = false) => {
    const f = treeFixture();
    const dispatch = vi.fn();
    renderWithProviders(<Outline content={f.content} selected={{ kind: 'settings' }} issues={indexIssues(f.content, [])} dispatch={dispatch} readOnly={readOnly} />);
    return { f, dispatch };
  };

  it('renders the tree with follow-ups and selects nodes', async () => {
    const { f, dispatch } = setup();
    const tree = screen.getByRole('tree');
    expect(within(tree).getAllByRole('treeitem').map((n) => n.getAttribute('aria-label'))).toEqual(['S1', 'A', 'A1', 'A11', 'B', 'S2', 'C']);
    await userEvent.click(screen.getByRole('button', { name: 'A1' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'select', node: { kind: 'item', id: f.a1.id } });
  });

  it('moves an item with the Move to dialog', async () => {
    const { f, dispatch } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Köçür… — C' }));
    await userEvent.selectOptions(screen.getByLabelText('Hara'), `section:${f.s1.id}`);
    await userEvent.selectOptions(screen.getByLabelText('Mövqe'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Köçür' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'moveItem', itemId: f.c.id, to: { kind: 'section', sectionId: f.s1.id }, index: 0 });
  });

  it('Move to hides invalid targets', async () => {
    const { f } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Köçür… — A' }));
    const values = within(screen.getByLabelText('Hara')).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual([`section:${f.s1.id}`, `section:${f.s2.id}`]);
  });

  it('has no editing controls when read-only', () => {
    setup(true);
    expect(screen.queryByRole('button', { name: /Köçür/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bölmə əlavə et' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @taskop/web test -- outline`
Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: Implement `move-to-dialog.tsx`**

```tsx
import type { ChecklistContent } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import type { BuilderAction } from './reducer';
import { canMoveTo, containerItems, containerKey, findItem, listContainers, type NodeRef } from './tree';

interface Props {
  content: ChecklistContent;
  node: Exclude<NodeRef, { kind: 'settings' }>;
  onClose: () => void;
  onMove: (action: BuilderAction) => void;
}

export function MoveToDialog({ content, node, onClose, onMove }: Props) {
  const { t } = useTranslation();
  const found = node.kind === 'item' ? findItem(content, node.id) : null;
  const targets = node.kind === 'item' ? listContainers(content).filter((c) => canMoveTo(content, node.id, c.ref)) : [];
  const [targetKey, setTargetKey] = useState(found ? containerKey(found.container) : '');
  const currentIndex = node.kind === 'section' ? content.sections.findIndex((s) => s.id === node.id) : (found?.index ?? 0);
  const [position, setPosition] = useState(currentIndex + 1);

  const target = targets.find((c) => c.key === targetKey);
  const slots =
    node.kind === 'section'
      ? content.sections.length
      : (containerItems(content, target?.ref ?? found!.container)?.length ?? 0) + (target && found && target.key === containerKey(found.container) ? 0 : 1);

  const submit = () => {
    if (node.kind === 'section') onMove({ type: 'moveSection', sectionId: node.id, index: position - 1 });
    else if (target) onMove({ type: 'moveItem', itemId: node.id, to: target.ref, index: position - 1 });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('checklists.builder.moveTitle')}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          {node.kind === 'item' && (
            <div className="grid gap-1.5">
              <Label htmlFor="move-target">{t('checklists.builder.target')}</Label>
              <NativeSelect
                id="move-target"
                value={targetKey}
                onChange={(e) => {
                  setTargetKey(e.target.value);
                  setPosition(1);
                }}
              >
                {targets.map((c) => (
                  <option key={c.key} value={c.key}>
                    {'  '.repeat(c.depth)}
                    {c.ownerLabel === null
                      ? t('checklists.builder.sectionTarget', { title: c.sectionTitle || t('checklists.builder.untitledSection') })
                      : t('checklists.builder.followUpsOf', { label: c.ownerLabel || t('checklists.builder.untitledItem'), n: c.ruleNo })}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="move-position">{t('checklists.builder.position')}</Label>
            <NativeSelect id="move-position" value={String(position)} onChange={(e) => setPosition(Number(e.target.value))}>
              {Array.from({ length: Math.max(slots, 1) }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit}>{t('checklists.builder.moveTitle')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Implement `outline.tsx`**

```tsx
import { closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { type ChecklistContent, hasRules, type Item, type Section } from '@taskop/contracts';
import { GripVertical, MoveVertical } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { IssueIndex } from './issues';
import { MoveToDialog } from './move-to-dialog';
import type { BuilderAction } from './reducer';
import { canMoveTo, type ContainerRef, containerKey, type NodeRef } from './tree';

export type DragData =
  | { kind: 'section'; sectionId: string; index: number; itemCount: number }
  | { kind: 'item'; itemId: string; container: ContainerRef; index: number }
  | { kind: 'container'; container: ContainerRef; length: number };

/** Turns a drop (active dragged onto over) into a reducer action, or null when not allowed. */
export function dropAction(content: ChecklistContent, active: DragData, over: DragData): BuilderAction | null {
  if (active.kind === 'section') return over.kind === 'section' ? { type: 'moveSection', sectionId: active.sectionId, index: over.index } : null;
  if (active.kind !== 'item') return null;
  const target =
    over.kind === 'item'
      ? { container: over.container, index: over.index }
      : over.kind === 'container'
        ? { container: over.container, index: over.length }
        : { container: { kind: 'section', sectionId: over.sectionId } as ContainerRef, index: over.itemCount };
  if (!canMoveTo(content, active.itemId, target.container)) return null;
  return { type: 'moveItem', itemId: active.itemId, to: target.container, index: target.index };
}

interface OutlineProps {
  content: ChecklistContent;
  selected: NodeRef;
  issues: IssueIndex;
  dispatch: (a: BuilderAction) => void;
  readOnly: boolean;
}

export function Outline({ content, selected, issues, dispatch, readOnly }: OutlineProps) {
  const { t } = useTranslation();
  const [moving, setMoving] = useState<Exclude<NodeRef, { kind: 'settings' }> | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    const a = e.active.data.current as DragData | undefined;
    const o = e.over?.data.current as DragData | undefined;
    if (!a || !o || e.active.id === e.over?.id) return;
    const action = dropAction(content, a, o);
    if (action) dispatch(action);
  };
  const ctx: NodeCtx = { selected, issues, dispatch, readOnly, onMove: setMoving };

  return (
    <nav aria-label={t('checklists.builder.outline')} className="flex min-h-0 flex-col gap-1 overflow-y-auto rounded-md border p-2 text-sm">
      <button
        type="button"
        className={cn('rounded px-2 py-1 text-left font-medium hover:bg-slate-100', selected.kind === 'settings' && 'bg-slate-100')}
        onClick={() => dispatch({ type: 'select', node: { kind: 'settings' } })}
      >
        {t('checklists.builder.settings')}
      </button>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={content.sections.map((s) => `s:${s.id}`)} strategy={verticalListSortingStrategy}>
          <ul role="tree" className="grid gap-1">
            {content.sections.map((s, index) => (
              <SectionNode key={s.id} section={s} index={index} ctx={ctx} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {!readOnly && (
        <Button variant="ghost" size="sm" className="justify-start" onClick={() => dispatch({ type: 'addSection' })}>
          + {t('checklists.builder.addSection')}
        </Button>
      )}
      {moving && <MoveToDialog content={content} node={moving} onClose={() => setMoving(null)} onMove={dispatch} />}
    </nav>
  );
}

interface NodeCtx {
  selected: NodeRef;
  issues: IssueIndex;
  dispatch: (a: BuilderAction) => void;
  readOnly: boolean;
  onMove: (node: Exclude<NodeRef, { kind: 'settings' }>) => void;
}

function NodeRow(props: {
  label: string;
  selected: boolean;
  issueCount: number;
  onSelect: () => void;
  onMove: () => void;
  handle: ReactNode;
  readOnly: boolean;
  bold?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn('group flex items-center gap-1 rounded px-1', props.selected && 'bg-slate-100')}>
      {!props.readOnly && props.handle}
      <button type="button" className={cn('min-w-0 flex-1 truncate py-1 text-left', props.bold && 'font-medium')} onClick={props.onSelect}>
        {props.label}
      </button>
      {props.issueCount > 0 && (
        <span className="bg-destructive/10 text-destructive rounded px-1 text-xs" aria-hidden>
          {props.issueCount}
        </span>
      )}
      {!props.readOnly && (
        <Button
          variant="ghost"
          size="icon"
          className="size-6 opacity-60 group-hover:opacity-100"
          aria-label={`${t('checklists.builder.moveTo')} — ${props.label}`}
          title={t('checklists.builder.moveTo')}
          onClick={props.onMove}
        >
          <MoveVertical className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

function DragHandle({ attributes, listeners }: Pick<ReturnType<typeof useSortable>, 'attributes' | 'listeners'>) {
  const { t } = useTranslation();
  return (
    <button type="button" className="text-muted-foreground cursor-grab touch-none" aria-label={t('checklists.builder.dragHandle')} {...attributes} {...listeners}>
      <GripVertical className="size-3.5" />
    </button>
  );
}

function SectionNode({ section, index, ctx }: { section: Section; index: number; ctx: NodeCtx }) {
  const { t } = useTranslation();
  const s = useSortable({ id: `s:${section.id}`, data: { kind: 'section', sectionId: section.id, index, itemCount: section.items.length } satisfies DragData, disabled: ctx.readOnly });
  const label = section.title || t('checklists.builder.untitledSection');
  const isSelected = ctx.selected.kind === 'section' && ctx.selected.id === section.id;
  return (
    <li ref={s.setNodeRef} style={{ transform: CSS.Transform.toString(s.transform), transition: s.transition }} role="treeitem" aria-label={label} aria-selected={isSelected} aria-expanded>
      <NodeRow
        label={label}
        bold
        selected={isSelected}
        issueCount={ctx.issues.byNode.get(section.id)?.length ?? 0}
        onSelect={() => ctx.dispatch({ type: 'select', node: { kind: 'section', id: section.id } })}
        onMove={() => ctx.onMove({ kind: 'section', id: section.id })}
        handle={<DragHandle attributes={s.attributes} listeners={s.listeners} />}
        readOnly={ctx.readOnly}
      />
      <ItemList container={{ kind: 'section', sectionId: section.id }} items={section.items} ctx={ctx} />
    </li>
  );
}

function ItemList({ container, items, ctx }: { container: ContainerRef; items: Item[]; ctx: NodeCtx }) {
  const drop = useDroppable({ id: `c:${containerKey(container)}`, data: { kind: 'container', container, length: items.length } satisfies DragData, disabled: ctx.readOnly });
  return (
    <SortableContext items={items.map((i) => `i:${i.id}`)} strategy={verticalListSortingStrategy}>
      <ul role="group" className="ml-3 grid gap-0.5 border-l pl-2">
        {items.map((item, index) => (
          <ItemNode key={item.id} item={item} index={index} container={container} ctx={ctx} />
        ))}
        <li ref={drop.setNodeRef} aria-hidden className={cn('h-1.5 rounded', drop.isOver && 'bg-primary/30')} />
      </ul>
    </SortableContext>
  );
}

function ItemNode({ item, index, container, ctx }: { item: Item; index: number; container: ContainerRef; ctx: NodeCtx }) {
  const { t } = useTranslation();
  const s = useSortable({ id: `i:${item.id}`, data: { kind: 'item', itemId: item.id, container, index } satisfies DragData, disabled: ctx.readOnly });
  const label = item.label || t('checklists.builder.untitledItem');
  const isSelected = ctx.selected.kind === 'item' && ctx.selected.id === item.id;
  return (
    <li ref={s.setNodeRef} style={{ transform: CSS.Transform.toString(s.transform), transition: s.transition }} role="treeitem" aria-label={label} aria-selected={isSelected}>
      <NodeRow
        label={label}
        selected={isSelected}
        issueCount={ctx.issues.byNode.get(item.id)?.length ?? 0}
        onSelect={() => ctx.dispatch({ type: 'select', node: { kind: 'item', id: item.id } })}
        onMove={() => ctx.onMove({ kind: 'item', id: item.id })}
        handle={<DragHandle attributes={s.attributes} listeners={s.listeners} />}
        readOnly={ctx.readOnly}
      />
      {hasRules(item) &&
        item.rules.map((rule, n) =>
          rule.then.followUps.length > 0 ? (
            <div key={rule.id} className="ml-3">
              <span className="text-muted-foreground text-xs">{t('checklists.builder.rules.ruleN', { n: n + 1 })}</span>
              <ItemList container={{ kind: 'rule', itemId: item.id, ruleId: rule.id }} items={rule.then.followUps} ctx={ctx} />
            </div>
          ) : null,
        )}
    </li>
  );
}
```

The test expects `aria-label` order `S1, A, A1, A11, B, S2, C`, which is document order. Follow-up lists render only when non-empty. Empty rule containers are still reachable through "Move to…" and the inspector's add-follow-up button.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @taskop/web test -- outline`
Expected: PASS.

The `Move to hides invalid targets` test moves `A`. Its subtree height is 2 and it contains both rule containers, so only the two sections are valid targets.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/checklists/builder
git commit -m "feat(web): add builder outline with drag-and-drop and move-to dialog"
```

---

### Task W6: Canvas, inspector and rules editor

**Files:**
- Create: `apps/web/src/features/checklists/builder/canvas.tsx`, `inspector.tsx`, `rules-editor.tsx`
- Test: `apps/web/src/features/checklists/builder/inspector.test.tsx`, `apps/web/src/features/checklists/builder/canvas.test.tsx`

**Interfaces:**
- Consumes: the reducer actions (W2), `findItem`, `rootItemId`, `containerDepth` (W2), `IssueIndex` (W3), and `optionLabel` (W4).
- Produces:
  - `Canvas` props: `{ content, selected, issues, dispatch, readOnly }`
  - `AddItemButton` props: `{ onAdd(type: ItemType), disabled?, label? }`
  - `Inspector` props: `{ content, selected, issues, dispatch, readOnly }`
  - `RulesEditor` props: `{ item: RuleItem, depth, dispatch, readOnly }`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/checklists/builder/inspector.test.tsx`:
```tsx
import { blankContent, type ChecklistContent, newItem, newSection, type SingleChoiceItem, type YesNoItem } from '@taskop/contracts';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useReducer } from 'react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { Inspector } from './inspector';
import { indexIssues } from './issues';
import { builderReducer, type BuilderState, initialState } from './reducer';
import { findItem } from './tree';

let last: BuilderState;
function Harness({ content, itemId, readOnly = false }: { content: ChecklistContent; itemId: string; readOnly?: boolean }) {
  const [state, dispatch] = useReducer(builderReducer, { ...initialState(content), selected: { kind: 'item', id: itemId } });
  last = state;
  return <Inspector content={state.content} selected={state.selected} issues={indexIssues(state.content, [])} dispatch={dispatch} readOnly={readOnly} />;
}
const doc = (...items: ChecklistContent['sections'][0]['items']) => ({ ...blankContent(), sections: [{ ...newSection('S'), items }] });

describe('Inspector', () => {
  it('edits common fields', async () => {
    const item = newItem('yes_no');
    renderWithProviders(<Harness content={doc(item)} itemId={item.id} />);
    fireEvent.change(screen.getByLabelText('Sualın mətni'), { target: { value: 'Qapı bağlıdır?' } });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Məcburi' }));
    await userEvent.selectOptions(screen.getByLabelText('Foto'), 'required');
    fireEvent.change(screen.getByLabelText('Çəki (bal)'), { target: { value: '3' } });
    expect(findItem(last.content, item.id)!.item).toMatchObject({ label: 'Qapı bağlıdır?', required: false, weight: 3, evidence: { photo: 'required' } });
  });

  it('removing an option strips it from rules', async () => {
    const item = newItem('single_choice') as SingleChoiceItem;
    item.options = [{ id: crypto.randomUUID(), label: 'Yaxşı' }, { id: crypto.randomUUID(), label: 'Pis' }, { id: crypto.randomUUID(), label: 'Çox pis' }];
    item.rules = [{ id: crypto.randomUUID(), when: { kind: 'options', optionIds: [item.options[1]!.id, item.options[2]!.id] }, then: { problem: 'normal', requireNote: false, requirePhoto: false, requireVideo: false, followUps: [] } }];
    renderWithProviders(<Harness content={doc(item)} itemId={item.id} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Seçimi sil' })[2]!);
    const after = findItem(last.content, item.id)!.item as SingleChoiceItem;
    expect(after.options.map((o) => o.label)).toEqual(['Yaxşı', 'Pis']);
    expect(after.rules[0]!.when).toEqual({ kind: 'options', optionIds: [item.options[1]!.id] });
  });

  it('builds a "Yes → critical problem + photo + follow-up" rule', async () => {
    const item = newItem('yes_no') as YesNoItem;
    renderWithProviders(<Harness content={doc(item)} itemId={item.id} />);
    await userEvent.click(screen.getByRole('button', { name: 'Qayda əlavə et' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Bəli' }));
    await userEvent.selectOptions(screen.getByLabelText('Problem'), 'critical');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Foto tələb et' }));
    await userEvent.click(screen.getByRole('button', { name: '+ Əlavə sual' }));
    await userEvent.click(screen.getByRole('button', { name: 'Şərh' }));
    const rule = (findItem(last.content, item.id)!.item as YesNoItem).rules[0]!;
    expect(rule.when).toEqual({ kind: 'options', optionIds: [item.options[0].id] });
    expect(rule.then).toMatchObject({ problem: 'critical', requirePhoto: true, followUps: [{ type: 'comment' }] });
    expect(last.selected).toEqual({ kind: 'item', id: rule.then.followUps[0]!.id });
  });

  it('switches a number rule between single value and range', async () => {
    const item = newItem('number');
    renderWithProviders(<Harness content={doc(item)} itemId={item.id} />);
    await userEvent.click(screen.getByRole('button', { name: 'Qayda əlavə et' }));
    await userEvent.selectOptions(screen.getByLabelText('Cavab'), 'outside');
    fireEvent.change(screen.getByLabelText('Minimum'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Maksimum'), { target: { value: '8' } });
    expect((findItem(last.content, item.id)!.item as { rules: { when: unknown }[] }).rules[0]!.when).toEqual({ kind: 'range', op: 'outside', min: 2, max: 8 });
  });

  it('disables everything when read-only', () => {
    const item = newItem('yes_no');
    renderWithProviders(<Harness content={doc(item)} itemId={item.id} readOnly />);
    expect(screen.getByLabelText('Sualın mətni')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Qayda əlavə et' })).toBeNull();
  });
});
```

The rule's range inputs are labelled `Minimum`/`Maksimum` (`item.min`/`item.max`). The number item's own limits use the new keys `item.minValue`/`item.maxValue` (`Minimum dəyər`/`Maksimum dəyər`, added in Step 3), so these labels are unique.

`apps/web/src/features/checklists/builder/canvas.test.tsx`:
```tsx
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { Canvas } from './canvas';
import { indexIssues } from './issues';
import { treeFixture } from './fixtures';

describe('Canvas', () => {
  it('shows the section of the selected item and edits labels inline', () => {
    const f = treeFixture();
    const dispatch = vi.fn();
    renderWithProviders(<Canvas content={f.content} selected={{ kind: 'item', id: f.c.id }} issues={indexIssues(f.content, [])} dispatch={dispatch} readOnly={false} />);
    expect(screen.getByLabelText('Bölmənin adı')).toHaveValue('S2');
    fireEvent.change(screen.getByDisplayValue('C'), { target: { value: 'C2' } });
    expect(dispatch).toHaveBeenCalledWith({ type: 'updateItem', itemId: f.c.id, patch: { label: 'C2' } });
  });

  it('adds an item of the chosen type after a card', async () => {
    const f = treeFixture();
    const dispatch = vi.fn();
    renderWithProviders(<Canvas content={f.content} selected={{ kind: 'section', id: f.s1.id }} issues={indexIssues(f.content, [])} dispatch={dispatch} readOnly={false} />);
    await userEvent.click(screen.getAllByRole('button', { name: '+ Bənd əlavə et' })[1]!);
    await userEvent.click(screen.getByRole('button', { name: 'Rəqəm' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'addItem', container: { kind: 'section', sectionId: f.s1.id }, index: 1, itemType: 'number' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @taskop/web test -- inspector canvas`
Expected: FAIL, because the modules don't exist.

- [ ] **Step 3: Add the two i18n keys**

In `packages/i18n/src/az/checklists.ts`, inside `builder.item`, add `minValue: 'Minimum dəyər',` and `maxValue: 'Maksimum dəyər',`. Then run `pnpm --filter @taskop/i18n build`.

- [ ] **Step 4: Implement `canvas.tsx`**

```tsx
import { type ChecklistContent, countItems, hasRules, ITEM_TYPES, type Item, type ItemType } from '@taskop/contracts';
import { Copy, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmButton } from '@/components/confirm-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { IssueIndex } from './issues';
import type { BuilderAction } from './reducer';
import { findItem, type NodeRef, rootItemId } from './tree';

export function AddItemButton({ onAdd, disabled, label }: { onAdd: (type: ItemType) => void; disabled?: boolean; label?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-1">
      <Button type="button" variant="ghost" size="sm" className="justify-start text-xs" disabled={disabled} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        + {label ?? t('checklists.builder.addItem')}
      </Button>
      {open && (
        <div className="flex flex-wrap gap-1 rounded-md border p-2">
          {ITEM_TYPES.map((type) => (
            <Button
              key={type}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setOpen(false);
                onAdd(type);
              }}
            >
              {t(`checklists.itemTypes.${type}`)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  content: ChecklistContent;
  selected: NodeRef;
  issues: IssueIndex;
  dispatch: (a: BuilderAction) => void;
  readOnly: boolean;
}

export function Canvas({ content, selected, issues, dispatch, readOnly }: Props) {
  const { t } = useTranslation();
  const sectionId = selected.kind === 'section' ? selected.id : selected.kind === 'item' ? findItem(content, selected.id)?.sectionId : undefined;
  const section = content.sections.find((s) => s.id === sectionId) ?? content.sections[0];
  if (!section) return <div className="text-muted-foreground rounded-md border p-6">{t('checklists.issues.noSections')}</div>;
  const root = selected.kind === 'item' ? rootItemId(content, selected.id) : null;
  const container = { kind: 'section', sectionId: section.id } as const;
  const sectionIssues = issues.byNode.get(section.id) ?? [];

  return (
    <section aria-label={section.title || t('checklists.builder.untitledSection')} className="min-h-0 overflow-y-auto rounded-md border p-4">
      <div className="grid gap-2">
        <Label htmlFor="section-title">{t('checklists.builder.sectionTitle')}</Label>
        <Input
          id="section-title"
          value={section.title}
          maxLength={200}
          disabled={readOnly}
          aria-invalid={sectionIssues.some((i) => i.field === 'title')}
          onChange={(e) => dispatch({ type: 'updateSection', sectionId: section.id, patch: { title: e.target.value } })}
        />
        <Label htmlFor="section-instructions">{t('checklists.builder.sectionInstructions')}</Label>
        <Textarea
          id="section-instructions"
          value={section.instructions ?? ''}
          maxLength={2000}
          disabled={readOnly}
          onChange={(e) => dispatch({ type: 'updateSection', sectionId: section.id, patch: { instructions: e.target.value || null } })}
        />
        {sectionIssues.map((i) => (
          <p key={i.code} className="text-destructive text-sm">
            {t(i.code)}
          </p>
        ))}
        {!readOnly && (
          <div>
            <ConfirmButton
              size="sm"
              variant="ghost"
              label={t('checklists.builder.deleteSection')}
              title={t('checklists.builder.deleteSection')}
              description={t('checklists.builder.confirmDeleteSection', { count: countItems({ sections: [section] }) })}
              onConfirm={() => dispatch({ type: 'removeSection', sectionId: section.id })}
            />
          </div>
        )}
      </div>
      <ol className="mt-4 grid gap-2">
        {!readOnly && <AddItemButton onAdd={(type) => dispatch({ type: 'addItem', container, index: 0, itemType: type })} />}
        {section.items.map((item, index) => (
          <li key={item.id} className="grid gap-2">
            <ItemCard
              item={item}
              selected={selected.kind === 'item' && selected.id === item.id}
              containsSelection={root === item.id}
              issueCodes={(issues.byNode.get(item.id) ?? []).map((i) => i.code)}
              dispatch={dispatch}
              readOnly={readOnly}
            />
            {!readOnly && <AddItemButton onAdd={(type) => dispatch({ type: 'addItem', container, index: index + 1, itemType: type })} />}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ItemCard(props: { item: Item; selected: boolean; containsSelection: boolean; issueCodes: string[]; dispatch: (a: BuilderAction) => void; readOnly: boolean }) {
  const { t } = useTranslation();
  const { item, dispatch } = props;
  const followUps = hasRules(item) ? item.rules.reduce((n, r) => n + r.then.followUps.length, 0) : 0;
  return (
    <div
      className={cn('grid gap-2 rounded-md border p-3', props.selected && 'ring-primary ring-2', props.containsSelection && !props.selected && 'border-primary')}
      onClick={() => dispatch({ type: 'select', node: { kind: 'item', id: item.id } })}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{t(`checklists.itemTypes.${item.type}`)}</Badge>
        {item.required && <Badge variant="outline">{t('checklists.builder.item.required')}</Badge>}
        {hasRules(item) && item.rules.length > 0 && <Badge variant="outline">{t('checklists.builder.rules.title')}: {item.rules.length}</Badge>}
        {followUps > 0 && <Badge variant="outline">{t('checklists.builder.rules.followUps')}: {followUps}</Badge>}
        {!props.readOnly && (
          <div className="ml-auto flex gap-1">
            <Button variant="ghost" size="icon" className="size-7" aria-label={t('checklists.builder.duplicate')} onClick={(e) => (e.stopPropagation(), dispatch({ type: 'duplicateItem', itemId: item.id }))}>
              <Copy className="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="size-7" aria-label={t('checklists.builder.delete')} onClick={(e) => (e.stopPropagation(), dispatch({ type: 'removeItem', itemId: item.id }))}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        )}
      </div>
      <Input
        value={item.label}
        maxLength={500}
        placeholder={t('checklists.builder.untitledItem')}
        aria-label={t('checklists.builder.item.label')}
        disabled={props.readOnly}
        aria-invalid={props.issueCodes.length > 0}
        onChange={(e) => dispatch({ type: 'updateItem', itemId: item.id, patch: { label: e.target.value } })}
      />
      {props.issueCodes.map((code) => (
        <p key={code} className="text-destructive text-xs">
          {t(code)}
        </p>
      ))}
    </div>
  );
}
```

The canvas test uses `getByDisplayValue('C')` because both the inspector and the canvas could label inputs "Sualın mətni". The canvas test renders only the canvas.

- [ ] **Step 5: Implement `rules-editor.tsx`**

```tsx
import { CONTENT_LIMITS, type Item, NUMBER_OPS, RANGE_OPS, type Rule, type RuleItem } from '@taskop/contracts';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { optionLabel } from '../labels';
import { AddItemButton } from './canvas';
import type { BuilderAction } from './reducer';

const num = (v: string): number => (v === '' || Number.isNaN(Number(v)) ? 0 : Number(v));

function CheckField({ id, label, checked, disabled, onChange }: { id: string; label: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(c) => onChange(c === true)} />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  );
}

export function RulesEditor({ item, depth, dispatch, readOnly }: { item: RuleItem; depth: number; dispatch: (a: BuilderAction) => void; readOnly: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3">
      <h3 className="text-sm font-semibold">{t('checklists.builder.rules.title')}</h3>
      {item.rules.map((rule, n) => (
        <RuleCard key={rule.id} item={item} rule={rule} n={n} depth={depth} dispatch={dispatch} readOnly={readOnly} />
      ))}
      {!readOnly && (
        <Button variant="outline" size="sm" onClick={() => dispatch({ type: 'addRule', itemId: item.id })}>
          {t('checklists.builder.rules.add')}
        </Button>
      )}
    </div>
  );
}

function RuleCard({ item, rule, n, depth, dispatch, readOnly }: { item: RuleItem; rule: Rule; n: number; depth: number; dispatch: (a: BuilderAction) => void; readOnly: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const update = (patch: { when?: Rule['when']; then?: Partial<Omit<Rule['then'], 'followUps'>> }) => dispatch({ type: 'updateRule', itemId: item.id, ruleId: rule.id, patch });
  const w = rule.when;
  const canNest = depth + 1 <= CONTENT_LIMITS.followUpDepth;

  return (
    <fieldset className="grid gap-2 rounded-md border p-3">
      <legend className="px-1 text-xs font-medium">{t('checklists.builder.rules.ruleN', { n: n + 1 })}</legend>

      {item.type === 'number' ? (
        <div className="grid gap-2">
          <Label htmlFor={`${id}-op`}>{t('checklists.builder.rules.whenNumber')}</Label>
          <NativeSelect
            id={`${id}-op`}
            disabled={readOnly}
            value={w.kind === 'options' ? 'lt' : w.op}
            onChange={(e) => {
              const op = e.target.value;
              if ((RANGE_OPS as readonly string[]).includes(op)) {
                const base = w.kind === 'number' ? w.value : w.kind === 'range' ? w.min : 0;
                update({ when: { kind: 'range', op: op as (typeof RANGE_OPS)[number], min: w.kind === 'range' ? w.min : base, max: w.kind === 'range' ? w.max : base } });
              } else {
                update({ when: { kind: 'number', op: op as (typeof NUMBER_OPS)[number], value: w.kind === 'number' ? w.value : w.kind === 'range' ? w.min : 0 } });
              }
            }}
          >
            {[...NUMBER_OPS, ...RANGE_OPS].map((op) => (
              <option key={op} value={op}>
                {t(`checklists.builder.rules.ops.${op}`)}
              </option>
            ))}
          </NativeSelect>
          {w.kind === 'number' && (
            <>
              <Label htmlFor={`${id}-v`}>{t('checklists.builder.rules.value')}</Label>
              <Input id={`${id}-v`} type="number" disabled={readOnly} value={w.value} onChange={(e) => update({ when: { ...w, value: num(e.target.value) } })} />
            </>
          )}
          {w.kind === 'range' && (
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label htmlFor={`${id}-min`}>{t('checklists.builder.item.min')}</Label>
                <Input id={`${id}-min`} type="number" disabled={readOnly} value={w.min} onChange={(e) => update({ when: { ...w, min: num(e.target.value) } })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${id}-max`}>{t('checklists.builder.item.max')}</Label>
                <Input id={`${id}-max`} type="number" disabled={readOnly} value={w.max} onChange={(e) => update({ when: { ...w, max: num(e.target.value) } })} />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-1">
          <span className="text-sm">{t('checklists.builder.rules.whenOptions')}</span>
          {item.options.map((o, i) => {
            const selected = w.kind === 'options' && w.optionIds.includes(o.id);
            return (
              <CheckField
                key={o.id}
                id={`${id}-o-${o.id}`}
                label={optionLabel(t, item, o, i)}
                checked={selected}
                disabled={readOnly}
                onChange={(on) => {
                  const current = w.kind === 'options' ? w.optionIds : [];
                  update({ when: { kind: 'options', optionIds: on ? [...current, o.id] : current.filter((x) => x !== o.id) } });
                }}
              />
            );
          })}
        </div>
      )}

      <Label htmlFor={`${id}-problem`}>{t('checklists.builder.rules.problem')}</Label>
      <NativeSelect
        id={`${id}-problem`}
        disabled={readOnly}
        value={rule.then.problem ?? 'none'}
        onChange={(e) => update({ then: { problem: e.target.value === 'none' ? null : (e.target.value as 'normal' | 'critical') } })}
      >
        <option value="none">{t('checklists.builder.rules.problemNone')}</option>
        <option value="normal">{t('checklists.builder.rules.problemNormal')}</option>
        <option value="critical">{t('checklists.builder.rules.problemCritical')}</option>
      </NativeSelect>
      <CheckField id={`${id}-note`} label={t('checklists.builder.rules.requireNote')} checked={rule.then.requireNote} disabled={readOnly} onChange={(v) => update({ then: { requireNote: v } })} />
      <CheckField id={`${id}-photo`} label={t('checklists.builder.rules.requirePhoto')} checked={rule.then.requirePhoto} disabled={readOnly} onChange={(v) => update({ then: { requirePhoto: v } })} />
      <CheckField id={`${id}-video`} label={t('checklists.builder.rules.requireVideo')} checked={rule.then.requireVideo} disabled={readOnly} onChange={(v) => update({ then: { requireVideo: v } })} />

      <span className="text-sm font-medium">{t('checklists.builder.rules.followUps')}</span>
      <ul className="grid gap-1">
        {rule.then.followUps.map((f: Item) => (
          <li key={f.id}>
            <Button variant="link" size="sm" className="h-auto p-0" onClick={() => dispatch({ type: 'select', node: { kind: 'item', id: f.id } })}>
              {f.label || t('checklists.builder.untitledItem')}
            </Button>
          </li>
        ))}
      </ul>
      {!readOnly &&
        (canNest ? (
          <AddItemButton
            label={t('checklists.builder.addFollowUp')}
            onAdd={(type) => dispatch({ type: 'addItem', container: { kind: 'rule', itemId: item.id, ruleId: rule.id }, itemType: type })}
          />
        ) : (
          <p className="text-muted-foreground text-xs">{t('checklists.builder.rules.depthLimit')}</p>
        ))}
      {!readOnly && (
        <Button variant="ghost" size="sm" onClick={() => dispatch({ type: 'removeRule', itemId: item.id, ruleId: rule.id })}>
          {t('checklists.builder.rules.remove')}
        </Button>
      )}
    </fieldset>
  );
}
```

- [ ] **Step 6: Implement `inspector.tsx`**

```tsx
import { type ChecklistContent, DATETIME_MODES, EVIDENCE_LEVELS, hasRules, type Item } from '@taskop/contracts';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { IssueIndex } from './issues';
import type { BuilderAction } from './reducer';
import { RulesEditor } from './rules-editor';
import { findItem, type NodeRef } from './tree';

interface Props {
  content: ChecklistContent;
  selected: NodeRef;
  issues: IssueIndex;
  dispatch: (a: BuilderAction) => void;
  readOnly: boolean;
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

const intOr = (v: string, fallback: number) => (v === '' || Number.isNaN(Number(v)) ? fallback : Math.trunc(Number(v)));
const numOrNull = (v: string) => (v === '' || Number.isNaN(Number(v)) ? null : Number(v));

export function Inspector({ content, selected, issues, dispatch, readOnly }: Props) {
  const found = selected.kind === 'item' ? findItem(content, selected.id) : null;
  return (
    <aside className="min-h-0 overflow-y-auto rounded-md border p-4">
      {found ? (
        <ItemPanel item={found.item} depth={found.depth} scoring={content.scoring.enabled} issues={issues} dispatch={dispatch} readOnly={readOnly} />
      ) : (
        <SettingsPanel content={content} dispatch={dispatch} readOnly={readOnly} />
      )}
    </aside>
  );
}

function SettingsPanel({ content, dispatch, readOnly }: { content: ChecklistContent; dispatch: (a: BuilderAction) => void; readOnly: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="grid gap-3">
      <h2 className="font-semibold">{t('checklists.builder.settings')}</h2>
      <Field id={`${id}-ins`} label={t('checklists.builder.instructions')}>
        <Textarea
          id={`${id}-ins`}
          rows={6}
          maxLength={5000}
          disabled={readOnly}
          value={content.instructions ?? ''}
          onChange={(e) => dispatch({ type: 'updateSettings', patch: { instructions: e.target.value || null } })}
        />
      </Field>
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${id}-sc`}
          checked={content.scoring.enabled}
          disabled={readOnly}
          onCheckedChange={(c) => dispatch({ type: 'updateSettings', patch: { scoring: { ...content.scoring, enabled: c === true } } })}
        />
        <Label htmlFor={`${id}-sc`} className="font-normal">
          {t('checklists.builder.scoringEnabled')}
        </Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${id}-pr`}
          checked={content.scoring.problemsReduceScore}
          disabled={readOnly || !content.scoring.enabled}
          onCheckedChange={(c) => dispatch({ type: 'updateSettings', patch: { scoring: { ...content.scoring, problemsReduceScore: c === true } } })}
        />
        <Label htmlFor={`${id}-pr`} className="font-normal">
          {t('checklists.builder.problemsReduceScore')}
        </Label>
      </div>
    </div>
  );
}

function ItemPanel({ item, depth, scoring, issues, dispatch, readOnly }: { item: Item; depth: number; scoring: boolean; issues: IssueIndex; dispatch: (a: BuilderAction) => void; readOnly: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const patch = (p: Partial<Item>) => dispatch({ type: 'updateItem', itemId: item.id, patch: p });
  const media = item.type === 'photo' || item.type === 'video';
  return (
    <div className="grid gap-3">
      <h2 className="font-semibold">{t(`checklists.itemTypes.${item.type}`)}</h2>
      <Field id={`${id}-label`} label={t('checklists.builder.item.label')}>
        <Textarea id={`${id}-label`} maxLength={500} disabled={readOnly} value={item.label} onChange={(e) => patch({ label: e.target.value })} />
      </Field>
      <Field id={`${id}-help`} label={t('checklists.builder.item.helpText')}>
        <Textarea id={`${id}-help`} maxLength={2000} disabled={readOnly} value={item.helpText ?? ''} onChange={(e) => patch({ helpText: e.target.value || null })} />
      </Field>
      <div className="flex items-center gap-2">
        <Checkbox id={`${id}-req`} checked={item.required} disabled={readOnly} onCheckedChange={(c) => patch({ required: c === true })} />
        <Label htmlFor={`${id}-req`} className="font-normal">
          {t('checklists.builder.item.required')}
        </Label>
      </div>
      {scoring && hasRules(item) && (
        <Field id={`${id}-w`} label={t('checklists.builder.item.weight')}>
          <Input id={`${id}-w`} type="number" min={0} max={100} disabled={readOnly} value={item.weight} onChange={(e) => patch({ weight: Math.min(100, Math.max(0, intOr(e.target.value, 0))) })} />
        </Field>
      )}
      {!media && (
        <div className="grid grid-cols-2 gap-2">
          {(['photo', 'video'] as const).map((kind) => (
            <Field key={kind} id={`${id}-${kind}`} label={t(`checklists.builder.item.${kind}`)}>
              <NativeSelect
                id={`${id}-${kind}`}
                disabled={readOnly}
                value={item.evidence[kind]}
                onChange={(e) => patch({ evidence: { ...item.evidence, [kind]: e.target.value } as Item['evidence'] })}
              >
                {EVIDENCE_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {t(`checklists.builder.evidence.${l}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Checkbox id={`${id}-live`} checked={item.evidence.liveOnly} disabled={readOnly} onCheckedChange={(c) => patch({ evidence: { ...item.evidence, liveOnly: c === true } })} />
        <Label htmlFor={`${id}-live`} className="font-normal">
          {t('checklists.builder.item.liveOnly')}
        </Label>
      </div>
      <TypeFields item={item} patch={patch} readOnly={readOnly} />
      {(issues.byNode.get(item.id) ?? []).map((i) => (
        <p key={`${i.field}:${i.code}`} className="text-destructive text-sm">
          {t(i.code)}
        </p>
      ))}
      {hasRules(item) && <RulesEditor item={item} depth={depth} dispatch={dispatch} readOnly={readOnly} />}
    </div>
  );
}

function TypeFields({ item, patch, readOnly }: { item: Item; patch: (p: Partial<Item>) => void; readOnly: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  switch (item.type) {
    case 'single_choice':
    case 'multi_choice': {
      const setOptions = (options: typeof item.options) => {
        const keep = new Set(options.map((o) => o.id));
        // Rules must never point at a removed option.
        const rules = item.rules.map((r) => (r.when.kind === 'options' ? { ...r, when: { kind: 'options' as const, optionIds: r.when.optionIds.filter((x) => keep.has(x)) } } : r));
        patch({ options, rules });
      };
      const move = (i: number, d: -1 | 1) => {
        const next = [...item.options];
        const [o] = next.splice(i, 1);
        next.splice(i + d, 0, o!);
        setOptions(next);
      };
      return (
        <div className="grid gap-2">
          <span className="text-sm font-medium">{t('checklists.builder.item.options')}</span>
          {item.options.map((o, i) => (
            <div key={o.id} className="flex items-center gap-1">
              <Input
                aria-label={t('checklists.builder.item.option', { n: i + 1 })}
                maxLength={200}
                disabled={readOnly}
                value={o.label}
                onChange={(e) => setOptions(item.options.map((x) => (x.id === o.id ? { ...x, label: e.target.value } : x)))}
              />
              {!readOnly && (
                <>
                  <Button variant="ghost" size="icon" className="size-7" aria-label={t('checklists.builder.item.moveUp')} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7" aria-label={t('checklists.builder.item.moveDown')} disabled={i === item.options.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7" aria-label={t('checklists.builder.item.removeOption')} onClick={() => setOptions(item.options.filter((x) => x.id !== o.id))}>
                    <X className="size-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
          {!readOnly && item.options.length < 50 && (
            <Button variant="outline" size="sm" onClick={() => setOptions([...item.options, { id: crypto.randomUUID(), label: '' }])}>
              {t('checklists.builder.item.addOption')}
            </Button>
          )}
        </div>
      );
    }
    case 'number':
      return (
        <div className="grid grid-cols-2 gap-2">
          <Field id={`${id}-unit`} label={t('checklists.builder.item.unit')}>
            <Input id={`${id}-unit`} maxLength={20} disabled={readOnly} value={item.unit ?? ''} onChange={(e) => patch({ unit: e.target.value || null })} />
          </Field>
          <Field id={`${id}-dec`} label={t('checklists.builder.item.decimals')}>
            <Input id={`${id}-dec`} type="number" min={0} max={4} disabled={readOnly} value={item.decimals} onChange={(e) => patch({ decimals: Math.min(4, Math.max(0, intOr(e.target.value, 0))) })} />
          </Field>
          <Field id={`${id}-min`} label={t('checklists.builder.item.minValue')}>
            <Input id={`${id}-min`} type="number" disabled={readOnly} value={item.min ?? ''} onChange={(e) => patch({ min: numOrNull(e.target.value) })} />
          </Field>
          <Field id={`${id}-max`} label={t('checklists.builder.item.maxValue')}>
            <Input id={`${id}-max`} type="number" disabled={readOnly} value={item.max ?? ''} onChange={(e) => patch({ max: numOrNull(e.target.value) })} />
          </Field>
        </div>
      );
    case 'text':
    case 'comment':
      return (
        <Field id={`${id}-len`} label={t('checklists.builder.item.maxLength')}>
          <Input
            id={`${id}-len`}
            type="number"
            min={1}
            max={item.type === 'text' ? 500 : 5000}
            disabled={readOnly}
            value={item.maxLength}
            onChange={(e) => patch({ maxLength: Math.min(item.type === 'text' ? 500 : 5000, Math.max(1, intOr(e.target.value, 1))) })}
          />
        </Field>
      );
    case 'photo':
    case 'video': {
      const cap = item.type === 'photo' ? 20 : 5;
      return (
        <div className="grid grid-cols-2 gap-2">
          <Field id={`${id}-minc`} label={t('checklists.builder.item.minCount')}>
            <Input id={`${id}-minc`} type="number" min={0} max={cap} disabled={readOnly} value={item.minCount} onChange={(e) => patch({ minCount: Math.min(cap, Math.max(0, intOr(e.target.value, 0))) })} />
          </Field>
          <Field id={`${id}-maxc`} label={t('checklists.builder.item.maxCount')}>
            <Input id={`${id}-maxc`} type="number" min={1} max={cap} disabled={readOnly} value={item.maxCount} onChange={(e) => patch({ maxCount: Math.min(cap, Math.max(1, intOr(e.target.value, 1))) })} />
          </Field>
        </div>
      );
    }
    case 'datetime':
      return (
        <Field id={`${id}-mode`} label={t('checklists.builder.item.mode')}>
          <NativeSelect id={`${id}-mode`} disabled={readOnly} value={item.mode} onChange={(e) => patch({ mode: e.target.value as (typeof DATETIME_MODES)[number] })}>
            {DATETIME_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`checklists.builder.item.modes.${m}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      );
    default:
      return null;
  }
}
```

The inspector test expects the `Foto` select. It exists for non-media items (`yes_no` here). The `Çəki (bal)` field shows because scoring is enabled by default and `yes_no` is rule-capable.

Deviation from spec §7.2 (noted): inspector fields are controlled inputs that dispatch reducer actions on every change, not react-hook-form. Each keystroke becomes a coalesced reducer edit, so a form library adds nothing.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @taskop/web test -- inspector canvas`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/i18n/src apps/web/src/features/checklists/builder
git commit -m "feat(web): add builder canvas, inspector and rules editor"
```

---

### Task W7: Builder assembly, preview and the draft/version pages

**Files:**
- Create: `apps/web/src/features/checklists/builder/builder.tsx`, `apps/web/src/features/checklists/builder/preview.tsx`, `apps/web/src/features/checklists/editor-pages.tsx`
- Modify: `apps/web/src/features/checklists/routes.tsx`, `apps/web/src/router.tsx`
- Test: `apps/web/src/features/checklists/builder/builder.test.tsx`, `apps/web/src/features/checklists/builder/preview.test.tsx`

**Interfaces:**
- Consumes: Tasks W2–W6, and `useWorkspace` (W4).
- Produces:
  - `Builder` props: `{ title; badge?; actions?; initialContent; initialRevision; readOnly; save?; onPublish?; onReload?; onBack }`
  - `PreviewPane` props: `{ content }`
  - Pages: `ChecklistDraftPage({ checklistId })`, `ChecklistVersionPage({ checklistId, versionId })`
  - Route adapters: `ChecklistDraftRoute`, `ChecklistVersionRoute`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/checklists/builder/builder.test.tsx`:
```tsx
import { blankContent, type ChecklistContent, newItem, newSection } from '@taskop/contracts';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { Builder } from './builder';

function validContent(): ChecklistContent {
  const item = newItem('text');
  item.label = 'Ad';
  return { ...blankContent(), sections: [{ ...newSection('Bölmə'), items: [item] }] };
}

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.useRealTimers());

describe('Builder', () => {
  it('publish flushes before publishing', async () => {
    const save = vi.fn(async (_c: ChecklistContent, revision: number) => ({ revision: revision + 1, issues: [] }));
    const onPublish = vi.fn(async () => undefined);
    renderWithProviders(<Builder title="X" initialContent={validContent()} initialRevision={4} readOnly={false} save={save} onPublish={onPublish} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Bölmənin adı'), { target: { value: 'Yeni ad' } });
    await userEvent.click(screen.getByRole('button', { name: 'Dərc et' }));
    await userEvent.type(screen.getByLabelText('Dəyişiklik qeydi (istəyə bağlı)'), 'Ad dəyişdi');
    await userEvent.click(screen.getAllByRole('button', { name: 'Dərc et' }).at(-1)!);
    await waitFor(() => expect(onPublish).toHaveBeenCalledWith(5, 'Ad dəyişdi'));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].sections[0]!.title).toBe('Yeni ad');
  });

  it('blocks publishing while there are issues and lists them', async () => {
    renderWithProviders(<Builder title="X" initialContent={blankContent()} initialRevision={1} readOnly={false} save={vi.fn()} onPublish={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Dərc et' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '2 xəta' }));
    expect(screen.getByText('Bölmənin adını yazın.')).toBeInTheDocument();
  });

  it('read-only and no-publish modes', () => {
    const save = vi.fn();
    const { unmount } = renderWithProviders(<Builder title="X" initialContent={validContent()} initialRevision={1} readOnly save={save} onPublish={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByLabelText('Bölmənin adı')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Dərc et' })).toBeNull();
    expect(screen.getByText('Yalnız baxış')).toBeInTheDocument();
    unmount();
    renderWithProviders(<Builder title="X" initialContent={validContent()} initialRevision={1} readOnly={false} save={save} onBack={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Dərc et' })).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it('undoes with the button and keyboard', async () => {
    renderWithProviders(<Builder title="X" initialContent={validContent()} initialRevision={1} readOnly={false} save={vi.fn(async () => ({ revision: 2, issues: [] }))} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Bölmənin adı'), { target: { value: 'Z' } });
    await userEvent.click(screen.getByRole('button', { name: 'Geri al' }));
    expect(screen.getByLabelText('Bölmənin adı')).toHaveValue('Bölmə');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(screen.getByLabelText('Bölmənin adı')).toHaveValue('Z');
  });

  it('shows the conflict banner and reload action', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { ApiError } = await import('@taskop/api-client');
    const save = vi.fn().mockRejectedValue(new ApiError(409, 'CHECKLIST_DRAFT_CONFLICT', 'x'));
    const onReload = vi.fn();
    vi.stubGlobal('confirm', () => true);
    renderWithProviders(<Builder title="X" initialContent={validContent()} initialRevision={1} readOnly={false} save={save} onReload={onReload} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Bölmənin adı'), { target: { value: 'Z' } });
    await act(() => vi.advanceTimersByTimeAsync(1600));
    expect(screen.getByRole('alert')).toHaveTextContent('Bu qaralama başqa yerdə dəyişdirilib.');
    await userEvent.click(screen.getByRole('button', { name: 'Yenidən yüklə' }));
    expect(onReload).toHaveBeenCalled();
  });
});
```

`apps/web/src/features/checklists/builder/preview.test.tsx`:
```tsx
import { blankContent, newItem, newRule, newSection, type YesNoItem } from '@taskop/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { PreviewPane } from './preview';

describe('PreviewPane', () => {
  it('reveals follow-ups and updates requirements and score', async () => {
    const q = newItem('yes_no') as YesNoItem;
    q.label = 'Problem var?';
    const rule = newRule(q);
    rule.when = { kind: 'options', optionIds: [q.options[0].id] };
    rule.then.problem = 'critical';
    rule.then.requirePhoto = true;
    const follow = newItem('comment');
    follow.label = 'Təsvir edin';
    rule.then.followUps.push(follow);
    q.rules.push(rule);
    renderWithProviders(<PreviewPane content={{ ...blankContent(), sections: [{ ...newSection('S'), items: [q] }] }} />);
    expect(screen.getByRole('status')).toHaveTextContent('1 tələb tamamlanmayıb');
    expect(screen.queryByText('Təsvir edin')).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Bəli' }));
    expect(screen.getByText('Təsvir edin')).toBeInTheDocument();
    expect(screen.getByText('Kritik problem')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('2 tələb tamamlanmayıb');
    expect(screen.getByRole('status')).toHaveTextContent('Bal: 0%');
    await userEvent.click(screen.getByRole('radio', { name: 'Xeyr' }));
    expect(screen.getByRole('status')).toHaveTextContent('Tamamlana bilər');
    expect(screen.getByRole('status')).toHaveTextContent('Bal: 100%');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @taskop/web test -- builder.test preview`
Expected: FAIL, because the modules don't exist.

- [ ] **Step 3: Implement `preview.tsx`**

```tsx
import { type Answer, type Answers, type ChecklistContent, computeScore, hasRules, type Item, requirements, ruleMatches, visibleItems } from '@taskop/contracts';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { optionLabel } from '../labels';

export function PreviewPane({ content }: { content: ChecklistContent }) {
  const { t } = useTranslation();
  const [answers, setAnswers] = useState<Answers>({});
  const visible = visibleItems(content, answers);
  const missing = requirements(content, answers);
  const score = computeScore(content, answers);
  const set = (id: string, patch: Partial<Answer>) => setAnswers((a) => ({ ...a, [id]: { ...a[id], ...patch } }));

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-sm flex-col overflow-y-auto rounded-[2rem] border-8 border-slate-800 p-4" aria-label={t('checklists.builder.preview.title')}>
      <p role="status" className="bg-muted mb-3 rounded p-2 text-sm">
        {missing.length ? t('checklists.builder.preview.missing', { count: missing.length }) : t('checklists.builder.preview.complete')} ·{' '}
        {score.percent === null ? t('checklists.builder.preview.noScore') : t('checklists.builder.preview.score', { percent: score.percent })}
      </p>
      {content.instructions && <p className="text-muted-foreground mb-3 text-sm whitespace-pre-line">{content.instructions}</p>}
      {content.sections.map((s) => (
        <section key={s.id} className="mb-4 grid gap-3">
          <h3 className="font-semibold">{s.title}</h3>
          {s.instructions && <p className="text-muted-foreground text-xs whitespace-pre-line">{s.instructions}</p>}
          {visible
            .filter((v) => v.sectionId === s.id)
            .map((v) => (
              <PreviewItem
                key={v.item.id}
                item={v.item}
                depth={v.depth}
                answer={answers[v.item.id]}
                onChange={(p) => set(v.item.id, p)}
                missingKinds={missing.filter((m) => m.itemId === v.item.id).map((m) => m.kind)}
                problem={score.problems.find((p) => p.itemId === v.item.id)?.severity ?? null}
              />
            ))}
        </section>
      ))}
    </div>
  );
}

function PreviewItem(props: {
  item: Item;
  depth: number;
  answer: Answer | undefined;
  onChange: (p: Partial<Answer>) => void;
  missingKinds: string[];
  problem: 'normal' | 'critical' | null;
}) {
  const { t } = useTranslation();
  const id = useId();
  const { item, answer, onChange } = props;
  const needs = (kind: string) => props.missingKinds.includes(kind);
  const rulesHit = hasRules(item) ? item.rules.filter((r) => ruleMatches(r, item, answer)) : [];
  const evidenceAsked = item.evidence.photo !== 'none' || rulesHit.some((r) => r.then.requirePhoto);
  const noteAsked = rulesHit.some((r) => r.then.requireNote);

  return (
    <div className="grid gap-1.5 rounded-md border p-2" style={{ marginLeft: props.depth * 12 }}>
      <label htmlFor={`${id}-in`} className="text-sm font-medium">
        {item.label}
        {item.required && <span className="text-destructive"> *</span>}
      </label>
      {item.helpText && <p className="text-muted-foreground text-xs">{item.helpText}</p>}
      {'options' in item && (
        <div role={item.type === 'multi_choice' ? 'group' : 'radiogroup'} className="flex flex-wrap gap-3">
          {item.options.map((o, i) => {
            const checked = answer?.optionIds?.includes(o.id) ?? false;
            const multi = item.type === 'multi_choice';
            return (
              <label key={o.id} className="flex items-center gap-1 text-sm">
                <input
                  type={multi ? 'checkbox' : 'radio'}
                  name={id}
                  checked={checked}
                  onChange={() =>
                    onChange({ optionIds: multi ? (checked ? answer!.optionIds!.filter((x) => x !== o.id) : [...(answer?.optionIds ?? []), o.id]) : [o.id] })
                  }
                />
                {optionLabel(t, item, o, i)}
              </label>
            );
          })}
        </div>
      )}
      {item.type === 'number' && (
        <Input id={`${id}-in`} type="number" value={answer?.number ?? ''} onChange={(e) => onChange({ number: e.target.value === '' ? undefined : Number(e.target.value) })} />
      )}
      {item.type === 'text' && <Input id={`${id}-in`} maxLength={item.maxLength} value={answer?.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} />}
      {item.type === 'comment' && <Textarea id={`${id}-in`} maxLength={item.maxLength} value={answer?.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} />}
      {item.type === 'datetime' && (
        <Input
          id={`${id}-in`}
          type={item.mode === 'datetime' ? 'datetime-local' : item.mode}
          value={answer?.datetime ?? ''}
          onChange={(e) => onChange({ datetime: e.target.value })}
        />
      )}
      {(item.type === 'photo' || evidenceAsked) && (
        <Button type="button" size="sm" variant="outline" onClick={() => onChange({ photos: [...(answer?.photos ?? []), `p${(answer?.photos?.length ?? 0) + 1}`] })}>
          {t('checklists.builder.preview.addPhoto')} ({t('checklists.builder.preview.media', { count: answer?.photos?.length ?? 0 })})
        </Button>
      )}
      {(item.type === 'video' || item.evidence.video !== 'none' || rulesHit.some((r) => r.then.requireVideo)) && (
        <Button type="button" size="sm" variant="outline" onClick={() => onChange({ videos: [...(answer?.videos ?? []), `v${(answer?.videos?.length ?? 0) + 1}`] })}>
          {t('checklists.builder.preview.addVideo')} ({t('checklists.builder.preview.media', { count: answer?.videos?.length ?? 0 })})
        </Button>
      )}
      {noteAsked && <Textarea aria-label={t('checklists.builder.preview.note')} value={answer?.note ?? ''} onChange={(e) => onChange({ note: e.target.value })} />}
      {props.problem && (
        <p className="text-destructive text-xs font-medium">{props.problem === 'critical' ? t('checklists.builder.preview.critical') : t('checklists.builder.preview.problem')}</p>
      )}
      {['answer', 'photo', 'video', 'note', 'mediaCount'].filter(needs).map((k) => (
        <p key={k} className="text-destructive text-xs">
          {t(`checklists.builder.preview.missingKinds.${k}`)}
        </p>
      ))}
    </div>
  );
}
```

In the preview test, the `yes_no` item's weight is 1 with one problem rule. Answering "Bəli" (critical) gives earned 0 / possible 1 → `Bal: 0%`. The missing count goes from 1 (answer) to 2 (photo + follow-up answer). Answering "Xeyr" hides the follow-up and gives 100%.

- [ ] **Step 4: Implement `builder.tsx`**

```tsx
import { type ChecklistContent, type ContentSaveResult, validateForPublish } from '@taskop/contracts';
import { ArrowLeft, Redo2, Undo2 } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useReducer, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Canvas } from './canvas';
import { Inspector } from './inspector';
import { indexIssues } from './issues';
import { Outline } from './outline';
import { PreviewPane } from './preview';
import { builderReducer, initialState } from './reducer';
import { useAutosave } from './use-autosave';

export interface BuilderProps {
  title: string;
  badge?: ReactNode;
  /** Extra header actions (e.g. publish/unpublish for global templates). */
  actions?: ReactNode;
  initialContent: ChecklistContent;
  initialRevision: number;
  readOnly: boolean;
  save?: (content: ChecklistContent, revision: number) => Promise<ContentSaveResult>;
  /** Present only when the user may publish (checklist drafts). */
  onPublish?: (revision: number, changeNote: string | null) => Promise<void>;
  onReload?: () => void;
  onBack: () => void;
}

export function Builder(props: BuilderProps) {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(builderReducer, props.initialContent, initialState);
  const autosave = useAutosave({
    content: state.content,
    version: state.version,
    initialRevision: props.initialRevision,
    save: props.readOnly ? undefined : props.save,
  });
  const issues = useMemo(() => validateForPublish(state.content), [state.content]);
  const index = useMemo(() => indexIssues(state.content, issues), [state.content, issues]);
  const [preview, setPreview] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const readOnly = props.readOnly || autosave.status === 'conflict';

  useEffect(() => {
    if (props.readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.readOnly]);

  const saveLabel = {
    saved: t('checklists.builder.save.saved'),
    dirty: t('checklists.builder.save.dirty'),
    saving: t('checklists.builder.save.saving'),
    error: t('checklists.builder.save.error'),
    conflict: t('checklists.builder.save.conflict'),
  }[autosave.status];

  return (
    <div className="flex h-[calc(100vh-7.5rem)] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <Button variant="ghost" size="sm" onClick={props.onBack}>
          <ArrowLeft className="size-4" /> {t('common.back')}
        </Button>
        <h1 className="text-xl font-semibold">{props.title}</h1>
        {props.badge}
        {props.readOnly && <Badge variant="secondary">{t('checklists.builder.readOnly')}</Badge>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!props.readOnly && (
            <span className="text-muted-foreground text-sm" aria-live="polite">
              {saveLabel}
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant={issues.length ? 'destructive' : 'outline'} size="sm">
                {issues.length ? t('checklists.builder.issues', { count: issues.length }) : t('checklists.builder.noIssues')}
              </Button>
            </DropdownMenuTrigger>
            {issues.length > 0 && (
              <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
                {index.list.map((issue, i) => (
                  <DropdownMenuItem
                    key={i}
                    onSelect={() => {
                      setPreview(false);
                      if (issue.node) dispatch({ type: 'select', node: { kind: issue.node.kind, id: issue.node.id } });
                    }}
                  >
                    {t(issue.code)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            )}
          </DropdownMenu>
          {!props.readOnly && (
            <>
              <Button variant="ghost" size="icon" aria-label={t('checklists.builder.undo')} disabled={!state.past.length || readOnly} onClick={() => dispatch({ type: 'undo' })}>
                <Undo2 className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" aria-label={t('checklists.builder.redo')} disabled={!state.future.length || readOnly} onClick={() => dispatch({ type: 'redo' })}>
                <Redo2 className="size-4" />
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={() => setPreview((p) => !p)}>
            {preview ? t('checklists.builder.closePreview') : t('checklists.builder.preview')}
          </Button>
          {props.actions}
          {props.onPublish && !props.readOnly && (
            <Button size="sm" disabled={issues.length > 0 || autosave.status === 'conflict'} onClick={() => setPublishing(true)}>
              {t('checklists.builder.publish')}
            </Button>
          )}
        </div>
      </div>

      {autosave.status === 'conflict' && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center gap-3">
            {t('checklists.builder.save.conflict')}
            <Button size="sm" variant="outline" onClick={() => window.confirm(t('checklists.builder.save.confirmReload')) && props.onReload?.()}>
              {t('checklists.builder.save.reload')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {preview ? (
        <PreviewPane content={state.content} />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[16rem_minmax(0,1fr)_22rem] gap-3">
          <Outline content={state.content} selected={state.selected} issues={index} dispatch={dispatch} readOnly={readOnly} />
          <Canvas content={state.content} selected={state.selected} issues={index} dispatch={dispatch} readOnly={readOnly} />
          <Inspector content={state.content} selected={state.selected} issues={index} dispatch={dispatch} readOnly={readOnly} />
        </div>
      )}

      {publishing && props.onPublish && (
        <PublishDialog
          onClose={() => setPublishing(false)}
          onSubmit={async (note) => {
            if (!(await autosave.flush())) return;
            await props.onPublish!(autosave.revision(), note);
            setPublishing(false);
          }}
        />
      )}
    </div>
  );
}

function PublishDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (note: string | null) => Promise<void> }) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('checklists.builder.publishTitle')}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="change-note">{t('checklists.builder.changeNote')}</Label>
          <Textarea id="change-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSubmit(note.trim() || null);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('checklists.builder.publish')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Check that `@/components/ui/alert` exports `Alert` and `AlertDescription`, and supports `variant="destructive"` (standard shadcn). If the variant is missing, drop the prop.

Regarding the `blocks publishing…` test: a blank content has two issues (`titleRequired`, `noItems`). Opening a Radix dropdown in jsdom works with `userEvent.click` in this repo's setup. If it doesn't, replace the `DropdownMenu` with a simple toggle list, using the same pattern as `AddItemButton`, and keep the test as is.

- [ ] **Step 5: Implement the draft and version pages, then the routes**

`apps/web/src/features/checklists/editor-pages.tsx`:
```tsx
import { ApiError } from '@taskop/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { errorText } from '@/lib/errors';
import { Builder } from './builder/builder';
import { useChecklist } from './queries';
import { useWorkspace } from './workspace';

function Loading() {
  const { t } = useTranslation();
  return <p className="text-muted-foreground">{t('common.loading')}</p>;
}

export function ChecklistDraftPage({ checklistId }: { checklistId: string }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const qc = useQueryClient();
  const detail = useChecklist(checklistId);
  const draft = useQuery({ queryKey: [ws.scope, 'checklists', checklistId, 'draft'], queryFn: () => ws.checklists.draft(checklistId), retry: false });
  const [reloadKey, setReloadKey] = useState(0);
  const [starting, setStarting] = useState(false);

  if (detail.isPending || draft.isPending) return <Loading />;
  if (detail.error) return <p className="text-destructive">{errorText(t, detail.error)}</p>;
  const c = detail.data;
  if (draft.error instanceof ApiError && draft.error.code === 'CHECKLIST_NO_DRAFT') {
    const canStart = ws.can.manage && c.status === 'active';
    return (
      <div className="grid max-w-md gap-3">
        <p>{t('checklists.builder.noDraft')}</p>
        {canStart && (
          <Button
            disabled={starting}
            onClick={async () => {
              setStarting(true);
              try {
                await ws.checklists.startDraft(checklistId);
                await draft.refetch();
              } catch (e) {
                toast.error(errorText(t, e));
              } finally {
                setStarting(false);
              }
            }}
          >
            {t('checklists.builder.startDraft')}
          </Button>
        )}
      </div>
    );
  }
  if (draft.error) return <p className="text-destructive">{errorText(t, draft.error)}</p>;

  return (
    <Builder
      key={`${draft.data.id}:${reloadKey}`}
      title={c.name}
      badge={<Badge variant="outline">{t('checklists.draft')}</Badge>}
      initialContent={draft.data.content}
      initialRevision={draft.data.revision}
      readOnly={!ws.can.manage || c.status !== 'active'}
      save={(content, revision) => ws.checklists.saveDraft(checklistId, { content, revision })}
      onPublish={
        ws.can.publish
          ? async (revision, changeNote) => {
              try {
                const v = await ws.checklists.publish(checklistId, { revision, changeNote });
                toast.success(t('checklists.builder.published', { n: v.number }));
                ws.go(`/checklists/${checklistId}`);
                await qc.invalidateQueries({ queryKey: [ws.scope, 'checklists'] });
              } catch (e) {
                toast.error(errorText(t, e));
              }
            }
          : undefined
      }
      onReload={async () => {
        await draft.refetch();
        setReloadKey((k) => k + 1);
      }}
      onBack={() => ws.go(`/checklists/${checklistId}`)}
    />
  );
}

export function ChecklistVersionPage({ checklistId, versionId }: { checklistId: string; versionId: string }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const detail = useChecklist(checklistId);
  const version = useQuery({ queryKey: [ws.scope, 'checklists', checklistId, 'versions', versionId], queryFn: () => ws.checklists.version(checklistId, versionId) });
  if (detail.isPending || version.isPending) return <Loading />;
  if (detail.error || version.error) return <p className="text-destructive">{errorText(t, detail.error ?? version.error)}</p>;
  return (
    <Builder
      title={detail.data.name}
      badge={<Badge variant="outline">{version.data.number ? t('checklists.versionN', { n: version.data.number }) : t('checklists.draft')}</Badge>}
      initialContent={version.data.content}
      initialRevision={version.data.revision}
      readOnly
      onBack={() => ws.go(`/checklists/${checklistId}`)}
    />
  );
}
```

Add the route adapters to `routes.tsx`:
```tsx
import { useParams } from '@tanstack/react-router';
import { ChecklistDraftPage, ChecklistVersionPage } from './editor-pages';

type Params = { checklistId?: string; versionId?: string; source?: string; templateId?: string; tenantId?: string };
const useIds = () => useParams({ strict: false }) as Params;

export function ChecklistDraftRoute() {
  return <ChecklistDraftPage checklistId={useIds().checklistId!} />;
}
export function ChecklistVersionRoute() {
  const p = useIds();
  return <ChecklistVersionPage checklistId={p.checklistId!} versionId={p.versionId!} />;
}
```

`router.tsx`: under `checklistsWs`, add
```ts
const checklistDraftRoute = createRoute({ getParentRoute: () => checklistsWs, path: '/checklists/$checklistId/draft', component: ChecklistDraftRoute });
const checklistVersionRoute = createRoute({ getParentRoute: () => checklistsWs, path: '/checklists/$checklistId/versions/$versionId', component: ChecklistVersionRoute });
```
and include both in `checklistsWs.addChildren([...])`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @taskop/web test && pnpm --filter @taskop/web typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): assemble the checklist builder with autosave, publish and preview"
```

---

### Task W8: Checklist detail page, template gallery and template editor

**Files:**
- Create: `apps/web/src/features/checklists/checklist-detail-page.tsx`, `apps/web/src/features/checklists/checklist-dialogs.tsx`, `apps/web/src/features/checklists/templates-page.tsx`
- Modify: `apps/web/src/features/checklists/editor-pages.tsx` (add `TemplateEditorPage`), `apps/web/src/features/checklists/routes.tsx`, `apps/web/src/router.tsx`
- Test: `apps/web/src/features/checklists/checklist-detail-page.test.tsx`, `apps/web/src/features/checklists/templates-page.test.tsx`

**Interfaces:**
- Consumes: the workspace (W4), `NewChecklistDialog` (W4) and `Builder` (W7).
- Produces:
  - Pages: `ChecklistDetailPage({ checklistId })`, `TemplatesPage()`, `TemplateEditorPage({ source, templateId })`
  - Dialogs: `EditDetailsDialog`, `SaveAsTemplateDialog`
  - Route adapters: `ChecklistDetailRoute`, `TemplateEditorRoute`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/checklists/checklist-detail-page.test.tsx`:
```tsx
import type { ChecklistDetail } from '@taskop/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeWorkspace, renderInWorkspace } from '@/test/workspace';
import { ChecklistDetailPage } from './checklist-detail-page';

const ID = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e01';
const V1 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e11';
const V2 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e12';
const detail = (over: Partial<ChecklistDetail> = {}): ChecklistDetail => ({
  id: ID,
  name: 'Gündəlik təmizlik',
  description: null,
  category: 'cleaning',
  status: 'active',
  currentVersionNumber: 2,
  draftRevision: null,
  updatedAt: '2026-10-08T08:00:00.000Z',
  currentVersionId: V2,
  source: { kind: 'global', id: ID },
  versions: [
    { id: V2, number: 2, state: 'published', changeNote: 'Sual əlavə edildi', publishedAt: '2026-10-08T08:00:00.000Z', publishedBy: { kind: 'user', name: 'Elvin' }, createdAt: '2026-10-08T07:00:00.000Z' },
    { id: V1, number: 1, state: 'published', changeNote: null, publishedAt: '2026-10-07T08:00:00.000Z', publishedBy: { kind: 'platform', name: null }, createdAt: '2026-10-07T07:00:00.000Z' },
  ],
  ...over,
});

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));

describe('ChecklistDetailPage', () => {
  it('shows version history with publisher and source', async () => {
    const ws = fakeWorkspace();
    ws.checklists.get.mockResolvedValue(detail());
    renderInWorkspace(<ChecklistDetailPage checklistId={ID} />, ws);
    const rows = await screen.findAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText('v2')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Elvin')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Taskop')).toBeInTheDocument();
    expect(screen.getByText('Taskop şablonundan yaradılıb')).toBeInTheDocument();
  });

  it('starts a draft from the current version when editing', async () => {
    const ws = fakeWorkspace();
    ws.checklists.get.mockResolvedValue(detail());
    ws.checklists.startDraft.mockResolvedValue({});
    renderInWorkspace(<ChecklistDetailPage checklistId={ID} />, ws);
    await userEvent.click(await screen.findByRole('button', { name: 'Redaktə et' }));
    await waitFor(() => expect(ws.checklists.startDraft).toHaveBeenCalledWith(ID));
    expect(ws.go).toHaveBeenCalledWith(`/checklists/${ID}/draft`);
  });

  it('restores an old version and saves a version as a template', async () => {
    const ws = fakeWorkspace();
    ws.checklists.get.mockResolvedValue(detail());
    ws.checklists.startDraft.mockResolvedValue({});
    ws.checklists.saveAsTemplate.mockResolvedValue({});
    renderInWorkspace(<ChecklistDetailPage checklistId={ID} />, ws);
    const rows = await screen.findAllByRole('row');
    await userEvent.click(within(rows[2]!).getByRole('button', { name: 'Qaralama kimi bərpa et' }));
    await waitFor(() => expect(ws.checklists.startDraft).toHaveBeenCalledWith(ID, { fromVersionId: V1 }));
    await userEvent.click(within(rows[1]!).getByRole('button', { name: 'Şablon kimi saxla' }));
    await userEvent.selectOptions(screen.getByLabelText('Kateqoriya'), 'safety');
    await userEvent.click(screen.getByRole('button', { name: 'Yadda saxla' }));
    await waitFor(() => expect(ws.checklists.saveAsTemplate).toHaveBeenCalledWith(ID, V2, { name: 'Gündəlik təmizlik', category: 'safety', description: null }));
  });

  it('is read-only when deactivated and offers reactivate', async () => {
    const ws = fakeWorkspace();
    ws.checklists.get.mockResolvedValue(detail({ status: 'deactivated' }));
    renderInWorkspace(<ChecklistDetailPage checklistId={ID} />, ws);
    expect(await screen.findByText('Bu yoxlama vərəqəsi deaktivdir və dəyişdirilə bilməz.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Redaktə et' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Aktiv et' })).toBeInTheDocument();
  });
});
```

`apps/web/src/features/checklists/templates-page.test.tsx`:
```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeWorkspace, renderInWorkspace } from '@/test/workspace';
import { TemplatesPage } from './templates-page';

const tpl = (id: string, source: 'global' | 'tenant', name: string, status: 'active' | 'deactivated' = 'active') => ({
  id, source, name, description: null, category: 'restaurant' as const, status, itemCount: 11, updatedAt: '2026-10-08T08:00:00.000Z',
});

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));

describe('TemplatesPage', () => {
  it('uses a Taskop template to create a checklist', async () => {
    const ws = fakeWorkspace();
    ws.templates.list.mockImplementation(async (q: { source?: string }) => (q.source === 'global' ? [tpl('g1', 'global', 'Restoran mətbəxi')] : []));
    ws.checklists.create.mockResolvedValue({ id: 'c1' });
    renderInWorkspace(<TemplatesPage />, ws);
    await userEvent.click(await screen.findByRole('button', { name: 'İstifadə et' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yarat' }));
    await waitFor(() => expect(ws.checklists.create).toHaveBeenCalledWith({ name: 'Restoran mətbəxi', category: 'restaurant', from: { kind: 'global', templateId: 'g1' } }));
    expect(ws.go).toHaveBeenCalledWith('/checklists/c1/draft');
  });

  it('manages own templates', async () => {
    const ws = fakeWorkspace();
    ws.templates.list.mockImplementation(async (q: { source?: string }) => (q.source === 'tenant' ? [tpl('t1', 'tenant', 'Bizim', 'deactivated')] : []));
    ws.templates.reactivate.mockResolvedValue({});
    ws.templates.create.mockResolvedValue({ id: 't2' });
    renderInWorkspace(<TemplatesPage />, ws);
    await userEvent.click(screen.getByRole('tab', { name: 'Bizim şablonlar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Aktiv et' }));
    expect(ws.templates.reactivate).toHaveBeenCalledWith('t1');
    await userEvent.click(screen.getByRole('button', { name: 'Yeni şablon' }));
    await userEvent.type(screen.getByLabelText('Ad'), 'Növbə təhvili');
    await userEvent.selectOptions(screen.getByLabelText('Kateqoriya'), 'other');
    await userEvent.click(screen.getByRole('button', { name: 'Yarat' }));
    await waitFor(() => expect(ws.templates.create).toHaveBeenCalledWith({ name: 'Növbə təhvili', category: 'other' }));
    expect(ws.go).toHaveBeenCalledWith('/templates/tenant/t2');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @taskop/web test -- checklist-detail templates-page`
Expected: FAIL, because the modules don't exist.

- [ ] **Step 3: Dialogs**

`apps/web/src/features/checklists/checklist-dialogs.tsx`:
```tsx
import { TEMPLATE_CATEGORIES, type TemplateCategory } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/form-error';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { errorText } from '@/lib/errors';

export interface DetailsValue {
  name: string;
  description: string | null;
  category: TemplateCategory | null;
}

/** Shared name / description / category form for checklists and templates. */
export function DetailsDialog(props: {
  title: string;
  submitLabel: string;
  initial: DetailsValue;
  categoryRequired?: boolean;
  onClose: () => void;
  onSubmit: (v: DetailsValue) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(props.initial.name);
  const [description, setDescription] = useState(props.initial.description ?? '');
  const [category, setCategory] = useState<TemplateCategory | ''>(props.initial.category ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return setError(t('checklists.create.nameRequired'));
    if (props.categoryRequired && !category) return setError(t('errors.validation.required'));
    setBusy(true);
    setError(null);
    try {
      await props.onSubmit({ name: name.trim(), description: description.trim() || null, category: category || null });
      props.onClose();
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="details-name">{t('checklists.name')}</Label>
            <Input id="details-name" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="details-description">{t('checklists.description')}</Label>
            <Textarea id="details-description" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="details-category">{t('checklists.category')}</Label>
            <NativeSelect id="details-category" value={category} onChange={(e) => setCategory(e.target.value as TemplateCategory | '')}>
              <option value="">{props.categoryRequired ? '—' : t('checklists.noCategory')}</option>
              {TEMPLATE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`checklists.categories.${c}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {props.submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

The test calls `saveAsTemplate` with `{ name, category, description: null }`, which is exactly what the `DetailsValue` mapping in the detail page sends.

- [ ] **Step 4: Detail page**

`apps/web/src/features/checklists/checklist-detail-page.tsx`:
```tsx
import type { ChecklistVersionSummary } from '@taskop/contracts';
import { formatDateTime } from '@taskop/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/confirm-button';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errorText } from '@/lib/errors';
import { DetailsDialog } from './checklist-dialogs';
import { categoryLabel } from './labels';
import { NewChecklistDialog } from './new-checklist-dialog';
import { useChecklist } from './queries';
import { useWorkspace, WsLink } from './workspace';

export function ChecklistDetailPage({ checklistId }: { checklistId: string }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const qc = useQueryClient();
  const detail = useChecklist(checklistId);
  const [dialog, setDialog] = useState<null | 'details' | 'copy' | { saveAsTemplate: ChecklistVersionSummary }>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: [ws.scope, 'checklists'] });
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await refresh();
    } catch (e) {
      toast.error(errorText(t, e));
    }
  };

  if (detail.isPending) return <p className="text-muted-foreground">{t('common.loading')}</p>;
  if (detail.error) return <p className="text-destructive">{errorText(t, detail.error)}</p>;
  const c = detail.data;
  const active = c.status === 'active';
  const hasDraft = c.draftRevision !== null;
  const editable = ws.can.manage && active;

  const openEditor = () =>
    act(async () => {
      if (!hasDraft) await ws.checklists.startDraft(checklistId);
      ws.go(`/checklists/${checklistId}/draft`);
    });

  return (
    <div className="grid gap-4">
      <PageHeader
        title={c.name}
        actions={
          <>
            {editable && <Button onClick={() => void openEditor()}>{hasDraft ? t('checklists.detail.continueDraft') : t('checklists.detail.edit')}</Button>}
            {ws.can.manage && c.currentVersionId && (
              <Button variant="outline" onClick={() => setDialog('copy')}>
                {t('checklists.detail.copy')}
              </Button>
            )}
            {editable && (
              <Button variant="outline" onClick={() => setDialog('details')}>
                {t('checklists.detail.editDetails')}
              </Button>
            )}
            {editable && hasDraft && (
              <ConfirmButton
                label={t('checklists.detail.discardDraft')}
                title={t('checklists.detail.discardDraft')}
                description={t('checklists.detail.confirmDiscard')}
                onConfirm={() => act(() => ws.checklists.discardDraft(checklistId))}
              />
            )}
            {ws.can.manage &&
              (active ? (
                <ConfirmButton
                  variant="destructive"
                  label={t('common.deactivate')}
                  title={t('common.deactivate')}
                  description={t('checklists.detail.confirmDeactivate', { name: c.name })}
                  onConfirm={() => act(() => ws.checklists.deactivate(checklistId))}
                />
              ) : (
                <Button variant="outline" onClick={() => void act(() => ws.checklists.reactivate(checklistId))}>
                  {t('common.reactivate')}
                </Button>
              ))}
          </>
        }
      />
      {!active && (
        <Alert>
          <AlertDescription>{t('checklists.detail.deactivatedBanner')}</AlertDescription>
        </Alert>
      )}
      <div className="text-muted-foreground flex flex-wrap gap-3 text-sm">
        <span>{categoryLabel(t, c.category)}</span>
        {c.source && <span>{t(`checklists.detail.source.${c.source.kind}`)}</span>}
        {c.description && <span>{c.description}</span>}
      </div>
      <h2 className="text-lg font-semibold">{t('checklists.detail.versions')}</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('checklists.version')}</TableHead>
            <TableHead>{t('checklists.detail.publishedAt')}</TableHead>
            <TableHead>{t('checklists.detail.publishedBy')}</TableHead>
            <TableHead>{t('checklists.detail.changeNote')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {c.versions.map((v) => (
            <TableRow key={v.id}>
              <TableCell>{v.number ? t('checklists.versionN', { n: v.number }) : <Badge variant="outline">{t('checklists.draft')}</Badge>}</TableCell>
              <TableCell>{v.publishedAt ? formatDateTime(v.publishedAt, { locale: 'az', timeZone: ws.timeZone }) : '—'}</TableCell>
              <TableCell>{v.publishedBy ? (v.publishedBy.kind === 'platform' ? t('checklists.detail.taskop') : v.publishedBy.name) : '—'}</TableCell>
              <TableCell>{v.changeNote ?? '—'}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <WsLink to={v.state === 'draft' ? `/checklists/${c.id}/draft` : `/checklists/${c.id}/versions/${v.id}`} className="px-2 py-1 text-sm hover:underline">
                    {t('checklists.detail.open')}
                  </WsLink>
                  {v.state === 'published' && editable && !hasDraft && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void act(async () => {
                          await ws.checklists.startDraft(checklistId, { fromVersionId: v.id });
                          ws.go(`/checklists/${checklistId}/draft`);
                        })
                      }
                    >
                      {t('checklists.detail.restore')}
                    </Button>
                  )}
                  {v.state === 'published' && ws.can.templates && (
                    <Button size="sm" variant="ghost" onClick={() => setDialog({ saveAsTemplate: v })}>
                      {t('checklists.detail.saveAsTemplate')}
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {dialog === 'details' && (
        <DetailsDialog
          title={t('checklists.detail.editDetails')}
          submitLabel={t('common.save')}
          initial={{ name: c.name, description: c.description, category: c.category }}
          onClose={() => setDialog(null)}
          onSubmit={async (v) => {
            await ws.checklists.update(checklistId, v);
            await refresh();
          }}
        />
      )}
      {dialog === 'copy' && <NewChecklistDialog open initialMode="copy" copyFrom={{ id: c.id, name: c.name }} onOpenChange={(o) => !o && setDialog(null)} />}
      {dialog && typeof dialog === 'object' && (
        <DetailsDialog
          title={t('checklists.saveAsTemplate.title')}
          submitLabel={t('common.save')}
          categoryRequired
          initial={{ name: c.name, description: null, category: null }}
          onClose={() => setDialog(null)}
          onSubmit={async (v) => {
            await ws.checklists.saveAsTemplate(checklistId, dialog.saveAsTemplate.id, { name: v.name, category: v.category!, description: v.description });
            toast.success(t('checklists.saveAsTemplate.done'));
          }}
        />
      )}
    </div>
  );
}
```

In the `restores…` test, `startDraft` is clicked from row 2 (v1). The page has no draft (`draftRevision: null`), so the restore button shows. In the `starts a draft…` test, the expected call `startDraft(ID)` has one argument, which matches `openEditor`.

- [ ] **Step 5: Templates page and template editor**

`apps/web/src/features/checklists/templates-page.tsx`:
```tsx
import { TEMPLATE_CATEGORIES, type TemplateCategory, type TemplateSource, type TemplateSummary } from '@taskop/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { errorText } from '@/lib/errors';
import { DetailsDialog } from './checklist-dialogs';
import { categoryLabel } from './labels';
import { NewChecklistDialog } from './new-checklist-dialog';
import { useTemplates } from './queries';
import { useWorkspace } from './workspace';

export function TemplatesPage() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [source, setSource] = useState<TemplateSource>('global');
  const [category, setCategory] = useState<TemplateCategory | ''>('');
  const templates = useTemplates({ source, category: category || undefined });
  const [using, setUsing] = useState<TemplateSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: [ws.scope, 'templates'] });
    } catch (e) {
      toast.error(errorText(t, e));
    }
  };

  return (
    <div>
      <PageHeader title={t('checklists.templates.title')} actions={ws.can.templates && <Button onClick={() => setCreating(true)}>{t('checklists.templates.new')}</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={source} onValueChange={(v) => setSource(v as TemplateSource)}>
          <TabsList>
            <TabsTrigger value="global">{t('checklists.templates.taskop')}</TabsTrigger>
            <TabsTrigger value="tenant">{t('checklists.templates.ours')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <NativeSelect aria-label={t('checklists.filters.category')} className="w-56" value={category} onChange={(e) => setCategory(e.target.value as TemplateCategory | '')}>
          <option value="">{t('checklists.filters.allCategories')}</option>
          {TEMPLATE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`checklists.categories.${c}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(templates.data ?? []).map((tpl) => (
          <Card key={tpl.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {tpl.name}
                {tpl.status === 'deactivated' && <Badge variant="secondary">{t('checklists.statuses.deactivated')}</Badge>}
              </CardTitle>
              <CardDescription>
                {categoryLabel(t, tpl.category)} · {t('checklists.templates.items', { count: tpl.itemCount })}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {tpl.description && <p className="text-muted-foreground text-sm">{tpl.description}</p>}
              <div className="flex flex-wrap gap-2">
                {ws.can.manage && tpl.status === 'active' && (
                  <Button size="sm" onClick={() => setUsing(tpl)}>
                    {t('checklists.templates.use')}
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => ws.go(`/templates/${tpl.source}/${tpl.id}`)}>
                  {tpl.source === 'tenant' && ws.can.templates && tpl.status === 'active' ? t('checklists.templates.editTemplate') : t('checklists.templates.preview')}
                </Button>
                {tpl.source === 'tenant' &&
                  ws.can.templates &&
                  (tpl.status === 'active' ? (
                    <Button size="sm" variant="ghost" onClick={() => void act(() => ws.templates.deactivate(tpl.id))}>
                      {t('common.deactivate')}
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => void act(() => ws.templates.reactivate(tpl.id))}>
                      {t('common.reactivate')}
                    </Button>
                  ))}
              </div>
            </CardContent>
          </Card>
        ))}
        {templates.data?.length === 0 && <p className="text-muted-foreground">{t('checklists.templates.empty')}</p>}
      </div>
      {using && <NewChecklistDialog open initialMode="template" template={using} onOpenChange={(o) => !o && setUsing(null)} />}
      {creating && (
        <DetailsDialog
          title={t('checklists.templates.new')}
          submitLabel={t('common.create')}
          categoryRequired
          initial={{ name: '', description: null, category: null }}
          onClose={() => setCreating(false)}
          onSubmit={async (v) => {
            const created = await ws.templates.create({ name: v.name, category: v.category!, ...(v.description ? { description: v.description } : {}) });
            ws.go(`/templates/tenant/${created.id}`);
          }}
        />
      )}
    </div>
  );
}
```

The `uses a Taskop template…` test opens `NewChecklistDialog` with `initialMode="template"` and a preselected template, so clicking "Yarat" creates directly. That dialog's tabs render `TemplatePicker`, which calls `ws.templates.list({ status: 'active' })`. The mock returns `[]` for queries without `source`, which is fine.

Append to `editor-pages.tsx`:
```tsx
export function TemplateEditorPage({ source, templateId }: { source: 'global' | 'tenant'; templateId: string }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const tpl = useQuery({ queryKey: [ws.scope, 'templates', source, templateId], queryFn: () => ws.templates.get(source, templateId) });
  const [reloadKey, setReloadKey] = useState(0);
  if (tpl.isPending) return <Loading />;
  if (tpl.error) return <p className="text-destructive">{errorText(t, tpl.error)}</p>;
  const editable = source === 'tenant' && ws.can.templates && tpl.data.status === 'active';
  return (
    <Builder
      key={`${tpl.data.id}:${reloadKey}`}
      title={tpl.data.name}
      badge={<Badge variant="outline">{source === 'global' ? t('checklists.templates.taskop') : t('checklists.templates.template')}</Badge>}
      initialContent={tpl.data.content}
      initialRevision={tpl.data.revision}
      readOnly={!editable}
      save={(content, revision) => ws.templates.saveContent(templateId, { content, revision })}
      onReload={async () => {
        await tpl.refetch();
        setReloadKey((k) => k + 1);
      }}
      onBack={() => ws.go('/templates')}
    />
  );
}
```

`routes.tsx`: add
```tsx
import { ChecklistDetailPage } from './checklist-detail-page';
import { TemplateEditorPage } from './editor-pages';
import { TemplatesPage } from './templates-page';

export function ChecklistDetailRoute() {
  return <ChecklistDetailPage checklistId={useIds().checklistId!} />;
}
export function TemplateEditorRoute() {
  const p = useIds();
  return <TemplateEditorPage source={p.source === 'global' ? 'global' : 'tenant'} templateId={p.templateId!} />;
}
export { TemplatesPage };
```

`router.tsx`: under `checklistsWs`, add
```ts
const checklistDetailRoute = createRoute({ getParentRoute: () => checklistsWs, path: '/checklists/$checklistId', component: ChecklistDetailRoute });
const templatesRoute = createRoute({ getParentRoute: () => checklistsWs, path: '/templates', component: TemplatesPage });
const templateEditorRoute = createRoute({ getParentRoute: () => checklistsWs, path: '/templates/$source/$templateId', component: TemplateEditorRoute });
```
and the final `checklistsWs.addChildren([checklistsRoute, checklistDetailRoute, checklistDraftRoute, checklistVersionRoute, templatesRoute, templateEditorRoute])`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @taskop/web test && pnpm --filter @taskop/web typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): add checklist detail with versions, template gallery and template editor"
```

---

### Task W9: Platform: layout, global templates, building inside a tenant

**Files:**
- Create: `apps/web/src/features/platform/platform-layout.tsx`, `global-templates-page.tsx`, `global-template-editor-page.tsx`, `platform-tenant-workspace.tsx`
- Modify: `apps/web/src/features/platform/platform-tenants-page.tsx`, `apps/web/src/router.tsx`
- Test: `apps/web/src/features/platform/global-templates-page.test.tsx`

**Interfaces:**
- Consumes: `platformApi.globalTemplates` and `platformApi.inTenant` (W1), `PlatformTenantWorkspace` (W4), `Builder` (W7), and the checklist pages and route adapters (W4–W8).
- Produces:
  - Routes: `/platform/templates` and `/platform/templates/$templateId`
  - Routes under `/platform/tenants/$tenantId/…`: `checklists`, `checklists/$checklistId`, `checklists/$checklistId/draft`, `checklists/$checklistId/versions/$versionId`, `templates`, `templates/$source/$templateId`

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/platform/global-templates-page.test.tsx`:
```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '@/components/ui/sonner';
import { renderWithProviders } from '@/test/render';
import { GlobalTemplatesPage } from './global-templates-page';

const mocks = vi.hoisted(() => ({
  globalTemplates: { list: vi.fn(), create: vi.fn(), publish: vi.fn(), unpublish: vi.fn() },
  navigate: vi.fn(),
}));
vi.mock('./platform-session', () => ({ platformApi: { globalTemplates: mocks.globalTemplates } }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));

const row = (published: boolean) => ({ id: 'g1', name: 'Mətbəx', description: null, category: 'restaurant', published, sortOrder: 1, itemCount: 0, updatedAt: '2026-10-08T08:00:00.000Z' });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

describe('GlobalTemplatesPage', () => {
  it('publishes and shows validation errors from the API', async () => {
    const { ApiError } = await import('@taskop/api-client');
    mocks.globalTemplates.list.mockResolvedValue([row(false)]);
    mocks.globalTemplates.publish.mockRejectedValue(new ApiError(422, 'CHECKLIST_INVALID_CONTENT', 'errors.CHECKLIST_INVALID_CONTENT'));
    renderWithProviders(
      <>
        <GlobalTemplatesPage />
        <Toaster />
      </>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Dərc et' }));
    expect(await screen.findByText('Yoxlama vərəqəsində düzəldilməli xətalar var.')).toBeInTheDocument();
  });

  it('creates a template and opens the editor', async () => {
    mocks.globalTemplates.list.mockResolvedValue([]);
    mocks.globalTemplates.create.mockResolvedValue({ id: 'g2' });
    renderWithProviders(
      <>
        <GlobalTemplatesPage />
        <Toaster />
      </>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Yeni şablon' }));
    await userEvent.type(screen.getByLabelText('Ad'), 'Anbar');
    await userEvent.selectOptions(screen.getByLabelText('Kateqoriya'), 'warehouse');
    await userEvent.click(screen.getByRole('button', { name: 'Yarat' }));
    await waitFor(() => expect(mocks.globalTemplates.create).toHaveBeenCalledWith({ name: 'Anbar', category: 'warehouse' }));
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/platform/templates/g2' });
  });
});
```

The toast assertion needs the `<Toaster />` rendered next to the page. The theme hook inside the Sonner wrapper (`next-themes`) works without a provider and falls back to `system`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @taskop/web test -- global-templates-page`
Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: Platform layout and tenants page**

`apps/web/src/features/platform/platform-layout.tsx`:
```tsx
import { Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { platformSession, usePlatformAdmin } from './platform-session';

export function PlatformLayout() {
  const { t } = useTranslation();
  const admin = usePlatformAdmin();
  return (
    <div className="min-h-screen">
      <header className="flex items-center gap-6 bg-slate-900 px-6 py-3 text-white">
        <Logo className="text-white" />
        <nav className="flex gap-4 text-sm">
          <Link to="/platform/tenants" activeProps={{ className: 'font-semibold underline' }}>
            {t('platform.nav.tenants')}
          </Link>
          <Link to={'/platform/templates' as '/platform/tenants'} activeProps={{ className: 'font-semibold underline' }}>
            {t('platform.nav.templates')}
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span>{admin?.fullName}</span>
          <Button size="sm" variant="secondary" onClick={() => void platformSession.signOut()}>
            {t('platform.logout')}
          </Button>
        </div>
      </header>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}
```

In `platform-tenants-page.tsx` `PlatformTenantsPage`:
- Replace the returned wrapper (`<div className="min-h-screen">` with its `<header>…</header>` and `<main …>`) with `<div className="grid gap-4">…</div>`, keeping the `h1`, search input and table.
- Drop the now-unused `Logo` and `Button` imports, if `Button` isn't used elsewhere in the file. It is (reactivate button), so keep `Button`.

In `PlatformTenantsTable`, add a link cell before the actions cell:
```tsx
            <TableCell>
              <Link to={`/platform/tenants/${tn.id}/checklists` as '/platform/tenants'} className="text-sm hover:underline">
                {t('platform.tenants.checklists')}
              </Link>
            </TableCell>
```
Add a matching empty `<TableHead />` and import `Link` from `@tanstack/react-router`. If `platform-tenants-page.test.tsx` renders `PlatformTenantsTable` without a router, `Link` throws. In that case wrap the render in that test with a memory router, or render the link as a plain `<a href=…>`. Prefer the plain `<a href>` to keep the existing test untouched:
```tsx
              <a href={`/platform/tenants/${tn.id}/checklists`} className="text-sm hover:underline">
                {t('platform.tenants.checklists')}
              </a>
```

- [ ] **Step 4: Global templates pages and the tenant workspace route**

`apps/web/src/features/platform/global-templates-page.tsx`:
```tsx
import { formatDateTime } from '@taskop/i18n';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DetailsDialog } from '@/features/checklists/checklist-dialogs';
import { categoryLabel } from '@/features/checklists/labels';
import { errorText } from '@/lib/errors';
import { platformApi } from './platform-session';

export function GlobalTemplatesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const templates = useQuery({ queryKey: ['platform', 'global-templates'], queryFn: () => platformApi.globalTemplates.list() });
  const [creating, setCreating] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['platform', 'global-templates'] });
    } catch (e) {
      toast.error(errorText(t, e));
    }
  };
  const open = (id: string) => void navigate({ to: `/platform/templates/${id}` as '/platform/tenants' });

  return (
    <div>
      <PageHeader title={t('checklists.templates.taskop')} actions={<Button onClick={() => setCreating(true)}>{t('checklists.templates.new')}</Button>} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('checklists.name')}</TableHead>
            <TableHead>{t('checklists.category')}</TableHead>
            <TableHead>{t('checklists.templates.sortOrder')}</TableHead>
            <TableHead>{t('common.status')}</TableHead>
            <TableHead>{t('checklists.updated')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(templates.data ?? []).map((g) => (
            <TableRow key={g.id}>
              <TableCell className="font-medium">
                {g.name}
                <div className="text-muted-foreground text-xs">{t('checklists.templates.items', { count: g.itemCount })}</div>
              </TableCell>
              <TableCell>{categoryLabel(t, g.category)}</TableCell>
              <TableCell>{g.sortOrder}</TableCell>
              <TableCell>
                <Badge variant={g.published ? 'default' : 'secondary'}>{g.published ? t('checklists.templates.published') : t('checklists.templates.unpublished')}</Badge>
              </TableCell>
              <TableCell>{formatDateTime(g.updatedAt, { locale: 'az', timeZone: 'Asia/Baku' })}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => open(g.id)}>
                    {t('checklists.templates.editTemplate')}
                  </Button>
                  {g.published ? (
                    <Button size="sm" variant="outline" onClick={() => void act(() => platformApi.globalTemplates.unpublish(g.id))}>
                      {t('checklists.templates.unpublish')}
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => void act(() => platformApi.globalTemplates.publish(g.id))}>
                      {t('checklists.templates.publish')}
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {creating && (
        <DetailsDialog
          title={t('checklists.templates.new')}
          submitLabel={t('common.create')}
          categoryRequired
          initial={{ name: '', description: null, category: null }}
          onClose={() => setCreating(false)}
          onSubmit={async (v) => {
            const created = await platformApi.globalTemplates.create({ name: v.name, category: v.category!, ...(v.description ? { description: v.description } : {}) });
            open(created.id);
          }}
        />
      )}
    </div>
  );
}
```

`apps/web/src/features/platform/global-template-editor-page.tsx`:
```tsx
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Builder } from '@/features/checklists/builder/builder';
import { errorText } from '@/lib/errors';
import { platformApi } from './platform-session';

export function GlobalTemplateEditorPage() {
  const { t } = useTranslation();
  const { templateId } = useParams({ strict: false }) as { templateId: string };
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tpl = useQuery({ queryKey: ['platform', 'global-templates', templateId], queryFn: () => platformApi.globalTemplates.get(templateId) });
  const [reloadKey, setReloadKey] = useState(0);
  if (tpl.isPending) return <p className="text-muted-foreground">{t('common.loading')}</p>;
  if (tpl.error) return <p className="text-destructive">{errorText(t, tpl.error)}</p>;
  const g = tpl.data;
  const toggle = async () => {
    try {
      await (g.published ? platformApi.globalTemplates.unpublish(g.id) : platformApi.globalTemplates.publish(g.id));
      await qc.invalidateQueries({ queryKey: ['platform', 'global-templates'] });
    } catch (e) {
      toast.error(errorText(t, e));
    }
  };
  return (
    <Builder
      key={`${g.id}:${reloadKey}`}
      title={g.name}
      badge={<Badge variant={g.published ? 'default' : 'secondary'}>{g.published ? t('checklists.templates.published') : t('checklists.templates.unpublished')}</Badge>}
      actions={
        <Button size="sm" variant="outline" onClick={() => void toggle()}>
          {g.published ? t('checklists.templates.unpublish') : t('checklists.templates.publish')}
        </Button>
      }
      initialContent={g.content}
      initialRevision={g.revision}
      readOnly={false}
      save={(content, revision) => platformApi.globalTemplates.saveContent(g.id, { content, revision })}
      onReload={async () => {
        await tpl.refetch();
        setReloadKey((k) => k + 1);
      }}
      onBack={() => void navigate({ to: '/platform/templates' as '/platform/tenants' })}
    />
  );
}
```

The publish toggle doesn't flush autosave first. Spec §6.2 validates the *saved* content on publish, so a 422 just means "save first". The toast explains it, and the next autosave fixes it.

`apps/web/src/features/platform/platform-tenant-workspace.tsx`:
```tsx
import { useQuery } from '@tanstack/react-query';
import { Outlet, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PlatformTenantWorkspace } from '@/features/checklists/workspace';
import { platformApi } from './platform-session';

export function PlatformTenantWorkspaceRoute() {
  const { t } = useTranslation();
  const { tenantId } = useParams({ strict: false }) as { tenantId: string };
  const tenants = useQuery({ queryKey: ['platform', 'tenants', ''], queryFn: async () => (await platformApi.tenants.list({ limit: 200 })).items });
  const name = tenants.data?.find((x) => x.id === tenantId)?.name ?? tenantId;
  return (
    <PlatformTenantWorkspace tenantId={tenantId}>
      <Alert className="mb-4">
        <AlertDescription className="flex items-center gap-3">
          {t('platform.workspaceBanner', { name })}
          <a href="/platform/tenants" className="underline">
            {t('platform.backToTenants')}
          </a>
        </AlertDescription>
      </Alert>
      <Outlet />
    </PlatformTenantWorkspace>
  );
}
```

- [ ] **Step 5: Restructure the platform routes**

In `router.tsx`, replace `platformTenantsRoute` with a layout tree:
```ts
import { PlatformLayout } from '@/features/platform/platform-layout';
import { GlobalTemplatesPage } from '@/features/platform/global-templates-page';
import { GlobalTemplateEditorPage } from '@/features/platform/global-template-editor-page';
import { PlatformTenantWorkspaceRoute } from '@/features/platform/platform-tenant-workspace';

const platformLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'platform',
  component: PlatformLayout,
  beforeLoad: () => {
    if (!platformSession.get()) throw redirect({ to: '/platform/login' });
  },
});
const platformTenantsRoute = createRoute({ getParentRoute: () => platformLayout, path: '/platform/tenants', component: PlatformTenantsPage });
const platformTemplatesRoute = createRoute({ getParentRoute: () => platformLayout, path: '/platform/templates', component: GlobalTemplatesPage });
const platformTemplateRoute = createRoute({ getParentRoute: () => platformLayout, path: '/platform/templates/$templateId', component: GlobalTemplateEditorPage });
const platformTenantWs = createRoute({ getParentRoute: () => platformLayout, path: '/platform/tenants/$tenantId', component: PlatformTenantWorkspaceRoute });
const pt = (path: string, component: () => ReactElement) => createRoute({ getParentRoute: () => platformTenantWs, path, component });
const platformTenantChildren = [
  pt('checklists', ChecklistsPage),
  pt('checklists/$checklistId', ChecklistDetailRoute),
  pt('checklists/$checklistId/draft', ChecklistDraftRoute),
  pt('checklists/$checklistId/versions/$versionId', ChecklistVersionRoute),
  pt('templates', TemplatesPage),
  pt('templates/$source/$templateId', TemplateEditorRoute),
];
```
(`import type { ReactElement } from 'react';`). In `routeTree`, replace `platformTenantsRoute` with:
```ts
  platformLayout.addChildren([platformTenantsRoute, platformTemplatesRoute, platformTemplateRoute, platformTenantWs.addChildren(platformTenantChildren)]),
```
If TanStack's typed `createRoute` rejects the `pt` helper's generic `path: string`, write the six routes out explicitly with literal paths. It's the same code, inlined.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @taskop/web test && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web build`
Expected: PASS. The existing platform tests still pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): add platform global templates and checklist building inside tenants"
```

---

### Task W10: End-to-end test, CI seed, final verification

**Files:**
- Create: `apps/web/e2e/checklists.spec.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the full stack. The API part (Part 1 Tasks 6–11) must be merged.

- [ ] **Step 1: Seed global templates in CI before e2e**

In `.github/workflows/ci.yml`, in the e2e job's "Prepare database and JWT keys" step, add this after the `setup.ts` line:
```yaml
          pnpm exec tsx src/db/scripts/seed.ts
```

- [ ] **Step 2: Write the e2e test**

`apps/web/e2e/checklists.spec.ts`:
```ts
import { expect, test } from '@playwright/test';

test('owner builds a checklist from a template, publishes v1 and v2, and v1 stays unchanged', async ({ page }) => {
  const suffix = Date.now().toString(36);
  await page.goto('/signup');
  await page.getByLabel('Təşkilatın adı').fill('E2E Checklist MMC');
  await page.getByLabel('Təşkilat kodu').fill(`e2e-cl-${suffix}`);
  await page.getByLabel('Ad və soyad').fill('Elvin Əhmədov');
  await page.getByLabel('E-poçt', { exact: true }).fill(`cl-${suffix}@example.az`);
  await page.getByLabel('Şifrə', { exact: true }).fill('e2e owner password');
  await page.getByRole('button', { name: 'Qeydiyyatdan keç' }).click();
  await expect(page.getByRole('heading', { name: 'Xoş gəlmisiniz, Elvin!' })).toBeVisible();

  // Create from a Taskop template.
  await page.getByRole('link', { name: 'Şablonlar' }).click();
  const card = page.locator('[data-slot="card"]', { hasText: 'Gündəlik təmizlik yoxlaması' });
  await card.getByRole('button', { name: 'İstifadə et' }).click();
  await page.getByLabel('Ad', { exact: true }).fill('E2E təmizlik');
  await page.getByRole('button', { name: 'Yarat' }).click();
  await expect(page.getByRole('heading', { name: 'E2E təmizlik' })).toBeVisible();

  // Add a yes/no item with "Yes → critical problem + photo" and a follow-up.
  await page.getByRole('button', { name: '+ Bənd əlavə et' }).first().click();
  await page.getByRole('button', { name: 'Bəli / Xeyr' }).click();
  await page.getByRole('complementary').getByLabel('Sualın mətni').fill('Soyuducu qapısı açıq qalıb?');
  await page.getByRole('button', { name: 'Qayda əlavə et' }).click();
  await page.getByRole('complementary').getByRole('checkbox', { name: 'Bəli' }).click();
  await page.getByRole('complementary').getByLabel('Problem').selectOption('critical');
  await page.getByRole('complementary').getByRole('checkbox', { name: 'Foto tələb et' }).click();
  await page.getByRole('button', { name: '+ Əlavə sual' }).click();
  await page.getByRole('button', { name: 'Şərh', exact: true }).click();
  await page.getByRole('complementary').getByLabel('Sualın mətni').fill('Nə qədər müddət açıq qalıb?');

  // Reorder with "Move to…": move the new item to position 2 of its section.
  await page.getByRole('button', { name: 'Köçür… — Soyuducu qapısı açıq qalıb?' }).click();
  await page.getByLabel('Mövqe').selectOption('2');
  await page.getByRole('dialog').getByRole('button', { name: 'Köçür' }).click();
  await expect(page.getByRole('tree').getByRole('treeitem').nth(2)).toHaveAccessibleName('Soyuducu qapısı açıq qalıb?');

  // Publish v1.
  await expect(page.getByText('Yadda saxlanıldı')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Dərc et' }).click();
  await page.getByLabel('Dəyişiklik qeydi (istəyə bağlı)').fill('İlk versiya');
  await page.getByRole('dialog').getByRole('button', { name: 'Dərc et' }).click();
  await expect(page.getByRole('cell', { name: 'v1' })).toBeVisible();

  // Edit → publish v2.
  await page.getByRole('button', { name: 'Redaktə et' }).click();
  await page.getByLabel('Bölmənin adı').fill('Giriş və dəhliz (yenilənib)');
  await expect(page.getByText('Yadda saxlanıldı')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Dərc et' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Dərc et' }).click();
  await expect(page.getByRole('cell', { name: 'v2' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'v1' })).toBeVisible();

  // v1 still has the original section title.
  await page.getByRole('row', { name: /v1/ }).getByRole('link', { name: 'Bax' }).click();
  await expect(page.getByLabel('Bölmənin adı')).toHaveValue('Giriş və dəhliz');
  await expect(page.getByText('Yalnız baxış')).toBeVisible();
});
```

Check two details against the implementation, and adjust the selectors (not the behaviour) if they differ:
- shadcn `Card` renders `data-slot="card"`. Verify in `apps/web/src/components/ui/card.tsx`.
- The inspector `<aside>` has the implicit role `complementary`.

The "Move to" step relies on the canvas inserting the new item at index 0 (the first "+ Bənd əlavə et" button), so moving it to position 2 puts it after the first template item. The tree's treeitems are then: section (0), first template item (1), the new item (2).

- [ ] **Step 3: Run the e2e test locally**

```bash
docker compose -p foundation start
pnpm db:setup && pnpm db:seed
pnpm build
pnpm --filter @taskop/web e2e
```
Expected: both `foundation.spec.ts` and `checklists.spec.ts` pass.

- [ ] **Step 4: Full verification**

```bash
pnpm lint && pnpm typecheck && pnpm test
```
Expected: all green. If lint fails only on formatting, run `pnpm format` and re-run.

Manually check the builder in a browser (`pnpm dev`, log in as `owner@demo.taskop.az`):
- Drag an item across sections with the mouse.
- Reorder with the keyboard: focus a drag handle, press Space, use the arrows, press Space.
- Open the seeded "Anbar qəbulu" draft, preview it, and confirm the follow-ups react to answers.
- Log in at `/platform/login` (create an admin with `pnpm --filter @taskop/api platform:create-admin` if needed), then open a tenant's checklists and a global template.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e .github/workflows/ci.yml
git commit -m "test(web): add checklist builder end-to-end test and seed templates in CI"
```

---

## Spec coverage (self-review)

| Spec section | Task |
|---|---|
| §7.1 navigation, list, new dialog (blank / template / copy) | W4 |
| §7.1 detail: metadata, versions, restore, save as template, deactivate | W8 |
| §7.1 template gallery (Taskop / ours, categories, use, edit) | W8 |
| §7.1 platform: global templates and a tenant's checklists | W9 |
| §7.2 outline: drag-and-drop and "Move to…" | W5 |
| §7.2 canvas, inspector, rules editor (depth ≤ 3) | W6 |
| §7.2 top bar: save state, issues, undo/redo, preview, publish | W7 |
| §7.2 reducer, undo 50, autosave 1.5 s, single flight, 409 banner | W2, W3, W7 |
| §7.2 preview via `visibleItems` / `requirements` / `computeScore` | W7 |
| §7.2 read-only modes | W5–W8 |
| §9 web component tests and Playwright | W2–W10 |

Deliberate deviations, noted in the tasks:
- Inspector fields are controlled inputs dispatching reducer actions, not react-hook-form.
- `AddItemButton` uses an inline type list rather than a Radix dropdown, which keeps it testable in jsdom.
- The platform tenant banner finds the tenant name in the cached tenant list, because there is no tenant-by-id endpoint.
