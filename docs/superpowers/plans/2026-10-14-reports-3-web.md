# Taskop Reports — Part 3: Web App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `reports.view` holders a live dashboard on the web home page (count tiles, a daily trend, "needs attention") and a `/reports` page with Summary, Sites, Employees, Runs, Problems and Tasks tabs whose filters, tab and bucket live in the URL; give `reports.export` holders an export menu for the open table (CSV, Excel, PDF) and the full period report (Excel, PDF). Finish with the spec §9 Playwright flow.

**Architecture:**
- **New feature folder `apps/web/src/features/reports/`**, built like `features/tasks/` and `features/notifications/`: pure helpers in `search.ts` (URL model, period resolution) and `labels.ts` (tiles, sorting, picker options, export query); React Query hooks and keys in `queries.ts`; components that call `api.reports.*` from `@/lib/session`; every string from `az.reports` (plus the existing `az.scheduling`, `az.executions`, `az.tasks`, `az.common`, `az.errors` labels).
- **The URL is the report.** `/` and `/reports` share one validated search model (`ReportSearch`: `period`, `from`, `to`, `siteId`, `userId`, `checklistId`, `inactive`); `/reports` adds `tab`, `bucket` and `severity` (`ReportsPageSearch`). The pages turn the search into the API's `ReportFilters` with `resolveReportFilters(search, tenantToday)`, which uses Part 1's `resolvePeriod` and `reportRangeTooLong`, so a range the API would refuse is never sent.
- **Live numbers, no cache of our own.** Every report query is keyed by its filters under `['reports', …]`. The dashboard's three queries poll every 60 s while the tab is visible (`refetchIntervalInBackground: false`) and on focus; "Yenilə" invalidates `['reports']`. Closing a run or task drawer opened from a report also invalidates `['reports']`, so a run cancelled there leaves the lists at once.
- **Existing drawers, unchanged.** `OccurrenceDialog({ id, onClose, initialTab })` and `TaskDrawer({ id, onClose })` already take an id and own their data, so they are reused as they are (decision 1); `/schedule` and `/tasks` do not change.
- **Files come from the API client.** `api.reports.export(kind, query)` returns `{ blob, filename }`; `saveFile` turns it into an object URL and clicks an `<a download>`. `REPORT_TOO_LARGE` becomes a toast with `rows` and `limit`; every other error goes through `errorText` (`az.errors`).

**Tech Stack:** React 19.2.3, TanStack Router 1 + Query 5, shadcn/ui on `radix-ui` (`Tabs`, `Dialog`, `DropdownMenu`, `Checkbox`, `Card`, `Table`, `Badge`, `Button`), i18next, lucide-react, sonner, Vitest 5 + Testing Library + user-event, Playwright (all already in the repo). **New packages (checked with `npm view` on 2026-10-14):** `recharts@^3.10.1` (latest stable, published 2026-07-25; peers `react`, `react-dom` and `react-is` `^16.8 || ^17 || ^18 || ^19`, so React 19.2 is supported) and its peer `react-is@19.2.3`, pinned to the React version the web app pins (decision 15).

**Spec:** `docs/superpowers/specs/2026-10-14-reports-design.md` — this plan implements §6, the web parts of §8 and the web and Playwright parts of §9. **Interface source:** `docs/superpowers/plans/2026-10-14-reports-1-api.md`, section *Interfaces for Parts 2 and 3* and its *Spec decisions* (1, 4, 5, 6, 9, 12, 13 in particular); this plan uses only names listed there or already in the repo.

**This plan is Part 3 of 3.**
- **Before starting:** Part 1 **Tasks 1–5** must be merged into the feature branch: `report-logic.ts` (`resolvePeriod`, `PERIOD_PRESETS`, `reportRangeTooLong`, `emptyRunCounts`, `REPORT_LIMITS`), `reports.ts` (`REPORT_KINDS`, `REPORT_FORMATS`, `RUN_BUCKETS`, the query and response types), the permission keys and error codes, the `az.reports` namespace with `az.nav.reports` and `az.errors.REPORT_*`, and the `@taskop/api-client` methods `reports.*` (including `reports.export` → `ReportFile`) and `ApiError.rows` / `.limit`.
- **Tasks 1–9** need nothing else. They test against a mocked `@/lib/session`.
- **Task 10 (Playwright)** needs Part 1 **Tasks 6–15** merged: the permission backfill (Task 6), the run-detail access for report viewers (Task 7, so the run drawer opens for `reports.view`), the six endpoints (Tasks 8–11) and the exports (Tasks 13–15). Part 1 Tasks 12, 16 and 17 (scope suite, performance seed, OpenAPI) are not needed.
- Part 2 (`apps/mobile`) is independent of this part. Both parts append to `packages/i18n/src/i18n.test.ts` (Part 2 adds `az.mobile` keys, this part `az.reports` web keys); the two appends do not touch the same lines.

## Global Constraints

- The product name is **Taskop**. Azerbaijani (`az`) is the only locale.
- Every visible string is an i18n key. New web strings go into `az.reports` (`packages/i18n/src/az/reports.ts`, Part 1 Task 4's file) as **new keys only**: `range`, `picker`, `tiles`, `chart`, `live`, `attention`, `table` (Task 1). Part 1's keys (`title`, `dashboard`, `trend`, `empty`, `inactive`, `noValue`, `periods`, `filters`, `counts`, `measures`, `buckets`, `tabs`, `columns`, `employees`, `problems`, `tasks`, `export`, `issues`, …), `az.nav.reports` and `az.errors.REPORT_*` are reused, never renamed. Status, severity, source, priority, resolution and flag labels come from `az.scheduling.statuses`, `az.executions.{severities, problemSources, flags, percent}`, `az.tasks.{statuses, priorities, resolutions, flags}`.
- Install exactly `recharts@^3.10.1` and `react-is@19.2.3` (Task 5). Otherwise use the existing `Badge`, `Button`, `Card`, `Checkbox`, `Dialog`, `DropdownMenu`, `Input`, `Label`, `NativeSelect`, `PageHeader`, `Table`, `Tabs`.
- **Periods:** `today` (the default, absent from the URL), `yesterday`, `this_week` (Monday → today), `this_month` (the 1st → today), `last_7`, `last_30`, resolved by Part 1's `resolvePeriod(preset, today)` from the **tenant's** today (`useTenantToday()`, i.e. `localDateOf(now, me.tenant.timezone)`), never the browser's; `custom` with `from` and `to` (both inclusive, `to − from ≤ 365`, checked with `reportRangeTooLong`; `from > to` refused). An invalid range shows its reason and sends no request.
- **URL search** (TanStack Router `validateSearch`): `/` → `reportSearch`, `/reports` → `reportsPageSearch`. `period` ∈ `PERIOD_PRESETS ∪ {'custom'}`; `from` / `to` valid `YYYY-MM-DD` and kept only with `period=custom`; `siteId`, `userId`, `checklistId` valid UUIDs; `inactive` `true` (boolean or `"true"`); `tab` ∈ `REPORT_KINDS` (default `summary`); `bucket` ∈ `RUN_BUCKETS` (default `all`); `severity` ∈ `normal | critical`. Anything else is dropped.
- **Tiles:** dashboard: Planlaşdırılıb, Tamamlanıb, Davam edir, Gecikib, Problemli, Tamamlanma faizi, Orta bal; the Summary tab adds Yarımçıq and Buraxılıb. Each count tile is a link to `/reports?tab=runs&bucket=<bucket>` with the same filters: planned → `all`, completed → `completed`, inProgress → `in_progress`, overdue → `overdue`, partial → `partial`, missed → `missed`, withProblems → `problems` (Part 1 decision 6). The completion tile explains itself with `reports.measures.completionHint`. A missing percentage is `reports.noValue` ("—").
- **Trend:** recharts `ComposedChart`s; hidden when `from === to`.
- **Needs attention:** `api.reports.runs({ …filters, from: today, to: today, bucket: 'overdue' })` and `api.reports.problems({ …filters, severity: 'critical' })`, the first **10** items of the first page (`ATTENTION_LIMIT`).
- **Refresh:** the dashboard's queries use `refetchInterval: 60_000`, `refetchIntervalInBackground: false`, `refetchOnWindowFocus: true`; "Yenilə" invalidates `['reports']`; "Son yenilənmə: HH:mm" is the summary's `dataUpdatedAt` on the tenant's clock.
- **Paging:** runs, problems and tasks come in pages of **50** (`REPORT_LIMITS.pageSize`, fixed by the API); "Daha çox göstər" passes `nextCursor` back as `cursor` with the same filters. Problem and task `counts` are read from the first page.
- **Menu:** "Hesabatlar" (`nav.reports`, icon `ChartColumn`, `/reports`) for holders of **`reports.view`**, right after "Ana səhifə". As with every page, the route itself is not guarded; the API answers `403` without `reports.view`.
- **Export menu** ("İxrac et", `/reports` only) for holders of **`reports.view` and `reports.export`**: "Bu cədvəl" → CSV / Excel / PDF of the open tab (`kind = tab`; `bucket` for `runs`, `severity` for `problems`); "Tam hesabat" → Excel / PDF (`kind = 'full'`, no bucket or severity). One export at a time; the button shows a spinner and "Fayl hazırlanır…" meanwhile.
- Tests mock `@/lib/session` exactly as the existing feature tests do. Report UUIDs in fixtures are valid v7 UUIDs (the URL validator checks them). No test depends on the machine's time zone; tests that need "now" fake `Date` and set the tenant's zone.
- Commits use `git add <explicit paths>` (never `-A`). Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (the second `-m`).

## Gaps against Part 1

1. **No report-scoped options for the site and checklist pickers.** Part 1 adds no endpoint that lists the sites or checklists a report viewer may filter by, so the pickers use the existing `GET /sites` (`sites.view`) and `GET /checklists` (`checklists.view`). Manager and Auditor (and Owner, Admin) hold both, so the system roles are unaffected; a **custom role with `reports.view` alone** gets no site and no checklist picker (they are hidden, decision 4), though a shared URL with `siteId` / `checklistId` still filters. This plan does not work around it further. If such roles matter, Part 1 (or a follow-up) would add e.g. `GET /reports/options`; the pickers would then switch to it without other changes. The employee picker has no gap: it is filled from `GET /reports/employees` (decision 4).

Everything else this plan needs is in Part 1's *Interfaces for Parts 2 and 3*. Checked against the real code: the task drawer's `GET /tasks/:id` reads through `TaskScope.readable(principal)`, the same rule as `/reports/tasks` (Part 1 *Scope*), so every task row a viewer sees also opens; the run drawer's `GET /occurrences/:id`, `GET /executions/:id` and `GET /media/:id/url` accept `reports.view` once Part 1 Task 7 is merged (Part 1 decision 1).

## Spec decisions (ambiguities resolved against the real code)

1. **The drawers are already standalone.** `features/scheduling/occurrence-dialog.tsx` exports `OccurrenceDialog({ id, onClose, initialTab })`, which loads its own occurrence (`useOccurrence(id)`) and execution; `features/tasks/task-drawer.tsx` exports `TaskDrawer({ id, onClose })` with its own `useTask(id)`. `/schedule` only keeps `selected` in page state and renders the dialog with that id. So nothing is extracted and `/schedule` and `/tasks` do not change. The reports wrap them (`RunDrawer`, `ReportTaskDrawer`, Task 3) only to refresh the report queries when the drawer closes.
2. **One URL model for both pages.** `ReportSearch` is shared by `/` and `/reports`; `ReportsPageSearch` adds `tab`, `bucket`, `severity`. Defaults (`today`, `summary`, `all`) are applied when reading, never required in the URL. `from` / `to` only count with `period=custom`, so a stale range left in a link cannot silently override a preset. A custom period keeps a half-typed range (one end valid) so the filter bar can ask for the other end.
3. **History:** edits in the filter bar replace the current history entry (no entry per keystroke in a date field); tab switches, bucket and severity chips and drill-downs push one, so Back returns from a site's Summary to the site comparison.
4. **Picker sources.** Site picker: `GET /sites` (`useSites`), shown as an indented tree in a native select (`indentedName`, the pattern of the other pages); choosing a site filters its subtree (the API's `sites.path <@` rule). Employee picker: the period's `GET /reports/employees` rows (same filters, without `userId`), like the phone's Team tab (spec §7.1): it lists exactly the people the viewer can report on, with `active: false` for deactivated ones, needs only `reports.view`, and shares its cache with the Employees tab; the Unassigned row is not an option. Checklist picker: every page of `GET /checklists` (`limit: 200`, following `nextCursor`). Site and checklist pickers are hidden without `sites.view` / `checklists.view` (Gap 1).
5. **"Show inactive"** is the URL flag `inactive=true`. It only widens the pickers' lists (inactive sites, deactivated people, deactivated checklists, each marked "(Deaktiv)"); report rows always include inactive entries with their history (spec §8, FR-04.11). A **selected** entry stays listed even while inactive ones are hidden, and an id that is in no list shows as "Seçilmiş …" instead of falling back to "all", so the picker never claims a wider report than the URL asks for.
6. **Tiles.** The dashboard shows the spec's five counts and two percentages; the Summary tab adds Partial and Missed, which also link to their buckets. "Planned" opens the `all` bucket, which also lists cancelled runs (Part 1: `all` includes cancelled); their status badge says so.
7. **The completion tooltip** is an info icon with a `title` plus an `aria-describedby` link to the hint text, because the repo has no tooltip component and no UI package is added.
8. **The trend is two charts on one time axis, not a dual-axis chart.** The top `ComposedChart` draws Due and Completed bars per day (counts, with a legend); the bottom `ComposedChart` draws the completion % line on 0–100 %. They share `syncId`, so hovering a day highlights it in both. A visually hidden table carries the same numbers for screen readers; the charts themselves are `aria-hidden` with recharts' keyboard layer off. Colours are theme tokens (`--chart-2`, `--primary`, `--border`, `--muted-foreground`), so light and dark mode both apply.
9. **"Overdue right now" is today's.** The spec says `bucket=overdue` "for today", so the list asks `from = to =` the tenant's today with the site, employee and checklist filters, whatever the period. Critical problems use the period. Both show the first 10 of the API's first page (Part 1 decision 13). Rows open the run drawer: overdue runs on "Ümumi", problems on "İcra".
10. **Live data.** Polling every 60 s only while the tab is visible, plus a refetch when the window regains focus (the app default turns that off, `src/lib/query.ts`). Because "today" is read on every render and the summary re-renders on each refetch, a dashboard left open past midnight moves Today to the new day within a minute.
11. **Drill-downs.** A site row sets `siteId` and opens Summary (spec). An employee row sets `userId` and also opens Summary: on the Employees tab a `userId` filter would leave one row. The Unassigned row has no `userId` (Part 1 decision 9), so it is not clickable, and it stays last under any sort.
12. **Sorting is client-side** on the Sites and Employees tables (the API returns them whole). The first click sorts names A→Z and numbers high→low, the second reverses; rows without a percentage go last either way; ties keep the server's order.
13. **Run and problem rows.** A runs row opens the run drawer on "Ümumi"; a problems row opens it on "İcra", where the problem is listed with its answer ("at its problem": the drawer has no per-problem anchor, and none is added). A problem's linked task opens the task drawer.
14. **Exports.** The menu sits on `/reports` (spec §6.2), not on the dashboard. `kind` is the open tab; `bucket` goes with `runs` (default `all`), `severity` with `problems`; "Tam hesabat" sends neither (Part 1 decision 16). The object URL is revoked 60 s after the click (time for the browser to start the download). The menu trigger is disabled while a file is built, so a double click starts one export.
15. **`react-is` is installed with `recharts`.** It is a peer dependency of recharts 3 that pnpm does not install by itself; it is pinned to `19.2.3`, the version of `react` the web app pins, and moves with it.
16. **The home page switches on the permission only.** `reports.view` → dashboard; everyone else keeps today's welcome page. A role with `reports.view` and data scope `own` sees its own numbers (spec §4); only the phone's Team tab looks at the scope.
17. **The dashboard's heading is "İdarə paneli"** (`reports.dashboard`). The foundation and checklist end-to-end specs, which expected the owner's welcome heading after signup, now expect it (Task 6).
18. **The e2e seeds yesterday's runs and looks at "Son 7 gün".** Both runs belong to yesterday (as in the executions and tasks specs), so the test never races midnight; an overdue run needs the status sweep (every minute, `JOBS_CRON=true`, the default), so the test waits for it through `GET /reports/summary` with `expect.poll` (≤ 90 s) and raises its own timeout to 180 s.

## Review Focus

These are the five input classes most likely to bite real users that no spec test names. Each line gives the task whose test pins it.

1. **A hand-edited, old or truncated report URL.** A bookmark with `from=2026-02-30`, `siteId=site-1`, `tab=audit`, `bucket=late`, a range left over from a preset, an inverted or 400-day custom range: the page must fall back to safe defaults or explain the range, and never send a request the API would refuse with `VALIDATION_FAILED` or `REPORT_RANGE_TOO_LONG`. Pinned in Task 2 (`drops what a hand-edited or old bookmark gets wrong`, `checks a custom range before anything is asked`) and Task 5 (`falls back to Summary without a broken site id`, `explains a custom range it cannot show and asks for no report`).
2. **The tenant's day is not the browser's day.** A manager in Baku looks at 01:30 local time from a laptop still on another zone, or leaves the dashboard open over midnight: "Bu gün" and "Bu həftə" must follow the tenant's calendar, and Today must roll over. Pinned in Task 6 (`resolves the period from the tenant's today, not the browser's`, `moves Today to the new day when the page stays open over midnight`).
3. **A run changed from a report's drawer.** A manager cancels an overdue run from the "Needs attention" list or the Runs tab: it must leave the list and the tiles must change without a manual refresh. Pinned in Task 3 (`refreshes every report query when the run drawer closes`, `… when the task drawer closes`).
4. **A slow or failing export.** A 10,000-row PDF takes seconds; an impatient double click must not start two exports, the spinner must show, and a `422` or `503` must leave the menu usable with a readable message. Pinned in Task 9 (`shows a spinner while the file is built and starts one export at a time`, `says how many rows a too large export has`, `shows other export errors from az.errors`).
5. **A selected filter target that is inactive or not listed.** A shared link filters by a deactivated employee or site while "show inactive" is off, or by a person without runs in the new period: the picker must show what is selected instead of "Hamısı", or the user believes they see everything. Pinned in Task 4 (`keeps a selected inactive or unlisted site, employee and checklist visible`).

---

## File Structure

```
packages/i18n/src/
  az/reports.ts                   + web keys: range, picker, tiles, chart, live, attention, table
  i18n.test.ts                    + report web translations
apps/web/
  package.json                    + recharts, react-is
apps/web/src/
  features/reports/
    search.ts                     PeriodChoice, ReportSearch, ReportsPageSearch, reportSearch, reportsPageSearch,
                                  filterSearch, pageExtras, cleanSearch, resolveReportFilters, withPeriod, FILTER_ISSUE_KEYS
    search.test.ts
    labels.ts                     TileKey, TILE_BUCKETS, DASHBOARD_TILES, SUMMARY_TILES, tileSearch, percentText,
                                  isSingleDay, SortState, sortRows, nextSort, siteOptions, employeeOptions,
                                  checklistOptions, exportQuery, exportErrorText
    labels.test.ts
    queries.ts                    DASHBOARD_REFETCH_MS, ATTENTION_LIMIT, reportKeys, useReportSummary, useSiteReport,
                                  useEmployeeReport, useReportRuns, useReportProblems, useReportTasks, useOverdueNow,
                                  useCriticalProblems, useEmployeeOptions, useReportChecklistOptions
    download.ts                   REVOKE_AFTER_MS, saveFile
    download.test.ts
    drawers.tsx                   RunDrawer, ReportTaskDrawer
    drawers.test.tsx
    fixtures.ts                   test data (tests only)
    report-filters.tsx            ReportFilters (the filter bar)
    report-filters.test.tsx
    count-tiles.tsx               CountTiles
    count-tiles.test.tsx
    trend-chart.tsx               TrendChart
    trend-chart.test.tsx
    summary-view.tsx              SummaryView (tiles + trend + empty note), SummaryTab
    reports-page.tsx              ReportsPage (/reports)
    reports-page.test.tsx
    dashboard-page.tsx            DashboardPage (/ for reports.view)
    dashboard-page.test.tsx
    attention-panel.tsx           AttentionPanel
    sortable-head.tsx             SortableHead
    comparison-table.tsx          ComparisonTable, COMPARISON_COLUMNS
    sites-tab.tsx                 SitesTab
    sites-tab.test.tsx
    employees-tab.tsx             EmployeesTab
    employees-tab.test.tsx
    chip-group.tsx                ChipGroup
    stat-list.tsx                 StatList
    runs-tab.tsx                  RunsTab
    runs-tab.test.tsx
    problems-tab.tsx              ProblemsTab
    problems-tab.test.tsx
    tasks-tab.tsx                 TasksTab
    tasks-tab.test.tsx
    export-menu.tsx               ExportMenu
    export-menu.test.tsx
  features/home/
    home-page.tsx                 dashboard for reports.view, welcome page otherwise
    home-page.test.tsx            (new)
  layouts/app-shell.tsx           + Hesabatlar
  layouts/app-shell.test.tsx
  router.tsx                      / (validateSearch: reportSearch), /reports (validateSearch: reportsPageSearch)
apps/web/e2e/
  reports.spec.ts                 (new)
  foundation.spec.ts, checklists.spec.ts   the owner lands on the dashboard
```

---

### Task 1: Web strings for the filter bar, tiles, trend, dashboard and report tables

**Files:**
- Modify: `packages/i18n/src/az/reports.ts`
- Test: `packages/i18n/src/i18n.test.ts`

**Interfaces:**
- Consumes: Part 1 Task 4's `az.reports` (`title`, `dashboard`, `trend`, `empty`, `inactive`, `noValue`, `periods`, `filters`, `counts`, `measures`, `buckets`, `tabs`, `columns`, `employees`, `problems`, `tasks`, `export`, `issues`) and `az.nav.reports`.
- Produces (used by Tasks 2–10): `reports.range.{label, incomplete}`, `reports.picker.{unknown, unknownEmployee}`, `reports.tiles.link`, `reports.chart.table`, `reports.live.{refresh, updatedAt}`, `reports.attention.{title, overdueNow, critical, noneOverdue, noneCritical}`, `reports.table.{more, sort, openTask, receivedAt}`, exactly as written in Step 3.

- [ ] **Step 1: Write the failing test**

Append to `packages/i18n/src/i18n.test.ts`:

```ts
describe('report web translations', () => {
  it('has the strings the filter bar, the tiles, the trend, the dashboard and the report tables use', () => {
    expect(az.reports.range.label).toBe('{{from}} – {{to}}');
    expect(az.reports.range.incomplete).toBe('Başlanğıc və son tarixi seçin.');
    expect(az.reports.picker.unknown).toBeTypeOf('string');
    expect(az.reports.picker.unknownEmployee).toBeTypeOf('string');
    expect(az.reports.tiles.link).toBe('{{label}}: {{value}}');
    expect(az.reports.chart.table).toBe('Gündəlik icra cədvəli');
    expect(az.reports.live.refresh).toBe('Yenilə');
    expect(az.reports.live.updatedAt).toBe('Son yenilənmə: {{time}}');
    expect(az.reports.attention.title).toBe('Diqqət tələb edir');
    expect(az.reports.attention.overdueNow).toBe('Hazırda gecikən icralar');
    expect(az.reports.attention.critical).toBe('Kritik problemlər');
    for (const k of ['noneOverdue', 'noneCritical'] as const) expect(az.reports.attention[k], k).toBeTypeOf('string');
    expect(az.reports.table.more).toBe('Daha çox göstər');
    expect(az.reports.table.sort).toBe('{{column}} üzrə sırala');
    expect(az.reports.table.openTask).toBe('Tapşırığı aç');
    expect(az.reports.table.receivedAt).toBe('Serverə çatıb: {{time}}');
    // Part 1's keys are untouched.
    expect(az.reports.dashboard).toBe('İdarə paneli');
    expect(az.reports.export.thisTable).toBe('Bu cədvəl');
    expect(az.reports.measures.completionHint).toBe('Vaxtı çatmış icralardan tamamlananların payı');
    expect(az.nav.reports).toBe('Hesabatlar');
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/i18n test`
Expected: FAIL: `az.reports.range` is `undefined`.

- [ ] **Step 3: Implement**

In `packages/i18n/src/az/reports.ts`, add these keys at the end of the exported object, after Part 1's last key `issues` (before `} as const;`):

```ts
  // ---- Web (Part 3): the filter bar, the tiles, the trend, the dashboard and the report tables ----
  range: {
    label: '{{from}} – {{to}}',
    incomplete: 'Başlanğıc və son tarixi seçin.',
  },
  picker: {
    unknown: 'Seçilmiş (siyahıda yoxdur)',
    unknownEmployee: 'Seçilmiş əməkdaş (bu dövrdə icrası yoxdur)',
  },
  tiles: {
    link: '{{label}}: {{value}}',
  },
  chart: {
    table: 'Gündəlik icra cədvəli',
  },
  live: {
    refresh: 'Yenilə',
    updatedAt: 'Son yenilənmə: {{time}}',
  },
  attention: {
    title: 'Diqqət tələb edir',
    overdueNow: 'Hazırda gecikən icralar',
    critical: 'Kritik problemlər',
    noneOverdue: 'Hazırda gecikən icra yoxdur.',
    noneCritical: 'Bu dövrdə kritik problem yoxdur.',
  },
  table: {
    more: 'Daha çox göstər',
    sort: '{{column}} üzrə sırala',
    openTask: 'Tapşırığı aç',
    receivedAt: 'Serverə çatıb: {{time}}',
  },
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/i18n test && pnpm --filter @taskop/i18n build`
Expected: PASS. The build makes the new keys visible to `apps/web`.

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/src/az/reports.ts packages/i18n/src/i18n.test.ts
git commit -m "feat(i18n): add web strings for the report filters, tiles, dashboard and tables" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The report URL model and period resolution

**Files:**
- Create: `apps/web/src/features/reports/search.ts`
- Test: `apps/web/src/features/reports/search.test.ts`

**Interfaces:**
- Consumes: Part 1: `PERIOD_PRESETS`, `type PeriodPreset`, `resolvePeriod(preset, today)`, `reportRangeTooLong(from, to)`, `REPORT_KINDS`, `type ReportKind`, `RUN_BUCKETS`, `type RunBucket`, `type ReportFilters`; existing: `idSchema`, `localDateSchema`, `dayNumber`, `PROBLEM_SEVERITIES`, `type ProblemSeverity` (all `@taskop/contracts`).
- Produces:
  - `type PeriodChoice = PeriodPreset | 'custom'`; `PERIOD_CHOICES: readonly PeriodChoice[]`; `DEFAULT_PERIOD: PeriodPreset = 'today'`; `DEFAULT_TAB: ReportKind = 'summary'`; `DEFAULT_BUCKET: RunBucket = 'all'`
  - `interface ReportSearch { period?; from?; to?; siteId?; userId?; checklistId?; inactive?: true }`; `interface ReportsPageSearch extends ReportSearch { tab?: ReportKind; bucket?: RunBucket; severity?: ProblemSeverity }`
  - `reportSearch(s: Record<string, unknown>): ReportSearch` (validator of `/`); `reportsPageSearch(s): ReportsPageSearch` (validator of `/reports`)
  - `filterSearch(s: ReportSearch): ReportSearch` (the shared filters only); `pageExtras(s: ReportsPageSearch): Pick<ReportsPageSearch, 'tab' | 'bucket' | 'severity'>`; `cleanSearch<T extends object>(s: T): T` (drops `undefined`, `''`, `null`)
  - `type FilterIssue = 'incomplete' | 'toBeforeFrom' | 'tooLong'`; `FILTER_ISSUE_KEYS: Record<FilterIssue, string>`; `type ResolvedFilters = { ok: true; filters: ReportFilters } | { ok: false; issue: FilterIssue }`; `resolveReportFilters(s: ReportSearch, today: string): ResolvedFilters`
  - `withPeriod(s: ReportSearch, choice: PeriodChoice, today: string): ReportSearch`

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/reports/search.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cleanSearch, filterSearch, pageExtras, reportSearch, reportsPageSearch, resolveReportFilters, withPeriod } from './search';

const SITE = '0192f1e2-7c3a-7b4d-8e5f-0000000000b2';
const USER = '0192f1e2-7c3a-7b4d-8e5f-0000000000c1';
const LIST = '0192f1e2-7c3a-7b4d-8e5f-0000000000d1';
/** A Wednesday. */
const TODAY = '2026-11-04';

describe('reportsPageSearch', () => {
  it('keeps every valid parameter of a shared URL', () => {
    const s = {
      period: 'custom',
      from: '2026-10-01',
      to: '2026-10-31',
      siteId: SITE,
      userId: USER,
      checklistId: LIST,
      inactive: true,
      tab: 'runs',
      bucket: 'missed',
      severity: 'critical',
    };
    expect(reportsPageSearch(s)).toEqual(s);
  });

  it('drops what a hand-edited or old bookmark gets wrong', () => {
    expect(
      reportsPageSearch({ period: 'last_90', from: '2026-02-30', siteId: 'site-1', userId: 42, checklistId: '', tab: 'audit', bucket: 'late', severity: 'major', inactive: 'yes' }),
    ).toEqual({});
    // A range belongs to the custom period only: a preset ignores a leftover one.
    expect(reportsPageSearch({ period: 'this_week', from: '2026-10-01', to: '2026-10-31' })).toEqual({ period: 'this_week' });
    expect(reportsPageSearch({ from: '2026-10-01', to: '2026-10-31' })).toEqual({});
    // A custom period keeps a half-typed range, so the filter bar can ask for the other end.
    expect(reportsPageSearch({ period: 'custom', from: '2026-10-01', to: 'tomorrow' })).toEqual({ period: 'custom', from: '2026-10-01' });
  });

  it('reads "show inactive" both as the router parses it and as a raw string', () => {
    expect(reportSearch({ inactive: true })).toEqual({ inactive: true });
    expect(reportSearch({ inactive: 'true' })).toEqual({ inactive: true });
    expect(reportSearch({ inactive: false })).toEqual({});
  });

  it('gives the dashboard only the shared filters', () => {
    expect(reportSearch({ period: 'last_7', siteId: SITE, tab: 'runs', bucket: 'overdue' })).toEqual({ period: 'last_7', siteId: SITE });
  });
});

describe('resolveReportFilters', () => {
  it("resolves the presets from the tenant's today, Today by default", () => {
    const range = (from: string, to = TODAY) => ({ ok: true, filters: { from, to } });
    expect(resolveReportFilters({}, TODAY)).toEqual(range(TODAY));
    expect(resolveReportFilters({ period: 'yesterday' }, TODAY)).toEqual(range('2026-11-03', '2026-11-03'));
    expect(resolveReportFilters({ period: 'this_week' }, TODAY)).toEqual(range('2026-11-02'));
    expect(resolveReportFilters({ period: 'this_month' }, TODAY)).toEqual(range('2026-11-01'));
    expect(resolveReportFilters({ period: 'last_7' }, TODAY)).toEqual(range('2026-10-29'));
    expect(resolveReportFilters({ period: 'last_30' }, TODAY)).toEqual(range('2026-10-06'));
  });

  it('adds the site, employee and checklist, never the picker toggle', () => {
    expect(resolveReportFilters({ siteId: SITE, userId: USER, checklistId: LIST, inactive: true }, TODAY)).toEqual({
      ok: true,
      filters: { from: TODAY, to: TODAY, siteId: SITE, userId: USER, checklistId: LIST },
    });
  });

  it('checks a custom range before anything is asked', () => {
    expect(resolveReportFilters({ period: 'custom', from: '2026-10-01' }, TODAY)).toEqual({ ok: false, issue: 'incomplete' });
    expect(resolveReportFilters({ period: 'custom', from: '2026-10-31', to: '2026-10-01' }, TODAY)).toEqual({ ok: false, issue: 'toBeforeFrom' });
    // 366 days (to − from = 365) is the longest range; one day more is refused, as the API would.
    expect(resolveReportFilters({ period: 'custom', from: '2025-11-05', to: '2026-11-05' }, TODAY)).toEqual({ ok: true, filters: { from: '2025-11-05', to: '2026-11-05' } });
    expect(resolveReportFilters({ period: 'custom', from: '2025-11-04', to: '2026-11-05' }, TODAY)).toEqual({ ok: false, issue: 'tooLong' });
    expect(resolveReportFilters({ period: 'custom', from: '2026-10-07', to: '2026-10-07', siteId: SITE }, TODAY)).toEqual({
      ok: true,
      filters: { from: '2026-10-07', to: '2026-10-07', siteId: SITE },
    });
  });
});

describe('withPeriod', () => {
  it('pre-fills a custom range with the current period and keeps the other filters', () => {
    expect(withPeriod({ period: 'this_week', siteId: SITE, inactive: true }, 'custom', TODAY)).toEqual({
      period: 'custom',
      from: '2026-11-02',
      to: TODAY,
      siteId: SITE,
      inactive: true,
    });
  });

  it('drops the range when a preset is chosen', () => {
    expect(withPeriod({ period: 'custom', from: '2026-10-01', to: '2026-10-31', userId: USER }, 'last_7', TODAY)).toEqual({ period: 'last_7', userId: USER });
  });

  it('starts an unusable custom range over at today', () => {
    expect(withPeriod({ period: 'custom', from: '2026-10-31', to: '2026-10-01' }, 'custom', TODAY)).toEqual({ period: 'custom', from: TODAY, to: TODAY });
  });
});

describe('search parts', () => {
  it('splits the shared filters from the page parameters and drops empty values', () => {
    const s = { period: 'custom', from: '2026-10-01', to: '2026-10-31', siteId: SITE, inactive: true, tab: 'runs', bucket: 'overdue', severity: 'critical' } as const;
    expect(filterSearch(s)).toEqual({ period: 'custom', from: '2026-10-01', to: '2026-10-31', siteId: SITE, inactive: true });
    expect(pageExtras(s)).toEqual({ tab: 'runs', bucket: 'overdue', severity: 'critical' });
    expect(cleanSearch({ period: 'today', siteId: '', userId: undefined, checklistId: null })).toEqual({ period: 'today' });
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/web test -- features/reports/search`
Expected: FAIL: `Failed to resolve import "./search"`.

- [ ] **Step 3: Implement**

`apps/web/src/features/reports/search.ts`:

```ts
import {
  dayNumber,
  idSchema,
  localDateSchema,
  PERIOD_PRESETS,
  type PeriodPreset,
  PROBLEM_SEVERITIES,
  type ProblemSeverity,
  REPORT_KINDS,
  type ReportFilters,
  type ReportKind,
  reportRangeTooLong,
  resolvePeriod,
  RUN_BUCKETS,
  type RunBucket,
} from '@taskop/contracts';

/** The period picker: Part 1's presets, then the UI's own "custom" (Part 1: "Custom" is not a preset). */
export type PeriodChoice = PeriodPreset | 'custom';
export const PERIOD_CHOICES: readonly PeriodChoice[] = [...PERIOD_PRESETS, 'custom'];
export const DEFAULT_PERIOD: PeriodPreset = 'today';
export const DEFAULT_TAB: ReportKind = 'summary';
export const DEFAULT_BUCKET: RunBucket = 'all';

/**
 * The filters shared by `/` and `/reports` (spec §6.1–6.2). Absent means the default: Today, everything in the viewer's
 * scope, and only active entries in the pickers.
 */
export interface ReportSearch {
  period?: PeriodChoice;
  /** Only with `period: 'custom'`. */
  from?: string;
  to?: string;
  siteId?: string;
  userId?: string;
  checklistId?: string;
  /** "Deaktivləri göstər": the pickers also list inactive sites, people and checklists. */
  inactive?: true;
}

/** `/reports`: the shared filters, the open tab, the runs bucket and the problems severity. */
export interface ReportsPageSearch extends ReportSearch {
  tab?: ReportKind;
  bucket?: RunBucket;
  severity?: ProblemSeverity;
}

const isId = (v: unknown): v is string => idSchema.safeParse(v).success;
const isDate = (v: unknown): v is string => localDateSchema.safeParse(v).success;
const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

function pick<T extends object, K extends keyof T>(o: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

/** `validateSearch` of `/`. Anything invalid is dropped here, so it is never sent to the API. */
export function reportSearch(s: Record<string, unknown>): ReportSearch {
  const period = isOneOf(PERIOD_CHOICES, s.period) ? s.period : undefined;
  const custom = period === 'custom';
  return {
    ...(period ? { period } : {}),
    ...(custom && isDate(s.from) ? { from: s.from } : {}),
    ...(custom && isDate(s.to) ? { to: s.to } : {}),
    ...(isId(s.siteId) ? { siteId: s.siteId } : {}),
    ...(isId(s.userId) ? { userId: s.userId } : {}),
    ...(isId(s.checklistId) ? { checklistId: s.checklistId } : {}),
    // The router parses `inactive=true` into a boolean; a hand-written link may keep the string.
    ...(s.inactive === true || s.inactive === 'true' ? { inactive: true as const } : {}),
  };
}

/** `validateSearch` of `/reports`. */
export function reportsPageSearch(s: Record<string, unknown>): ReportsPageSearch {
  return {
    ...reportSearch(s),
    ...(isOneOf(REPORT_KINDS, s.tab) ? { tab: s.tab } : {}),
    ...(isOneOf(RUN_BUCKETS, s.bucket) ? { bucket: s.bucket } : {}),
    ...(isOneOf(PROBLEM_SEVERITIES, s.severity) ? { severity: s.severity } : {}),
  };
}

const FILTER_KEYS = ['period', 'from', 'to', 'siteId', 'userId', 'checklistId', 'inactive'] as const;
const PAGE_KEYS = ['tab', 'bucket', 'severity'] as const;

/** The filters a tile or a page switch carries along. */
export const filterSearch = (s: ReportSearch): ReportSearch => pick(s, FILTER_KEYS);
export const pageExtras = (s: ReportsPageSearch): Pick<ReportsPageSearch, 'tab' | 'bucket' | 'severity'> => pick(s, PAGE_KEYS);

/** Drops empty values: a select set back to "all", a cleared date field. */
export function cleanSearch<T extends object>(s: T): T {
  return Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as T;
}

export type FilterIssue = 'incomplete' | 'toBeforeFrom' | 'tooLong';
export const FILTER_ISSUE_KEYS: Record<FilterIssue, string> = {
  incomplete: 'reports.range.incomplete',
  toBeforeFrom: 'reports.issues.toBeforeFrom',
  tooLong: 'errors.REPORT_RANGE_TOO_LONG',
};

export type ResolvedFilters = { ok: true; filters: ReportFilters } | { ok: false; issue: FilterIssue };

/**
 * The API's filters for a search, from the tenant's today. A custom range the API would refuse (spec §5.2) comes back
 * as an issue instead, and the caller asks for nothing.
 */
export function resolveReportFilters(s: ReportSearch, today: string): ResolvedFilters {
  const period = s.period ?? DEFAULT_PERIOD;
  let range: { from: string; to: string };
  if (period === 'custom') {
    if (!s.from || !s.to) return { ok: false, issue: 'incomplete' };
    if (dayNumber(s.to) < dayNumber(s.from)) return { ok: false, issue: 'toBeforeFrom' };
    if (reportRangeTooLong(s.from, s.to)) return { ok: false, issue: 'tooLong' };
    range = { from: s.from, to: s.to };
  } else {
    range = resolvePeriod(period, today);
  }
  return { ok: true, filters: { ...range, ...pick(s, ['siteId', 'userId', 'checklistId'] as const) } };
}

/** The search after choosing a period: a custom range starts from the period shown now; a preset drops the range. */
export function withPeriod(s: ReportSearch, choice: PeriodChoice, today: string): ReportSearch {
  const rest = pick(s, ['siteId', 'userId', 'checklistId', 'inactive'] as const);
  if (choice !== 'custom') return { period: choice, ...rest };
  const current = resolveReportFilters(s, today);
  const range = current.ok ? { from: current.filters.from, to: current.filters.to } : { from: today, to: today };
  return { period: 'custom', ...range, ...rest };
}
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/reports/search && pnpm --filter @taskop/web typecheck`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/reports/search.ts apps/web/src/features/reports/search.test.ts
git commit -m "feat(web): add the report URL model and period resolution" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Report helpers, queries, the file download, the report drawers and test fixtures

**Files:**
- Create: `apps/web/src/features/reports/labels.ts`, `apps/web/src/features/reports/queries.ts`, `apps/web/src/features/reports/download.ts`, `apps/web/src/features/reports/drawers.tsx`, `apps/web/src/features/reports/fixtures.ts`
- Test: `apps/web/src/features/reports/labels.test.ts`, `apps/web/src/features/reports/download.test.ts`, `apps/web/src/features/reports/drawers.test.tsx`

**Interfaces:**
- Consumes:
  - Part 1: `api.reports.{summary, sites, employees, runs, problems, tasks}`; `ReportFile` and `ApiError.rows` / `.limit` (`@taskop/api-client`); types `ReportFilters`, `ReportExportKind`, `ReportExportQuery`, `ReportFormat`, `RunBucket`, `RunCountKey`, `RunCounts`, `EmployeeReportRow`, `SiteReportRow`, `ReportSummary`, `ReportRun`, `ReportProblem`, `ReportProblems`, `ReportTask`, `ReportTasks`; `emptyRunCounts`
  - Task 2: `filterSearch`, `ReportSearch`, `ReportsPageSearch`
  - Existing: `formatPercent` (`features/executions/labels`), `buildTree`, `SiteNode` (`features/sites/tree`), `errorText` (`lib/errors`), `OccurrenceDialog`, `OccurrenceTab` (`features/scheduling/occurrence-dialog`), `TaskDrawer` (`features/tasks/task-drawer`), `problemDto` (`features/tasks/fixtures`), `occurrenceDetail` (`features/executions/fixtures`), `taskDetail` (`features/tasks/fixtures`)
- Produces:
  - `labels.ts`: `type TileKey`; `TILE_BUCKETS: Record<TileKey, RunBucket>`; `DASHBOARD_TILES`, `SUMMARY_TILES: readonly TileKey[]`; `tileSearch(s: ReportSearch, key: TileKey): ReportsPageSearch`; `percentText(t, value: number | null, locale: string): string`; `isSingleDay(f: { from; to }): boolean`; `interface SortState<K> { key: K; dir: 'asc' | 'desc' }`; `sortRows<T, K extends keyof T>(rows, sort: SortState<K> | null, pinLast?): T[]`; `nextSort<K extends string>(current, key: K): SortState<K>`; `siteOptions(sites: readonly SiteDto[], showInactive: boolean, selectedId?: string): SiteDto[]`; `interface EmployeeOption { id; name; active }`; `employeeOptions(rows: readonly EmployeeReportRow[], showInactive, selectedId?): EmployeeOption[]`; `checklistOptions(list: readonly ChecklistSummary[], showInactive, selectedId?): ChecklistSummary[]`; `exportQuery(kind: ReportExportKind, filters: ReportFilters, format: ReportFormat, extra: { bucket?: RunBucket; severity?: ProblemSeverity }): ReportExportQuery`; `exportErrorText(t, e: unknown): string`
  - `queries.ts`: `DASHBOARD_REFETCH_MS = 60_000`, `ATTENTION_LIMIT = 10`; `reportKeys` (`all`, `summary(f)`, `sites(f)`, `employees(f)`, `runs(f, bucket)`, `problems(f, severity)`, `tasks(f)`, `overdueNow(f)`, `critical(f)`); `useReportSummary(f: ReportFilters | null, o?: { live?: boolean })`, `useSiteReport(f)`, `useEmployeeReport(f)`, `useReportRuns(f, bucket)`, `useReportProblems(f, severity: ProblemSeverity | null)`, `useReportTasks(f)`, `useOverdueNow(f: ReportFilters | null, today: string)`, `useCriticalProblems(f: ReportFilters | null)`, `useEmployeeOptions(f: ReportFilters | null)`, `useReportChecklistOptions(enabled: boolean)`
  - `download.ts`: `REVOKE_AFTER_MS = 60_000`; `saveFile(file: ReportFile): void`
  - `drawers.tsx`: `RunDrawer({ id, tab?, onClose })`, `ReportTaskDrawer({ id, onClose })`
  - `fixtures.ts` (tests only): `TODAY`, `IDS`, `counts(over?)`, `reportSummary(over?)`, `siteRow(over?)`, `SITE_ROWS`, `employeeRow(over?)`, `EMPLOYEE_ROWS`, `reportRun(over?)`, `completedRun(over?)`, `reportProblem(over?)`, `reportProblems(items?, over?)`, `reportTask(over?)`, `reportTasks(items?, over?)`, `page(items, nextCursor?)`, `SITES`, `CHECKLISTS`, `meWith(permissions, tenant?)`, `VIEWER`

- [ ] **Step 1: Add the shared test fixtures**

`apps/web/src/features/reports/fixtures.ts`:

```ts
import {
  type ChecklistSummary,
  type EmployeeReportRow,
  emptyRunCounts,
  type ReportProblem,
  type ReportProblems,
  type ReportRun,
  type ReportSummary,
  type ReportTask,
  type ReportTasks,
  type RunCounts,
  type SiteDto,
  type SiteReportRow,
} from '@taskop/contracts';
import { problemDto } from '@/features/tasks/fixtures';

/** Test data shared by the report tests. Not imported by application code. */

/** A Wednesday. */
export const TODAY = '2026-11-04';
/** Valid UUIDv7s: the URL validator checks ids. */
const uuid = (n: number) => `0192f1e2-7c3a-7b4d-8e5f-${n.toString(16).padStart(12, '0')}`;
export const IDS = {
  branch: uuid(0xb1),
  zoneA: uuid(0xb2),
  zoneB: uuid(0xb3),
  aynur: uuid(0xc1),
  kamran: uuid(0xc2),
  rauf: uuid(0xc3),
  stranger: uuid(0xc9),
  checklist: uuid(0xd1),
  oldChecklist: uuid(0xd2),
  run: uuid(0xe1),
  run2: uuid(0xe2),
  execution: uuid(0xe9),
  problem: uuid(0xa1),
  task: uuid(0xf1),
  task2: uuid(0xf2),
} as const;

const AYNUR = { id: IDS.aynur, fullName: 'Aynur Quliyeva' };
const KAMRAN = { id: IDS.kamran, fullName: 'Kamran Əliyev' };

export const counts = (over: Partial<RunCounts> = {}): RunCounts => ({ ...emptyRunCounts(), ...over });

/** 12 planned, 10 due (7 completed, 1 in progress, 1 overdue, 1 partial), 2 pending; three days of trend. */
export const reportSummary = (over: Partial<ReportSummary> = {}): ReportSummary => ({
  counts: counts({ planned: 12, due: 10, completed: 7, inProgress: 1, pending: 2, overdue: 1, partial: 1, withProblems: 2, withCritical: 1 }),
  completionPercent: 70,
  averageScore: 87.5,
  trend: [
    { date: '2026-11-02', due: 4, completed: 3, completionPercent: 75 },
    { date: '2026-11-03', due: 0, completed: 0, completionPercent: null },
    { date: TODAY, due: 6, completed: 4, completionPercent: 66.7 },
  ],
  ...over,
});

export const siteRow = (over: Partial<SiteReportRow> = {}): SiteReportRow => ({
  ...counts({ planned: 8, due: 6, completed: 5, overdue: 1 }),
  siteId: IDS.zoneA,
  name: 'Zona A1',
  path: ['Filial A'],
  active: true,
  completionPercent: 83.3,
  averageScore: 90,
  ...over,
});

/** In tree order: the branch, its active zone, its deactivated zone (no due runs, so no percentages). */
export const SITE_ROWS: SiteReportRow[] = [
  siteRow({ siteId: IDS.branch, name: 'Filial A', path: [], planned: 4, due: 4, completed: 2, overdue: 0, missed: 2, completionPercent: 50, averageScore: 70 }),
  siteRow(),
  siteRow({ siteId: IDS.zoneB, name: 'Zona B (köhnə)', active: false, planned: 1, due: 0, completed: 0, overdue: 0, pending: 1, completionPercent: null, averageScore: null }),
];

export const employeeRow = (over: Partial<EmployeeReportRow> = {}): EmployeeReportRow => ({
  ...counts({ planned: 5, due: 5, completed: 4, missed: 1 }),
  userId: IDS.aynur,
  name: 'Aynur Quliyeva',
  active: true,
  completionPercent: 80,
  averageScore: 91,
  ...over,
});

/** By name, a deactivated person among them, the Unassigned row last (Part 1 decision 9). */
export const EMPLOYEE_ROWS: EmployeeReportRow[] = [
  employeeRow(),
  employeeRow({ userId: IDS.kamran, name: 'Kamran Əliyev', planned: 3, due: 3, completed: 1, missed: 2, completionPercent: 33.3, averageScore: 75 }),
  employeeRow({ userId: IDS.rauf, name: 'Rauf Həsənov', active: false, planned: 1, due: 1, completed: 1, missed: 0, completionPercent: 100, averageScore: 60 }),
  employeeRow({ userId: null, name: 'Təyin edilməyib', planned: 9, due: 9, completed: 0, missed: 9, completionPercent: 0, averageScore: null }),
];

/** Overdue, never started, two assignees; due 10:00 in Baku. */
export const reportRun = (over: Partial<ReportRun> = {}): ReportRun => ({
  occurrenceId: IDS.run,
  executionId: null,
  localDate: TODAY,
  dueAt: '2026-11-04T06:00:00.000Z',
  checklist: { id: IDS.checklist, name: 'Açılış yoxlaması' },
  site: { id: IDS.zoneA, name: 'Zona A1' },
  status: 'overdue',
  assignees: [AYNUR, KAMRAN],
  executor: null,
  startedAt: null,
  completedAt: null,
  completedReceivedAt: null,
  score: null,
  problemCount: 0,
  criticalCount: 0,
  late: false,
  clockSuspect: false,
  ...over,
});

/** Completed by Aynur offline at 09:40 Baku, received at 13:00; late, clock-suspect, two problems, one critical. */
export const completedRun = (over: Partial<ReportRun> = {}): ReportRun =>
  reportRun({
    occurrenceId: IDS.run2,
    executionId: IDS.execution,
    status: 'completed',
    executor: AYNUR,
    startedAt: '2026-11-04T05:10:00.000Z',
    completedAt: '2026-11-04T05:40:00.000Z',
    completedReceivedAt: '2026-11-04T09:00:00.000Z',
    score: 87.5,
    problemCount: 2,
    criticalCount: 1,
    late: true,
    clockSuspect: true,
    ...over,
  });

/** A critical manual problem of run2 with an open task in progress. */
export const reportProblem = (over: Partial<ReportProblem> = {}): ReportProblem => ({
  ...problemDto({
    id: IDS.problem,
    executionId: IDS.execution,
    occurrenceId: IDS.run2,
    localDate: TODAY,
    siteId: IDS.zoneA,
    siteName: 'Zona A1',
    checklistId: IDS.checklist,
    checklistName: 'Açılış yoxlaması',
    itemLabel: 'Soyuducunun temperaturu',
    note: 'Kondisioner xarabdır',
    executorName: 'Aynur Quliyeva',
    resolution: 'open',
    taskId: IDS.task,
  }),
  taskStatus: 'in_progress',
  ...over,
});

export const reportProblems = (items: ReportProblem[] = [reportProblem()], over: Partial<ReportProblems> = {}): ReportProblems => ({
  counts: { total: 3, critical: 1, resolution: { none: 1, open: 1, resolved: 1, cancelled: 0 } },
  items,
  nextCursor: null,
  ...over,
});

/** High priority, in progress, overdue, due 18:00 Baku, assigned to Kamran. */
export const reportTask = (over: Partial<ReportTask> = {}): ReportTask => ({
  id: IDS.task,
  title: 'Kondisioneri təmir et',
  priority: 'high',
  status: 'in_progress',
  site: { id: IDS.zoneA, name: 'Zona A1' },
  assignee: KAMRAN,
  team: null,
  dueAt: '2026-11-04T14:00:00.000Z',
  completedAt: null,
  createdAt: '2026-11-04T07:00:00.000Z',
  overdue: true,
  problemId: IDS.problem,
  ...over,
});

export const reportTasks = (items: ReportTask[] = [reportTask()], over: Partial<ReportTasks> = {}): ReportTasks => ({
  counts: {
    byStatus: { new: 1, accepted: 0, in_progress: 2, awaiting_review: 1, completed: 3, cancelled: 0 },
    overdueOpen: 1,
    completedOnTime: 2,
    completedLate: 1,
  },
  items,
  nextCursor: null,
  ...over,
});

export const page = <T,>(items: T[], nextCursor: string | null = null) => ({ items, nextCursor });

/** A branch with an active and a deactivated zone (GET /sites). */
export const SITES: SiteDto[] = [
  { id: IDS.branch, parentId: null, typeId: 'type1', name: 'Filial A', address: null, active: true, path: 'a', depth: 0 },
  { id: IDS.zoneA, parentId: IDS.branch, typeId: 'type2', name: 'Zona A1', address: null, active: true, path: 'a.b', depth: 1 },
  { id: IDS.zoneB, parentId: IDS.branch, typeId: 'type2', name: 'Zona B (köhnə)', address: null, active: false, path: 'a.c', depth: 1 },
];

const checklist = (over: Partial<ChecklistSummary>): ChecklistSummary => ({
  id: IDS.checklist,
  name: 'Açılış yoxlaması',
  description: null,
  category: null,
  status: 'active',
  currentVersionNumber: 1,
  draftRevision: null,
  updatedAt: '2026-11-01T08:00:00.000Z',
  ...over,
});
export const CHECKLISTS: ChecklistSummary[] = [checklist({}), checklist({ id: IDS.oldChecklist, name: 'Köhnə yoxlama', status: 'deactivated' })];

/** The signed-in user as `useMe()` returns it in the report tests. */
export const meWith = (permissions: readonly string[], tenant: { timezone?: string } = {}) => ({
  user: { id: 'me1', fullName: 'Leyla Quliyeva' },
  role: { id: 'r1', name: 'Manager', systemKey: 'manager', dataScope: 'site_subtree' },
  permissions: [...permissions],
  tenant: { id: 't1', name: 'Acme MMC', orgCode: 'acme', timezone: tenant.timezone ?? 'Asia/Baku', locale: 'az' },
});

/** A report viewer who may also list sites and checklists (as Manager and Auditor may). */
export const VIEWER = ['reports.view', 'sites.view', 'checklists.view'] as const;
```

- [ ] **Step 2: Write the failing tests**

`apps/web/src/features/reports/labels.test.ts`:

```ts
import { ApiError } from '@taskop/api-client';
import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { CHECKLISTS, EMPLOYEE_ROWS, IDS, SITE_ROWS, SITES } from './fixtures';
import {
  checklistOptions,
  employeeOptions,
  exportErrorText,
  exportQuery,
  nextSort,
  percentText,
  siteOptions,
  sortRows,
  SUMMARY_TILES,
  tileSearch,
} from './labels';

const t = i18n.t.bind(i18n);
const FILTERS = { from: '2026-11-01', to: '2026-11-30', siteId: IDS.zoneA };

describe('tiles', () => {
  it('links each count to the runs report of its bucket, with the same filters', () => {
    const search = { period: 'last_7', siteId: IDS.zoneA, inactive: true } as const;
    expect(SUMMARY_TILES.map((k) => [k, tileSearch(search, k).bucket])).toEqual([
      ['planned', 'all'],
      ['completed', 'completed'],
      ['inProgress', 'in_progress'],
      ['overdue', 'overdue'],
      ['partial', 'partial'],
      ['missed', 'missed'],
      ['withProblems', 'problems'],
    ]);
    expect(tileSearch(search, 'overdue')).toEqual({ period: 'last_7', siteId: IDS.zoneA, inactive: true, tab: 'runs', bucket: 'overdue' });
  });

  it('shows percentages with one decimal, and a dash when there is none', () => {
    expect(percentText(t, 70, 'az')).toBe('70%');
    expect(percentText(t, 87.5, 'az')).toBe('87,5%');
    expect(percentText(t, 0, 'az')).toBe('0%');
    expect(percentText(t, null, 'az')).toBe('—');
  });
});

describe('sortRows', () => {
  const pct = (rows: { name: string }[]) => rows.map((r) => r.name);

  it('keeps the server order without a sort, sorts numbers with missing values last, and reverses', () => {
    expect(pct(sortRows(SITE_ROWS, null))).toEqual(['Filial A', 'Zona A1', 'Zona B (köhnə)']);
    expect(pct(sortRows(SITE_ROWS, { key: 'completionPercent', dir: 'desc' }))).toEqual(['Zona A1', 'Filial A', 'Zona B (köhnə)']);
    expect(pct(sortRows(SITE_ROWS, { key: 'completionPercent', dir: 'asc' }))).toEqual(['Filial A', 'Zona A1', 'Zona B (köhnə)']);
    expect(pct(sortRows(SITE_ROWS, { key: 'name', dir: 'desc' }))).toEqual(['Zona B (köhnə)', 'Zona A1', 'Filial A']);
  });

  it('keeps a pinned row last whatever the sort', () => {
    const unassigned = (r: { userId: string | null }) => r.userId === null;
    expect(pct(sortRows(EMPLOYEE_ROWS, { key: 'planned', dir: 'desc' }, unassigned))).toEqual(['Aynur Quliyeva', 'Kamran Əliyev', 'Rauf Həsənov', 'Təyin edilməyib']);
    expect(pct(sortRows(EMPLOYEE_ROWS, { key: 'name', dir: 'desc' }, unassigned))).toEqual(['Rauf Həsənov', 'Kamran Əliyev', 'Aynur Quliyeva', 'Təyin edilməyib']);
  });

  it('sorts names A to Z and numbers high to low first, then reverses', () => {
    expect(nextSort(null, 'name')).toEqual({ key: 'name', dir: 'asc' });
    expect(nextSort(null, 'planned')).toEqual({ key: 'planned', dir: 'desc' });
    expect(nextSort({ key: 'planned', dir: 'desc' }, 'planned')).toEqual({ key: 'planned', dir: 'asc' });
    expect(nextSort({ key: 'planned', dir: 'asc' }, 'missed')).toEqual({ key: 'missed', dir: 'desc' });
  });
});

describe('picker options', () => {
  it('lists sites in tree order, inactive ones only when asked or selected', () => {
    expect(siteOptions(SITES, false).map((s) => s.name)).toEqual(['Filial A', 'Zona A1']);
    expect(siteOptions(SITES, true).map((s) => s.name)).toEqual(['Filial A', 'Zona A1', 'Zona B (köhnə)']);
    expect(siteOptions(SITES, false, IDS.zoneB).map((s) => s.name)).toEqual(['Filial A', 'Zona A1', 'Zona B (köhnə)']);
  });

  it('lists the period’s people without the Unassigned row, deactivated ones only when asked or selected', () => {
    expect(employeeOptions(EMPLOYEE_ROWS, false)).toEqual([
      { id: IDS.aynur, name: 'Aynur Quliyeva', active: true },
      { id: IDS.kamran, name: 'Kamran Əliyev', active: true },
    ]);
    expect(employeeOptions(EMPLOYEE_ROWS, true).map((e) => e.name)).toEqual(['Aynur Quliyeva', 'Kamran Əliyev', 'Rauf Həsənov']);
    expect(employeeOptions(EMPLOYEE_ROWS, false, IDS.rauf).map((e) => e.name)).toEqual(['Aynur Quliyeva', 'Kamran Əliyev', 'Rauf Həsənov']);
  });

  it('lists active checklists by name, deactivated ones only when asked or selected', () => {
    expect(checklistOptions(CHECKLISTS, false).map((c) => c.name)).toEqual(['Açılış yoxlaması']);
    expect(checklistOptions([...CHECKLISTS].reverse(), true).map((c) => c.name)).toEqual(['Açılış yoxlaması', 'Köhnə yoxlama']);
    expect(checklistOptions(CHECKLISTS, false, IDS.oldChecklist).map((c) => c.name)).toEqual(['Açılış yoxlaması', 'Köhnə yoxlama']);
  });
});

describe('exports', () => {
  it('sends the bucket with runs and the severity with problems, nothing extra otherwise', () => {
    const extra = { bucket: 'overdue', severity: 'critical' } as const;
    expect(exportQuery('runs', FILTERS, 'xlsx', extra)).toEqual({ ...FILTERS, format: 'xlsx', bucket: 'overdue' });
    expect(exportQuery('problems', FILTERS, 'csv', extra)).toEqual({ ...FILTERS, format: 'csv', severity: 'critical' });
    expect(exportQuery('sites', FILTERS, 'pdf', extra)).toEqual({ ...FILTERS, format: 'pdf' });
    expect(exportQuery('full', FILTERS, 'pdf', extra)).toEqual({ ...FILTERS, format: 'pdf' });
    expect(exportQuery('problems', FILTERS, 'csv', {})).toEqual({ ...FILTERS, format: 'csv' });
  });

  it('explains a too large export with its row count and limit, other errors from az.errors', () => {
    const tooLarge = new ApiError(422, 'REPORT_TOO_LARGE', 'errors.REPORT_TOO_LARGE', null, null, 'r1', null, null, null, null, 12000, 10000);
    expect(exportErrorText(t, tooLarge)).toBe('Hesabatda 12000 sətir var (limit 10000). Filtrləri daraldın.');
    const timeout = new ApiError(503, 'REPORT_TIMEOUT', 'errors.REPORT_TIMEOUT');
    expect(exportErrorText(t, timeout)).toBe('Hesabat vaxtında hazırlanmadı. Dövrü qısaldın və ya bir az sonra yenidən cəhd edin.');
  });
});
```

`apps/web/src/features/reports/download.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REVOKE_AFTER_MS, saveFile } from './download';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('saveFile', () => {
  it('saves the blob under the server’s file name and frees the object URL afterwards', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:report');
    const revokeObjectURL = vi.fn();
    // jsdom has no object URLs.
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clicked: Array<{ href: string | null; download: string; attached: boolean }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.getAttribute('href'), download: this.download, attached: this.isConnected });
    });
    const blob = new Blob(['x']);

    saveFile({ blob, filename: 'taskop-runs-2026-11-01_2026-11-30.xlsx' });

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toEqual([{ href: 'blob:report', download: 'taskop-runs-2026-11-01_2026-11-30.xlsx', attached: true }]);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REVOKE_AFTER_MS);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');
  });
});
```

`apps/web/src/features/reports/drawers.test.tsx`:

```ts
import { QueryClient } from '@tanstack/react-query';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { occurrenceDetail } from '@/features/executions/fixtures';
import { taskDetail } from '@/features/tasks/fixtures';
import { renderWithRouter } from '@/test/router';
import { ReportTaskDrawer, RunDrawer } from './drawers';
import { IDS, meWith, VIEWER } from './fixtures';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: { occurrences: { get: vi.fn(), cancel: vi.fn() }, executions: { get: vi.fn() }, tasks: { get: vi.fn() }, taskMedia: { url: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.me.current = meWith([...VIEWER, 'tasks.view']);
  mocks.api.occurrences.get.mockImplementation(async (id: string) => occurrenceDetail({ id }));
  mocks.api.tasks.get.mockImplementation(async (id: string) => taskDetail({ id }));
});

describe('report drawers', () => {
  it('refreshes every report query when the run drawer closes', async () => {
    const qc = client();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const onClose = vi.fn();
    renderWithRouter(<RunDrawer id={IDS.run} tab="execution" onClose={onClose} />, '/', qc);
    const drawer = await screen.findByRole('dialog');
    expect(await within(drawer).findByRole('tab', { name: 'İcra' })).toHaveAttribute('aria-selected', 'true');
    expect(mocks.api.occurrences.get).toHaveBeenCalledWith(IDS.run);
    await userEvent.click(within(drawer).getByRole('button', { name: 'Bağla' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['reports'] });
  });

  it('refreshes every report query when the task drawer closes', async () => {
    const qc = client();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const onClose = vi.fn();
    renderWithRouter(<ReportTaskDrawer id={IDS.task} onClose={onClose} />, '/', qc);
    const drawer = await screen.findByRole('dialog');
    expect(mocks.api.tasks.get).toHaveBeenCalledWith(IDS.task);
    await userEvent.click(within(drawer).getByRole('button', { name: 'Bağla' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['reports'] });
  });
});
```

- [ ] **Step 3: Run the tests and check they fail**

Run: `pnpm --filter @taskop/web test -- features/reports/labels features/reports/download features/reports/drawers`
Expected: FAIL: `Failed to resolve import "./labels"` (and `./download`, `./drawers`).

- [ ] **Step 4: Implement the helpers**

`apps/web/src/features/reports/labels.ts`:

```ts
import { ApiError } from '@taskop/api-client';
import type {
  ChecklistSummary,
  EmployeeReportRow,
  ProblemSeverity,
  ReportExportKind,
  ReportExportQuery,
  ReportFilters,
  ReportFormat,
  RunBucket,
  RunCountKey,
  SiteDto,
} from '@taskop/contracts';
import type { TFunction } from 'i18next';
import { formatPercent } from '@/features/executions/labels';
import { buildTree, type SiteNode } from '@/features/sites/tree';
import { errorText } from '@/lib/errors';
import { filterSearch, type ReportSearch, type ReportsPageSearch } from './search';

/** The counts shown as tiles; each one opens the runs list of its bucket (Part 1 decision 6). */
export type TileKey = Extract<RunCountKey, 'planned' | 'completed' | 'inProgress' | 'overdue' | 'partial' | 'missed' | 'withProblems'>;

export const TILE_BUCKETS: Record<TileKey, RunBucket> = {
  planned: 'all',
  completed: 'completed',
  inProgress: 'in_progress',
  overdue: 'overdue',
  partial: 'partial',
  missed: 'missed',
  withProblems: 'problems',
};

/** Spec §6.1: Planned, Completed, In progress, Overdue, With problems (then the two percentages). */
export const DASHBOARD_TILES: readonly TileKey[] = ['planned', 'completed', 'inProgress', 'overdue', 'withProblems'];
/** The Summary tab also shows Partial and Missed (decision 6). */
export const SUMMARY_TILES: readonly TileKey[] = ['planned', 'completed', 'inProgress', 'overdue', 'partial', 'missed', 'withProblems'];

/** `/reports?tab=runs&bucket=…` with the same filters. */
export const tileSearch = (s: ReportSearch, key: TileKey): ReportsPageSearch => ({ ...filterSearch(s), tab: 'runs', bucket: TILE_BUCKETS[key] });

export const percentText = (t: TFunction, value: number | null, locale: string): string =>
  value === null ? t('reports.noValue') : t('executions.percent', { value: formatPercent(value, locale) });

/** The trend is hidden for a single day (spec §6.1). */
export const isSingleDay = (f: Pick<ReportFilters, 'from' | 'to'>): boolean => f.from === f.to;

export interface SortState<K> {
  key: K;
  dir: 'asc' | 'desc';
}

/**
 * A sorted copy (decision 12). Missing values go last in either direction; ties keep the server's order; rows matched
 * by `pinLast` (the Unassigned row) stay at the end.
 */
export function sortRows<T extends object, K extends keyof T>(rows: readonly T[], sort: SortState<K> | null, pinLast: (row: T) => boolean = () => false): T[] {
  const pinned = rows.filter(pinLast);
  const rest = rows.filter((r) => !pinLast(r));
  if (!sort) return [...rest, ...pinned];
  const sign = sort.dir === 'asc' ? 1 : -1;
  const indexed = rest.map((row, i) => ({ row, i }));
  indexed.sort((a, b) => {
    const x: unknown = a.row[sort.key];
    const y: unknown = b.row[sort.key];
    const xMissing = x === null || x === undefined;
    const yMissing = y === null || y === undefined;
    if (xMissing || yMissing) return xMissing && yMissing ? a.i - b.i : xMissing ? 1 : -1;
    const c = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y, 'az') : Number(x) - Number(y);
    return c === 0 ? a.i - b.i : c * sign;
  });
  return [...indexed.map((e) => e.row), ...pinned];
}

/** Names A→Z and numbers high→low first; the same column again reverses. */
export const nextSort = <K extends string>(current: SortState<K> | null, key: K): SortState<K> =>
  current?.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' };

/** Sites in tree order; inactive ones only with "show inactive", except the selected one (decision 5). */
export function siteOptions(sites: readonly SiteDto[], showInactive: boolean, selectedId?: string): SiteDto[] {
  const out: SiteDto[] = [];
  const walk = (nodes: SiteNode[]) => {
    for (const n of nodes) {
      if (n.active || showInactive || n.id === selectedId) out.push(n);
      walk(n.children);
    }
  };
  walk(buildTree([...sites]));
  return out;
}

export interface EmployeeOption {
  id: string;
  name: string;
  active: boolean;
}

/** The people of the period's employee report (decision 4); the Unassigned row cannot be a filter. */
export function employeeOptions(rows: readonly EmployeeReportRow[], showInactive: boolean, selectedId?: string): EmployeeOption[] {
  return rows
    .filter((r): r is EmployeeReportRow & { userId: string } => r.userId !== null)
    .filter((r) => r.active || showInactive || r.userId === selectedId)
    .map((r) => ({ id: r.userId, name: r.name, active: r.active }));
}

export function checklistOptions(list: readonly ChecklistSummary[], showInactive: boolean, selectedId?: string): ChecklistSummary[] {
  return list.filter((c) => c.status === 'active' || showInactive || c.id === selectedId).sort((a, b) => a.name.localeCompare(b.name, 'az'));
}

/** The export's query: the bucket goes with runs, the severity with problems, the full report takes neither (decision 14). */
export function exportQuery(
  kind: ReportExportKind,
  filters: ReportFilters,
  format: ReportFormat,
  extra: { bucket?: RunBucket; severity?: ProblemSeverity },
): ReportExportQuery {
  return {
    ...filters,
    format,
    ...(kind === 'runs' && extra.bucket ? { bucket: extra.bucket } : {}),
    ...(kind === 'problems' && extra.severity ? { severity: extra.severity } : {}),
  };
}

/** REPORT_TOO_LARGE names the rows and the cap and asks to narrow the filters; anything else comes from az.errors. */
export function exportErrorText(t: TFunction, e: unknown): string {
  if (e instanceof ApiError && e.code === 'REPORT_TOO_LARGE' && e.rows !== null && e.limit !== null) {
    return t('reports.export.tooLarge', { rows: e.rows, limit: e.limit });
  }
  return errorText(t, e);
}
```

`apps/web/src/features/reports/download.ts`:

```ts
import type { ReportFile } from '@taskop/api-client';

/** Long enough for the browser to start the download before the URL goes away. */
export const REVOKE_AFTER_MS = 60_000;

/** Saves a downloaded report (spec §6.2): Blob → object URL → a temporary `<a download>`. */
export function saveFile(file: ReportFile): void {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
```

- [ ] **Step 5: Implement the queries and the drawers**

`apps/web/src/features/reports/queries.ts`:

```ts
import type { ChecklistSummary, ProblemSeverity, ReportFilters, RunBucket } from '@taskop/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/session';

/** Spec §6.1: the dashboard asks again every minute while it is visible. */
export const DASHBOARD_REFETCH_MS = 60_000;
/** "Needs attention" shows the first 10 of each list (Part 1 decision 13). */
export const ATTENTION_LIMIT = 10;

export const reportKeys = {
  /** Every report query: invalidated by "Yenilə" and when a report's drawer closes. */
  all: ['reports'] as const,
  summary: (f: ReportFilters) => ['reports', 'summary', f] as const,
  sites: (f: ReportFilters) => ['reports', 'sites', f] as const,
  employees: (f: ReportFilters) => ['reports', 'employees', f] as const,
  runs: (f: ReportFilters, bucket: RunBucket) => ['reports', 'runs', f, bucket] as const,
  problems: (f: ReportFilters, severity: ProblemSeverity | null) => ['reports', 'problems', f, severity] as const,
  tasks: (f: ReportFilters) => ['reports', 'tasks', f] as const,
  overdueNow: (f: ReportFilters) => ['reports', 'attention', 'overdue', f] as const,
  critical: (f: ReportFilters) => ['reports', 'attention', 'critical', f] as const,
};

/** Polling only while the tab is visible, and once more when the window gets focus back (decision 10). */
const LIVE = { refetchInterval: DASHBOARD_REFETCH_MS, refetchIntervalInBackground: false, refetchOnWindowFocus: true } as const;

/** `filters` is null while the filter bar shows a range the API would refuse: nothing is asked. */
export const useReportSummary = (filters: ReportFilters | null, o: { live?: boolean } = {}) =>
  useQuery({
    queryKey: reportKeys.summary(filters!),
    queryFn: () => api.reports.summary(filters!),
    enabled: filters !== null,
    ...(o.live ? LIVE : {}),
  });

export const useSiteReport = (filters: ReportFilters) => useQuery({ queryKey: reportKeys.sites(filters), queryFn: () => api.reports.sites(filters) });

export const useEmployeeReport = (filters: ReportFilters) =>
  useQuery({ queryKey: reportKeys.employees(filters), queryFn: () => api.reports.employees(filters) });

/** Pages of 50, newest due first; "Daha çox göstər" passes nextCursor back with the same filters. */
export const useReportRuns = (filters: ReportFilters, bucket: RunBucket) =>
  useInfiniteQuery({
    queryKey: reportKeys.runs(filters, bucket),
    queryFn: ({ pageParam }) => api.reports.runs({ ...filters, bucket, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

/** The counts come with every page and cover the whole filtered set (Part 1 decision 12): read them from the first. */
export const useReportProblems = (filters: ReportFilters, severity: ProblemSeverity | null) =>
  useInfiniteQuery({
    queryKey: reportKeys.problems(filters, severity),
    queryFn: ({ pageParam }) => api.reports.problems({ ...filters, ...(severity ? { severity } : {}), ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const useReportTasks = (filters: ReportFilters) =>
  useInfiniteQuery({
    queryKey: reportKeys.tasks(filters),
    queryFn: ({ pageParam }) => api.reports.tasks({ ...filters, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

/** Runs overdue right now: today's, whatever the period, with the other filters (decision 9). */
export function useOverdueNow(filters: ReportFilters | null, today: string) {
  const query = filters ? { ...filters, from: today, to: today } : null;
  return useQuery({
    queryKey: reportKeys.overdueNow(query!),
    queryFn: () => api.reports.runs({ ...query!, bucket: 'overdue' }),
    enabled: query !== null,
    select: (p) => p.items.slice(0, ATTENTION_LIMIT),
    ...LIVE,
  });
}

/** Critical problems of the period (Part 1 decision 5). */
export const useCriticalProblems = (filters: ReportFilters | null) =>
  useQuery({
    queryKey: reportKeys.critical(filters!),
    queryFn: () => api.reports.problems({ ...filters!, severity: 'critical' }),
    enabled: filters !== null,
    select: (p) => p.items.slice(0, ATTENTION_LIMIT),
    ...LIVE,
  });

/** The employee picker: the period's employee report without its own filter (decision 4); shares the tab's cache. */
export function useEmployeeOptions(filters: ReportFilters | null) {
  const query: ReportFilters | null = filters
    ? { from: filters.from, to: filters.to, ...(filters.siteId ? { siteId: filters.siteId } : {}), ...(filters.checklistId ? { checklistId: filters.checklistId } : {}) }
    : null;
  return useQuery({
    queryKey: reportKeys.employees(query!),
    queryFn: () => api.reports.employees(query!),
    enabled: query !== null,
    staleTime: 5 * 60_000,
  });
}

/** Every checklist, deactivated ones included (the picker filters them), following nextCursor. */
export const useReportChecklistOptions = (enabled: boolean) =>
  useQuery({
    queryKey: ['checklists', 'report-options'],
    queryFn: async () => {
      const all: ChecklistSummary[] = [];
      let cursor: string | undefined;
      do {
        const p = await api.checklists.list({ limit: 200, ...(cursor ? { cursor } : {}) });
        all.push(...p.items);
        cursor = p.nextCursor ?? undefined;
      } while (cursor);
      return all;
    },
    enabled,
    staleTime: 5 * 60_000,
  });
```

`apps/web/src/features/reports/drawers.tsx`:

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { OccurrenceDialog, type OccurrenceTab } from '@/features/scheduling/occurrence-dialog';
import { TaskDrawer } from '@/features/tasks/task-drawer';
import { reportKeys } from './queries';

/**
 * The `/schedule` run drawer, unchanged (decision 1). Closing it refreshes the reports: the run may have been cancelled
 * there, and its lists and tiles must not keep it.
 */
export function RunDrawer({ id, tab, onClose }: { id: string; tab?: OccurrenceTab; onClose: () => void }) {
  const qc = useQueryClient();
  return (
    <OccurrenceDialog
      key={id}
      id={id}
      initialTab={tab}
      onClose={() => {
        onClose();
        void qc.invalidateQueries({ queryKey: reportKeys.all });
      }}
    />
  );
}

/** The `/tasks` drawer, unchanged; closing it refreshes the reports (a review may have completed the task). */
export function ReportTaskDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  return (
    <TaskDrawer
      key={id}
      id={id}
      onClose={() => {
        onClose();
        void qc.invalidateQueries({ queryKey: reportKeys.all });
      }}
    />
  );
}
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/reports && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS (search, labels, download and drawer tests). The typecheck covers `queries.ts` and `fixtures.ts`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/reports/labels.ts apps/web/src/features/reports/labels.test.ts apps/web/src/features/reports/queries.ts apps/web/src/features/reports/download.ts apps/web/src/features/reports/download.test.ts apps/web/src/features/reports/drawers.tsx apps/web/src/features/reports/drawers.test.tsx apps/web/src/features/reports/fixtures.ts
git commit -m "feat(web): add report helpers, queries, the file download, report drawers and fixtures" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The filter bar: period, custom range, site, employee and checklist pickers, "show inactive"

**Files:**
- Create: `apps/web/src/features/reports/report-filters.tsx`
- Test: `apps/web/src/features/reports/report-filters.test.tsx`

**Interfaces:**
- Consumes:
  - Task 2: `PERIOD_CHOICES`, `DEFAULT_PERIOD`, `type PeriodChoice`, `type ReportSearch`, `resolveReportFilters`, `withPeriod`, `cleanSearch`, `FILTER_ISSUE_KEYS`
  - Task 3: `siteOptions`, `employeeOptions`, `checklistOptions`, `useEmployeeOptions`, `useReportChecklistOptions`; fixtures
  - Existing: `useSites(enabled)` (`features/sites/queries`), `indentedName` (`features/sites/tree`), `formatLocalDate` (`features/scheduling/labels`), `useCan`, `useMe`, `NativeSelect`, `Input`, `Label`, `Checkbox`
- Produces: `ReportFilters({ value: ReportSearch; today: string; onChange: (next: ReportSearch) => void })`, a controlled bar: the page keeps `value` in the URL. Accessible names: selects "Dövr", "Obyekt", "Əməkdaş", "Yoxlama vərəqəsi"; date fields "Başlanğıc tarixi", "Son tarix"; checkbox "Deaktivləri göstər"; the range or its problem (`role="alert"`) beside them.

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/reports/report-filters.test.tsx`:

```tsx
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatLocalDate } from '@/features/scheduling/labels';
import { renderWithProviders } from '@/test/render';
import { CHECKLISTS, EMPLOYEE_ROWS, IDS, meWith, SITES, TODAY, VIEWER } from './fixtures';
import { ReportFilters } from './report-filters';
import type { ReportSearch } from './search';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: { reports: { employees: vi.fn() }, sites: { list: vi.fn() }, checklists: { list: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));

/** The bar keeps no state of its own: the harness plays the page that stores it in the URL. */
function Harness({ initial, onChange }: { initial: ReportSearch; onChange: (next: ReportSearch) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <ReportFilters
      value={value}
      today={TODAY}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

function renderBar(initial: ReportSearch = {}) {
  const onChange = vi.fn();
  renderWithProviders(<Harness initial={initial} onChange={onChange} />);
  return onChange;
}

const texts = (select: HTMLElement) => within(select).getAllByRole('option').map((o) => o.textContent);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.me.current = meWith(VIEWER);
  mocks.api.sites.list.mockResolvedValue(SITES);
  mocks.api.checklists.list.mockResolvedValue({ items: CHECKLISTS, nextCursor: null });
  mocks.api.reports.employees.mockResolvedValue(EMPLOYEE_ROWS);
});

describe('ReportFilters', () => {
  it('switches between presets and a custom range pre-filled from the current period', async () => {
    const onChange = renderBar({ period: 'this_week', siteId: IDS.zoneA });
    const period = screen.getByLabelText('Dövr');
    expect(texts(period)).toEqual(['Bu gün', 'Dünən', 'Bu həftə', 'Bu ay', 'Son 7 gün', 'Son 30 gün', 'Seçilmiş dövr']);
    expect(screen.getByText(`${formatLocalDate('2026-11-02')} – ${formatLocalDate(TODAY)}`)).toBeInTheDocument();

    await userEvent.selectOptions(period, 'custom');
    expect(onChange).toHaveBeenLastCalledWith({ period: 'custom', from: '2026-11-02', to: TODAY, siteId: IDS.zoneA });
    expect(screen.getByLabelText('Başlanğıc tarixi')).toHaveValue('2026-11-02');
    fireEvent.change(screen.getByLabelText('Başlanğıc tarixi'), { target: { value: '2026-10-01' } });
    expect(onChange).toHaveBeenLastCalledWith({ period: 'custom', from: '2026-10-01', to: TODAY, siteId: IDS.zoneA });

    await userEvent.selectOptions(period, 'last_30');
    expect(onChange).toHaveBeenLastCalledWith({ period: 'last_30', siteId: IDS.zoneA });
    expect(screen.queryByLabelText('Başlanğıc tarixi')).not.toBeInTheDocument();
  });

  it('explains an inverted, too long or incomplete custom range and asks for nothing', () => {
    renderBar({ period: 'custom', from: '2026-10-31', to: '2026-10-01' });
    expect(screen.getByRole('alert')).toHaveTextContent('Son tarix başlanğıc tarixindən əvvəl ola bilməz.');
    cleanup();
    renderBar({ period: 'custom', from: '2025-01-01', to: TODAY });
    expect(screen.getByRole('alert')).toHaveTextContent('Hesabat dövrü ən çox 366 gün ola bilər.');
    cleanup();
    renderBar({ period: 'custom', from: TODAY });
    expect(screen.getByRole('alert')).toHaveTextContent('Başlanğıc və son tarixi seçin.');
    expect(mocks.api.reports.employees).not.toHaveBeenCalled();
  });

  it('lists sites as a tree and checklists from every page, inactive ones only after "show inactive"', async () => {
    mocks.api.checklists.list
      .mockResolvedValueOnce({ items: [CHECKLISTS[0]], nextCursor: IDS.checklist })
      .mockResolvedValueOnce({ items: [CHECKLISTS[1]], nextCursor: null });
    const onChange = renderBar();
    const site = screen.getByLabelText('Obyekt');
    const checklist = screen.getByLabelText('Yoxlama vərəqəsi');
    await waitFor(() => expect(texts(site)).toEqual(['Bütün obyektlər', 'Filial A', '  Zona A1']));
    await waitFor(() => expect(texts(checklist)).toEqual(['Bütün yoxlama vərəqələri', 'Açılış yoxlaması']));
    expect(mocks.api.checklists.list).toHaveBeenNthCalledWith(1, { limit: 200 });
    expect(mocks.api.checklists.list).toHaveBeenNthCalledWith(2, { limit: 200, cursor: IDS.checklist });

    await userEvent.click(screen.getByRole('checkbox', { name: 'Deaktivləri göstər' }));
    expect(onChange).toHaveBeenLastCalledWith({ inactive: true });
    expect(texts(site)).toEqual(['Bütün obyektlər', 'Filial A', '  Zona A1', '  Zona B (köhnə) (Deaktiv)']);
    expect(texts(checklist)).toEqual(['Bütün yoxlama vərəqələri', 'Açılış yoxlaması', 'Köhnə yoxlama (Deaktiv)']);

    await userEvent.selectOptions(site, IDS.zoneA);
    expect(onChange).toHaveBeenLastCalledWith({ inactive: true, siteId: IDS.zoneA });
    await userEvent.selectOptions(site, '');
    expect(onChange).toHaveBeenLastCalledWith({ inactive: true });
  });

  it('fills the employee picker from the period’s employee report, without its own filter or the Unassigned row', async () => {
    const onChange = renderBar({ period: 'yesterday', userId: IDS.aynur, siteId: IDS.zoneA });
    await waitFor(() => expect(mocks.api.reports.employees).toHaveBeenCalledWith({ from: '2026-11-03', to: '2026-11-03', siteId: IDS.zoneA }));
    const employee = screen.getByLabelText('Əməkdaş');
    await waitFor(() => expect(texts(employee)).toEqual(['Bütün əməkdaşlar', 'Aynur Quliyeva', 'Kamran Əliyev']));
    expect(employee).toHaveValue(IDS.aynur);
    await userEvent.selectOptions(employee, IDS.kamran);
    expect(onChange).toHaveBeenLastCalledWith({ period: 'yesterday', userId: IDS.kamran, siteId: IDS.zoneA });
  });

  it('keeps a selected inactive or unlisted site, employee and checklist visible', async () => {
    renderBar({ siteId: IDS.zoneB, userId: IDS.rauf, checklistId: IDS.oldChecklist });
    await waitFor(() => expect(screen.getByLabelText('Obyekt')).toHaveDisplayValue('  Zona B (köhnə) (Deaktiv)'));
    await waitFor(() => expect(screen.getByLabelText('Əməkdaş')).toHaveDisplayValue('Rauf Həsənov (Deaktiv)'));
    await waitFor(() => expect(screen.getByLabelText('Yoxlama vərəqəsi')).toHaveDisplayValue('Köhnə yoxlama (Deaktiv)'));
    cleanup();
    // A person with no runs in the period is not in the report, but the filter still applies.
    renderBar({ userId: IDS.stranger });
    await waitFor(() => expect(screen.getByLabelText('Əməkdaş')).toHaveDisplayValue('Seçilmiş əməkdaş (bu dövrdə icrası yoxdur)'));
  });

  it('hides the site and checklist pickers without sites.view or checklists.view and does not ask for them', async () => {
    mocks.me.current = meWith(['reports.view']);
    renderBar();
    expect(await screen.findByLabelText('Əməkdaş')).toBeInTheDocument();
    expect(screen.queryByLabelText('Obyekt')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Yoxlama vərəqəsi')).not.toBeInTheDocument();
    expect(mocks.api.sites.list).not.toHaveBeenCalled();
    expect(mocks.api.checklists.list).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/web test -- features/reports/report-filters`
Expected: FAIL: `Failed to resolve import "./report-filters"`.

- [ ] **Step 3: Implement**

`apps/web/src/features/reports/report-filters.tsx`:

```tsx
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatLocalDate } from '@/features/scheduling/labels';
import { useSites } from '@/features/sites/queries';
import { indentedName } from '@/features/sites/tree';
import { useCan, useMe } from '@/lib/session';
import { checklistOptions, employeeOptions, siteOptions } from './labels';
import { useEmployeeOptions, useReportChecklistOptions } from './queries';
import { cleanSearch, DEFAULT_PERIOD, FILTER_ISSUE_KEYS, PERIOD_CHOICES, type PeriodChoice, type ReportSearch, resolveReportFilters, withPeriod } from './search';

/**
 * The filter bar of the dashboard and the Reports page (spec §6.1). Controlled: the page keeps `value` in the URL.
 * Presets resolve from `today`, the tenant's today. The site picker includes the subtree (the API's rule).
 */
export function ReportFilters({ value, today, onChange }: { value: ReportSearch; today: string; onChange: (next: ReportSearch) => void }) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  const canSeeSites = useCan('sites.view');
  const canSeeChecklists = useCan('checklists.view');
  const sites = useSites(canSeeSites);
  const checklists = useReportChecklistOptions(canSeeChecklists);
  const resolved = resolveReportFilters(value, today);
  const employees = useEmployeeOptions(resolved.ok ? resolved.filters : null);
  const fromId = useId();
  const toId = useId();
  const inactiveId = useId();

  const period = value.period ?? DEFAULT_PERIOD;
  const showInactive = value.inactive === true;
  const set = (patch: Partial<ReportSearch>) => onChange(cleanSearch({ ...value, ...patch }));
  const marked = (label: string, active: boolean) => (active ? label : `${label} (${t('reports.inactive')})`);

  const siteList = siteOptions(sites.data ?? [], showInactive, value.siteId);
  const people = employeeOptions(employees.data ?? [], showInactive, value.userId);
  const lists = checklistOptions(checklists.data ?? [], showInactive, value.checklistId);
  // A selected id no list contains still shows as selected (decision 5), never as "all".
  const unknownSite = Boolean(value.siteId) && sites.isSuccess && !siteList.some((s) => s.id === value.siteId);
  const unknownPerson = Boolean(value.userId) && employees.isSuccess && !people.some((p) => p.id === value.userId);
  const unknownList = Boolean(value.checklistId) && checklists.isSuccess && !lists.some((c) => c.id === value.checklistId);

  let range: string | null = null;
  if (resolved.ok) {
    const { from, to } = resolved.filters;
    range = from === to ? formatLocalDate(from, tenant.locale) : t('reports.range.label', { from: formatLocalDate(from, tenant.locale), to: formatLocalDate(to, tenant.locale) });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <NativeSelect
        aria-label={t('reports.filters.period')}
        value={period}
        onChange={(e) => onChange(withPeriod(value, e.target.value as PeriodChoice, today))}
        className="w-44"
      >
        {PERIOD_CHOICES.map((p) => (
          <option key={p} value={p}>
            {t(`reports.periods.${p}`)}
          </option>
        ))}
      </NativeSelect>
      {period === 'custom' && (
        <>
          <div className="grid gap-1">
            <Label htmlFor={fromId}>{t('reports.filters.from')}</Label>
            <Input id={fromId} type="date" value={value.from ?? ''} onChange={(e) => set({ from: e.target.value })} className="w-44" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={toId}>{t('reports.filters.to')}</Label>
            <Input id={toId} type="date" value={value.to ?? ''} onChange={(e) => set({ to: e.target.value })} className="w-44" />
          </div>
        </>
      )}
      {canSeeSites && (
        <NativeSelect aria-label={t('reports.filters.site')} value={value.siteId ?? ''} onChange={(e) => set({ siteId: e.target.value })} className="w-56">
          <option value="">{t('reports.filters.allSites')}</option>
          {siteList.map((s) => (
            <option key={s.id} value={s.id}>
              {marked(indentedName(s), s.active)}
            </option>
          ))}
          {unknownSite && <option value={value.siteId}>{t('reports.picker.unknown')}</option>}
        </NativeSelect>
      )}
      <NativeSelect aria-label={t('reports.filters.employee')} value={value.userId ?? ''} onChange={(e) => set({ userId: e.target.value })} className="w-56">
        <option value="">{t('reports.filters.allEmployees')}</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {marked(p.name, p.active)}
          </option>
        ))}
        {unknownPerson && <option value={value.userId}>{t('reports.picker.unknownEmployee')}</option>}
      </NativeSelect>
      {canSeeChecklists && (
        <NativeSelect aria-label={t('reports.filters.checklist')} value={value.checklistId ?? ''} onChange={(e) => set({ checklistId: e.target.value })} className="w-56">
          <option value="">{t('reports.filters.allChecklists')}</option>
          {lists.map((c) => (
            <option key={c.id} value={c.id}>
              {marked(c.name, c.status === 'active')}
            </option>
          ))}
          {unknownList && <option value={value.checklistId}>{t('reports.picker.unknown')}</option>}
        </NativeSelect>
      )}
      <div className="flex h-9 items-center gap-2">
        <Checkbox id={inactiveId} checked={showInactive} onCheckedChange={(c) => set({ inactive: c === true ? true : undefined })} />
        <Label htmlFor={inactiveId}>{t('reports.filters.showInactive')}</Label>
      </div>
      {resolved.ok ? (
        <p className="text-muted-foreground flex h-9 items-center text-sm">{range}</p>
      ) : (
        <p role="alert" className="text-destructive flex h-9 items-center text-sm">
          {t(FILTER_ISSUE_KEYS[resolved.issue])}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/reports/report-filters && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/reports/report-filters.tsx apps/web/src/features/reports/report-filters.test.tsx
git commit -m "feat(web): add the report filter bar with period, pickers and show inactive" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Count tiles, the trend chart, the Summary tab, the `/reports` page and its menu entry

**Files:**
- Modify: `apps/web/package.json` (+ `pnpm-lock.yaml`), `apps/web/src/router.tsx`, `apps/web/src/layouts/app-shell.tsx`, `apps/web/src/layouts/app-shell.test.tsx`
- Create: `apps/web/src/features/reports/count-tiles.tsx`, `apps/web/src/features/reports/trend-chart.tsx`, `apps/web/src/features/reports/summary-view.tsx`, `apps/web/src/features/reports/reports-page.tsx`
- Test: `apps/web/src/features/reports/count-tiles.test.tsx`, `apps/web/src/features/reports/trend-chart.test.tsx`, `apps/web/src/features/reports/reports-page.test.tsx`

**Interfaces:**
- Consumes:
  - Part 1: `type ReportSummary`, `type ReportTrendDay`, `REPORT_KINDS`, `type ReportKind`, `type ReportFilters`
  - Task 2: `reportsPageSearch`, `filterSearch`, `pageExtras`, `resolveReportFilters`, `DEFAULT_TAB`, `type ReportSearch`, `type ReportsPageSearch`
  - Task 3: `tileSearch`, `percentText`, `isSingleDay`, `SUMMARY_TILES`, `type TileKey`, `useReportSummary`; fixtures
  - Task 4: `ReportFilters`
  - Existing: `useTenantToday`, `formatLocalDate` (`features/scheduling/labels`), `errorText`, `PageHeader`, `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `NAV_ITEMS` / `NavItem` (`layouts/app-shell`)
- Produces:
  - `CountTiles({ summary: ReportSummary; search: ReportSearch; keys: readonly TileKey[] })`: count links named "`<label>: <value>`" (`reports.tiles.link`); groups "Tamamlanma faizi" (described by `completionHint`) and "Orta bal"
  - `TrendChart({ trend: readonly ReportTrendDay[] })`: `figure` named "Gündəlik icra" with a hidden table "Gündəlik icra cədvəli"; renders nothing for fewer than 2 days
  - `SummaryView({ summary, search, filters, tiles })` (tiles, empty note, trend unless a single day) and `SummaryTab({ search, filters })`
  - `ReportsPage({ today?: string })` at `/reports` (`validateSearch: reportsPageSearch`); its tab body is a `switch` on `ReportKind` in the local `TabBody({ kind, search, filters, go })`, which Tasks 7–8 extend; `go(next: ReportsPageSearch, replace?: boolean)` navigates to `/reports`
  - `NavItem.to` gains `'/reports'`; `NAV_ITEMS` gains "Hesabatlar" after "Ana səhifə"

- [ ] **Step 1: Add the chart library**

```bash
pnpm --filter @taskop/web add recharts@^3.10.1 react-is@19.2.3
```

Check `apps/web/package.json`: `"recharts": "^3.10.1"` and `"react-is": "19.2.3"` under `dependencies` (decision 15: `react-is` is recharts' peer, pinned like `react`). `pnpm install` reports no unmet peer dependency for `recharts`.

- [ ] **Step 2: Write the failing tests**

`apps/web/src/features/reports/count-tiles.test.tsx`:

```tsx
import { cleanup, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '@/test/router';
import { CountTiles } from './count-tiles';
import { IDS, reportSummary } from './fixtures';
import { DASHBOARD_TILES, SUMMARY_TILES } from './labels';

vi.mock('@/lib/session', () => ({ useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));

/** The path and the query of a tile's link. */
function target(name: string) {
  const url = new URL(screen.getByRole('link', { name }).getAttribute('href')!, 'http://localhost');
  return { path: url.pathname, search: Object.fromEntries(url.searchParams) };
}

describe('CountTiles', () => {
  it('links every count to the runs report of its bucket, with the same filters', async () => {
    const search = { period: 'custom', from: '2026-11-01', to: '2026-11-15', siteId: IDS.zoneA, inactive: true } as const;
    renderWithRouter(<CountTiles summary={reportSummary()} search={search} keys={SUMMARY_TILES} />);
    await screen.findByRole('link', { name: 'Planlaşdırılıb: 12' });
    const same = { period: 'custom', from: '2026-11-01', to: '2026-11-15', siteId: IDS.zoneA, inactive: 'true', tab: 'runs' };
    expect(target('Planlaşdırılıb: 12')).toEqual({ path: '/reports', search: { ...same, bucket: 'all' } });
    expect(target('Tamamlanıb: 7').search).toEqual({ ...same, bucket: 'completed' });
    expect(target('Davam edir: 1').search).toEqual({ ...same, bucket: 'in_progress' });
    expect(target('Gecikib: 1').search).toEqual({ ...same, bucket: 'overdue' });
    expect(target('Yarımçıq: 1').search).toEqual({ ...same, bucket: 'partial' });
    expect(target('Buraxılıb: 0').search).toEqual({ ...same, bucket: 'missed' });
    expect(target('Problemli: 2').search).toEqual({ ...same, bucket: 'problems' });
  });

  it('shows the completion and the average score, explains completion, and a dash when there is none', async () => {
    renderWithRouter(<CountTiles summary={reportSummary()} search={{}} keys={DASHBOARD_TILES} />);
    const completion = await screen.findByRole('group', { name: 'Tamamlanma faizi' });
    expect(completion).toHaveTextContent('70%');
    expect(completion).toHaveAccessibleDescription('Vaxtı çatmış icralardan tamamlananların payı');
    expect(screen.getByRole('group', { name: 'Orta bal' })).toHaveTextContent('87,5%');
    // The dashboard's five counts only.
    expect(screen.getAllByRole('link')).toHaveLength(5);
    expect(screen.queryByRole('link', { name: /^Yarımçıq/ })).not.toBeInTheDocument();
    cleanup();
    renderWithRouter(<CountTiles summary={reportSummary({ completionPercent: null, averageScore: null })} search={{}} keys={DASHBOARD_TILES} />);
    expect(await screen.findByRole('group', { name: 'Tamamlanma faizi' })).toHaveTextContent('—');
    expect(screen.getByRole('group', { name: 'Orta bal' })).toHaveTextContent('—');
  });
});
```

`apps/web/src/features/reports/trend-chart.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatLocalDate } from '@/features/scheduling/labels';
import { renderWithProviders } from '@/test/render';
import { reportSummary, TODAY } from './fixtures';
import { TrendChart } from './trend-chart';

vi.mock('@/lib/session', () => ({ useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

describe('TrendChart', () => {
  it('draws due and completed per day with the completion line, and gives the same numbers as a table', () => {
    renderWithProviders(<TrendChart trend={reportSummary().trend} />);
    const figure = screen.getByRole('figure', { name: 'Gündəlik icra' });
    const rows = within(within(figure).getByRole('table', { name: 'Gündəlik icra cədvəli' })).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(within(rows[0]!).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Tarix', 'Vaxtı çatıb', 'Tamamlanıb', 'Tamamlanma faizi']);
    expect(within(rows[1]!).getAllByRole('cell').map((c) => c.textContent)).toEqual([formatLocalDate('2026-11-02'), '4', '3', '75%']);
    // A day with nothing due is drawn as zero, its percentage as a dash.
    expect(within(rows[2]!).getAllByRole('cell').map((c) => c.textContent)).toEqual([formatLocalDate('2026-11-03'), '0', '0', '—']);
    expect(within(rows[3]!).getAllByRole('cell').map((c) => c.textContent)).toEqual([formatLocalDate(TODAY), '6', '4', '66,7%']);
  });

  it('draws nothing for a single day', () => {
    const { container } = renderWithProviders(<TrendChart trend={[{ date: TODAY, due: 2, completed: 1, completionPercent: 50 }]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

`apps/web/src/features/reports/reports-page.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '@/test/router';
import { CHECKLISTS, EMPLOYEE_ROWS, IDS, meWith, page, reportProblems, reportSummary, reportTasks, SITES, TODAY, VIEWER } from './fixtures';
import { ReportsPage } from './reports-page';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: {
    reports: { summary: vi.fn(), sites: vi.fn(), employees: vi.fn(), runs: vi.fn(), problems: vi.fn(), tasks: vi.fn(), export: vi.fn() },
    sites: { list: vi.fn() },
    checklists: { list: vi.fn() },
    occurrences: { get: vi.fn() },
    tasks: { get: vi.fn() },
  },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.me.current = meWith(VIEWER);
  mocks.api.reports.summary.mockResolvedValue(reportSummary());
  mocks.api.reports.employees.mockResolvedValue(EMPLOYEE_ROWS);
  // Every tab has an answer, so switching tabs in a test never leaves a query without data.
  mocks.api.reports.sites.mockResolvedValue([]);
  mocks.api.reports.runs.mockResolvedValue(page([]));
  mocks.api.reports.problems.mockResolvedValue(reportProblems([]));
  mocks.api.reports.tasks.mockResolvedValue(reportTasks([]));
  mocks.api.sites.list.mockResolvedValue(SITES);
  mocks.api.checklists.list.mockResolvedValue({ items: CHECKLISTS, nextCursor: null });
});

describe('ReportsPage', () => {
  it('opens on Summary and keeps the filters, the tab and the bucket in the URL', async () => {
    const router = renderWithRouter(<ReportsPage today={TODAY} />, `/reports?period=this_week&siteId=${IDS.zoneA}&inactive=true`);
    expect(await screen.findByRole('link', { name: 'Gecikib: 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hesabatlar' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Xülasə' })).toHaveAttribute('aria-selected', 'true');
    expect(mocks.api.reports.summary).toHaveBeenCalledWith({ from: '2026-11-02', to: TODAY, siteId: IDS.zoneA });
    // Summary adds the partial and missed tiles, and a multi-day period has its trend.
    expect(screen.getByRole('link', { name: 'Yarımçıq: 1' })).toBeInTheDocument();
    expect(screen.getByRole('figure', { name: 'Gündəlik icra' })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Dövr'), 'last_7');
    await waitFor(() => expect(router.state.location.search).toEqual({ period: 'last_7', siteId: IDS.zoneA, inactive: true }));
    await waitFor(() => expect(mocks.api.reports.summary).toHaveBeenLastCalledWith({ from: '2026-10-29', to: TODAY, siteId: IDS.zoneA }));

    // A tile opens the runs tab with its bucket and the same filters.
    await userEvent.click(screen.getByRole('link', { name: 'Gecikib: 1' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ period: 'last_7', siteId: IDS.zoneA, inactive: true, tab: 'runs', bucket: 'overdue' }));
    expect(screen.getByRole('tab', { name: 'İcralar' })).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(screen.getByRole('tab', { name: 'Obyektlər' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ period: 'last_7', siteId: IDS.zoneA, inactive: true, tab: 'sites', bucket: 'overdue' }));
  });

  it('reopens a shared URL on its tab', async () => {
    renderWithRouter(<ReportsPage today={TODAY} />, '/reports?tab=problems&severity=critical&period=yesterday');
    expect(await screen.findByRole('tab', { name: 'Problemlər' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Dövr')).toHaveValue('yesterday');
  });

  it('explains a custom range it cannot show and asks for no report', async () => {
    renderWithRouter(<ReportsPage today={TODAY} />, '/reports?period=custom&from=2026-10-31&to=2026-10-01');
    expect(await screen.findByRole('alert')).toHaveTextContent('Son tarix başlanğıc tarixindən əvvəl ola bilməz.');
    expect(mocks.api.reports.summary).not.toHaveBeenCalled();
  });

  it('falls back to Summary without a broken site id from a hand-edited URL', async () => {
    renderWithRouter(<ReportsPage today={TODAY} />, '/reports?tab=audit&siteId=site-1&bucket=late');
    expect(await screen.findByRole('tab', { name: 'Xülasə' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(mocks.api.reports.summary).toHaveBeenCalledWith({ from: TODAY, to: TODAY }));
  });
});
```

In `apps/web/src/layouts/app-shell.test.tsx`, inside the first test (`shows only the menu items the user may open`), after the `Mesajlar` assertion add:

```tsx
    expect(screen.queryByRole('link', { name: 'Hesabatlar' })).not.toBeInTheDocument();
```

and append to the `describe('AppShell')` block:

```tsx
  it('shows Hesabatlar to holders of reports.view', async () => {
    state.current = { status: 'authenticated', me: me(['reports.view']) };
    renderShell();
    expect(await screen.findByRole('link', { name: 'Hesabatlar' })).toHaveAttribute('href', '/reports');
  });
```

- [ ] **Step 3: Run the tests and check they fail**

Run: `pnpm --filter @taskop/web test -- features/reports/count-tiles features/reports/trend-chart features/reports/reports-page layouts/app-shell`
Expected: FAIL: `Failed to resolve import "./count-tiles"` (and `./trend-chart`, `./reports-page`); the app-shell test finds no "Hesabatlar" link.

- [ ] **Step 4: Implement the tiles and the trend**

`apps/web/src/features/reports/count-tiles.tsx`:

```tsx
import type { ReportSummary } from '@taskop/contracts';
import { intlLocale } from '@taskop/i18n';
import { Link } from '@tanstack/react-router';
import { Info } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useMe } from '@/lib/session';
import { cn } from '@/lib/utils';
import { percentText, type TileKey, tileSearch } from './labels';
import type { ReportSearch } from './search';

const TILE = 'grid content-start gap-1 rounded-lg border p-4';

/**
 * Spec §6.1: one link per count to `/reports?tab=runs&bucket=…` with the same filters, then completion % and average
 * score. A link is named "label: value", so the number is part of what a screen reader announces.
 */
export function CountTiles({ summary, search, keys }: { summary: ReportSummary; search: ReportSearch; keys: readonly TileKey[] }) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  const hintId = useId();
  const count = new Intl.NumberFormat(intlLocale(tenant.locale));
  const completion = t('reports.measures.completionPercent');
  const average = t('reports.measures.averageScore');
  const hint = t('reports.measures.completionHint');
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
      {keys.map((key) => {
        const label = t(`reports.counts.${key}`);
        const value = count.format(summary.counts[key]);
        return (
          <Link
            key={key}
            to="/reports"
            search={tileSearch(search, key)}
            aria-label={t('reports.tiles.link', { label, value })}
            className={cn(TILE, 'hover:bg-muted focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none')}
          >
            <span className="text-muted-foreground text-sm">{label}</span>
            <span className="text-2xl font-semibold tabular-nums">{value}</span>
          </Link>
        );
      })}
      <div role="group" aria-label={completion} aria-describedby={hintId} className={TILE}>
        <span className="text-muted-foreground flex items-center gap-1 text-sm">
          {completion}
          {/* No tooltip component in the repo: the title shows on hover, the description reaches screen readers (decision 7). */}
          <span title={hint} className="inline-flex">
            <Info className="size-3.5" aria-hidden />
          </span>
        </span>
        <span className="text-2xl font-semibold tabular-nums">{percentText(t, summary.completionPercent, tenant.locale)}</span>
        <span id={hintId} className="sr-only">
          {hint}
        </span>
      </div>
      <div role="group" aria-label={average} className={TILE}>
        <span className="text-muted-foreground text-sm">{average}</span>
        <span className="text-2xl font-semibold tabular-nums">{percentText(t, summary.averageScore, tenant.locale)}</span>
      </div>
    </div>
  );
}
```

`apps/web/src/features/reports/trend-chart.tsx`:

```tsx
import type { ReportTrendDay } from '@taskop/contracts';
import { intlLocale } from '@taskop/i18n';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatLocalDate } from '@/features/scheduling/labels';
import { useMe } from '@/lib/session';
import { percentText } from './labels';

/** Theme tokens from src/styles.css, so light and dark mode both apply (decision 8). */
const COLOR = { due: 'var(--chart-2)', completed: 'var(--primary)', grid: 'var(--border)', axis: 'var(--muted-foreground)' } as const;
const TICK = { fontSize: 12, fill: COLOR.axis };
const TOOLTIP = { background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--popover-foreground)' };
const MARGIN = { top: 8, right: 8, bottom: 0, left: 0 };

/**
 * Spec §6.1: due vs completed per day, and the completion %. Two charts on one time axis (synced hover), not one chart
 * with two y-scales. The charts are decoration for sighted users; the hidden table carries the same numbers.
 */
export function TrendChart({ trend }: { trend: readonly ReportTrendDay[] }) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  const titleId = useId();
  if (trend.length < 2) return null;

  const short = new Intl.DateTimeFormat(intlLocale(tenant.locale), { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const tick = (date: string) => short.format(new Date(`${date}T00:00:00Z`));
  const day = (date: unknown) => formatLocalDate(String(date), tenant.locale);
  const data = trend.map((d) => ({ ...d }));
  const label = { due: t('reports.counts.due'), completed: t('reports.counts.completed'), percent: t('reports.measures.completionPercent') };

  return (
    <figure aria-labelledby={titleId} className="grid gap-2 rounded-lg border p-4">
      <figcaption id={titleId} className="font-medium">
        {t('reports.trend')}
      </figcaption>
      <div className="h-56" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} syncId="report-trend" margin={MARGIN} barGap={2} accessibilityLayer={false}>
            <CartesianGrid vertical={false} stroke={COLOR.grid} />
            <XAxis dataKey="date" tickFormatter={tick} tick={TICK} axisLine={false} tickLine={false} minTickGap={16} />
            <YAxis allowDecimals={false} tick={TICK} axisLine={false} tickLine={false} width={32} />
            <Tooltip labelFormatter={day} cursor={{ fill: 'var(--muted)' }} contentStyle={TOOLTIP} />
            <Legend />
            <Bar dataKey="due" name={label.due} fill={COLOR.due} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            <Bar dataKey="completed" name={label.completed} fill={COLOR.completed} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-muted-foreground text-xs" aria-hidden>
        {label.percent}
      </p>
      <div className="h-28" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} syncId="report-trend" margin={MARGIN} accessibilityLayer={false}>
            <CartesianGrid vertical={false} stroke={COLOR.grid} />
            <XAxis dataKey="date" tickFormatter={tick} tick={TICK} axisLine={false} tickLine={false} minTickGap={16} />
            <YAxis domain={[0, 100]} ticks={[0, 50, 100]} unit="%" tick={TICK} axisLine={false} tickLine={false} width={40} />
            <Tooltip
              labelFormatter={day}
              formatter={(v) => percentText(t, typeof v === 'number' ? v : null, tenant.locale)}
              contentStyle={TOOLTIP}
            />
            <Line dataKey="completionPercent" name={label.percent} stroke={COLOR.completed} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>{t('reports.chart.table')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('reports.columns.date')}</th>
            <th scope="col">{label.due}</th>
            <th scope="col">{label.completed}</th>
            <th scope="col">{label.percent}</th>
          </tr>
        </thead>
        <tbody>
          {trend.map((d) => (
            <tr key={d.date}>
              <td>{formatLocalDate(d.date, tenant.locale)}</td>
              <td>{d.due}</td>
              <td>{d.completed}</td>
              <td>{percentText(t, d.completionPercent, tenant.locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
```

`apps/web/src/features/reports/summary-view.tsx`:

```tsx
import type { ReportFilters, ReportSummary } from '@taskop/contracts';
import { useTranslation } from 'react-i18next';
import { errorText } from '@/lib/errors';
import { CountTiles } from './count-tiles';
import { isSingleDay, SUMMARY_TILES, type TileKey } from './labels';
import { useReportSummary } from './queries';
import type { ReportSearch } from './search';
import { TrendChart } from './trend-chart';

/** Tiles and trend: the dashboard and the Summary tab show the same components (spec §6.2). */
export function SummaryView({ summary, search, filters, tiles }: { summary: ReportSummary; search: ReportSearch; filters: ReportFilters; tiles: readonly TileKey[] }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4">
      <CountTiles summary={summary} search={search} keys={tiles} />
      {summary.counts.planned === 0 && <p className="text-muted-foreground">{t('reports.empty')}</p>}
      {!isSingleDay(filters) && <TrendChart trend={summary.trend} />}
    </div>
  );
}

export function SummaryTab({ search, filters }: { search: ReportSearch; filters: ReportFilters }) {
  const { t } = useTranslation();
  const summary = useReportSummary(filters);
  if (summary.error) return <p className="text-destructive">{errorText(t, summary.error)}</p>;
  if (!summary.data) return <p className="text-muted-foreground">{t('common.loading')}</p>;
  return <SummaryView summary={summary.data} search={search} filters={filters} tiles={SUMMARY_TILES} />;
}
```

- [ ] **Step 5: Implement the page, the route and the menu entry**

`apps/web/src/features/reports/reports-page.tsx`:

```tsx
import { REPORT_KINDS, type ReportFilters as Filters, type ReportKind } from '@taskop/contracts';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTenantToday } from '@/features/scheduling/labels';
import { ReportFilters } from './report-filters';
import { DEFAULT_TAB, filterSearch, pageExtras, type ReportsPageSearch, reportsPageSearch, resolveReportFilters } from './search';
import { SummaryTab } from './summary-view';

type Go = (next: ReportsPageSearch, replace?: boolean) => void;

/**
 * `/reports` (spec §6.2): the filter bar, then one tab per report. Filters, tab, bucket and severity live in the URL,
 * so a URL is a shareable report. Only the open tab is mounted, so only its report is asked for.
 */
export function ReportsPage({ today: fixedToday }: { today?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const tenantToday = useTenantToday();
  const today = fixedToday ?? tenantToday;
  const search = reportsPageSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const tab = search.tab ?? DEFAULT_TAB;
  const resolved = resolveReportFilters(search, today);
  const filters = resolved.ok ? resolved.filters : null;
  // Filter edits replace the history entry; tabs, chips and drill-downs push one (decision 3).
  const go: Go = (next, replace = false) => void navigate({ to: '/reports', search: next, replace });

  return (
    <div className="grid gap-4">
      <PageHeader title={t('reports.title')} />
      <ReportFilters value={filterSearch(search)} today={today} onChange={(next) => go({ ...next, ...pageExtras(search) }, true)} />
      <Tabs value={tab} onValueChange={(v) => go({ ...search, tab: v as ReportKind })}>
        <TabsList>
          {REPORT_KINDS.map((k) => (
            <TabsTrigger key={k} value={k}>
              {t(`reports.tabs.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {REPORT_KINDS.map((k) => (
          <TabsContent key={k} value={k} className="pt-2">
            {filters && <TabBody kind={k} search={search} filters={filters} go={go} />}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

/** The open tab's report. Tasks 7 and 8 add the other tabs. */
function TabBody({ kind, search, filters }: { kind: ReportKind; search: ReportsPageSearch; filters: Filters; go: Go }) {
  switch (kind) {
    case 'summary':
      return <SummaryTab search={filterSearch(search)} filters={filters} />;
    default:
      return null;
  }
}
```

In `apps/web/src/router.tsx`:

1. Add the imports (keep the import block's order):

```tsx
import { ReportsPage } from '@/features/reports/reports-page';
import { reportsPageSearch } from '@/features/reports/search';
```

2. After `messagesRoute`, add:

```tsx
const reportsRoute = createRoute({ getParentRoute: () => appLayout, path: '/reports', component: () => <ReportsPage />, validateSearch: reportsPageSearch });
```

3. In `appLayout.addChildren([...])`, add `reportsRoute,` after `messagesRoute,`.

In `apps/web/src/layouts/app-shell.tsx`:

1. Add `ChartColumn` to the `lucide-react` import (alphabetical, after `CalendarDays`).
2. Add `| '/reports'` to the `NavItem['to']` union (after `'/messages'`).
3. In `NAV_ITEMS`, after `{ to: '/', labelKey: 'nav.home', icon: Home },` add:

```tsx
  { to: '/reports', labelKey: 'nav.reports', icon: ChartColumn, permission: 'reports.view' },
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/reports layouts/app-shell && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS. jsdom gives `ResponsiveContainer` a zero size, so recharts may log a size warning in the trend tests; the hidden table is what they check.

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/features/reports/count-tiles.tsx apps/web/src/features/reports/count-tiles.test.tsx apps/web/src/features/reports/trend-chart.tsx apps/web/src/features/reports/trend-chart.test.tsx apps/web/src/features/reports/summary-view.tsx apps/web/src/features/reports/reports-page.tsx apps/web/src/features/reports/reports-page.test.tsx apps/web/src/router.tsx apps/web/src/layouts/app-shell.tsx apps/web/src/layouts/app-shell.test.tsx
git commit -m "feat(web): add count tiles, the trend chart and the reports page with its menu entry" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The dashboard at `/`: live tiles and trend, "needs attention", refresh

**Files:**
- Create: `apps/web/src/features/reports/dashboard-page.tsx`, `apps/web/src/features/reports/attention-panel.tsx`
- Modify: `apps/web/src/features/home/home-page.tsx`, `apps/web/src/router.tsx`, `apps/web/e2e/foundation.spec.ts`, `apps/web/e2e/checklists.spec.ts`
- Test: `apps/web/src/features/reports/dashboard-page.test.tsx`, `apps/web/src/features/home/home-page.test.tsx`

**Interfaces:**
- Consumes:
  - Task 2: `reportSearch`, `resolveReportFilters`, `type ReportSearch`
  - Task 3: `DASHBOARD_TILES`, `reportKeys`, `useReportSummary(f, { live: true })`, `useOverdueNow(f, today)`, `useCriticalProblems(f)`, `RunDrawer`; fixtures
  - Task 4: `ReportFilters`; Task 5: `SummaryView`
  - Existing: `useTenantToday`, `useTimeFormat`, `formatLocalDate` (`features/scheduling/labels`), `type OccurrenceTab`, `errorText`, `useCan`, `useMe`, `PageHeader`, `Card`, `Button`, `occurrenceDetail` (`features/executions/fixtures`)
- Produces:
  - `DashboardPage({ today?: string })`: heading "İdarə paneli", "Son yenilənmə: HH:mm", button "Yenilə", the filter bar (navigates `/` with `replace`), `SummaryView` with `DASHBOARD_TILES`, `AttentionPanel`
  - `AttentionPanel({ filters: ReportFilters; today: string })`: region "Diqqət tələb edir" with lists "Hazırda gecikən icralar" and "Kritik problemlər"; rows open `RunDrawer`
  - `HomePage`: `DashboardPage` for `reports.view`, the welcome page otherwise; the `/` route gets `validateSearch: reportSearch`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/reports/dashboard-page.test.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import { focusManager, QueryClient } from '@tanstack/react-query';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { occurrenceDetail } from '@/features/executions/fixtures';
import { queryClient as appQueryClient } from '@/lib/query';
import { renderWithRouter } from '@/test/router';
import { DashboardPage } from './dashboard-page';
import { CHECKLISTS, completedRun, EMPLOYEE_ROWS, IDS, meWith, page, reportProblem, reportProblems, reportRun, reportSummary, SITES, TODAY, VIEWER } from './fixtures';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: {
    reports: { summary: vi.fn(), employees: vi.fn(), runs: vi.fn(), problems: vi.fn() },
    sites: { list: vi.fn() },
    checklists: { list: vi.fn() },
    occurrences: { get: vi.fn(), cancel: vi.fn() },
    executions: { get: vi.fn() },
  },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));

/** The app's own query defaults (30 s stale, no focus refetch), so these tests pin the dashboard's overrides. */
const appClient = () => new QueryClient({ defaultOptions: { ...appQueryClient.getDefaultOptions(), queries: { ...appQueryClient.getDefaultOptions().queries, retry: false } } });

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.me.current = meWith(VIEWER);
  mocks.api.reports.summary.mockResolvedValue(reportSummary());
  mocks.api.reports.employees.mockResolvedValue(EMPLOYEE_ROWS);
  mocks.api.reports.runs.mockResolvedValue(page([reportRun()]));
  mocks.api.reports.problems.mockResolvedValue(reportProblems([reportProblem()]));
  mocks.api.sites.list.mockResolvedValue(SITES);
  mocks.api.checklists.list.mockResolvedValue({ items: CHECKLISTS, nextCursor: null });
  mocks.api.occurrences.get.mockImplementation(async (id: string) => occurrenceDetail({ id }));
});

afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});

describe('DashboardPage', () => {
  it("shows today's tiles and what needs attention: the first 10 overdue runs of today and the period's critical problems", async () => {
    const runs = Array.from({ length: 12 }, (_, i) =>
      reportRun({ occurrenceId: `0192f1e2-7c3a-7b4d-8e5f-${(0x100 + i).toString(16).padStart(12, '0')}`, checklist: { id: IDS.checklist, name: `Yoxlama ${i + 1}` } }),
    );
    mocks.api.reports.runs.mockResolvedValue(page(runs, runs[11]!.occurrenceId));
    renderWithRouter(<DashboardPage today={TODAY} />);
    expect(await screen.findByRole('heading', { name: 'İdarə paneli' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Planlaşdırılıb: 12' })).toBeInTheDocument();
    for (const name of ['Tamamlanıb: 7', 'Davam edir: 1', 'Gecikib: 1', 'Problemli: 2']) expect(screen.getByRole('link', { name })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Tamamlanma faizi' })).toHaveTextContent('70%');
    expect(mocks.api.reports.summary).toHaveBeenCalledWith({ from: TODAY, to: TODAY });
    // One day: no trend.
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();

    const overdue = await screen.findByRole('list', { name: 'Hazırda gecikən icralar' });
    expect(within(overdue).getAllByRole('listitem')).toHaveLength(10);
    expect(overdue).toHaveTextContent('Yoxlama 1');
    expect(overdue).not.toHaveTextContent('Yoxlama 11');
    expect(mocks.api.reports.runs).toHaveBeenCalledWith({ from: TODAY, to: TODAY, bucket: 'overdue' });
    const critical = screen.getByRole('list', { name: 'Kritik problemlər' });
    expect(critical).toHaveTextContent('Soyuducunun temperaturu');
    expect(critical).toHaveTextContent('Kondisioner xarabdır');
    expect(mocks.api.reports.problems).toHaveBeenCalledWith({ from: TODAY, to: TODAY, severity: 'critical' });
  });

  it("keeps the overdue list on today while the period and filters apply to the rest", async () => {
    renderWithRouter(<DashboardPage today={TODAY} />, `/?period=last_7&siteId=${IDS.zoneA}`);
    expect(await screen.findByRole('figure', { name: 'Gündəlik icra' })).toBeInTheDocument();
    expect(mocks.api.reports.summary).toHaveBeenCalledWith({ from: '2026-10-29', to: TODAY, siteId: IDS.zoneA });
    await waitFor(() => expect(mocks.api.reports.runs).toHaveBeenCalledWith({ from: TODAY, to: TODAY, siteId: IDS.zoneA, bucket: 'overdue' }));
    expect(mocks.api.reports.problems).toHaveBeenCalledWith({ from: '2026-10-29', to: TODAY, siteId: IDS.zoneA, severity: 'critical' });
    // A tile carries the dashboard's filters to the runs report.
    const href = new URL(screen.getByRole('link', { name: 'Gecikib: 1' }).getAttribute('href')!, 'http://localhost');
    expect(Object.fromEntries(href.searchParams)).toEqual({ period: 'last_7', siteId: IDS.zoneA, tab: 'runs', bucket: 'overdue' });
  });

  it('keeps the filters in the URL of the home page', async () => {
    const router = renderWithRouter(<DashboardPage today={TODAY} />);
    await userEvent.selectOptions(await screen.findByLabelText('Dövr'), 'this_month');
    await waitFor(() => expect(router.state.location.search).toEqual({ period: 'this_month' }));
    expect(router.state.location.pathname).toBe('/');
    await waitFor(() => expect(mocks.api.reports.summary).toHaveBeenLastCalledWith({ from: '2026-11-01', to: TODAY }));
  });

  it("resolves the period from the tenant's today, not the browser's", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 01:30 on 5 November in Baku; 16:30 on 4 November in New York.
    vi.setSystemTime(new Date('2026-11-04T21:30:00Z'));
    renderWithRouter(<DashboardPage />, '/?period=this_week');
    await waitFor(() => expect(mocks.api.reports.summary).toHaveBeenCalledWith({ from: '2026-11-02', to: '2026-11-05' }));
    await waitFor(() => expect(mocks.api.reports.runs).toHaveBeenCalledWith({ from: '2026-11-05', to: '2026-11-05', bucket: 'overdue' }));
    cleanup();
    mocks.me.current = meWith(VIEWER, { timezone: 'America/New_York' });
    renderWithRouter(<DashboardPage />, '/?period=this_week');
    await waitFor(() => expect(mocks.api.reports.summary).toHaveBeenLastCalledWith({ from: '2026-11-02', to: '2026-11-04' }));
  });

  it('asks again every minute while the page is visible, not while it is hidden, and at once when it comes back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderWithRouter(<DashboardPage today={TODAY} />, '/', appClient());
    await screen.findByRole('link', { name: 'Gecikib: 1' });
    await waitFor(() => expect(mocks.api.reports.problems).toHaveBeenCalledTimes(1));
    expect(mocks.api.reports.summary).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    await waitFor(() => expect(mocks.api.reports.summary).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.api.reports.runs).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.api.reports.problems).toHaveBeenCalledTimes(2));

    act(() => focusManager.setFocused(false));
    await act(() => vi.advanceTimersByTimeAsync(180_000));
    expect(mocks.api.reports.summary).toHaveBeenCalledTimes(2);
    act(() => focusManager.setFocused(true));
    await waitFor(() => expect(mocks.api.reports.summary).toHaveBeenCalledTimes(3));
  });

  it('moves Today to the new day when the page stays open over midnight', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // 23:59:30 in Baku.
    vi.setSystemTime(new Date('2026-11-04T19:59:30Z'));
    renderWithRouter(<DashboardPage />, '/', appClient());
    await waitFor(() => expect(mocks.api.reports.summary).toHaveBeenCalledWith({ from: '2026-11-04', to: '2026-11-04' }));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    await waitFor(() => expect(mocks.api.reports.summary).toHaveBeenLastCalledWith({ from: '2026-11-05', to: '2026-11-05' }));
    await waitFor(() => expect(mocks.api.reports.runs).toHaveBeenLastCalledWith({ from: '2026-11-05', to: '2026-11-05', bucket: 'overdue' }));
  });

  it('refreshes on demand and says when the numbers were last updated', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 12:15 in Baku.
    vi.setSystemTime(new Date('2026-11-04T08:15:00Z'));
    renderWithRouter(<DashboardPage today={TODAY} />);
    expect(await screen.findByText('Son yenilənmə: 12:15')).toBeInTheDocument();
    vi.setSystemTime(new Date('2026-11-04T08:17:00Z'));
    await userEvent.click(screen.getByRole('button', { name: 'Yenilə' }));
    await waitFor(() => expect(mocks.api.reports.summary).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Son yenilənmə: 12:17')).toBeInTheDocument();
    await waitFor(() => expect(mocks.api.reports.runs).toHaveBeenCalledTimes(2));
  });

  it('opens an overdue run on its overview and a critical problem on the execution tab', async () => {
    mocks.api.reports.problems.mockResolvedValue(reportProblems([reportProblem({ occurrenceId: completedRun().occurrenceId })]));
    renderWithRouter(<DashboardPage today={TODAY} />);
    const overdue = await screen.findByRole('list', { name: 'Hazırda gecikən icralar' });
    await userEvent.click(within(overdue).getByRole('button', { name: /Açılış yoxlaması/ }));
    const first = await screen.findByRole('dialog');
    expect(await within(first).findByRole('tab', { name: 'Ümumi' })).toHaveAttribute('aria-selected', 'true');
    expect(mocks.api.occurrences.get).toHaveBeenCalledWith(IDS.run);
    await userEvent.click(within(first).getByRole('button', { name: 'Bağla' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(within(screen.getByRole('list', { name: 'Kritik problemlər' })).getByRole('button', { name: /Soyuducunun temperaturu/ }));
    const second = await screen.findByRole('dialog');
    expect(await within(second).findByRole('tab', { name: 'İcra' })).toHaveAttribute('aria-selected', 'true');
    expect(mocks.api.occurrences.get).toHaveBeenLastCalledWith(IDS.run2);
  });

  it('says so when nothing needs attention', async () => {
    mocks.api.reports.runs.mockResolvedValue(page([]));
    mocks.api.reports.problems.mockResolvedValue(reportProblems([], { counts: { total: 0, critical: 0, resolution: { none: 0, open: 0, resolved: 0, cancelled: 0 } } }));
    renderWithRouter(<DashboardPage today={TODAY} />);
    expect(await screen.findByText('Hazırda gecikən icra yoxdur.')).toBeInTheDocument();
    expect(await screen.findByText('Bu dövrdə kritik problem yoxdur.')).toBeInTheDocument();
  });

  it('shows why the numbers could not be loaded', async () => {
    mocks.api.reports.summary.mockRejectedValue(new ApiError(503, 'REPORT_TIMEOUT', 'errors.REPORT_TIMEOUT'));
    renderWithRouter(<DashboardPage today={TODAY} />);
    expect(await screen.findByText('Hesabat vaxtında hazırlanmadı. Dövrü qısaldın və ya bir az sonra yenidən cəhd edin.')).toBeInTheDocument();
  });
});
```

`apps/web/src/features/home/home-page.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPLOYEE_ROWS, meWith, page, reportProblems, reportSummary, VIEWER } from '@/features/reports/fixtures';
import { renderWithRouter } from '@/test/router';
import { HomePage } from './home-page';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: { reports: { summary: vi.fn(), employees: vi.fn(), runs: vi.fn(), problems: vi.fn() }, sites: { list: vi.fn() }, checklists: { list: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.api.reports.summary.mockResolvedValue(reportSummary());
  mocks.api.reports.employees.mockResolvedValue(EMPLOYEE_ROWS);
  mocks.api.reports.runs.mockResolvedValue(page([]));
  mocks.api.reports.problems.mockResolvedValue(reportProblems([]));
  mocks.api.sites.list.mockResolvedValue([]);
  mocks.api.checklists.list.mockResolvedValue({ items: [], nextCursor: null });
});

describe('HomePage', () => {
  it('keeps the welcome page for users without reports.view and asks for no report', async () => {
    mocks.me.current = meWith(['tasks.view']);
    renderWithRouter(<HomePage />);
    expect(await screen.findByRole('heading', { name: 'Xoş gəlmisiniz, Leyla!' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'İdarə paneli' })).not.toBeInTheDocument();
    expect(mocks.api.reports.summary).not.toHaveBeenCalled();
  });

  it('shows the dashboard to holders of reports.view', async () => {
    mocks.me.current = meWith(VIEWER);
    renderWithRouter(<HomePage />);
    expect(await screen.findByRole('heading', { name: 'İdarə paneli' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.api.reports.summary).toHaveBeenCalledOnce());
    expect(screen.queryByRole('heading', { name: 'Xoş gəlmisiniz, Leyla!' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/web test -- features/reports/dashboard-page features/home`
Expected: FAIL: `Failed to resolve import "./dashboard-page"`; the home page test finds no "İdarə paneli" heading.

- [ ] **Step 3: Implement the attention panel**

`apps/web/src/features/reports/attention-panel.tsx`:

```tsx
import type { ReportFilters, ReportRun } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { OccurrenceTab } from '@/features/scheduling/occurrence-dialog';
import { formatLocalDate, useTimeFormat } from '@/features/scheduling/labels';
import { errorText } from '@/lib/errors';
import { useMe } from '@/lib/session';
import { RunDrawer } from './drawers';
import { useCriticalProblems, useOverdueNow } from './queries';

const ROW = 'hover:bg-muted flex w-full flex-wrap items-baseline gap-x-2 rounded-md px-2 py-1 text-left text-sm';

/**
 * Spec §6.1 "Needs attention": runs overdue right now (today's, decision 9) and the period's critical problems, the
 * first 10 of each. A row opens the run drawer: an overdue run on its overview, a problem on the execution tab.
 */
export function AttentionPanel({ filters, today }: { filters: ReportFilters; today: string }) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  const time = useTimeFormat();
  const overdue = useOverdueNow(filters, today);
  const critical = useCriticalProblems(filters);
  const [run, setRun] = useState<{ id: string; tab: OccurrenceTab } | null>(null);
  const people = (r: ReportRun) => r.assignees.map((a) => a.fullName).join(', ') || t('reports.employees.unassigned');

  return (
    <section aria-label={t('reports.attention.title')} className="grid gap-3">
      <h2 className="text-lg font-semibold">{t('reports.attention.title')}</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('reports.attention.overdueNow')}</CardTitle>
          </CardHeader>
          <CardContent>
            {overdue.error ? (
              <p className="text-destructive text-sm">{errorText(t, overdue.error)}</p>
            ) : overdue.data?.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('reports.attention.noneOverdue')}</p>
            ) : (
              <ul aria-label={t('reports.attention.overdueNow')} className="grid gap-1">
                {(overdue.data ?? []).map((r) => (
                  <li key={r.occurrenceId}>
                    <button type="button" className={ROW} onClick={() => setRun({ id: r.occurrenceId, tab: 'overview' })}>
                      <span className="font-mono">{time(r.dueAt)}</span>
                      <span className="font-medium">{r.checklist.name}</span>
                      <span className="text-muted-foreground">
                        {r.site.name} · {people(r)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('reports.attention.critical')}</CardTitle>
          </CardHeader>
          <CardContent>
            {critical.error ? (
              <p className="text-destructive text-sm">{errorText(t, critical.error)}</p>
            ) : critical.data?.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('reports.attention.noneCritical')}</p>
            ) : (
              <ul aria-label={t('reports.attention.critical')} className="grid gap-1">
                {(critical.data ?? []).map((p) => (
                  <li key={p.id}>
                    <button type="button" className={ROW} onClick={() => setRun({ id: p.occurrenceId, tab: 'execution' })}>
                      <span className="font-medium">{p.itemLabel ?? p.checklistName}</span>
                      <span className="text-muted-foreground">
                        {p.checklistName} · {p.siteName} · {formatLocalDate(p.localDate, tenant.locale)}
                      </span>
                      {p.note && <span className="w-full">{p.note}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      {run && <RunDrawer id={run.id} tab={run.tab} onClose={() => setRun(null)} />}
    </section>
  );
}
```

- [ ] **Step 4: Implement the dashboard, the home page switch and the route search**

`apps/web/src/features/reports/dashboard-page.tsx`:

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useTenantToday, useTimeFormat } from '@/features/scheduling/labels';
import { errorText } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { AttentionPanel } from './attention-panel';
import { DASHBOARD_TILES } from './labels';
import { reportKeys, useReportSummary } from './queries';
import { ReportFilters } from './report-filters';
import { reportSearch, resolveReportFilters } from './search';
import { SummaryView } from './summary-view';

/**
 * The web home page for reports.view holders (spec §6.1). Its numbers are live: polled every minute while visible,
 * refreshed on demand. "Today" is read on every render, so a page left open past midnight moves to the new day once
 * the next poll re-renders it (decision 10).
 */
export function DashboardPage({ today: fixedToday }: { today?: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const time = useTimeFormat();
  const tenantToday = useTenantToday();
  const today = fixedToday ?? tenantToday;
  const search = reportSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const resolved = resolveReportFilters(search, today);
  const filters = resolved.ok ? resolved.filters : null;
  const summary = useReportSummary(filters, { live: true });

  return (
    <div className="grid gap-4">
      <PageHeader
        title={t('reports.dashboard')}
        actions={
          <>
            {summary.dataUpdatedAt > 0 && (
              <span className="text-muted-foreground self-center text-sm">{t('reports.live.updatedAt', { time: time(new Date(summary.dataUpdatedAt).toISOString()) })}</span>
            )}
            <Button variant="outline" disabled={summary.isFetching} onClick={() => void qc.invalidateQueries({ queryKey: reportKeys.all })}>
              <RefreshCw className={cn('size-4', summary.isFetching && 'animate-spin')} aria-hidden />
              {t('reports.live.refresh')}
            </Button>
          </>
        }
      />
      <ReportFilters value={search} today={today} onChange={(next) => void navigate({ to: '/', search: next, replace: true })} />
      {summary.error && <p className="text-destructive">{errorText(t, summary.error)}</p>}
      {summary.data && filters && <SummaryView summary={summary.data} search={search} filters={filters} tiles={DASHBOARD_TILES} />}
      {filters && <AttentionPanel filters={filters} today={today} />}
    </div>
  );
}
```

Replace `apps/web/src/features/home/home-page.tsx` with:

```tsx
import { useTranslation } from 'react-i18next';
import { DashboardPage } from '@/features/reports/dashboard-page';
import { useCan, useMe } from '@/lib/session';

/** Spec §6.1: the dashboard for reports.view holders; everyone else keeps the welcome page. */
export function HomePage() {
  const canReport = useCan('reports.view');
  return canReport ? <DashboardPage /> : <Welcome />;
}

function Welcome() {
  const { t } = useTranslation();
  const me = useMe();
  return (
    <div className="grid max-w-2xl gap-3">
      <h1 className="text-2xl font-semibold">{t('nav.welcome', { name: me.user.fullName.split(' ')[0] })}</h1>
      <p className="text-muted-foreground">{t('nav.intro')}</p>
    </div>
  );
}
```

In `apps/web/src/router.tsx`, extend the reports search import to `import { reportSearch, reportsPageSearch } from '@/features/reports/search';` and give the home route its validated search:

```tsx
const homeRoute = createRoute({ getParentRoute: () => appLayout, path: '/', component: HomePage, validateSearch: reportSearch });
```

- [ ] **Step 5: Point the older end-to-end specs at the dashboard**

The owner holds every permission, so after signup the home page is now the dashboard (decision 17). In `apps/web/e2e/foundation.spec.ts` (line 16) and `apps/web/e2e/checklists.spec.ts` (line 14), replace

```ts
  await expect(page.getByRole('heading', { name: 'Xoş gəlmisiniz, Elvin!' })).toBeVisible();
```

with

```ts
  await expect(page.getByRole('heading', { name: 'İdarə paneli' })).toBeVisible();
```

They run in Task 10, once Part 1's endpoints are merged.

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/reports features/home && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/reports/dashboard-page.tsx apps/web/src/features/reports/dashboard-page.test.tsx apps/web/src/features/reports/attention-panel.tsx apps/web/src/features/home/home-page.tsx apps/web/src/features/home/home-page.test.tsx apps/web/src/router.tsx apps/web/e2e/foundation.spec.ts apps/web/e2e/checklists.spec.ts
git commit -m "feat(web): show the live dashboard on the home page for report viewers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The Sites and Employees tabs: sortable comparisons, drill-downs, the Unassigned row

**Files:**
- Create: `apps/web/src/features/reports/sortable-head.tsx`, `apps/web/src/features/reports/comparison-table.tsx`, `apps/web/src/features/reports/sites-tab.tsx`, `apps/web/src/features/reports/employees-tab.tsx`
- Modify: `apps/web/src/features/reports/reports-page.tsx`, `apps/web/src/features/reports/reports-page.test.tsx`
- Test: `apps/web/src/features/reports/sites-tab.test.tsx`, `apps/web/src/features/reports/employees-tab.test.tsx`

**Interfaces:**
- Consumes: Part 1: `type SiteReportRow`, `type EmployeeReportRow`, `type RunCounts`, `type ReportFilters`; Task 3: `sortRows`, `nextSort`, `type SortState`, `percentText`, `useSiteReport`, `useEmployeeReport`; fixtures `SITE_ROWS`, `EMPLOYEE_ROWS`; Task 5: `TabBody`, `go`
- Produces:
  - `SortableHead({ label, dir: 'asc' | 'desc' | null, onSort, numeric? })`: a `columnheader` with `aria-sort` and a button named "`<label>` üzrə sırala"
  - `type ComparisonKey`; `COMPARISON_COLUMNS: readonly ComparisonKey[]`; `ComparisonTable<T extends ComparisonRow>({ rows, nameLabel, rowKey, renderName, pinLast? })`
  - `SitesTab({ filters, onDrill: (siteId: string) => void })`; `EmployeesTab({ filters, onDrill: (userId: string) => void })`
  - `TabBody` cases `sites` and `employees`: a row sets `siteId` / `userId` and opens Summary (push)

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/reports/sites-tab.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '@/test/router';
import { IDS, SITE_ROWS, TODAY } from './fixtures';
import { SitesTab } from './sites-tab';

const mocks = vi.hoisted(() => ({ api: { reports: { sites: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api, useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));

const FILTERS = { from: TODAY, to: TODAY };
/** The name button of every data row, in order. */
const names = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('button')[0]!.textContent);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.api.reports.sites.mockResolvedValue(SITE_ROWS);
});

describe('SitesTab', () => {
  it('compares sites in tree order with their parent path, inactive marks and percentages, and drills down', async () => {
    const onDrill = vi.fn();
    renderWithRouter(<SitesTab filters={FILTERS} onDrill={onDrill} />);
    const rows = await screen.findAllByRole('row');
    expect(mocks.api.reports.sites).toHaveBeenCalledWith(FILTERS);
    expect(rows).toHaveLength(4);
    expect(within(rows[0]!).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Obyekt',
      'Planlaşdırılıb',
      'Tamamlanıb',
      'Gecikib',
      'Yarımçıq',
      'Buraxılıb',
      'Problemli',
      'Tamamlanma faizi',
      'Orta bal',
    ]);
    expect(names()).toEqual(['Filial A', 'Zona A1', 'Zona B (köhnə)']);
    const zone = within(rows[2]!).getAllByRole('cell');
    expect(zone[0]).toHaveTextContent('Filial A');
    expect(zone.slice(1).map((c) => c.textContent)).toEqual(['8', '5', '1', '0', '0', '0', '83,3%', '90%']);
    expect(rows[3]).toHaveTextContent('Deaktiv');
    expect(within(rows[3]!).getAllByRole('cell').slice(-2).map((c) => c.textContent)).toEqual(['—', '—']);
    await userEvent.click(within(rows[2]!).getByRole('button', { name: 'Zona A1' }));
    expect(onDrill).toHaveBeenCalledWith(IDS.zoneA);
  });

  it('sorts by a column with missing percentages last, then reverses', async () => {
    renderWithRouter(<SitesTab filters={FILTERS} onDrill={vi.fn()} />);
    await screen.findAllByRole('row');
    const sort = screen.getByRole('button', { name: 'Tamamlanma faizi üzrə sırala' });
    await userEvent.click(sort);
    expect(names()).toEqual(['Zona A1', 'Filial A', 'Zona B (köhnə)']);
    expect(screen.getByRole('columnheader', { name: 'Tamamlanma faizi üzrə sırala' })).toHaveAttribute('aria-sort', 'descending');
    await userEvent.click(sort);
    expect(names()).toEqual(['Filial A', 'Zona A1', 'Zona B (köhnə)']);
    expect(screen.getByRole('columnheader', { name: 'Tamamlanma faizi üzrə sırala' })).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.click(screen.getByRole('button', { name: 'Obyekt üzrə sırala' }));
    expect(names()).toEqual(['Filial A', 'Zona A1', 'Zona B (köhnə)']);
  });

  it('says so when no site had a run in the period', async () => {
    mocks.api.reports.sites.mockResolvedValue([]);
    renderWithRouter(<SitesTab filters={FILTERS} onDrill={vi.fn()} />);
    expect(await screen.findByText('Bu dövr üçün məlumat yoxdur.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
```

`apps/web/src/features/reports/employees-tab.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '@/test/router';
import { EmployeesTab } from './employees-tab';
import { EMPLOYEE_ROWS, IDS, TODAY } from './fixtures';

const mocks = vi.hoisted(() => ({ api: { reports: { employees: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api, useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));

const FILTERS = { from: TODAY, to: TODAY };
const firstCells = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0]!.textContent);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.api.reports.employees.mockResolvedValue(EMPLOYEE_ROWS);
});

describe('EmployeesTab', () => {
  it('lists people by name with the Unassigned row last and not clickable, the inactive mark and the over-count note', async () => {
    const onDrill = vi.fn();
    renderWithRouter(<EmployeesTab filters={FILTERS} onDrill={onDrill} />);
    const rows = await screen.findAllByRole('row');
    expect(mocks.api.reports.employees).toHaveBeenCalledWith(FILTERS);
    expect(firstCells()).toEqual(['Aynur Quliyeva', 'Kamran Əliyev', 'Rauf HəsənovDeaktiv', 'Təyin edilməyib']);
    expect(within(rows[4]!).queryByRole('button')).not.toBeInTheDocument();
    expect(within(rows[4]!).getAllByRole('cell')[1]).toHaveTextContent('9');
    expect(
      screen.getByText(
        'Bir neçə icraçıya təyin olunmuş və icra edilməmiş icra hər icraçı üçün ayrıca sayılır, ona görə cəm obyektlər cədvəlindəkindən çox ola bilər.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(within(rows[2]!).getByRole('button', { name: 'Kamran Əliyev' }));
    expect(onDrill).toHaveBeenCalledWith(IDS.kamran);
  });

  it('keeps the Unassigned row last whatever the sort', async () => {
    renderWithRouter(<EmployeesTab filters={FILTERS} onDrill={vi.fn()} />);
    await screen.findAllByRole('row');
    // Unassigned has the most planned runs (9), yet stays at the bottom.
    await userEvent.click(screen.getByRole('button', { name: 'Planlaşdırılıb üzrə sırala' }));
    expect(firstCells()).toEqual(['Aynur Quliyeva', 'Kamran Əliyev', 'Rauf HəsənovDeaktiv', 'Təyin edilməyib']);
    await userEvent.click(screen.getByRole('button', { name: 'Əməkdaş üzrə sırala' }));
    await userEvent.click(screen.getByRole('button', { name: 'Əməkdaş üzrə sırala' }));
    expect(firstCells()).toEqual(['Rauf HəsənovDeaktiv', 'Kamran Əliyev', 'Aynur Quliyeva', 'Təyin edilməyib']);
  });
});
```

Append to the `describe('ReportsPage')` block of `apps/web/src/features/reports/reports-page.test.tsx` (add `SITE_ROWS` to the `./fixtures` import):

```tsx
  it('drills down from a site row to its Summary, keeps the period, and Back returns to the sites', async () => {
    mocks.api.reports.sites.mockResolvedValue(SITE_ROWS);
    const router = renderWithRouter(<ReportsPage today={TODAY} />, '/reports?tab=sites&period=last_7');
    await userEvent.click(await screen.findByRole('button', { name: 'Zona A1' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ period: 'last_7', tab: 'summary', siteId: IDS.zoneA }));
    expect(screen.getByRole('tab', { name: 'Xülasə' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(mocks.api.reports.summary).toHaveBeenLastCalledWith({ from: '2026-10-29', to: TODAY, siteId: IDS.zoneA }));
    router.history.back();
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'sites', period: 'last_7' }));
  });

  it('drills down from an employee row to their Summary', async () => {
    const router = renderWithRouter(<ReportsPage today={TODAY} />, '/reports?tab=employees');
    await userEvent.click(await screen.findByRole('button', { name: 'Aynur Quliyeva' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'summary', userId: IDS.aynur }));
    await waitFor(() => expect(mocks.api.reports.summary).toHaveBeenLastCalledWith({ from: TODAY, to: TODAY, userId: IDS.aynur }));
  });
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/web test -- features/reports/sites-tab features/reports/employees-tab features/reports/reports-page`
Expected: FAIL: `Failed to resolve import "./sites-tab"` (and `./employees-tab`); the page tests find no "Zona A1" button.

- [ ] **Step 3: Implement the sortable table**

`apps/web/src/features/reports/sortable-head.tsx`:

```tsx
import { ArrowUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TableHead } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/** A column header that sorts its table; `aria-sort` tells screen readers the current order. */
export function SortableHead({ label, dir, onSort, numeric }: { label: string; dir: 'asc' | 'desc' | null; onSort: () => void; numeric?: boolean }) {
  const { t } = useTranslation();
  return (
    <TableHead aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'} className={cn(numeric && 'text-right')}>
      <button type="button" onClick={onSort} aria-label={t('reports.table.sort', { column: label })} className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
        {label}
        <ArrowUpDown className="size-3" aria-hidden />
      </button>
    </TableHead>
  );
}
```

`apps/web/src/features/reports/comparison-table.tsx`:

```tsx
import type { RunCounts } from '@taskop/contracts';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import { useMe } from '@/lib/session';
import { nextSort, percentText, type SortState, sortRows } from './labels';
import { SortableHead } from './sortable-head';

export type ComparisonKey = 'name' | 'planned' | 'completed' | 'overdue' | 'partial' | 'missed' | 'withProblems' | 'completionPercent' | 'averageScore';

/** Spec §5.3 columns of the site and employee comparisons. */
export const COMPARISON_COLUMNS: readonly ComparisonKey[] = ['name', 'planned', 'completed', 'overdue', 'partial', 'missed', 'withProblems', 'completionPercent', 'averageScore'];

const COUNT_COLUMNS = ['planned', 'completed', 'overdue', 'partial', 'missed', 'withProblems'] as const;

interface ComparisonRow extends RunCounts {
  name: string;
  active: boolean;
  completionPercent: number | null;
  averageScore: number | null;
}

/** A client-side sortable comparison (decision 12); `pinLast` rows (the Unassigned row) stay at the bottom. */
export function ComparisonTable<T extends ComparisonRow>({
  rows,
  nameLabel,
  rowKey,
  renderName,
  pinLast,
}: {
  rows: readonly T[];
  nameLabel: string;
  rowKey: (row: T) => string;
  renderName: (row: T) => ReactNode;
  pinLast?: (row: T) => boolean;
}) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  const [sort, setSort] = useState<SortState<ComparisonKey> | null>(null);
  const label = (k: ComparisonKey) =>
    k === 'name' ? nameLabel : k === 'completionPercent' || k === 'averageScore' ? t(`reports.measures.${k}`) : t(`reports.counts.${k}`);
  const sorted = sortRows(rows, sort, pinLast);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {COMPARISON_COLUMNS.map((k) => (
            <SortableHead key={k} label={label(k)} dir={sort?.key === k ? sort.dir : null} numeric={k !== 'name'} onSort={() => setSort((s) => nextSort(s, k))} />
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((r) => (
          <TableRow key={rowKey(r)}>
            <TableCell>{renderName(r)}</TableCell>
            {COUNT_COLUMNS.map((k) => (
              <TableCell key={k} className="text-right tabular-nums">
                {r[k]}
              </TableCell>
            ))}
            <TableCell className="text-right tabular-nums">{percentText(t, r.completionPercent, tenant.locale)}</TableCell>
            <TableCell className="text-right tabular-nums">{percentText(t, r.averageScore, tenant.locale)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 4: Implement the two tabs and wire them into the page**

`apps/web/src/features/reports/sites-tab.tsx`:

```tsx
import type { ReportFilters } from '@taskop/contracts';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { errorText } from '@/lib/errors';
import { ComparisonTable } from './comparison-table';
import { useSiteReport } from './queries';

/** Spec §6.2 "Sites": tree order, the parent path under the name, inactive sites marked; a row drills down. */
export function SitesTab({ filters, onDrill }: { filters: ReportFilters; onDrill: (siteId: string) => void }) {
  const { t } = useTranslation();
  const sites = useSiteReport(filters);
  if (sites.error) return <p className="text-destructive">{errorText(t, sites.error)}</p>;
  if (!sites.data) return <p className="text-muted-foreground">{t('common.loading')}</p>;
  if (sites.data.length === 0) return <p className="text-muted-foreground">{t('reports.empty')}</p>;
  return (
    <ComparisonTable
      rows={sites.data}
      nameLabel={t('reports.columns.site')}
      rowKey={(r) => r.siteId}
      renderName={(r) => (
        <div className="grid">
          <span className="flex items-center gap-2">
            <button type="button" className="font-medium underline-offset-4 hover:underline" onClick={() => onDrill(r.siteId)}>
              {r.name}
            </button>
            {!r.active && <Badge variant="outline">{t('reports.inactive')}</Badge>}
          </span>
          {r.path.length > 0 && <span className="text-muted-foreground text-xs">{r.path.join(' › ')}</span>}
        </div>
      )}
    />
  );
}
```

`apps/web/src/features/reports/employees-tab.tsx`:

```tsx
import type { EmployeeReportRow, ReportFilters } from '@taskop/contracts';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { errorText } from '@/lib/errors';
import { ComparisonTable } from './comparison-table';
import { useEmployeeReport } from './queries';

const isUnassigned = (r: EmployeeReportRow) => r.userId === null;

/**
 * Spec §6.2 "Employees" (§3.3 attribution): the Unassigned row last and not clickable (decision 11), and the note
 * that the Planned column may add up to more than the sites table.
 */
export function EmployeesTab({ filters, onDrill }: { filters: ReportFilters; onDrill: (userId: string) => void }) {
  const { t } = useTranslation();
  const people = useEmployeeReport(filters);
  if (people.error) return <p className="text-destructive">{errorText(t, people.error)}</p>;
  if (!people.data) return <p className="text-muted-foreground">{t('common.loading')}</p>;
  if (people.data.length === 0) return <p className="text-muted-foreground">{t('reports.empty')}</p>;
  return (
    <div className="grid gap-2">
      <ComparisonTable
        rows={people.data}
        nameLabel={t('reports.columns.employee')}
        rowKey={(r) => r.userId ?? 'unassigned'}
        pinLast={isUnassigned}
        renderName={(r) =>
          r.userId === null ? (
            <span className="text-muted-foreground italic">{r.name}</span>
          ) : (
            <span className="flex items-center gap-2">
              <button type="button" className="font-medium underline-offset-4 hover:underline" onClick={() => onDrill(r.userId!)}>
                {r.name}
              </button>
              {!r.active && <Badge variant="outline">{t('reports.inactive')}</Badge>}
            </span>
          )
        }
      />
      <p className="text-muted-foreground text-sm">{t('reports.employees.overCountNote')}</p>
    </div>
  );
}
```

In `apps/web/src/features/reports/reports-page.tsx`, import both tabs:

```tsx
import { EmployeesTab } from './employees-tab';
import { SitesTab } from './sites-tab';
```

and replace `TabBody` with:

```tsx
/** The open tab's report. Task 8 adds runs, problems and tasks. */
function TabBody({ kind, search, filters, go }: { kind: ReportKind; search: ReportsPageSearch; filters: Filters; go: Go }) {
  switch (kind) {
    case 'summary':
      return <SummaryTab search={filterSearch(search)} filters={filters} />;
    case 'sites':
      // A row narrows the report to that site and its zones, on Summary (spec §6.2).
      return <SitesTab filters={filters} onDrill={(siteId) => go({ ...search, siteId, tab: 'summary' })} />;
    case 'employees':
      return <EmployeesTab filters={filters} onDrill={(userId) => go({ ...search, userId, tab: 'summary' })} />;
    default:
      return null;
  }
}
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/reports && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/reports/sortable-head.tsx apps/web/src/features/reports/comparison-table.tsx apps/web/src/features/reports/sites-tab.tsx apps/web/src/features/reports/sites-tab.test.tsx apps/web/src/features/reports/employees-tab.tsx apps/web/src/features/reports/employees-tab.test.tsx apps/web/src/features/reports/reports-page.tsx apps/web/src/features/reports/reports-page.test.tsx
git commit -m "feat(web): add the site and employee comparisons with sorting and drill-downs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The Runs, Problems and Tasks tabs: chips, paged lists, the run and task drawers

**Files:**
- Create: `apps/web/src/features/reports/chip-group.tsx`, `apps/web/src/features/reports/stat-list.tsx`, `apps/web/src/features/reports/runs-tab.tsx`, `apps/web/src/features/reports/problems-tab.tsx`, `apps/web/src/features/reports/tasks-tab.tsx`
- Modify: `apps/web/src/features/reports/reports-page.tsx`, `apps/web/src/features/reports/reports-page.test.tsx`
- Test: `apps/web/src/features/reports/runs-tab.test.tsx`, `apps/web/src/features/reports/problems-tab.test.tsx`, `apps/web/src/features/reports/tasks-tab.test.tsx`

**Interfaces:**
- Consumes:
  - Part 1: `RUN_BUCKETS`, `type RunBucket`, `type ReportRun`, `type ReportProblem`, `type ReportTask`, `TASK_STATUSES`, `PROBLEM_SEVERITIES`, `type ProblemSeverity`, `type ReportFilters`
  - Task 2: `DEFAULT_BUCKET`, `cleanSearch`; Task 3: `useReportRuns`, `useReportProblems`, `useReportTasks`, `percentText`, `RunDrawer`, `ReportTaskDrawer`; fixtures
  - Existing: `occurrenceVariant`, `formatLocalDate`, `useTimeFormat` (`features/scheduling/labels`), `receiptDiffers`, `severityVariant` (`features/executions/labels`), `taskStatusVariant`, `resolutionVariant`, `assigneeText` (`features/tasks/labels`), `useFormatDateTime`, `errorText`, `taskDetail`, `occurrenceDetail`
- Produces:
  - `ChipGroup<T extends string>({ label, options: { value: T; label: string }[], value: T, onChange })`: a `group` of `aria-pressed` buttons
  - `StatList({ label, items: { label: string; value: number }[] })`: a `region` with a `<dl>`
  - `RunsTab({ filters, bucket: RunBucket, onBucket })`, `ProblemsTab({ filters, severity: ProblemSeverity | null, onSeverity })`, `TasksTab({ filters })`
  - `TabBody` handles every `ReportKind` (no `default` any more)

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/reports/runs-tab.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { occurrenceDetail } from '@/features/executions/fixtures';
import { formatLocalDate } from '@/features/scheduling/labels';
import { renderWithRouter } from '@/test/router';
import { completedRun, IDS, meWith, page, reportRun, TODAY, VIEWER } from './fixtures';
import { RunsTab } from './runs-tab';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: { reports: { runs: vi.fn() }, occurrences: { get: vi.fn(), cancel: vi.fn() }, executions: { get: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));

const FILTERS = { from: TODAY, to: TODAY };

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.me.current = meWith(VIEWER);
  mocks.api.reports.runs.mockResolvedValue(page([reportRun(), completedRun()]));
  mocks.api.occurrences.get.mockImplementation(async (id: string) => occurrenceDetail({ id }));
});

describe('RunsTab', () => {
  it('lists the runs with tenant-zone times, the people, a late sync’s server receipt, the score and the flags', async () => {
    renderWithRouter(<RunsTab filters={FILTERS} bucket="all" onBucket={vi.fn()} />);
    const rows = await screen.findAllByRole('row');
    expect(mocks.api.reports.runs).toHaveBeenCalledWith({ ...FILTERS, bucket: 'all' });
    expect(rows).toHaveLength(3);
    // Overdue and never started: both assignees, no times, no score.
    for (const text of [formatLocalDate(TODAY), '10:00', 'Açılış yoxlaması', 'Zona A1', 'Gecikib', 'Aynur Quliyeva, Kamran Əliyev']) expect(rows[1]).toHaveTextContent(text);
    // Completed offline by Aynur at 09:40 and received at 13:00: the executor only, both times, score and flags.
    for (const text of ['Tamamlanıb', 'Aynur Quliyeva', '09:40', 'Serverə çatıb:', '13:00', '87,5%', 'Telefon saatı şübhəlidir', 'Kritik: 1']) {
      expect(rows[2]).toHaveTextContent(text);
    }
    expect(rows[2]).not.toHaveTextContent('Kamran');
  });

  it('switches the bucket with the chips', async () => {
    const onBucket = vi.fn();
    renderWithRouter(<RunsTab filters={FILTERS} bucket="overdue" onBucket={onBucket} />);
    const chips = screen.getByRole('group', { name: 'İcralar' });
    expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual(['Gecikmiş', 'Yarımçıq', 'Buraxılmış', 'Problemli', 'Tamamlanmış', 'Davam edən', 'Hamısı']);
    expect(within(chips).getByRole('button', { name: 'Gecikmiş' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(chips).getByRole('button', { name: 'Hamısı' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(within(chips).getByRole('button', { name: 'Buraxılmış' }));
    expect(onBucket).toHaveBeenCalledWith('missed');
    await waitFor(() => expect(mocks.api.reports.runs).toHaveBeenCalledWith({ ...FILTERS, bucket: 'overdue' }));
  });

  it('loads the next page with the cursor and stops on the last one', async () => {
    mocks.api.reports.runs.mockResolvedValueOnce(page([reportRun()], IDS.run)).mockResolvedValueOnce(page([completedRun()]));
    renderWithRouter(<RunsTab filters={FILTERS} bucket="all" onBucket={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Daha çox göstər' }));
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3));
    expect(mocks.api.reports.runs).toHaveBeenLastCalledWith({ ...FILTERS, bucket: 'all', cursor: IDS.run });
    expect(screen.queryByRole('button', { name: 'Daha çox göstər' })).not.toBeInTheDocument();
  });

  it('opens a run in the run drawer on its overview', async () => {
    renderWithRouter(<RunsTab filters={FILTERS} bucket="all" onBucket={vi.fn()} />);
    const rows = await screen.findAllByRole('row');
    await userEvent.click(within(rows[1]!).getByRole('button', { name: 'Açılış yoxlaması' }));
    const drawer = await screen.findByRole('dialog');
    expect(await within(drawer).findByRole('tab', { name: 'Ümumi' })).toHaveAttribute('aria-selected', 'true');
    expect(mocks.api.occurrences.get).toHaveBeenCalledWith(IDS.run);
  });

  it('says so when the bucket is empty', async () => {
    mocks.api.reports.runs.mockResolvedValue(page([]));
    renderWithRouter(<RunsTab filters={FILTERS} bucket="missed" onBucket={vi.fn()} />);
    expect(await screen.findByText('Bu dövr üçün məlumat yoxdur.')).toBeInTheDocument();
  });
});
```

`apps/web/src/features/reports/problems-tab.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { occurrenceDetail } from '@/features/executions/fixtures';
import { taskDetail } from '@/features/tasks/fixtures';
import { renderWithRouter } from '@/test/router';
import { IDS, meWith, reportProblem, reportProblems, TODAY, VIEWER } from './fixtures';
import { ProblemsTab } from './problems-tab';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: {
    reports: { problems: vi.fn() },
    occurrences: { get: vi.fn(), cancel: vi.fn() },
    executions: { get: vi.fn() },
    tasks: { get: vi.fn() },
    taskMedia: { url: vi.fn() },
  },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));

const FILTERS = { from: TODAY, to: TODAY };
const stat = (region: HTMLElement, label: string) => within(region).getByText(label).nextElementSibling;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.me.current = meWith([...VIEWER, 'tasks.view']);
  mocks.api.reports.problems.mockResolvedValue(
    reportProblems([reportProblem(), reportProblem({ id: IDS.task2, severity: 'normal', source: 'rule', itemLabel: 'Qapı bağlıdır?', note: null, resolution: 'none', taskId: null, taskStatus: null })]),
  );
  mocks.api.occurrences.get.mockImplementation(async (id: string) => occurrenceDetail({ id }));
  mocks.api.tasks.get.mockImplementation(async (id: string) => taskDetail({ id }));
});

describe('ProblemsTab', () => {
  it('shows the counts by severity and resolution and lists the problems with their task', async () => {
    renderWithRouter(<ProblemsTab filters={FILTERS} severity={null} onSeverity={vi.fn()} />);
    const counts = await screen.findByRole('region', { name: 'Problemlər' });
    expect(stat(counts, 'Cəmi problem')).toHaveTextContent('3');
    expect(stat(counts, 'Kritik')).toHaveTextContent('1');
    expect(stat(counts, 'Tapşırıq yoxdur')).toHaveTextContent('1');
    expect(stat(counts, 'Açıq')).toHaveTextContent('1');
    expect(stat(counts, 'Həll olunub')).toHaveTextContent('1');
    expect(stat(counts, 'Ləğv edilib')).toHaveTextContent('0');
    expect(mocks.api.reports.problems).toHaveBeenCalledWith(FILTERS);
    const rows = screen.getAllByRole('row');
    for (const text of ['Soyuducunun temperaturu', 'Açılış yoxlaması', 'Zona A1', 'Kritik', 'Əl ilə qeyd', 'Kondisioner xarabdır', 'Aynur Quliyeva', 'Açıq', 'İcradadır']) {
      expect(rows[1]).toHaveTextContent(text);
    }
    for (const text of ['Qapı bağlıdır?', 'Adi', 'Qayda üzrə', 'Tapşırıq yoxdur']) expect(rows[2]).toHaveTextContent(text);
    expect(within(rows[2]!).queryByRole('button', { name: /Tapşırığı aç/ })).not.toBeInTheDocument();
  });

  it('filters by severity with the chips', async () => {
    const onSeverity = vi.fn();
    renderWithRouter(<ProblemsTab filters={FILTERS} severity="critical" onSeverity={onSeverity} />);
    const chips = screen.getByRole('group', { name: 'Ciddilik' });
    expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual(['Hamısı', 'Adi', 'Kritik']);
    expect(within(chips).getByRole('button', { name: 'Kritik' })).toHaveAttribute('aria-pressed', 'true');
    expect(mocks.api.reports.problems).toHaveBeenCalledWith({ ...FILTERS, severity: 'critical' });
    await userEvent.click(within(chips).getByRole('button', { name: 'Hamısı' }));
    expect(onSeverity).toHaveBeenCalledWith(null);
    await userEvent.click(within(chips).getByRole('button', { name: 'Adi' }));
    expect(onSeverity).toHaveBeenLastCalledWith('normal');
  });

  it('opens a problem’s run on the execution tab and its task in the task drawer', async () => {
    renderWithRouter(<ProblemsTab filters={FILTERS} severity={null} onSeverity={vi.fn()} />);
    const rows = await screen.findAllByRole('row');
    await userEvent.click(within(rows[1]!).getByRole('button', { name: 'Soyuducunun temperaturu' }));
    const drawer = await screen.findByRole('dialog');
    expect(await within(drawer).findByRole('tab', { name: 'İcra' })).toHaveAttribute('aria-selected', 'true');
    expect(mocks.api.occurrences.get).toHaveBeenCalledWith(IDS.run2);
    await userEvent.click(within(drawer).getByRole('button', { name: 'Bağla' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(within(screen.getAllByRole('row')[1]!).getByRole('button', { name: /Tapşırığı aç/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(mocks.api.tasks.get).toHaveBeenCalledWith(IDS.task);
  });
});
```

`apps/web/src/features/reports/tasks-tab.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { taskDetail } from '@/features/tasks/fixtures';
import { renderWithRouter } from '@/test/router';
import { IDS, meWith, reportTask, reportTasks, TODAY, VIEWER } from './fixtures';
import { TasksTab } from './tasks-tab';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: { reports: { tasks: vi.fn() }, tasks: { get: vi.fn() }, taskMedia: { url: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));

const FILTERS = { from: TODAY, to: TODAY };
const stat = (region: HTMLElement, label: string) => within(region).getByText(label).nextElementSibling;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.me.current = meWith([...VIEWER, 'tasks.view']);
  mocks.api.reports.tasks.mockResolvedValue(
    reportTasks([
      reportTask(),
      reportTask({ id: IDS.task2, title: 'Kameranı yoxla', priority: 'normal', status: 'accepted', assignee: null, team: { id: 'team1', name: 'Texniki xidmət' }, site: null, dueAt: null, overdue: false, problemId: null }),
    ]),
  );
  mocks.api.tasks.get.mockImplementation(async (id: string) => taskDetail({ id }));
});

describe('TasksTab', () => {
  it('shows the status counts and on-time against late, and lists the tasks', async () => {
    renderWithRouter(<TasksTab filters={FILTERS} />);
    const counts = await screen.findByRole('region', { name: 'Tapşırıqlar' });
    expect(stat(counts, 'Yeni')).toHaveTextContent('1');
    expect(stat(counts, 'İcradadır')).toHaveTextContent('2');
    expect(stat(counts, 'Yoxlamada')).toHaveTextContent('1');
    expect(stat(counts, 'Tamamlanıb')).toHaveTextContent('3');
    expect(stat(counts, 'Gecikmiş (açıq)')).toHaveTextContent('1');
    expect(stat(counts, 'Vaxtında tamamlanıb')).toHaveTextContent('2');
    expect(stat(counts, 'Gecikmə ilə tamamlanıb')).toHaveTextContent('1');
    expect(mocks.api.reports.tasks).toHaveBeenCalledWith(FILTERS);
    const rows = screen.getAllByRole('row');
    for (const text of ['Kondisioneri təmir et', 'İcradadır', 'Gecikib', 'Yüksək', 'Kamran Əliyev', 'Zona A1', '18:00']) expect(rows[1]).toHaveTextContent(text);
    for (const text of ['Kameranı yoxla', 'Qəbul edilib', 'Adi', 'Texniki xidmət (komanda)']) expect(rows[2]).toHaveTextContent(text);
    expect(rows[2]).not.toHaveTextContent('Gecikib');
  });

  it('opens a task in the task drawer', async () => {
    renderWithRouter(<TasksTab filters={FILTERS} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Kondisioneri təmir et' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(mocks.api.tasks.get).toHaveBeenCalledWith(IDS.task);
  });
});
```

Append to the `describe('ReportsPage')` block of `apps/web/src/features/reports/reports-page.test.tsx` (add `reportRun` to the `./fixtures` import):

```tsx
  it('keeps the runs bucket and the problems severity in the URL', async () => {
    mocks.api.reports.runs.mockResolvedValue(page([reportRun()]));
    const router = renderWithRouter(<ReportsPage today={TODAY} />, '/reports?tab=runs');
    await screen.findByRole('button', { name: 'Açılış yoxlaması' });
    expect(mocks.api.reports.runs).toHaveBeenCalledWith({ from: TODAY, to: TODAY, bucket: 'all' });
    await userEvent.click(screen.getByRole('button', { name: 'Buraxılmış' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'runs', bucket: 'missed' }));
    await waitFor(() => expect(mocks.api.reports.runs).toHaveBeenLastCalledWith({ from: TODAY, to: TODAY, bucket: 'missed' }));
  });
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/web test -- features/reports/runs-tab features/reports/problems-tab features/reports/tasks-tab features/reports/reports-page`
Expected: FAIL: `Failed to resolve import "./runs-tab"` (and `./problems-tab`, `./tasks-tab`); the page test finds no runs.

- [ ] **Step 3: Implement the shared pieces**

`apps/web/src/features/reports/chip-group.tsx`:

```tsx
import { Button } from '@/components/ui/button';

/** One-of-many filter chips (runs buckets, problem severity): a named group of toggle buttons. */
export function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <Button key={o.value} size="sm" variant={o.value === value ? 'default' : 'outline'} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </Button>
      ))}
    </div>
  );
}
```

`apps/web/src/features/reports/stat-list.tsx`:

```tsx
/** A row of small counts (problems by resolution, tasks by status) as a named region with a description list. */
export function StatList({ label, items }: { label: string; items: readonly { label: string; value: number }[] }) {
  return (
    <section aria-label={label}>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-[repeat(auto-fit,minmax(8rem,1fr))]">
        {items.map((i) => (
          <div key={i.label} className="rounded-lg border p-3">
            <dt className="text-muted-foreground text-xs">{i.label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{i.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
```

- [ ] **Step 4: Implement the three tabs**

`apps/web/src/features/reports/runs-tab.tsx`:

```tsx
import { type ReportFilters, type ReportRun, RUN_BUCKETS, type RunBucket } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { receiptDiffers } from '@/features/executions/labels';
import { formatLocalDate, occurrenceVariant, useTimeFormat } from '@/features/scheduling/labels';
import { errorText } from '@/lib/errors';
import { useFormatDateTime } from '@/lib/format';
import { useMe } from '@/lib/session';
import { ChipGroup } from './chip-group';
import { RunDrawer } from './drawers';
import { percentText } from './labels';
import { useReportRuns } from './queries';

const COLUMNS = ['date', 'dueAt', 'checklist', 'site', 'status', 'executor', 'completedAt', 'score', 'problemCount'] as const;

/**
 * Spec §6.2 "Runs": bucket chips and a paged list; a row opens the run drawer. Device times with the server receipt
 * beside them when a late sync makes them differ (FR-10.14); the late and clock-suspect flags are shown (spec §8).
 */
export function RunsTab({ filters, bucket, onBucket }: { filters: ReportFilters; bucket: RunBucket; onBucket: (bucket: RunBucket) => void }) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  const time = useTimeFormat();
  const formatDateTime = useFormatDateTime();
  const runs = useReportRuns(filters, bucket);
  const [open, setOpen] = useState<string | null>(null);
  const items = runs.data?.pages.flatMap((p) => p.items) ?? [];
  // An executed run belongs to its executor; an unexecuted one to its assignees (spec §3.3).
  const people = (r: ReportRun) => r.executor?.fullName ?? (r.assignees.map((a) => a.fullName).join(', ') || t('reports.employees.unassigned'));

  return (
    <div className="grid gap-4">
      <ChipGroup label={t('reports.filters.bucket')} options={RUN_BUCKETS.map((b) => ({ value: b, label: t(`reports.buckets.${b}`) }))} value={bucket} onChange={onBucket} />
      {runs.error && <p className="text-destructive">{errorText(t, runs.error)}</p>}
      {runs.isPending && <p className="text-muted-foreground">{t('common.loading')}</p>}
      {runs.isSuccess && items.length === 0 && <p className="text-muted-foreground">{t('reports.empty')}</p>}
      {items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((k) => (
                <TableHead key={k}>{t(`reports.columns.${k}`)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((r) => (
              <TableRow key={r.occurrenceId}>
                <TableCell>{formatLocalDate(r.localDate, tenant.locale)}</TableCell>
                <TableCell className="font-mono">{time(r.dueAt)}</TableCell>
                <TableCell>
                  <button type="button" className="font-medium underline-offset-4 hover:underline" onClick={() => setOpen(r.occurrenceId)}>
                    {r.checklist.name}
                  </button>
                </TableCell>
                <TableCell>{r.site.name}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={occurrenceVariant(r.status)}>{t(`scheduling.statuses.${r.status}`)}</Badge>
                    {r.late && <Badge variant="destructive">{t('executions.flags.late')}</Badge>}
                    {r.clockSuspect && <Badge variant="outline">{t('executions.flags.clockSuspect')}</Badge>}
                  </div>
                </TableCell>
                <TableCell>{people(r)}</TableCell>
                <TableCell>
                  {r.completedAt ? (
                    <div className="grid">
                      <span>{formatDateTime(r.completedAt)}</span>
                      {r.completedReceivedAt && receiptDiffers(r.completedAt, r.completedReceivedAt) && (
                        <span className="text-muted-foreground text-xs">{t('reports.table.receivedAt', { time: formatDateTime(r.completedReceivedAt) })}</span>
                      )}
                    </div>
                  ) : (
                    t('reports.noValue')
                  )}
                </TableCell>
                <TableCell className="tabular-nums">{percentText(t, r.score, tenant.locale)}</TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-1 tabular-nums">
                    {r.problemCount}
                    {r.criticalCount > 0 && <Badge variant="destructive">{`${t('executions.severities.critical')}: ${r.criticalCount}`}</Badge>}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {runs.hasNextPage && (
        <Button variant="outline" className="w-fit" disabled={runs.isFetchingNextPage} onClick={() => void runs.fetchNextPage()}>
          {t('reports.table.more')}
        </Button>
      )}
      {open && <RunDrawer id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
```

`apps/web/src/features/reports/problems-tab.tsx`:

```tsx
import { PROBLEM_SEVERITIES, type ProblemSeverity, type ReportFilters } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { severityVariant } from '@/features/executions/labels';
import { formatLocalDate } from '@/features/scheduling/labels';
import { resolutionVariant } from '@/features/tasks/labels';
import { errorText } from '@/lib/errors';
import { useMe } from '@/lib/session';
import { ChipGroup } from './chip-group';
import { ReportTaskDrawer, RunDrawer } from './drawers';
import { useReportProblems } from './queries';
import { StatList } from './stat-list';

const COLUMNS = ['date', 'item', 'checklist', 'site', 'severity', 'source', 'note', 'executor', 'resolution'] as const;
type SeverityChip = ProblemSeverity | 'all';

/**
 * Spec §6.2 "Problems": counts by severity and resolution (over the whole filtered set), severity chips and a paged
 * list. A row opens its run on the execution tab (decision 13); the linked task opens the task drawer.
 */
export function ProblemsTab({ filters, severity, onSeverity }: { filters: ReportFilters; severity: ProblemSeverity | null; onSeverity: (s: ProblemSeverity | null) => void }) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  const problems = useReportProblems(filters, severity);
  const [run, setRun] = useState<string | null>(null);
  const [task, setTask] = useState<string | null>(null);
  const counts = problems.data?.pages[0]?.counts;
  const items = problems.data?.pages.flatMap((p) => p.items) ?? [];
  const chips: { value: SeverityChip; label: string }[] = [
    { value: 'all', label: t('common.all') },
    ...PROBLEM_SEVERITIES.map((s) => ({ value: s, label: t(`executions.severities.${s}`) })),
  ];

  return (
    <div className="grid gap-4">
      {counts && (
        <StatList
          label={t('reports.tabs.problems')}
          items={[
            { label: t('reports.problems.total'), value: counts.total },
            { label: t('reports.problems.critical'), value: counts.critical },
            ...(['none', 'open', 'resolved', 'cancelled'] as const).map((r) => ({ label: t(`tasks.resolutions.${r}`), value: counts.resolution[r] })),
          ]}
        />
      )}
      <ChipGroup label={t('reports.filters.severity')} options={chips} value={severity ?? 'all'} onChange={(v) => onSeverity(v === 'all' ? null : v)} />
      {problems.error && <p className="text-destructive">{errorText(t, problems.error)}</p>}
      {problems.isPending && <p className="text-muted-foreground">{t('common.loading')}</p>}
      {problems.isSuccess && items.length === 0 && <p className="text-muted-foreground">{t('reports.empty')}</p>}
      {items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((k) => (
                <TableHead key={k}>{t(`reports.columns.${k}`)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{formatLocalDate(p.localDate, tenant.locale)}</TableCell>
                <TableCell>
                  <button type="button" className="font-medium underline-offset-4 hover:underline" onClick={() => setRun(p.occurrenceId)}>
                    {p.itemLabel ?? p.checklistName}
                  </button>
                </TableCell>
                <TableCell>{p.checklistName}</TableCell>
                <TableCell>{p.siteName}</TableCell>
                <TableCell>
                  <Badge variant={severityVariant(p.severity)}>{t(`executions.severities.${p.severity}`)}</Badge>
                </TableCell>
                <TableCell>{t(`executions.problemSources.${p.source}`)}</TableCell>
                <TableCell className="max-w-64 whitespace-pre-wrap">{p.note ?? t('reports.noValue')}</TableCell>
                <TableCell>{p.executorName}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge variant={resolutionVariant(p.resolution)}>{t(`tasks.resolutions.${p.resolution}`)}</Badge>
                    {p.taskId && (
                      <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setTask(p.taskId)}>
                        {t('reports.table.openTask')}
                        {p.taskStatus && ` · ${t(`tasks.statuses.${p.taskStatus}`)}`}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {problems.hasNextPage && (
        <Button variant="outline" className="w-fit" disabled={problems.isFetchingNextPage} onClick={() => void problems.fetchNextPage()}>
          {t('reports.table.more')}
        </Button>
      )}
      {run && <RunDrawer id={run} tab="execution" onClose={() => setRun(null)} />}
      {task && <ReportTaskDrawer id={task} onClose={() => setTask(null)} />}
    </div>
  );
}
```

`apps/web/src/features/reports/tasks-tab.tsx`:

```tsx
import { type ReportFilters, TASK_STATUSES } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { assigneeText, taskStatusVariant } from '@/features/tasks/labels';
import { errorText } from '@/lib/errors';
import { useFormatDateTime } from '@/lib/format';
import { ReportTaskDrawer } from './drawers';
import { useReportTasks } from './queries';
import { StatList } from './stat-list';

const COLUMNS = ['title', 'status', 'priority', 'assignee', 'site', 'due', 'completed'] as const;

/** Spec §6.2 "Tasks": counts by status, on time against late (spec §3.4), and a paged list; a row opens the task drawer. */
export function TasksTab({ filters }: { filters: ReportFilters }) {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const tasks = useReportTasks(filters);
  const [open, setOpen] = useState<string | null>(null);
  const counts = tasks.data?.pages[0]?.counts;
  const items = tasks.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="grid gap-4">
      {counts && (
        <StatList
          label={t('reports.tabs.tasks')}
          items={[
            ...TASK_STATUSES.map((s) => ({ label: t(`tasks.statuses.${s}`), value: counts.byStatus[s] })),
            { label: t('reports.tasks.overdueOpen'), value: counts.overdueOpen },
            { label: t('reports.tasks.completedOnTime'), value: counts.completedOnTime },
            { label: t('reports.tasks.completedLate'), value: counts.completedLate },
          ]}
        />
      )}
      {tasks.error && <p className="text-destructive">{errorText(t, tasks.error)}</p>}
      {tasks.isPending && <p className="text-muted-foreground">{t('common.loading')}</p>}
      {tasks.isSuccess && items.length === 0 && <p className="text-muted-foreground">{t('reports.empty')}</p>}
      {items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((k) => (
                <TableHead key={k}>{t(`reports.columns.${k}`)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <button type="button" className="font-medium underline-offset-4 hover:underline" onClick={() => setOpen(r.id)}>
                    {r.title}
                  </button>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={taskStatusVariant(r.status)}>{t(`tasks.statuses.${r.status}`)}</Badge>
                    {r.overdue && <Badge variant="destructive">{t('tasks.flags.overdue')}</Badge>}
                  </div>
                </TableCell>
                <TableCell>{t(`tasks.priorities.${r.priority}`)}</TableCell>
                <TableCell>{assigneeText(t, r)}</TableCell>
                <TableCell>{r.site?.name ?? t('reports.noValue')}</TableCell>
                <TableCell>{r.dueAt ? formatDateTime(r.dueAt) : t('reports.noValue')}</TableCell>
                <TableCell>{r.completedAt ? formatDateTime(r.completedAt) : t('reports.noValue')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {tasks.hasNextPage && (
        <Button variant="outline" className="w-fit" disabled={tasks.isFetchingNextPage} onClick={() => void tasks.fetchNextPage()}>
          {t('reports.table.more')}
        </Button>
      )}
      {open && <ReportTaskDrawer id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
```

- [ ] **Step 5: Wire the tabs into the page**

In `apps/web/src/features/reports/reports-page.tsx`, add the imports:

```tsx
import { ProblemsTab } from './problems-tab';
import { RunsTab } from './runs-tab';
import { TasksTab } from './tasks-tab';
```

extend the `./search` import with `cleanSearch` and `DEFAULT_BUCKET`, and replace `TabBody` with the complete switch (no `default`, so a new report kind fails the typecheck until it has a tab):

```tsx
/** The open tab's report. Chips push a history entry, like tabs (decision 3). */
function TabBody({ kind, search, filters, go }: { kind: ReportKind; search: ReportsPageSearch; filters: Filters; go: Go }): ReactNode {
  switch (kind) {
    case 'summary':
      return <SummaryTab search={filterSearch(search)} filters={filters} />;
    case 'sites':
      // A row narrows the report to that site and its zones, on Summary (spec §6.2).
      return <SitesTab filters={filters} onDrill={(siteId) => go({ ...search, siteId, tab: 'summary' })} />;
    case 'employees':
      return <EmployeesTab filters={filters} onDrill={(userId) => go({ ...search, userId, tab: 'summary' })} />;
    case 'runs':
      return <RunsTab filters={filters} bucket={search.bucket ?? DEFAULT_BUCKET} onBucket={(bucket) => go({ ...search, bucket })} />;
    case 'problems':
      return <ProblemsTab filters={filters} severity={search.severity ?? null} onSeverity={(severity) => go(cleanSearch({ ...search, severity: severity ?? undefined }))} />;
    case 'tasks':
      return <TasksTab filters={filters} />;
  }
}
```

and add `import type { ReactNode } from 'react';` at the top.

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/reports && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/reports/chip-group.tsx apps/web/src/features/reports/stat-list.tsx apps/web/src/features/reports/runs-tab.tsx apps/web/src/features/reports/runs-tab.test.tsx apps/web/src/features/reports/problems-tab.tsx apps/web/src/features/reports/problems-tab.test.tsx apps/web/src/features/reports/tasks-tab.tsx apps/web/src/features/reports/tasks-tab.test.tsx apps/web/src/features/reports/reports-page.tsx apps/web/src/features/reports/reports-page.test.tsx
git commit -m "feat(web): add the runs, problems and tasks reports with paging and drawers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The export menu: "Bu cədvəl" and "Tam hesabat"

**Files:**
- Create: `apps/web/src/features/reports/export-menu.tsx`
- Modify: `apps/web/src/features/reports/reports-page.tsx`, `apps/web/src/features/reports/reports-page.test.tsx`
- Test: `apps/web/src/features/reports/export-menu.test.tsx`

**Interfaces:**
- Consumes: Part 1: `api.reports.export(kind, query)` → `ReportFile`, `ApiError.rows` / `.limit`, `REPORT_FORMATS`, `type ReportKind`, `type ReportExportKind`, `type ReportFormat`, `type ProblemSeverity`, `type RunBucket`; Task 3: `exportQuery`, `exportErrorText`, `saveFile`; Task 2: `DEFAULT_BUCKET`; existing `useCan`, `DropdownMenu*`, `Button`, `toast` (`sonner`)
- Produces: `ExportMenu({ kind: ReportKind; filters: ReportFilters | null; bucket?: RunBucket; severity?: ProblemSeverity })`: nothing without `reports.view` + `reports.export`; trigger "İxrac et" (busy: "Fayl hazırlanır…", disabled, `aria-busy`); menu groups "Bu cədvəl" (CSV, Excel, PDF) and "Tam hesabat" (Excel, PDF). The Reports page shows it in its header for the open tab.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/reports/export-menu.test.tsx`:

```tsx
import { ApiError, type ReportFile } from '@taskop/api-client';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '@/components/ui/sonner';
import { renderWithProviders } from '@/test/render';
import { ExportMenu } from './export-menu';
import { IDS, meWith, VIEWER } from './fixtures';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: { reports: { export: vi.fn() } },
  saveFile: vi.fn(),
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));
vi.mock('./download', () => ({ saveFile: mocks.saveFile }));

const FILTERS = { from: '2026-11-01', to: '2026-11-30', siteId: IDS.zoneA };
const FILE: ReportFile = { blob: new Blob(['x']), filename: 'taskop-runs-2026-11-01_2026-11-30.xlsx' };

function renderMenu(props: Partial<ComponentProps<typeof ExportMenu>> = {}) {
  renderWithProviders(
    <>
      <ExportMenu kind="runs" filters={FILTERS} bucket="overdue" {...props} />
      <Toaster />
    </>,
  );
}

async function choose(group: 'Bu cədvəl' | 'Tam hesabat', format: 'CSV' | 'Excel' | 'PDF') {
  await userEvent.click(screen.getByRole('button', { name: 'İxrac et' }));
  await userEvent.click(within(await screen.findByRole('group', { name: group })).getByRole('menuitem', { name: format }));
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.resetAllMocks();
  mocks.me.current = meWith([...VIEWER, 'reports.export']);
  mocks.api.reports.export.mockResolvedValue(FILE);
});

describe('ExportMenu', () => {
  it('is not shown without reports.export', () => {
    mocks.me.current = meWith(VIEWER);
    renderMenu();
    expect(screen.queryByRole('button', { name: 'İxrac et' })).not.toBeInTheDocument();
  });

  it('offers the open table in three formats and the full report in two', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'İxrac et' }));
    expect(within(await screen.findByRole('group', { name: 'Bu cədvəl' })).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['CSV', 'Excel', 'PDF']);
    expect(within(screen.getByRole('group', { name: 'Tam hesabat' })).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Excel', 'PDF']);
  });

  it('downloads the open table with its bucket and saves it under the server’s name', async () => {
    renderMenu();
    await choose('Bu cədvəl', 'Excel');
    expect(mocks.api.reports.export).toHaveBeenCalledWith('runs', { ...FILTERS, format: 'xlsx', bucket: 'overdue' });
    expect(mocks.saveFile).toHaveBeenCalledWith(FILE);
  });

  it('sends the problems severity with the table, and neither bucket nor severity with the full report', async () => {
    renderMenu({ kind: 'problems', bucket: undefined, severity: 'critical' });
    await choose('Bu cədvəl', 'CSV');
    expect(mocks.api.reports.export).toHaveBeenLastCalledWith('problems', { ...FILTERS, format: 'csv', severity: 'critical' });
    await choose('Tam hesabat', 'PDF');
    expect(mocks.api.reports.export).toHaveBeenLastCalledWith('full', { ...FILTERS, format: 'pdf' });
  });

  it('shows a spinner while the file is built and starts one export at a time', async () => {
    let resolve!: (f: ReportFile) => void;
    mocks.api.reports.export.mockReturnValue(new Promise<ReportFile>((r) => (resolve = r)));
    renderMenu();
    await choose('Bu cədvəl', 'PDF');
    const busy = await screen.findByRole('button', { name: 'Fayl hazırlanır…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    // A disabled trigger opens no menu, so a second click starts nothing.
    await userEvent.click(busy);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(mocks.api.reports.export).toHaveBeenCalledOnce();
    await act(async () => resolve(FILE));
    expect(await screen.findByRole('button', { name: 'İxrac et' })).toBeEnabled();
    expect(mocks.saveFile).toHaveBeenCalledOnce();
  });

  it('says how many rows a too large export has and asks to narrow the filters', async () => {
    mocks.api.reports.export.mockRejectedValue(new ApiError(422, 'REPORT_TOO_LARGE', 'errors.REPORT_TOO_LARGE', null, null, 'r1', null, null, null, null, 12000, 10000));
    renderMenu();
    await choose('Bu cədvəl', 'CSV');
    expect(await screen.findByText('Hesabatda 12000 sətir var (limit 10000). Filtrləri daraldın.')).toBeInTheDocument();
    expect(mocks.saveFile).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'İxrac et' })).toBeEnabled();
  });

  it('shows other export errors from az.errors', async () => {
    mocks.api.reports.export.mockRejectedValue(new ApiError(503, 'REPORT_TIMEOUT', 'errors.REPORT_TIMEOUT'));
    renderMenu();
    await choose('Tam hesabat', 'Excel');
    expect(await screen.findByText('Hesabat vaxtında hazırlanmadı. Dövrü qısaldın və ya bir az sonra yenidən cəhd edin.')).toBeInTheDocument();
  });

  it('cannot export while the period cannot be shown', () => {
    renderMenu({ filters: null });
    expect(screen.getByRole('button', { name: 'İxrac et' })).toBeDisabled();
  });
});
```

In `apps/web/src/features/reports/reports-page.test.tsx`, add `saveFile: vi.fn()` to the hoisted `mocks` object, add after the `@/lib/session` mock:

```tsx
vi.mock('./download', () => ({ saveFile: mocks.saveFile }));
```

and append to the `describe('ReportsPage')` block:

```tsx
  it('exports the open tab with the bucket from the URL', async () => {
    mocks.me.current = meWith([...VIEWER, 'reports.export']);
    mocks.api.reports.runs.mockResolvedValue(page([reportRun()]));
    mocks.api.reports.export.mockResolvedValue({ blob: new Blob(['x']), filename: 'taskop-runs-2026-11-04_2026-11-04.csv' });
    renderWithRouter(<ReportsPage today={TODAY} />, '/reports?tab=runs');
    await screen.findByRole('button', { name: 'Açılış yoxlaması' });
    await userEvent.click(screen.getByRole('button', { name: 'İxrac et' }));
    await userEvent.click(within(await screen.findByRole('group', { name: 'Bu cədvəl' })).getByRole('menuitem', { name: 'CSV' }));
    await waitFor(() => expect(mocks.api.reports.export).toHaveBeenCalledWith('runs', { from: TODAY, to: TODAY, format: 'csv', bucket: 'all' }));
    expect(mocks.saveFile).toHaveBeenCalledOnce();
  });

  it('shows no export menu without reports.export', async () => {
    renderWithRouter(<ReportsPage today={TODAY} />, '/reports');
    expect(await screen.findByRole('link', { name: 'Gecikib: 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'İxrac et' })).not.toBeInTheDocument();
  });
```

(Add `within` to the `@testing-library/react` import of that file.)

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/web test -- features/reports/export-menu features/reports/reports-page`
Expected: FAIL: `Failed to resolve import "./export-menu"`; the page test finds no "İxrac et" button.

- [ ] **Step 3: Implement**

`apps/web/src/features/reports/export-menu.tsx`:

```tsx
import { type ProblemSeverity, REPORT_FORMATS, type ReportExportKind, type ReportFilters, type ReportFormat, type ReportKind, type RunBucket } from '@taskop/contracts';
import { Download, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api, useCan } from '@/lib/session';
import { saveFile } from './download';
import { exportErrorText, exportQuery } from './labels';

/** The full report has no CSV (Part 1 decision 16). */
const FULL_FORMATS: readonly ReportFormat[] = ['xlsx', 'pdf'];

/**
 * Spec §6.2 export menu (reports.view + reports.export): the open table in any format, or the full period report.
 * The file is built synchronously by the API, so the trigger shows a spinner and is disabled meanwhile: one export at
 * a time (decision 14).
 */
export function ExportMenu({ kind, filters, bucket, severity }: { kind: ReportKind; filters: ReportFilters | null; bucket?: RunBucket; severity?: ProblemSeverity }) {
  const { t } = useTranslation();
  const allowed = useCan('reports.view', 'reports.export');
  const [busy, setBusy] = useState(false);
  if (!allowed) return null;

  const download = async (target: ReportExportKind, format: ReportFormat) => {
    if (!filters || busy) return;
    setBusy(true);
    try {
      saveFile(await api.reports.export(target, exportQuery(target, filters, format, { bucket, severity })));
    } catch (e) {
      toast.error(exportErrorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={!filters || busy} aria-busy={busy}>
          {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
          {busy ? t('reports.export.preparing') : t('reports.export.menu')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup aria-label={t('reports.export.thisTable')}>
          <DropdownMenuLabel>{t('reports.export.thisTable')}</DropdownMenuLabel>
          {REPORT_FORMATS.map((f) => (
            <DropdownMenuItem key={f} onSelect={() => void download(kind, f)}>
              {t(`reports.export.${f}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup aria-label={t('reports.export.fullReport')}>
          <DropdownMenuLabel>{t('reports.export.fullReport')}</DropdownMenuLabel>
          {FULL_FORMATS.map((f) => (
            <DropdownMenuItem key={f} onSelect={() => void download('full', f)}>
              {t(`reports.export.${f}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

In `apps/web/src/features/reports/reports-page.tsx`, import `ExportMenu` from `./export-menu` and replace the page header with:

```tsx
      <PageHeader
        title={t('reports.title')}
        actions={
          <ExportMenu
            kind={tab}
            filters={filters}
            bucket={tab === 'runs' ? (search.bucket ?? DEFAULT_BUCKET) : undefined}
            severity={tab === 'problems' ? search.severity : undefined}
          />
        }
      />
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/reports && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/reports/export-menu.tsx apps/web/src/features/reports/export-menu.test.tsx apps/web/src/features/reports/reports-page.tsx apps/web/src/features/reports/reports-page.test.tsx
git commit -m "feat(web): add the report export menu for the open table and the full report" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: End-to-end: seeded runs on the dashboard, the overdue tile, the Excel export; final checks

**Files:**
- Create: `apps/web/e2e/reports.spec.ts`

**Interfaces:**
- Consumes the whole of this part and Part 1 Tasks 6–15:
  - `POST /auth/signup`, `GET /site-types`, `POST /sites`, `GET /roles`, `POST /users/workers`, `GET /templates`, `POST /checklists`, `GET /checklists/:id/draft`, `POST /checklists/:id/publish`, `POST /assignments`
  - the phone (stood in for by the API): `POST /auth/login/worker`, `GET /me/sync`, `POST /executions`, `POST /executions/:id/media`, `PUT /executions/:id/answers`, `POST /executions/:id/complete` (the same run as `executions.spec.ts`: 87.5 %, one normal rule problem and one critical manual problem)
  - `GET /reports/summary` (to wait for the status sweep), `GET /reports/runs/export` (through the web)
  - `addDays` from `@taskop/contracts`
- **Environment:** the API runs its cron jobs (`JOBS_CRON=true`, the default; the CI e2e job does not override it), so the never-started run turns overdue within a minute. No upload happens (the photo stays `pending`, as in `executions.spec.ts`), so no SeaweedFS is needed. The global template "Gündəlik təmizlik yoxlaması" must exist (`pnpm db:seed`).

- [ ] **Step 1: Write the end-to-end test**

`apps/web/e2e/reports.spec.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { addDays, type ChecklistContent, type ReportSummary, type SyncResponse } from '@taskop/contracts';
import { uuidv7 } from 'uuidv7';

/** The tenant's local date (new tenants are in Asia/Baku, which has no DST). */
const bakuDate = (at: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

function apiAs(request: APIRequestContext, accessToken: string) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  return async function call<T = unknown>(method: string, url: string, data?: unknown): Promise<T> {
    const res = await request.fetch(`/api/v1${url}`, { method, headers, data });
    expect(res.ok(), `${method} ${url}: ${await res.text()}`).toBeTruthy();
    return (res.status() === 204 ? null : await res.json()) as T;
  };
}

test('the dashboard shows the seeded runs; Overdue opens the runs report on its bucket; Excel downloads it', async ({ page, request }) => {
  // The overdue run waits for the status sweep (every minute): allow for two sweeps (decision 18).
  test.setTimeout(180_000);
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const orgCode = `e2e-rep-${suffix}`;
  const email = `rep-${suffix}@example.az`;
  const password = 'e2e owner password';

  // Tenant, site, worker and a published checklist from a Taskop template.
  const signup = await request.post('/api/v1/auth/signup', {
    data: { orgName: 'E2E Hesabat MMC', orgCode, fullName: 'Leyla Quliyeva', email, password, client: 'mobile' },
  });
  expect(signup.ok(), await signup.text()).toBeTruthy();
  const owner = apiAs(request, ((await signup.json()) as { accessToken: string }).accessToken);
  const types = await owner<Array<{ id: string; name: string }>>('GET', '/site-types');
  const site = await owner<{ id: string }>('POST', '/sites', { parentId: null, typeId: types.find((x) => x.name === 'Filial')!.id, name: 'Anbar №1' });
  const roles = await owner<Array<{ id: string; systemKey: string | null }>>('GET', '/roles');
  const worker = await owner<{ user: { id: string }; generatedSecret: string }>('POST', '/users/workers', {
    fullName: 'Nigar Səfərli',
    username: 'nigar',
    roleId: roles.find((r) => r.systemKey === 'worker')!.id,
    siteIds: [site.id],
  });
  const templates = await owner<Array<{ id: string; name: string; source: string }>>('GET', '/templates');
  const template = templates.find((x) => x.source === 'global' && x.name === 'Gündəlik təmizlik yoxlaması')!;
  const checklist = await owner<{ id: string }>('POST', '/checklists', { name: 'E2E hesabat', from: { kind: 'global', templateId: template.id } });
  const draft = await owner<{ revision: number }>('GET', `/checklists/${checklist.id}/draft`);
  await owner('POST', `/checklists/${checklist.id}/publish`, { revision: draft.revision });

  // Run 1, yesterday: open from yesterday 00:00 to tomorrow 00:00 in Baku; the worker completes it.
  const yesterday = bakuDate(new Date(Date.now() - 86_400_000));
  await owner('POST', '/assignments', {
    checklistId: checklist.id,
    siteId: site.id,
    assigneeIds: [worker.user.id],
    schedule: { kind: 'once', date: yesterday },
    timing: { mode: 'fixed', startTime: '00:00', dueAfterMinutes: 2880, graceMinutes: 0 },
  });

  const login = await request.post('/api/v1/auth/login/worker', { data: { orgCode, username: 'nigar', secret: worker.generatedSecret, client: 'mobile' } });
  expect(login.ok(), await login.text()).toBeTruthy();
  const phone = apiAs(request, ((await login.json()) as { accessToken: string }).accessToken);
  const sync = await phone<SyncResponse>('GET', '/me/sync');
  const clientOffsetMs = Math.round(Date.now() - Date.parse(sync.serverTime));
  const stamp = () => ({ deviceTime: new Date().toISOString(), clientOffsetMs });
  expect(sync.occurrences).toHaveLength(1);
  const occurrence = sync.occurrences[0]!;
  const content = sync.checklistVersions.find((v) => v.id === occurrence.checklistVersionId)!.content as ChecklistContent;
  const items = content.sections.flatMap((s) => s.items);
  const item = (label: string) => items.find((i) => i.label === label)!;

  const executionId = uuidv7();
  await phone('POST', '/executions', {
    id: executionId,
    occurrenceId: occurrence.id,
    startedAt: new Date().toISOString(),
    device: { platform: 'android', osVersion: '15', appVersion: '1.0.0' },
    ...stamp(),
  });
  const photoItem = item('Ümumi görünüşün fotosu');
  const photoId = uuidv7();
  await phone('POST', `/executions/${executionId}/media`, {
    id: photoId,
    itemId: photoItem.id,
    kind: 'photo',
    source: 'camera',
    mime: 'image/jpeg',
    bytes: 1000,
    width: 1600,
    height: 1200,
    capturedAt: new Date().toISOString(),
    ...stamp(),
  });
  const answers: Record<string, Record<string, unknown>> = {};
  for (const i of items) {
    // "Zibil qutuları boşaldılıb?" = Xeyr is a rule problem (normal). "Pis qoxu var?" = Xeyr is the good answer.
    if (i.type === 'yes_no') {
      answers[i.id] = { optionIds: [['Zibil qutuları boşaldılıb?', 'Pis qoxu var?'].includes(i.label) ? i.options[1].id : i.options[0].id] };
    }
    if (i.type === 'single_choice') answers[i.id] = { optionIds: [i.options[0]!.id] };
  }
  answers[photoItem.id] = { photos: [photoId] };
  const glass = item('Giriş qapısının şüşələri təmizdir?');
  answers[glass.id] = { ...answers[glass.id], problem: { severity: 'critical', note: 'Şüşədə çat var', mediaIds: [] } };
  await phone('PUT', `/executions/${executionId}/answers`, { rev: 1, answers, ...stamp() });
  const completed = await phone('POST', `/executions/${executionId}/complete`, { rev: 2, answers, completedAt: new Date().toISOString(), ...stamp() });
  expect(completed).toMatchObject({ state: 'completed', score: { percent: 87.5 } });

  // Run 2, yesterday: due one minute after midnight and open two more days, never started: the sweep makes it overdue.
  await owner('POST', '/assignments', {
    checklistId: checklist.id,
    siteId: site.id,
    assigneeIds: [worker.user.id],
    schedule: { kind: 'once', date: yesterday },
    timing: { mode: 'fixed', startTime: '00:00', dueAfterMinutes: 1, graceMinutes: 2880 },
  });
  await expect
    .poll(async () => (await owner<ReportSummary>('GET', `/reports/summary?from=${yesterday}&to=${yesterday}`)).counts, { timeout: 90_000, intervals: [2_000] })
    .toMatchObject({ planned: 2, due: 2, completed: 1, inProgress: 0, overdue: 1, withProblems: 1, withCritical: 1 });

  // The owner on the web: the home page is the dashboard (decision 17).
  await page.goto('/login');
  await page.getByLabel('E-poçt', { exact: true }).fill(email);
  await page.getByLabel('Şifrə', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Daxil ol' }).click();
  await expect(page.getByRole('heading', { name: 'İdarə paneli' })).toBeVisible();

  // Last 7 days covers yesterday whatever the time of day (decision 18).
  await page.getByLabel('Dövr').selectOption('last_7');
  await expect(page).toHaveURL(/[?&]period=last_7/);
  for (const name of ['Planlaşdırılıb: 2', 'Tamamlanıb: 1', 'Davam edir: 0', 'Gecikib: 1', 'Problemli: 1']) {
    await expect(page.getByRole('link', { name })).toBeVisible();
  }
  await expect(page.getByRole('group', { name: 'Tamamlanma faizi' })).toContainText('50%');
  await expect(page.getByRole('group', { name: 'Orta bal' })).toContainText(/87[,.]5%/);
  await expect(page.getByRole('figure', { name: 'Gündəlik icra' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Kritik problemlər' })).toContainText('Şüşədə çat var');

  // Overdue → the runs report, overdue bucket, same period.
  await page.getByRole('link', { name: 'Gecikib: 1' }).click();
  await expect(page).toHaveURL(/\/reports\?/);
  expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({ period: 'last_7', tab: 'runs', bucket: 'overdue' });
  await expect(page.getByRole('tab', { name: 'İcralar' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('group', { name: 'İcralar' }).getByRole('button', { name: 'Gecikmiş' })).toHaveAttribute('aria-pressed', 'true');
  const rows = page.getByRole('table').getByRole('row');
  await expect(rows).toHaveCount(2);
  for (const text of ['E2E hesabat', 'Anbar №1', 'Gecikib', 'Nigar Səfərli']) await expect(rows.nth(1)).toContainText(text);

  // Export this table as Excel: the server names the file (spec §5.4).
  const today = bakuDate(new Date());
  await page.getByRole('button', { name: 'İxrac et' }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('group', { name: 'Bu cədvəl' }).getByRole('menuitem', { name: 'Excel' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`taskop-runs-${addDays(today, -6)}_${today}.xlsx`);
  // An .xlsx file is a ZIP archive.
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
  await expect(page.getByRole('button', { name: 'İxrac et' })).toBeEnabled();
});
```

- [ ] **Step 2: Run the end-to-end tests**

Prerequisites: Part 1 Tasks 6–15 merged; a disposable database: `docker compose up -d` (Postgres; CI uses its `postgres:18-alpine` service instead); `apps/api/.env` filled in from `apps/api/.env.example` (with `JOBS_CRON=true`); `pnpm db:setup && pnpm db:seed` done (the migrations include `0013_reports` and `0014_reports_permissions`).

```bash
pnpm --filter @taskop/contracts build && pnpm --filter @taskop/i18n build && pnpm --filter @taskop/api-client build
pnpm --filter @taskop/api build
pnpm --filter @taskop/web e2e -- reports foundation checklists
```

Expected: PASS for all three specs. `foundation.spec.ts` and `checklists.spec.ts` find the "İdarə paneli" heading after signup (Task 6).

If the poll times out with `overdue: 0` and `pending` runs, the API runs without its cron (check `JOBS_CRON` in `apps/api/.env` and the API log for `occurrences.sweep`); do not add sleeps. If the dashboard shows "403", Part 1 Task 6's backfill or `ALL_PERMISSIONS` is missing the report keys.

- [ ] **Step 3: Run every check**

```bash
pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint && pnpm --filter @taskop/web test && pnpm --filter @taskop/web build
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @taskop/web e2e
```

Expected: all green. The `executions`, `notifications`, `scheduling` and `tasks` end-to-end specs still pass (the member in `notifications.spec.ts` is a worker without `reports.view`, so it still lands on the welcome page).

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/reports.spec.ts
git commit -m "test(web): add the reports end-to-end flow from the dashboard to the Excel export" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec §6, §8 and §9 (web) coverage:**

| Requirement | Where |
|---|---|
| §6.1 dashboard at `/` for `reports.view`, welcome page otherwise | Task 6 (`HomePage`, `DashboardPage`); decision 16 |
| Filter bar: presets (Today default … Custom), site tree with subtree, employee, checklist, "show inactive"; presets from the tenant's today, weeks from Monday | Task 2 (`resolveReportFilters` over Part 1's `resolvePeriod`), Task 4 (`ReportFilters`); decisions 2, 4, 5 |
| Count tiles Planned, Completed, In progress, Overdue, With problems, Completion %, Average score; completion tooltip; tiles link to `/reports?tab=runs&bucket=…` with the same filters | Task 3 (`TILE_BUCKETS`, `tileSearch`), Task 5 (`CountTiles`); decisions 6, 7 |
| Trend (recharts `ComposedChart`): due vs completed bars, completion % line, hidden for one day | Task 5 (`TrendChart`, `SummaryView`); decision 8 |
| Needs attention: overdue now (today, first 10), critical problems of the period (first 10), rows open the run drawer | Task 3 (`useOverdueNow`, `useCriticalProblems`), Task 6 (`AttentionPanel`); decision 9 |
| Refresh: 60 s while visible, manual refresh, "last updated" | Task 3 (`LIVE`), Task 6; decision 10 |
| §6.2 menu "Hesabatlar" for `reports.view` | Task 5 (`NAV_ITEMS`) |
| Filters, tab and bucket in validated URL search | Task 2 (`reportSearch`, `reportsPageSearch`), Task 5 (router), Task 8 (bucket, severity); decisions 2, 3 |
| Summary tab | Task 5 (`SummaryTab`) |
| Sites: sortable, parent path, inactive marked, row → `siteId` + Summary | Task 7 (`SitesTab`, `ComparisonTable`); decisions 11, 12 |
| Employees: sortable, Unassigned row, over-count note, row → `userId` | Task 7 (`EmployeesTab`); decision 11 |
| Runs: bucket chips, paged table with "load more", row → run drawer | Task 8 (`RunsTab`); decision 13 |
| Problems: counts by severity and resolution, paged list, row → run drawer, linked task → task drawer | Task 8 (`ProblemsTab`); decision 13 |
| Tasks: status tiles, on-time vs late, paged list, row → task drawer | Task 8 (`TasksTab`) |
| Export menu with `reports.export`: "Bu cədvəl" CSV/Excel/PDF, "Tam hesabat" Excel/PDF; api-client Blob → anchor download; spinner; `REPORT_TOO_LARGE` toast with row count | Task 3 (`saveFile`, `exportQuery`, `exportErrorText`), Task 9 (`ExportMenu`); decision 14 |
| §6.3 drawers reused (standalone by id) | Task 3 (`RunDrawer`, `ReportTaskDrawer`); decision 1 |
| §6.3 `features/reports/` with pages, `ReportFilters`, `CountTiles`, `TrendChart`, tables, `queries.ts` keyed by filters | Tasks 2–9 |
| `recharts` ^3.10 | Task 5 (Step 1); decision 15 |
| §8 inactive users and sites in reports, pickers hide them unless "show inactive"; scoring-off "—"; clock-suspect flag visible; empty period | Task 4, Task 7 (inactive badge), Task 8 (score "—", flags), Task 5 / 7 / 8 (empty states) |
| §9 web: presets resolve against the tenant's today | Task 2 (`resolves the presets…`), Task 6 (`resolves the period from the tenant's today…`) |
| §9 web: filters round-trip through the URL | Task 2, Task 5 (`opens on Summary and keeps the filters…`), Task 6 (`keeps the filters in the URL of the home page`), Task 8 (`keeps the runs bucket…`) |
| §9 web: tiles link to the right bucket | Task 3 (`links each count…`), Task 5 (`links every count…`) |
| §9 web: a sites row drills down | Task 7 (`compares sites…`, `drills down from a site row…`) |
| §9 web: export menu hidden without `reports.export`, too-large toast | Task 9 |
| §9 web: dashboard shows the welcome page without `reports.view` | Task 6 (`keeps the welcome page…`) |
| §9 e2e: seeded tenant → dashboard numbers → Overdue → runs tab with the overdue bucket → Excel download with the expected name | Task 10; decision 18 |

**Review Focus:** each of the five lines names its test: Task 2 / Task 5 (bad URLs), Task 6 (tenant day, midnight), Task 3 (drawer refresh), Task 9 (slow or failing export), Task 4 (selected inactive or unlisted filter targets).

**Placeholder scan:** every step has complete code or an exact command with its expected result. Edits to existing files (router, app shell and its test, home page, the two older e2e specs, the i18n file) name the exact place and the exact text. `TabBody` grows in Tasks 5, 7 and 8 with its full body written out each time.

**Type consistency:** `ReportSearch`, `ReportsPageSearch`, `reportSearch`, `reportsPageSearch`, `filterSearch`, `pageExtras`, `cleanSearch`, `resolveReportFilters`, `withPeriod`, `FILTER_ISSUE_KEYS`, `DEFAULT_PERIOD` / `DEFAULT_TAB` / `DEFAULT_BUCKET` (Task 2) are used with these names in Tasks 4–9; `TileKey`, `TILE_BUCKETS`, `DASHBOARD_TILES`, `SUMMARY_TILES`, `tileSearch`, `percentText`, `isSingleDay`, `sortRows`, `nextSort`, `SortState`, `siteOptions`, `employeeOptions`, `checklistOptions`, `exportQuery`, `exportErrorText` (Task 3 `labels.ts`) in Tasks 4–9; `reportKeys`, `useReportSummary(f, { live })`, `useSiteReport`, `useEmployeeReport`, `useReportRuns(f, bucket)`, `useReportProblems(f, severity)`, `useReportTasks`, `useOverdueNow(f, today)`, `useCriticalProblems(f)`, `useEmployeeOptions`, `useReportChecklistOptions` (Task 3 `queries.ts`) in Tasks 4–8; `RunDrawer({ id, tab?, onClose })` and `ReportTaskDrawer({ id, onClose })` in Tasks 6 and 8; `saveFile` in Task 9 (mocked there as `./download`); the fixtures of Task 3 (`IDS`, `TODAY`, `reportSummary`, `SITE_ROWS`, `EMPLOYEE_ROWS`, `reportRun`, `completedRun`, `reportProblem(s)`, `reportTask(s)`, `page`, `SITES`, `CHECKLISTS`, `meWith`, `VIEWER`) match their uses. The `ReportFilters` component and the contracts type of the same name never meet in one file without an alias (`reports-page.tsx` imports the type as `Filters`).

**Names used from Part 1's *Interfaces for Parts 2 and 3*:** `PERIOD_PRESETS`, `type PeriodPreset`, `resolvePeriod`, `reportRangeTooLong`, `emptyRunCounts`, `type RunCountKey`, `type RunCounts`, `REPORT_KINDS`, `type ReportKind`, `type ReportExportKind`, `REPORT_FORMATS`, `type ReportFormat`, `RUN_BUCKETS`, `type RunBucket`, types `ReportFilters`, `ReportExportQuery`, `ReportSummary`, `ReportTrendDay`, `SiteReportRow`, `EmployeeReportRow`, `ReportRun`, `ReportProblem`, `ReportProblems`, `ReportTask`, `ReportTasks`; permissions `reports.view`, `reports.export`; error codes `REPORT_RANGE_TOO_LONG`, `REPORT_TOO_LARGE`, `REPORT_TIMEOUT`; `api.reports.{summary, sites, employees, runs, problems, tasks, export}`, `type ReportFile`, `ApiError.rows` / `.limit`; `az.reports.{title, dashboard, trend, empty, inactive, noValue, periods, filters, counts, measures, buckets, tabs, columns, employees, problems, tasks, export, issues}`, `az.nav.reports`, `az.errors.REPORT_*`; the server behaviour for the `severity` filter (decision 5), the `completed` / `in_progress` buckets (decision 6), fixed pages of 50 with counts on every page (decisions 12–13), the Unassigned row's `userId: null` and last place (decision 9), run-detail access for `reports.view` (decision 1), and `Content-Disposition` file names. Nothing outside that section is assumed (Gap 1 lists the one thing it does not cover).
