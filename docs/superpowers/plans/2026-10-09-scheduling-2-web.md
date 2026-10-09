# Taskop Scheduling & Assignment — Part 2: API Client & Web — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give tenant admins and managers web screens for shift templates, the weekly roster, assignments (with a schedule builder and a live preview of upcoming slots) and the day/week schedule of occurrences, plus an "Assignments" section on the checklist page.

**Architecture:**
- **Code location:** a new feature folder `apps/web/src/features/scheduling/`, following the existing feature pattern: React Query hooks in `queries.ts`, pages that call `api.*` from `@/lib/session`, and shadcn/ui components.
- **Shared logic:** recurrence expansion and the human-readable summary come from `@taskop/contracts` (Part 1), so the web shows exactly what the API will generate.
- **Testability:** pages take their route params as props. Thin route wrappers in `routes.tsx` read them from TanStack Router, so components can be tested without the app router.
- **Tenant only:** platform admins can use the API, but get no scheduling screens in this sub-project.

**Tech Stack:** React 19.2.3, TanStack Router 1 + Query 5, react-hook-form + Zod 4, shadcn/ui (Radix), i18next, Vitest + Testing Library, Playwright (all already in the repo). No new packages.

**Spec:** `docs/superpowers/specs/2026-10-09-scheduling-assignment-design.md`

**This plan is Part 2 of 2.** It needs Tasks 1–5 of Part 1 (`docs/superpowers/plans/2026-10-09-scheduling-1-api.md`) merged into the feature branch for contracts and i18n. Task 11 (end-to-end) also needs Part 1 finished.

## Global Constraints

- The product name is **Taskop**. Azerbaijani (`az`) is the only locale, and every visible string is an i18n key under `scheduling.*`, `nav.*` or `common.*`.
- Install nothing new. Use the existing components:
  - `@/components/*` and `@/components/ui/*` (`Button`, `Badge`, `Table`, `Dialog`, `Checkbox`, `Input`, `Label`, `Alert`)
  - `NativeSelect`, `CheckboxList`, `PageHeader`, `ConfirmButton`, `FormError`, `TextField`
- Dates and times shown to users are in the **tenant timezone** (`me.tenant.timezone`). Local dates (`YYYY-MM-DD`) are formatted with `timeZone: 'UTC'` so they never shift.
- Navigation entries are shown only with their permission:
  - Təyinatlar and İcra cədvəli need `assignments.view`.
  - Növbələr and Növbə cədvəli need `shifts.view`.
  - Create, edit and cancel actions also need `assignments.manage` or `shifts.manage`.
- Limits mirrored from the API: 1–50 assignees; roster copy ≤ 12 weeks; the occurrence list follows `nextCursor` in pages of 200.
- Tests mock `@/lib/session` exactly as the existing feature tests do. Time-dependent components take a `today` or `initialDate` prop, so tests never depend on the real clock.

## Review Focus

These are the five input classes most likely to bite users that no spec test names. Each line gives the task whose tests pin it.

1. **Changing the site after picking assignees.** The assignee list must be cleared and shift timing reset, or the user saves an assignment the API rejects with `ASSIGNEE_NOT_AT_SITE`. Pinned in Task 7 (`clears assignees when the site changes`).
2. **Unchecking the last weekday in a weekly rule.** The rule would become invalid (≥ 1 weekday), so the last checkbox must refuse to clear. Pinned in Task 6 (`keeps at least one weekday`).
3. **A save that fails because of named users** (`ASSIGNEE_NOT_AT_SITE` / `ASSIGNEE_INACTIVE`). The message must name the people, not just say "one of the assignees". Pinned in Task 7 (`names the users an error is about`).
4. **Copying a roster week while there are unsaved ticks.** Copying the saved week would silently drop the unsaved ticks, so Copy must be disabled until the week is saved. Pinned in Task 5 (`disables copy while there are unsaved changes`).
5. **A busy week with more than 200 occurrences.** The schedule must follow `nextCursor` instead of showing only the first page. Pinned in Task 3 (`follows nextCursor`).

---

## File Structure

```
packages/api-client/src/
  errors.ts                   + ApiError.userIds
  client.ts                   passes userIds
  endpoints.ts                + createSchedulingApi (shifts, roster, assignments, occurrences) merged into createTaskopApi
  client.test.ts              + scheduling endpoint tests
packages/i18n/src/az/
  scheduling.ts               + UI strings (shifts, roster, assignments, builder, schedule)
  nav.ts                      + assignments, schedule, shifts, roster
apps/web/src/
  test/router.tsx             renderWithRouter (a splat route around the component under test)
  features/scheduling/
    labels.ts                 variants, scheduleSummary, cancelReasonText, formatLocalDate, useTimeFormat, useTenantToday, useDebounced
    labels.test.ts
    queries.ts                React Query hooks (useOccurrences follows nextCursor)
    queries.test.tsx
    shifts-page.tsx, shift-dialog.tsx, shifts-page.test.tsx
    roster-grid.ts            weekStartOf, weekDates, rowKey, parseKey, toggleKey
    roster-page.tsx, roster-page.test.tsx
    schedule-builder.tsx      RecurrenceEditor, TimingEditor, defaultRecurrence, defaultTiming
    schedule-builder.test.tsx
    assignment-editor.tsx, assignment-editor.test.tsx
    assignment-pages.tsx      AssignmentsPage, NewAssignmentPage, AssignmentDetailPage
    assignment-pages.test.tsx
    schedule-page.tsx, occurrence-dialog.tsx, schedule-page.test.tsx
    checklist-assignments.tsx, checklist-assignments.test.tsx
    routes.tsx                route wrappers reading params/search
  features/checklists/checklist-detail-page.tsx   + <ChecklistAssignments> for tenant users
  layouts/app-shell.tsx       + 4 nav items
  router.tsx                  + /shifts, /roster, /assignments, /assignments/new, /assignments/$assignmentId, /schedule
apps/web/e2e/scheduling.spec.ts
```

---

### Task 1: API client for scheduling

**Files:**
- Modify: `packages/api-client/src/errors.ts`, `packages/api-client/src/client.ts:67`, `packages/api-client/src/endpoints.ts`
- Test: `packages/api-client/src/client.test.ts`

**Interfaces:**
- Consumes: Part 1 Task 4 schemas and input types.
- Produces (used by every later task as `api.shifts`, `api.roster`, `api.assignments` and `api.occurrences`):
  - `shifts.list(query?)`, `shifts.create(body)`, `shifts.update(id, body)`
  - `roster.get(query)`, `roster.put(body)`, `roster.copy(body)`
  - `assignments.list(query?)`, `assignments.get(id)`, `assignments.create(body)`, `assignments.update(id, body)`, `assignments.preview(body)`, `assignments.pause(id)`, `assignments.resume(id)`, `assignments.end(id)`
  - `occurrences.list(query)`, `occurrences.get(id)`, `occurrences.cancel(id, body)`, `occurrences.mine(query)`
  - `ApiError.userIds: string[] | null`

- [ ] **Step 1: Write the failing test**

Append to `packages/api-client/src/client.test.ts`:

```ts
describe('scheduling endpoints', () => {
  async function authed(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    const store = memoryTokenStore();
    await store.save({ accessToken: 'a1', refreshToken: null });
    return setup(handler, 'web', store);
  }

  it('builds paths and query strings, with comma-separated statuses', async () => {
    const urls: string[] = [];
    const { api } = await authed((url, init) => {
      urls.push(`${init.method} ${url}`);
      return json(200, { items: [], nextCursor: null });
    });
    const t = createTaskopApi(api);
    await t.occurrences.list({ from: '2026-11-02', to: '2026-11-08', status: 'pending,overdue', siteId: id });
    await t.occurrences.mine({ from: '2026-11-02', to: '2026-11-08' });
    await t.assignments.list({ status: 'active' });
    expect(urls).toEqual([
      `GET /api/v1/occurrences?from=2026-11-02&to=2026-11-08&status=pending%2Coverdue&siteId=${id}`,
      'GET /api/v1/me/occurrences?from=2026-11-02&to=2026-11-08',
      'GET /api/v1/assignments?status=active',
    ]);
  });

  it('exposes userIds on scheduling errors', async () => {
    const { api } = await authed(() =>
      json(422, { error: { code: 'ASSIGNEE_NOT_AT_SITE', messageKey: 'errors.ASSIGNEE_NOT_AT_SITE', fields: null, retryAfterSeconds: null, requestId: 'r1', userIds: [id] } }),
    );
    const call = createTaskopApi(api).assignments.preview({
      siteId: id,
      schedule: { kind: 'once', date: '2026-11-05' },
      timing: { mode: 'fixed', startTime: '08:00', dueAfterMinutes: 60, graceMinutes: 0 },
    });
    await expect(call).rejects.toMatchObject({ code: 'ASSIGNEE_NOT_AT_SITE', userIds: [id] });
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api-client test`
Expected: FAIL: `t.occurrences` is undefined.

- [ ] **Step 3: Implement**

In `packages/api-client/src/errors.ts`, add a last constructor parameter:

```ts
    readonly currentRevision: number | null = null,
    /** Users an error is about (ASSIGNEE_NOT_AT_SITE, ASSIGNEE_INACTIVE, ROSTER_USER_NOT_AT_SITE). */
    readonly userIds: string[] | null = null,
```

In `packages/api-client/src/client.ts`, line 67, pass it:

```ts
  return new ApiError(res.status, e.code, e.messageKey, e.fields, e.retryAfterSeconds, e.requestId, e.issues ?? null, e.currentRevision ?? null, e.userIds ?? null);
```

In `packages/api-client/src/endpoints.ts`:
- Add these to the `@taskop/contracts` import: `assignmentDetailSchema`, `type AssignmentListQuery`, `assignmentDtoSchema`, `assignmentPreviewSchema`, `type CancelOccurrenceInput`, `type CopyRosterInput`, `type CreateAssignmentInput`, `type CreateShiftInput`, `type MyOccurrenceQuery`, `occurrenceDetailSchema`, `occurrenceDtoSchema`, `type OccurrenceListQuery`, `type PreviewAssignmentInput`, `type PutRosterInput`, `rosterCopyResultSchema`, `rosterDtoSchema`, `type RosterQuery`, `shiftDtoSchema`, `type ShiftListQuery`, `type UpdateAssignmentInput`, `type UpdateShiftInput`.
- Add:

```ts
export function createSchedulingApi(c: ApiClient) {
  return {
    shifts: {
      list: (query: ShiftListQuery = {}) => c.request('GET', '/shifts', { query: q(query), schema: z.array(shiftDtoSchema) }),
      create: (body: CreateShiftInput) => c.request('POST', '/shifts', { body, schema: shiftDtoSchema }),
      update: (id: string, body: UpdateShiftInput) => c.request('PATCH', `/shifts/${id}`, { body, schema: shiftDtoSchema }),
    },
    roster: {
      get: (query: RosterQuery) => c.request('GET', '/roster', { query: q(query), schema: rosterDtoSchema }),
      put: (body: PutRosterInput) => c.request('PUT', '/roster', { body, schema: rosterDtoSchema }),
      copy: (body: CopyRosterInput) => c.request('POST', '/roster/copy', { body, schema: rosterCopyResultSchema }),
    },
    assignments: {
      list: (query: AssignmentListQuery = {}) => c.request('GET', '/assignments', { query: q(query), schema: pageOf(assignmentDtoSchema) }),
      get: (id: string) => c.request('GET', `/assignments/${id}`, { schema: assignmentDetailSchema }),
      create: (body: CreateAssignmentInput) => c.request('POST', '/assignments', { body, schema: assignmentDetailSchema }),
      update: (id: string, body: UpdateAssignmentInput) => c.request('PUT', `/assignments/${id}`, { body, schema: assignmentDetailSchema }),
      preview: (body: PreviewAssignmentInput) => c.request('POST', '/assignments/preview', { body, schema: assignmentPreviewSchema }),
      pause: (id: string) => c.request('POST', `/assignments/${id}/pause`, { body: {}, schema: assignmentDetailSchema }),
      resume: (id: string) => c.request('POST', `/assignments/${id}/resume`, { body: {}, schema: assignmentDetailSchema }),
      end: (id: string) => c.request('POST', `/assignments/${id}/end`, { body: {}, schema: assignmentDetailSchema }),
    },
    occurrences: {
      list: (query: OccurrenceListQuery) => c.request('GET', '/occurrences', { query: q(query), schema: pageOf(occurrenceDtoSchema) }),
      get: (id: string) => c.request('GET', `/occurrences/${id}`, { schema: occurrenceDetailSchema }),
      cancel: (id: string, body: CancelOccurrenceInput) => c.request('POST', `/occurrences/${id}/cancel`, { body, schema: occurrenceDetailSchema }),
      mine: (query: MyOccurrenceQuery) => c.request('GET', '/me/occurrences', { query: q(query), schema: pageOf(occurrenceDtoSchema) }),
    },
  };
}
export type SchedulingApi = ReturnType<typeof createSchedulingApi>;
```

- In `createTaskopApi`, after `templates: createTemplatesApi(c),`, add:

```ts
    ...createSchedulingApi(c),
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api-client test && pnpm --filter @taskop/api-client typecheck && pnpm --filter @taskop/api-client build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api-client/src
git commit -m "feat(api-client): add shifts, roster, assignments and occurrences endpoints"
```

---

### Task 2: UI strings and navigation labels

**Files:**
- Modify: `packages/i18n/src/az/scheduling.ts`, `packages/i18n/src/az/nav.ts`, `packages/i18n/src/i18n.test.ts`

**Interfaces:**
- Produces the exact strings the web tests below assert on. Every key is listed here. Later tasks use these keys and must not invent new ones (add any extra key here first).

- [ ] **Step 1: Write the failing test**

Append to the `scheduling translations` block in `packages/i18n/src/i18n.test.ts`:

```ts
  it('has the UI strings the web screens use', () => {
    for (const k of ['assignments', 'schedule', 'shifts', 'roster'] as const) expect(az.nav[k], k).toBeTypeOf('string');
    for (const k of ['once', 'daily', 'weekly', 'monthly', 'dates'] as const) expect(az.scheduling.builder.kinds[k], k).toBeTypeOf('string');
    for (const k of ['active', 'paused', 'ended'] as const) expect(az.scheduling.assignments.status[k], k).toBeTypeOf('string');
    expect(az.scheduling.roster.cellLabel).toContain('{{person}}');
  });
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/i18n test`
Expected: FAIL: `az.nav.assignments` is undefined.

- [ ] **Step 3: Add the strings**

In `packages/i18n/src/az/nav.ts`, add after `templates`:

```ts
  assignments: 'Təyinatlar',
  schedule: 'İcra cədvəli',
  shifts: 'Növbələr',
  roster: 'Növbə cədvəli',
```

In `packages/i18n/src/az/scheduling.ts`, add these keys to the default export, alongside the ones from Part 1:

```ts
  shifts: {
    title: 'Növbələr',
    add: 'Növbə yarat',
    createTitle: 'Yeni növbə',
    editTitle: 'Növbəni redaktə et',
    name: 'Ad',
    hours: 'Saatlar',
    start: 'Başlama',
    end: 'Bitmə',
    site: 'Obyekt',
    allSites: 'Bütün obyektlər',
    nextDay: 'növbəti gün bitir',
    empty: 'Hələ növbə yoxdur.',
  },
  roster: {
    title: 'Növbə cədvəli',
    site: 'Obyekt',
    chooseSite: 'Obyekt seçin',
    prevWeek: 'Əvvəlki həftə',
    nextWeek: 'Növbəti həftə',
    person: 'Əməkdaş',
    saved: 'Növbə cədvəli yadda saxlanıldı',
    unsaved: 'Saxlanmamış dəyişikliklər var',
    copy: 'Bu həftəni köçür…',
    copyTitle: 'Həftəni sonrakı həftələrə köçür',
    copyHint: 'Seçilmiş həftələrdəki mövcud növbələr əvəz olunacaq.',
    copyWeeks: 'Neçə həftə irəli',
    copyAction: 'Köçür',
    copied: '{{count}} sətir köçürüldü',
    noPeople: 'Bu obyektdə aktiv əməkdaş yoxdur.',
    noShifts: 'Bu obyekt üçün aktiv növbə yoxdur.',
    cellLabel: '{{shift}} — {{person}}, {{date}}',
  },
  assignments: {
    title: 'Təyinatlar',
    add: 'Yeni təyinat',
    empty: 'Hələ təyinat yoxdur.',
    createTitle: 'Yeni təyinat',
    name: 'Ad (istəyə bağlı)',
    checklist: 'Yoxlama vərəqəsi',
    chooseChecklist: 'Yoxlama vərəqəsi seçin',
    site: 'Obyekt',
    chooseSite: 'Obyekt seçin',
    allSites: 'Bütün obyektlər',
    allStatuses: 'Bütün statuslar',
    assignees: 'İcraçılar',
    assigneeCount: '{{count}} icraçı',
    schedule: 'Cədvəl',
    status: { active: 'Aktiv', paused: 'Dayandırılıb', ended: 'Bitib' },
    pause: 'Dayandır',
    resume: 'Davam etdir',
    end: 'Bitir',
    confirmEnd: '«{{name}}» təyinatı bitirilsin? Bu geri qaytarıla bilməz.',
    copyToSites: 'Digər obyektlərə köçür',
    saved: 'Təyinat yadda saxlanıldı',
    preview: 'Növbəti icralar',
    previewEmpty: 'Bu cədvəl üzrə yaxın bir ildə icra yoxdur.',
    upcoming: 'Yaxın icralar',
    noUpcoming: 'Yaxın icra yoxdur.',
    assign: 'Təyin et',
    forChecklist: 'Təyinatlar',
  },
  builder: {
    kind: 'Təkrarlanma',
    kinds: { once: 'Bir dəfə', daily: 'Gündəlik', weekly: 'Həftəlik', monthly: 'Aylıq', dates: 'Seçilmiş tarixlər' },
    date: 'Tarix',
    dates: 'Tarixlər',
    everyDays: 'Neçə gündən bir',
    everyWeeks: 'Neçə həftədən bir',
    everyMonths: 'Neçə aydan bir',
    weekdays: 'Həftə günləri',
    monthlyBy: 'Ay üzrə',
    byDay: 'Ayın günü',
    byWeekday: 'Həftə günü',
    dayOfMonth: 'Gün',
    nth: 'Hansı',
    weekday: 'Gün adı',
    startDate: 'Başlama tarixi',
    endDate: 'Bitmə tarixi (istəyə bağlı)',
    skipDates: 'İstisna tarixləri',
    addDate: 'Tarix əlavə et',
    remove: 'Sil',
    mode: 'Vaxt növü',
    modes: { fixed: 'Sabit vaxt', shift: 'Növbəyə görə' },
    startTime: 'Başlama vaxtı',
    dueAfter: 'İcra müddəti (dəqiqə)',
    grace: 'Gecikmə icazəsi (dəqiqə)',
    shift: 'Növbə',
    chooseShift: 'Növbə seçin',
  },
  schedule: {
    title: 'İcra cədvəli',
    day: 'Gün',
    week: 'Həftə',
    today: 'Bu gün',
    prev: 'Əvvəlki',
    next: 'Növbəti',
    allSites: 'Bütün obyektlər',
    allStatuses: 'Bütün statuslar',
    site: 'Obyekt',
    status: 'Status',
    unassigned: 'İcraçı yoxdur',
    empty: 'Bu dövrdə icra yoxdur.',
    window: 'Başlama: {{start}} · Son: {{due}} · Bağlanır: {{close}}',
    assignees: 'İcraçılar',
    history: 'Tarixçə',
    actorSystem: 'Sistem',
    actorPlatform: 'Taskop dəstəyi',
    cancel: 'İcranı ləğv et',
    cancelReason: 'Ləğv səbəbi',
    cancelled: 'İcra ləğv edildi',
  },
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/i18n test && pnpm --filter @taskop/i18n build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/src
git commit -m "feat(i18n): add scheduling screen strings and navigation labels"
```

---

### Task 3: Shared web helpers: labels, formatting, queries and a router test helper

**Files:**
- Create: `apps/web/src/features/scheduling/labels.ts`, `apps/web/src/features/scheduling/queries.ts`, `apps/web/src/test/router.tsx`
- Test: `apps/web/src/features/scheduling/labels.test.ts`, `apps/web/src/features/scheduling/queries.test.tsx`

**Interfaces:**
- Produces:
  - `labels.ts`:
    - `occurrenceVariant(status)`, `assignmentVariant(status)`
    - `scheduleSummary(t, recurrence, timing, shiftName)`
    - `cancelReasonText(t, reason)`
    - `formatLocalDate(date)`
    - `useTimeFormat(): (iso) => 'HH:mm'` in the tenant zone
    - `useTenantToday(): LocalDate`
    - `useDebounced(value, ms = 400)`
  - `queries.ts`:
    - `useShifts(siteId?)`, `useSiteUsers(siteId)`, `useAssignableChecklists()`, `useRoster(siteId, from, to)`
    - `useAssignments(filters, enabled?)`, `useAssignment(id)`, `useOccurrences(filters)`, `useOccurrence(id)`
  - `renderWithRouter(ui, path?)`: returns the router. Every path renders `ui`, so a test can assert `router.state.location`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/scheduling/labels.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { cancelReasonText, formatLocalDate, occurrenceVariant, scheduleSummary } from './labels';

const t = i18n.t.bind(i18n);

describe('scheduling labels', () => {
  it('summarises a schedule in Azerbaijani', () => {
    const daily = { kind: 'daily' as const, every: 1, startDate: '2026-11-02', endDate: null, skipDates: [] };
    expect(scheduleSummary(t, daily, { mode: 'fixed', startTime: '08:00', dueAfterMinutes: 120, graceMinutes: 0 }, null)).toBe('Hər gün, 08:00–10:00');
  });

  it('translates system cancel reasons and keeps free text', () => {
    expect(cancelReasonText(t, 'assignment_paused')).toBe('Təyinat dayandırıldı');
    expect(cancelReasonText(t, 'Bayram günü')).toBe('Bayram günü');
    expect(cancelReasonText(t, null)).toBeNull();
  });

  it('formats local dates without shifting them and colours statuses', () => {
    expect(formatLocalDate('2026-11-02')).toContain('2026');
    expect(formatLocalDate('2026-11-02')).toContain('2');
    expect(occurrenceVariant('missed')).toBe('destructive');
    expect(occurrenceVariant('pending')).toBe('secondary');
  });
});
```

`apps/web/src/features/scheduling/queries.test.tsx`:

```tsx
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOccurrences } from './queries';

const mocks = vi.hoisted(() => ({ api: { occurrences: { list: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => vi.resetAllMocks());

describe('useOccurrences', () => {
  it('follows nextCursor until the range is complete', async () => {
    mocks.api.occurrences.list
      .mockResolvedValueOnce({ items: [{ id: 'o1' }], nextCursor: 'o1' })
      .mockResolvedValueOnce({ items: [{ id: 'o2' }], nextCursor: null });
    const { result } = renderHook(() => useOccurrences({ from: '2026-11-02', to: '2026-11-08' }), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([{ id: 'o1' }, { id: 'o2' }]));
    expect(mocks.api.occurrences.list).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: 'o1', limit: 200 }));
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/web test -- scheduling/labels scheduling/queries`
Expected: FAIL: the modules do not exist.

- [ ] **Step 3: Implement**

`apps/web/src/features/scheduling/labels.ts`:

```ts
import {
  type AssignmentStatus,
  CANCEL_REASON_CODES,
  describeSchedule,
  localDateOf,
  type OccurrenceStatus,
  type Recurrence,
  type Timing,
} from '@taskop/contracts';
import { intlLocale } from '@taskop/i18n';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useState } from 'react';
import { useMe } from '@/lib/session';

type Variant = 'default' | 'secondary' | 'destructive' | 'outline';

export const occurrenceVariant = (s: OccurrenceStatus): Variant =>
  s === 'overdue' || s === 'missed' ? 'destructive' : s === 'cancelled' ? 'outline' : s === 'pending' ? 'secondary' : 'default';

export const assignmentVariant = (s: AssignmentStatus): Variant => (s === 'active' ? 'default' : s === 'paused' ? 'secondary' : 'outline');

export const scheduleSummary = (t: TFunction, r: Recurrence, timing: Timing, shiftName: string | null): string =>
  describeSchedule(r, timing, shiftName, (key, vars) => t(key, vars));

/** System reasons are codes (spec §5.3); a manager's own reason is free text. */
export const cancelReasonText = (t: TFunction, reason: string | null): string | null =>
  reason !== null && (CANCEL_REASON_CODES as readonly string[]).includes(reason) ? t(`scheduling.cancelReasons.${reason}`) : reason;

/** 'YYYY-MM-DD' as a short date with weekday; formatted in UTC so it never moves a day. */
export function formatLocalDate(date: string, locale = 'az'): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export function useTimeFormat(): (iso: string) => string {
  const { tenant } = useMe();
  return useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat(intlLocale(tenant.locale), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tenant.timezone }).format(new Date(iso)),
    [tenant.locale, tenant.timezone],
  );
}

export function useTenantToday(): string {
  const { tenant } = useMe();
  return localDateOf(new Date(), tenant.timezone);
}

export function useDebounced<T>(value: T, ms = 400): T {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setCurrent(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return current;
}
```

`apps/web/src/features/scheduling/queries.ts`:

```ts
import type { AssignmentListQuery, OccurrenceDto, OccurrenceListQuery } from '@taskop/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/session';

export const useShifts = (siteId?: string | null) =>
  useQuery({ queryKey: ['shifts', siteId ?? 'all'], queryFn: () => api.shifts.list(siteId ? { siteId } : {}) });

export const useSiteUsers = (siteId: string | null) =>
  useQuery({
    queryKey: ['users', 'site', siteId],
    queryFn: async () => (await api.users.list({ siteId: siteId!, status: 'active', limit: 200 })).items,
    enabled: Boolean(siteId),
  });

/** Only active checklists with a published version can be assigned (spec §4.2). */
export const useAssignableChecklists = () =>
  useQuery({
    queryKey: ['checklists', 'assignable'],
    queryFn: async () => (await api.checklists.list({ status: 'active', limit: 200 })).items.filter((c) => c.currentVersionNumber !== null),
  });

export const useRoster = (siteId: string | null, from: string, to: string) =>
  useQuery({ queryKey: ['roster', siteId, from, to], queryFn: () => api.roster.get({ siteId: siteId!, from, to }), enabled: Boolean(siteId) });

export const useAssignments = (filters: AssignmentListQuery, enabled = true) =>
  useQuery({ queryKey: ['assignments', 'list', filters], queryFn: () => api.assignments.list({ ...filters, limit: 200 }), enabled });

export const useAssignment = (id: string | undefined) =>
  useQuery({ queryKey: ['assignments', 'detail', id], queryFn: () => api.assignments.get(id!), enabled: Boolean(id) });

/** Follows nextCursor so a busy week is never cut off. */
export const useOccurrences = (filters: Omit<OccurrenceListQuery, 'cursor' | 'limit'>) =>
  useQuery({
    queryKey: ['occurrences', 'list', filters],
    queryFn: async () => {
      const all: OccurrenceDto[] = [];
      let cursor: string | undefined;
      do {
        const page = await api.occurrences.list({ ...filters, limit: 200, cursor });
        all.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return all;
    },
  });

export const useOccurrence = (id: string | null) =>
  useQuery({ queryKey: ['occurrences', 'detail', id], queryFn: () => api.occurrences.get(id!), enabled: Boolean(id) });
```

`apps/web/src/test/router.tsx`:

```tsx
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { renderWithProviders } from './render';

/** Renders `ui` at every path, so components can use <Link> and useNavigate and tests can read router.state. */
export function renderWithRouter(ui: ReactElement, path = '/') {
  const root = createRootRoute({ component: Outlet });
  const index = createRoute({ getParentRoute: () => root, path: '/', component: () => ui });
  const any = createRoute({ getParentRoute: () => root, path: '$', component: () => ui });
  const router = createRouter({ routeTree: root.addChildren([index, any]), history: createMemoryHistory({ initialEntries: [path] }) });
  renderWithProviders(<RouterProvider router={router} />);
  return router;
}
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- scheduling/labels scheduling/queries`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/scheduling apps/web/src/test/router.tsx
git commit -m "feat(web): add scheduling labels, queries and a router test helper"
```

---
### Task 4: Shifts page

**Files:**
- Create: `apps/web/src/features/scheduling/shift-dialog.tsx`, `apps/web/src/features/scheduling/shifts-page.tsx`
- Modify: `apps/web/src/router.tsx`, `apps/web/src/layouts/app-shell.tsx`
- Test: `apps/web/src/features/scheduling/shifts-page.test.tsx`

**Interfaces:**
- Consumes: `api.shifts.*`, `useShifts`, `useSites` (from `@/features/sites/queries`).
- Produces: `ShiftsPage` at the `/shifts` route, and the nav item "Növbələr" (`shifts.view`, icon `Clock`).

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/scheduling/shifts-page.test.tsx`:

```tsx
import type { ShiftDto } from '@taskop/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { ShiftsPage } from './shifts-page';

const mocks = vi.hoisted(() => ({
  api: { shifts: { list: vi.fn(), create: vi.fn(), update: vi.fn() }, sites: { list: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({ api: mocks.api, useCan: () => true }));

const shift = (over: Partial<ShiftDto> = {}): ShiftDto => ({
  id: 's1', name: 'Səhər', startTime: '08:00', endTime: '16:00', siteId: null, siteName: null, active: true, ...over,
});

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.api.sites.list.mockResolvedValue([{ id: 'site1', name: 'Anbar', parentId: null, typeId: 't', address: null, active: true, path: 'x', depth: 0 }]);
});

describe('ShiftsPage', () => {
  it('lists shifts and marks the ones that end the next day', async () => {
    mocks.api.shifts.list.mockResolvedValue([shift(), shift({ id: 's2', name: 'Gecə', startTime: '22:00', endTime: '06:00', siteId: 'site1', siteName: 'Anbar' })]);
    renderWithProviders(<ShiftsPage />);
    expect(await screen.findByText('08:00–16:00')).toBeInTheDocument();
    expect(screen.getByText('22:00–06:00 (növbəti gün bitir)')).toBeInTheDocument();
    expect(screen.getByText('Bütün obyektlər')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Anbar' })).toBeInTheDocument();
  });

  it('creates a shift for one site', async () => {
    mocks.api.shifts.list.mockResolvedValue([]);
    mocks.api.shifts.create.mockResolvedValue(shift());
    renderWithProviders(<ShiftsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Növbə yarat' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Ad'), 'Gecə');
    fireEvent.change(within(dialog).getByLabelText('Başlama'), { target: { value: '22:00' } });
    fireEvent.change(within(dialog).getByLabelText('Bitmə'), { target: { value: '06:00' } });
    expect(within(dialog).getByText('növbəti gün bitir')).toBeInTheDocument();
    await within(dialog).findByRole('option', { name: 'Anbar' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Obyekt'), 'site1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Yadda saxla' }));
    await waitFor(() => expect(mocks.api.shifts.create).toHaveBeenCalledWith({ name: 'Gecə', startTime: '22:00', endTime: '06:00', siteId: 'site1' }));
  });

  it('rejects a zero-length shift before calling the API', async () => {
    mocks.api.shifts.list.mockResolvedValue([]);
    renderWithProviders(<ShiftsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Növbə yarat' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Ad'), 'X');
    fireEvent.change(within(dialog).getByLabelText('Bitmə'), { target: { value: '08:00' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Yadda saxla' }));
    expect(await within(dialog).findByText('Növbənin başlama və bitmə vaxtı eyni ola bilməz.')).toBeInTheDocument();
    expect(mocks.api.shifts.create).not.toHaveBeenCalled();
  });

  it('deactivates a shift', async () => {
    mocks.api.shifts.list.mockResolvedValue([shift()]);
    mocks.api.shifts.update.mockResolvedValue(shift({ active: false }));
    renderWithProviders(<ShiftsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Deaktiv et' }));
    await waitFor(() => expect(mocks.api.shifts.update).toHaveBeenCalledWith('s1', { active: false }));
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/web test -- shifts-page`
Expected: FAIL: the module does not exist.

- [ ] **Step 3: Implement**

`apps/web/src/features/scheduling/shift-dialog.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { localTimeSchema, type ShiftDto, type SiteDto } from '@taskop/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { FormError } from '@/components/form-error';
import { NativeSelect } from '@/components/native-select';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { applyFieldErrors, errorText } from '@/lib/errors';

const schema = z
  .object({ name: z.string().trim().min(1).max(100), startTime: localTimeSchema, endTime: localTimeSchema, siteId: z.string() })
  .refine((v) => v.startTime !== v.endTime, { path: ['endTime'], message: 'scheduling.issues.shiftZeroLength' });

export interface ShiftFormValues {
  name: string;
  startTime: string;
  endTime: string;
  siteId: string | null;
}

interface Props {
  shift?: ShiftDto;
  sites: SiteDto[];
  onClose: () => void;
  onSubmit: (values: ShiftFormValues) => Promise<void>;
}

export function ShiftDialog({ shift, sites, onClose, onSubmit }: Props) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: shift?.name ?? '', startTime: shift?.startTime ?? '08:00', endTime: shift?.endTime ?? '16:00', siteId: shift?.siteId ?? '' },
  });
  const [start, end] = form.watch(['startTime', 'endTime']);
  const fieldError = (name: 'startTime' | 'endTime') => form.formState.errors[name]?.message;
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await onSubmit({ ...v, siteId: v.siteId || null });
      onClose();
    } catch (e) {
      if (!applyFieldErrors(form, e)) setError(errorText(t, e));
    }
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{shift ? t('scheduling.shifts.editTitle') : t('scheduling.shifts.createTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <TextField form={form} name="name" label={t('scheduling.shifts.name')} />
          <div className="grid grid-cols-2 gap-3">
            {(['startTime', 'endTime'] as const).map((name) => (
              <div key={name} className="grid gap-1.5">
                <Label htmlFor={name}>{name === 'startTime' ? t('scheduling.shifts.start') : t('scheduling.shifts.end')}</Label>
                <Input id={name} type="time" aria-invalid={Boolean(fieldError(name))} {...form.register(name)} />
                {fieldError(name) && <p className="text-destructive text-sm">{t(fieldError(name)!)}</p>}
              </div>
            ))}
          </div>
          {start && end && end < start && <p className="text-muted-foreground text-sm">{t('scheduling.shifts.nextDay')}</p>}
          <div className="grid gap-1.5">
            <Label htmlFor="siteId">{t('scheduling.shifts.site')}</Label>
            <NativeSelect id="siteId" {...form.register('siteId')}>
              <option value="">{t('scheduling.shifts.allSites')}</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

`apps/web/src/features/scheduling/shifts-page.tsx`:

```tsx
import type { ShiftDto } from '@taskop/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSites } from '@/features/sites/queries';
import { errorText } from '@/lib/errors';
import { api, useCan } from '@/lib/session';
import { useShifts } from './queries';
import { ShiftDialog } from './shift-dialog';

export function ShiftsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canManage = useCan('shifts.manage');
  const shifts = useShifts();
  const sites = useSites();
  const [editing, setEditing] = useState<ShiftDto | 'new' | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['shifts'] });
  const hours = (s: ShiftDto) => `${s.startTime}–${s.endTime}${s.endTime < s.startTime ? ` (${t('scheduling.shifts.nextDay')})` : ''}`;

  return (
    <div>
      <PageHeader title={t('scheduling.shifts.title')} actions={canManage && <Button onClick={() => setEditing('new')}>{t('scheduling.shifts.add')}</Button>} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('scheduling.shifts.name')}</TableHead>
            <TableHead>{t('scheduling.shifts.hours')}</TableHead>
            <TableHead>{t('scheduling.shifts.site')}</TableHead>
            <TableHead>{t('common.status')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(shifts.data ?? []).map((s) => (
            <TableRow key={s.id}>
              <TableCell className="font-medium">{s.name}</TableCell>
              <TableCell>{hours(s)}</TableCell>
              <TableCell>{s.siteName ?? t('scheduling.shifts.allSites')}</TableCell>
              <TableCell>
                <Badge variant={s.active ? 'default' : 'secondary'}>{s.active ? t('common.active') : t('common.inactive')}</Badge>
              </TableCell>
              <TableCell className="text-right">
                {canManage && (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                      {t('common.edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await api.shifts.update(s.id, { active: !s.active });
                          await refresh();
                        } catch (e) {
                          toast.error(errorText(t, e));
                        }
                      }}
                    >
                      {s.active ? t('common.deactivate') : t('common.reactivate')}
                    </Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
          {shifts.data?.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground text-center">
                {t('scheduling.shifts.empty')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {editing && (
        <ShiftDialog
          shift={editing === 'new' ? undefined : editing}
          sites={sites.data ?? []}
          onClose={() => setEditing(null)}
          onSubmit={async (v) => {
            if (editing === 'new') await api.shifts.create(v);
            else await api.shifts.update(editing.id, v);
            await refresh();
          }}
        />
      )}
    </div>
  );
}
```

Register the route. In `apps/web/src/router.tsx`:
- Import `ShiftsPage`.
- Add `const shiftsRoute = createRoute({ getParentRoute: () => appLayout, path: '/shifts', component: ShiftsPage });`.
- Add `shiftsRoute` to `appLayout.addChildren([...])`.

In `apps/web/src/layouts/app-shell.tsx`:
- Extend the `NavItem['to']` union with `'/assignments' | '/schedule' | '/shifts' | '/roster'`.
- Import `CalendarCheck`, `CalendarClock`, `CalendarDays` and `Clock` from `lucide-react`.
- Insert after the `/templates` item:

```ts
  { to: '/assignments', labelKey: 'nav.assignments', icon: CalendarCheck, permission: 'assignments.view' },
  { to: '/schedule', labelKey: 'nav.schedule', icon: CalendarClock, permission: 'assignments.view' },
  { to: '/shifts', labelKey: 'nav.shifts', icon: Clock, permission: 'shifts.view' },
  { to: '/roster', labelKey: 'nav.roster', icon: CalendarDays, permission: 'shifts.view' },
```

The links for `/assignments`, `/schedule` and `/roster` resolve once Tasks 5, 8 and 9 add those routes. The existing `to={item.to as '/'}` cast already allows that.

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- shifts-page app-shell && pnpm --filter @taskop/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/scheduling apps/web/src/router.tsx apps/web/src/layouts/app-shell.tsx
git commit -m "feat(web): add the shifts page and scheduling navigation"
```

---

### Task 5: Roster page (week grid, save, copy weeks)

**Files:**
- Create: `apps/web/src/features/scheduling/roster-grid.ts`, `apps/web/src/features/scheduling/roster-page.tsx`
- Modify: `apps/web/src/router.tsx`
- Test: `apps/web/src/features/scheduling/roster-page.test.tsx`

**Interfaces:**
- Consumes: `useRoster`, `useSites`, `api.roster.put` and `api.roster.copy`; `addDays` and `isoWeekday` from contracts; `formatLocalDate` and `useTenantToday`.
- Produces:
  - `RosterPage({ initialDate?: string })` at `/roster`
  - `roster-grid.ts`: `weekStartOf(d)`, `weekDates(start)`, `rowKey(row)`, `parseKey(key)`, `toggleKey(set, key, on)`

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/scheduling/roster-page.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { RosterPage } from './roster-page';

const mocks = vi.hoisted(() => ({ api: { roster: { get: vi.fn(), put: vi.fn(), copy: vi.fn() }, sites: { list: vi.fn() } } }));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useCan: () => true,
  useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }),
}));

const roster = {
  siteId: 'site1',
  from: '2026-11-02',
  to: '2026-11-08',
  users: [{ id: 'u1', fullName: 'Elvin' }],
  shifts: [{ id: 's1', name: 'Səhər', startTime: '08:00', endTime: '16:00', siteId: null, siteName: null, active: true }],
  rows: [{ userId: 'u1', shiftId: 's1', date: '2026-11-02' }],
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.api.sites.list.mockResolvedValue([{ id: 'site1', name: 'Anbar', parentId: null, typeId: 't', address: null, active: true, path: 'x', depth: 0 }]);
  mocks.api.roster.get.mockResolvedValue(roster);
  mocks.api.roster.put.mockResolvedValue(roster);
  mocks.api.roster.copy.mockResolvedValue({ rowCount: 2 });
});

async function openSite() {
  renderWithProviders(<RosterPage initialDate="2026-11-04" />);
  await userEvent.selectOptions(await screen.findByLabelText('Obyekt'), 'site1');
  await waitFor(() => expect(mocks.api.roster.get).toHaveBeenCalledWith({ siteId: 'site1', from: '2026-11-02', to: '2026-11-08' }));
}

describe('RosterPage', () => {
  it('shows the week from Monday and saves ticked cells', async () => {
    await openSite();
    expect(await screen.findByRole('checkbox', { name: 'Səhər — Elvin, 2026-11-02' })).toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Səhər — Elvin, 2026-11-03' }));
    expect(screen.getByText('Saxlanmamış dəyişikliklər var')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yadda saxla' }));
    await waitFor(() => expect(mocks.api.roster.put).toHaveBeenCalled());
    const body = mocks.api.roster.put.mock.calls[0]![0];
    expect(body).toMatchObject({ siteId: 'site1', from: '2026-11-02', to: '2026-11-08' });
    expect(body.rows).toEqual(
      expect.arrayContaining([
        { userId: 'u1', shiftId: 's1', date: '2026-11-02' },
        { userId: 'u1', shiftId: 's1', date: '2026-11-03' },
      ]),
    );
    expect(body.rows).toHaveLength(2);
  });

  it('disables copy while there are unsaved changes, then copies whole weeks', async () => {
    await openSite();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Səhər — Elvin, 2026-11-03' }));
    expect(screen.getByRole('button', { name: 'Bu həftəni köçür…' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Səhər — Elvin, 2026-11-03' }));
    await userEvent.click(screen.getByRole('button', { name: 'Bu həftəni köçür…' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Neçə həftə irəli'), { target: { value: '2' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Köçür' }));
    await waitFor(() =>
      expect(mocks.api.roster.copy).toHaveBeenCalledWith({ siteId: 'site1', sourceWeekStart: '2026-11-02', targetWeekStarts: ['2026-11-09', '2026-11-16'] }),
    );
  });

  it('moves between weeks', async () => {
    await openSite();
    await userEvent.click(screen.getByRole('button', { name: 'Növbəti həftə' }));
    await waitFor(() => expect(mocks.api.roster.get).toHaveBeenLastCalledWith({ siteId: 'site1', from: '2026-11-09', to: '2026-11-15' }));
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/web test -- roster-page`
Expected: FAIL: the module does not exist.

- [ ] **Step 3: Implement**

`apps/web/src/features/scheduling/roster-grid.ts`:

```ts
import { addDays, isoWeekday, type RosterRow } from '@taskop/contracts';

export const weekStartOf = (date: string): string => addDays(date, 1 - isoWeekday(date));
export const weekDates = (start: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(start, i));
export const rowKey = (r: RosterRow): string => `${r.userId}|${r.shiftId}|${r.date}`;

export function parseKey(key: string): RosterRow {
  const [userId, shiftId, date] = key.split('|') as [string, string, string];
  return { userId, shiftId, date };
}

export function toggleKey(set: ReadonlySet<string>, key: string, on: boolean): Set<string> {
  const next = new Set(set);
  if (on) next.add(key);
  else next.delete(key);
  return next;
}
```

`apps/web/src/features/scheduling/roster-page.tsx`:

```tsx
import { addDays, SCHEDULING_LIMITS } from '@taskop/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSites } from '@/features/sites/queries';
import { errorText } from '@/lib/errors';
import { api, useCan } from '@/lib/session';
import { formatLocalDate, useTenantToday } from './labels';
import { useRoster } from './queries';
import { parseKey, rowKey, toggleKey, weekDates, weekStartOf } from './roster-grid';

export function RosterPage({ initialDate }: { initialDate?: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const today = useTenantToday();
  const canManage = useCan('shifts.manage');
  const sites = useSites();
  const [siteId, setSiteId] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(() => weekStartOf(initialDate ?? today));
  const days = weekDates(weekStart);
  const to = days[6]!;
  const roster = useRoster(siteId, weekStart, to);
  const saved = useMemo(() => new Set((roster.data?.rows ?? []).map(rowKey)), [roster.data]);
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const [copying, setCopying] = useState(false);
  const [weeks, setWeeks] = useState(1);
  const current = draft ?? saved;
  // Ticking and unticking the same cell is not a change.
  const dirty = draft !== null && (draft.size !== saved.size || [...draft].some((k) => !saved.has(k)));
  useEffect(() => setDraft(null), [siteId, weekStart]);

  // Inactive shifts stay visible while a row in this week still uses them.
  const shifts = (roster.data?.shifts ?? []).filter((s) => s.active || [...current].some((k) => parseKey(k).shiftId === s.id));
  const people = roster.data?.users ?? [];

  const save = async () => {
    try {
      await api.roster.put({ siteId: siteId!, from: weekStart, to, rows: [...current].map(parseKey) });
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ['roster'] });
      toast.success(t('scheduling.roster.saved'));
    } catch (e) {
      toast.error(errorText(t, e));
    }
  };

  const copy = async () => {
    try {
      const targetWeekStarts = Array.from({ length: weeks }, (_, i) => addDays(weekStart, 7 * (i + 1)));
      const result = await api.roster.copy({ siteId: siteId!, sourceWeekStart: weekStart, targetWeekStarts });
      setCopying(false);
      await qc.invalidateQueries({ queryKey: ['roster'] });
      toast.success(t('scheduling.roster.copied', { count: result.rowCount }));
    } catch (e) {
      toast.error(errorText(t, e));
    }
  };

  return (
    <div className="grid gap-4">
      <PageHeader
        title={t('scheduling.roster.title')}
        actions={
          canManage &&
          siteId && (
            <>
              <Button variant="outline" disabled={dirty} onClick={() => setCopying(true)}>
                {t('scheduling.roster.copy')}
              </Button>
              <Button disabled={!dirty} onClick={() => void save()}>
                {t('common.save')}
              </Button>
            </>
          )
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="roster-site">{t('scheduling.roster.site')}</Label>
          <NativeSelect id="roster-site" value={siteId ?? ''} onChange={(e) => setSiteId(e.target.value || null)} className="w-64">
            <option value="">{t('scheduling.roster.chooseSite')}</option>
            {(sites.data ?? []).filter((s) => s.active).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button variant="outline" onClick={() => setWeekStart(addDays(weekStart, -7))}>
          {t('scheduling.roster.prevWeek')}
        </Button>
        <span className="text-sm">
          {formatLocalDate(weekStart)} – {formatLocalDate(to)}
        </span>
        <Button variant="outline" onClick={() => setWeekStart(addDays(weekStart, 7))}>
          {t('scheduling.roster.nextWeek')}
        </Button>
        {dirty && <span className="text-sm text-amber-700">{t('scheduling.roster.unsaved')}</span>}
      </div>

      {siteId && roster.data && people.length === 0 && <p className="text-muted-foreground">{t('scheduling.roster.noPeople')}</p>}
      {siteId && roster.data && people.length > 0 && shifts.length === 0 && <p className="text-muted-foreground">{t('scheduling.roster.noShifts')}</p>}
      {siteId && people.length > 0 && shifts.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('scheduling.roster.person')}</TableHead>
              {days.map((d) => (
                <TableHead key={d}>{formatLocalDate(d)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {people.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.fullName}</TableCell>
                {days.map((d) => (
                  <TableCell key={d}>
                    <div className="grid gap-1">
                      {shifts.map((s) => {
                        const key = rowKey({ userId: u.id, shiftId: s.id, date: d });
                        return (
                          <label key={s.id} className="flex items-center gap-1 text-xs">
                            <Checkbox
                              aria-label={t('scheduling.roster.cellLabel', { shift: s.name, person: u.fullName, date: d })}
                              checked={current.has(key)}
                              disabled={!canManage}
                              onCheckedChange={(c) => setDraft(toggleKey(current, key, c === true))}
                            />
                            {s.name}
                          </label>
                        );
                      })}
                    </div>
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={copying} onOpenChange={setCopying}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('scheduling.roster.copyTitle')}</DialogTitle>
            <DialogDescription>{t('scheduling.roster.copyHint')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="copy-weeks">{t('scheduling.roster.copyWeeks')}</Label>
            <Input
              id="copy-weeks"
              type="number"
              min={1}
              max={SCHEDULING_LIMITS.copyMaxWeeks}
              value={weeks}
              onChange={(e) => setWeeks(Math.min(SCHEDULING_LIMITS.copyMaxWeeks, Math.max(1, Number(e.target.value) || 1)))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopying(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void copy()}>{t('scheduling.roster.copyAction')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

In `router.tsx`:
- Import `RosterPage`.
- Add `const rosterRoute = createRoute({ getParentRoute: () => appLayout, path: '/roster', component: () => <RosterPage /> });`.
- Add `rosterRoute` to `appLayout.addChildren`.

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- roster-page && pnpm --filter @taskop/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/scheduling apps/web/src/router.tsx
git commit -m "feat(web): add the weekly roster grid with save and week copy"
```

---

### Task 6: Schedule builder (recurrence and timing editors)

**Files:**
- Create: `apps/web/src/features/scheduling/schedule-builder.tsx`
- Test: `apps/web/src/features/scheduling/schedule-builder.test.tsx`

**Interfaces:**
- Consumes: `Recurrence`, `RecurrenceKind`, `RECURRENCE_KINDS`, `Timing`, `ShiftDto`, `isoWeekday`, `SCHEDULING_LIMITS`.
- Produces:
  - `defaultRecurrence(kind, today): Recurrence`
  - `defaultTiming(mode, shifts): Timing`
  - `<RecurrenceEditor value onChange today disabled? />`
  - `<TimingEditor value onChange shifts disabled? />`
  - Both editors are controlled. Labels come from `scheduling.builder.*`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/scheduling/schedule-builder.test.tsx`:

```tsx
import type { Recurrence, ShiftDto, Timing } from '@taskop/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultRecurrence, defaultTiming, RecurrenceEditor, TimingEditor } from './schedule-builder';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));

const json = () => JSON.parse(screen.getByTestId('json').textContent!);

function RecurrenceHarness({ initial }: { initial: Recurrence }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <RecurrenceEditor value={v} onChange={setV} today="2026-11-04" />
      <output data-testid="json">{JSON.stringify(v)}</output>
    </>
  );
}

const shifts: ShiftDto[] = [{ id: 's1', name: 'Səhər', startTime: '08:00', endTime: '16:00', siteId: null, siteName: null, active: true }];
function TimingHarness({ initial }: { initial: Timing }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <TimingEditor value={v} onChange={setV} shifts={shifts} />
      <output data-testid="json">{JSON.stringify(v)}</output>
    </>
  );
}

describe('RecurrenceEditor', () => {
  it('switches kinds with sensible defaults and keeps at least one weekday', async () => {
    render(<RecurrenceHarness initial={defaultRecurrence('daily', '2026-11-04')} />);
    await userEvent.selectOptions(screen.getByLabelText('Təkrarlanma'), 'weekly');
    expect(json()).toEqual({ kind: 'weekly', every: 1, weekdays: [3], startDate: '2026-11-04', endDate: null, skipDates: [] });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Cümə' }));
    expect(json().weekdays).toEqual([3, 5]);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Çərşənbə' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Cümə' }));
    expect(json().weekdays).toEqual([5]);
    fireEvent.change(screen.getByLabelText('Neçə həftədən bir'), { target: { value: '2' } });
    expect(json().every).toBe(2);
  });

  it('edits monthly rules, the end date and skip dates', async () => {
    render(<RecurrenceHarness initial={defaultRecurrence('daily', '2026-11-04')} />);
    await userEvent.selectOptions(screen.getByLabelText('Təkrarlanma'), 'monthly');
    expect(json().by).toEqual({ dayOfMonth: 4 });
    await userEvent.click(screen.getByRole('radio', { name: 'Həftə günü' }));
    expect(json().by).toEqual({ nth: 1, weekday: 3 });
    await userEvent.selectOptions(screen.getByLabelText('Hansı'), '-1');
    expect(json().by).toEqual({ nth: -1, weekday: 3 });
    fireEvent.change(screen.getByLabelText('Bitmə tarixi (istəyə bağlı)'), { target: { value: '2027-03-31' } });
    expect(json().endDate).toBe('2027-03-31');
    fireEvent.change(screen.getByLabelText('İstisna tarixləri'), { target: { value: '2026-12-31' } });
    await userEvent.click(screen.getByRole('button', { name: 'Tarix əlavə et' }));
    expect(json().skipDates).toEqual(['2026-12-31']);
    await userEvent.click(screen.getByRole('button', { name: 'Sil 2026-12-31' }));
    expect(json().skipDates).toEqual([]);
  });

  it('edits one-off and explicit dates', async () => {
    render(<RecurrenceHarness initial={defaultRecurrence('dates', '2026-11-04')} />);
    fireEvent.change(screen.getByLabelText('Tarixlər'), { target: { value: '2026-11-20' } });
    await userEvent.click(screen.getByRole('button', { name: 'Tarix əlavə et' }));
    expect(json().dates).toEqual(['2026-11-04', '2026-11-20']);
    // The last date cannot be removed (a rule needs at least one).
    await userEvent.click(screen.getByRole('button', { name: 'Sil 2026-11-04' }));
    expect(screen.queryByRole('button', { name: 'Sil 2026-11-20' })).toBeDisabled();
  });
});

describe('TimingEditor', () => {
  it('switches between fixed and shift timing', async () => {
    render(<TimingHarness initial={defaultTiming('fixed', [])} />);
    expect(json()).toEqual({ mode: 'fixed', startTime: '08:00', dueAfterMinutes: 120, graceMinutes: 60 });
    fireEvent.change(screen.getByLabelText('Başlama vaxtı'), { target: { value: '09:30' } });
    fireEvent.change(screen.getByLabelText('İcra müddəti (dəqiqə)'), { target: { value: '90' } });
    expect(json()).toMatchObject({ startTime: '09:30', dueAfterMinutes: 90 });
    await userEvent.selectOptions(screen.getByLabelText('Vaxt növü'), 'shift');
    expect(json()).toEqual({ mode: 'shift', shiftId: 's1', graceMinutes: 0 });
    fireEvent.change(screen.getByLabelText('Gecikmə icazəsi (dəqiqə)'), { target: { value: '30' } });
    expect(json().graceMinutes).toBe(30);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/web test -- schedule-builder`
Expected: FAIL: the module does not exist.

- [ ] **Step 3: Implement**

`apps/web/src/features/scheduling/schedule-builder.tsx`:

```tsx
import { isoWeekday, type Recurrence, RECURRENCE_KINDS, type RecurrenceKind, SCHEDULING_LIMITS, type ShiftDto, type Timing } from '@taskop/contracts';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatLocalDate } from './labels';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const NTHS = [1, 2, 3, 4, -1] as const;

export function defaultRecurrence(kind: RecurrenceKind, today: string): Recurrence {
  const range = { startDate: today, endDate: null, skipDates: [] as string[] };
  switch (kind) {
    case 'once':
      return { kind, date: today };
    case 'daily':
      return { kind, every: 1, ...range };
    case 'weekly':
      return { kind, every: 1, weekdays: [isoWeekday(today)], ...range };
    case 'monthly':
      return { kind, every: 1, by: { dayOfMonth: Number(today.slice(8, 10)) }, ...range };
    case 'dates':
      return { kind, dates: [today] };
  }
}

export function defaultTiming(mode: Timing['mode'], shifts: ShiftDto[]): Timing {
  return mode === 'fixed'
    ? { mode, startTime: '08:00', dueAfterMinutes: 120, graceMinutes: 60 }
    : { mode, shiftId: shifts.find((s) => s.active)?.id ?? '', graceMinutes: 0 };
}

function NumberField({ id, label, value, min, max, onChange }: { id: string; label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isInteger(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
      />
    </div>
  );
}

function DateField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** A list of dates with an "add" input. `min` dates can never be removed. */
function DateList({ id, label, values, min, onChange }: { id: string; label: string; values: string[]; min: number; onChange: (v: string[]) => void }) {
  const { t } = useTranslation();
  const [next, setNext] = useState('');
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <ul className="flex flex-wrap gap-2">
        {values.map((d) => (
          <li key={d} className="flex items-center gap-1 rounded border px-2 py-0.5 text-sm">
            {formatLocalDate(d)}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`${t('scheduling.builder.remove')} ${d}`}
              disabled={values.length <= min}
              onClick={() => onChange(values.filter((x) => x !== d))}
            >
              ×
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input id={id} type="date" value={next} onChange={(e) => setNext(e.target.value)} className="w-48" />
        <Button
          type="button"
          variant="outline"
          disabled={!next}
          onClick={() => {
            if (next && !values.includes(next)) onChange([...values, next].sort());
            setNext('');
          }}
        >
          {t('scheduling.builder.addDate')}
        </Button>
      </div>
    </div>
  );
}

interface RecurrenceEditorProps {
  value: Recurrence;
  onChange: (r: Recurrence) => void;
  today: string;
  disabled?: boolean;
}

export function RecurrenceEditor({ value, onChange, today, disabled }: RecurrenceEditorProps) {
  const { t } = useTranslation();
  const id = useId();
  const everyLabel = { daily: 'everyDays', weekly: 'everyWeeks', monthly: 'everyMonths' } as const;
  const maxEvery = { daily: 365, weekly: 52, monthly: 12 } as const;
  return (
    <fieldset className="grid gap-3" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium">{t('scheduling.assignments.schedule')}</legend>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-kind`}>{t('scheduling.builder.kind')}</Label>
        <NativeSelect id={`${id}-kind`} value={value.kind} onChange={(e) => onChange(defaultRecurrence(e.target.value as RecurrenceKind, today))}>
          {RECURRENCE_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`scheduling.builder.kinds.${k}`)}
            </option>
          ))}
        </NativeSelect>
      </div>

      {value.kind === 'once' && <DateField id={`${id}-date`} label={t('scheduling.builder.date')} value={value.date} onChange={(date) => onChange({ ...value, date })} />}
      {value.kind === 'dates' && (
        <DateList id={`${id}-dates`} label={t('scheduling.builder.dates')} values={value.dates} min={1} onChange={(dates) => onChange({ ...value, dates })} />
      )}

      {(value.kind === 'daily' || value.kind === 'weekly' || value.kind === 'monthly') && (
        <>
          <NumberField
            id={`${id}-every`}
            label={t(`scheduling.builder.${everyLabel[value.kind]}`)}
            value={value.every}
            min={1}
            max={maxEvery[value.kind]}
            onChange={(every) => onChange({ ...value, every })}
          />
          {value.kind === 'weekly' && (
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">{t('scheduling.builder.weekdays')}</legend>
              <div className="flex flex-wrap gap-3">
                {WEEKDAYS.map((d) => (
                  <div key={d} className="flex items-center gap-1.5">
                    <Checkbox
                      id={`${id}-wd-${d}`}
                      checked={value.weekdays.includes(d)}
                      onCheckedChange={(c) => {
                        const set = new Set(value.weekdays);
                        if (c === true) set.add(d);
                        else if (set.size > 1) set.delete(d);
                        onChange({ ...value, weekdays: [...set].sort((a, b) => a - b) });
                      }}
                    />
                    <Label htmlFor={`${id}-wd-${d}`} className="font-normal">
                      {t(`scheduling.weekdays.${d}`)}
                    </Label>
                  </div>
                ))}
              </div>
            </fieldset>
          )}
          {value.kind === 'monthly' && (
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">{t('scheduling.builder.monthlyBy')}</legend>
              <div className="flex gap-4">
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name={`${id}-by`}
                    checked={'dayOfMonth' in value.by}
                    onChange={() => onChange({ ...value, by: { dayOfMonth: Number(value.startDate.slice(8, 10)) } })}
                  />
                  {t('scheduling.builder.byDay')}
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="radio" name={`${id}-by`} checked={'nth' in value.by} onChange={() => onChange({ ...value, by: { nth: 1, weekday: isoWeekday(value.startDate) } })} />
                  {t('scheduling.builder.byWeekday')}
                </label>
              </div>
              {'dayOfMonth' in value.by ? (
                <NumberField id={`${id}-dom`} label={t('scheduling.builder.dayOfMonth')} value={value.by.dayOfMonth} min={1} max={31} onChange={(dayOfMonth) => onChange({ ...value, by: { dayOfMonth } })} />
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${id}-nth`}>{t('scheduling.builder.nth')}</Label>
                    <NativeSelect
                      id={`${id}-nth`}
                      value={String(value.by.nth)}
                      onChange={(e) => 'nth' in value.by && onChange({ ...value, by: { ...value.by, nth: Number(e.target.value) as (typeof NTHS)[number] } })}
                    >
                      {NTHS.map((n) => (
                        <option key={n} value={n}>
                          {t(`scheduling.nth.${n === -1 ? 'last' : n}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${id}-wd`}>{t('scheduling.builder.weekday')}</Label>
                    <NativeSelect
                      id={`${id}-wd`}
                      value={String(value.by.weekday)}
                      onChange={(e) => 'nth' in value.by && onChange({ ...value, by: { ...value.by, weekday: Number(e.target.value) } })}
                    >
                      {WEEKDAYS.map((d) => (
                        <option key={d} value={d}>
                          {t(`scheduling.weekdays.${d}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                </div>
              )}
            </fieldset>
          )}
          <div className="grid grid-cols-2 gap-3">
            <DateField id={`${id}-start`} label={t('scheduling.builder.startDate')} value={value.startDate} onChange={(startDate) => startDate && onChange({ ...value, startDate })} />
            <DateField id={`${id}-end`} label={t('scheduling.builder.endDate')} value={value.endDate ?? ''} onChange={(end) => onChange({ ...value, endDate: end || null })} />
          </div>
          <DateList id={`${id}-skip`} label={t('scheduling.builder.skipDates')} values={value.skipDates} min={0} onChange={(skipDates) => onChange({ ...value, skipDates })} />
        </>
      )}
    </fieldset>
  );
}

interface TimingEditorProps {
  value: Timing;
  onChange: (t: Timing) => void;
  shifts: ShiftDto[];
  disabled?: boolean;
}

export function TimingEditor({ value, onChange, shifts, disabled }: TimingEditorProps) {
  const { t } = useTranslation();
  const id = useId();
  const max = SCHEDULING_LIMITS.maxExtendedWindowMinutes;
  return (
    <fieldset className="grid gap-3" disabled={disabled}>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-mode`}>{t('scheduling.builder.mode')}</Label>
        <NativeSelect id={`${id}-mode`} value={value.mode} onChange={(e) => onChange(defaultTiming(e.target.value as Timing['mode'], shifts))}>
          <option value="fixed">{t('scheduling.builder.modes.fixed')}</option>
          <option value="shift">{t('scheduling.builder.modes.shift')}</option>
        </NativeSelect>
      </div>
      {value.mode === 'fixed' ? (
        <div className="grid grid-cols-3 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-start`}>{t('scheduling.builder.startTime')}</Label>
            <Input id={`${id}-start`} type="time" value={value.startTime} onChange={(e) => e.target.value && onChange({ ...value, startTime: e.target.value })} />
          </div>
          <NumberField id={`${id}-due`} label={t('scheduling.builder.dueAfter')} value={value.dueAfterMinutes} min={1} max={max} onChange={(dueAfterMinutes) => onChange({ ...value, dueAfterMinutes })} />
          <NumberField id={`${id}-grace`} label={t('scheduling.builder.grace')} value={value.graceMinutes} min={0} max={max} onChange={(graceMinutes) => onChange({ ...value, graceMinutes })} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-shift`}>{t('scheduling.builder.shift')}</Label>
            <NativeSelect id={`${id}-shift`} value={value.shiftId} onChange={(e) => onChange({ ...value, shiftId: e.target.value })}>
              <option value="">{t('scheduling.builder.chooseShift')}</option>
              {shifts
                .filter((s) => s.active)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.startTime}–{s.endTime})
                  </option>
                ))}
            </NativeSelect>
          </div>
          <NumberField id={`${id}-grace`} label={t('scheduling.builder.grace')} value={value.graceMinutes} min={0} max={max} onChange={(graceMinutes) => onChange({ ...value, graceMinutes })} />
        </div>
      )}
    </fieldset>
  );
}
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- schedule-builder && pnpm --filter @taskop/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/scheduling/schedule-builder.tsx apps/web/src/features/scheduling/schedule-builder.test.tsx
git commit -m "feat(web): add recurrence and timing editors"
```

---

### Task 7: Assignment editor with live preview

**Files:**
- Create: `apps/web/src/features/scheduling/assignment-editor.tsx`
- Test: `apps/web/src/features/scheduling/assignment-editor.test.tsx`

**Interfaces:**
- Consumes:
  - Task 6 editors; `useAssignableChecklists`, `useSites`, `useSiteUsers` and `useShifts`
  - `api.assignments.create`, `update` and `preview`; `useDebounced`, `useTimeFormat`, `scheduleSummary` and `formatLocalDate`
  - `ApiError.issues` and `ApiError.userIds`
- Produces: `<AssignmentEditor initial? preset? today? onSaved onCancel />`
  - `initial: AssignmentDetail` switches it to edit mode: checklist and site become read-only.
  - `preset: { checklistId?, copyFrom?: AssignmentDetail }`. A copy keeps the checklist, name, schedule and timing, and clears the site and assignees.
  - `onSaved(a: AssignmentDetail)` is called after a successful create or update.

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/scheduling/assignment-editor.test.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import type { AssignmentDetail } from '@taskop/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { AssignmentEditor } from './assignment-editor';

const mocks = vi.hoisted(() => ({
  api: {
    checklists: { list: vi.fn() },
    sites: { list: vi.fn() },
    users: { list: vi.fn() },
    shifts: { list: vi.fn() },
    assignments: { create: vi.fn(), update: vi.fn(), preview: vi.fn() },
  },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useCan: () => true,
  useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }),
}));

const SCHEDULE = { kind: 'daily', every: 1, startDate: '2026-11-02', endDate: null, skipDates: [] };
const TIMING = { mode: 'fixed', startTime: '08:00', dueAfterMinutes: 120, graceMinutes: 60 };
const detail = (over: Partial<AssignmentDetail> = {}) =>
  ({
    id: 'a1', name: 'Səhər', checklistId: 'c1', checklistName: 'Açılış', siteId: 'site1', siteName: 'Anbar', schedule: SCHEDULE, timing: TIMING,
    shiftName: null, status: 'active', revision: 3, assignees: [{ id: 'u1', fullName: 'Elvin' }], createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z', upcoming: [], ...over,
  }) as AssignmentDetail;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.api.checklists.list.mockResolvedValue({
    items: [
      { id: 'c1', name: 'Açılış', currentVersionNumber: 1 },
      { id: 'c2', name: 'Qaralama', currentVersionNumber: null },
    ],
    nextCursor: null,
  });
  mocks.api.sites.list.mockResolvedValue([
    { id: 'site1', name: 'Anbar', active: true },
    { id: 'site2', name: 'Ofis', active: true },
  ]);
  mocks.api.users.list.mockResolvedValue({ items: [{ id: 'u1', fullName: 'Elvin' }], nextCursor: null });
  mocks.api.shifts.list.mockResolvedValue([]);
  mocks.api.assignments.preview.mockResolvedValue({
    slots: [{ localDate: '2026-11-02', startsAt: '2026-11-02T04:00:00.000Z', dueAt: '2026-11-02T06:00:00.000Z', closesAt: '2026-11-02T07:00:00.000Z' }],
    warnings: [],
  });
});

async function fillBasics() {
  await userEvent.selectOptions(await screen.findByLabelText('Yoxlama vərəqəsi'), 'c1');
  await userEvent.selectOptions(await screen.findByLabelText('Obyekt'), 'site1');
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Elvin' }));
}

describe('AssignmentEditor', () => {
  it('creates an assignment with a live preview', async () => {
    const onSaved = vi.fn();
    mocks.api.assignments.create.mockResolvedValue(detail());
    renderWithProviders(<AssignmentEditor today="2026-11-02" onSaved={onSaved} onCancel={vi.fn()} />);
    expect(await screen.findByRole('option', { name: 'Açılış' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Qaralama' })).not.toBeInTheDocument();
    await fillBasics();
    expect(screen.getByText('Hər gün, 08:00–10:00')).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.api.assignments.preview).toHaveBeenLastCalledWith({ siteId: 'site1', schedule: SCHEDULE, timing: TIMING, assigneeIds: ['u1'] }),
    );
    expect(await screen.findByText(/08:00–10:00$/, { selector: 'li' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yadda saxla' }));
    await waitFor(() =>
      expect(mocks.api.assignments.create).toHaveBeenCalledWith({ name: null, checklistId: 'c1', siteId: 'site1', assigneeIds: ['u1'], schedule: SCHEDULE, timing: TIMING }),
    );
    expect(onSaved).toHaveBeenCalledWith(detail());
  });

  it('clears assignees when the site changes', async () => {
    renderWithProviders(<AssignmentEditor today="2026-11-02" onSaved={vi.fn()} onCancel={vi.fn()} />);
    await fillBasics();
    expect(screen.getByRole('button', { name: 'Yadda saxla' })).toBeEnabled();
    await userEvent.selectOptions(screen.getByLabelText('Obyekt'), 'site2');
    expect(await screen.findByRole('checkbox', { name: 'Elvin' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Yadda saxla' })).toBeDisabled();
  });

  it('names the users an error is about', async () => {
    mocks.api.assignments.create.mockRejectedValue(
      new ApiError(422, 'ASSIGNEE_NOT_AT_SITE', 'errors.ASSIGNEE_NOT_AT_SITE', null, null, 'r1', null, null, ['u1']),
    );
    renderWithProviders(<AssignmentEditor today="2026-11-02" onSaved={vi.fn()} onCancel={vi.fn()} />);
    await fillBasics();
    await userEvent.click(screen.getByRole('button', { name: 'Yadda saxla' }));
    expect(await screen.findByText('Seçilmiş icraçılardan biri bu obyektə aid deyil. (Elvin)')).toBeInTheDocument();
  });

  it('shows schedule issues and preview errors', async () => {
    mocks.api.assignments.preview.mockRejectedValue(new ApiError(422, 'WINDOW_TOO_LONG', 'errors.WINDOW_TOO_LONG'));
    mocks.api.assignments.create.mockRejectedValue(
      new ApiError(422, 'SCHEDULE_INVALID', 'errors.SCHEDULE_INVALID', null, null, 'r1', [{ path: ['schedule', 'endDate'], code: 'scheduling.issues.endBeforeStart' }]),
    );
    renderWithProviders(<AssignmentEditor today="2026-11-02" onSaved={vi.fn()} onCancel={vi.fn()} />);
    await fillBasics();
    expect(await screen.findByText('İcra müddəti 24 saatdan uzundur. Bunun üçün xüsusi icazə lazımdır.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yadda saxla' }));
    expect(await screen.findByText('Bitmə tarixi başlama tarixindən əvvəl ola bilməz.')).toBeInTheDocument();
  });

  it('edits with the checklist and site locked, sending the revision', async () => {
    mocks.api.assignments.update.mockResolvedValue(detail({ revision: 4 }));
    renderWithProviders(<AssignmentEditor initial={detail()} today="2026-11-02" onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(await screen.findByLabelText('Yoxlama vərəqəsi')).toBeDisabled();
    expect(screen.getByLabelText('Obyekt')).toBeDisabled();
    const name = screen.getByLabelText('Ad (istəyə bağlı)');
    await userEvent.clear(name);
    await userEvent.type(name, 'Axşam');
    await userEvent.click(screen.getByRole('button', { name: 'Yadda saxla' }));
    await waitFor(() =>
      expect(mocks.api.assignments.update).toHaveBeenCalledWith('a1', { revision: 3, name: 'Axşam', assigneeIds: ['u1'], schedule: SCHEDULE, timing: TIMING }),
    );
  });

  it('copies to another site without the old site and assignees', async () => {
    renderWithProviders(<AssignmentEditor preset={{ copyFrom: detail() }} today="2026-11-02" onSaved={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Yoxlama vərəqəsi')).toHaveValue('c1'));
    expect(screen.getByLabelText('Obyekt')).toHaveValue('');
    expect(screen.getByLabelText('Ad (istəyə bağlı)')).toHaveValue('Səhər');
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/web test -- assignment-editor`
Expected: FAIL: the module does not exist.

- [ ] **Step 3: Implement**

`apps/web/src/features/scheduling/assignment-editor.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import type { AssignmentDetail, PreviewAssignmentInput, Recurrence, Timing } from '@taskop/contracts';
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckboxList } from '@/components/checkbox-list';
import { FormError } from '@/components/form-error';
import { NativeSelect } from '@/components/native-select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSites } from '@/features/sites/queries';
import { errorText } from '@/lib/errors';
import { api } from '@/lib/session';
import { formatLocalDate, scheduleSummary, useDebounced, useTenantToday, useTimeFormat } from './labels';
import { useAssignableChecklists, useShifts, useSiteUsers } from './queries';
import { defaultRecurrence, defaultTiming, RecurrenceEditor, TimingEditor } from './schedule-builder';

export interface AssignmentEditorProps {
  initial?: AssignmentDetail;
  preset?: { checklistId?: string; copyFrom?: AssignmentDetail };
  /** For tests; defaults to today in the tenant timezone. */
  today?: string;
  onSaved: (a: AssignmentDetail) => void;
  onCancel: () => void;
}

/** Turns API errors into one line: schedule issues by text, user errors with the people's names. */
function describeError(t: TFunction, e: unknown, people: { id: string; fullName: string }[]): string {
  if (e instanceof ApiError && e.issues?.length) return e.issues.map((i) => t(i.code)).join(' ');
  if (e instanceof ApiError && e.userIds?.length) {
    const names = e.userIds.map((id) => people.find((p) => p.id === id)?.fullName ?? id).join(', ');
    return `${errorText(t, e)} (${names})`;
  }
  return errorText(t, e);
}

export function AssignmentEditor({ initial, preset, today: todayProp, onSaved, onCancel }: AssignmentEditorProps) {
  const { t } = useTranslation();
  const tenantToday = useTenantToday();
  const today = todayProp ?? tenantToday;
  const time = useTimeFormat();
  const source = initial ?? preset?.copyFrom;
  const [name, setName] = useState(source?.name ?? '');
  const [checklistId, setChecklistId] = useState(source?.checklistId ?? preset?.checklistId ?? '');
  const [siteId, setSiteId] = useState(initial?.siteId ?? '');
  const [assigneeIds, setAssigneeIds] = useState<string[]>(initial?.assignees.map((u) => u.id) ?? []);
  const [schedule, setSchedule] = useState<Recurrence>(source?.schedule ?? defaultRecurrence('daily', today));
  const [timing, setTiming] = useState<Timing>(source?.timing ?? defaultTiming('fixed', []));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const checklists = useAssignableChecklists();
  const sites = useSites();
  const users = useSiteUsers(siteId || null);
  const shifts = useShifts(siteId || null);
  const people = users.data ?? [];
  const shiftMissing = timing.mode === 'shift' && !timing.shiftId;
  const shiftName = timing.mode === 'shift' ? (shifts.data?.find((s) => s.id === timing.shiftId)?.name ?? null) : null;

  // Memoised so the debounce only restarts when the input really changes.
  const liveInput = useMemo<PreviewAssignmentInput | null>(
    () => (siteId && !shiftMissing ? { siteId, schedule, timing, assigneeIds } : null),
    [siteId, shiftMissing, schedule, timing, assigneeIds],
  );
  const previewInput = useDebounced(liveInput);
  const preview = useQuery({
    queryKey: ['assignments', 'preview', previewInput],
    queryFn: () => api.assignments.preview(previewInput!),
    enabled: previewInput !== null,
    retry: false,
  });

  const changeSite = (id: string) => {
    setSiteId(id);
    setAssigneeIds([]);
    if (timing.mode === 'shift') setTiming(defaultTiming('fixed', []));
  };

  const canSave = Boolean(checklistId && siteId && assigneeIds.length > 0 && !shiftMissing) && !saving;
  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const result = initial
        ? await api.assignments.update(initial.id, { revision: initial.revision, name: name.trim() || null, assigneeIds, schedule, timing })
        : await api.assignments.create({ name: name.trim() || null, checklistId, siteId, assigneeIds, schedule, timing });
      onSaved(result);
    } catch (e) {
      setError(describeError(t, e, people));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid content-start gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="assignment-name">{t('scheduling.assignments.name')}</Label>
          <Input id="assignment-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="assignment-checklist">{t('scheduling.assignments.checklist')}</Label>
          <NativeSelect id="assignment-checklist" value={checklistId} disabled={Boolean(initial)} onChange={(e) => setChecklistId(e.target.value)}>
            <option value="">{t('scheduling.assignments.chooseChecklist')}</option>
            {initial && <option value={initial.checklistId}>{initial.checklistName}</option>}
            {(checklists.data ?? [])
              .filter((c) => c.id !== initial?.checklistId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="assignment-site">{t('scheduling.assignments.site')}</Label>
          <NativeSelect id="assignment-site" value={siteId} disabled={Boolean(initial)} onChange={(e) => changeSite(e.target.value)}>
            <option value="">{t('scheduling.assignments.chooseSite')}</option>
            {(sites.data ?? [])
              .filter((s) => s.active || s.id === initial?.siteId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </NativeSelect>
        </div>
        {siteId && (
          <CheckboxList
            label={t('scheduling.assignments.assignees')}
            options={people.map((u) => ({ value: u.id, label: u.fullName }))}
            value={assigneeIds}
            onChange={setAssigneeIds}
          />
        )}
        <RecurrenceEditor value={schedule} onChange={setSchedule} today={today} />
        <TimingEditor value={timing} onChange={setTiming} shifts={shifts.data ?? []} />
        <FormError message={error} />
        <div className="flex gap-2">
          <Button onClick={() => void save()} disabled={!canSave}>
            {t('common.save')}
          </Button>
          <Button variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
      <aside aria-label={t('scheduling.assignments.preview')} className="grid content-start gap-2 rounded-md border p-4">
        <h2 className="font-semibold">{t('scheduling.assignments.preview')}</h2>
        <p className="text-sm">{scheduleSummary(t, schedule, timing, shiftName)}</p>
        {preview.error && <p className="text-destructive text-sm">{errorText(t, preview.error)}</p>}
        {preview.data?.warnings.map((w) => (
          <Alert key={w}>
            <AlertDescription>{t(`scheduling.warnings.${w}`)}</AlertDescription>
          </Alert>
        ))}
        {preview.data && preview.data.slots.length === 0 && <p className="text-muted-foreground text-sm">{t('scheduling.assignments.previewEmpty')}</p>}
        <ol className="grid gap-1 text-sm">
          {preview.data?.slots.map((s) => (
            <li key={s.startsAt}>
              {formatLocalDate(s.localDate)} · {time(s.startsAt)}–{time(s.dueAt)}
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- assignment-editor && pnpm --filter @taskop/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/scheduling/assignment-editor.tsx apps/web/src/features/scheduling/assignment-editor.test.tsx
git commit -m "feat(web): add the assignment editor with live slot preview"
```

---
### Task 8: Assignment list, new-assignment and assignment pages

**Files:**
- Create: `apps/web/src/features/scheduling/assignment-pages.tsx`, `apps/web/src/features/scheduling/routes.tsx`
- Modify: `apps/web/src/router.tsx`
- Test: `apps/web/src/features/scheduling/assignment-pages.test.tsx`

**Interfaces:**
- Consumes:
  - `AssignmentEditor` (Task 7)
  - `useAssignments`, `useAssignment`, `useSites`
  - `api.assignments.pause`, `resume` and `end`
  - `scheduleSummary`, `assignmentVariant`, `occurrenceVariant`, `formatLocalDate`, `useTimeFormat`
  - `renderWithRouter`
- Produces:
  - `AssignmentsPage` at `/assignments`
  - `NewAssignmentPage({ checklistId?, copyFrom? })` at `/assignments/new?checklistId&copyFrom`
  - `AssignmentDetailPage({ assignmentId })` at `/assignments/$assignmentId`. It shows the header actions (pause, resume, end, copy to other sites), the "Yaxın icralar" list and the editor in edit mode.
  - Route wrappers `NewAssignmentRoute` and `AssignmentDetailRoute`

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/scheduling/assignment-pages.test.tsx`:

```tsx
import type { AssignmentDetail } from '@taskop/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '@/test/router';
import { AssignmentDetailPage, AssignmentsPage, NewAssignmentPage } from './assignment-pages';

const mocks = vi.hoisted(() => ({
  api: {
    assignments: { list: vi.fn(), get: vi.fn(), pause: vi.fn(), resume: vi.fn(), end: vi.fn(), preview: vi.fn(), update: vi.fn(), create: vi.fn() },
    checklists: { list: vi.fn() },
    sites: { list: vi.fn() },
    users: { list: vi.fn() },
    shifts: { list: vi.fn() },
  },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useCan: () => true,
  useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }),
}));

const detail = (over: Partial<AssignmentDetail> = {}) =>
  ({
    id: 'a1', name: 'Səhər', checklistId: 'c1', checklistName: 'Açılış', siteId: 'site1', siteName: 'Anbar',
    schedule: { kind: 'daily', every: 1, startDate: '2026-11-02', endDate: null, skipDates: [] },
    timing: { mode: 'fixed', startTime: '08:00', dueAfterMinutes: 120, graceMinutes: 60 },
    shiftName: null, status: 'active', revision: 1, assignees: [{ id: 'u1', fullName: 'Elvin' }],
    createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
    upcoming: [
      { id: 'o1', assignmentId: 'a1', assignmentName: 'Səhər', checklistId: 'c1', checklistName: 'Açılış', siteId: 'site1', siteName: 'Anbar', shiftId: null, shiftName: null,
        localDate: '2026-11-02', startsAt: '2026-11-02T04:00:00.000Z', dueAt: '2026-11-02T06:00:00.000Z', closesAt: '2026-11-02T07:00:00.000Z', status: 'pending',
        statusChangedAt: '2026-11-02T04:00:00.000Z', cancelReason: null, assigneeIds: ['u1'], unassigned: false },
    ],
    ...over,
  }) as AssignmentDetail;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.api.assignments.list.mockResolvedValue({ items: [detail()], nextCursor: null });
  mocks.api.assignments.get.mockResolvedValue(detail());
  mocks.api.assignments.preview.mockResolvedValue({ slots: [], warnings: [] });
  mocks.api.checklists.list.mockResolvedValue({ items: [{ id: 'c1', name: 'Açılış', currentVersionNumber: 1 }], nextCursor: null });
  mocks.api.sites.list.mockResolvedValue([{ id: 'site1', name: 'Anbar', active: true }]);
  mocks.api.users.list.mockResolvedValue({ items: [{ id: 'u1', fullName: 'Elvin' }], nextCursor: null });
  mocks.api.shifts.list.mockResolvedValue([]);
});

describe('AssignmentsPage', () => {
  it('lists assignments with their summary and filters by search', async () => {
    renderWithRouter(<AssignmentsPage />);
    expect(await screen.findByRole('link', { name: 'Səhər' })).toHaveAttribute('href', '/assignments/a1');
    const table = screen.getByRole('table');
    expect(within(table).getByText('Hər gün, 08:00–10:00')).toBeInTheDocument();
    expect(within(table).getByText('1 icraçı')).toBeInTheDocument();
    expect(within(table).getByText('Aktiv')).toBeInTheDocument();
    expect(mocks.api.assignments.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'active', limit: 200 }));
    await userEvent.type(screen.getByRole('searchbox'), 'səh');
    await waitFor(() => expect(mocks.api.assignments.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'səh' })));
  });
});

describe('AssignmentDetailPage', () => {
  it('shows upcoming occurrences and pauses, ends and copies the assignment', async () => {
    mocks.api.assignments.pause.mockResolvedValue(detail({ status: 'paused' }));
    mocks.api.assignments.end.mockResolvedValue(detail({ status: 'ended' }));
    const router = renderWithRouter(<AssignmentDetailPage assignmentId="a1" />, '/assignments/a1');
    expect(await screen.findByRole('heading', { name: 'Səhər' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Yaxın icralar' })).getAllByRole('listitem')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Dayandır' }));
    await waitFor(() => expect(mocks.api.assignments.pause).toHaveBeenCalledWith('a1'));
    await userEvent.click(screen.getByRole('button', { name: 'Bitir' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Təsdiqlə' }));
    await waitFor(() => expect(mocks.api.assignments.end).toHaveBeenCalledWith('a1'));
    await userEvent.click(screen.getByRole('button', { name: 'Digər obyektlərə köçür' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/assignments/new'));
    expect(router.state.location.search).toMatchObject({ copyFrom: 'a1' });
  });
});

describe('NewAssignmentPage', () => {
  it('preselects the checklist from the link', async () => {
    renderWithRouter(<NewAssignmentPage checklistId="c1" />, '/assignments/new');
    await waitFor(() => expect(screen.getByLabelText('Yoxlama vərəqəsi')).toHaveValue('c1'));
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/web test -- assignment-pages`
Expected: FAIL: the module does not exist.

- [ ] **Step 3: Implement**

`apps/web/src/features/scheduling/assignment-pages.tsx`:

```tsx
import { ASSIGNMENT_STATUSES, type AssignmentStatus } from '@taskop/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/confirm-button';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSites } from '@/features/sites/queries';
import { errorText } from '@/lib/errors';
import { api, useCan } from '@/lib/session';
import { AssignmentEditor } from './assignment-editor';
import { assignmentVariant, formatLocalDate, occurrenceVariant, scheduleSummary, useTimeFormat } from './labels';
import { useAssignment, useAssignments } from './queries';

export function AssignmentsPage() {
  const { t } = useTranslation();
  const canManage = useCan('assignments.manage');
  const sites = useSites();
  const [siteId, setSiteId] = useState('');
  const [status, setStatus] = useState<AssignmentStatus | ''>('active');
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const list = useAssignments({ siteId: siteId || undefined, status: status || undefined, q: q || undefined });
  const items = list.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title={t('scheduling.assignments.title')}
        actions={
          canManage && (
            <Link to="/assignments/new" className={buttonVariants()}>
              {t('scheduling.assignments.add')}
            </Link>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input type="search" aria-label={t('common.search')} placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
        <NativeSelect aria-label={t('scheduling.assignments.site')} value={siteId} onChange={(e) => setSiteId(e.target.value)} className="w-56">
          <option value="">{t('scheduling.assignments.allSites')}</option>
          {(sites.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label={t('common.status')} value={status} onChange={(e) => setStatus(e.target.value as AssignmentStatus | '')} className="w-48">
          <option value="">{t('scheduling.assignments.allStatuses')}</option>
          {ASSIGNMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`scheduling.assignments.status.${s}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('common.name')}</TableHead>
            <TableHead>{t('scheduling.assignments.site')}</TableHead>
            <TableHead>{t('scheduling.assignments.schedule')}</TableHead>
            <TableHead>{t('scheduling.assignments.assignees')}</TableHead>
            <TableHead>{t('common.status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((a) => (
            <TableRow key={a.id}>
              <TableCell>
                <Link to="/assignments/$assignmentId" params={{ assignmentId: a.id }} className="font-medium hover:underline">
                  {a.name ?? a.checklistName}
                </Link>
                {a.name && <div className="text-muted-foreground text-xs">{a.checklistName}</div>}
              </TableCell>
              <TableCell>{a.siteName}</TableCell>
              <TableCell>{scheduleSummary(t, a.schedule, a.timing, a.shiftName)}</TableCell>
              <TableCell>{t('scheduling.assignments.assigneeCount', { count: a.assignees.length })}</TableCell>
              <TableCell>
                <Badge variant={assignmentVariant(a.status)}>{t(`scheduling.assignments.status.${a.status}`)}</Badge>
              </TableCell>
            </TableRow>
          ))}
          {list.isSuccess && items.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground text-center">
                {t('scheduling.assignments.empty')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function NewAssignmentPage({ checklistId, copyFrom }: { checklistId?: string; copyFrom?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const source = useAssignment(copyFrom);
  if (copyFrom && source.isPending) return <p className="text-muted-foreground">{t('common.loading')}</p>;
  return (
    <div>
      <PageHeader title={t('scheduling.assignments.createTitle')} />
      <AssignmentEditor
        preset={{ checklistId, copyFrom: source.data }}
        onSaved={(a) => void navigate({ to: '/assignments/$assignmentId', params: { assignmentId: a.id } })}
        onCancel={() => void navigate({ to: '/assignments' })}
      />
    </div>
  );
}

export function AssignmentDetailPage({ assignmentId }: { assignmentId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canManage = useCan('assignments.manage');
  const time = useTimeFormat();
  const detail = useAssignment(assignmentId);
  const refresh = () => qc.invalidateQueries({ queryKey: ['assignments'] });
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
  const a = detail.data;
  const title = a.name ?? a.checklistName;

  return (
    <div className="grid gap-6">
      <PageHeader
        title={title}
        actions={
          canManage && (
            <>
              {a.status === 'active' && (
                <Button variant="outline" onClick={() => void act(() => api.assignments.pause(a.id))}>
                  {t('scheduling.assignments.pause')}
                </Button>
              )}
              {a.status === 'paused' && (
                <Button variant="outline" onClick={() => void act(() => api.assignments.resume(a.id))}>
                  {t('scheduling.assignments.resume')}
                </Button>
              )}
              {a.status !== 'ended' && (
                <ConfirmButton
                  variant="destructive"
                  label={t('scheduling.assignments.end')}
                  title={t('scheduling.assignments.end')}
                  description={t('scheduling.assignments.confirmEnd', { name: title })}
                  onConfirm={() => act(() => api.assignments.end(a.id))}
                />
              )}
              <Button variant="outline" onClick={() => void navigate({ to: '/assignments/new', search: { copyFrom: a.id } })}>
                {t('scheduling.assignments.copyToSites')}
              </Button>
            </>
          )
        }
      />
      <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-sm">
        <Badge variant={assignmentVariant(a.status)}>{t(`scheduling.assignments.status.${a.status}`)}</Badge>
        <span>{a.checklistName}</span>
        <span>{a.siteName}</span>
        <span>{scheduleSummary(t, a.schedule, a.timing, a.shiftName)}</span>
      </div>
      <section aria-label={t('scheduling.assignments.upcoming')} className="grid gap-2">
        <h2 className="text-lg font-semibold">{t('scheduling.assignments.upcoming')}</h2>
        {a.upcoming.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('scheduling.assignments.noUpcoming')}</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {a.upcoming.map((o) => (
              <li key={o.id} className="flex items-center gap-3">
                <span>
                  {formatLocalDate(o.localDate)} · {time(o.startsAt)}–{time(o.dueAt)}
                </span>
                <Badge variant={occurrenceVariant(o.status)}>{t(`scheduling.statuses.${o.status}`)}</Badge>
                {o.unassigned && <Badge variant="destructive">{t('scheduling.schedule.unassigned')}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {canManage && a.status !== 'ended' && (
        <AssignmentEditor
          key={a.revision}
          initial={a}
          onSaved={() => {
            toast.success(t('scheduling.assignments.saved'));
            void refresh();
          }}
          onCancel={() => void navigate({ to: '/assignments' })}
        />
      )}
    </div>
  );
}
```

`apps/web/src/features/scheduling/routes.tsx`:

```tsx
import { useParams, useSearch } from '@tanstack/react-router';
import { AssignmentDetailPage, NewAssignmentPage } from './assignment-pages';

export function NewAssignmentRoute() {
  const s = useSearch({ strict: false }) as { checklistId?: string; copyFrom?: string };
  return <NewAssignmentPage checklistId={s.checklistId} copyFrom={s.copyFrom} />;
}

export function AssignmentDetailRoute() {
  const p = useParams({ strict: false }) as { assignmentId?: string };
  return <AssignmentDetailPage assignmentId={p.assignmentId!} />;
}
```

In `router.tsx`:
- Import `AssignmentsPage` from `@/features/scheduling/assignment-pages`, and `AssignmentDetailRoute` and `NewAssignmentRoute` from `@/features/scheduling/routes`.
- Add the routes:

```tsx
const assignmentsRoute = createRoute({ getParentRoute: () => appLayout, path: '/assignments', component: AssignmentsPage });
const newAssignmentRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/assignments/new',
  component: NewAssignmentRoute,
  validateSearch: (s: Record<string, unknown>): { checklistId?: string; copyFrom?: string } => ({
    ...(typeof s.checklistId === 'string' ? { checklistId: s.checklistId } : {}),
    ...(typeof s.copyFrom === 'string' ? { copyFrom: s.copyFrom } : {}),
  }),
});
const assignmentDetailRoute = createRoute({ getParentRoute: () => appLayout, path: '/assignments/$assignmentId', component: AssignmentDetailRoute });
```

- Add the three to `appLayout.addChildren`.

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- assignment-pages && pnpm --filter @taskop/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/scheduling apps/web/src/router.tsx
git commit -m "feat(web): add assignment list, creation and detail pages"
```

---

### Task 9: Schedule page and occurrence details with cancel

**Files:**
- Create: `apps/web/src/features/scheduling/schedule-page.tsx`, `apps/web/src/features/scheduling/occurrence-dialog.tsx`
- Modify: `apps/web/src/router.tsx`
- Test: `apps/web/src/features/scheduling/schedule-page.test.tsx`

**Interfaces:**
- Consumes:
  - `useOccurrences` (follows the cursor), `useOccurrence`, `api.occurrences.cancel`
  - `weekStartOf` (Task 5), `formatLocalDate`, `useTimeFormat`, `useTenantToday`, `cancelReasonText`, `occurrenceVariant`
  - `useFormatDateTime` from `@/lib/format`
- Produces:
  - `SchedulePage({ initialDate? })` at `/schedule`: day/week toggle, prev/today/next, site and status filters, rows grouped by day in `<section aria-label={date}>`
  - `OccurrenceDialog({ id, onClose })`: window times, assignees, history and the cancel form

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/scheduling/schedule-page.test.tsx`:

```tsx
import type { OccurrenceDto } from '@taskop/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { SchedulePage } from './schedule-page';

const mocks = vi.hoisted(() => ({ api: { occurrences: { list: vi.fn(), get: vi.fn(), cancel: vi.fn() }, sites: { list: vi.fn() } } }));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useCan: () => true,
  useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }),
}));

const occ = (over: Partial<OccurrenceDto> = {}): OccurrenceDto => ({
  id: 'o1', assignmentId: 'a1', assignmentName: 'Səhər', checklistId: 'c1', checklistName: 'Açılış', siteId: 'site1', siteName: 'Anbar',
  shiftId: null, shiftName: null, localDate: '2026-11-02', startsAt: '2026-11-02T04:00:00.000Z', dueAt: '2026-11-02T06:00:00.000Z',
  closesAt: '2026-11-02T07:00:00.000Z', status: 'pending', statusChangedAt: '2026-11-02T04:00:00.000Z', cancelReason: null,
  assigneeIds: ['u1'], unassigned: false, ...over,
});

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.api.sites.list.mockResolvedValue([]);
  mocks.api.occurrences.list.mockResolvedValue({
    items: [occ(), occ({ id: 'o2', localDate: '2026-11-03', startsAt: '2026-11-03T04:00:00.000Z', dueAt: '2026-11-03T06:00:00.000Z', status: 'overdue', assigneeIds: [], unassigned: true })],
    nextCursor: null,
  });
  mocks.api.occurrences.get.mockResolvedValue({
    ...occ(),
    assignees: [{ id: 'u1', fullName: 'Elvin' }],
    history: [{ fromStatus: null, toStatus: 'pending', at: '2026-11-02T04:00:00.000Z', actor: { kind: 'user', name: 'Leyla' }, reason: null }],
  });
  mocks.api.occurrences.cancel.mockResolvedValue({ ...occ({ status: 'cancelled' }), assignees: [], history: [] });
});

describe('SchedulePage', () => {
  it('groups the week by day and flags unassigned occurrences', async () => {
    renderWithProviders(<SchedulePage initialDate="2026-11-04" />);
    await waitFor(() => expect(mocks.api.occurrences.list).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-11-02', to: '2026-11-08' })));
    const days = await screen.findAllByRole('region');
    expect(days).toHaveLength(2);
    // The status filter also has a "Gecikib" option, so look inside the day.
    expect(within(days[1]!).getByText('Gecikib')).toBeInTheDocument();
    expect(within(days[1]!).getByText('İcraçı yoxdur')).toBeInTheDocument();
  });

  it('opens an occurrence with its history and cancels it with a reason', async () => {
    renderWithProviders(<SchedulePage initialDate="2026-11-04" />);
    const [first] = await screen.findAllByRole('button', { name: /Açılış/ });
    await userEvent.click(first!);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Elvin')).toBeInTheDocument();
    expect(within(dialog).getByText(/Leyla/)).toBeInTheDocument();
    const cancel = within(dialog).getByRole('button', { name: 'İcranı ləğv et' });
    expect(cancel).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Ləğv səbəbi'), 'Bayram');
    await userEvent.click(cancel);
    await waitFor(() => expect(mocks.api.occurrences.cancel).toHaveBeenCalledWith('o1', { reason: 'Bayram' }));
  });

  it('switches to the day view and moves between days', async () => {
    renderWithProviders(<SchedulePage initialDate="2026-11-04" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Gün' }));
    await waitFor(() => expect(mocks.api.occurrences.list).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-11-04', to: '2026-11-04' })));
    await userEvent.click(screen.getByRole('button', { name: 'Növbəti' }));
    await waitFor(() => expect(mocks.api.occurrences.list).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-11-05', to: '2026-11-05' })));
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/web test -- schedule-page`
Expected: FAIL: the module does not exist.

- [ ] **Step 3: Implement**

`apps/web/src/features/scheduling/occurrence-dialog.tsx`:

```tsx
import type { OccurrenceHistoryEntry } from '@taskop/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FormError } from '@/components/form-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { errorText } from '@/lib/errors';
import { useFormatDateTime } from '@/lib/format';
import { api, useCan } from '@/lib/session';
import { cancelReasonText, occurrenceVariant } from './labels';
import { useOccurrence } from './queries';

export function OccurrenceDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canManage = useCan('assignments.manage');
  const formatDateTime = useFormatDateTime();
  const occurrence = useOccurrence(id);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const o = occurrence.data;

  const actor = (h: OccurrenceHistoryEntry) =>
    h.actor.kind === 'user' ? (h.actor.name ?? '—') : h.actor.kind === 'platform' ? t('scheduling.schedule.actorPlatform') : t('scheduling.schedule.actorSystem');

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.occurrences.cancel(id, { reason: reason.trim() });
      await qc.invalidateQueries({ queryKey: ['occurrences'] });
      await qc.invalidateQueries({ queryKey: ['assignments'] });
      toast.success(t('scheduling.schedule.cancelled'));
      onClose();
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{o?.checklistName ?? t('common.loading')}</DialogTitle>
          {o && <DialogDescription>{[o.assignmentName, o.siteName, o.shiftName].filter(Boolean).join(' · ')}</DialogDescription>}
        </DialogHeader>
        {o && (
          <div className="grid gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant={occurrenceVariant(o.status)}>{t(`scheduling.statuses.${o.status}`)}</Badge>
              {o.unassigned && <Badge variant="destructive">{t('scheduling.schedule.unassigned')}</Badge>}
            </div>
            <p>{t('scheduling.schedule.window', { start: formatDateTime(o.startsAt), due: formatDateTime(o.dueAt), close: formatDateTime(o.closesAt) })}</p>
            <div>
              <h3 className="font-medium">{t('scheduling.schedule.assignees')}</h3>
              {o.assignees.length ? (
                <ul>
                  {o.assignees.map((u) => (
                    <li key={u.id}>{u.fullName}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">{t('scheduling.schedule.unassigned')}</p>
              )}
            </div>
            <div>
              <h3 className="font-medium">{t('scheduling.schedule.history')}</h3>
              <ol className="grid gap-1">
                {o.history.map((h, i) => (
                  <li key={i}>
                    {formatDateTime(h.at)} · {h.fromStatus ? `${t(`scheduling.statuses.${h.fromStatus}`)} → ` : ''}
                    {t(`scheduling.statuses.${h.toStatus}`)} · {actor(h)}
                    {h.reason ? ` · ${cancelReasonText(t, h.reason)}` : ''}
                  </li>
                ))}
              </ol>
            </div>
            {canManage && (o.status === 'pending' || o.status === 'overdue') && (
              <div className="grid gap-2">
                <Label htmlFor="cancel-reason">{t('scheduling.schedule.cancelReason')}</Label>
                <Textarea id="cancel-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
                <FormError message={error} />
                <Button variant="destructive" disabled={!reason.trim() || busy} onClick={() => void cancel()}>
                  {t('scheduling.schedule.cancel')}
                </Button>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

`apps/web/src/features/scheduling/schedule-page.tsx`:

```tsx
import { addDays, OCCURRENCE_STATUSES, type OccurrenceDto } from '@taskop/contracts';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useSites } from '@/features/sites/queries';
import { errorText } from '@/lib/errors';
import { formatLocalDate, occurrenceVariant, useTenantToday, useTimeFormat } from './labels';
import { OccurrenceDialog } from './occurrence-dialog';
import { useOccurrences } from './queries';
import { weekStartOf } from './roster-grid';

export function SchedulePage({ initialDate }: { initialDate?: string }) {
  const { t } = useTranslation();
  const today = useTenantToday();
  const time = useTimeFormat();
  const sites = useSites();
  const [view, setView] = useState<'day' | 'week'>('week');
  const [anchor, setAnchor] = useState(initialDate ?? today);
  const [siteId, setSiteId] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const from = view === 'day' ? anchor : weekStartOf(anchor);
  const to = view === 'day' ? anchor : addDays(from, 6);
  const step = view === 'day' ? 1 : 7;
  const occurrences = useOccurrences({ from, to, siteId: siteId || undefined, status: status || undefined });
  const groups = useMemo(() => {
    const byDay = new Map<string, OccurrenceDto[]>();
    for (const o of occurrences.data ?? []) byDay.set(o.localDate, [...(byDay.get(o.localDate) ?? []), o]);
    return [...byDay.entries()];
  }, [occurrences.data]);

  return (
    <div className="grid gap-4">
      <PageHeader title={t('scheduling.schedule.title')} />
      <div className="flex flex-wrap items-center gap-2">
        {(['day', 'week'] as const).map((v) => (
          <Button key={v} variant={view === v ? 'default' : 'outline'} aria-pressed={view === v} onClick={() => setView(v)}>
            {t(`scheduling.schedule.${v}`)}
          </Button>
        ))}
        <Button variant="outline" onClick={() => setAnchor(addDays(anchor, -step))}>
          {t('scheduling.schedule.prev')}
        </Button>
        <Button variant="outline" onClick={() => setAnchor(today)}>
          {t('scheduling.schedule.today')}
        </Button>
        <Button variant="outline" onClick={() => setAnchor(addDays(anchor, step))}>
          {t('scheduling.schedule.next')}
        </Button>
        <span className="text-sm">{from === to ? formatLocalDate(from) : `${formatLocalDate(from)} – ${formatLocalDate(to)}`}</span>
        <NativeSelect aria-label={t('scheduling.schedule.site')} value={siteId} onChange={(e) => setSiteId(e.target.value)} className="w-56">
          <option value="">{t('scheduling.schedule.allSites')}</option>
          {(sites.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label={t('scheduling.schedule.status')} value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
          <option value="">{t('scheduling.schedule.allStatuses')}</option>
          {OCCURRENCE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`scheduling.statuses.${s}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      {occurrences.error && <p className="text-destructive">{errorText(t, occurrences.error)}</p>}
      {occurrences.isSuccess && groups.length === 0 && <p className="text-muted-foreground">{t('scheduling.schedule.empty')}</p>}
      {groups.map(([date, items]) => (
        <section key={date} aria-label={formatLocalDate(date)} className="grid gap-2">
          <h2 className="font-semibold">{formatLocalDate(date)}</h2>
          <ul className="grid gap-1">
            {items.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => setSelected(o.id)}
                  className="hover:bg-muted flex w-full flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-left text-sm"
                >
                  <span className="font-mono">
                    {time(o.startsAt)}–{time(o.dueAt)}
                  </span>
                  <span className="font-medium">{o.checklistName}</span>
                  {o.assignmentName && <span className="text-muted-foreground">{o.assignmentName}</span>}
                  <span className="text-muted-foreground">{o.siteName}</span>
                  <Badge variant={occurrenceVariant(o.status)}>{t(`scheduling.statuses.${o.status}`)}</Badge>
                  {o.unassigned && <Badge variant="destructive">{t('scheduling.schedule.unassigned')}</Badge>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {selected && <OccurrenceDialog id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
```

In `router.tsx`:
- Import `SchedulePage`.
- Add `const scheduleRoute = createRoute({ getParentRoute: () => appLayout, path: '/schedule', component: () => <SchedulePage /> });`.
- Add it to `appLayout.addChildren`.

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- schedule-page && pnpm --filter @taskop/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/scheduling apps/web/src/router.tsx
git commit -m "feat(web): add the schedule page with occurrence details and cancel"
```

---

### Task 10: Assignments on the checklist page

**Files:**
- Create: `apps/web/src/features/scheduling/checklist-assignments.tsx`
- Modify: `apps/web/src/features/checklists/checklist-detail-page.tsx`
- Test: `apps/web/src/features/scheduling/checklist-assignments.test.tsx`

**Interfaces:**
- Consumes: `useAssignments(filters, enabled)`, `scheduleSummary`, `assignmentVariant`, `useCan`.
- Produces: `<ChecklistAssignments checklistId canAssign />`. It renders only for tenant users with `assignments.view`. The "Təyin et" link goes to `/assignments/new?checklistId=…` and appears only with `assignments.manage` when the checklist is active and published.

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/scheduling/checklist-assignments.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '@/test/router';
import { ChecklistAssignments } from './checklist-assignments';

const mocks = vi.hoisted(() => ({ api: { assignments: { list: vi.fn() } }, can: true }));
vi.mock('@/lib/session', () => ({ api: mocks.api, useCan: () => mocks.can }));

const row = {
  id: 'a1', name: 'Səhər', checklistId: 'c1', checklistName: 'Açılış', siteId: 'site1', siteName: 'Anbar',
  schedule: { kind: 'daily', every: 1, startDate: '2026-11-02', endDate: null, skipDates: [] },
  timing: { mode: 'fixed', startTime: '08:00', dueAfterMinutes: 120, graceMinutes: 60 },
  shiftName: null, status: 'active', revision: 1, assignees: [], createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.can = true;
  mocks.api.assignments.list.mockResolvedValue({ items: [row], nextCursor: null });
});

describe('ChecklistAssignments', () => {
  it('lists the checklist’s assignments and links to assign it', async () => {
    renderWithRouter(<ChecklistAssignments checklistId="c1" canAssign />);
    expect(await screen.findByRole('link', { name: 'Səhər' })).toHaveAttribute('href', '/assignments/a1');
    expect(screen.getByRole('link', { name: 'Təyin et' })).toHaveAttribute('href', '/assignments/new?checklistId=c1');
    expect(mocks.api.assignments.list).toHaveBeenCalledWith(expect.objectContaining({ checklistId: 'c1' }));
  });

  it('hides the assign link for an unpublished or deactivated checklist', async () => {
    renderWithRouter(<ChecklistAssignments checklistId="c1" canAssign={false} />);
    await screen.findByRole('link', { name: 'Səhər' });
    expect(screen.queryByRole('link', { name: 'Təyin et' })).not.toBeInTheDocument();
  });

  it('renders nothing without assignments.view', async () => {
    mocks.can = false;
    renderWithRouter(<ChecklistAssignments checklistId="c1" canAssign />);
    await waitFor(() => expect(screen.queryByRole('region')).not.toBeInTheDocument());
    expect(mocks.api.assignments.list).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/web test -- checklist-assignments`
Expected: FAIL: the module does not exist.

- [ ] **Step 3: Implement**

`apps/web/src/features/scheduling/checklist-assignments.tsx`:

```tsx
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { useCan } from '@/lib/session';
import { assignmentVariant, scheduleSummary } from './labels';
import { useAssignments } from './queries';

/** The checklist page's view of where and when the checklist runs (spec §8 item 5). Tenant users only. */
export function ChecklistAssignments({ checklistId, canAssign }: { checklistId: string; canAssign: boolean }) {
  const { t } = useTranslation();
  const canView = useCan('assignments.view');
  const canManage = useCan('assignments.manage');
  const list = useAssignments({ checklistId }, canView);
  if (!canView) return null;
  const items = list.data?.items ?? [];
  return (
    <section aria-label={t('scheduling.assignments.forChecklist')} className="grid gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('scheduling.assignments.forChecklist')}</h2>
        {canManage && canAssign && (
          <Link to="/assignments/new" search={{ checklistId }} className={buttonVariants({ size: 'sm' })}>
            {t('scheduling.assignments.assign')}
          </Link>
        )}
      </div>
      {list.isSuccess && items.length === 0 && <p className="text-muted-foreground text-sm">{t('scheduling.assignments.empty')}</p>}
      {items.length > 0 && (
        <Table>
          <TableBody>
            {items.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <Link to="/assignments/$assignmentId" params={{ assignmentId: a.id }} className="font-medium hover:underline">
                    {a.name ?? a.checklistName}
                  </Link>
                </TableCell>
                <TableCell>{a.siteName}</TableCell>
                <TableCell>{scheduleSummary(t, a.schedule, a.timing, a.shiftName)}</TableCell>
                <TableCell>
                  <Badge variant={assignmentVariant(a.status)}>{t(`scheduling.assignments.status.${a.status}`)}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
```

In `apps/web/src/features/checklists/checklist-detail-page.tsx`:
- Import `ChecklistAssignments` from `'@/features/scheduling/checklist-assignments'`.
- Right after the versions `</Table>`, add:

```tsx
      {/* Only tenant users have a session to check assignment permissions against; platform admins use the API. */}
      {ws.scope === 'tenant' && <ChecklistAssignments checklistId={c.id} canAssign={active && c.currentVersionId !== null} />}
```

The existing detail-page tests use `fakeWorkspace()` (scope `'test'`), so they are unaffected.

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- checklist-assignments checklist-detail-page && pnpm --filter @taskop/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/scheduling apps/web/src/features/checklists/checklist-detail-page.tsx
git commit -m "feat(web): show a checklist's assignments with an Assign link"
```

---

### Task 11: End-to-end scheduling flow and final checks

**Files:**
- Create: `apps/web/e2e/scheduling.spec.ts`

**Interfaces:**
- Consumes the whole of Parts 1 and 2. It needs the API built from Part 1 running on port 3000 and a database prepared with `pnpm db:setup && pnpm db:seed`. The global template "Gündəlik təmizlik yoxlaması" must exist.

- [ ] **Step 1: Write the end-to-end test**

`apps/web/e2e/scheduling.spec.ts`:

```ts
import { expect, type APIRequestContext, test } from '@playwright/test';

/** Sets up a tenant through the API: a site, a worker at it and a published checklist from a Taskop template. */
async function seedTenant(request: APIRequestContext, suffix: string) {
  const email = `sch-${suffix}@example.az`;
  const password = 'e2e owner password';
  const signup = await request.post('/api/v1/auth/signup', {
    data: { orgName: 'E2E Növbə MMC', orgCode: `e2e-sch-${suffix}`, fullName: 'Elvin Əhmədov', email, password, client: 'mobile' },
  });
  expect(signup.ok(), await signup.text()).toBeTruthy();
  const headers = { Authorization: `Bearer ${(await signup.json()).accessToken}` };
  const call = async (method: string, url: string, data?: unknown) => {
    const res = await request.fetch(`/api/v1${url}`, { method, headers, data });
    expect(res.ok(), `${method} ${url}: ${await res.text()}`).toBeTruthy();
    return res.status() === 204 ? null : res.json();
  };
  const types = (await call('GET', '/site-types')) as Array<{ id: string; name: string }>;
  const site = await call('POST', '/sites', { parentId: null, typeId: types.find((x) => x.name === 'Filial')!.id, name: 'Anbar №1' });
  const roles = (await call('GET', '/roles')) as Array<{ id: string; systemKey: string | null }>;
  await call('POST', '/users/workers', { fullName: 'Nigar Səfərli', username: 'nigar', roleId: roles.find((r) => r.systemKey === 'worker')!.id, siteIds: [site.id] });
  const templates = (await call('GET', '/templates')) as Array<{ id: string; name: string; source: string }>;
  const template = templates.find((x) => x.source === 'global' && x.name === 'Gündəlik təmizlik yoxlaması')!;
  const checklist = await call('POST', '/checklists', { name: 'E2E açılış', from: { kind: 'global', templateId: template.id } });
  const draft = await call('GET', `/checklists/${checklist.id}/draft`);
  await call('POST', `/checklists/${checklist.id}/publish`, { revision: draft.revision });
  return { email, password };
}

test('owner sets up a shift and a roster, then assigns a checklist by shift', async ({ page, request }) => {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const { email, password } = await seedTenant(request, suffix);

  await page.goto('/login');
  await page.getByLabel('E-poçt', { exact: true }).fill(email);
  await page.getByLabel('Şifrə', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Daxil ol' }).click();

  // Shift template.
  await page.getByRole('link', { name: 'Növbələr' }).click();
  await page.getByRole('button', { name: 'Növbə yarat' }).click();
  const shiftDialog = page.getByRole('dialog');
  await shiftDialog.getByLabel('Ad', { exact: true }).fill('Səhər');
  await shiftDialog.getByLabel('Başlama').fill('08:00');
  await shiftDialog.getByLabel('Bitmə').fill('16:00');
  await shiftDialog.getByRole('button', { name: 'Yadda saxla' }).click();
  await expect(page.getByRole('cell', { name: 'Səhər' })).toBeVisible();

  // Roster: Nigar on the morning shift all week.
  await page.getByRole('link', { name: 'Növbə cədvəli' }).click();
  await page.getByLabel('Obyekt').selectOption({ label: 'Anbar №1' });
  const cells = page.getByRole('checkbox', { name: /^Səhər — Nigar Səfərli, / });
  await expect(cells).toHaveCount(7);
  for (let i = 0; i < 7; i++) await cells.nth(i).click();
  await page.getByRole('button', { name: 'Yadda saxla' }).click();
  await expect(page.getByText('Növbə cədvəli yadda saxlanıldı')).toBeVisible();

  // Assignment with shift timing and a live preview.
  await page.getByRole('link', { name: 'Təyinatlar' }).click();
  await page.getByRole('link', { name: 'Yeni təyinat' }).click();
  await page.getByLabel('Yoxlama vərəqəsi').selectOption({ label: 'E2E açılış' });
  await page.getByLabel('Obyekt').selectOption({ label: 'Anbar №1' });
  await page.getByRole('checkbox', { name: 'Nigar Səfərli' }).click();
  await page.getByLabel('Vaxt növü').selectOption('shift');
  const preview = page.getByRole('complementary', { name: 'Növbəti icralar' });
  await expect(preview.getByText('Hər gün, Səhər növbəsi')).toBeVisible();
  await expect(preview.getByRole('listitem').first()).toBeVisible();
  await page.getByRole('button', { name: 'Yadda saxla' }).click();

  // The assignment page lists the generated occurrences.
  await expect(page.getByRole('heading', { name: 'E2E açılış' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Yaxın icralar' }).getByRole('listitem').first()).toBeVisible();

  // The schedule page opens.
  await page.getByRole('link', { name: 'İcra cədvəli' }).click();
  await expect(page.getByRole('heading', { name: 'İcra cədvəli' })).toBeVisible();
});
```

- [ ] **Step 2: Run the end-to-end test**

Run (with the local DB up via `docker compose -p foundation start`, and `pnpm db:setup && pnpm db:seed` already done):

```bash
pnpm --filter @taskop/api build
pnpm --filter @taskop/web e2e -- scheduling
```

Expected: PASS. The Playwright config starts the API and the web dev server when they are not already running.

- [ ] **Step 3: Run every check in the monorepo**

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @taskop/web e2e
```

Expected: all green. The `checklists` and `foundation` end-to-end tests still pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/scheduling.spec.ts
git commit -m "test(web): add the scheduling end-to-end flow"
```
